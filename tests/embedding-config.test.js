import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-emb-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "9a".repeat(32);
delete process.env.EMBEDDING_MODEL;

const models = await import("../lib/embedding-models.js");
const { rankChunks, usableVector } = await import("../lib/retrieval.js");
const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const jobs = await import("../lib/jobs.js");
const { handlers } = await import("../lib/job-handlers.js");

after(() => { delete process.env.EMBEDDING_MODEL; jobs.stopWorker(); fs.rmSync(dir, { recursive: true, force: true }); });

test("model presets: default is English, e5 uses query/passage prefixes, unknown values fail loudly", () => {
  assert.equal(models.activeEmbeddingKey({}), "bge-small-en");
  assert.equal(models.activeEmbeddingModel({ EMBEDDING_MODEL: "multilingual-e5-small" }).queryPrefix, "query: ");
  assert.equal(models.activeEmbeddingModel({ EMBEDDING_MODEL: "multilingual-e5-small" }).docPrefix, "passage: ");
  assert.throws(() => models.activeEmbeddingKey({ EMBEDDING_MODEL: "gpt-embed-9000" }), /Unknown EMBEDDING_MODEL .* Options: bge-small-en, multilingual-e5-small/);
});

test("ranking ignores vectors made by a different model, and treats untagged legacy vectors as the default model", () => {
  const q = [1, 0];
  const chunks = [
    { text: "legacy english", embedding: [1, 0], embedding_model: null, entity: "x" },
    { text: "e5 vector", embedding: [1, 0], embedding_model: "multilingual-e5-small", entity: "x" },
    { text: "tag only", entity: "people", data_type: "team" },
  ];
  assert.equal(usableVector(chunks[0], "bge-small-en"), true);
  assert.equal(usableVector(chunks[1], "bge-small-en"), false);
  const asBge = rankChunks(q, chunks, ["people"], ["team"], "bge-small-en", 3).map(c => c.text);
  assert.deepEqual(asBge.slice(0, 2), ["legacy english", "tag only"].sort((a, b) => asBge.indexOf(a) - asBge.indexOf(b)));
  assert.equal(asBge[0], "legacy english", "cosine 1.0 beats a tag bonus");
  const asE5 = rankChunks(q, chunks, [], [], "multilingual-e5-small", 3);
  assert.equal(asE5[0].text, "e5 vector");
  assert.ok(asE5.every(c => !("embedding" in c)), "vectors are stripped from results");
  // model unavailable → no query vector → tags only, no crash
  assert.equal(rankChunks(null, chunks, ["people"], ["team"], "bge-small-en", 3)[0].text, "tag only");
});

test("chunks are stamped with the active model; switching models marks them stale and re-indexing fixes it", async () => {
  db.createProject({ id: "emb", name: "emb", userId: "u" });
  runs.insertChunks("emb", [{ text: "one", embedding: [0.1, 0.2] }, { text: "two", embedding: [0.3, 0.4] }, { text: "no vector" }]);
  assert.deepEqual(runs.loadChunks("emb").map(c => c.embedding_model), ["bge-small-en", "bge-small-en", null]);
  assert.equal(runs.chunkStats("emb").stale, 0);

  process.env.EMBEDDING_MODEL = "multilingual-e5-small"; // operator switches model
  assert.equal(runs.chunkStats("emb").stale, 2, "old vectors are now incomparable");
  assert.equal(runs.staleChunks("emb").length, 3, "chunks without vectors also get embedded");

  const seen = [];
  const fakeEmbed = async (texts) => { seen.push(texts.length); return texts.map(() => [0.5, 0.5]); };
  db.getDb().prepare("INSERT INTO jobs (project_id, user_id, method_id, action, status, created_at) VALUES ('emb','u','__reindex__','reindex','running',?)").run(Date.now());
  const job = db.getDb().prepare("SELECT * FROM jobs WHERE method_id = '__reindex__'").get();
  await handlers.reindex(job, { embed: fakeEmbed });
  assert.deepEqual(runs.loadChunks("emb").map(c => c.embedding_model), Array(3).fill("multilingual-e5-small"));
  assert.equal(runs.chunkStats("emb").stale, 0);
  assert.equal(runs.staleChunks("emb").length, 0);
  assert.match(db.getDb().prepare("SELECT progress FROM jobs WHERE id = ?").get(job.id).progress, /Re-indexed 3\/3/);

  // resumable & idempotent: nothing stale → no embedding calls
  const before = seen.length;
  await handlers.reindex(job, { embed: fakeEmbed });
  assert.equal(seen.length, before);
});

test("the model cache lives under the data directory (so it survives on a persistent volume)", async () => {
  const src = fs.readFileSync(new URL("../lib/embeddings.js", import.meta.url), "utf8");
  assert.match(src, /VENTURE_DATA_DIR/);
});

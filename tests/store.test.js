import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-store-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "ab".repeat(32);

const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");

after(() => fs.rmSync(dir, { recursive: true, force: true }));

const mkProject = (id, user = "u1") => db.createProject({ id, name: id, userId: user });
const vec = (...v) => v.map(x => x / Math.hypot(...v));

test("chunks round-trip with float32 embeddings and are searchable by stats", () => {
  mkProject("p-chunks");
  runs.insertChunks("p-chunks", [
    { text: "deck page 1", source_type: "document", retrieved_by: "deck.pdf", chunk_index: 0, embedding: vec(1, 2, 3) },
    { text: "fact", source_type: "web_search", entity: "competitor:Acme", data_type: "financials", pass_relevance: ["p3"], embedding: vec(3, 2, 1), source_url: "https://a.example" },
    { text: "no embedding", source_type: "additional_doc", retrieved_by: "extra.pdf" },
  ]);
  const loaded = runs.loadChunks("p-chunks");
  assert.equal(loaded.length, 3);
  assert.ok(loaded[0].embedding instanceof Float32Array);
  assert.ok(Math.abs(loaded[0].embedding[1] - vec(1, 2, 3)[1]) < 1e-6);
  assert.deepEqual(loaded[1].pass_relevance, ["p3"]);
  assert.equal(loaded[2].embedding, null);
  assert.deepEqual(runs.chunkStats("p-chunks"), { total: 3, web: 1, document: 2, stale: 0 });

  assert.equal(runs.deleteDocumentChunks("p-chunks", "deck.pdf"), 1);
  assert.equal(runs.loadChunks("p-chunks").length, 2);
});

test("saveRun merges fields, bumps version, and keeps earlier evidence/result", () => {
  mkProject("p-runs");
  const r1 = runs.saveRun("p-runs", "m", { status: "extracted", evidence: { a: 1 } });
  assert.equal(r1.version, 1);
  const r2 = runs.saveRun("p-runs", "m", { status: "review", result: "# analysis", new_competitors: ["Acme"] });
  assert.equal(r2.version, 2);
  const full = runs.getRun("p-runs", "m");
  assert.deepEqual(full.evidence, { a: 1 });
  assert.equal(full.result, "# analysis");
  assert.deepEqual(full.new_competitors, ["Acme"]);
  // error keeps the previous result so the user can retry or keep the draft
  runs.saveRun("p-runs", "m", { status: "error", error: "boom" });
  const failed = runs.getRun("p-runs", "m");
  assert.equal(failed.result, "# analysis");
  assert.equal(failed.error, "boom");

  runs.appendVersion("p-runs", "m", "execute", "v1");
  runs.appendVersion("p-runs", "m", "revise", "v2");
  assert.deepEqual(runs.listVersions("p-runs", "m").map(v => v.result), ["v2", "v1"]);
  assert.equal(Object.keys(runs.listRuns("p-runs")[0]).includes("result"), false, "lite listing omits heavy fields");
});

test("updateProject merges patches and ignores server-owned keys and web sources", () => {
  mkProject("p-merge");
  db.updateProject("p-merge", "u1", { state: { corpusText: "abc", p0: { venture_name: "X" } } });
  const p = db.updateProject("p-merge", "u1", {
    state: {
      entities: { competitors: ["A"] },
      methodResults: { m: "STALE BROWSER COPY" },
      chunks: [{ text: "stale" }],
      sources: [{ id: "d", type: "document", name: "deck" }, { id: "w", type: "web_discovered", name: "http://x" }],
    },
  });
  assert.equal(p.state.corpusText, "abc", "earlier keys survive a partial patch");
  assert.deepEqual(p.state.entities, { competitors: ["A"] });
  assert.equal(p.state.methodResults, undefined);
  assert.equal(p.state.chunks, undefined);
  assert.deepEqual(p.state.sources.map(s => s.id), ["d"]);
});

test("ownership: other users cannot see or touch a project", () => {
  mkProject("p-own", "owner");
  assert.equal(db.projectExists("p-own", "owner"), true);
  assert.equal(db.projectExists("p-own", "intruder"), false);
  assert.equal(runs.loadProjectForClient("p-own", "intruder"), null);
});

test("legacy blob projects migrate into tables once, with mid-run statuses made safe", () => {
  mkProject("p-legacy");
  const legacy = {
    corpusText: "deck",
    p0: { venture_name: "Legacy" },
    methodStatus: { a: "done", b: "executing", c: "extracting", d: "review" },
    evidenceBundles: { a: { e: 1 }, b: { e: 2 } },
    methodResults: { a: "result A", d: "result D" },
    chunks: [{ text: "c1", source_type: "web_search", embedding: vec(1, 0) }, { text: "c2", source_type: "document", embedding: [0, 1] }],
    sources: [{ id: "doc", type: "document", name: "deck.pdf" }, { id: "web1", type: "web_discovered", name: "site", rawText: "t", retrievedBy: "a", addedAt: "2025-01-01" }],
  };
  db.getDb().prepare("UPDATE projects SET state = ? WHERE id = 'p-legacy'").run(JSON.stringify(legacy));

  const loaded = runs.loadProjectForClient("p-legacy", "u1");
  assert.equal(runs.getRun("p-legacy", "a").status, "done");
  assert.equal(runs.getRun("p-legacy", "a").result, "result A");
  assert.equal(runs.getRun("p-legacy", "b").status, "extracted", "executing w/o result but with evidence → extracted");
  assert.equal(runs.getRun("p-legacy", "c").status, "error", "extracting w/o evidence → error");
  assert.equal(runs.getRun("p-legacy", "d").status, "review");
  assert.equal(runs.chunkStats("p-legacy").total, 2);
  assert.equal(loaded.state.methodResults, undefined, "legacy keys removed from blob");
  assert.deepEqual(loaded.state.sources.map(s => s.id).sort(), ["doc", "web1"], "web source now served from its table");
  assert.equal(loaded.chunkStats.total, 2);

  // Idempotent: loading again changes nothing and duplicates nothing
  runs.loadProjectForClient("p-legacy", "u1");
  assert.equal(runs.chunkStats("p-legacy").total, 2);
  assert.equal(runs.listWebSources("p-legacy").length, 1);
});

test("deleting a project removes all derived rows; deleteUserData wipes the account", () => {
  mkProject("p-del", "gone");
  runs.insertChunks("p-del", [{ text: "x" }]);
  runs.saveRun("p-del", "m", { status: "review", result: "r" });
  runs.addWebSources("p-del", [{ id: "w", name: "n", rawText: "t", retrievedBy: "m", addedAt: "now" }]);
  runs.enqueueJob({ projectId: "p-del", userId: "gone", methodId: "m", action: "extract" });
  mkProject("p-del2", "gone");
  runs.insertChunks("p-del2", [{ text: "y" }]);

  db.deleteProject("p-del", "gone");
  assert.equal(runs.loadChunks("p-del").length, 0);
  assert.equal(runs.listRuns("p-del").length, 0);
  assert.equal(runs.listWebSources("p-del").length, 0);
  assert.equal(runs.activeJob("p-del", "m"), null);

  db.deleteUserData("gone");
  assert.equal(runs.loadChunks("p-del2").length, 0);
  assert.equal(db.projectExists("p-del2", "gone"), false);
  assert.equal(db.projectExists("p-own", "owner"), true, "other users' data untouched");
});

test("result_updated_at moves only when the result text changes (not on approve/status)", async () => {
  mkProject("p-stale");
  const a = runs.saveRun("p-stale", "m", { status: "review", result: "v1" });
  const t1 = runs.getRun("p-stale", "m").result_updated_at;
  assert.ok(t1 > 0);
  await new Promise(r => setTimeout(r, 15));
  runs.saveRun("p-stale", "m", { status: "done" });
  assert.equal(runs.getRun("p-stale", "m").result_updated_at, t1, "approve must not count as a content change");
  runs.saveRun("p-stale", "m", { status: "review", result: "v2" });
  assert.ok(runs.getRun("p-stale", "m").result_updated_at > t1);
  assert.ok(a.version >= 1);
});

test("model usage is attributed to the deal and removed with it", () => {
  mkProject("p-use");
  db.logEvent({ userId: "u1", eventType: "pipeline_call", step: "execute", usage: { input: 100, output: 50 }, projectId: "p-use" });
  db.logEvent({ userId: "u2", eventType: "pipeline_call", step: "extract", inputText: "x".repeat(400), outputText: "", projectId: "p-use" }); // estimated: 100
  db.logEvent({ userId: "u1", eventType: "pipeline_call", step: "execute", usage: { input: 999, output: 1 }, projectId: "other" });
  assert.deepEqual(runs.projectUsage("p-use"), { calls: 2, tokens: 250 });
  db.deleteProject("p-use", "u1");
  assert.deepEqual(runs.projectUsage("p-use"), { calls: 0, tokens: 0 });
  assert.equal(runs.projectUsage("other").tokens, 1000, "other deals untouched");
});

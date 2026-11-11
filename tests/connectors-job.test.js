import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-conn-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "78".repeat(32);
process.env.EMBEDDING_LOAD_TIMEOUT_MS = "1500"; // the model host is unreachable in CI/sandbox; fail fast

const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const jobs = await import("../lib/jobs.js");
const { handlers } = await import("../lib/job-handlers.js");

after(() => { jobs.stopWorker(); fs.rmSync(dir, { recursive: true, force: true }); });
const realFetch = globalThis.fetch;

const roles = { fast: { provider: "anthropic", model: "claude-haiku-5-5" }, smart: { provider: "anthropic", model: "claude-sonnet-5-5" } };
db.createProject({ id: "cj", name: "cj", userId: "alice" });
db.updateProject("cj", "alice", { state: { corpusText: "deck", entities: { people: ["Ana Rossi"] }, p0: { venture_name: "Acme", product_service: "robots" } } });

function stub(seen) {
  globalThis.fetch = async (url) => {
    seen.push(String(url));
    if (String(url).includes("openalex")) return new Response(JSON.stringify({ results: [{ id: "https://openalex.org/A1", display_name: "Ana Rossi", works_count: 5, cited_by_count: 9 }] }), { status: 200 });
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"methodology":"team_assessment","evidence_quality":"low","extracted_evidence":[],"gaps":[],"conflicts":[]}' }], stop_reason: "end_turn" }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
const extract = async () => { jobs.submitJob({ projectId: "cj", userId: "alice", methodId: "team_assessment", action: "extract" }); await jobs.whenIdle(); };

test("opted-out users: no third-party call is made during extraction", async () => {
  db.saveSettings("alice", { providers: { anthropic: { apiKey: "k", enabled: true } }, roles, connectors: { openalex: { enabled: false } } });
  const seen = []; stub(seen); jobs.configureWorker({ handlers });
  try { await extract(); } finally { globalThis.fetch = realFetch; }
  assert.equal(seen.some(u => u.includes("openalex")), false);
  assert.equal(runs.chunkStats("cj").total, 0);
});

test("opted-in: connector evidence is stored with its source, replaced (not duplicated) on re-extract", async () => {
  db.saveSettings("alice", { providers: { anthropic: { apiKey: "k", enabled: true } }, roles, connectors: { openalex: { enabled: true } } });
  const seen = []; stub(seen);
  try {
    await extract();
    const first = runs.loadChunks("cj").filter(c => c.source_type === "connector");
    assert.equal(first.length, 1, "embedding model unavailable here, evidence is still stored (without a vector)");
    assert.equal(first[0].retrieved_by, "openalex:team_assessment");
    assert.equal(first[0].source_url, "https://openalex.org/A1");
    assert.match(first[0].text, /identity not verified/);
    await extract();
    assert.equal(runs.loadChunks("cj").filter(c => c.source_type === "connector").length, 1, "no duplicates after re-extraction");
    assert.equal(runs.getRun("cj", "team_assessment").status, "extracted");
  } finally { globalThis.fetch = realFetch; }
});

test("retrieval degrades to tag ranking (not a failed run) when the embedding model is unavailable", async () => {
  const { hybridRetrieve } = await import("../lib/embeddings.js");
  const chunks = [
    { text: "unrelated", entity: "market", data_type: "market_data" },
    { text: "founder bio", entity: "people", data_type: "team" },
  ];
  // In this sandbox the model cannot be downloaded, which is exactly the failure being tested
  const out = await hybridRetrieve("who are the founders", chunks, ["people"], ["team"], 2);
  assert.equal(out[0].text, "founder bio", "tag matches still rank first without vectors");
  assert.equal(out.length, 2);
});

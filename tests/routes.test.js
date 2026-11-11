import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-routes-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "ef".repeat(32);

const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const jobs = await import("../lib/jobs.js");
const runsRoute = await import("../app/api/projects/[id]/runs/route.js");
const sourcesRoute = await import("../app/api/projects/[id]/sources/route.js");
const projectRoute = await import("../app/api/projects/[id]/route.js");

after(() => { jobs.stopWorker(); fs.rmSync(dir, { recursive: true, force: true }); });

const as = (userId) => { globalThis.__testUserId = userId; };
const ctx = (id) => ({ params: Promise.resolve({ id }) });
const req = (url, init) => new Request("http://localhost" + url, init);
const post = (id, body) => runsRoute.POST(req(`/api/projects/${id}/runs`, { method: "POST", body: JSON.stringify(body) }), ctx(id));
const get = (id, qs = "") => runsRoute.GET(req(`/api/projects/${id}/runs${qs}`), ctx(id));

db.createProject({ id: "p1", name: "p1", userId: "alice" });
// Handlers do nothing here - these tests cover the HTTP layer only
jobs.configureWorker({ handlers: { extract: async () => {}, execute: async () => {}, revise: async () => {} } });

test("unauthenticated requests get 401 and strangers get 404 (no existence leak)", async () => {
  as(null);
  assert.equal((await get("p1")).status, 401);
  assert.equal((await post("p1", { action: "extract", methodId: "team_assessment" })).status, 401);
  assert.equal((await sourcesRoute.DELETE(req("/x?id=1"), ctx("p1"))).status, 401);

  as("mallory");
  assert.equal((await get("p1")).status, 404);
  assert.equal((await post("p1", { action: "extract", methodId: "team_assessment" })).status, 404);
  assert.equal((await sourcesRoute.DELETE(req("/x?id=1&name=deck.pdf"), ctx("p1"))).status, 404);
  assert.equal((await projectRoute.GET(req("/p"), ctx("p1"))).status, 404);
  assert.equal(runs.listRuns("p1").length, 0, "nothing was queued for the stranger");
});

test("validates action, method and preconditions", async () => {
  as("alice");
  assert.equal((await post("p1", { action: "delete-everything", methodId: "team_assessment" })).status, 400);
  assert.equal((await post("p1", { action: "extract", methodId: "not_a_method" })).status, 400);
  assert.equal((await post("p1", { action: "execute", methodId: "team_assessment" })).status, 400, "execute needs evidence first");
  assert.equal((await post("p1", { action: "revise", methodId: "team_assessment" })).status, 400);
  assert.equal((await post("p1", { action: "approve", methodId: "team_assessment" })).status, 400, "nothing to approve");
});

test("extract is accepted (202), shows as in-flight, and a duplicate is rejected with 409", async () => {
  as("alice");
  jobs.stopWorker();
  jobs.configureWorker({ handlers: { extract: async () => new Promise(r => setTimeout(r, 50)) } });
  const res = await post("p1", { action: "extract", methodId: "traction_analysis" });
  assert.equal(res.status, 202);
  assert.equal((await res.json()).run.status, "extracting");
  const dup = await post("p1", { action: "extract", methodId: "traction_analysis" });
  assert.equal(dup.status, 409);
  await jobs.whenIdle();
});

test("polling is lightweight; per-method fetch returns evidence, result, web sources and history", async () => {
  as("alice");
  runs.saveRun("p1", "bear_case", { status: "review", evidence: { big: "x".repeat(500) }, result: "## Bear\nrisks", new_competitors: ["Acme"] });
  runs.appendVersion("p1", "bear_case", "execute", "## Bear\nrisks");
  runs.addWebSources("p1", [{ id: "w1", name: "site", rawText: "t", retrievedBy: "bear_case", addedAt: "2025-01-01" }]);
  runs.insertChunks("p1", [{ text: "web fact", source_type: "web_search" }, { text: "doc", source_type: "document", retrieved_by: "deck.pdf" }]);

  const lite = await (await get("p1")).json();
  assert.equal(lite.runs.bear_case.status, "review");
  assert.equal("result" in lite.runs.bear_case, false, "polling omits heavy fields");
  assert.deepEqual(lite.chunks, { total: 2, web: 1, document: 1 });

  const full = await (await get("p1", "?full=1")).json();
  assert.equal(full.runs.bear_case.result, "## Bear\nrisks");

  const one = await (await get("p1", "?method=bear_case&history=1")).json();
  assert.deepEqual(one.run.new_competitors, ["Acme"]);
  assert.equal(one.webSources[0].id, "w1");
  assert.equal(one.versions.length, 1);
  assert.equal((await get("p1", "?method=value_chain_map")).status, 404);
});

test("approve marks a reviewed run done; it is refused while the method is still running", async () => {
  as("alice");
  const ok = await post("p1", { action: "approve", methodId: "bear_case" });
  assert.equal(ok.status, 200);
  assert.equal(runs.getRun("p1", "bear_case").status, "done");

  runs.saveRun("p1", "deal_valuation", { status: "executing", result: "partial" });
  assert.equal((await post("p1", { action: "approve", methodId: "deal_valuation" })).status, 409);
});

test("deleting a source removes web rows and document chunks, only for the owner", async () => {
  as("alice");
  const res = await sourcesRoute.DELETE(req("/x?id=w1&name=deck.pdf"), ctx("p1"));
  assert.equal(res.status, 200);
  assert.deepEqual((await res.json()).chunks, { total: 1, web: 1, document: 0 });
  assert.equal(runs.listWebSources("p1").length, 0);
});

test("loading a project serves merged web sources and chunk stats; a stale browser cannot overwrite runs", async () => {
  as("alice");
  runs.addWebSources("p1", [{ id: "w2", name: "site2", rawText: "t", retrievedBy: "bear_case", addedAt: "2025-01-02" }]);
  const loaded = await (await projectRoute.GET(req("/p"), ctx("p1"))).json();
  assert.ok(loaded.state.sources.some(s => s.id === "w2" && s.type === "web_discovered"));
  assert.ok(loaded.chunkStats.total >= 1);

  const before = runs.getRun("p1", "bear_case").result;
  const put = await projectRoute.PUT(req("/p", { method: "PUT", body: JSON.stringify({ state: { methodResults: { bear_case: "STALE" }, chunks: [], corpusText: "ok" } }) }), ctx("p1"));
  assert.equal(put.status, 200);
  assert.equal(runs.getRun("p1", "bear_case").result, before);
  assert.equal(runs.loadChunks("p1").length, 1, "stale empty chunks array did not wipe the index");
});

test("restore puts an old version back as the current draft and records the restore", async () => {
  as("alice");
  runs.saveRun("p1", "scenario_modeling", { status: "review", result: "draft 2" });
  runs.appendVersion("p1", "scenario_modeling", "execute", "draft 1");
  runs.appendVersion("p1", "scenario_modeling", "revise", "draft 2");
  const versions = runs.listVersions("p1", "scenario_modeling");
  const first = versions.find(v => v.result === "draft 1");

  assert.equal((await post("p1", { action: "restore", methodId: "scenario_modeling", versionId: 999999 })).status, 404);
  const res = await post("p1", { action: "restore", methodId: "scenario_modeling", versionId: first.id });
  assert.equal(res.status, 200);
  assert.equal(runs.getRun("p1", "scenario_modeling").result, "draft 1");
  assert.equal(runs.getRun("p1", "scenario_modeling").status, "review", "restored text needs re-approval");
  assert.deepEqual(runs.listVersions("p1", "scenario_modeling").map(v => v.kind), ["restore", "revise", "execute"]);

  as("mallory");
  assert.equal((await post("p1", { action: "restore", methodId: "scenario_modeling", versionId: first.id })).status, 404);
});

test("compare: lists only the caller's deals, with rubric scores and a sensible shape", async () => {
  const compare = await import("../app/api/compare/route.js");
  db.createProject({ id: "c1", name: "Deal One", userId: "carol" });
  db.createProject({ id: "c2", name: "Deal Two (no report)", userId: "carol" });
  db.createProject({ id: "c3", name: "Someone else's", userId: "dave" });
  db.updateProject("c1", "carol", { state: { p0: { venture_name: "One Inc", stage: "seed", classification: { business_model: "b2b" } },
    docExecSummary: { verdict: "Invest", score: "7.8/10", score_coverage: 0.85, investment_thesis: "t", score_breakdown: [{ id: "market", score: 8 }, { id: "team", score: null }] } } });
  db.updateProject("c3", "dave", { state: { docExecSummary: { verdict: "Decline", score: "3.0/10", score_breakdown: [] } } });

  as(null);
  assert.equal((await compare.GET()).status, 401);
  as("carol");
  const data = await (await compare.GET()).json();
  assert.deepEqual(data.deals.map(d => d.id).sort(), ["c1", "c2"], "never includes another user's deals");
  const one = data.deals.find(d => d.id === "c1");
  assert.equal(one.name, "One Inc");
  assert.equal(one.score, 7.8);
  assert.deepEqual(one.dimensions, { market: 8, team: null });
  assert.equal(data.deals.find(d => d.id === "c2").hasReport, false);
  assert.equal(data.dimensions.length, 6);
});

test("pipeline route: unsupported or oversized uploads are rejected before any model call", async () => {
  const pipeline = await import("../app/api/pipeline/route.js");
  db.createProject({ id: "pi", name: "pi", userId: "alice" });
  const call = (body) => pipeline.POST(new Request("http://x/api/pipeline", { method: "POST", body: JSON.stringify(body) }));
  let fetched = false;
  const real = globalThis.fetch; globalThis.fetch = async () => { fetched = true; throw new Error("no network in this test"); };
  try {
    as("alice");
    const exe = await call({ step: "ingest", projectId: "pi", fileName: "malware.exe", fileBase64: "QQ==" });
    assert.equal(exe.status, 415);
    const spoof = await call({ step: "ingest", projectId: "pi", fileName: "x.exe", fileType: "application/pdf", fileBase64: "QQ==" });
    assert.equal(spoof.status, 415, "extension decides, the claimed MIME type is ignored");
    const big = await call({ step: "ingest", projectId: "pi", fileName: "big.pdf", fileBase64: "A".repeat(28_000_001) });
    assert.equal(big.status, 413);
    as("mallory");
    const stranger = await call({ step: "ingest", projectId: "pi", fileName: "a.txt", fileBase64: Buffer.from("hi").toString("base64") });
    assert.equal(stranger.status, 404);
    as("alice");
    const corrupt = await call({ step: "ingest", projectId: "pi", fileName: "bad.docx", fileBase64: Buffer.from("not a zip").toString("base64") });
    assert.equal(corrupt.status, 422);
    assert.match((await corrupt.json()).error, /Could not read bad\.docx/);
    assert.equal(fetched, false, "no provider call is made for rejected or locally parsed files");
  } finally { globalThis.fetch = real; }
});

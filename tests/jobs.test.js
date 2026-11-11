import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-jobs-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "cd".repeat(32);

const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const jobs = await import("../lib/jobs.js");
const { handlers } = await import("../lib/job-handlers.js");

after(() => { jobs.stopWorker(); fs.rmSync(dir, { recursive: true, force: true }); });
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

const mk = (id, user = "u1") => db.createProject({ id, name: id, userId: user });
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

test("runs independent jobs in parallel up to the concurrency cap", async () => {
  mk("p-par");
  let running = 0, peak = 0;
  jobs.configureWorker({
    concurrency: 3, perUserCap: 3,
    handlers: { extract: async () => { running++; peak = Math.max(peak, running); await sleep(40); running--; } },
  });
  for (const m of ["value_chain_map", "stakeholder_deep_map", "top_down_tam", "bottom_up_validation", "direct_competitor_map"]) {
    jobs.submitJob({ projectId: "p-par", userId: "u1", methodId: m, action: "extract" });
  }
  await jobs.whenIdle();
  assert.equal(peak, 3);
  assert.equal(runs.jobCounts().queued ?? 0, 0);
});

test("per-user cap stops one user starving another", async () => {
  mk("p-a", "alice"); mk("p-b", "bob");
  const started = [];
  let releaseAlice;
  const gate = new Promise(r => { releaseAlice = r; });
  jobs.configureWorker({
    concurrency: 3, perUserCap: 2,
    handlers: { extract: async (job) => { started.push(job.user_id + ":" + job.method_id); if (job.user_id === "alice") await gate; } },
  });
  for (const m of ["m1", "m2", "m3", "m4"]) runs.enqueueJob({ projectId: "p-a", userId: "alice", methodId: m, action: "extract" });
  runs.enqueueJob({ projectId: "p-b", userId: "bob", methodId: "m1", action: "extract" });
  jobs.ensureWorker();
  await sleep(60);
  assert.equal(started.filter(s => s.startsWith("alice")).length, 2, "alice capped at 2 concurrent");
  assert.ok(started.includes("bob:m1"), "bob is served although alice has a backlog");
  releaseAlice();
  await jobs.whenIdle();
  assert.equal(started.length, 5);
});

test("rejects a second submission for a method that is already queued or running", () => {
  mk("p-dup");
  jobs.configureWorker({ handlers: { extract: async () => sleep(30) } });
  jobs.stopWorker(); // keep the first job queued
  runs.enqueueJob({ projectId: "p-dup", userId: "u1", methodId: "mm", action: "extract" });
  assert.throws(() => jobs.submitJob({ projectId: "p-dup", userId: "u1", methodId: "mm", action: "extract" }), (e) => e.status === 409);
  db.getDb().prepare("DELETE FROM jobs WHERE project_id = 'p-dup'").run(); // don't leak into later tests
});

test("a failing job marks the run as error but keeps the previous result", async () => {
  mk("p-fail");
  runs.saveRun("p-fail", "mm", { status: "review", result: "old draft", evidence: { e: 1 } });
  jobs.configureWorker({ handlers: { revise: async () => { throw new Error("provider down"); } } });
  jobs.submitJob({ projectId: "p-fail", userId: "u1", methodId: "mm", action: "revise" });
  assert.equal(runs.getRun("p-fail", "mm").status, "executing");
  await jobs.whenIdle();
  const r = runs.getRun("p-fail", "mm");
  assert.equal(r.status, "error");
  assert.equal(r.error, "provider down");
  assert.equal(r.result, "old draft");
  assert.equal(runs.activeJob("p-fail", "mm"), null, "job is finished so the user can retry");
});

test("jobs left 'running' by a crashed process are re-queued and completed on start", async () => {
  mk("p-crash");
  const id = runs.enqueueJob({ projectId: "p-crash", userId: "u1", methodId: "mm", action: "extract" });
  db.getDb().prepare("UPDATE jobs SET status = 'running' WHERE id = ?").run(id);
  let ran = false;
  jobs.configureWorker({ handlers: { extract: async () => { ran = true; } } });
  jobs.stopWorker();
  jobs.ensureWorker();
  await jobs.whenIdle();
  assert.equal(ran, true);
  assert.equal(db.getDb().prepare("SELECT status FROM jobs WHERE id = ?").get(id).status, "done");
});

// ── Real handlers against a stubbed provider API ─────────────────────────────

function stubAnthropic(responder) {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    if (!String(url).includes("api.anthropic.com")) throw new Error("unexpected fetch " + url);
    const body = JSON.parse(init.body);
    seen.push(body);
    const text = responder(body, seen.length);
    return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  return seen;
}

test("handlers drive extract → execute → revise → approve with history, stored server-side", async () => {
  db.saveSettings("u1", { providers: { anthropic: { apiKey: "sk-test", enabled: true } }, roles: { fast: { provider: "anthropic", model: "claude-haiku-5-5" }, smart: { provider: "anthropic", model: "claude-sonnet-5-5" } } });
  mk("p-life");
  db.updateProject("p-life", "u1", { state: { corpusText: "Pitch deck text. Founder has 10 years in medtech.", entities: { competitors: [] }, p0: { venture_name: "Acme", venture_summary: "s", stage: "seed", classification: { business_model: "b2b" } }, methodNotes: {} } });
  jobs.configureWorker({ handlers });

  const seen = stubAnthropic((body) => {
    const sys = body.system;
    if (sys.includes("evidence retrieval specialist")) return '```json\n{"methodology":"team_assessment","evidence_quality":"medium","extracted_evidence":[{"id":"E1","content":"10 years in medtech","entity":"startup"}],"gaps":[],"conflicts":[]}\n```';
    if (sys.includes("revising an existing analysis")) return "## Revised\nbetter\n## Key insight\nk";
    return "## Analysis\nSolid team.\n## Key insight\nk";
  });

  // extract
  jobs.submitJob({ projectId: "p-life", userId: "u1", methodId: "team_assessment", action: "extract" });
  assert.equal(runs.getRun("p-life", "team_assessment").status, "extracting");
  await jobs.whenIdle();
  let r = runs.getRun("p-life", "team_assessment");
  assert.equal(r.status, "extracted");
  assert.equal(r.evidence.extracted_evidence[0].content, "10 years in medtech");
  assert.match(seen[0].messages[0].content, /Founder has 10 years/, "corpus reaches the model fenced as untrusted");
  assert.match(seen[0].messages[0].content, /untrusted_source/);

  // execute (notes travel in the job payload)
  jobs.submitJob({ projectId: "p-life", userId: "u1", methodId: "team_assessment", action: "execute", payload: { notes: "focus on CTO" } });
  await jobs.whenIdle();
  r = runs.getRun("p-life", "team_assessment");
  assert.equal(r.status, "review");
  assert.match(r.result, /Solid team/);
  assert.match(seen.at(-1).messages[0].content, /focus on CTO/);

  // revise keeps history
  jobs.submitJob({ projectId: "p-life", userId: "u1", methodId: "team_assessment", action: "revise", payload: { notes: "" } });
  await jobs.whenIdle();
  r = runs.getRun("p-life", "team_assessment");
  assert.match(r.result, /Revised/);
  assert.match(seen.at(-1).messages[0].content, /PRIOR DRAFT:\n## Analysis/);
  assert.deepEqual(runs.listVersions("p-life", "team_assessment").map(v => v.kind), ["revise", "execute"]);

  // usage was recorded with real token counts
  const used = db.getDb().prepare("SELECT SUM(token_est) AS t FROM usage_events WHERE user_id = 'u1' AND event_type = 'pipeline_call'").get().t;
  assert.equal(used, 3 * 15);
  assert.ok(runs.getRun("p-life", "team_assessment").version >= 6);
});

test("execute without evidence fails cleanly and is retryable", async () => {
  mk("p-noev");
  jobs.configureWorker({ handlers });
  jobs.submitJob({ projectId: "p-noev", userId: "u1", methodId: "team_assessment", action: "execute" });
  await jobs.whenIdle();
  const r = runs.getRun("p-noev", "team_assessment");
  assert.equal(r.status, "error");
  assert.match(r.error, /re-extract/i);
});

import { test, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-report-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "34".repeat(32);

const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const jobs = await import("../lib/jobs.js");
const { handlers } = await import("../lib/job-handlers.js");
const route = await import("../app/api/projects/[id]/report/route.js");
const { computeScore } = await import("../lib/scoring.js");

after(() => { jobs.stopWorker(); fs.rmSync(dir, { recursive: true, force: true }); });
const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

db.saveSettings("alice", { providers: { anthropic: { apiKey: "sk", enabled: true } }, roles: Object.fromEntries(["fast", "smart", "doc_chapter", "doc_exec"].map(r => [r, { provider: "anthropic", model: "claude-sonnet-5-5" }])) });
db.createProject({ id: "pr", name: "pr", userId: "alice" });
db.updateProject("pr", "alice", { state: {
  p0: { venture_name: "Acme", venture_summary: "s", stage: "seed", classification: { business_model: "b2b" } },
  methods: [
    { id: "top_down_tam", name: "TAM", pass: "p2", decision: "run" },
    { id: "direct_competitor_map", name: "Competitors", pass: "p3", decision: "run" },
    { id: "team_assessment", name: "Team", pass: "p8", decision: "run" },
    { id: "unit_economics", name: "Unit economics", pass: "p7", decision: "skip" },
  ],
  passSummaries: { p2: { pass_verdict: "Big market" } },
  finModel: { currency: "EUR", assumptions: { arpa_month: { value: 100 }, gross_margin_pct: { value: 80 }, cac: { value: 400 }, monthly_churn_pct: { value: 5 }, new_customers_start: { value: 50 }, fixed_costs_month: { value: 10000 }, cash_start: { value: 100000 } } },
} });
for (const [m, r] of [["top_down_tam", "TAM analysis"], ["direct_competitor_map", "Competitor analysis"], ["team_assessment", "Team analysis"], ["unit_economics", "skipped analysis"]]) runs.saveRun("pr", m, { status: "done", result: r });

let dims;
const seenPrompts = [];
function stub() {
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    seenPrompts.push(body);
    let text;
    if (body.system.includes("writing one chapter")) {
      await new Promise(r => setTimeout(r, 10));
      text = `## Chapter\nBody for ${body.messages[0].content.match(/for "([^"]+)"/)?.[1]}`;
    } else {
      text = JSON.stringify({
        investment_thesis: "thesis", executive_summary: "summary", strongest_findings: ["f"], key_risks: ["r"], tensions: [], founder_questions: ["q"], recommendation: "rec",
        // model "hallucinates" scores for passes that were never run; code must null them
        dimension_scores: { ...dims, business_model: { score: 10, confidence: "high", evidence: ["made up"] }, risk: { score: 10, confidence: "high", evidence: ["made up"] } },
      });
    }
    return new Response(JSON.stringify({ content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
}
const dimsA = { market: { score: 7, confidence: "high", evidence: ["a"] }, differentiation: { score: 6, confidence: "medium", evidence: ["b"] }, team: { score: 8, confidence: "high", evidence: ["c"] }, traction: { score: 5, confidence: "low", evidence: ["d"] } };

const as = (u) => { globalThis.__testUserId = u; };
const ctx = { params: Promise.resolve({ id: "pr" }) };

test("report job writes chapters + a code-computed executive summary and a snapshot", async () => {
  dims = dimsA; stub(); jobs.configureWorker({ handlers });
  jobs.submitReport({ projectId: "pr", userId: "alice" });
  await jobs.whenIdle();

  const s = db.getProjectById("pr").state;
  assert.deepEqual(Object.keys(s.docChapters).sort(), ["p2", "p3", "p8"], "only passes with approved results, skipped methods excluded");
  assert.match(s.docChapters.p2, /Body for Market sizing/);
  assert.ok(!JSON.stringify(seenPrompts).includes("skipped analysis"), "skipped method never reaches the writer");

  const exec = s.docExecSummary;
  const expected = computeScore({ ...dimsA });
  assert.equal(exec.score, expected.score, "score comes from code, not the model's claim");
  assert.equal(exec.verdict, expected.verdict);
  assert.equal(exec.score_breakdown.find(d => d.id === "business_model").score, null, "hallucinated score for an unrun pass is discarded");
  assert.equal(exec.score_breakdown.find(d => d.id === "risk").score, null);
  assert.equal(exec.score_coverage, 0.75);
  assert.equal("dimension_scores" in exec, false);

  const execPrompt = seenPrompts.find(p => p.system.includes("finalising")).messages[0].content;
  assert.match(execPrompt, /COMPUTED FINANCIAL MODEL/);
  assert.match(execPrompt, /LTV/);
  assert.equal(runs.listSnapshots("pr").length, 1);
});

test("a second report records a snapshot with the score delta and per-dimension changes", async () => {
  dims = { ...dimsA, team: { score: 9, confidence: "high", evidence: ["better"] } }; stub();
  jobs.submitReport({ projectId: "pr", userId: "alice" });
  await jobs.whenIdle();
  const snaps = runs.listSnapshots("pr");
  assert.equal(snaps.length, 2);
  assert.ok(snaps[0].delta > 0);
  assert.deepEqual(snaps[0].dimensionChanges, [{ id: "team", from: 8, to: 9 }]);
  assert.equal(snaps[1].delta, null, "the first report has nothing to compare with");
});

test("report with no completed analyses fails with a clear message and leaves no half-written report", async () => {
  db.createProject({ id: "empty", name: "e", userId: "alice" });
  jobs.submitReport({ projectId: "empty", userId: "alice" });
  await jobs.whenIdle();
  const job = runs.latestJob("empty", "__report__");
  assert.equal(job.status, "error");
  assert.match(job.error, /run at least one analysis/);
  assert.equal(db.getProjectById("empty").state.docExecSummary, undefined);
  assert.equal(runs.listRuns("empty").length, 0, "no phantom method run for the pseudo-method");
});

test("routes: auth, 202 start, status polling, 409 while running, full payload when done", async () => {
  as(null);
  assert.equal((await route.GET(new Request("http://x/r"), ctx)).status, 401);
  as("mallory");
  assert.equal((await route.POST(new Request("http://x/r", { method: "POST" }), ctx)).status, 404);

  as("alice");
  dims = dimsA; stub();
  // slow chapters so we can observe the running state
  const orig = globalThis.fetch;
  globalThis.fetch = async (...a) => { await new Promise(r => setTimeout(r, 60)); return orig(...a); };
  jobs.configureWorker({ handlers });
  const start = await route.POST(new Request("http://x/r", { method: "POST" }), ctx);
  assert.equal(start.status, 202);
  assert.equal((await route.POST(new Request("http://x/r", { method: "POST" }), ctx)).status, 409);
  const running = await (await route.GET(new Request("http://x/r"), ctx)).json();
  assert.equal(running.status, "running");
  assert.match(running.progress, /chapters|Starting|executive/i);
  assert.equal("chapters" in running, false, "polling payload stays small");

  await jobs.whenIdle();
  const done = await (await route.GET(new Request("http://x/r?full=1"), ctx)).json();
  assert.equal(done.status, "done");
  assert.ok(done.chapters.p2 && done.execSummary.verdict);
  assert.equal(done.snapshots.length, 3);
});

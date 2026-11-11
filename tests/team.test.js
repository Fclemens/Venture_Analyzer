import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-team-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "56".repeat(32);

const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const jobs = await import("../lib/jobs.js");
const { handlers } = await import("../lib/job-handlers.js");
const projectsRoute = await import("../app/api/projects/route.js");
const projectRoute = await import("../app/api/projects/[id]/route.js");
const runsRoute = await import("../app/api/projects/[id]/runs/route.js");
const commentsRoute = await import("../app/api/projects/[id]/comments/route.js");
const exportRoute = await import("../app/api/projects/[id]/export/route.js");
const compareRoute = await import("../app/api/compare/route.js");

after(() => { jobs.stopWorker(); fs.rmSync(dir, { recursive: true, force: true }); });
const realFetch = globalThis.fetch;

const as = (user, org = null) => { globalThis.__testUserId = user; globalThis.__testOrgId = org; };
globalThis.__testNames = { alice: "Alice Owner", bob: "Bob Member" };
const ctx = { params: Promise.resolve({ id: "deal" }) };
const req = (url, init) => new Request("http://x" + url, init);
const json = (r) => r.json();
const put = (body) => projectRoute.PUT(req("/p", { method: "PUT", body: JSON.stringify(body) }), ctx);
const post = (body) => runsRoute.POST(req("/r", { method: "POST", body: JSON.stringify(body) }), ctx);
const comment = (body) => commentsRoute.POST(req("/c", { method: "POST", body: JSON.stringify(body) }), ctx);

db.createProject({ id: "deal", name: "Deal", userId: "alice" });
db.updateProject("deal", "alice", { state: { p0: { venture_name: "Acme" }, corpusText: "deck" } });

test("a private deal is invisible to teammates, other orgs, and users without an org", async () => {
  for (const [u, o] of [["bob", "orgA"], ["carol", "orgB"], ["dave", null]]) {
    as(u, o);
    assert.equal((await runsRoute.GET(req("/r"), ctx)).status, 404, `${u} runs`);
    assert.equal((await projectRoute.GET(req("/p"), ctx)).status, 404, `${u} project`);
    assert.equal((await commentsRoute.GET(req("/c"), ctx)).status, 404, `${u} comments`);
    assert.equal((await exportRoute.GET(req("/e?format=md"), ctx)).status, 404, `${u} export`);
    assert.deepEqual(await json(await projectsRoute.GET()), [], `${u} list`);
  }
});

test("only the owner can share, and sharing needs an active organization", async () => {
  as("alice", null);
  assert.equal((await put({ shared: true })).status, 400, "no organization selected");
  as("bob", "orgA");
  assert.equal((await put({ shared: true })).status, 404, "a stranger can't even tell it exists");

  as("alice", "orgA");
  assert.equal((await put({ shared: true })).status, 200);
  const list = await json(await projectsRoute.GET());
  assert.equal(list[0].shared, true);
  assert.equal(list[0].is_owner, true);
});

test("org members can view, edit state, run, comment and export; others still cannot", async () => {
  as("bob", "orgA");
  const got = await json(await projectRoute.GET(req("/p"), ctx));
  assert.equal(got.role, "member");
  assert.equal(got.state.p0.venture_name, "Acme");

  const list = await json(await projectsRoute.GET());
  assert.deepEqual(list.map(p => [p.id, p.is_owner, p.shared]), [["deal", false, true]]);

  assert.equal((await put({ state: { methodNotes: { team_assessment: "bob's note" } } })).status, 200, "members can edit");
  assert.equal(db.getProjectById("deal").state.methodNotes.team_assessment, "bob's note");
  assert.equal((await exportRoute.GET(req("/e?format=md"), ctx)).status, 200);

  for (const [u, o] of [["carol", "orgB"], ["dave", null], ["erin", "orgA-other"]]) {
    as(u, o);
    assert.equal((await projectRoute.GET(req("/p"), ctx)).status, 404, u);
    assert.equal((await post({ action: "extract", methodId: "team_assessment" })).status, 404, u);
  }
});

test("members cannot delete or change sharing; owner can", async () => {
  as("bob", "orgA");
  assert.equal((await put({ shared: false })).status, 403);
  assert.equal((await projectRoute.DELETE(req("/p"), ctx)).status, 403);
  assert.equal(db.projectAccess("deal", "alice"), "owner", "still there");
});

test("a teammate's run uses THEIR OWN API key, not the owner's", async () => {
  const settingsFor = (key) => ({ providers: { anthropic: { apiKey: key, enabled: true } }, roles: { fast: { provider: "anthropic", model: "claude-haiku-5-5" }, smart: { provider: "anthropic", model: "claude-sonnet-5-5" } } });
  db.saveSettings("alice", settingsFor("sk-alice"));
  db.saveSettings("bob", settingsFor("sk-bob"));
  const keys = [];
  globalThis.fetch = async (_u, init) => {
    keys.push(init.headers["x-api-key"]);
    return new Response(JSON.stringify({ content: [{ type: "text", text: '{"methodology":"team_assessment","evidence_quality":"low","extracted_evidence":[],"gaps":[],"conflicts":[]}' }], stop_reason: "end_turn", usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    jobs.configureWorker({ handlers });
    as("bob", "orgA");
    assert.equal((await post({ action: "extract", methodId: "team_assessment" })).status, 202);
    await jobs.whenIdle();
    assert.deepEqual(keys, ["sk-bob"]);
    assert.equal(runs.getRun("deal", "team_assessment").status, "extracted", "the member's job could read the owner's project");
  } finally { globalThis.fetch = realFetch; }
});

test("comments: author names come from the server, deal-level vs method-level, only authors delete", async () => {
  as("bob", "orgA");
  assert.equal((await comment({ body: "   " })).status, 400);
  assert.equal((await comment({ body: "x", methodId: "nope" })).status, 400);
  const c1 = await json(await comment({ body: "Deal-level: looks promising" }));
  const c2 = await json(await comment({ body: "Check the CTO", methodId: "team_assessment" }));
  // a spoofed author in the request body is ignored
  await comment({ body: "spoof", authorName: "The CEO", author_name: "The CEO" });

  as("alice", "orgA");
  const all = await json(await commentsRoute.GET(req("/c"), ctx));
  assert.equal(all.comments.length, 3);
  assert.equal(all.comments[0].author_name, "Bob Member");
  assert.ok(all.comments.every(c => c.author_name !== "The CEO"));
  assert.equal("user_id" in all.comments[0], false, "user ids are not exposed");
  assert.deepEqual(all.counts, { _project: 2, team_assessment: 1 });
  const onlyMethod = await json(await commentsRoute.GET(req("/c?method=team_assessment"), ctx));
  assert.deepEqual(onlyMethod.comments.map(c => c.body), ["Check the CTO"]);
  const onlyDeal = await json(await commentsRoute.GET(req("/c?method="), ctx));
  assert.equal(onlyDeal.comments.length, 2);

  assert.equal((await commentsRoute.DELETE(req(`/c?id=${c2.id}`, { method: "DELETE" }), ctx)).status, 404, "owner can't delete a teammate's comment");
  as("bob", "orgA");
  assert.equal((await commentsRoute.DELETE(req(`/c?id=${c1.id}`, { method: "DELETE" }), ctx)).status, 200);
  assert.equal(runs.listComments("deal").length, 2);
});

test("compare shows shared deals to teammates, marked as not theirs", async () => {
  as("bob", "orgA");
  db.updateProject("deal", "bob", { state: { docExecSummary: { verdict: "Invest", score: "7.6/10", score_breakdown: [] } } }, "orgA");
  const data = await json(await compareRoute.GET());
  const d = data.deals.find(x => x.id === "deal");
  assert.equal(d.shared, true);
  assert.equal(d.mine, false);
  as("carol", "orgB");
  assert.deepEqual((await json(await compareRoute.GET())).deals, []);
});

test("unsharing revokes access immediately; deleting the owner's account removes the shared deal and its comments", async () => {
  as("alice", "orgA");
  assert.equal((await put({ shared: false })).status, 200);
  as("bob", "orgA");
  assert.equal((await projectRoute.GET(req("/p"), ctx)).status, 404);
  assert.equal((await commentsRoute.POST(req("/c", { method: "POST", body: JSON.stringify({ body: "late" }) }), ctx)).status, 404);

  db.deleteUserData("alice");
  assert.equal(db.getProjectById("deal"), null);
  assert.equal(runs.listComments("deal").length, 0);
});

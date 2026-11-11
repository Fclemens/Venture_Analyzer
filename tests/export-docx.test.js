import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import mammoth from "mammoth";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-exp-"));
process.env.VENTURE_DATA_DIR = dir;
process.env.ENCRYPTION_KEY = "12".repeat(32);

const { buildDocx, buildMarkdown, markdownToDocx } = await import("../lib/export-docx.js");
const db = await import("../lib/db.js");
const runs = await import("../lib/runs.js");
const route = await import("../app/api/projects/[id]/export/route.js");
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const exec = {
  verdict: "Conditional Invest", score: "6.5/10", score_rationale: "Weighted over 100%", investment_thesis: "A wedge into X.",
  executive_summary: "First paragraph with **bold** claim.\n\n## Sub heading\n\n- bullet one\n- bullet two",
  strongest_findings: ["Finding A"], key_risks: ["Risk B"], tensions: ["P2 vs P3"], founder_questions: ["Who is the CTO?"], recommendation: "Proceed to diligence.",
  score_breakdown: [{ label: "Market", weight: 0.2, score: 7, confidence: "high", evidence: ["TAM €2bn"] }],
};
const chapters = { p2: "## Market sizing\n\nThe market is **large**.\n\n| Segment | Size |\n|---|---|\n| EU | €2bn |\n| US | €5bn |\n\n1. step one\n2. step two\n\n> quoted note" };
const passDefs = [{ id: "p2", num: 2, title: "Market sizing" }];

test("markdown converts to the right docx block types", () => {
  const blocks = markdownToDocx("# H1\n\ntext **b**\n\n- a\n- b\n\n| x | y |\n|---|---|\n| 1 | 2 |\n\n---\n\n> q");
  assert.equal(blocks.length, 8); // heading, para, 2 bullets, table, spacer after table, hr, quote
});

test("docx contains the report text, headings, table cells and lists (round-trip through mammoth)", async () => {
  const buf = await buildDocx({ p0: { venture_name: "Acme", stage: "seed" }, execSummary: exec, chapters, passDefs, finDigest: "Unit economics: LTV €1,600", appendix: [{ title: "Team assessment", text: "Strong CEO." }] });
  assert.ok(buf.length > 4000);
  const html = (await mammoth.convertToHtml({ buffer: buf })).value;
  const text = (await mammoth.extractRawText({ buffer: buf })).value;
  for (const needle of ["Acme", "Conditional Invest", "6.5/10", "A wedge into X.", "Finding A", "Risk B", "P2 vs P3", "Who is the CTO?", "Proceed to diligence.", "LTV €1,600", "Strong CEO.", "TAM €2bn"]) {
    assert.ok(text.includes(needle), "missing: " + needle);
  }
  assert.match(html, /<table>[\s\S]*EU[\s\S]*€2bn[\s\S]*<\/table>/, "markdown table became a real table");
  assert.match(html, /<h1>.*Market sizing/);
  assert.match(html, /<strong>large<\/strong>/);
  assert.match(html, /<li>.*bullet one/);
});

test("markdown export is faithful", () => {
  const md = buildMarkdown({ p0: { venture_name: "Acme" }, execSummary: exec, chapters, passDefs, finDigest: "Line A\nLine B" });
  assert.match(md, /^# Acme/);
  assert.match(md, /\| Market \| 20% \| 7 \| high \| TAM €2bn \|/);
  assert.match(md, /- Line B/);
  assert.match(md, /# P2 · Market sizing/);
});

test("export route: auth, ownership, format validation and downloads", async () => {
  db.createProject({ id: "pe", name: "Acme analysis", userId: "alice" });
  db.updateProject("pe", "alice", { state: { p0: { venture_name: "Acme Inc" }, docExecSummary: exec, docChapters: chapters, methods: [{ id: "team_assessment", name: "Team", pass: "p8", decision: "run" }],
    finModel: { currency: "EUR", assumptions: { arpa_month: { value: 100 }, gross_margin_pct: { value: 80 }, cac: { value: 400 }, monthly_churn_pct: { value: 5 }, new_customers_start: { value: 50 }, fixed_costs_month: { value: 10000 }, cash_start: { value: 100000 } } } } });
  runs.saveRun("pe", "team_assessment", { status: "done", result: "Strong CEO." });

  const call = (qs = "") => route.GET(new Request("http://x/api/projects/pe/export" + qs), { params: Promise.resolve({ id: "pe" }) });
  globalThis.__testUserId = null;
  assert.equal((await call("?format=docx")).status, 401);
  globalThis.__testUserId = "mallory";
  assert.equal((await call("?format=docx")).status, 404);

  globalThis.__testUserId = "alice";
  assert.equal((await call("?format=exe")).status, 400);
  const docx = await call("?format=docx&appendix=1");
  assert.equal(docx.status, 200);
  assert.match(docx.headers.get("content-disposition"), /Acme-Inc\.docx/);
  assert.ok((await mammoth.extractRawText({ buffer: Buffer.from(await docx.arrayBuffer()) })).value.includes("Strong CEO."));
  const xlsx = await call("?format=xlsx");
  assert.equal(xlsx.headers.get("content-type"), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  assert.ok((await xlsx.arrayBuffer()).byteLength > 3000);
  assert.match(await (await call("?format=md")).text(), /Acme Inc/);
});

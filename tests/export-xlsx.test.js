import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import ExcelJS from "exceljs";
import { buildWorkbook } from "../lib/export-xlsx.js";
import { runModel } from "../lib/finmodel.js";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "va-xlsx-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const finModel = {
  currency: "EUR",
  assumptions: {
    arpa_month: { value: 100, source: "deck p4", confidence: "medium" }, gross_margin_pct: { value: 80 }, cac: { value: 400 },
    monthly_churn_pct: { value: 5 }, new_customers_start: { value: 50 }, new_customers_growth_pct: { value: 3 },
    customers_start: { value: 10 }, fixed_costs_month: { value: 10000 }, fixed_costs_growth_pct: { value: 1 },
    cash_start: { value: 100000 }, raise_amount: { value: 300000, edited: true }, raise_month: { value: 6 },
  },
};
const exec = { verdict: "Conditional Invest", score: "6.5/10", score_rationale: "r", investment_thesis: "t", recommendation: "go", strongest_findings: ["f"], key_risks: ["k"], tensions: [], founder_questions: ["q1"], score_breakdown: [{ label: "Market", weight: 0.2, score: 7, confidence: "high", evidence: ["TAM"] }] };

test("workbook has the expected sheets and carries cached model values", async () => {
  const buf = await buildWorkbook({ p0: { venture_name: "Acme", stage: "seed", classification: { business_model: "b2b" } }, execSummary: exec, finModel,
    entities: { competitors: ["A", "B"], partners: [] }, sources: [{ type: "web_discovered", name: "x.com", retrievedBy: "m" }], methods: [{ id: "m", name: "M", pass: "p2", decision: "run" }], runs: { m: { status: "done" } } });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  assert.deepEqual(wb.worksheets.map(w => w.name), ["Summary", "Analyses", "Entities", "Sources", "Assumptions", "Model Base", "Model Bear", "Model Bull"]);
  const base = runModel(finModel.assumptions).scenarios.base;
  const sheet = wb.getWorksheet("Model Base");
  assert.ok(Math.abs(sheet.getCell("B7").value.result - base.summary.lowestCash) < 1e-6);
  assert.equal(typeof sheet.getCell("D12").value.formula, "string", "model cells are live formulas");
  assert.equal(wb.getWorksheet("Summary").getCell("B5").value, "Conditional Invest");
});

// LibreOffice is the independent spreadsheet engine used to check the formulas.
// On a developer machine without it the test is skipped (with a note); in CI it
// is installed by the workflow, so a missing binary there is a real failure.
const hasSoffice = (() => { try { execFileSync("soffice", ["--version"], { stdio: "ignore", timeout: 60000 }); return true; } catch { return false; } })();

test("Excel/LibreOffice recalculation of the formulas reproduces the JavaScript model exactly", async (t) => {
  if (!hasSoffice) {
    if (process.env.CI) assert.fail("LibreOffice (soffice) is required in CI to verify the Excel formulas - install libreoffice-calc in the workflow");
    t.skip("soffice not installed - skipping the independent formula recalculation check");
    return;
  }
  // Build WITHOUT cached values so the spreadsheet engine must compute everything itself
  const buf = await buildWorkbook({ finModel }, { cacheResults: false });
  const src = path.join(dir, "model.xlsx");
  fs.writeFileSync(src, buf);
  execFileSync("soffice", ["--headless", "--calc", "--convert-to", "xlsx:Calc MS Excel 2007 XML", "--outdir", path.join(dir, "out"), src], { stdio: "ignore", timeout: 120000, env: { ...process.env, HOME: dir } });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(path.join(dir, "out", "model.xlsx"));

  const js = runModel(finModel.assumptions);
  // LibreOffice omits the cached value when a formula evaluates to exactly 0 / empty text
  const val = (c) => (c && typeof c === "object" && "formula" in c ? (c.result ?? 0) : c);
  for (const [name, sheetName] of [["base", "Model Base"], ["bear", "Model Bear"], ["bull", "Model Bull"]]) {
    const ws = wb.getWorksheet(sheetName);
    const sc = js.scenarios[name];
    for (let i = 0; i < sc.rows.length; i++) {
      const r = 12 + i;
      for (const [col, key] of [["B", "newCustomers"], ["C", "customers"], ["D", "revenue"], ["E", "grossProfit"], ["F", "acquisition"], ["G", "fixed"], ["H", "operating"], ["I", "funding"], ["J", "cash"]]) {
        const got = Number(val(ws.getCell(`${col}${r}`).value));
        assert.ok(Math.abs(got - sc.rows[i][key]) < 1e-6 * Math.max(1, Math.abs(sc.rows[i][key])), `${sheetName} ${col}${r}: sheet ${got} vs js ${sc.rows[i][key]}`);
      }
    }
    const s = sc.summary;
    assert.ok(Math.abs(Number(val(ws.getCell("B8").value)) - s.fundingGap) < 1e-6, `${name} funding gap`);
    assert.equal(val(ws.getCell("B5").value), s.breakevenMonth ?? "none", `${name} breakeven`);
    assert.equal(val(ws.getCell("B6").value), s.outOfCashMonth ?? "never", `${name} out-of-cash`);
  }
  // Unit economics block on the Assumptions sheet
  const A = wb.getWorksheet("Assumptions");
  let ltv = null, ratio = null;
  A.eachRow(r => { if (r.getCell(1).value === "LTV") ltv = val(r.getCell(2).value); if (r.getCell(1).value === "LTV / CAC") ratio = val(r.getCell(2).value); });
  assert.ok(Math.abs(ltv - js.unit.ltv) < 1e-6);
  assert.ok(Math.abs(ratio - js.unit.ltvToCac) < 1e-9);
});

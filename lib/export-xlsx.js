// Excel export. The financial model is written as LIVE FORMULAS (not pasted
// values) so an analyst can change any assumption in Excel and see the model
// react. Cached results are also stored so viewers that don't recalculate
// (previews, some mobile apps) still show numbers.

import ExcelJS from "exceljs";
import { ASSUMPTION_FIELDS, DEFAULT_SCENARIOS, HORIZON_MONTHS, runModel, normalizeAssumptions } from "./finmodel.js";

const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF111827" } } };
const INPUT_FILL = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF7D6" } };
const colLetter = (n) => { let s = ""; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };

function styleHeader(row) { row.eachCell(c => { c.font = HEAD.font; c.fill = HEAD.fill; c.alignment = { vertical: "middle", wrapText: true }; }); }

function addTable(ws, header, rows, widths) {
  styleHeader(ws.addRow(header));
  rows.forEach(r => ws.addRow(r));
  widths?.forEach((w, i) => { ws.getColumn(i + 1).width = w; });
  ws.eachRow(r => r.eachCell(c => { c.alignment = { vertical: "top", wrapText: true }; }));
}

function summarySheet(wb, { p0, execSummary }) {
  const ws = wb.addWorksheet("Summary");
  ws.getColumn(1).width = 26; ws.getColumn(2).width = 90;
  ws.addRow([p0?.venture_name || "Venture analysis"]).font = { bold: true, size: 16 };
  ws.addRow(["Generated", new Date().toISOString().slice(0, 10)]);
  ws.addRow(["Stage / model", [p0?.stage, p0?.classification?.business_model?.toUpperCase()].filter(Boolean).join(" · ")]);
  if (execSummary) {
    ws.addRow([]);
    ws.addRow(["Verdict", execSummary.verdict]).font = { bold: true };
    ws.addRow(["Score", execSummary.score]);
    ws.addRow(["Basis", execSummary.score_rationale || ""]);
    ws.addRow(["Thesis", execSummary.investment_thesis || ""]);
    ws.addRow(["Recommendation", execSummary.recommendation || ""]);
    ws.addRow([]);
    if (execSummary.score_breakdown?.length) {
      styleHeader(ws.addRow(["Dimension", "Weight · Score · Confidence · Basis"]));
      execSummary.score_breakdown.forEach(d => ws.addRow([d.label, `${Math.round(d.weight * 100)}% · ${d.score ?? "n/a"} · ${d.confidence || "-"} · ${(d.evidence || []).join("; ")}`]));
      ws.addRow([]);
    }
    for (const [title, list] of [["Key findings", execSummary.strongest_findings], ["Key risks", execSummary.key_risks], ["Tensions across passes", execSummary.tensions], ["Questions for the founders", execSummary.founder_questions]]) {
      if (!list?.length) continue;
      styleHeader(ws.addRow([title, ""]));
      list.forEach((t, i) => ws.addRow([i + 1, t]));
      ws.addRow([]);
    }
  }
  ws.eachRow(r => r.eachCell(c => { c.alignment = { vertical: "top", wrapText: true }; }));
}

// ── Financial model with live formulas ───────────────────────────────────────
function modelSheets(wb, finModel, cacheResults) {
  const scenarios = finModel.scenarios || DEFAULT_SCENARIOS;
  const model = runModel(finModel.assumptions, scenarios);
  const { values } = normalizeAssumptions(finModel.assumptions);
  const A = wb.addWorksheet("Assumptions");
  A.getColumn(1).width = 44; A.getColumn(2).width = 16; A.getColumn(3).width = 12; A.getColumn(4).width = 70;
  A.addRow(["Yellow cells are inputs — change them and the model sheets recalculate."]).font = { italic: true };
  A.addRow(["Currency", finModel.currency || ""]);
  styleHeader(A.addRow(["Assumption", "Value", "Unit", "Source / confidence"]));

  const cell = {}; // field id → absolute address on the Assumptions sheet
  for (const f of ASSUMPTION_FIELDS) {
    const a = finModel.assumptions?.[f.id] || {};
    const r = A.addRow([f.label, values[f.id] ?? null, f.unit, [a.source, a.confidence && `(${a.confidence})`, a.edited && "edited by user"].filter(Boolean).join(" ")]);
    r.getCell(2).fill = INPUT_FILL;
    cell[f.id] = `Assumptions!$B$${r.number}`;
  }

  A.addRow([]);
  styleHeader(A.addRow(["Scenario multipliers (vs base)", "New customers", "Churn", "Price", "CAC"]));
  A.getColumn(5).width = 12;
  const mult = {};
  for (const name of ["bear", "base", "bull"]) {
    const m = { ...DEFAULT_SCENARIOS.base, ...scenarios[name] };
    const r = A.addRow([name[0].toUpperCase() + name.slice(1), m.new_customers, m.churn, m.arpa, m.cac]);
    for (let c = 2; c <= 5; c++) r.getCell(c).fill = INPUT_FILL;
    mult[name] = { nc: `Assumptions!$B$${r.number}`, ch: `Assumptions!$C$${r.number}`, ar: `Assumptions!$D$${r.number}`, cc: `Assumptions!$E$${r.number}` };
  }

  // Unit economics (formulas)
  A.addRow([]);
  styleHeader(A.addRow(["Unit economics", "Value", "", ""]));
  const ue = model.ok ? model.unit : null;
  const put = (label, formula, result) => {
    const r = A.addRow([label, cacheResults && result !== undefined && result !== null ? { formula, result } : { formula }]);
    r.getCell(2).numFmt = "#,##0.00";
  };
  const gp = `${cell.arpa_month}*${cell.gross_margin_pct}/100`;
  put("Monthly gross profit per customer", gp, ue?.monthlyGrossProfit);
  put("Customer lifetime (months)", `IF(${cell.monthly_churn_pct}=0,"n/a",100/${cell.monthly_churn_pct})`, ue?.lifetimeMonths);
  put("LTV", `IF(${cell.monthly_churn_pct}=0,"n/a",(${gp})*100/${cell.monthly_churn_pct})`, ue?.ltv);
  put("LTV / CAC", `IF(OR(${cell.monthly_churn_pct}=0,${cell.cac}=0),"n/a",((${gp})*100/${cell.monthly_churn_pct})/${cell.cac})`, ue?.ltvToCac);
  put("CAC payback (months)", `IF((${gp})=0,"n/a",${cell.cac}/(${gp}))`, ue?.paybackMonths);

  // One sheet per scenario
  for (const name of ["base", "bear", "bull"]) {
    const sc = mult[name];
    const ws = wb.addWorksheet(`Model ${name[0].toUpperCase() + name.slice(1)}`);
    const proj = model.ok ? model.scenarios[name] : null;
    ws.addRow([`${name.toUpperCase()} scenario — monthly projection (formulas reference the Assumptions sheet)`]).font = { bold: true };
    const FIRST = 12, LAST = FIRST + HORIZON_MONTHS - 1;
    // Results block (rows 3-9)
    const res = (row, label, formula, result, fmt = "#,##0") => {
      ws.getCell(`A${row}`).value = label;
      ws.getCell(`B${row}`).value = cacheResults && result !== undefined && result !== null ? { formula, result } : { formula };
      ws.getCell(`B${row}`).numFmt = fmt;
    };
    const s = proj?.summary;
    res(3, "Revenue / month at month 12", `D${FIRST + 11}`, s?.revenueM12);
    res(4, `Revenue / month at month ${HORIZON_MONTHS}`, `D${LAST}`, s?.revenueM36);
    res(5, "Breakeven month (first month operating ≥ 0)", `IF(COUNT(K${FIRST}:K${LAST})=0,"none",MIN(K${FIRST}:K${LAST}))`, s?.breakevenMonth ?? "none", "0");
    res(6, "Month cash first goes negative", `IF(COUNT(L${FIRST}:L${LAST})=0,"never",MIN(L${FIRST}:L${LAST}))`, s?.outOfCashMonth ?? "never", "0");
    res(7, "Lowest cash balance", `MIN(J${FIRST}:J${LAST})`, s?.lowestCash);
    res(8, "Funding gap (extra cash needed)", `MAX(0,-MIN(J${FIRST}:J${LAST}))`, s?.fundingGap);

    styleHeader(ws.addRow([])); // placeholder to keep numbering stable
    ws.getRow(FIRST - 1).values = ["Month", "New customers", "Customers", "Revenue", "Gross profit", "Acquisition cost", "Fixed costs", "Operating result", "Funding", "Cash", "Breakeven flag", "Out-of-cash flag"];
    styleHeader(ws.getRow(FIRST - 1));
    ws.getRow(FIRST - 1).height = 30;
    const churn = `MIN(1,${cell.monthly_churn_pct}/100*${sc.ch})`;
    for (let i = 0; i < HORIZON_MONTHS; i++) {
      const r = FIRST + i;
      const prev = r - 1;
      const f = {
        A: i + 1,
        B: `${cell.new_customers_start}*${sc.nc}*(1+${cell.new_customers_growth_pct}/100)^(A${r}-1)`,
        C: i === 0 ? `${cell.customers_start}*(1-${churn})+B${r}` : `C${prev}*(1-${churn})+B${r}`,
        D: `C${r}*${cell.arpa_month}*${sc.ar}`,
        E: `D${r}*${cell.gross_margin_pct}/100`,
        F: `B${r}*${cell.cac}*${sc.cc}`,
        G: `${cell.fixed_costs_month}*(1+${cell.fixed_costs_growth_pct}/100)^(A${r}-1)`,
        H: `E${r}-F${r}-G${r}`,
        I: `IF(A${r}=ROUND(${cell.raise_month},0),${cell.raise_amount},0)`,
        J: i === 0 ? `${cell.cash_start}+H${r}+I${r}` : `J${prev}+H${r}+I${r}`,
        K: `IF(H${r}>=0,A${r},"")`,
        L: `IF(J${r}<0,A${r},"")`,
      };
      const row = proj?.rows[i];
      const cached = row && { B: row.newCustomers, C: row.customers, D: row.revenue, E: row.grossProfit, F: row.acquisition, G: row.fixed, H: row.operating, I: row.funding, J: row.cash, K: row.operating >= 0 ? row.month : "", L: row.cash < 0 ? row.month : "" };
      for (const [col, val] of Object.entries(f)) {
        const c = ws.getCell(`${col}${r}`);
        if (col === "A") c.value = val;
        else c.value = cacheResults && cached ? { formula: val, result: cached[col] } : { formula: val };
        if (col !== "A" && col !== "K" && col !== "L") c.numFmt = "#,##0";
      }
    }
    for (let c = 1; c <= 12; c++) ws.getColumn(c).width = c === 1 ? 44 : 16;
    ws.views = [{ state: "frozen", ySplit: FIRST - 1 }];
  }
  return { cellMap: cell };
}

export async function buildWorkbook({ p0, execSummary, finModel, entities, sources = [], methods = [], runs = {}, methodSummaries = {} }, { cacheResults = true } = {}) {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Venture Analyzer";
  wb.created = new Date();
  summarySheet(wb, { p0, execSummary });

  const rows = methods.filter(m => m.decision !== "skip").map(m => {
    const sm = methodSummaries[m.id] || {};
    return [m.pass?.toUpperCase(), m.name, runs[m.id]?.status || "pending", sm.confidence || "", sm.one_liner || "", (sm.key_insights || []).join("\n")];
  });
  if (rows.length) addTable(wb.addWorksheet("Analyses"), ["Pass", "Method", "Status", "Confidence", "One-liner", "Key insights"], rows, [8, 30, 12, 12, 50, 90]);

  if (entities) {
    const n = Math.max(entities.competitors?.length || 0, entities.partners?.length || 0, entities.markets?.length || 0, entities.people?.length || 0);
    const get = (k, i) => entities[k]?.[i] ?? "";
    if (n) addTable(wb.addWorksheet("Entities"), ["Competitors", "Partners", "Markets", "People"],
      Array.from({ length: n }, (_, i) => [get("competitors", i), get("partners", i), get("markets", i), get("people", i)]), [34, 30, 30, 30]);
  }
  if (sources.length) {
    addTable(wb.addWorksheet("Sources"), ["Type", "Name / URL", "Found by"], sources.map(s => [s.type, s.name, s.retrievedBy || ""]), [16, 80, 28]);
  }
  if (finModel && Object.keys(finModel.assumptions || {}).length) modelSheets(wb, finModel, cacheResults);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizeAssumptions, unitEconomics, project, runModel, describeModel, DEFAULT_SCENARIOS, ASSUMPTION_FIELDS } from "../lib/finmodel.js";

const base = {
  arpa_month: 100, gross_margin_pct: 80, cac: 400, monthly_churn_pct: 5,
  new_customers_start: 50, new_customers_growth_pct: 0, customers_start: 0,
  fixed_costs_month: 10000, fixed_costs_growth_pct: 0, cash_start: 100000, raise_amount: 0, raise_month: 1,
};

test("unit economics: hand-computed LTV, LTV/CAC and payback", () => {
  const u = unitEconomics(normalizeAssumptions(base).values);
  assert.equal(u.monthlyGrossProfit, 80);
  assert.equal(u.lifetimeMonths, 20);       // 1 / 5%
  assert.equal(u.ltv, 1600);                // 80 * 20
  assert.equal(u.ltvToCac, 4);              // 1600 / 400
  assert.equal(u.paybackMonths, 5);         // 400 / 80
});

test("projection matches a hand calculation for the first months", () => {
  const { rows } = project(normalizeAssumptions(base).values);
  // month 1: customers = 0*0.95 + 50 = 50; revenue 5000; GP 4000; acquisition 50*400 = 20000; fixed 10000
  assert.equal(rows[0].customers, 50);
  assert.equal(rows[0].revenue, 5000);
  assert.equal(rows[0].operating, 4000 - 20000 - 10000);
  assert.equal(rows[0].cash, 100000 - 26000);
  // month 2: customers = 50*0.95 + 50 = 97.5
  assert.ok(Math.abs(rows[1].customers - 97.5) < 1e-9);
  // steady state customers = new / churn = 1000
  assert.ok(Math.abs(rows[35].customers - 1000 * (1 - Math.pow(0.95, 36))) < 1e-6);
});

test("cash only changes by operating result plus funding in the raise month", () => {
  const v = normalizeAssumptions({ ...base, raise_amount: 500000, raise_month: 6 }).values;
  const { rows } = project(v);
  assert.equal(rows[5].funding, 500000);
  assert.equal(rows[4].funding, 0);
  assert.ok(Math.abs(rows[5].cash - (rows[4].cash + rows[5].operating + 500000)) < 1e-6);
});

test("scenarios order outcomes: bear ≤ base ≤ bull on revenue", () => {
  const m = runModel(base);
  assert.equal(m.ok, true);
  assert.ok(m.scenarios.bear.summary.revenueM36 < m.scenarios.base.summary.revenueM36);
  assert.ok(m.scenarios.base.summary.revenueM36 < m.scenarios.bull.summary.revenueM36);
});

test("breakeven, out-of-cash month and funding gap are consistent", () => {
  const m = runModel({ ...base, cash_start: 20000 });
  const s = m.scenarios.base.summary;
  assert.equal(s.outOfCashMonth, 1);                 // month 1 burn is 26k > 20k cash
  assert.ok(s.fundingGap > 0);
  assert.equal(s.fundingGap, -s.lowestCash);
  const rich = runModel({ ...base, cash_start: 10_000_000 }).scenarios.base.summary;
  assert.equal(rich.outOfCashMonth, null);
  assert.equal(rich.fundingGap, 0);
  if (rich.breakevenMonth) assert.ok(rich.breakevenMonth > 1);
});

test("missing required assumptions are reported instead of invented", () => {
  const rest = { ...base }; delete rest.cac;
  const m = runModel(rest);
  assert.equal(m.ok, false);
  assert.deepEqual(m.missing, ["cac"]);
  assert.equal(runModel({}).missing.length, ASSUMPTION_FIELDS.filter(f => f.required).length);
});

test("normalizeAssumptions accepts {value,source} objects, clamps and ignores junk", () => {
  const { values } = normalizeAssumptions({
    ...base,
    gross_margin_pct: { value: 140, source: "deck p4", confidence: "low" },
    monthly_churn_pct: "7",
    new_customers_growth_pct: "abc",
    arpa_month: -5,
  });
  assert.equal(values.gross_margin_pct, 100);
  assert.equal(values.monthly_churn_pct, 7);
  assert.equal(values.new_customers_growth_pct, 0, "non-numeric optional falls back to default");
  assert.equal(values.arpa_month, 0, "negative clamped");
});

test("zero churn and zero margin do not produce Infinity/NaN", () => {
  const m = runModel({ ...base, monthly_churn_pct: 0, gross_margin_pct: 0 });
  assert.equal(m.unit.ltv, null);
  assert.equal(m.unit.paybackMonths, null);
  for (const r of m.scenarios.base.rows) for (const k of Object.keys(r)) assert.ok(Number.isFinite(r[k]), k);
});

test("describeModel quotes computed numbers", () => {
  const text = describeModel(runModel(base), "€");
  assert.match(text, /LTV €1,600/);
  assert.match(text, /LTV\/CAC 4\.0/);
  assert.match(text, /BEAR:/);
  assert.equal(describeModel({ ok: false }), "");
  assert.ok(DEFAULT_SCENARIOS.bear.churn > 1);
});

import { sensitivity, kpiHealth } from "../lib/finmodel.js";
test("sensitivity: drivers move cash in the expected direction and are ranked by swing", () => {
  const s = sensitivity(base);
  const by = Object.fromEntries(s.rows.map(r => [r.id, r]));
  assert.ok(by.arpa_month.high > 0 && by.arpa_month.low < 0, "higher price → more cash");
  assert.ok(by.cac.high < 0 && by.cac.low > 0, "higher CAC → less cash");
  assert.ok(by.monthly_churn_pct.high < 0, "higher churn → less cash");
  assert.ok(by.fixed_costs_month.high < 0);
  for (let i = 1; i < s.rows.length; i++) assert.ok(s.rows[i - 1].swing >= s.rows[i].swing, "sorted by swing");
  assert.ok(!by.new_customers_growth_pct, "a zero-valued driver has no swing and is omitted");
  assert.equal(sensitivity({}), null, "missing essentials → no sensitivity");
});

test("kpiHealth benchmarks", () => {
  assert.equal(kpiHealth({ ltvToCac: 4, paybackMonths: 5 }).ltvToCac.tone, "good");
  assert.equal(kpiHealth({ ltvToCac: 1.5, paybackMonths: 18 }).payback.tone, "warn");
  assert.equal(kpiHealth({ ltvToCac: 0.8, paybackMonths: 30 }).ltvToCac.tone, "bad");
  assert.equal(kpiHealth({ ltvToCac: null }).ltvToCac, null);
});

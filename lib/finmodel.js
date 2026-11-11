// Deterministic financial model: unit economics + a monthly projection under
// bear / base / bull scenarios. Pure functions (no I/O, no Node APIs) so the
// browser, the server and the Excel export all use the same arithmetic.
//
// The LLM only proposes *assumptions* (with sources). Every number the user
// sees is computed here from those assumptions, which they can edit.

export const ASSUMPTION_FIELDS = [
  { id: "arpa_month",          label: "Revenue per customer / month",  unit: "currency", required: true,  min: 0 },
  { id: "gross_margin_pct",    label: "Gross margin",                  unit: "%",        required: true,  min: 0, max: 100 },
  { id: "cac",                 label: "Customer acquisition cost",     unit: "currency", required: true,  min: 0 },
  { id: "monthly_churn_pct",   label: "Monthly customer churn",        unit: "%",        required: true,  min: 0, max: 100 },
  { id: "new_customers_start", label: "New customers in month 1",      unit: "count",    required: true,  min: 0 },
  { id: "new_customers_growth_pct", label: "Monthly growth of new customers", unit: "%", required: false, min: -50, max: 200, default: 0 },
  { id: "customers_start",     label: "Customers at start",            unit: "count",    required: false, min: 0, default: 0 },
  { id: "fixed_costs_month",   label: "Fixed costs / month (team, rent, tools)", unit: "currency", required: true, min: 0 },
  { id: "fixed_costs_growth_pct", label: "Monthly growth of fixed costs", unit: "%",     required: false, min: -50, max: 100, default: 0 },
  { id: "cash_start",          label: "Cash at start",                 unit: "currency", required: true,  min: 0 },
  { id: "raise_amount",        label: "New funding raised",            unit: "currency", required: false, min: 0, default: 0 },
  { id: "raise_month",         label: "Month the funding arrives",     unit: "month",    required: false, min: 1, default: 1 },
];

export const HORIZON_MONTHS = 36;

// Multipliers applied to the base assumptions for each scenario (user-editable)
export const DEFAULT_SCENARIOS = {
  bear: { new_customers: 0.6, churn: 1.4, arpa: 0.9, cac: 1.3 },
  base: { new_customers: 1,   churn: 1,   arpa: 1,   cac: 1 },
  bull: { new_customers: 1.4, churn: 0.7, arpa: 1.1, cac: 0.8 },
};

const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

// Accepts either { id: number } or { id: { value, source, confidence } } and
// returns clamped numeric values plus the list of missing required fields.
export function normalizeAssumptions(raw = {}) {
  const values = {};
  const missing = [];
  for (const f of ASSUMPTION_FIELDS) {
    const entry = raw?.[f.id];
    let v = num(entry !== null && typeof entry === "object" ? entry.value : entry);
    if (v === null) {
      if (f.required) { missing.push(f.id); continue; }
      v = f.default ?? 0;
    }
    if (f.min !== undefined) v = Math.max(f.min, v);
    if (f.max !== undefined) v = Math.min(f.max, v);
    values[f.id] = v;
  }
  return { values, missing };
}

export function unitEconomics(v) {
  const margin = v.gross_margin_pct / 100;
  const churn = v.monthly_churn_pct / 100;
  const monthlyGrossProfit = v.arpa_month * margin;
  const lifetimeMonths = churn > 0 ? 1 / churn : null;
  const ltv = lifetimeMonths === null ? null : monthlyGrossProfit * lifetimeMonths;
  return {
    monthlyGrossProfit,
    lifetimeMonths,
    ltv,
    ltvToCac: ltv !== null && v.cac > 0 ? ltv / v.cac : null,
    paybackMonths: monthlyGrossProfit > 0 ? v.cac / monthlyGrossProfit : null,
  };
}

export function project(values, scenario = DEFAULT_SCENARIOS.base, months = HORIZON_MONTHS) {
  const v = values;
  const churn = Math.min(1, (v.monthly_churn_pct / 100) * scenario.churn);
  const arpa = v.arpa_month * scenario.arpa;
  const cac = v.cac * scenario.cac;
  const margin = v.gross_margin_pct / 100;
  const g = v.new_customers_growth_pct / 100;
  const fg = v.fixed_costs_growth_pct / 100;

  const rows = [];
  let customers = v.customers_start;
  let cash = v.cash_start;
  for (let t = 1; t <= months; t++) {
    const newCustomers = v.new_customers_start * scenario.new_customers * Math.pow(1 + g, t - 1);
    customers = customers * (1 - churn) + newCustomers;
    const revenue = customers * arpa;
    const grossProfit = revenue * margin;
    const acquisition = newCustomers * cac;
    const fixed = v.fixed_costs_month * Math.pow(1 + fg, t - 1);
    const operating = grossProfit - acquisition - fixed;
    const funding = t === Math.round(v.raise_month) ? v.raise_amount : 0;
    cash = cash + operating + funding;
    rows.push({ month: t, newCustomers, customers, revenue, grossProfit, acquisition, fixed, operating, funding, cash });
  }

  const breakeven = rows.find(r => r.operating >= 0);
  const outOfCash = rows.find(r => r.cash < 0);
  const lowest = rows.reduce((a, r) => (r.cash < a.cash ? r : a), rows[0]);
  const at = (m) => rows[Math.min(m, rows.length) - 1];
  return {
    rows,
    summary: {
      revenueM12: at(12).revenue, revenueM24: at(24).revenue, revenueM36: at(rows.length).revenue,
      arrM12: at(12).revenue * 12, arrEnd: at(rows.length).revenue * 12,
      customersEnd: at(rows.length).customers,
      breakevenMonth: breakeven ? breakeven.month : null,        // first month with operating profit ≥ 0
      outOfCashMonth: outOfCash ? outOfCash.month : null,        // first month cash < 0 (null = never)
      lowestCash: lowest.cash, lowestCashMonth: lowest.month,
      // Extra funding needed so cash never goes negative
      fundingGap: Math.max(0, -lowest.cash),
      cumulativeOperating: rows.reduce((s, r) => s + r.operating, 0),
    },
  };
}

// Full model for display/export. Returns { ok:false, missing } if essentials are absent.
export function runModel(rawAssumptions, scenarios = DEFAULT_SCENARIOS) {
  const { values, missing } = normalizeAssumptions(rawAssumptions);
  if (missing.length) return { ok: false, missing, values };
  const out = { ok: true, values, missing: [], unit: unitEconomics(values), scenarios: {} };
  for (const [name, mult] of Object.entries(scenarios)) out.scenarios[name] = project(values, { ...DEFAULT_SCENARIOS.base, ...mult });
  return out;
}

// Plain-text digest of the computed results (given to the report writer so
// the executive summary quotes computed numbers, not model-invented ones)
export function describeModel(model, currency = "") {
  if (!model?.ok) return "";
  const f = (n) => (n === null || n === undefined ? "n/a" : `${currency}${Math.round(n).toLocaleString("en-US")}`);
  const u = model.unit;
  const lines = [
    `Unit economics: LTV ${f(u.ltv)}, CAC ${f(model.values.cac)}, LTV/CAC ${u.ltvToCac === null ? "n/a" : u.ltvToCac.toFixed(1)}, payback ${u.paybackMonths === null ? "n/a" : u.paybackMonths.toFixed(1) + " months"}.`,
  ];
  for (const [name, r] of Object.entries(model.scenarios)) {
    const s = r.summary;
    lines.push(`${name.toUpperCase()}: revenue month 12 ${f(s.revenueM12)}/mo, month 36 ${f(s.revenueM36)}/mo; breakeven ${s.breakevenMonth ? "month " + s.breakevenMonth : "not within 36 months"}; ${s.outOfCashMonth ? "runs out of cash in month " + s.outOfCashMonth : "never runs out of cash"}; funding gap ${f(s.fundingGap)}.`);
  }
  return lines.join("\n");
}

"use client";
import { useMemo, useState } from "react";
import { Calculator, Loader, Sparkles, ChevronDown, ChevronRight, AlertTriangle, Download, SlidersHorizontal } from "lucide-react";
import { ASSUMPTION_FIELDS, DEFAULT_SCENARIOS, runModel, sensitivity, kpiHealth } from "@/lib/finmodel";

const money = (n, cur) => (n === null || n === undefined ? "n/a" : `${cur}${Math.round(n).toLocaleString("en-US")}`);
const short = (n) => { const a = Math.abs(n); return `${n < 0 ? "−" : ""}${a >= 1e6 ? (a / 1e6).toFixed(1) + "M" : a >= 1e3 ? Math.round(a / 1e3) + "k" : Math.round(a)}`; };
const SC = { bear: { label: "Bear", color: "#b91c1c" }, base: { label: "Base", color: "#111827" }, bull: { label: "Bull", color: "#047857" } };
const CONF = { high: "bg-emerald-100 text-emerald-800", medium: "bg-amber-100 text-amber-800", low: "bg-red-100 text-red-800" };
const TONE = { good: "border-emerald-200 bg-emerald-50/50", warn: "border-amber-200 bg-amber-50/60", bad: "border-red-200 bg-red-50/60" };
const TONE_TEXT = { good: "text-emerald-800", warn: "text-amber-800", bad: "text-red-800" };
const WHATIF = ["arpa_month", "monthly_churn_pct", "cac", "new_customers_start"];

// Push end-of-line labels apart so they never overlap (keeps their order)
function spreadLabels(items, gap, top, bottom) {
  const out = [...items].sort((a, b) => a.y - b.y).map(i => ({ ...i }));
  for (let i = 1; i < out.length; i++) if (out[i].y - out[i - 1].y < gap) out[i].y = out[i - 1].y + gap;
  const overflow = out.length ? out.at(-1).y - bottom : 0;
  if (overflow > 0) out.forEach(o => { o.y -= overflow; });
  for (let i = out.length - 2; i >= 0; i--) if (out[i + 1].y - out[i].y < gap) out[i].y = out[i + 1].y - gap;
  if (out.length && out[0].y < top) { const d = top - out[0].y; out.forEach(o => { o.y += d; }); }
  return out;
}

// Cash by month for each scenario, with the key months marked on the base line
function CashChart({ model, cur, raiseMonth }) {
  const W = 760, H = 220, L = 52, R = 70, T = 14, B = 26;
  const series = Object.entries(model.scenarios).map(([k, r]) => [k, r.rows.map(x => x.cash)]);
  const all = series.flatMap(([, v]) => v);
  const min = Math.min(0, ...all), max = Math.max(0, ...all);
  const n = series[0][1].length;
  const x = (i) => L + (i / (n - 1)) * (W - L - R);
  const y = (v) => T + (1 - (v - min) / (max - min || 1)) * (H - T - B);
  const base = model.scenarios.base.summary;
  const marks = [
    raiseMonth > 0 && raiseMonth <= n && { m: raiseMonth, label: "funding", color: "#2563eb" },
    base.breakevenMonth && { m: base.breakevenMonth, label: "breakeven", color: "#047857" },
    base.outOfCashMonth && { m: base.outOfCashMonth, label: "out of cash", color: "#b91c1c" },
  ].filter(Boolean);
  const ticks = [min, (min + max) / 2, max];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img"
      aria-label={`Cash balance by month. Base case ends at ${money(model.scenarios.base.rows.at(-1).cash, cur)}${base.outOfCashMonth ? `, runs out of cash in month ${base.outOfCashMonth}` : ""}.`}>
      {ticks.map((t, i) => <g key={i}><line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="#f3f4f6" /><text x={L - 6} y={y(t) + 3} fontSize="10" textAnchor="end" fill="#6b7280">{short(t)}</text></g>)}
      <line x1={L} x2={W - R} y1={y(0)} y2={y(0)} stroke="#9ca3af" strokeDasharray="3 3" />
      {marks.map(mk => (
        <g key={mk.label}>
          <line x1={x(mk.m - 1)} x2={x(mk.m - 1)} y1={T} y2={H - B} stroke={mk.color} strokeDasharray="2 3" opacity="0.7" />
          <text x={x(mk.m - 1) + 3} y={T + 9} fontSize="10" fill={mk.color}>{mk.label} · m{mk.m}</text>
        </g>
      ))}
      {series.map(([k, vals]) => (
        <polyline key={k} fill="none" stroke={SC[k]?.color} strokeWidth={k === "base" ? 2.25 : 1.5} strokeOpacity={k === "base" ? 1 : 0.8} points={vals.map((v, i) => `${x(i)},${y(v)}`).join(" ")} />
      ))}
      {spreadLabels(series.map(([k, vals]) => ({ k, y: y(vals.at(-1)), v: vals.at(-1) })), 13, T + 4, H - B).map(l => (
        <text key={l.k} x={W - R + 6} y={l.y + 4} fontSize="11" fill={SC[l.k]?.color} fontWeight="600">{SC[l.k]?.label} {short(l.v)}</text>
      ))}
      {[1, 12, 24, n].map(m => <text key={m} x={x(m - 1)} y={H - 8} fontSize="10" textAnchor="middle" fill="#6b7280">m{m}</text>)}
    </svg>
  );
}

// Tornado: change in month-36 cash when each assumption moves ±20%
const SHORT = { arpa_month: "Price / month", gross_margin_pct: "Gross margin", cac: "CAC", monthly_churn_pct: "Churn", new_customers_start: "New customers (m1)", new_customers_growth_pct: "Customer growth", fixed_costs_month: "Fixed costs" };
function Tornado({ sens, cur }) {
  if (!sens?.rows?.length) return null;
  const rows = sens.rows.slice(0, 6);
  const maxAbs = Math.max(...rows.flatMap(r => [Math.abs(r.low), Math.abs(r.high)]), 1);
  const W = 380, NAME = 112, VAL = 46, rowH = 26;
  const mid = NAME + (W - NAME - VAL) / 2, half = (W - NAME - VAL) / 2 - 4;
  return (
    <svg viewBox={`0 0 ${W} ${rows.length * rowH + 22}`} className="w-full" role="img" aria-label="Sensitivity of month-36 cash to each assumption">
      <line x1={mid} x2={mid} y1={0} y2={rows.length * rowH} stroke="#9ca3af" />
      {rows.map((r, i) => {
        const yy = i * rowH + 5;
        const bar = (v, color) => { const w = (Math.abs(v) / maxAbs) * half; return <rect x={v < 0 ? mid - w : mid} y={yy} width={Math.max(w, 1)} height={rowH - 10} fill={color} rx="2" />; };
        return (
          <g key={r.id}>
            <text x={NAME - 6} y={yy + 12} fontSize="11" textAnchor="end" fill="#374151">{SHORT[r.id] || r.label}</text>
            {bar(r.low, "#fca5a5")}{bar(r.high, "#6ee7b7")}
            <text x={W} y={yy + 12} fontSize="10" textAnchor="end" fill="#4b5563">±{short(r.swing / 2)}</text>
          </g>
        );
      })}
      <text x={mid} y={rows.length * rowH + 16} fontSize="10" textAnchor="middle" fill="#6b7280">month-36 cash ({cur.trim() || "currency"}) · red = 20% lower · green = 20% higher</text>
    </svg>
  );
}

export default function FinancialModel({ finModel, onChange, onPropose, proposing, hasAnalyses, exportHref }) {
  const [showMonths, setShowMonths] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const [showTable, setShowTable] = useState(true);
  const fm = finModel || { currency: "", assumptions: {}, scenarios: DEFAULT_SCENARIOS };
  const cur = fm.currency ? `${fm.currency} ` : "";
  const has = Object.keys(fm.assumptions).length > 0;
  const model = useMemo(() => runModel(fm.assumptions, fm.scenarios || DEFAULT_SCENARIOS), [fm.assumptions, fm.scenarios]);
  const sens = useMemo(() => (model.ok ? sensitivity(fm.assumptions) : null), [model.ok, fm.assumptions]);
  const health = model.ok ? kpiHealth(model.unit) : {};

  const setValue = (id, raw) => {
    const prev = fm.assumptions[id] || {};
    onChange({ ...fm, assumptions: { ...fm.assumptions, [id]: { ...prev, value: raw === "" ? null : Number(raw), edited: true } } });
  };
  const setScenario = (name, key, raw) => {
    const sc = fm.scenarios || DEFAULT_SCENARIOS;
    onChange({ ...fm, scenarios: { ...sc, [name]: { ...sc[name], [key]: Number(raw) || 0 } } });
  };

  const tiles = model.ok ? [
    ["LTV / CAC", model.unit.ltvToCac === null ? "n/a" : model.unit.ltvToCac.toFixed(1) + "×", health.ltvToCac],
    ["CAC payback", model.unit.paybackMonths === null ? "n/a" : model.unit.paybackMonths.toFixed(1) + " mo", health.payback],
    ["LTV", money(model.unit.ltv, cur), null],
    ["Customer lifetime", model.unit.lifetimeMonths === null ? "n/a" : model.unit.lifetimeMonths.toFixed(0) + " mo", null],
  ] : [];

  return (
    <div className="border border-gray-200 rounded-2xl bg-white mb-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 border-b border-gray-100">
        <Calculator size={16} className="text-gray-600" />
        <div className="mr-auto">
          <div className="text-sm font-semibold text-gray-900 whitespace-nowrap">Financial model</div>
          <div className="text-xs text-gray-500">Calculated from your assumptions — the AI only proposes inputs</div>
        </div>
        {exportHref && has && (
          <a href={exportHref} download className="whitespace-nowrap text-xs px-3 py-1.5 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 inline-flex items-center gap-1.5"
            title="Excel workbook with the model as live formulas"><Download size={12} /> Excel</a>
        )}
        <button onClick={onPropose} disabled={proposing}
          className="whitespace-nowrap text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 inline-flex items-center gap-1.5">
          {proposing ? <Loader size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {has ? "Re-propose assumptions" : "Propose assumptions"}
        </button>
      </div>

      {!has && (
        <div className="px-5 py-6 text-sm text-gray-600">
          {hasAnalyses ? "Click “Propose assumptions” to draft the model inputs from your analyses — each comes with its source. You can then edit every value." : "Run some analyses first (market, pricing, cost structure, unit economics). The proposal draws its inputs from their findings."}
        </div>
      )}

      {has && (
        <div className="p-5 space-y-5">
          {!model.ok && (
            <p className="flex items-start gap-1.5 text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2.5">
              <AlertTriangle size={14} className="mt-0.5 flex-shrink-0" />
              To run the model, enter: {model.missing.map(id => ASSUMPTION_FIELDS.find(f => f.id === id)?.label).join(", ")}.
            </p>
          )}

          {model.ok && (
            <>
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5">
                {tiles.map(([k, v, h]) => (
                  <div key={k} className={`border rounded-xl px-3.5 py-2.5 ${h ? TONE[h.tone] : "border-gray-200"}`}>
                    <div className="text-[11px] uppercase tracking-wide text-gray-600">{k}</div>
                    <div className="text-xl font-semibold text-gray-900">{v}</div>
                    {h && <div className={`text-[11px] ${TONE_TEXT[h.tone]}`}>{h.note}</div>}
                  </div>
                ))}
              </div>

              <div>
                <div className="flex items-baseline justify-between mb-1">
                  <h3 className="text-sm font-semibold text-gray-900">Cash balance, 36 months</h3>
                  <span className="text-xs text-gray-500">Bear / base / bull scenarios</span>
                </div>
                <CashChart model={model} cur={cur} raiseMonth={Math.round(model.values.raise_month)} />
              </div>

              <table className="w-full text-sm">
                <thead><tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="font-medium py-1.5">Scenario</th><th className="font-medium">Revenue/mo · m12</th><th className="font-medium">m36</th>
                  <th className="font-medium">Breakeven</th><th className="font-medium">Out of cash</th><th className="font-medium">Funding gap</th>
                </tr></thead>
                <tbody>
                  {Object.entries(model.scenarios).map(([name, r]) => (
                    <tr key={name} className="border-b border-gray-50">
                      <td className="py-2 font-semibold" style={{ color: SC[name]?.color }}>{SC[name]?.label || name}</td>
                      <td>{money(r.summary.revenueM12, cur)}</td><td>{money(r.summary.revenueM36, cur)}</td>
                      <td>{r.summary.breakevenMonth ? `month ${r.summary.breakevenMonth}` : <span className="text-gray-500">not within 36 mo</span>}</td>
                      <td className={r.summary.outOfCashMonth ? "text-red-700 font-medium" : "text-gray-500"}>{r.summary.outOfCashMonth ? `month ${r.summary.outOfCashMonth}` : "never"}</td>
                      <td className={r.summary.fundingGap > 0 ? "text-red-700" : ""}>{money(r.summary.fundingGap, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="grid lg:grid-cols-2 gap-5">
                <div className="rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-0.5 flex items-center gap-1.5"><SlidersHorizontal size={13} /> What if…</h3>
                  <p className="text-xs text-gray-500 mb-3">Drag to test an assumption; the chart and tables update instantly. Changes are saved as your edits.</p>
                  <div className="space-y-3">
                    {WHATIF.map(id => {
                      const f = ASSUMPTION_FIELDS.find(x => x.id === id);
                      const v = Number(fm.assumptions[id]?.value ?? 0);
                      const maxV = Math.max(f.unit === "%" ? 20 : 1, v * 3, 1);
                      return (
                        <label key={id} className="block">
                          <div className="flex justify-between text-xs text-gray-700 mb-0.5"><span>{f.label}</span><span className="font-semibold tabular-nums">{f.unit === "currency" ? money(v, cur) : f.unit === "%" ? `${v}%` : v}</span></div>
                          <input type="range" min={0} max={maxV} step={f.unit === "%" ? 0.1 : maxV > 1000 ? 10 : 1} value={v}
                            onChange={e => setValue(id, e.target.value)} className="w-full accent-gray-900" aria-label={f.label} />
                        </label>
                      );
                    })}
                  </div>
                </div>
                <div className="rounded-xl border border-gray-200 p-4">
                  <h3 className="text-sm font-semibold text-gray-900 mb-0.5">What matters most</h3>
                  <p className="text-xs text-gray-500 mb-2">How much month-36 cash changes if each assumption is 20% lower or higher (base case).</p>
                  <Tornado sens={sens} cur={cur} />
                </div>
              </div>
            </>
          )}

          <div>
            <button onClick={() => setShowTable(v => !v)} className="flex items-center gap-1 text-sm font-semibold text-gray-900 mb-2">
              {showTable ? <ChevronDown size={14} /> : <ChevronRight size={14} />} Assumptions
              <span className="ml-2 text-xs font-normal text-gray-500">Currency</span>
              <input value={fm.currency || ""} maxLength={4} onClick={e => e.stopPropagation()} onChange={e => onChange({ ...fm, currency: e.target.value.toUpperCase() })}
                className="w-14 px-2 py-0.5 border border-gray-200 rounded-md text-xs text-gray-800 font-normal" placeholder="EUR" aria-label="Currency" />
            </button>
            {showTable && (
              <table className="w-full text-sm">
                <tbody>
                  {ASSUMPTION_FIELDS.map(f => {
                    const a = fm.assumptions[f.id] || {};
                    const missing = f.required && (a.value === null || a.value === undefined);
                    return (
                      <tr key={f.id} className="border-t border-gray-50 align-top">
                        <td className="py-2 pr-3 text-gray-800">{f.label}{f.required && <span className="text-gray-400"> *</span>}</td>
                        <td className="py-2 pr-3 whitespace-nowrap">
                          <input type="number" value={a.value ?? ""} onChange={e => setValue(f.id, e.target.value)} aria-label={f.label}
                            className={`w-28 px-2 py-1 border rounded-md text-gray-900 ${missing ? "border-red-300 bg-red-50" : "border-gray-200"}`} />
                          <span className="ml-1 text-xs text-gray-500">{f.unit === "currency" ? fm.currency || "¤" : f.unit === "%" ? "%" : ""}</span>
                        </td>
                        <td className="py-2 text-xs text-gray-600">
                          {a.edited ? <span className="text-blue-700 font-medium">your edit</span> : (
                            <>
                              {a.confidence && <span className={`px-1.5 py-0.5 rounded-full mr-1.5 ${CONF[a.confidence]}`}>{a.confidence}</span>}
                              {a.source || (missing ? <span className="text-red-700">not supported by the analyses — enter a value</span> : "")}
                            </>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>

          {model.ok && (
            <div className="flex gap-5">
              <button onClick={() => setShowScenarios(v => !v)} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900">
                {showScenarios ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Scenario settings
              </button>
              <button onClick={() => setShowMonths(v => !v)} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900">
                {showMonths ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Monthly detail (base)
              </button>
            </div>
          )}

          {model.ok && showScenarios && (
            <table className="text-xs">
              <thead><tr className="text-left text-gray-500"><th className="pr-4 font-medium">Multiplier vs base</th><th className="pr-3 font-medium">New customers</th><th className="pr-3 font-medium">Churn</th><th className="pr-3 font-medium">Price</th><th className="font-medium">CAC</th></tr></thead>
              <tbody>
                {["bear", "base", "bull"].map(name => (
                  <tr key={name}>
                    <td className="pr-4 py-1 font-semibold" style={{ color: SC[name].color }}>{SC[name].label}</td>
                    {["new_customers", "churn", "arpa", "cac"].map(k => (
                      <td key={k} className="pr-3 py-1">
                        <input type="number" step="0.05" value={(fm.scenarios || DEFAULT_SCENARIOS)[name][k]} onChange={e => setScenario(name, k, e.target.value)}
                          aria-label={`${name} ${k}`} className="w-16 px-1.5 py-0.5 border border-gray-200 rounded-md" disabled={name === "base"} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          {model.ok && showMonths && (
            <div className="max-h-72 overflow-auto border border-gray-100 rounded-lg">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-gray-50 text-gray-600"><tr>{["Mo", "New", "Customers", "Revenue", "Gross profit", "Acquisition", "Fixed", "Operating", "Cash"].map(h => <th key={h} className="px-2 py-1.5 text-right font-medium first:text-left">{h}</th>)}</tr></thead>
                <tbody>
                  {model.scenarios.base.rows.map(r => (
                    <tr key={r.month} className="border-t border-gray-50 text-right tabular-nums">
                      <td className="px-2 py-1 text-left">{r.month}</td><td>{r.newCustomers.toFixed(0)}</td><td>{r.customers.toFixed(0)}</td>
                      <td>{money(r.revenue, "")}</td><td>{money(r.grossProfit, "")}</td><td>{money(r.acquisition, "")}</td><td>{money(r.fixed, "")}</td>
                      <td className={r.operating < 0 ? "text-red-700" : ""}>{money(r.operating, "")}</td><td className={`px-2 ${r.cash < 0 ? "text-red-700" : ""}`}>{money(r.cash, "")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

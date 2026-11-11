"use client";
import { useMemo, useState } from "react";
import { Calculator, Loader, Sparkles, ChevronDown, ChevronRight, AlertTriangle } from "lucide-react";
import { ASSUMPTION_FIELDS, DEFAULT_SCENARIOS, runModel } from "@/lib/finmodel";

const money = (n, cur) => (n === null || n === undefined ? "n/a" : `${cur}${Math.round(n).toLocaleString("en-US")}`);
const SCENARIO_STYLE = { bear: { label: "Bear", color: "#b91c1c" }, base: { label: "Base", color: "#111827" }, bull: { label: "Bull", color: "#047857" } };
const CONF = { high: "bg-emerald-100 text-emerald-700", medium: "bg-amber-100 text-amber-700", low: "bg-red-100 text-red-700" };

function CashChart({ model, cur }) {
  const W = 560, H = 140, P = 28;
  const series = Object.entries(model.scenarios).map(([k, r]) => [k, r.rows.map(x => x.cash)]);
  const all = series.flatMap(([, v]) => v);
  const min = Math.min(0, ...all), max = Math.max(0, ...all);
  const x = (i, n) => P + (i / (n - 1)) * (W - P - 6);
  const y = (v) => H - 16 - ((v - min) / (max - min || 1)) * (H - 28);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Cash balance by month under bear, base and bull scenarios; base ends at ${money(model.scenarios.base.rows.at(-1).cash, cur)}`}>
      <line x1={P} x2={W - 6} y1={y(0)} y2={y(0)} stroke="#d1d5db" strokeDasharray="3 3" />
      <text x={2} y={y(0) + 3} fontSize="8" fill="#6b7280">0</text>
      {series.map(([k, vals]) => (
        <g key={k}>
          <polyline fill="none" stroke={SCENARIO_STYLE[k]?.color || "#6b7280"} strokeWidth="1.6" points={vals.map((v, i) => `${x(i, vals.length)},${y(v)}`).join(" ")} />
          <text x={W - 6} y={y(vals.at(-1)) - 3} fontSize="9" textAnchor="end" fill={SCENARIO_STYLE[k]?.color}>{SCENARIO_STYLE[k]?.label}</text>
        </g>
      ))}
      <text x={P} y={H - 2} fontSize="8" fill="#6b7280">month 1</text>
      <text x={W - 6} y={H - 2} fontSize="8" textAnchor="end" fill="#6b7280">month {series[0][1].length}</text>
    </svg>
  );
}

// Editable assumptions → deterministic projection. The LLM only proposes inputs.
export default function FinancialModel({ finModel, onChange, onPropose, proposing, hasAnalyses, exportHref }) {
  const [showMonths, setShowMonths] = useState(false);
  const [showScenarios, setShowScenarios] = useState(false);
  const fm = finModel || { currency: "", assumptions: {}, scenarios: DEFAULT_SCENARIOS };
  const cur = fm.currency ? `${fm.currency} ` : "";
  const model = useMemo(() => runModel(fm.assumptions, fm.scenarios || DEFAULT_SCENARIOS), [fm.assumptions, fm.scenarios]);

  const setValue = (id, raw) => {
    const prev = fm.assumptions[id] || {};
    onChange({ ...fm, assumptions: { ...fm.assumptions, [id]: { ...prev, value: raw === "" ? null : Number(raw), edited: true } } });
  };
  const setScenario = (name, key, raw) => {
    const sc = fm.scenarios || DEFAULT_SCENARIOS;
    onChange({ ...fm, scenarios: { ...sc, [name]: { ...sc[name], [key]: Number(raw) || 0 } } });
  };

  return (
    <div className="border border-gray-200 rounded-xl bg-white mb-4">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gray-100">
        <Calculator size={14} className="text-gray-500" />
        <span className="text-sm font-semibold text-gray-900">Financial model</span>
        <span className="text-xs text-gray-400">calculated from your assumptions — not written by the AI</span>
        {exportHref && Object.keys(fm.assumptions).length > 0 && (
          <a href={exportHref} download className="ml-auto text-xs px-2.5 py-1 border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-600"
            title="Excel workbook with the model as live formulas">Excel (live formulas)</a>
        )}
        <button onClick={onPropose} disabled={proposing}
          className={`${exportHref && Object.keys(fm.assumptions).length > 0 ? "" : "ml-auto "}text-xs px-2.5 py-1 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 flex items-center gap-1`}>
          {proposing ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />}
          {Object.keys(fm.assumptions).length ? "Re-propose from analysis" : "Propose assumptions from analysis"}
        </button>
      </div>

      {!hasAnalyses && Object.keys(fm.assumptions).length === 0 && (
        <p className="px-4 py-3 text-xs text-gray-400">Run some analyses first (market, pricing, cost structure, unit economics) — the proposal uses their findings. You can also type assumptions in directly after proposing.</p>
      )}

      {Object.keys(fm.assumptions).length > 0 && (
        <div className="p-4 space-y-4">
          <div className="flex items-center gap-2 text-xs">
            <label className="text-gray-500">Currency</label>
            <input value={fm.currency || ""} maxLength={4} onChange={e => onChange({ ...fm, currency: e.target.value.toUpperCase() })}
              className="w-14 px-2 py-1 border border-gray-200 rounded-md text-gray-800" placeholder="EUR" />
          </div>

          <table className="w-full text-xs">
            <thead><tr className="text-left text-gray-400">
              <th className="font-medium pb-1">Assumption</th><th className="font-medium pb-1 w-28">Value</th><th className="font-medium pb-1">Source</th>
            </tr></thead>
            <tbody>
              {ASSUMPTION_FIELDS.map(f => {
                const a = fm.assumptions[f.id] || {};
                const missing = f.required && (a.value === null || a.value === undefined);
                return (
                  <tr key={f.id} className="border-t border-gray-50 align-top">
                    <td className="py-1.5 pr-2 text-gray-700">{f.label}{f.required && <span className="text-gray-300"> *</span>}</td>
                    <td className="py-1.5 pr-2">
                      <div className="flex items-center gap-1">
                        <input type="number" value={a.value ?? ""} onChange={e => setValue(f.id, e.target.value)}
                          aria-label={f.label}
                          className={`w-20 px-1.5 py-1 border rounded-md text-gray-900 ${missing ? "border-red-300 bg-red-50" : "border-gray-200"}`} />
                        <span className="text-gray-400">{f.unit === "currency" ? fm.currency || "¤" : f.unit === "%" ? "%" : ""}</span>
                      </div>
                    </td>
                    <td className="py-1.5 text-gray-500">
                      {a.edited ? <span className="text-blue-600">edited by you</span> : (
                        <>
                          {a.confidence && <span className={`px-1.5 py-0.5 rounded-full mr-1 ${CONF[a.confidence]}`}>{a.confidence}</span>}
                          {a.source || (missing ? <span className="text-red-500">not supported by the analyses — enter a value</span> : "")}
                        </>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {!model.ok && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
              <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
              Needed to run the model: {model.missing.map(id => ASSUMPTION_FIELDS.find(f => f.id === id)?.label).join(", ")}.
            </p>
          )}

          {model.ok && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {[
                  ["LTV", money(model.unit.ltv, cur)],
                  ["LTV / CAC", model.unit.ltvToCac === null ? "n/a" : model.unit.ltvToCac.toFixed(1) + "×"],
                  ["CAC payback", model.unit.paybackMonths === null ? "n/a" : model.unit.paybackMonths.toFixed(1) + " mo"],
                  ["Customer lifetime", model.unit.lifetimeMonths === null ? "n/a" : model.unit.lifetimeMonths.toFixed(0) + " mo"],
                ].map(([k, v]) => (
                  <div key={k} className="border border-gray-100 rounded-lg px-3 py-2">
                    <div className="text-[10px] uppercase tracking-wide text-gray-400">{k}</div>
                    <div className="text-base font-semibold text-gray-900">{v}</div>
                  </div>
                ))}
              </div>

              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-400">
                  <th className="font-medium pb-1">Scenario</th><th className="font-medium pb-1">Revenue / mo, M12</th><th className="font-medium pb-1">M36</th>
                  <th className="font-medium pb-1">Breakeven</th><th className="font-medium pb-1">Out of cash</th><th className="font-medium pb-1">Funding gap</th>
                </tr></thead>
                <tbody>
                  {Object.entries(model.scenarios).map(([name, r]) => (
                    <tr key={name} className="border-t border-gray-50">
                      <td className="py-1.5 font-medium" style={{ color: SCENARIO_STYLE[name]?.color }}>{SCENARIO_STYLE[name]?.label || name}</td>
                      <td>{money(r.summary.revenueM12, cur)}</td><td>{money(r.summary.revenueM36, cur)}</td>
                      <td>{r.summary.breakevenMonth ? `month ${r.summary.breakevenMonth}` : "not in 36 mo"}</td>
                      <td className={r.summary.outOfCashMonth ? "text-red-600" : "text-gray-500"}>{r.summary.outOfCashMonth ? `month ${r.summary.outOfCashMonth}` : "never"}</td>
                      <td>{money(r.summary.fundingGap, cur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div>
                <div className="text-[10px] uppercase tracking-wide text-gray-400 mb-1">Cash balance by month</div>
                <CashChart model={model} cur={cur} />
              </div>

              <div className="flex gap-4">
                <button onClick={() => setShowScenarios(v => !v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  {showScenarios ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Scenario settings
                </button>
                <button onClick={() => setShowMonths(v => !v)} className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600">
                  {showMonths ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Monthly detail (base)
                </button>
              </div>

              {showScenarios && (
                <table className="text-xs">
                  <thead><tr className="text-left text-gray-400"><th className="pr-4 font-medium">Multiplier vs base</th><th className="pr-3 font-medium">New customers</th><th className="pr-3 font-medium">Churn</th><th className="pr-3 font-medium">Price</th><th className="font-medium">CAC</th></tr></thead>
                  <tbody>
                    {["bear", "base", "bull"].map(name => (
                      <tr key={name}>
                        <td className="pr-4 py-1 font-medium" style={{ color: SCENARIO_STYLE[name].color }}>{SCENARIO_STYLE[name].label}</td>
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

              {showMonths && (
                <div className="max-h-64 overflow-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-[11px]">
                    <thead className="sticky top-0 bg-gray-50 text-gray-500"><tr>{["Mo", "New", "Customers", "Revenue", "Gross profit", "Acquisition", "Fixed", "Operating", "Cash"].map(h => <th key={h} className="px-2 py-1 text-right font-medium first:text-left">{h}</th>)}</tr></thead>
                    <tbody>
                      {model.scenarios.base.rows.map(r => (
                        <tr key={r.month} className="border-t border-gray-50 text-right">
                          <td className="px-2 py-0.5 text-left">{r.month}</td><td>{r.newCustomers.toFixed(0)}</td><td>{r.customers.toFixed(0)}</td>
                          <td>{money(r.revenue, "")}</td><td>{money(r.grossProfit, "")}</td><td>{money(r.acquisition, "")}</td><td>{money(r.fixed, "")}</td>
                          <td className={r.operating < 0 ? "text-red-600" : ""}>{money(r.operating, "")}</td><td className={r.cash < 0 ? "text-red-600" : ""}>{money(r.cash, "")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

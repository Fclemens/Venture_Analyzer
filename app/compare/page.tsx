"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader, Search } from "lucide-react";

type Dim = { id: string; label: string; weight: number };
type Deal = {
  id: string; name: string; status: string; updated_at: number; stage: string | null; model?: string | null;
  hasReport: boolean; verdict?: string; score?: number; scoreLabel?: string; coverage?: number | null; prevScore?: number | null;
  dimensions?: Record<string, number | null>; thesis?: string; shared?: boolean; mine?: boolean;
};

// Colour always comes with the number and a band word
const band = (v: number | null | undefined) =>
  v == null ? { cls: "text-gray-400 bg-gray-50", word: "" } :
  v >= 7.5 ? { cls: "text-white bg-emerald-600", word: "strong" } :
  v >= 6 ? { cls: "text-sky-900 bg-sky-100", word: "solid" } :
  v >= 4.5 ? { cls: "text-amber-900 bg-amber-100", word: "weak" } :
  { cls: "text-white bg-red-600", word: "poor" };

const RADAR_COLORS = ["#2563eb", "#d97706", "#059669", "#9333ea"];

function Radar({ dims, deals }: { dims: Dim[]; deals: Deal[] }) {
  const S = 300, C = S / 2, R = 110;
  const angle = (i: number) => (Math.PI * 2 * i) / dims.length - Math.PI / 2;
  const pt = (i: number, v: number) => [C + Math.cos(angle(i)) * (R * v) / 10, C + Math.sin(angle(i)) * (R * v) / 10];
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full max-w-sm" role="img" aria-label={`Radar comparison of ${deals.map(d => d.name).join(", ")}`}>
      {[2.5, 5, 7.5, 10].map(r => (
        <polygon key={r} points={dims.map((_, i) => pt(i, r).join(",")).join(" ")} fill="none" stroke="#e5e7eb" />
      ))}
      {dims.map((d, i) => {
        const [x, y] = pt(i, 11.6);
        return <text key={d.id} x={x} y={y} fontSize="10" textAnchor="middle" dominantBaseline="middle" fill="#4b5563">{d.label.replace(" & moat", "").replace(" & demand", "")}</text>;
      })}
      {deals.map((deal, k) => {
        // Unassessed dimensions are gaps in the outline (never drawn as zero)
        const vals = dims.map(d => deal.dimensions?.[d.id] ?? null);
        const complete = vals.every(v => v != null);
        if (complete) return <polygon key={deal.id} fill={RADAR_COLORS[k]} fillOpacity="0.12" stroke={RADAR_COLORS[k]} strokeWidth="2" points={vals.map((v, i) => pt(i, v as number).join(",")).join(" ")} />;
        return (
          <g key={deal.id}>
            {vals.map((v, i) => {
              const j = (i + 1) % vals.length, w = vals[j];
              if (v == null || w == null) return null;
              const [x1, y1] = pt(i, v), [x2, y2] = pt(j, w);
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={RADAR_COLORS[k]} strokeWidth="2" />;
            })}
            {vals.map((v, i) => v == null ? null : <circle key={`p${i}`} cx={pt(i, v)[0]} cy={pt(i, v)[1]} r="2.5" fill={RADAR_COLORS[k]} />)}
          </g>
        );
      })}
    </svg>
  );
}

export default function ComparePage() {
  const [data, setData] = useState<{ dimensions: Dim[]; deals: Deal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("score");
  const [q, setQ] = useState("");
  const [stage, setStage] = useState("all");
  const [verdict, setVerdict] = useState("all");
  const [owner, setOwner] = useState("all");
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    fetch("/api/compare").then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData).catch(e => setError(e.message));
  }, []);

  const scored = useMemo(() => (data?.deals || []).filter(d => d.hasReport), [data]);
  const stages = useMemo(() => [...new Set(scored.map(d => d.stage).filter(Boolean))] as string[], [scored]);
  const verdicts = useMemo(() => [...new Set(scored.map(d => d.verdict).filter(Boolean))] as string[], [scored]);
  const rows = useMemo(() => {
    const val = (d: Deal) => sortKey === "score" ? d.score ?? -1 : (d.dimensions?.[sortKey] ?? -1);
    return scored
      .filter(d => (!q || d.name.toLowerCase().includes(q.toLowerCase())) && (stage === "all" || d.stage === stage) && (verdict === "all" || d.verdict === verdict) && (owner === "all" || (owner === "mine" ? d.mine !== false : d.shared)))
      .sort((a, b) => val(b) - val(a));
  }, [scored, sortKey, q, stage, verdict, owner]);
  const unreported = data?.deals.filter(d => !d.hasReport) ?? [];
  const chosen = scored.filter(d => selected.includes(d.id));
  const toggle = (id: string) => setSelected(s => s.includes(id) ? s.filter(x => x !== id) : s.length >= 4 ? s : [...s, id]);
  const sel = "text-sm px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white text-gray-800";

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-gray-900">
      <div className="max-w-7xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 mb-4"><ArrowLeft size={14} /> Back to analyses</Link>
        <h1 className="text-2xl font-semibold mb-1">Compare deals</h1>
        <p className="text-sm text-gray-600 mb-5">Every deal is scored on the same rubric, so scores are comparable. A dash means the dimension was not assessed (it is excluded, not zero). Click a column to rank by it; tick up to four deals to overlay them.</p>

        {error && <p className="text-sm text-red-700">Could not load deals: {error}</p>}
        {!data && !error && <Loader size={16} className="animate-spin text-gray-500" />}
        {data && scored.length === 0 && <p className="text-sm text-gray-600 bg-white border border-gray-200 rounded-xl p-6">No deal has a generated report yet. Open an analysis and generate its report.</p>}

        {data && scored.length > 0 && (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              <label className="flex items-center gap-1.5 px-2.5 py-1.5 border border-gray-200 rounded-lg bg-white">
                <Search size={14} className="text-gray-500" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" aria-label="Search deals" className="text-sm outline-none w-40" />
              </label>
              <select value={stage} onChange={e => setStage(e.target.value)} className={sel} aria-label="Stage">
                <option value="all">All stages</option>{stages.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
              <select value={verdict} onChange={e => setVerdict(e.target.value)} className={sel} aria-label="Verdict">
                <option value="all">All verdicts</option>{verdicts.map(v => <option key={v} value={v}>{v}</option>)}
              </select>
              <select value={owner} onChange={e => setOwner(e.target.value)} className={sel} aria-label="Owner">
                <option value="all">Mine and shared</option><option value="mine">Mine</option><option value="shared">Shared with team</option>
              </select>
              <span className="ml-auto text-sm text-gray-600 self-center">{rows.length} of {scored.length} deals</span>
            </div>

            {chosen.length >= 2 && (
              <div className="bg-white border border-gray-200 rounded-xl p-5 mb-4 flex flex-wrap items-center gap-8">
                <Radar dims={data.dimensions} deals={chosen} />
                <div className="space-y-2">
                  <h2 className="text-sm font-semibold">Side by side</h2>
                  {chosen.map((d, k) => (
                    <div key={d.id} className="flex items-center gap-2 text-sm">
                      <span className="w-3 h-3 rounded-sm" style={{ background: RADAR_COLORS[k] }} />
                      <span className="font-medium w-36 truncate">{d.name}</span>
                      <span className="text-gray-600">{d.scoreLabel} · {d.verdict}</span>
                    </div>
                  ))}
                  {chosen.some(d => data.dimensions.some(dim => d.dimensions?.[dim.id] == null)) && (
                    <p className="text-xs text-gray-500 max-w-xs">Gaps in an outline are dimensions that were not assessed for that deal.</p>
                  )}
                  <button onClick={() => setSelected([])} className="text-xs text-gray-500 hover:text-gray-800 underline">Clear selection</button>
                </div>
              </div>
            )}

            <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-gray-600 border-b border-gray-100">
                    <th className="pl-4 py-3 w-8" aria-label="Select" />
                    <th className="px-2 py-3 font-medium">#</th>
                    <th className="px-2 py-3 font-medium">Deal</th>
                    <th className="px-2 py-3 font-medium">Verdict</th>
                    <th className="px-2 py-3 font-medium"><button onClick={() => setSortKey("score")} className={sortKey === "score" ? "text-gray-900 underline" : "hover:text-gray-900"}>Score</button></th>
                    {data.dimensions.map(d => (
                      <th key={d.id} className="px-1.5 py-3 font-medium text-center">
                        <button onClick={() => setSortKey(d.id)} className={sortKey === d.id ? "text-gray-900 underline" : "hover:text-gray-900"}>{d.label}</button>
                        <span className="block text-[10px] font-normal text-gray-400">{Math.round(d.weight * 100)}%</span>
                      </th>
                    ))}
                    <th className="px-2 py-3 font-medium">Coverage</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d, i) => {
                    const delta = d.prevScore != null && d.score != null ? Math.round((d.score - d.prevScore) * 10) / 10 : null;
                    return (
                      <tr key={d.id} className={`border-b border-gray-50 last:border-0 align-top ${selected.includes(d.id) ? "bg-blue-50/40" : ""}`}>
                        <td className="pl-4 py-3"><input type="checkbox" checked={selected.includes(d.id)} onChange={() => toggle(d.id)} disabled={!selected.includes(d.id) && selected.length >= 4} aria-label={`Select ${d.name}`} /></td>
                        <td className="px-2 py-3 text-gray-500">{i + 1}</td>
                        <td className="px-2 py-3">
                          <Link href={`/?project=${d.id}`} className="font-medium text-gray-900 hover:underline">{d.name}</Link>
                          {d.shared && <span className="ml-1.5 text-[10px] px-1.5 rounded-full bg-blue-50 text-blue-700">{d.mine ? "shared" : "team"}</span>}
                          <div className="text-xs text-gray-500">{[d.stage, d.model?.toUpperCase()].filter(Boolean).join(" · ")}</div>
                          {d.thesis && <div className="text-xs text-gray-600 max-w-xs mt-0.5 line-clamp-2">{d.thesis}</div>}
                        </td>
                        <td className="px-2 py-3 text-xs font-medium whitespace-nowrap">{d.verdict}</td>
                        <td className="px-2 py-3 whitespace-nowrap">
                          <span className="font-semibold">{d.scoreLabel}</span>
                          {delta !== null && delta !== 0 && <span className={`block text-xs ${delta > 0 ? "text-emerald-700" : "text-red-700"}`}>{delta > 0 ? `▲ +${delta}` : `▼ ${delta}`} since last report</span>}
                        </td>
                        {data.dimensions.map(dim => {
                          const v = d.dimensions?.[dim.id];
                          const b = band(v);
                          return (
                            <td key={dim.id} className="px-1.5 py-3 text-center">
                              <span className={`inline-block w-11 py-1 rounded-md text-sm font-semibold ${b.cls}`} title={b.word || "not assessed"}>{v ?? "–"}</span>
                              <span className="block text-[10px] text-gray-500 mt-0.5">{b.word}</span>
                            </td>
                          );
                        })}
                        <td className="px-2 py-3 text-xs text-gray-600">{d.coverage != null ? `${Math.round(d.coverage * 100)}%` : "–"}</td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && <tr><td colSpan={20} className="text-center text-sm text-gray-500 py-8">No deals match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </>
        )}

        {unreported.length > 0 && (
          <p className="text-sm text-gray-600 mt-4">Not yet scored: {unreported.map((d, i) => <span key={d.id}>{i > 0 && ", "}<Link href={`/?project=${d.id}`} className="hover:underline">{d.name}</Link></span>)}</p>
        )}
      </div>
    </div>
  );
}

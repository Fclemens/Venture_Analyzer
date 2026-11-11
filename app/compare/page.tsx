"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader } from "lucide-react";

type Dim = { id: string; label: string; weight: number };
type Deal = {
  id: string; name: string; status: string; updated_at: number; stage: string | null; model?: string | null;
  hasReport: boolean; verdict?: string; score?: number; scoreLabel?: string; coverage?: number | null;
  dimensions?: Record<string, number | null>; thesis?: string;
};

// Colour is paired with the number and a band word, so it's never the only signal
const band = (v: number | null | undefined) =>
  v == null ? { cls: "text-gray-300", word: "" } :
  v >= 7.5 ? { cls: "text-emerald-700 bg-emerald-50", word: "strong" } :
  v >= 6 ? { cls: "text-sky-700 bg-sky-50", word: "solid" } :
  v >= 4.5 ? { cls: "text-amber-700 bg-amber-50", word: "weak" } :
  { cls: "text-red-700 bg-red-50", word: "poor" };

export default function ComparePage() {
  const [data, setData] = useState<{ dimensions: Dim[]; deals: Deal[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sortKey, setSortKey] = useState<string>("score");

  useEffect(() => {
    fetch("/api/compare").then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then(setData).catch(e => setError(e.message));
  }, []);

  const rows = useMemo(() => {
    if (!data) return [];
    const val = (d: Deal) => sortKey === "score" ? d.score ?? -1 : (d.dimensions?.[sortKey] ?? -1);
    return [...data.deals.filter(d => d.hasReport)].sort((a, b) => val(b) - val(a));
  }, [data, sortKey]);
  const unreported = data?.deals.filter(d => !d.hasReport) ?? [];

  return (
    <div className="min-h-screen bg-gray-50 p-6 text-gray-900">
      <div className="max-w-6xl mx-auto">
        <Link href="/" className="inline-flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-800 mb-4"><ArrowLeft size={12} /> Back to analyses</Link>
        <h1 className="text-xl font-semibold mb-1">Compare deals</h1>
        <p className="text-xs text-gray-500 mb-5">Every deal is scored on the same rubric, so scores are comparable. Blank = not enough evidence (the dimension was not assessed, not zero). Click a column to rank by it.</p>

        {error && <p className="text-sm text-red-600">Could not load deals: {error}</p>}
        {!data && !error && <Loader size={16} className="animate-spin text-gray-400" />}

        {data && rows.length === 0 && <p className="text-sm text-gray-500 bg-white border border-gray-200 rounded-xl p-6">No deal has a generated report yet. Open an analysis and click “Generate report”.</p>}

        {data && rows.length > 0 && (
          <div className="bg-white border border-gray-200 rounded-xl overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-500 border-b border-gray-100">
                  <th className="px-4 py-2.5 font-medium">#</th>
                  <th className="px-2 py-2.5 font-medium">Deal</th>
                  <th className="px-2 py-2.5 font-medium">Verdict</th>
                  <th className="px-2 py-2.5 font-medium"><button onClick={() => setSortKey("score")} className={sortKey === "score" ? "text-gray-900 underline" : "hover:text-gray-800"}>Score</button></th>
                  {data.dimensions.map(d => (
                    <th key={d.id} className="px-2 py-2.5 font-medium">
                      <button onClick={() => setSortKey(d.id)} className={sortKey === d.id ? "text-gray-900 underline" : "hover:text-gray-800"}>{d.label}</button>
                      <span className="block text-[10px] font-normal text-gray-300">{Math.round(d.weight * 100)}%</span>
                    </th>
                  ))}
                  <th className="px-2 py-2.5 font-medium">Coverage</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => (
                  <tr key={d.id} className="border-b border-gray-50 last:border-0 align-top">
                    <td className="px-4 py-3 text-gray-400">{i + 1}</td>
                    <td className="px-2 py-3">
                      <Link href={`/?project=${d.id}`} className="font-medium text-gray-900 hover:underline">{d.name}</Link>
                      <div className="text-xs text-gray-400">{[d.stage, d.model?.toUpperCase()].filter(Boolean).join(" · ")}</div>
                      {d.thesis && <div className="text-xs text-gray-500 max-w-xs mt-0.5 line-clamp-2">{d.thesis}</div>}
                    </td>
                    <td className="px-2 py-3 text-xs font-medium whitespace-nowrap">{d.verdict}</td>
                    <td className="px-2 py-3 font-semibold whitespace-nowrap">{d.scoreLabel}</td>
                    {data.dimensions.map(dim => {
                      const v = d.dimensions?.[dim.id];
                      const b = band(v);
                      return (
                        <td key={dim.id} className="px-2 py-3">
                          <span className={`inline-block min-w-8 text-center px-1.5 py-0.5 rounded-md text-xs font-semibold ${b.cls}`} title={b.word}>{v ?? "–"}</span>
                          {b.word && <span className="block text-[10px] text-gray-400 mt-0.5">{b.word}</span>}
                        </td>
                      );
                    })}
                    <td className="px-2 py-3 text-xs text-gray-500">{d.coverage != null ? `${Math.round(d.coverage * 100)}%` : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {unreported.length > 0 && (
          <p className="text-xs text-gray-400 mt-4">Not yet scored: {unreported.map((d, i) => <span key={d.id}>{i > 0 && ", "}<Link href={`/?project=${d.id}`} className="hover:underline">{d.name}</Link></span>)}</p>
        )}
      </div>
    </div>
  );
}

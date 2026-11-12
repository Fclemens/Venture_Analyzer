"use client";
import { useState, useEffect, useMemo } from "react";
import { History, RotateCcw, Loader } from "lucide-react";
import { lineDiff, diffStats, prettyMarkdownLine } from "@/lib/diff";
import CitedMarkdown from "@/components/CitedMarkdown";

const KIND = { execute: "First analysis", revise: "Revision", restore: "Restored" };

// Every execute/revise/restore is stored server-side. This shows them and lets
// the user compare any version with the current text, or restore it.
export default function HistoryPanel({ projectId, methodId, currentResult, version, onRestored }) {
  const [open, setOpen] = useState(false);
  const [versions, setVersions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [view, setView] = useState("changes"); // "changes" | "side"

  useEffect(() => {
    if (!open || !projectId) return;
    let cancelled = false;
    fetch(`/api/projects/${projectId}/runs?method=${methodId}&history=1`)
      .then(r => r.json())
      .then(d => { if (!cancelled) { setVersions(d.versions || []); setSelected(null); } })
      .catch(e => !cancelled && setErr(e.message));
    return () => { cancelled = true; };
  }, [open, projectId, methodId, version]);

  const sel = versions?.find(v => v.id === selected);
  const diff = useMemo(() => (sel ? lineDiff(sel.result, currentResult || "") : null), [sel, currentResult]);
  const stats = diff ? diffStats(diff) : null;

  const restore = async () => {
    setBusy(true); setErr(null);
    try {
      const res = await fetch(`/api/projects/${projectId}/runs`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "restore", methodId, versionId: sel.id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      await onRestored?.(methodId);
      setSelected(null);
    } catch (e) { setErr(e.message); }
    setBusy(false);
  };

  return (
    <div onClick={e => e.stopPropagation()}>
      <button onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 transition-colors">
        <History size={11} /> Version history
      </button>
      {open && (
        <div className="mt-1.5 border border-gray-200 rounded-lg bg-white">
          {!versions && <div className="p-3 flex justify-center"><Loader size={12} className="animate-spin text-gray-400" /></div>}
          {versions?.length === 0 && <p className="p-3 text-xs text-gray-400">No saved versions yet.</p>}
          {versions?.length > 0 && (
            <div className="flex divide-x divide-gray-100 max-h-[28rem]">
              <ul className="w-44 flex-shrink-0 overflow-y-auto">
                {versions.map((v, i) => (
                  <li key={v.id}>
                    <button onClick={() => setSelected(v.id)}
                      className={`w-full text-left px-2.5 py-1.5 text-xs border-b border-gray-50 ${selected === v.id ? "bg-blue-50 text-blue-800" : "hover:bg-gray-50 text-gray-600"}`}>
                      <span className="font-medium">{KIND[v.kind] || v.kind}</span>{i === 0 && <span className="text-gray-400"> · latest</span>}
                      <br /><span className="text-gray-400">{new Date(v.created_at).toLocaleString()}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <div className="flex-1 min-w-0 overflow-y-auto p-2.5">
                {!sel && <p className="text-xs text-gray-400">Select a version to compare it with the current text.</p>}
                {sel && (
                  <>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-600">vs current: <span className="text-emerald-700">+{stats.added}</span> / <span className="text-red-600">−{stats.removed}</span> lines</span>
                      <div className="flex rounded-md border border-gray-200 overflow-hidden text-xs" role="tablist">
                        {[["changes", "Changes"], ["side", "Side by side"]].map(([k, l]) => (
                          <button key={k} role="tab" aria-selected={view === k} onClick={() => setView(k)}
                            className={`px-2 py-0.5 ${view === k ? "bg-gray-900 text-white" : "text-gray-600 hover:bg-gray-50"}`}>{l}</button>
                        ))}
                      </div>
                      <button onClick={restore} disabled={busy || sel.result === currentResult}
                        className="ml-auto text-xs px-2 py-0.5 border border-gray-200 rounded-md hover:bg-gray-50 text-gray-600 disabled:opacity-40 flex items-center gap-1">
                        {busy ? <Loader size={10} className="animate-spin" /> : <RotateCcw size={10} />} Restore this version
                      </button>
                    </div>
                    {view === "changes" ? (
                      <div className="text-[13px] leading-relaxed">
                        {diff.map((d, i) => {
                          const text = prettyMarkdownLine(d.text);
                          if (text === null) return null;
                          if (d.type === "same" && !text.trim()) return <div key={i} className="h-2" />;
                          return (
                            <div key={i} className={`px-1.5 rounded ${d.type === "add" ? "bg-emerald-50 text-emerald-950" : d.type === "del" ? "bg-red-50 text-red-900 line-through decoration-red-300" : "text-gray-600"}`}>
                              <span className="inline-block w-3 text-gray-500">{d.type === "add" ? "+" : d.type === "del" ? "−" : ""}</span>{text}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="grid grid-cols-2 gap-3">
                        {[["Selected version", sel.result], ["Current", currentResult]].map(([label, md]) => (
                          <div key={label} className="min-w-0">
                            <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{label}</div>
                            <div className="prose prose-sm max-w-none prose-p:text-xs prose-li:text-xs prose-h2:text-sm prose-table:text-[11px] border border-gray-100 rounded-md p-2">
                              <CitedMarkdown>{md || ""}</CitedMarkdown>
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {err && <p className="px-3 py-2 text-xs text-red-600">{err}</p>}
        </div>
      )}
    </div>
  );
}

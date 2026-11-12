"use client";
// Slide-over that shows the evidence behind a citation chip.
import { useEffect } from "react";
import { X, FileText, Globe2, Database } from "lucide-react";

const SOURCE_ICON = (e) => /web|http/i.test(`${e.source_id || ""} ${e.location || ""}`) ? Globe2 : /doc|slide|page|deck|p\.\s?\d/i.test(`${e.source_id || ""} ${e.location || ""}`) ? FileText : Database;

export function ConfidenceBar({ value }) {
  if (value == null || Number.isNaN(Number(value))) return null;
  const v = Math.max(0, Math.min(1, Number(value)));
  const color = v >= 0.75 ? "#059669" : v >= 0.5 ? "#d97706" : "#dc2626";
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] text-gray-600" title={`Extraction confidence ${Math.round(v * 100)}%`}>
      <span className="w-14 h-1.5 rounded-full bg-gray-100 overflow-hidden inline-block"><span className="block h-full" style={{ width: `${v * 100}%`, background: color }} /></span>
      {Math.round(v * 100)}%
    </span>
  );
}

export default function EvidencePanel({ open, evidence, selectedId, methodName, onSelect, onClose }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open || !evidence) return null;
  const items = evidence.extracted_evidence || [];
  const withIds = items.map((e, i) => ({ ...e, id: e.id || `E${i + 1}` }));
  return (
    <div className="fixed inset-0 z-50 flex justify-end print:hidden" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20" />
      <aside className="relative w-full max-w-md bg-white shadow-2xl h-full flex flex-col" onClick={e => e.stopPropagation()} aria-label="Evidence">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Evidence</h2>
            <p className="text-xs text-gray-500">{methodName} · {items.length} items · quality: {evidence.evidence_quality || "n/a"}</p>
          </div>
          <button onClick={onClose} aria-label="Close" className="text-gray-400 hover:text-gray-700"><X size={16} /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5 space-y-2.5">
          {withIds.map(e => {
            const Icon = SOURCE_ICON(e);
            const active = e.id === selectedId;
            return (
              <button key={e.id} onClick={() => onSelect(e.id)} ref={el => active && el?.scrollIntoView({ block: "nearest" })}
                className={`w-full text-left rounded-xl border p-3 transition-colors ${active ? "border-violet-400 bg-violet-50 ring-2 ring-violet-200" : "border-gray-200 hover:bg-gray-50"}`}>
                <div className="flex items-center gap-2 mb-1.5">
                  <span className="px-1.5 rounded-md bg-violet-100 text-violet-800 text-[11px] font-semibold">{e.id}</span>
                  <Icon size={12} className="text-gray-500" />
                  <span className="text-[11px] text-gray-500">{[e.entity, e.data_type].filter(Boolean).join(" · ")}</span>
                  <span className="ml-auto"><ConfidenceBar value={e.confidence} /></span>
                </div>
                <p className="text-sm text-gray-800 leading-snug">{e.content}</p>
                {(e.location || e.source_id) && <p className="text-[11px] text-gray-500 mt-1.5">Source: {[e.location, e.source_id].filter(Boolean).join(" · ")}</p>}
              </button>
            );
          })}
          {items.length === 0 && <p className="text-sm text-gray-500">This analysis has no extracted evidence items.</p>}
          {evidence.gaps?.length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs font-semibold text-gray-700 mb-1">Evidence gaps</h3>
              <ul className="text-sm text-gray-600 space-y-1">{evidence.gaps.map((g, i) => <li key={i}>• {g}</li>)}</ul>
            </div>
          )}
          {evidence.conflicts?.length > 0 && (
            <div className="pt-2">
              <h3 className="text-xs font-semibold text-red-700 mb-1">Conflicting evidence</h3>
              <ul className="text-sm text-gray-700 space-y-1">{evidence.conflicts.map((g, i) => <li key={i}>• {typeof g === "string" ? g : JSON.stringify(g)}</li>)}</ul>
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

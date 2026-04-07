"use client";
import { useState } from "react";
import { AlertTriangle, RotateCcw, ChevronDown, ChevronRight, Loader, Sparkles } from "lucide-react";

export default function PassSummaryCard({ passId, summary, stale, onRegenerate }) {
  const [expanded, setExpanded] = useState(true);
  const [regenerating, setRegenerating] = useState(false);

  const handleRegenerate = async () => {
    setRegenerating(true);
    await onRegenerate(passId);
    setRegenerating(false);
  };

  if (!summary && !stale) return null;

  return (
    <div className={`rounded-xl border mb-4 ${stale ? "border-amber-200 bg-amber-50/30" : "border-blue-100 bg-blue-50/20"}`}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" onClick={() => setExpanded(e => !e)}>
        <Sparkles size={12} className={stale ? "text-amber-400" : "text-blue-400"} />
        <span className="text-xs font-semibold text-gray-700 flex-1">Pass summary</span>
        {stale && (
          <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">stale</span>
        )}
        <button onClick={e => { e.stopPropagation(); handleRegenerate(); }} disabled={regenerating}
          className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-700 disabled:opacity-40 px-2 py-0.5 rounded hover:bg-white transition-colors">
          {regenerating ? <Loader size={10} className="animate-spin" /> : <RotateCcw size={10} />}
          {stale ? "Regenerate" : "Refresh"}
        </button>
        {expanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
      </div>

      {expanded && summary && (
        <div className="px-3 pb-3 border-t border-blue-100 space-y-3 pt-2.5">

          {/* Pass verdict */}
          {summary.pass_verdict && (
            <p className="text-xs text-gray-700 leading-relaxed italic border-l-2 border-blue-200 pl-3">
              {summary.pass_verdict}
            </p>
          )}

          {/* Strongest findings */}
          {summary.strongest_findings?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1.5">Strongest findings</p>
              <ul className="space-y-1">
                {summary.strongest_findings.map((f, i) => (
                  <li key={i} className="text-xs text-gray-700 flex gap-1.5">
                    <span className="text-blue-400 flex-shrink-0 mt-0.5">•</span>
                    <span>{f}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Cross-methodology synthesis */}
          {summary.synthesis?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1.5">Cross-method synthesis</p>
              <ul className="space-y-1">
                {summary.synthesis.map((s, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                    <span className="text-blue-300 flex-shrink-0 mt-0.5">◆</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Key risks */}
          {summary.key_risks?.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-1.5">Key risks</p>
              <ul className="space-y-1">
                {summary.key_risks.map((r, i) => (
                  <li key={i} className="text-xs text-gray-600 flex gap-1.5">
                    <span className="text-red-300 flex-shrink-0 mt-0.5">▲</span>
                    <span>{r}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Revision triggers */}
          {summary.revision_triggers?.length > 0 && (
            <div className="border-t border-amber-200 pt-2 space-y-1">
              <p className="text-xs font-semibold text-amber-700 mb-1">P0 revision triggers</p>
              {summary.revision_triggers.map((rt, i) => (
                <div key={i} className="flex gap-1.5 text-xs text-amber-700">
                  <AlertTriangle size={11} className="flex-shrink-0 mt-0.5" />
                  <span>{rt}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Stale placeholder when no summary yet */}
      {expanded && !summary && stale && (
        <div className="px-3 pb-3 pt-2 border-t border-amber-100">
          <p className="text-xs text-amber-600">Summary is outdated. Click Regenerate to update.</p>
        </div>
      )}
    </div>
  );
}

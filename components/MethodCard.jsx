"use client";
import { useState } from "react";
import { ChevronDown, ChevronRight, Check, RotateCcw, Loader, Filter, Zap, Database, Pencil, AlertTriangle, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function Badge({ type, children }) {
  const s = { pending:"bg-gray-100 text-gray-500", extracting:"bg-violet-50 text-violet-700", executing:"bg-blue-50 text-blue-700", extracted:"bg-violet-100 text-violet-800", review:"bg-amber-50 text-amber-700", done:"bg-emerald-50 text-emerald-700", error:"bg-red-50 text-red-600", skip:"bg-gray-100 text-gray-400", run:"bg-emerald-50 text-emerald-700", lite:"bg-amber-50 text-amber-700", fast:"bg-purple-50 text-purple-600", smart:"bg-blue-50 text-blue-600" };
  return <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${s[type] || s.pending}`}>{children || type}</span>;
}

function cleanMarkdown(text) {
  if (!text) return "";
  return text.replace(/\r\n/g, "\n").replace(/\n{3,}/g, "\n\n").replace(/\n[ \t]+\n/g, "\n\n").replace(/([^\n])\n(?![\n#>*\-|`\d])/g, "$1 ").trim();
}

const CONFIDENCE_COLORS = { high: "bg-emerald-400", medium: "bg-amber-400", low: "bg-red-400" };

export default function MethodCard({ method, status, evidence, result, summary, notes, loading, onRunExtract, onRunExecute, onApprove, onRerun, onRevise, onSummarise, onToggle, onNotesChange }) {
  const [expanded, setExpanded] = useState(false);
  const [showFullAnalysis, setShowFullAnalysis] = useState(false);
  const isSkipped = method.decision === "skip";

  return (
    <div className={`border rounded-xl mb-2 transition-all ${isSkipped ? "border-gray-100 opacity-40" : status === "review" ? "border-amber-200 bg-amber-50/20" : status === "done" ? "border-emerald-200 bg-emerald-50/10" : "border-gray-200 bg-white"}`}>
      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5 cursor-pointer select-none" onClick={() => !isSkipped && setExpanded(e => !e)}>
        {!isSkipped && (expanded ? <ChevronDown size={13} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={13} className="text-gray-400 flex-shrink-0" />)}
        <span className="text-xs font-mono text-gray-400 w-5 flex-shrink-0">{method.pass?.toUpperCase()}</span>
        <span className={`text-sm flex-1 min-w-0 truncate ${isSkipped ? "line-through text-gray-400" : "text-gray-800 font-medium"}`}>{method.name}</span>
        {/* One-liner preview when done and collapsed */}
        {status === "done" && !expanded && summary?.one_liner && (
          <span className="text-xs text-gray-400 italic truncate max-w-xs hidden lg:block">{summary.one_liner}</span>
        )}
        <button onClick={e => { e.stopPropagation(); onToggle(); }}
          className={`text-xs px-2 py-0.5 rounded-full border transition-colors flex-shrink-0 ${method.decision === "run" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : method.decision === "lite" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-100 text-gray-400 border-gray-200"}`}>
          {method.decision}
        </button>
        {status && status !== "pending" && !isSkipped && <Badge type={status}>{status}</Badge>}
      </div>

      {expanded && !isSkipped && (
        <div className="px-3 pb-3 border-t border-gray-100 space-y-2.5 pt-2.5">
          {/* Meta */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge type="fast">Fast: extract</Badge>
            <Badge type="smart">Smart: execute</Badge>
            <span className="text-xs text-gray-400">· {method.entity_filter?.join(", ")}</span>
          </div>
          {method.reason && <p className="text-xs text-gray-500 italic">{method.reason}</p>}

          {/* ── Method summary (shown when done, before full analysis) ── */}
          {summary && (
            <div className="bg-emerald-50 border border-emerald-100 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-800">Key insights</span>
                <div className="flex items-center gap-2">
                  {summary.confidence && (
                    <div className="flex items-center gap-1">
                      <div className={`w-1.5 h-1.5 rounded-full ${CONFIDENCE_COLORS[summary.confidence] || "bg-gray-300"}`} />
                      <span className="text-xs text-emerald-600">{summary.confidence}</span>
                    </div>
                  )}
                </div>
              </div>
              <ul className="space-y-1">
                {(summary.key_insights || []).map((insight, i) => (
                  <li key={i} className="text-xs text-emerald-800 flex gap-1.5">
                    <span className="text-emerald-400 flex-shrink-0 mt-0.5">•</span>
                    <span>{insight}</span>
                  </li>
                ))}
              </ul>
              {summary.revision_triggers?.length > 0 && (
                <div className="border-t border-emerald-200 pt-2 space-y-1">
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

          {/* Evidence bundle */}
          {evidence && (
            <div className="bg-violet-50 rounded-lg p-3">
              <div className="flex items-center gap-1.5 mb-2">
                <Database size={11} className="text-violet-600" />
                <span className="text-xs font-medium text-violet-800">Evidence bundle</span>
                <span className="text-xs text-violet-400 ml-auto">{evidence.extracted_evidence?.length || 0} items · {evidence.evidence_quality}</span>
              </div>
              {evidence.gaps?.length > 0 && <p className="text-xs text-violet-700 mb-1"><span className="font-medium">Gaps: </span>{evidence.gaps.slice(0, 3).join("; ")}</p>}
              {evidence.extracted_evidence?.slice(0, 5).map((e, i) => (
                <div key={i} className="text-xs text-violet-700 pl-2 border-l-2 border-violet-200 mt-1">
                  <span className="text-violet-400">[{e.entity}]</span> {e.content?.slice(0, 120)}{e.content?.length > 120 ? "…" : ""}
                </div>
              ))}
            </div>
          )}

          {/* Full analysis — collapsible when summary exists */}
          {result && (
            <div>
              {summary && (
                <button onClick={() => setShowFullAnalysis(v => !v)}
                  className="flex items-center gap-1 text-xs text-gray-400 hover:text-gray-600 mb-1.5 transition-colors">
                  {showFullAnalysis ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                  Full analysis
                </button>
              )}
              {(!summary || showFullAnalysis) && (
                <div className="bg-white rounded-lg border border-gray-200 p-3 max-h-96 overflow-y-auto">
                  <div className="prose prose-sm max-w-none
                    prose-headings:font-semibold prose-headings:text-gray-900 prose-headings:leading-snug
                    prose-h2:text-sm prose-h2:mt-4 prose-h2:mb-2 prose-h2:border-b prose-h2:border-gray-100 prose-h2:pb-1
                    prose-h3:text-xs prose-h3:mt-3 prose-h3:mb-1.5 prose-h3:uppercase prose-h3:tracking-wide prose-h3:text-gray-500
                    prose-p:text-xs prose-p:text-gray-700 prose-p:leading-relaxed prose-p:my-1.5
                    prose-strong:text-gray-900 prose-strong:font-semibold
                    prose-ul:text-xs prose-ul:my-1.5 prose-ul:pl-5 prose-li:my-0.5 prose-li:leading-relaxed prose-li:text-gray-700
                    prose-ol:text-xs prose-ol:my-1.5 prose-ol:pl-5
                    prose-table:text-xs prose-table:w-full prose-th:bg-gray-50 prose-th:px-2 prose-th:py-1 prose-th:font-semibold prose-th:text-gray-700 prose-th:text-left prose-td:px-2 prose-td:py-1 prose-td:text-gray-600 prose-td:border-b prose-td:border-gray-100
                    prose-blockquote:border-l-2 prose-blockquote:border-blue-200 prose-blockquote:pl-3 prose-blockquote:text-gray-500 prose-blockquote:not-italic prose-blockquote:text-xs
                    prose-code:text-xs prose-code:bg-gray-100 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:font-mono prose-code:before:content-none prose-code:after:content-none
                    prose-a:text-blue-600 prose-a:no-underline hover:prose-a:underline">
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{cleanMarkdown(result)}</ReactMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Notes */}
          <textarea value={notes || ""} onChange={e => onNotesChange(e.target.value)} rows={1}
            placeholder="Your notes — used by Revise to guide the analysis…" onClick={e => e.stopPropagation()}
            className="w-full text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-y text-gray-700 placeholder-gray-400" />

          {/* Actions */}
          <div className="flex gap-1.5 flex-wrap">
            {(!status || status === "pending" || status === "error") && (
              <button onClick={e => { e.stopPropagation(); onRunExtract(); }} disabled={loading}
                className="text-xs px-2.5 py-1 bg-violet-600 text-white rounded-lg hover:bg-violet-700 disabled:opacity-40 flex items-center gap-1">
                {loading ? <Loader size={10} className="animate-spin" /> : <Filter size={10} />} Extract
              </button>
            )}
            {status === "extracted" && (
              <button onClick={e => { e.stopPropagation(); onRunExecute(); }} disabled={loading}
                className="text-xs px-2.5 py-1 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 flex items-center gap-1">
                {loading ? <Loader size={10} className="animate-spin" /> : <Zap size={10} />} Execute
              </button>
            )}
            {status === "review" && (
              <button onClick={e => { e.stopPropagation(); onApprove(); }} className="text-xs px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1">
                <Check size={10} /> Approve
              </button>
            )}
            {status === "done" && !summary && result && (
              <button onClick={e => { e.stopPropagation(); onSummarise(); }} disabled={loading}
                className="text-xs px-2.5 py-1 bg-white border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1">
                {loading ? <Loader size={10} className="animate-spin" /> : <Sparkles size={10} />} Summarise
              </button>
            )}
            {(status === "review" || status === "done") && (
              <>
                <button onClick={e => { e.stopPropagation(); onRevise(); }} disabled={loading}
                  className="text-xs px-2.5 py-1 bg-white border border-amber-300 text-amber-700 rounded-lg hover:bg-amber-50 disabled:opacity-40 flex items-center gap-1">
                  {loading ? <Loader size={10} className="animate-spin" /> : <Pencil size={10} />} Revise
                </button>
                <button onClick={e => { e.stopPropagation(); onRerun(); }} disabled={loading}
                  className="text-xs px-2.5 py-1 bg-white border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1">
                  <RotateCcw size={10} /> Re-run
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

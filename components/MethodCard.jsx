"use client";
import { useState, useEffect, useRef, useMemo } from "react";
import { ChevronDown, ChevronRight, Check, RotateCcw, Loader, Zap, Pencil, AlertTriangle, Sparkles, Play, Filter, Clock } from "lucide-react";
import HistoryPanel from "@/components/HistoryPanel";
import CommentsPanel from "@/components/CommentsPanel";
import CitedMarkdown from "@/components/CitedMarkdown";
import EvidencePanel, { ConfidenceBar } from "@/components/EvidencePanel";
import { claimCounts } from "@/lib/citations";
import { normalizeMarkdown as cleanMarkdown } from "@/lib/markdown";

// One label and colour per status, used everywhere a status is shown
export const STATUS_META = {
  pending:    { label: "Not started",       cls: "bg-gray-100 text-gray-600" },
  extracting: { label: "Gathering evidence", cls: "bg-blue-50 text-blue-700" },
  extracted:  { label: "Evidence ready",    cls: "bg-violet-50 text-violet-700" },
  executing:  { label: "Analysing",         cls: "bg-blue-50 text-blue-700" },
  review:     { label: "Needs review",      cls: "bg-amber-50 text-amber-800" },
  done:       { label: "Approved",          cls: "bg-emerald-50 text-emerald-700" },
  error:      { label: "Failed",            cls: "bg-red-50 text-red-700" },
};

const PROSE = `prose prose-sm max-w-none prose-headings:font-semibold prose-headings:text-gray-900 prose-h2:text-sm prose-h2:mt-4 prose-h2:mb-2
  prose-h2:border-b prose-h2:border-gray-100 prose-h2:pb-1 prose-h3:text-xs prose-h3:uppercase prose-h3:tracking-wide prose-h3:text-gray-600
  prose-p:text-[13px] prose-p:text-gray-800 prose-p:leading-relaxed prose-li:text-[13px] prose-li:text-gray-800 prose-strong:text-gray-900
  prose-table:text-xs prose-th:bg-gray-50 prose-th:px-2 prose-th:py-1 prose-td:px-2 prose-td:py-1 prose-blockquote:text-gray-700 prose-blockquote:not-italic
  [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none`;

function Elapsed({ since }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  if (!since) return null;
  const s = Math.max(0, Math.round((now - since) / 1000));
  return <span className="tabular-nums">{Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}</span>;
}

export default function MethodCard({
  method, status, evidence, result, summary, notes, loading, projectId, runVersion, staleBecause, focused, startedAt,
  onRestored, commentCount, onCommentsChanged, onRunExtract, onRunExecute, onApprove, onRerun, onRevise, onSummarise,
  onToggle, onNotesChange, onCancel, onRunAll,
}) {
  const [expandedState, setExpanded] = useState(false);
  const [showFullState, setShowFullAnalysis] = useState(false);
  // Opened from the overview's "next step": shown expanded with the full analysis
  const expanded = expandedState || !!focused;
  const showFullAnalysis = showFullState || !!focused;
  const [cite, setCite] = useState(null);
  const ref = useRef(null);
  const isSkipped = method.decision === "skip";
  const running = status === "extracting" || status === "executing";
  const meta = STATUS_META[status || "pending"] || STATUS_META.pending;
  const stale = staleBecause?.length > 0;
  const evidenceIds = useMemo(() => new Set((evidence?.extracted_evidence || []).map((e, i) => e.id || `E${i + 1}`)), [evidence]);
  const claims = useMemo(() => claimCounts(result), [result]);

  useEffect(() => {
    if (focused) setTimeout(() => ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 50);
  }, [focused]);

  return (
    <div ref={ref} className={`border rounded-xl mb-2 transition-all bg-white ${isSkipped ? "border-gray-100 opacity-50" : focused ? "border-blue-300 ring-2 ring-blue-100" : status === "review" ? "border-amber-200" : status === "error" ? "border-red-200" : "border-gray-200"}`}>
      {/* Header row: name, one status, staleness */}
      <div className="flex items-center gap-2 px-3.5 py-3 cursor-pointer select-none" onClick={() => !isSkipped && setExpanded(e => !e)}>
        {!isSkipped && (expanded ? <ChevronDown size={14} className="text-gray-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-gray-500 flex-shrink-0" />)}
        <span className={`text-sm flex-shrink-0 ${isSkipped ? "line-through text-gray-500" : "text-gray-900 font-medium"}`}>{method.name}</span>
        {!expanded && summary?.one_liner && status === "done" && (
          <span className="text-xs text-gray-500 truncate hidden lg:block">— {summary.one_liner}</span>
        )}
        <span className="flex-1" />
        {stale && !isSkipped && (
          <span title={`Written before ${staleBecause.join(", ")} changed`} className="inline-flex items-center gap-1 text-xs text-orange-700 flex-shrink-0">
            <span className="w-1.5 h-1.5 rounded-full bg-orange-500" /> outdated
          </span>
        )}
        {running && <span className="text-xs text-blue-700 flex items-center gap-1 flex-shrink-0"><Loader size={11} className="animate-spin" /><Elapsed since={startedAt} /></span>}
        {!isSkipped && <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${meta.cls}`}>{meta.label}</span>}
        <button onClick={e => { e.stopPropagation(); onToggle(); }} title="Analysis depth: run (full) → lite → skip. Click to change."
          className="text-[11px] text-gray-500 hover:text-gray-800 px-1.5 py-0.5 rounded border border-transparent hover:border-gray-200 flex-shrink-0">
          {method.decision}
        </button>
      </div>

      {expanded && !isSkipped && (
        <div className="px-3.5 pb-3.5 border-t border-gray-100 space-y-3 pt-3">
          {method.reason && <p className="text-xs text-gray-600 italic">Why this analysis: {method.reason}</p>}

          {running && (
            <div className="flex items-center gap-3 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2.5 text-sm text-blue-900">
              <Loader size={14} className="animate-spin" />
              <span className="flex-1">{status === "extracting" ? "Step 1 of 2 — gathering evidence from your documents and earlier analyses" : "Step 2 of 2 — writing the analysis (with web research)"} · <Elapsed since={startedAt} /></span>
              {onCancel && <button onClick={onCancel} className="text-xs px-2 py-1 rounded-md border border-blue-200 hover:bg-white">Cancel if not started</button>}
            </div>
          )}
          {status === "error" && (
            <div className="flex items-center gap-2 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5 text-sm text-red-800">
              <AlertTriangle size={14} /> <span className="flex-1">This analysis failed. Your previous draft (if any) is kept.</span>
              <button onClick={onRunAll || onRunExtract} className="text-xs px-2.5 py-1 rounded-md bg-red-600 text-white hover:bg-red-700">Retry</button>
            </div>
          )}
          {stale && (
            <div className="flex items-center gap-2 bg-orange-50 border border-orange-100 rounded-lg px-3 py-2.5 text-sm text-orange-900">
              <AlertTriangle size={14} className="flex-shrink-0" />
              <span className="flex-1">Written before <strong>{staleBecause.join(", ")}</strong> changed.</span>
              {result && <button onClick={onRevise} disabled={loading} className="text-xs px-2.5 py-1 rounded-md bg-orange-600 text-white hover:bg-orange-700 disabled:opacity-40">Revise now</button>}
            </div>
          )}

          {summary && (
            <div className="bg-emerald-50/60 border border-emerald-100 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-emerald-900">Key insights</span>
                {summary.confidence && <span className="text-xs text-emerald-800">{summary.confidence} confidence</span>}
              </div>
              <ul className="space-y-1">
                {(summary.key_insights || []).map((k, i) => <li key={i} className="text-[13px] text-emerald-950 flex gap-1.5"><span className="text-emerald-500">•</span><span>{k}</span></li>)}
              </ul>
              {summary.revision_triggers?.length > 0 && (
                <div className="border-t border-emerald-200 pt-2 space-y-1">
                  {summary.revision_triggers.map((rt, i) => <div key={i} className="flex gap-1.5 text-xs text-amber-800"><AlertTriangle size={11} className="flex-shrink-0 mt-0.5" /><span>{rt}</span></div>)}
                </div>
              )}
            </div>
          )}

          {/* Evidence: real list with confidence; click to open the evidence panel */}
          {evidence && (
            <div className="rounded-lg border border-violet-100">
              <div className="flex items-center gap-2 px-3 py-2 border-b border-violet-100 bg-violet-50/50 rounded-t-lg">
                <span className="text-xs font-semibold text-violet-900">Evidence</span>
                <span className="text-xs text-violet-700">{evidence.extracted_evidence?.length || 0} items · quality {evidence.evidence_quality || "n/a"}</span>
                <button onClick={() => setCite((evidence.extracted_evidence?.[0]?.id) || "E1")} className="ml-auto text-xs text-violet-800 hover:underline">Open all</button>
              </div>
              <ul className="divide-y divide-gray-50">
                {(evidence.extracted_evidence || []).slice(0, 4).map((e, i) => {
                  const id = e.id || `E${i + 1}`;
                  return (
                    <li key={id}>
                      <button onClick={() => setCite(id)} className="w-full text-left px-3 py-2 flex items-start gap-2 hover:bg-gray-50">
                        <span className="px-1.5 rounded-md bg-violet-100 text-violet-800 text-[11px] font-semibold mt-0.5">{id}</span>
                        <span className="flex-1 text-[13px] text-gray-800 leading-snug">{e.content}</span>
                        <ConfidenceBar value={e.confidence} />
                      </button>
                    </li>
                  );
                })}
              </ul>
              {evidence.gaps?.length > 0 && <p className="px-3 py-2 text-xs text-gray-600 border-t border-gray-50"><span className="font-medium text-gray-800">Gaps:</span> {evidence.gaps.slice(0, 3).join("; ")}</p>}
            </div>
          )}

          {result && (
            <div>
              <div className="flex items-center gap-3 mb-1.5">
                {summary && (
                  <button onClick={() => setShowFullAnalysis(v => !v)} className="flex items-center gap-1 text-xs text-gray-600 hover:text-gray-900">
                    {showFullAnalysis ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Full analysis
                  </button>
                )}
                {(claims.VERIFIED + claims.UNVERIFIED + claims.CONTRADICTED) > 0 && (
                  <span className="text-xs text-gray-600 flex items-center gap-2" title="Claims from the company's materials, checked against evidence">
                    Claims: <span className="text-emerald-700">{claims.VERIFIED} verified</span> · <span className="text-amber-700">{claims.UNVERIFIED} unverified</span> · <span className="text-red-700">{claims.CONTRADICTED} contradicted</span>
                  </span>
                )}
              </div>
              {(!summary || showFullAnalysis) && (
                <div className="bg-white rounded-lg border border-gray-200 p-3.5 max-h-[32rem] overflow-y-auto">
                  <div className={PROSE}>
                    <CitedMarkdown onCite={setCite} evidenceIds={evidenceIds}>{cleanMarkdown(result)}</CitedMarkdown>
                  </div>
                </div>
              )}
            </div>
          )}

          {projectId && (
            <div className="flex gap-4 flex-wrap items-start">
              {result && <HistoryPanel projectId={projectId} methodId={method.id} currentResult={result} version={runVersion} onRestored={onRestored} />}
              <CommentsPanel projectId={projectId} methodId={method.id} count={commentCount} onChanged={onCommentsChanged} />
            </div>
          )}

          <textarea value={notes || ""} onChange={e => onNotesChange(e.target.value)} rows={1}
            placeholder="Your notes — Revise uses them to steer the analysis…" onClick={e => e.stopPropagation()}
            className="w-full text-[13px] px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-y text-gray-800 placeholder-gray-500" />

          {/* Actions: the primary action for the current state comes first */}
          <div className="flex gap-1.5 flex-wrap">
            {(!status || status === "pending") && (
              <>
                <button onClick={onRunAll} disabled={loading} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 flex items-center gap-1"><Play size={11} /> Run</button>
                <button onClick={onRunExtract} disabled={loading} className="text-xs px-2.5 py-1.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1" title="Gather evidence only, then review it before writing"><Filter size={11} /> Evidence only</button>
              </>
            )}
            {status === "extracted" && (
              <button onClick={onRunExecute} disabled={loading} className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-40 flex items-center gap-1"><Zap size={11} /> Write analysis</button>
            )}
            {status === "review" && (
              <button onClick={onApprove} className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-1"><Check size={11} /> Approve</button>
            )}
            {status === "done" && !summary && result && (
              <button onClick={onSummarise} disabled={loading} className="text-xs px-2.5 py-1.5 border border-emerald-300 text-emerald-800 rounded-lg hover:bg-emerald-50 disabled:opacity-40 flex items-center gap-1">
                {loading ? <Loader size={11} className="animate-spin" /> : <Sparkles size={11} />} Summarise
              </button>
            )}
            {(status === "review" || status === "done") && (
              <>
                <button onClick={onRevise} disabled={loading} className="text-xs px-2.5 py-1.5 border border-amber-300 text-amber-800 rounded-lg hover:bg-amber-50 disabled:opacity-40 flex items-center gap-1"><Pencil size={11} /> Revise with notes</button>
                <button onClick={onRerun} disabled={loading} className="text-xs px-2.5 py-1.5 border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50 disabled:opacity-40 flex items-center gap-1"><RotateCcw size={11} /> Start over</button>
              </>
            )}
            {running && <span className="text-xs text-gray-600 flex items-center gap-1"><Clock size={11} /> Runs in the background — you can leave this page.</span>}
          </div>
        </div>
      )}

      <EvidencePanel open={!!cite} evidence={evidence} selectedId={cite} methodName={method.name} onSelect={setCite} onClose={() => setCite(null)} />
    </div>
  );
}

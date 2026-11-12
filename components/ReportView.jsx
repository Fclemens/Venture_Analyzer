"use client";
// The report: verdict, scores, findings, tensions, founder questions, chapters.
import { ChevronLeft, Play, RotateCcw, Download, Loader, AlertTriangle, FileText, Printer, TrendingUp, ShieldAlert, Scale, Check } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import CitedMarkdown from "@/components/CitedMarkdown";
import { ScoreBars, Sparkline, scoreBand } from "@/components/ui";
import { PASS_DEFS } from "@/lib/constants";
import { normalizeMarkdown } from "@/lib/markdown";

const PROSE = "prose prose-sm max-w-none prose-headings:text-gray-900 prose-p:text-gray-800 prose-li:text-gray-800 prose-p:leading-relaxed prose-table:text-sm [&_blockquote_p]:before:content-none [&_blockquote_p]:after:content-none";

function Section({ id, title, icon, children, className = "" }) {
  return (
    <section id={id} className={`scroll-mt-6 bg-white rounded-2xl border border-gray-200 p-6 print:border-0 print:p-0 print:break-inside-avoid ${className}`}>
      {title && <h2 className="text-base font-semibold text-gray-900 mb-3 flex items-center gap-2">{icon}{title}</h2>}
      {children}
    </section>
  );
}

export default function ReportView({ docState, error, p0, snapshots = [], reportStale, activeId, founderAnswers = {}, onAnswer, onBack, onGenerate, onDownloadHTML }) {
  const { chapters = {}, execSummary: ex } = docState;
  const chapterPasses = PASS_DEFS.slice(1).filter(pd => chapters[pd.id]);
  const questions = ex?.founder_questions || [];
  const toc = ex ? [
    ["summary", "Summary"], ["scores", "Scores"], ["findings", "Findings & risks"],
    ...(ex.tensions?.length ? [["tensions", "Tensions"]] : []),
    ...(questions.length ? [["questions", "Founder questions"]] : []),
    ["recommendation", "Recommendation"],
    ...(snapshots.length > 1 ? [["history", "Report history"]] : []),
    ...chapterPasses.map(pd => [`ch-${pd.id}`, pd.title]),
  ] : [];
  const band = scoreBand(ex?.score_total ?? Number.parseFloat(ex?.score));

  return (
    <div className="flex-1 overflow-y-auto bg-gray-50 print:bg-white">
      <div className="max-w-6xl mx-auto px-6 py-6 print:p-0">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 mb-6 print:hidden">
          <button onClick={onBack} className="text-sm text-gray-600 hover:text-gray-900 flex items-center gap-1 mr-auto"><ChevronLeft size={15} /> Back to analysis</button>
          {!docState.generating && !ex && (
            <button onClick={onGenerate} className="px-4 py-2 text-sm bg-gray-900 text-white rounded-lg hover:bg-gray-700 flex items-center gap-2"><Play size={13} /> Generate report</button>
          )}
          {ex && (
            <>
              <button onClick={onGenerate} disabled={docState.generating}
                className={`px-3 py-1.5 text-sm rounded-lg flex items-center gap-1.5 disabled:opacity-40 ${reportStale ? "bg-amber-500 text-white hover:bg-amber-600" : "bg-white border border-gray-200 hover:bg-gray-50"}`}
                title={reportStale ? "Analyses changed since this report was written" : ""}>
                <RotateCcw size={13} /> {reportStale ? "Out of date — regenerate" : "Regenerate"}
              </button>
              <button onClick={() => window.print()} className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"><Printer size={13} /> Print / PDF</button>
              {[["docx", "Word"], ["xlsx", "Excel"], ["md", "Markdown"]].map(([fmt, label]) => (
                <a key={fmt} href={`/api/projects/${activeId}/export?format=${fmt}${fmt === "docx" ? "&appendix=1" : ""}`} download
                  className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"><Download size={13} /> {label}</a>
              ))}
              <button onClick={onDownloadHTML} className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 flex items-center gap-1.5"><Download size={13} /> HTML</button>
            </>
          )}
        </div>

        {docState.generating && (
          <div className="flex flex-col items-center justify-center py-24 gap-3 text-center">
            <Loader size={28} className="animate-spin text-gray-500" />
            <p className="text-sm text-gray-700">{docState.progress}</p>
            <p className="text-xs text-gray-500">Runs on the server — you can leave this page and come back.</p>
          </div>
        )}
        {error && !docState.generating && (
          <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-4 flex items-start gap-2 print:hidden">
            <AlertTriangle size={14} className="text-red-600 mt-0.5 flex-shrink-0" /><p className="text-sm text-red-800">{error}</p>
          </div>
        )}
        {!docState.generating && !ex && !error && (
          <div className="text-center py-24 text-gray-500">
            <FileText size={36} className="mx-auto mb-3 opacity-40" />
            <p className="text-base text-gray-800 font-medium">No report yet</p>
            <p className="text-sm mt-1">Generating writes one chapter per analysis pass and an executive summary with a rubric score.</p>
          </div>
        )}

        {!docState.generating && ex && (
          <div className="flex gap-8">
            {/* Sticky table of contents */}
            <nav className="hidden lg:block w-48 flex-shrink-0 print:hidden" aria-label="Report sections">
              <div className="sticky top-6 space-y-0.5">
                {toc.map(([id, label]) => (
                  <a key={id} href={`#${id}`} className="block text-sm text-gray-600 hover:text-gray-900 hover:bg-white rounded-md px-2 py-1">{label}</a>
                ))}
              </div>
            </nav>

            <div className="flex-1 min-w-0 space-y-5">
              {/* Cover */}
              <Section id="summary">
                <div className="flex flex-wrap items-start gap-6">
                  <div className="flex-1 min-w-[260px]">
                    <h1 className="text-3xl font-semibold text-gray-900">{p0?.venture_name || "Venture analysis"}</h1>
                    <p className="text-sm text-gray-500 mt-1">
                      {new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
                      {p0?.stage && ` · ${p0.stage}`}{p0?.classification?.business_model && ` · ${p0.classification.business_model.toUpperCase()}`} · {chapterPasses.length} chapters
                    </p>
                  </div>
                  <div className="text-right">
                    <div className="flex items-center gap-3 justify-end">
                      <span className={`px-3 py-1 rounded-full text-sm font-semibold ${band.chip}`}>{ex.verdict}</span>
                      <span className="text-4xl font-bold text-gray-900">{ex.score}</span>
                    </div>
                    <div className="mt-1 flex justify-end"><Sparkline points={[...snapshots].reverse().map(s => s.score)} label="Score across report versions" /></div>
                  </div>
                </div>
                {ex.investment_thesis && <p className="text-base text-gray-800 italic border-l-4 border-gray-900 pl-4 mt-5">{ex.investment_thesis}</p>}
                {ex.executive_summary && <div className={`${PROSE} mt-4`}><ReactMarkdown remarkPlugins={[remarkGfm]}>{ex.executive_summary}</ReactMarkdown></div>}
              </Section>

              <Section id="scores" title="Score by dimension">
                <p className="text-xs text-gray-500 mb-4">{ex.score_rationale}</p>
                <ScoreBars breakdown={ex.score_breakdown || []} />
              </Section>

              <div id="findings" className="grid md:grid-cols-2 gap-5 scroll-mt-6">
                <Section title="Strongest findings" icon={<TrendingUp size={16} className="text-emerald-600" />}>
                  <ul className="space-y-2">{(ex.strongest_findings || []).map((f, i) => <li key={i} className="text-sm text-gray-800 flex gap-2"><Check size={14} className="text-emerald-600 flex-shrink-0 mt-0.5" />{f}</li>)}</ul>
                </Section>
                <Section title="Key risks" icon={<ShieldAlert size={16} className="text-red-600" />}>
                  <ul className="space-y-2">{(ex.key_risks || []).map((r, i) => <li key={i} className="text-sm text-gray-800 flex gap-2"><AlertTriangle size={14} className="text-red-600 flex-shrink-0 mt-0.5" />{r}</li>)}</ul>
                </Section>
              </div>

              {ex.tensions?.length > 0 && (
                <Section id="tensions" title="Tensions across the analysis" icon={<Scale size={16} className="text-amber-600" />}>
                  <p className="text-xs text-gray-500 mb-3">Places where two parts of the analysis disagree. Resolve these before relying on the score.</p>
                  <div className="grid md:grid-cols-2 gap-3">
                    {ex.tensions.map((t, i) => {
                      const parts = t.split(/\s+(?:contradicts|vs\.?|versus|but)\s+/i);
                      return (
                        <div key={i} className="rounded-xl border border-amber-200 bg-amber-50/50 p-3.5">
                          {parts.length === 2 ? (
                            <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-sm text-gray-800">
                              <span>{parts[0]}</span><span className="text-amber-700 font-semibold text-xs">vs</span><span>{parts[1]}</span>
                            </div>
                          ) : <p className="text-sm text-gray-800">{t}</p>}
                        </div>
                      );
                    })}
                  </div>
                </Section>
              )}

              {questions.length > 0 && (
                <Section id="questions" title="Questions for the founders">
                  <p className="text-xs text-gray-500 mb-3">Track the diligence conversation here. Answers are saved with the deal and visible to your team; feed them into a revision with Revise.</p>
                  <ol className="space-y-3">
                    {questions.map((q, i) => {
                      const a = founderAnswers[q] || {};
                      return (
                        <li key={i} className="rounded-xl border border-gray-200 p-3">
                          <label className="flex items-start gap-2.5 cursor-pointer">
                            <input type="checkbox" checked={!!a.asked} onChange={e => onAnswer(q, { asked: e.target.checked })} className="mt-1" aria-label="Asked" />
                            <span className={`text-sm flex-1 ${a.answer?.trim() ? "text-gray-500" : "text-gray-900"}`}><span className="font-semibold mr-1">{i + 1}.</span>{q}</span>
                            {a.answer?.trim() ? <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700">answered</span> : a.asked ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-800">asked</span> : null}
                          </label>
                          {(a.asked || a.answer) && (
                            <textarea value={a.answer || ""} onChange={e => onAnswer(q, { answer: e.target.value, asked: true })} rows={2}
                              placeholder="Founder's answer…" className="mt-2 w-full text-sm px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 print:border-0" />
                          )}
                        </li>
                      );
                    })}
                  </ol>
                </Section>
              )}

              {ex.recommendation && (
                <section id="recommendation" className="scroll-mt-6 bg-gray-900 text-white rounded-2xl p-6 print:bg-white print:text-gray-900 print:border print:border-gray-300">
                  <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-300 print:text-gray-600 mb-2">Recommendation</h2>
                  <p className="text-base leading-relaxed">{ex.recommendation}</p>
                </section>
              )}

              {snapshots.length > 1 && (
                <Section id="history" title="Report history">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-gray-500"><th className="font-medium pb-1.5">Generated</th><th className="font-medium">Verdict</th><th className="font-medium">Score</th><th className="font-medium">Change</th><th className="font-medium">What moved</th></tr></thead>
                    <tbody>
                      {snapshots.map((sn, i) => (
                        <tr key={sn.id} className="border-t border-gray-100">
                          <td className="py-2">{new Date(sn.created_at).toLocaleString()}{i === 0 && <span className="text-gray-500"> · latest</span>}</td>
                          <td>{sn.verdict}</td><td className="font-semibold">{sn.score ?? "n/a"}</td>
                          <td className={sn.delta > 0 ? "text-emerald-700" : sn.delta < 0 ? "text-red-700" : "text-gray-500"}>{sn.delta === null ? "—" : sn.delta === 0 ? "no change" : sn.delta > 0 ? `▲ +${sn.delta}` : `▼ ${sn.delta}`}</td>
                          <td className="text-gray-600">{sn.dimensionChanges?.map(d => `${d.id.replace("_", " ")} ${d.from ?? "n/a"}→${d.to ?? "n/a"}`).join(", ")}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Section>
              )}

              {chapterPasses.map(pd => (
                <Section key={pd.id} id={`ch-${pd.id}`} className="print:break-before-page">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Chapter · P{pd.num}</div>
                  <h2 className="text-xl font-semibold text-gray-900 mb-3">{pd.title}</h2>
                  <div className={PROSE}><CitedMarkdown>{normalizeMarkdown(chapters[pd.id])}</CitedMarkdown></div>
                </Section>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

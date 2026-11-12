"use client";
// The deal's home screen: where it stands, what to do next, and the headline results.
import { ArrowRight, Play, FileText, AlertTriangle, HelpCircle, TrendingUp, ShieldAlert, Loader, Wrench, Eye } from "lucide-react";
import { ScoreBars, Sparkline, ProgressRing, Pill, STATUS_COLOR, scoreBand } from "@/components/ui";

const GROUPS = [
  { label: "Foundation", passes: ["p1", "p8"] },
  { label: "Market & customers", passes: ["p2", "p3", "p4"] },
  { label: "Strategy", passes: ["p5", "p6"] },
  { label: "Synthesis", passes: ["p7", "p9"] },
];

export function passColor(pg, status, stale) {
  const ms = pg.methods.filter(m => m.decision !== "skip");
  if (ms.some(m => status[m.id] === "error")) return STATUS_COLOR.error;
  if (ms.some(m => status[m.id] === "extracting" || status[m.id] === "executing")) return STATUS_COLOR.running;
  if (ms.some(m => status[m.id] === "review")) return STATUS_COLOR.review;
  if (stale) return "#ea580c";
  return STATUS_COLOR.done;
}

const NEXT_ICON = { runAll: Play, review: Eye, fix: Wrench, report: FileText, share: ArrowRight, wait: Loader, setup: ArrowRight };

export default function DealOverview({ p0, exec, snapshots = [], passGroups, methodStatus, staleMap, progress, next, onNext, onNavigate, founderAnswers = {}, revisionCount = 0, activity }) {
  const NextIcon = NEXT_ICON[next.kind] || ArrowRight;
  const scoreTrend = [...snapshots].reverse().map(s => s.score);
  const questions = exec?.founder_questions || [];
  const answered = questions.filter(q => founderAnswers[q]?.answer?.trim()).length;
  const pct = progress.total ? Math.round((progress.done / progress.total) * 100) : 0;
  const band = scoreBand(exec?.score_total ?? Number.parseFloat(exec?.score));

  return (
    <div className="max-w-5xl space-y-4">
      {/* Hero: where the deal stands + the one next action */}
      <section className="bg-white rounded-2xl border border-gray-200 p-6">
        <div className="flex flex-wrap items-start gap-6">
          <div className="flex-1 min-w-[280px]">
            <div className="flex items-center gap-2 mb-1.5 flex-wrap">
              {p0?.stage && <Pill>{p0.stage}</Pill>}
              {p0?.classification?.business_model && <Pill>{p0.classification.business_model.toUpperCase()}</Pill>}
              {p0?.classification?.market_maturity && <Pill>{p0.classification.market_maturity} market</Pill>}
            </div>
            <h1 className="text-2xl font-semibold text-gray-900">{p0?.venture_name || "Untitled deal"}</h1>
            <p className="text-sm text-gray-600 mt-1.5 leading-relaxed max-w-2xl">{p0?.venture_summary}</p>
          </div>
          <div className="text-right">
            {exec ? (
              <>
                <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Latest verdict</div>
                <div className="flex items-center gap-3 justify-end">
                  <span className={`px-3 py-1 rounded-full text-sm font-semibold ${band.chip}`}>{exec.verdict}</span>
                  <span className="text-3xl font-bold text-gray-900">{exec.score}</span>
                </div>
                <div className="mt-1.5 flex justify-end"><Sparkline points={scoreTrend} label="Score across report versions" /></div>
              </>
            ) : (
              <div className="text-sm text-gray-500 max-w-[220px]">No report yet. The verdict and score appear once the report is generated.</div>
            )}
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-4 border-t border-gray-100 pt-5">
          <button onClick={onNext} disabled={next.kind === "wait"}
            className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-gray-900 text-white text-sm font-medium hover:bg-gray-700 disabled:bg-gray-200 disabled:text-gray-600">
            <NextIcon size={15} className={next.kind === "wait" ? "animate-spin" : ""} /> {next.label}
          </button>
          <span className="text-sm text-gray-600">{next.detail}</span>
          <div className="ml-auto min-w-[220px] flex-1 max-w-sm">
            <div className="flex justify-between text-xs text-gray-600 mb-1">
              <span>{progress.done} of {progress.total} analyses approved</span><span className="font-medium">{pct}%</span>
            </div>
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden flex" role="img" aria-label={`${progress.done} approved, ${progress.review} to review, ${progress.running} running, ${progress.error} failed`}>
              {[[progress.done, STATUS_COLOR.done], [progress.review, STATUS_COLOR.review], [progress.running, STATUS_COLOR.running], [progress.error, STATUS_COLOR.error]].map(([n, c], i) =>
                n > 0 && <div key={i} style={{ width: `${(n / progress.total) * 100}%`, background: c }} />)}
            </div>
            <div className="flex gap-3 text-[11px] text-gray-500 mt-1">
              {progress.review > 0 && <span>● <span style={{ color: STATUS_COLOR.review }}>{progress.review} to review</span></span>}
              {progress.running > 0 && <span>● <span style={{ color: STATUS_COLOR.running }}>{progress.running} running</span></span>}
              {progress.error > 0 && <span>● <span style={{ color: STATUS_COLOR.error }}>{progress.error} failed</span></span>}
            </div>
          </div>
        </div>
      </section>

      <div className="grid md:grid-cols-5 gap-4">
        {/* Scores */}
        <section className="md:col-span-3 bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Score by dimension</h2>
          {exec?.score_breakdown?.length
            ? <ScoreBars breakdown={exec.score_breakdown} />
            : <p className="text-sm text-gray-500">Each of the six rubric dimensions gets a score with its evidence once the report is generated. Unassessed dimensions show as hatched bars — they are excluded, never counted as zero.</p>}
        </section>

        {/* Passes */}
        <section className="md:col-span-2 bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Analysis passes</h2>
          <div className="space-y-3">
            {GROUPS.map(g => (
              <div key={g.label}>
                <div className="text-[11px] uppercase tracking-wide text-gray-500 mb-1">{g.label}</div>
                {g.passes.map(pid => {
                  const pg = passGroups.find(p => p.id === pid);
                  if (!pg || pg.totalActive === 0) return null;
                  const stale = pg.methods.some(m => staleMap[m.id]);
                  return (
                    <button key={pid} onClick={() => onNavigate(pid)} className="w-full flex items-center gap-2.5 py-1.5 px-1.5 -mx-1.5 rounded-lg hover:bg-gray-50 text-left">
                      <ProgressRing value={pg.doneCount} total={pg.totalActive} color={passColor(pg, methodStatus, stale)} />
                      <span className="text-sm text-gray-800 flex-1">{pg.title}</span>
                      {stale && <span className="text-[11px] text-orange-700">upstream changed</span>}
                      <span className="text-xs text-gray-500 tabular-nums">{pg.doneCount}/{pg.totalActive}</span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        </section>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><TrendingUp size={14} className="text-emerald-600" /> Strongest findings</h2>
          {exec?.strongest_findings?.length
            ? <ul className="space-y-1.5 text-sm text-gray-700">{exec.strongest_findings.slice(0, 4).map((f, i) => <li key={i} className="leading-snug">• {f}</li>)}</ul>
            : <p className="text-sm text-gray-500">Appear with the report.</p>}
        </section>
        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><ShieldAlert size={14} className="text-red-600" /> Key risks</h2>
          {exec?.key_risks?.length
            ? <ul className="space-y-1.5 text-sm text-gray-700">{exec.key_risks.slice(0, 4).map((r, i) => <li key={i} className="leading-snug">• {r}</li>)}</ul>
            : <p className="text-sm text-gray-500">Appear with the report.</p>}
        </section>
        <section className="bg-white rounded-2xl border border-gray-200 p-5">
          <h2 className="text-sm font-semibold text-gray-900 mb-2 flex items-center gap-1.5"><HelpCircle size={14} className="text-blue-600" /> Open questions</h2>
          {questions.length ? (
            <>
              <p className="text-xs text-gray-500 mb-2">{answered} of {questions.length} answered by the founders</p>
              <ul className="space-y-1.5 text-sm text-gray-700">
                {questions.filter(q => !founderAnswers[q]?.answer?.trim()).slice(0, 3).map((q, i) => <li key={i} className="leading-snug">• {q}</li>)}
              </ul>
            </>
          ) : <p className="text-sm text-gray-500">The report lists the questions to put to the founders.</p>}
          {revisionCount > 0 && (
            <button onClick={() => onNavigate("p0")} className="mt-3 w-full text-left text-xs text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 flex items-center gap-1.5 hover:bg-amber-100">
              <AlertTriangle size={12} /> {revisionCount} finding{revisionCount > 1 ? "s" : ""} challenge the initial scoping
            </button>
          )}
        </section>
      </div>

      {activity}
    </div>
  );
}

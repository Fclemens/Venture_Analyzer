// Decides the single most useful next action on a deal, for the overview's
// primary button. Pure (no I/O) so it is unit-tested.

const INFLIGHT = new Set(["extracting", "executing"]);

export function pipelineProgress(methods, status) {
  const active = methods.filter(m => m.decision !== "skip");
  const count = (pred) => active.filter(m => pred(status[m.id])).length;
  return {
    total: active.length,
    done: count(s => s === "done"),
    review: count(s => s === "review"),
    running: count(s => INFLIGHT.has(s)),
    error: count(s => s === "error"),
    extracted: count(s => s === "extracted"),
    notStarted: count(s => !s || s === "pending"),
  };
}

// report: { exists, generating, stale }  (stale = analyses changed after the last report)
export function nextStep({ methods = [], status = {}, report = {}, hasP0 = true }) {
  if (!hasP0) return { kind: "setup", label: "Start the analysis", detail: "Upload a deck or describe the concept." };
  const p = pipelineProgress(methods, status);
  const firstWith = (pred) => methods.find(m => m.decision !== "skip" && pred(status[m.id]));

  if (p.error) {
    const m = firstWith(s => s === "error");
    return { kind: "fix", label: `Retry ${p.error} failed ${p.error === 1 ? "analysis" : "analyses"}`, detail: `Starting with ${m.name}.`, pass: m.pass, methodId: m.id };
  }
  if (p.review) {
    const m = firstWith(s => s === "review");
    return { kind: "review", label: `Review ${p.review} ${p.review === 1 ? "analysis" : "analyses"}`, detail: "Approve, or revise with your notes.", pass: m.pass, methodId: m.id };
  }
  if (p.notStarted + p.extracted > 0) {
    return { kind: "runAll", label: `Run ${p.notStarted + p.extracted} remaining ${p.notStarted + p.extracted === 1 ? "analysis" : "analyses"}`, detail: p.running ? `${p.running} already running.` : "They run in the background; you can close this tab." };
  }
  if (p.running) return { kind: "wait", label: `${p.running} running…`, detail: "Results appear here as they finish." };
  if (report.generating) return { kind: "wait", label: "Report is being written…", detail: "Usually a few minutes." };
  if (!report.exists) return { kind: "report", label: "Generate the report", detail: "All analyses are approved." };
  if (report.stale) return { kind: "report", label: "Regenerate the report", detail: "Analyses changed since the last report." };
  return { kind: "share", label: "Open the report", detail: "Export it or share the deal with your team." };
}

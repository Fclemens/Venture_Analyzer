// What each job action does. Each handler reads its inputs from the database,
// calls the model steps, and writes results back; nothing depends on a browser.

import { randomUUID } from "crypto";
import { getProjectById, getSettings, patchProjectState } from "./db.js";
import {
  getRun, saveRun, appendVersion, listRuns,
  loadChunks, insertChunks, addWebSources, setJobProgress, insertSnapshot, deleteConnectorChunks,
} from "./runs.js";
import { PASS_DEFS } from "./constants.js";
import { runModel, describeModel } from "./finmodel.js";
import { runConnectors } from "./connectors/index.js";
import { embedBatch } from "./embeddings.js";
import {
  makeCaller, extractStep, executeStep, reviseStep, rechunkStep,
  chapterStep, executiveStep, competitorsFromChunks, ventureContextFromP0,
} from "./steps.js";

function projectContext(job) {
  const project = getProjectById(job.project_id); // access was authorised when the job was queued
  if (!project) throw new Error("Project not found");
  const s = project.state || {};
  return { state: s, ventureCtx: ventureContextFromP0(s.p0), settings: getSettings(job.user_id) };
}

// Web pages found while executing become sources + embedded chunks that later
// methods can retrieve. Failure here must never lose the analysis itself.
async function absorbWebResults({ job, settings, searchResults }) {
  if (!searchResults?.length) return [];
  const methodId = job.method_id;

  const webSources = searchResults.filter(r => r.url).map(r => ({
    id: randomUUID(),
    name: r.url.replace(/^https?:\/\//, "").slice(0, 60),
    rawText: r.text || r.title || r.url,
    retrievedBy: methodId,
    addedAt: new Date().toISOString(),
  }));
  addWebSources(job.project_id, webSources);

  try {
    const call = makeCaller({ userId: job.user_id, settings, step: "rechunk", projectId: job.project_id });
    const tagged = await rechunkStep({ call, searchResults, methodologyId: methodId });
    insertChunks(job.project_id, tagged);
    return competitorsFromChunks(tagged);
  } catch (err) {
    console.warn(`[jobs] rechunk failed for ${methodId}:`, err.message);
    return [];
  }
}

// Opt-in outside data (OpenAlex, SEC EDGAR). Replaces this method's previous
// connector evidence so re-extracting never duplicates it.
async function refreshConnectorEvidence({ job, settings, state }) {
  const items = await runConnectors({ methodId: job.method_id, settings, project: { p0: state.p0, entities: state.entities } });
  deleteConnectorChunks(job.project_id, job.method_id);
  if (!items.length) return;
  try {
    const embeddings = await embedBatch(items.map(i => i.text));
    items.forEach((it, i) => { it.embedding = embeddings[i]; });
  } catch (err) {
    console.warn("[connector] embedding failed, storing without vectors:", err.message);
  }
  insertChunks(job.project_id, items);
}

function priorOutputs(projectId) {
  const out = {};
  for (const r of listRuns(projectId, { full: true })) if (r.result) out[r.method_id] = r.result;
  return out;
}

// Run async tasks with at most `limit` in flight, preserving result order
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) { const i = next++; results[i] = await fn(items[i], i); }
  }));
  return results;
}

export const handlers = {
  async extract(job) {
    const { state, ventureCtx, settings } = projectContext(job);
    await refreshConnectorEvidence({ job, settings, state });
    const call = makeCaller({ userId: job.user_id, settings, step: "extract", projectId: job.project_id });
    const evidence = await extractStep({
      call,
      methodologyId: job.method_id,
      corpusText: state.corpusText || "",
      entities: state.entities,
      chunks: loadChunks(job.project_id),
      priorOutputs: priorOutputs(job.project_id),
      methodSummaries: state.methodSummaries || {},
      ventureCtx,
    });
    saveRun(job.project_id, job.method_id, { status: "extracted", evidence, error: null });
  },

  async execute(job) {
    const { ventureCtx, settings } = projectContext(job);
    const run = getRun(job.project_id, job.method_id);
    if (!run?.evidence) throw new Error("Evidence bundle missing - please re-extract.");
    const call = makeCaller({ userId: job.user_id, settings, step: "execute", projectId: job.project_id });
    const { text, searchResults } = await executeStep({
      call, methodologyId: job.method_id, evidenceBundle: run.evidence, ventureCtx, userNotes: job.payload?.notes || "",
    });
    const newCompetitors = await absorbWebResults({ job, settings, searchResults });
    saveRun(job.project_id, job.method_id, { status: "review", result: text, error: null, new_competitors: newCompetitors });
    appendVersion(job.project_id, job.method_id, "execute", text);
  },

  async revise(job) {
    const { ventureCtx, settings } = projectContext(job);
    const run = getRun(job.project_id, job.method_id);
    if (!run?.evidence || !run?.result) throw new Error("Nothing to revise - run the analysis first.");
    const call = makeCaller({ userId: job.user_id, settings, step: "revise", projectId: job.project_id });
    const { text, searchResults } = await reviseStep({
      call,
      methodologyId: job.method_id,
      evidenceBundle: run.evidence,
      priorResult: run.result,
      userNotes: job.payload?.notes || "",
      ventureCtx,
      chunks: loadChunks(job.project_id),
    });
    const newCompetitors = await absorbWebResults({ job, settings, searchResults });
    saveRun(job.project_id, job.method_id, { status: "review", result: text, error: null, new_competitors: newCompetitors });
    appendVersion(job.project_id, job.method_id, "revise", text);
  },

  // Whole report: chapters in parallel, then the executive summary. Runs on the
  // server so it survives closing the tab; result is stored in the project state
  // and a snapshot is kept so score changes over time can be compared.
  async report(job) {
    const { state, ventureCtx, settings } = projectContext(job);
    const runs = Object.fromEntries(listRuns(job.project_id, { full: true }).map(r => [r.method_id, r]));
    const methods = (state.methods || []).filter(m => m.decision !== "skip" && runs[m.id]?.result);
    const passes = PASS_DEFS.slice(1).filter(pd => methods.some(m => m.pass === pd.id));
    if (!passes.length) throw new Error("Nothing to report on yet - run at least one analysis first.");

    const call = makeCaller({ userId: job.user_id, settings, step: "report", projectId: job.project_id });
    let done = 0;
    setJobProgress(job.id, `Writing chapters (0/${passes.length})…`);
    const texts = await mapLimit(passes, 3, async (pd) => {
      const methodResults = Object.fromEntries(methods.filter(m => m.pass === pd.id).map(m => [m.id, runs[m.id].result]));
      const text = await chapterStep({ call, passId: pd.id, passTitle: pd.title, methodResults, passSummary: state.passSummaries?.[pd.id] || null, ventureCtx });
      setJobProgress(job.id, `Writing chapters (${++done}/${passes.length})…`);
      return text;
    });
    const chapters = Object.fromEntries(passes.map((pd, i) => [pd.id, texts[i]]));

    setJobProgress(job.id, "Writing executive summary…");
    const finSummary = describeModel(runModel(state.finModel?.assumptions, state.finModel?.scenarios), state.finModel?.currency ? state.finModel.currency + " " : "");
    const execSummary = await executiveStep({ call, chapters, ventureCtx, finSummary });

    patchProjectState(job.project_id, { docChapters: chapters, docExecSummary: execSummary });
    insertSnapshot(job.project_id, execSummary);
  },
};

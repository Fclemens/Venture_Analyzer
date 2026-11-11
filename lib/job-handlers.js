// What each job action does. Each handler reads its inputs from the database,
// calls the model steps, and writes results back; nothing depends on a browser.

import { randomUUID } from "crypto";
import { getProject, getSettings } from "./db.js";
import {
  getRun, saveRun, appendVersion, listRuns,
  loadChunks, insertChunks, addWebSources,
} from "./runs.js";
import {
  makeCaller, extractStep, executeStep, reviseStep, rechunkStep,
  competitorsFromChunks, ventureContextFromP0,
} from "./steps.js";

function projectContext(job) {
  const project = getProject(job.project_id, job.user_id);
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
    const call = makeCaller({ userId: job.user_id, settings, step: "rechunk" });
    const tagged = await rechunkStep({ call, searchResults, methodologyId: methodId });
    insertChunks(job.project_id, tagged);
    return competitorsFromChunks(tagged);
  } catch (err) {
    console.warn(`[jobs] rechunk failed for ${methodId}:`, err.message);
    return [];
  }
}

function priorOutputs(projectId) {
  const out = {};
  for (const r of listRuns(projectId, { full: true })) if (r.result) out[r.method_id] = r.result;
  return out;
}

export const handlers = {
  async extract(job) {
    const { state, ventureCtx, settings } = projectContext(job);
    const call = makeCaller({ userId: job.user_id, settings, step: "extract" });
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
    const call = makeCaller({ userId: job.user_id, settings, step: "execute" });
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
    const call = makeCaller({ userId: job.user_id, settings, step: "revise" });
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
};

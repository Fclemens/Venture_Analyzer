// Pipeline steps shared by the HTTP route (setup/summary/compile steps) and the
// background job handlers (extract / execute / revise / rechunk).
// Nothing here knows about HTTP or auth.

import { callModel } from "./llm.js";
import { logEvent } from "./db.js";
import { parseJSON } from "./json.js";
import { fence } from "./security-client.js";
import {
  METHODOLOGY_REGISTRY,
  getExtractSystem, getExecuteSystem, getReviseSystem,
  getChapterSystem, getExecutiveSystem,
  RECHUNK_SYSTEM, buildExtractContext,
} from "./registry.js";
import { SCORE_DIMENSIONS } from "./constants.js";
import { computeScore } from "./scoring.js";
import { embedBatch, hybridRetrieve } from "./embeddings.js";

export const TRUNCATION_NOTE = "\n\n> ⚠ **This output hit the model's length limit and may be incomplete.** Re-run, or choose a model with a larger output window in Settings.";

// Compact venture header injected into every extract/execute call
export function ventureHeader(ventureCtx) {
  if (!ventureCtx?.venture_name) return "";
  const c = ventureCtx.classification || {};
  return `VENTURE: ${ventureCtx.venture_name} | ${c.business_model?.toUpperCase() || "?"} | ${ventureCtx.stage || "?"}
SUMMARY: ${ventureCtx.venture_summary || ""}
`;
}

export function ventureContextFromP0(p0) {
  return p0 ? { venture_name: p0.venture_name, venture_summary: p0.venture_summary, stage: p0.stage, classification: p0.classification } : null;
}

// Logged model caller — records every call with step, model and real token usage.
//   json: true → output is parsed (one corrective retry on bad/truncated JSON)
//                and returned as result.json
export function makeCaller({ userId, settings, step, projectId = null }) {
  return async function callModelLogged({ json = false, ...args }) {
    const roleConfig = settings.roles?.[args.role];
    const logCall = (r) => logEvent({
      userId,
      eventType: "pipeline_call",
      step,
      model: roleConfig?.model || args.role,
      inputText:  args.messages?.map(m => typeof m.content === "string" ? m.content : "").join("") || "",
      outputText: r.text || "",
      usage: r.usage,
      projectId,
    });

    const result = await callModel(args, settings);
    logCall(result);
    if (!json) return result;

    try {
      return { ...result, json: parseJSON(result.text) };
    } catch (firstErr) {
      const retry = await callModel({
        ...args,
        maxTokens: result.truncated ? Math.min((args.maxTokens || 16000) * 2, 32000) : args.maxTokens,
        messages: [
          ...args.messages,
          { role: "assistant", content: (result.text || "").slice(0, 4000) },
          { role: "user", content: "Your previous reply was not valid, complete JSON. Reply again with ONLY the complete JSON object, no commentary." },
        ],
      }, settings);
      logCall(retry);
      try {
        return { ...retry, json: parseJSON(retry.text) };
      } catch {
        throw new Error(`The model returned invalid JSON twice (${firstErr.message}). Try again or switch model in Settings.`);
      }
    }
  };
}

function methodDef(methodologyId) {
  const mDef = METHODOLOGY_REGISTRY[methodologyId];
  if (!mDef) throw new Error(`Unknown methodology: ${methodologyId}`);
  return mDef;
}

// ── Extract evidence (hybrid retrieval over the project's chunks) ─────────────
export async function extractStep({ call, methodologyId, corpusText, entities, chunks, priorOutputs, methodSummaries, ventureCtx }) {
  const mDef = methodDef(methodologyId);
  const hybridChunks = chunks?.length
    ? await hybridRetrieve(mDef.extract_query, chunks, mDef.entity_filter, mDef.data_type_filter, 30)
    : [];
  const context = buildExtractContext(mDef, corpusText, hybridChunks, priorOutputs, methodSummaries || {});
  const result = await call({
    role: "fast",
    json: true,
    system: `${ventureHeader(ventureCtx)}${getExtractSystem(mDef, entities)}`,
    messages: [{ role: "user", content: `${context}\n\nExtract evidence for "${mDef.name}".` }],
  });
  return result.json;
}

// ── Execute a methodology ────────────────────────────────────────────────────
export async function executeStep({ call, methodologyId, evidenceBundle, ventureCtx, userNotes }) {
  const mDef = methodDef(methodologyId);
  const result = await call({
    role: "smart",
    system: `${ventureHeader(ventureCtx)}${getExecuteSystem(mDef, ventureCtx)}`,
    messages: [{ role: "user", content: `EVIDENCE BUNDLE:\n${fence("evidence bundle", JSON.stringify(evidenceBundle, null, 2))}\n\n${userNotes ? `USER NOTES:\n${userNotes}\n\n` : ""}Execute the "${mDef.name}" methodology. Use web search to fill gaps.` }],
    useSearch: true,
  });
  return { text: result.text + (result.truncated ? TRUNCATION_NOTE : ""), searchResults: result.searchResults };
}

// ── Revise an existing analysis with notes and any newly added evidence ──────
export async function reviseStep({ call, methodologyId, evidenceBundle, priorResult, userNotes, ventureCtx, chunks }) {
  const mDef = methodDef(methodologyId);
  const hybridChunks = chunks?.length
    ? await hybridRetrieve(mDef.extract_query, chunks, mDef.entity_filter, mDef.data_type_filter, 30)
    : [];
  const newEvidenceSection = hybridChunks.length
    ? `\n\nNEW EVIDENCE FROM ADDITIONAL DOCUMENTS:\n${fence("additional evidence", hybridChunks.map((c, i) => `[New${i}] ${c.entity}|${c.data_type}|via:${c.retrieved_by}\n${c.text}`).join("\n\n"))}`
    : "";
  const res = await call({
    role: "smart",
    system: `${ventureHeader(ventureCtx)}${getReviseSystem(mDef, ventureCtx)}`,
    messages: [{ role: "user", content: `PRIOR DRAFT:\n${priorResult}\n\nEVIDENCE BUNDLE:\n${fence("evidence bundle", JSON.stringify(evidenceBundle, null, 2))}${newEvidenceSection}\n\n${userNotes ? `USER NOTES:\n${userNotes}\n\n` : ""}Revise the analysis. Use web search if needed.` }],
    useSearch: true,
  });
  return { text: res.text + (res.truncated ? TRUNCATION_NOTE : ""), searchResults: res.searchResults };
}

// ── Turn raw web results into tagged, embedded chunks ────────────────────────
export async function rechunkStep({ call, searchResults, methodologyId }) {
  if (!searchResults?.length) return [];
  const searchText = searchResults
    .filter(r => r.text?.length > 50)
    .map((r, i) => `[Source ${i}: ${r.title}]\nURL: ${r.url}\n${r.text}`)
    .join("\n\n---\n\n")
    .slice(0, 40000);
  if (!searchText.trim()) return [];

  const result = await call({
    role: "fast",
    system: RECHUNK_SYSTEM,
    messages: [{ role: "user", content: `Web search results from "${methodologyId}". Extract and tag useful data points.\n\n${fence("web search results", searchText)}` }],
  });

  let raw = [];
  try { raw = parseJSON(result.text); } catch { raw = []; }
  if (!Array.isArray(raw)) raw = [];

  const tagged = raw
    .filter(c => c && typeof c.text === "string" && c.text.trim())
    .map(c => ({ ...c, source_type: "web_search", retrieved_by: methodologyId, ingested_at: new Date().toISOString() }));
  if (tagged.length) {
    const embeddings = await embedBatch(tagged.map(c => c.text));
    tagged.forEach((c, i) => { c.embedding = embeddings[i]; });
  }
  return tagged;
}

// Competitor names discovered in entity tags, e.g. "competitor:Acme Corp"
export function competitorsFromChunks(chunks) {
  const names = chunks
    .filter(c => typeof c.entity === "string" && c.entity.toLowerCase().startsWith("competitor:"))
    .map(c => c.entity.split(":")[1]?.split("|")[0]?.trim())
    .filter(Boolean);
  return [...new Set(names)];
}


// ── Report: one narrative chapter per pass ───────────────────────────────────
export async function chapterStep({ call, passId, passTitle, methodResults, passSummary, ventureCtx }) {
  const methodsText = Object.entries(methodResults)
    .map(([id, text]) => `### ${METHODOLOGY_REGISTRY[id]?.name || id}\n\n${text}`)
    .join("\n\n---\n\n");
  const passSummaryText = passSummary
    ? `\n\nPASS SUMMARY:\nVerdict: ${passSummary.pass_verdict || ""}\nStrongest findings: ${(passSummary.strongest_findings || []).join("; ")}\nKey risks: ${(passSummary.key_risks || []).join("; ")}`
    : "";
  const res = await call({
    role: "doc_chapter",
    system: `${ventureHeader(ventureCtx)}${getChapterSystem({ id: passId, title: passTitle }, ventureCtx)}`,
    messages: [{ role: "user", content: `Write the chapter for "${passTitle}" using these methodology results:${passSummaryText}\n\n${fence("methodology results", methodsText.slice(0, 40000))}` }],
  });
  return res.text + (res.truncated ? TRUNCATION_NOTE : "");
}

// ── Report: executive summary. Score and verdict are computed in code. ────────
export async function executiveStep({ call, chapters, ventureCtx, finSummary }) {
  const chaptersText = Object.entries(chapters)
    .map(([passId, text]) => `## ${passId}\n\n${text}`)
    .join("\n\n---\n\n");
  const res = await call({
    role: "doc_exec",
    json: true,
    system: `${ventureHeader(ventureCtx)}${getExecutiveSystem(ventureCtx)}`,
    messages: [{ role: "user", content: `Synthesise these analytical chapters into the executive summary:\n\n${fence("chapters", chaptersText.slice(0, 80000))}${finSummary ? `\n\nCOMPUTED FINANCIAL MODEL (deterministic output of the user's assumptions - quote these numbers, do not recompute or contradict them):\n${String(finSummary).slice(0, 4000)}` : ""}` }],
  });

  // A dimension is forced to null when none of the passes that inform it were run
  const ran = new Set(Object.keys(chapters || {}));
  const dimScores = { ...(res.json.dimension_scores || {}) };
  for (const d of SCORE_DIMENSIONS) {
    if (!d.passes.some(p => ran.has(p))) dimScores[d.id] = { score: null, confidence: null, evidence: ["Not assessed - the relevant analysis pass was not run."] };
  }
  const computed = computeScore(dimScores);
  const out = {
    ...res.json,
    score_breakdown: computed.dimensions,
    score_coverage: computed.coverage,
    score_total: computed.total,
    verdict: computed.verdict,
    score: computed.score,
    score_rationale: computed.score_rationale,
  };
  delete out.dimension_scores;
  return out;
}

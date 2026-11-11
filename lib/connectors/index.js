// Outside-data connectors: public sources that supplement web search.
//
// PRIVACY: connectors send the company name, product description keywords or
// founder names to third-party services. Pitch decks are usually confidential,
// so every connector is OFF by default and enabled per user in Settings.
//
// SAFETY: a connector never throws into the pipeline - any network error,
// timeout or unexpected response shape yields no evidence (and a console
// warning), never a failed analysis. Results are plain evidence chunks with a
// source URL, so they are cited like any other evidence.

import { openalex } from "./openalex.js";
import { secEdgar } from "./sec-edgar.js";

export const CONNECTORS = { openalex, sec_edgar: secEdgar };

// Which connectors are relevant to which method
export const METHOD_CONNECTORS = {
  team_assessment: ["openalex"],
  product_tech_assessment: ["openalex"],
  traction_analysis: ["sec_edgar"],
  deal_valuation: ["sec_edgar"],
};

// Returns evidence chunks (no embeddings yet) for one method.
export async function runConnectors({ methodId, settings, project }) {
  const out = [];
  for (const id of METHOD_CONNECTORS[methodId] || []) {
    if (!settings?.connectors?.[id]?.enabled) continue;
    try {
      const items = await CONNECTORS[id].fetchEvidence(project);
      for (const it of items || []) {
        out.push({
          text: it.text,
          entity: it.entity || "general",
          data_type: it.data_type || "general",
          source_type: "connector",
          retrieved_by: `${id}:${methodId}`,
          source_url: it.url || null,
          published: it.published || null,
          confidence: it.confidence ?? 0.6,
          pass_relevance: [],
        });
      }
    } catch (err) {
      console.warn(`[connector:${id}] skipped:`, err.message);
    }
  }
  return out;
}

export async function getJson(url, { headers = {}, timeoutMs = 8000 } = {}) {
  const res = await fetch(url, { headers: { Accept: "application/json", ...headers }, signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = (await res.text()).slice(0, 2_000_000);
  return JSON.parse(text);
}

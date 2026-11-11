// OpenAlex (https://docs.openalex.org) — free, no key. Used for research
// output around a technology and for people's publication record.
// Name matches are NOT identity-verified: evidence says so explicitly.

import { getJson } from "./index.js";

const BASE = "https://api.openalex.org";
const mailto = () => (process.env.CONNECTOR_CONTACT_EMAIL ? `&mailto=${encodeURIComponent(process.env.CONNECTOR_CONTACT_EMAIL)}` : "");

export function worksUrl(query) {
  return `${BASE}/works?search=${encodeURIComponent(query)}&per-page=5&sort=cited_by_count:desc&select=id,display_name,publication_year,cited_by_count,doi${mailto()}`;
}
export function authorsUrl(name) {
  return `${BASE}/authors?search=${encodeURIComponent(name)}&per-page=3&select=id,display_name,works_count,cited_by_count,last_known_institutions${mailto()}`;
}

export function parseWorks(json, query) {
  return (json?.results || []).filter(w => w?.display_name).slice(0, 5).map(w => ({
    text: `Research paper related to "${query}": "${w.display_name}" (${w.publication_year ?? "year n/a"}), cited ${w.cited_by_count ?? 0} times.`,
    url: w.doi || w.id,
    published: w.publication_year ? String(w.publication_year) : null,
    data_type: "product", entity: "market", confidence: 0.6,
  }));
}

export function parseAuthors(json, name) {
  return (json?.results || []).filter(a => a?.display_name).slice(0, 3).map(a => {
    const inst = (a.last_known_institutions || []).map(i => i?.display_name).filter(Boolean).join(", ");
    return {
      text: `Possible match for "${name}" in OpenAlex: ${a.display_name}${inst ? ` (${inst})` : ""}, ${a.works_count ?? 0} publications, ${a.cited_by_count ?? 0} citations. NAME MATCH ONLY - identity not verified; confirm it is the same person before relying on it.`,
      url: a.id, data_type: "team", entity: "people", confidence: 0.4,
    };
  });
}

export const openalex = {
  async fetchEvidence(project) {
    const out = [];
    const people = (project.entities?.people || []).filter(p => typeof p === "string" && p.trim().length > 3).slice(0, 4);
    for (const name of people) out.push(...parseAuthors(await getJson(authorsUrl(name)), name));
    const kw = String(project.p0?.product_service || "").replace(/\s+/g, " ").trim().slice(0, 100);
    if (kw.length > 8) out.push(...parseWorks(await getJson(worksUrl(kw)), kw));
    return out;
  },
};

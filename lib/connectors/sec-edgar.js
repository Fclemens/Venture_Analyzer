// SEC EDGAR full-text search (https://www.sec.gov/search-filings/edgar-search-assistance).
// Free, but the SEC requires a contact address in the User-Agent: set
// SEC_CONTACT_EMAIL, otherwise this connector stays off.
// Form D = notice of an exempt securities offering (typical US venture round).
// The search index exposes filing metadata only (not the amount raised), so
// evidence is limited to "a Form D was filed on <date> by <entity>".

import { getJson } from "./index.js";

export function searchUrl(company) {
  return `https://efts.sec.gov/LATEST/search-index?q=${encodeURIComponent(`"${company}"`)}&forms=D`;
}

export function parseFilings(json, company) {
  const hits = json?.hits?.hits || [];
  const want = company.toLowerCase();
  return hits.map(h => h?._source).filter(Boolean)
    // keep only filings whose filer name actually contains the company name
    .filter(src => (src.display_names || []).some(n => String(n).toLowerCase().includes(want)))
    .slice(0, 5)
    .map(src => {
      const filer = (src.display_names || []).find(n => String(n).toLowerCase().includes(want));
      const cik = (src.ciks || [])[0];
      const adsh = String(src.adsh || "");
      return {
        text: `SEC Form D (exempt securities offering) filed ${src.file_date || "date n/a"} by ${filer}. A Form D indicates the company raised or was raising capital in the US; amounts are not in this index - check the filing itself.`,
        url: cik && adsh ? `https://www.sec.gov/Archives/edgar/data/${Number(cik)}/${adsh.replace(/-/g, "")}/` : "https://www.sec.gov/edgar/search/",
        published: src.file_date || null,
        data_type: "deal", entity: "startup", confidence: 0.7,
      };
    });
}

export const secEdgar = {
  async fetchEvidence(project) {
    const contact = process.env.SEC_CONTACT_EMAIL;
    if (!contact) throw new Error("SEC_CONTACT_EMAIL is not set");
    const name = String(project.p0?.venture_name || "").trim();
    if (name.length < 3) return [];
    return parseFilings(await getJson(searchUrl(name), { headers: { "User-Agent": `VentureAnalyzer ${contact}` } }), name);
  },
};

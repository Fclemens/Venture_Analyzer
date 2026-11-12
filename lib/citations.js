// Finds citation and claim markers in analysis text so the UI can turn them
// into interactive chips. Pure; unit-tested.
//   [E3] / [E1, E4]        → evidence items from the method's evidence bundle
//   [VERIFIED] etc.        → claim-check tags required by the prompts
//   [Doc2] [Web5] [New1]   → retrieved passages referenced while writing

const RE = /\[(E\d+(?:\s*,\s*E\d+)*)\]|\[(VERIFIED|UNVERIFIED|CONTRADICTED)\]|\[((?:Doc|Web|New)\d+)\]/g;

export function splitCitations(text) {
  const out = [];
  let last = 0;
  for (const m of String(text).matchAll(RE)) {
    if (m.index > last) out.push({ type: "text", value: text.slice(last, m.index) });
    if (m[1]) for (const id of m[1].split(/\s*,\s*/)) out.push({ type: "evidence", id });
    else if (m[2]) out.push({ type: "claim", kind: m[2] });
    else out.push({ type: "passage", ref: m[3] });
    last = m.index + m[0].length;
  }
  if (last < String(text).length) out.push({ type: "text", value: String(text).slice(last) });
  return out;
}

export function claimCounts(text) {
  const c = { VERIFIED: 0, UNVERIFIED: 0, CONTRADICTED: 0 };
  for (const t of splitCitations(text || "")) if (t.type === "claim") c[t.kind]++;
  return c;
}

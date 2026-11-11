// Robust extraction of a JSON value from model output.
// Handles markdown fences, leading/trailing prose, and braces inside strings.
// Throws a descriptive error when the output is truncated or contains no JSON.

export function parseJSON(text) {
  const raw = String(text || "").replace(/```(?:json)?/gi, "").trim();
  const start = raw.search(/[[{]/);
  if (start < 0) throw new Error("Model output contained no JSON");

  const open = raw[start];
  const close = open === "{" ? "}" : "]";
  let depth = 0;
  let inStr = false;
  let esc = false;

  for (let i = start; i < raw.length; i++) {
    const ch = raw[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return JSON.parse(raw.slice(start, i + 1));
    }
  }
  throw new Error("Model output contained incomplete JSON (likely truncated)");
}

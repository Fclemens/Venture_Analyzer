// Tidies model-written markdown before rendering: collapses runs of blank lines
// and re-joins soft-wrapped paragraph lines - but never joins a heading, list
// item, table row, quote or code fence with its neighbours (the old regex
// merged "## Key insight" with the paragraph under it).

const BLOCK = /^\s*(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|\||```|---)/;

export function normalizeMarkdown(text) {
  if (!text) return "";
  const lines = String(text).replace(/\r\n/g, "\n").split("\n");
  const out = [];
  let inFence = false;
  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const prev = out[out.length - 1];
    const joinable = !inFence && prev !== undefined && prev.trim() !== "" && line.trim() !== "" &&
      !BLOCK.test(prev) && !BLOCK.test(line);
    if (joinable) out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
    else out.push(line);
  }
  return out.join("\n").replace(/\n[ \t]+\n/g, "\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

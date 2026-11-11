// Pure retrieval helpers (no model, no I/O) so they can be unit-tested.

// ── Cosine similarity (vectors already normalized by BGE) ────────────────────
export function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already normalized → dot = cosine
}

// ── Deterministic text chunker (no LLM) ──────────────────────────────────────
// Splits on blank lines / "---" separators, packs paragraphs up to maxChars,
// and hard-splits oversized paragraphs with a small overlap.
export function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const paras = String(text || "")
    .split(/\n\s*\n|\n-{3,}\n/)
    .map(p => p.trim())
    .filter(Boolean);

  const chunks = [];
  let buf = "";
  const flush = () => { if (buf.trim()) chunks.push(buf.trim()); buf = ""; };

  for (const p of paras) {
    if (p.length > maxChars) {
      flush();
      for (let i = 0; i < p.length; i += maxChars - overlap) {
        chunks.push(p.slice(i, i + maxChars).trim());
        if (i + maxChars >= p.length) break;
      }
      continue;
    }
    if (buf.length + p.length + 2 > maxChars) flush();
    buf += (buf ? "\n\n" : "") + p;
  }
  flush();
  return chunks.filter(c => c.length > 20);
}

// ── Pure scoring (exported for tests) ────────────────────────────────────────
const matchesEntity = (c, filters) =>
  (filters || []).some(f => c.entity === f || (c.entity || "").startsWith(f));

export function scoreChunk(queryEmbedding, c, entityFilter, dataTypeFilter) {
  let s = Array.isArray(c.embedding) && c.embedding.length ? cosineSimilarity(queryEmbedding, c.embedding) : 0;
  if (matchesEntity(c, entityFilter)) s += 0.08;
  if ((dataTypeFilter || []).includes(c.data_type)) s += 0.05;
  return s;
}


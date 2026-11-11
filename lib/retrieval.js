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

// A vector is only comparable if the same model produced it. Chunks stored before
// models were recorded were made by the default English model.
export function usableVector(c, modelKey, legacyKey = "bge-small-en") {
  return !!c.embedding?.length && (c.embedding_model || legacyKey) === modelKey;
}

export function scoreChunk(queryEmbedding, c, entityFilter, dataTypeFilter, modelKey = null) {
  const ok = modelKey === null ? !!c.embedding?.length : usableVector(c, modelKey);
  let s = ok ? cosineSimilarity(queryEmbedding, c.embedding) : 0; // arrays or Float32Array
  if (matchesEntity(c, entityFilter)) s += 0.08;
  if ((dataTypeFilter || []).includes(c.data_type)) s += 0.05;
  return s;
}


// Rank every chunk and return the top K (embeddings stripped). queryEmbedding may
// be null (model unavailable): ranking then uses tags only.
export function rankChunks(queryEmbedding, chunks, entityFilter, dataTypeFilter, modelKey, topK) {
  const seen = new Set();
  return chunks
    .map(c => ({ c, s: scoreChunk(queryEmbedding, c, entityFilter, dataTypeFilter, modelKey) }))
    .sort((a, b) => b.s - a.s)
    .filter(({ c }) => (seen.has(c.text) ? false : (seen.add(c.text), true)))
    .slice(0, topK)
    .map(({ c, s }) => {
      const rest = { ...c };
      delete rest.embedding;
      return { ...rest, _score: Math.round(s * 1000) / 1000 };
    });
}

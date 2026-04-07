// ─────────────────────────────────────────────────────────────────────────────
// Local embeddings — BGE-small-en-v1.5 via @xenova/transformers
// Model cached in .data/models/ (self-contained, never sent anywhere)
// ─────────────────────────────────────────────────────────────────────────────

import { pipeline, env } from "@xenova/transformers";
import path from "path";

// Point model cache to project folder
env.cacheDir = path.join(process.cwd(), ".data", "models");
env.allowRemoteModels = true; // download on first use only

const MODEL_ID = "Xenova/bge-small-en-v1.5";
const TOP_K_DEFAULT = 20;

// ── Singleton model loader ────────────────────────────────────────────────────
let _embedder = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  console.log("[embeddings] Loading BGE-small-en-v1.5 (33MB, first run only)…");
  _embedder = await pipeline("feature-extraction", MODEL_ID, { quantized: true });
  console.log("[embeddings] Model ready.");
  return _embedder;
}

// ── Embed a single string ─────────────────────────────────────────────────────
export async function embedText(text) {
  const embedder = await getEmbedder();
  // BGE models work best with this prefix for retrieval queries
  const output = await embedder(text, { pooling: "mean", normalize: true });
  return Array.from(output.data); // plain float[]
}

// ── Embed multiple strings (batched) ─────────────────────────────────────────
export async function embedBatch(texts) {
  const embedder = await getEmbedder();
  const results = [];
  // Process in small batches to avoid OOM
  const BATCH = 32;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const outputs = await Promise.all(
      batch.map(t => embedder(t, { pooling: "mean", normalize: true }))
    );
    results.push(...outputs.map(o => Array.from(o.data)));
  }
  return results;
}

// ── Cosine similarity (vectors already normalized by BGE) ────────────────────
export function cosineSimilarity(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot; // already normalized → dot = cosine
}

// ── Vector search over chunks ─────────────────────────────────────────────────
// chunks must have an `embedding` field (float[])
// returns top-K chunks sorted by similarity, with `_score` attached
export function vectorSearch(queryEmbedding, chunks, topK = TOP_K_DEFAULT) {
  const scored = chunks
    .filter(c => Array.isArray(c.embedding) && c.embedding.length > 0)
    .map(c => ({ ...c, _score: cosineSimilarity(queryEmbedding, c.embedding) }))
    .sort((a, b) => b._score - a._score);
  return scored.slice(0, topK);
}

// ── Hybrid retrieval: tag filter ∪ vector search, deduplicated ───────────────
export async function hybridRetrieve(query, chunks, entityFilter, dataTypeFilter, topK = TOP_K_DEFAULT) {
  // Tag filter (precision layer)
  const tagMatches = new Set(
    chunks
      .filter(c =>
        entityFilter.some(f => c.entity === f || (c.entity || "").startsWith(f)) ||
        dataTypeFilter.includes(c.data_type)
      )
      .map(c => c.text) // use text as dedup key
  );

  // Vector layer (recall layer) — embed query, find semantically similar
  const queryEmbedding = await embedText(query);
  const vectorMatches = vectorSearch(queryEmbedding, chunks, topK);

  // Union: tag matches first (higher precision), then vector matches not already included
  const seen = new Set(tagMatches);
  const tagChunks = chunks.filter(c => tagMatches.has(c.text));
  const vectorOnly = vectorMatches.filter(c => !seen.has(c.text));

  return [...tagChunks, ...vectorOnly].slice(0, topK);
}

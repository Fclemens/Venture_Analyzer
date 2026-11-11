// ─────────────────────────────────────────────────────────────────────────────
// Local embeddings — BGE-small-en-v1.5 via @xenova/transformers
// Model cached in .data/models/ (self-contained, never sent anywhere)
// ─────────────────────────────────────────────────────────────────────────────

import { pipeline, env } from "@xenova/transformers";
import path from "path";
import { cosineSimilarity, chunkText, scoreChunk } from "./retrieval.js";

export { cosineSimilarity, chunkText, scoreChunk };

// Point model cache to project folder
env.cacheDir = path.join(process.cwd(), ".data", "models");
env.allowRemoteModels = true; // download on first use only

const MODEL_ID = "Xenova/bge-small-en-v1.5";
const TOP_K_DEFAULT = 24;
const QUERY_PREFIX = "Represent this sentence for searching relevant passages: ";

// ── Singleton model loader ────────────────────────────────────────────────────
let _embedder = null;

async function getEmbedder() {
  if (_embedder) return _embedder;
  console.log("[embeddings] Loading BGE-small-en-v1.5 (33MB, first run only)…");
  _embedder = await pipeline("feature-extraction", MODEL_ID, { quantized: true });
  console.log("[embeddings] Model ready.");
  return _embedder;
}

// Round to 4 decimals: cuts the JSON payload (embeddings travel with state) by ~40%
const compact = (data) => Array.from(data, x => Math.round(x * 1e4) / 1e4);

// ── Embed a retrieval QUERY (BGE needs the instruction prefix for queries) ────
export async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(QUERY_PREFIX + text, { pooling: "mean", normalize: true });
  return compact(output.data);
}

// ── Embed documents/passages (no prefix) in small batches ─────────────────────
export async function embedBatch(texts) {
  const embedder = await getEmbedder();
  const results = [];
  const BATCH = 16;
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const outputs = await Promise.all(
      batch.map(t => embedder(String(t).slice(0, 2000), { pooling: "mean", normalize: true }))
    );
    results.push(...outputs.map(o => compact(o.data)));
  }
  return results;
}

// ── Hybrid retrieval ─────────────────────────────────────────────────────────
// Every chunk is ranked by semantic similarity; tag matches add a bonus rather
// than bypass ranking, so the top-K really are the most relevant. Deduplicated
// by text, embeddings stripped from the returned objects.
export async function hybridRetrieve(query, chunks, entityFilter, dataTypeFilter, topK = TOP_K_DEFAULT) {
  if (!chunks?.length) return [];
  const queryEmbedding = await embedText(query);
  const seen = new Set();
  return chunks
    .map(c => ({ c, s: scoreChunk(queryEmbedding, c, entityFilter, dataTypeFilter) }))
    .sort((a, b) => b.s - a.s)
    .filter(({ c }) => (seen.has(c.text) ? false : (seen.add(c.text), true)))
    .slice(0, topK)
    .map(({ c, s }) => {
      const rest = { ...c };
      delete rest.embedding;
      return { ...rest, _score: Math.round(s * 1000) / 1000 };
    });
}

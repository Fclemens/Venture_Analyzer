// ─────────────────────────────────────────────────────────────────────────────
// Local embeddings — BGE-small-en-v1.5 via @xenova/transformers
// Model cached in .data/models/ (self-contained, never sent anywhere)
// ─────────────────────────────────────────────────────────────────────────────

import { pipeline, env } from "@xenova/transformers";
import path from "path";
import { cosineSimilarity, chunkText, scoreChunk, rankChunks } from "./retrieval.js";
import { activeEmbeddingKey, activeEmbeddingModel } from "./embedding-models.js";

export { cosineSimilarity, chunkText, scoreChunk };

// Point model cache to project folder
env.cacheDir = path.join(process.env.VENTURE_DATA_DIR || path.join(process.cwd(), ".data"), "models");
env.allowRemoteModels = true; // download on first use only

const TOP_K_DEFAULT = 24;

// ── Singleton model loader ────────────────────────────────────────────────────
// One shared load; bounded by a timeout; after a failure the next attempt waits
// for a cooldown so an unreachable model host can't stall every request.
let _embedder = null;
let _loading = null;
let _failedAt = 0;
const LOAD_TIMEOUT_MS = () => Number(process.env.EMBEDDING_LOAD_TIMEOUT_MS) || 90_000;
const RETRY_COOLDOWN_MS = () => Number(process.env.EMBEDDING_RETRY_COOLDOWN_MS) || 5 * 60_000;

async function getEmbedder() {
  if (_embedder) return _embedder;
  if (_failedAt && Date.now() - _failedAt < RETRY_COOLDOWN_MS()) {
    throw new Error("Embedding model unavailable (will retry shortly)");
  }
  if (!_loading) {
    console.log(`[embeddings] Loading ${activeEmbeddingKey()} (first run downloads the model)…`);
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error("Embedding model load timed out")), LOAD_TIMEOUT_MS()); timer.unref?.(); });
    _loading = Promise.race([pipeline("feature-extraction", activeEmbeddingModel().id, { quantized: true }), timeout])
      .then(e => { _embedder = e; _failedAt = 0; console.log("[embeddings] Model ready."); return e; })
      .catch(err => { _failedAt = Date.now(); throw err; })
      .finally(() => { clearTimeout(timer); _loading = null; });
  }
  return _loading;
}

// Round to 4 decimals: cuts the JSON payload (embeddings travel with state) by ~40%
const compact = (data) => Array.from(data, x => Math.round(x * 1e4) / 1e4);

// ── Embed a retrieval QUERY (BGE needs the instruction prefix for queries) ────
export async function embedText(text) {
  const embedder = await getEmbedder();
  const output = await embedder(activeEmbeddingModel().queryPrefix + text, { pooling: "mean", normalize: true });
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
      batch.map(t => embedder(activeEmbeddingModel().docPrefix + String(t).slice(0, 2000), { pooling: "mean", normalize: true }))
    );
    results.push(...outputs.map(o => compact(o.data)));
  }
  return results;
}

// ── Hybrid retrieval ─────────────────────────────────────────────────────────
// Every chunk is ranked by semantic similarity; tag matches add a bonus rather
// than bypass ranking, so the top-K really are the most relevant. Vectors from
// a different embedding model are ignored (tags only) until the project is
// re-indexed. If the model can't load, ranking falls back to tags.
export async function hybridRetrieve(query, chunks, entityFilter, dataTypeFilter, topK = TOP_K_DEFAULT) {
  if (!chunks?.length) return [];
  let queryEmbedding = null;
  try {
    queryEmbedding = await embedText(query);
  } catch (err) {
    console.warn("[embeddings] vector search unavailable, ranking by tags only:", err.message);
  }
  return rankChunks(queryEmbedding, chunks, entityFilter, dataTypeFilter, activeEmbeddingKey(), topK);
}

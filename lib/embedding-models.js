// Embedding model presets. Vectors from different models are NOT comparable, so
// every stored chunk records which model produced it (chunks.embedding_model).
// Select with EMBEDDING_MODEL; switching models needs a re-index (Sources panel).

export const EMBEDDING_MODELS = {
  "bge-small-en": {
    id: "Xenova/bge-small-en-v1.5",
    queryPrefix: "Represent this sentence for searching relevant passages: ",
    docPrefix: "",
    languages: "English",
  },
  "multilingual-e5-small": {
    id: "Xenova/multilingual-e5-small",
    queryPrefix: "query: ",
    docPrefix: "passage: ",
    languages: "100+ languages (German, French, Spanish, Italian, Chinese, …)",
  },
};

export const DEFAULT_EMBEDDING_MODEL = "bge-small-en";

export function activeEmbeddingKey(env = process.env) {
  const key = env.EMBEDDING_MODEL || DEFAULT_EMBEDDING_MODEL;
  if (!EMBEDDING_MODELS[key]) {
    throw new Error(`Unknown EMBEDDING_MODEL "${key}". Options: ${Object.keys(EMBEDDING_MODELS).join(", ")}`);
  }
  return key;
}

export const activeEmbeddingModel = (env = process.env) => EMBEDDING_MODELS[activeEmbeddingKey(env)];

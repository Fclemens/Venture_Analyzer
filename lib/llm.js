// ─────────────────────────────────────────────────────────────────────────────
// LLM Gateway — Anthropic / OpenAI / Gemini
//
// Single export: callModel({ role, system, messages, useSearch, file }, settings)
//   file = { base64: string, mimeType: string } | null
//   → { text: string, searchResults: Array<{url,title,text}> }
//
// Each provider gets its own translator. The pipeline never needs to know
// which provider is active.
// ─────────────────────────────────────────────────────────────────────────────

// ── Fetch page text from a URL (server-side, no CORS) ───────────────────────
async function fetchPageText(url, maxChars = 6000) {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; VentureAnalyzer/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    const html = await res.text();
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<style[\s\S]*?<\/style>/gi, "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, maxChars);
    return text;
  } catch {
    return "";
  }
}

// ── Retry on 429 with exponential backoff ────────────────────────────────────
async function withRetry(fn, maxAttempts = 4) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const is429 = err.status === 429 || err.message?.includes("429") || err.message?.includes("rate_limit");
      if (!is429 || attempt === maxAttempts - 1) throw err;
      const wait = 10_000 * Math.pow(2, attempt);
      console.warn(`[gateway] Rate limited. Retry ${attempt + 1}/${maxAttempts} in ${wait / 1000}s`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ANTHROPIC
// Docs: /v1/messages
// File: content block { type:"document", source:{type:"base64",...} }
// Search: tools:[{ type:"web_search_20250305", name:"web_search" }]
// ─────────────────────────────────────────────────────────────────────────────
async function anthropic({ apiKey, model, system, messages, useSearch, file }) {
  // If a file is provided, inject it into the first user message
  const builtMessages = file
    ? [
        {
          role: "user",
          content: [
            {
              type: file.mimeType === "application/pdf" ? "document" : "image",
              source: { type: "base64", media_type: file.mimeType, data: file.base64 },
            },
            // carry through any existing text from the first user message
            { type: "text", text: msgText(messages[0]) },
            ...messages.slice(1).map(m => ({ type: "text", text: msgText(m) })),
          ],
        },
      ]
    : messages;

  const body = {
    model,
    max_tokens: model.includes("haiku") ? 4000 : 8000,
    system,
    messages: builtMessages,
  };
  if (useSearch) body.tools = [{ type: "web_search_20250305", name: "web_search" }];

  return withRetry(async () => {
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = new Error(`Anthropic ${res.status}: ${await res.text()}`); e.status = res.status; throw e; }
    const data = await res.json();

    const text = (data.content || []).filter(b => b.type === "text").map(b => b.text).join("\n\n");
    const searchResults = [];
    for (const block of data.content || []) {
      if (block.type === "web_search_tool_result") {
        for (const item of block.content || []) {
          if (item.type === "web_search_result") {
            searchResults.push({ url: item.url || "", title: item.title || "", text: (item.page_content || "").slice(0, 6000) });
          }
        }
      }
    }
    return { text, searchResults };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// OPENAI
// Docs: /v1/responses (Responses API)
// File: upload to /v1/files first → file_id → { type:"input_file", file_id }
// Search: tools:[{ type:"web_search" }], citations in output_text annotations
// ─────────────────────────────────────────────────────────────────────────────
async function openaiUploadFile(apiKey, base64, mimeType) {
  // Convert base64 → Buffer → Blob for multipart upload
  const buffer = Buffer.from(base64, "base64");
  const blob = new Blob([buffer], { type: mimeType });
  const ext = mimeType === "application/pdf" ? "pdf" : "bin";

  const form = new FormData();
  form.append("file", blob, `upload.${ext}`);
  form.append("purpose", "user_data");

  const res = await fetch("https://api.openai.com/v1/files", {
    method: "POST",
    headers: { "Authorization": `Bearer ${apiKey}` },
    body: form,
  });
  if (!res.ok) { const e = new Error(`OpenAI file upload ${res.status}: ${await res.text()}`); e.status = res.status; throw e; }
  const data = await res.json();
  return data.id; // "file-xxxx"
}

async function openai({ apiKey, model, system, messages, useSearch, file }) {
  // Upload file if present, get file_id
  let fileId = null;
  if (file) {
    fileId = await openaiUploadFile(apiKey, file.base64, file.mimeType);
  }

  // Build input array
  const input = [
    { role: "system", content: system },
    ...messages.map((m, i) => {
      const text = msgText(m);
      // Attach file to first user message
      if (fileId && i === 0 && m.role === "user") {
        return {
          role: "user",
          content: [
            { type: "input_file", file_id: fileId },
            { type: "input_text", text },
          ],
        };
      }
      return { role: m.role, content: text };
    }),
  ];

  const body = { model, input, max_output_tokens: 8000 };
  if (useSearch) body.tools = [{ type: "web_search" }];

  return withRetry(async () => {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const e = new Error(`OpenAI ${res.status}: ${await res.text()}`); e.status = res.status; throw e; }
    const data = await res.json();

    let text = "";
    const searchResults = [];
    for (const item of data.output || []) {
      if (item.type === "message") {
        for (const part of item.content || []) {
          if (part.type === "output_text") {
            text += part.text;
            // Citations are in annotations
            for (const ann of part.annotations || []) {
              if (ann.type === "url_citation") {
                searchResults.push({ url: ann.url || "", title: ann.title || "", text: "" });
              }
            }

          }
        }
      }
    }
    // Fetch page content for each citation in parallel
    await Promise.all(searchResults.map(async r => {
      if (r.url) r.text = await fetchPageText(r.url);
    }));
    return { text, searchResults };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// GEMINI
// Docs: /v1beta/models/{model}:generateContent
// File: inlineData part { mimeType, data: base64 }
// Search: tools:[{ google_search:{} }]  (grounding)
// ─────────────────────────────────────────────────────────────────────────────
async function gemini({ apiKey, model, system, messages, useSearch, file }) {
  const contents = messages.map((m, i) => {
    const text = msgText(m);
    const parts = [];

    // Attach file inline to first user message
    if (file && i === 0 && m.role === "user") {
      parts.push({ inlineData: { mimeType: file.mimeType, data: file.base64 } });
    }
    parts.push({ text });

    return {
      role: m.role === "assistant" ? "model" : "user",
      parts,
    };
  });

  const body = {
    system_instruction: { parts: [{ text: system }] },
    contents,
    generationConfig: { maxOutputTokens: 8000 },
  };
  if (useSearch) body.tools = [{ google_search: {} }];

  return withRetry(async () => {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }
    );
    if (!res.ok) { const e = new Error(`Gemini ${res.status}: ${await res.text()}`); e.status = res.status; throw e; }
    const data = await res.json();

    const text = (data.candidates?.[0]?.content?.parts || []).map(p => p.text || "").join("\n\n");
    // Grounding metadata contains search queries/urls
    const searchResults = [];
    const chunks = data.candidates?.[0]?.groundingMetadata?.groundingChunks || [];
    for (const chunk of chunks) {
      if (chunk.web) searchResults.push({ url: chunk.web.uri || "", title: chunk.web.title || "", text: "" });
    }
    // Fetch page content for each grounding source in parallel
    await Promise.all(searchResults.map(async r => {
      if (r.url) r.text = await fetchPageText(r.url);
    }));
    return { text, searchResults };
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function msgText(m) {
  if (!m) return "";
  if (typeof m.content === "string") return m.content;
  if (Array.isArray(m.content)) return m.content.find(b => b.type === "text")?.text || "";
  return "";
}

// ─────────────────────────────────────────────────────────────────────────────
// GATEWAY — single export used by the pipeline
// ─────────────────────────────────────────────────────────────────────────────
export async function callModel(
  { role, system, messages, useSearch = false, file = null },
  settings
) {
  const roleConfig = settings.roles?.[role];
  if (!roleConfig) throw new Error(`Unknown role: ${role}`);

  const { provider, model } = roleConfig;
  const apiKey = settings.providers?.[provider]?.apiKey;
  if (!apiKey) throw new Error(`No API key for provider: ${provider}`);

  // Gemini doesn't support web search in our current integration
  const effectiveSearch = useSearch && provider !== "gemini";

  const args = { apiKey, model, system, messages, useSearch: effectiveSearch, file };

  switch (provider) {
    case "anthropic": return anthropic(args);
    case "openai":    return openai(args);
    case "gemini":    return gemini(args);
    default: throw new Error(`Unknown provider: ${provider}`);
  }
}

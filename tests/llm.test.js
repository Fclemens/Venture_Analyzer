import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { callModel } from "../lib/llm.js";

const realFetch = globalThis.fetch;
let calls;
const settings = (provider, model) => ({
  roles: { smart: { provider, model }, fast: { provider, model } },
  providers: { [provider]: { apiKey: "k", enabled: true } },
});
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

beforeEach(() => { calls = []; });
afterEach(() => { globalThis.fetch = realFetch; });

test("anthropic: reports truncation and real token usage; injects date + untrusted-data rule", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(init.body) });
    return json({ content: [{ type: "text", text: "partial" }], stop_reason: "max_tokens", usage: { input_tokens: 11, output_tokens: 7 } });
  };
  const r = await callModel({ role: "smart", system: "SYS", messages: [{ role: "user", content: "hi" }] }, settings("anthropic", "claude-sonnet-5-5"));
  assert.equal(r.truncated, true);
  assert.deepEqual(r.usage, { input: 11, output: 7 });
  assert.match(calls[0].body.system, /^SYS/);
  assert.match(calls[0].body.system, /Today's date is \d{4}-\d{2}-\d{2}/);
  assert.match(calls[0].body.system, /untrusted_source/);
  assert.equal(calls[0].body.max_tokens, 16000);
});

test("anthropic: continues pause_turn, accumulates usage, uses cited text when a page cannot be fetched", async () => {
  let n = 0;
  globalThis.fetch = async (url, init) => {
    if (String(url).includes("anthropic.com")) {
      calls.push(JSON.parse(init.body));
      n++;
      if (n === 1) return json({ content: [{ type: "web_search_tool_result", content: [{ type: "web_search_result", url: "http://127.0.0.1/secret", title: "Internal" }] }], stop_reason: "pause_turn", usage: { input_tokens: 5, output_tokens: 1 } });
      return json({ content: [{ type: "text", text: "final", citations: [{ url: "http://10.0.0.5/x", title: "Cited", cited_text: "the cited passage" }] }], stop_reason: "end_turn", usage: { input_tokens: 6, output_tokens: 2 } });
    }
    throw new Error("must not fetch internal address: " + url);
  };
  const r = await callModel({ role: "smart", system: "S", messages: [{ role: "user", content: "q" }], useSearch: true }, settings("anthropic", "claude-sonnet-5-5"));
  assert.equal(r.text, "final");
  assert.equal(r.truncated, false);
  assert.deepEqual(r.usage, { input: 11, output: 3 });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].messages.at(-1).role, "assistant", "paused turn is continued with the assistant content");
  assert.equal(calls[0].tools[0].max_uses, 6);
  // SSRF: internal URLs are never fetched; model-cited text is kept as fallback
  const cited = r.searchResults.find(x => x.url === "http://10.0.0.5/x");
  assert.equal(cited.text, "the cited passage");
});

test("anthropic: retries transient 529 then succeeds", async () => {
  let n = 0;
  const realSetTimeout = globalThis.setTimeout;
  globalThis.setTimeout = (fn) => realSetTimeout(fn, 0); // skip backoff delays
  try {
    globalThis.fetch = async () => (++n === 1 ? json({ error: "overloaded" }, 529) : json({ content: [{ type: "text", text: "ok" }], stop_reason: "end_turn" }));
    const r = await callModel({ role: "fast", system: "S", messages: [{ role: "user", content: "q" }] }, settings("anthropic", "claude-haiku-5-5"));
    assert.equal(r.text, "ok");
    assert.equal(n, 2);
  } finally { globalThis.setTimeout = realSetTimeout; }
});

test("gemini: key in header not URL; search enabled; MAX_TOKENS detected", async () => {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), headers: init.headers, body: JSON.parse(init.body) });
    return json({ candidates: [{ content: { parts: [{ text: "g" }] }, finishReason: "MAX_TOKENS" }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 4 } });
  };
  const r = await callModel({ role: "smart", system: "S", messages: [{ role: "user", content: "q" }], useSearch: true }, settings("gemini", "gemini-2.5-pro"));
  assert.ok(!calls[0].url.includes("key="), "API key must not be in the URL");
  assert.equal(calls[0].headers["x-goog-api-key"], "k");
  assert.deepEqual(calls[0].body.tools, [{ google_search: {} }]);
  assert.equal(r.truncated, true);
  assert.deepEqual(r.usage, { input: 3, output: 4 });
});

test("openai: uploaded deck is deleted afterwards, even when the call fails", async () => {
  const seen = [];
  globalThis.fetch = async (url, init) => {
    seen.push(`${init?.method || "GET"} ${new URL(String(url)).pathname}`);
    if (String(url).endsWith("/v1/files") && init.method === "POST") return json({ id: "file-123" });
    if (String(url).includes("/v1/files/file-123")) return json({ deleted: true });
    return json({ error: "bad" }, 400);
  };
  await assert.rejects(
    callModel({ role: "smart", system: "S", messages: [{ role: "user", content: "q" }], file: { base64: "QQ==", mimeType: "application/pdf" } }, settings("openai", "gpt-5.4")),
    /OpenAI 400/
  );
  assert.ok(seen.includes("DELETE /v1/files/file-123"), seen.join(" | "));
});

test("missing key gives an actionable error", async () => {
  await assert.rejects(
    callModel({ role: "smart", system: "S", messages: [] }, { roles: { smart: { provider: "openai", model: "m" } }, providers: { openai: { apiKey: "" } } }),
    /No API key configured for openai/
  );
});

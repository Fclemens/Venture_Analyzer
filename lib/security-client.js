// Browser-safe helpers (no Node imports). Server-only helpers live in security.js,
// which re-exports these.
export function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── Prompt-injection fencing ─────────────────────────────────────────────────
// Untrusted content is wrapped in tags and any look-alike closing tag inside it
// is neutralised, so the text cannot "escape" the fence. The system suffix in
// llm.js tells the model that fenced content is data, never instructions.
export function fence(label, text) {
  const safe = String(text ?? "").replace(/<\/?untrusted_source[^>]*>/gi, "[tag removed]");
  return `<untrusted_source label="${String(label).replace(/[^\w .:-]/g, "")}">\n${safe}\n</untrusted_source>`;
}

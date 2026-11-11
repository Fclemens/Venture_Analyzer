// Security helpers: HTML escaping, SSRF-safe fetching, rate limiting, and
// fencing of untrusted text (pitch decks, web pages) inside prompts.

import dns from "dns/promises";
import net from "net";

export { escapeHtml, fence } from "./security-client.js";

// ── SSRF protection ──────────────────────────────────────────────────────────
export function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      a >= 224
    );
  }
  if (net.isIPv6(ip)) {
    const l = ip.toLowerCase();
    if (l === "::1" || l === "::") return true;
    if (l.startsWith("::ffff:")) return isPrivateIp(l.slice(7));
    return l.startsWith("fc") || l.startsWith("fd") || l.startsWith("fe8") ||
           l.startsWith("fe9") || l.startsWith("fea") || l.startsWith("feb");
  }
  return true; // not an IP we understand → treat as unsafe
}

export async function assertPublicUrl(rawUrl) {
  let u;
  try { u = new URL(rawUrl); } catch { throw new Error("Invalid URL"); }
  if (u.protocol !== "http:" && u.protocol !== "https:") throw new Error("Only http(s) URLs are allowed");
  if (u.username || u.password) throw new Error("URLs with credentials are not allowed");
  const host = u.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
    throw new Error("Blocked host");
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new Error("Blocked address");
    return u;
  }
  const addrs = await dns.lookup(host, { all: true });
  if (!addrs.length || addrs.some(a => isPrivateIp(a.address))) throw new Error("Blocked address");
  return u;
}

// Fetch a page as plain text. Follows at most 3 redirects, re-validating each
// hop, reading at most ~1MB. Returns "" on any failure.
export async function safeFetchText(url, { maxChars = 6000, timeoutMs = 6000 } = {}) {
  try {
    let current = url;
    for (let hop = 0; hop < 4; hop++) {
      const u = await assertPublicUrl(current);
      const res = await fetch(u, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; VentureAnalyzer/1.0)" },
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location"), u).toString();
        continue;
      }
      if (!res.ok) return "";
      const type = res.headers.get("content-type") || "";
      if (!/text\/|html|xml|json/i.test(type)) return "";
      const html = (await res.text()).slice(0, 1_000_000);
      return html
        .replace(/<script[\s\S]*?<\/script>/gi, "")
        .replace(/<style[\s\S]*?<\/style>/gi, "")
        .replace(/<[^>]+>/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maxChars);
    }
    return "";
  } catch {
    return "";
  }
}

// ── Per-user rate limit (in-memory, per server instance) ─────────────────────
// For multi-instance deployments move this to a shared store (Redis / DB).
const buckets = new Map();
export function rateLimit(key, { limit = 90, windowMs = 60_000 } = {}) {
  const now = Date.now();
  const hits = (buckets.get(key) || []).filter(t => now - t < windowMs);
  if (hits.length >= limit) {
    buckets.set(key, hits);
    return { ok: false, retryAfter: Math.ceil((windowMs - (now - hits[0])) / 1000) };
  }
  hits.push(now);
  buckets.set(key, hits);
  return { ok: true };
}

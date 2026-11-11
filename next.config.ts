import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xenova/transformers"],
  // proxy.ts makes Next buffer request bodies and silently truncate beyond the
  // default 10MB. Uploads travel as base64 JSON (20MB file ≈ 27MB), so raise it.
  experimental: { proxyClientMaxBodySize: "30mb" },
  // .data/ (SQLite files) is in .gitignore — Turbopack respects .gitignore for file watching
};

export default nextConfig;

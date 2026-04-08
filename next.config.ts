import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xenova/transformers"],
  // .data/ (SQLite files) is in .gitignore — Turbopack respects .gitignore for file watching
};

export default nextConfig;

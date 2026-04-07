import type { NextConfig } from "next";
import path from "path";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3", "@xenova/transformers"],
  // Exclude .data directory (SQLite + model cache) from Turbopack's file watcher
  // to prevent locked-file panics on venture.db-shm / venture.db-wal
  watchOptions: {
    ignored: [path.join(__dirname, ".data")],
  },
};

export default nextConfig;

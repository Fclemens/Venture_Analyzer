// Test-only module loader: resolves the "@/" alias and swaps the two framework
// modules that need a running Next.js / Clerk for tiny stubs, so real route
// handlers can be exercised directly.
import { pathToFileURL, fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const stub = (f) => pathToFileURL(path.join(root, "tests/helpers", f)).href;

export async function resolve(specifier, context, next) {
  if (specifier === "@clerk/nextjs/server") return { url: stub("clerk-stub.mjs"), shortCircuit: true };
  if (specifier === "next/server") return { url: stub("next-server-stub.mjs"), shortCircuit: true };
  if (specifier.startsWith("@/")) {
    const base = path.join(root, specifier.slice(2));
    for (const cand of [base, base + ".js", base + ".mjs", path.join(base, "index.js")]) {
      if (fs.existsSync(cand) && fs.statSync(cand).isFile()) return { url: pathToFileURL(cand).href, shortCircuit: true };
    }
  }
  return next(specifier, context);
}

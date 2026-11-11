# Venture Analyzer

AI-assisted due diligence for early-stage ventures. Upload a pitch deck (or describe a concept) and the app runs a fixed sequence of analysis passes, with a human review step after each method, then compiles an investment-style report with a rubric-based score.

## How it works

1. **Ingest** – each uploaded PDF/image is transcribed, split into searchable chunks, and embedded locally (BGE-small). The *whole* document is indexed; nothing is cut off.
2. **P0 – Scoping** – classifies the venture and decides which methods to run (run / lite / skip).
3. **Passes P1–P9** – each method runs *extract → execute → (review/revise) → summarise*:
   | Pass | Topic |
   |---|---|
   | P1 | Value architecture |
   | P2 | Market sizing |
   | P3 | Competitive landscape |
   | P4 | Demand validation |
   | P5 | Go-to-market |
   | P6 | Regulatory & barriers (IP scan, regulatory pathway) |
   | P7 | Financial viability |
   | P8 | Team & traction (team, traction, product/tech) |
   | P9 | Deal & red team (valuation/exit, bear case) |
4. **Report** – chapters per pass plus an executive summary. Six dimensions (market, differentiation, team, traction, business model, risk) are scored 1–10 by the model against a rubric **with cited evidence**; the weighted total, coverage and verdict are **computed in code** (`lib/scoring.js`). Dimensions whose passes were not run are excluded, and a verdict is withheld below 60 % coverage. The report also lists tensions between passes and sharp questions for the founders.

Quality controls in the prompts: claims from company materials must be tagged `[VERIFIED]` / `[CONTRADICTED]` / `[UNVERIFIED]`; figures cite evidence IDs or URLs and dates; arithmetic must be shown.

## Setup

```bash
cp .env.local.example .env.local   # fill in Clerk keys + ENCRYPTION_KEY
npm install
npm run dev
```

Users bring their own Anthropic / OpenAI / Gemini API keys (stored AES-256-GCM encrypted in SQLite under `.data/`). Clerk handles authentication; set `role: admin` in a user's public metadata to access `/admin`. Subscribe the Clerk webhook to `session.created` (usage) and `user.deleted` (erases that user's data).

```bash
npm test        # unit tests (Node's built-in runner)
npm run build
```

## Security & privacy notes

- Pitch-deck text and fetched web pages are **fenced as untrusted data** in every prompt, and the model is told never to follow instructions inside them; the final score is computed in code from dimension scores.
- Server-side page fetching is SSRF-guarded (public hosts only, redirects re-validated).
- The HTML export escapes all model/web text.
- Per-user rate limiting on the pipeline route (in-memory – use a shared store when running several instances).
- Uploaded files are sent to the provider the user chose; with OpenAI the temporary upload is deleted right after use.
- `user.deleted` webhook removes a user's projects, keys and usage history.

## Known limitations / roadmap

- Pipeline orchestration and state live in the browser (`app/page.jsx`); closing the tab stops a run and concurrent tabs/parallel saves can overwrite each other. Planned: server-side durable jobs + relational storage (Postgres/pgvector) instead of one JSON blob per project.
- SQLite + local model cache require a persistent disk (not serverless).
- Unit economics and scenarios are still model-written prose; a calculated model with editable assumptions is planned.
- Web search is the only external data source; registries, funding, patent and traffic data connectors are not built.
- No team workspaces, version history/diffing, or Word/Excel export yet.

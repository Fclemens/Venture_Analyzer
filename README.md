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

## Architecture

```
Browser (app/page.jsx)             Next.js server                         SQLite (.data/venture.db)
  setup, review, report   ──►  /api/projects/:id/runs  ──► job queue ──►  jobs
  queues work + polls            (lib/jobs.js worker pool)                 method_runs, run_versions
                                 lib/job-handlers.js ► lib/steps.js        chunks (+ embeddings), web_sources
                                 lib/llm.js (Anthropic / OpenAI / Gemini)  projects (small JSON blob), settings, usage
```

- **Method runs are server-side durable jobs.** The browser queues *extract / execute / revise* and polls a lightweight status endpoint; closing the tab does not stop a run. Independent methods run in parallel (`PIPELINE_CONCURRENCY`, with a per-user cap), and jobs that were running when the server stopped are re-queued on start (`instrumentation.ts`).
- **State lives in tables, not in the browser.** `method_runs` (status, evidence, latest result, version counter), `run_versions` (every execute/revise output - full history), `chunks` (document + web evidence with embeddings; retrieval happens in the server, nothing but counts goes to the browser), `web_sources`, `jobs`. The `projects.state` JSON now only holds small setup data (P0, entities, notes, summaries, report). Saves are merged, and the keys that moved to tables are ignored, so a stale tab can't overwrite them.
- **Existing projects migrate automatically** the first time they're opened.
- All SQL for this is in `lib/runs.js`, so moving to Postgres + pgvector later is a contained change.

## Configuration highlights

| Variable | Purpose |
|---|---|
| `VENTURE_DATA_DIR` | Where the SQLite database and embedding-model cache live (use a persistent volume) |
| `PIPELINE_CONCURRENCY`, `PIPELINE_PER_USER` | Parallel method runs overall / per user |
| `EMBEDDING_MODEL` | `bge-small-en` (default) or `multilingual-e5-small` for non-English decks. After switching, open each deal's Sources panel and click **Re-index** - vectors from different models are never mixed |
| `SEC_CONTACT_EMAIL`, `CONNECTOR_CONTACT_EMAIL` | Enable / identify the optional outside-data connectors (also opt-in per user in Settings) |

Supported uploads: PDF and images (read by the model), Word, PowerPoint, Excel, CSV, text and Markdown (parsed locally, exactly). Exports: Word, Excel (the financial model as live formulas), Markdown, HTML.

## Limitations / roadmap

- **Hosting:** the job worker runs inside the Next.js server process, so it needs a long-lived Node host with a persistent disk (not serverless), and SQLite allows a single server instance. The queue and all state are already in the database: moving to Postgres + pgvector (all SQL is in `lib/db.js` / `lib/runs.js`) and a separate worker process are the next steps for horizontal scaling.
- **Outside-data connectors** (OpenAlex, SEC EDGAR) were written against the providers' documented response formats and unit-tested with fixtures, but have not been exercised against the live APIs. They fail safe (any problem yields no evidence). Registries, patent offices, funding and traffic databases are not connected - most need paid keys.
- P0 scoping, per-method summaries and pass summaries are still user-initiated calls made from the browser (short, interactive).
- No end-to-end browser test: sign-in goes through Clerk, which the test environment cannot reach. Server logic, API routes and exports are covered by 96 automated tests (`npm test`); the React UI is verified by lint and build only.

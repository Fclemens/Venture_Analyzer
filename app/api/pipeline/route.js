import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSettings, projectAccess } from "@/lib/db";
import {
  METHODOLOGY_REGISTRY,
  getP0DocSystem, getP0ConceptSystem,
  getMethodSummarySystem, getPassSummarySystem,
  getFinAssumptionsSystem,
  RECHUNK_SYSTEM,
} from "@/lib/registry";
import { embedBatch, chunkText } from "@/lib/embeddings";
import { parseJSON } from "@/lib/json";
import { fence, rateLimit } from "@/lib/security";
import { ASSUMPTION_FIELDS } from "@/lib/finmodel";
import { insertChunks, chunkStats } from "@/lib/runs";
import { typeOf } from "@/lib/filetypes";
import { extractLocalText } from "@/lib/doc-parse";
import { makeCaller, ventureHeader, chapterStep, executiveStep } from "@/lib/steps";

// Multi-call steps with web search can run for minutes
export const maxDuration = 300;

const MAX_FILE_BASE64 = 28_000_000;   // ≈ 20 MB of binary
const MAX_CORPUS_CHARS = 2_000_000;
const MAX_CHUNKS = 3000;

class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function requireProject(projectId, userId, orgId) {
  if (typeof projectId !== "string" || !projectAccess(projectId, userId, orgId)) throw new HttpError("Project not found", 404);
}

// Validates an upload by its file NAME (the extension decides the type; the
// client-claimed MIME type is not trusted) and returns the type definition.
function requireFile(body) {
  const { fileBase64, fileName } = body;
  if (typeof fileBase64 !== "string" || !fileBase64) throw new HttpError("Missing file");
  if (fileBase64.length > MAX_FILE_BASE64) throw new HttpError("File too large (20 MB maximum)", 413);
  const type = typeOf(fileName);
  if (!type) throw new HttpError("Unsupported file type (PDF, images, Word, PowerPoint, Excel, CSV, text)", 415);
  return type;
}

// Text of an uploaded document: parsed locally for Office/text files (exact,
// no model call), transcribed by the fast model for PDFs and images.
async function readUpload(body, call) {
  const type = requireFile(body);
  if (type.kind === "local") {
    try {
      return { text: await extractLocalText({ buffer: Buffer.from(body.fileBase64, "base64"), fileName: body.fileName }), truncated: false };
    } catch (err) {
      throw new HttpError(`Could not read ${body.fileName}: ${err.message}`, 422);
    }
  }
  const result = await call({
    role: "fast",
    system: TEXT_EXTRACT_SYSTEM,
    messages: [{ role: "user", content: "Transcribe all text from this document." }],
    file: { base64: body.fileBase64, mimeType: type.mime },
    maxTokens: 24000,
  });
  return { text: result.text, truncated: !!result.truncated };
}

// Build tagged-chunk objects (with embeddings) from a document's text.
// Deterministic chunking: the whole document is searchable, nothing is cut off.
async function indexDocument(text, fileName) {
  const parts = chunkText(text);
  if (!parts.length) return [];
  const embeddings = await embedBatch(parts);
  const at = new Date().toISOString();
  return parts.map((t, i) => ({
    text: t,
    entity: "document",
    data_type: "document",
    pass_relevance: [],
    confidence: 0.9,
    source_type: "document",
    retrieved_by: fileName || "document",
    chunk_index: i,
    ingested_at: at,
    embedding: embeddings[i],
  }));
}

const TEXT_EXTRACT_SYSTEM = `Read the uploaded document and transcribe ALL text content exactly as it appears. Include every heading, bullet point, number, caption, and footnote. Preserve structure with section separators (---). Do NOT analyze. Output plain text only.`;

const ENTITY_SCAN_SYSTEM = `Scan the document text and list all named entities. Respond with JSON only:
{"startup_name":"","competitors":[],"partners":[],"markets":[],"people":[],"products":[],"regulatory_bodies":[]}`;

export async function POST(request) {
  try {
    const { userId, orgId } = await auth();
    if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const rl = rateLimit(`pipeline:${userId}`);
    if (!rl.ok) {
      return NextResponse.json({ error: `Too many requests. Retry in ${rl.retryAfter}s.` }, { status: 429, headers: { "Retry-After": String(rl.retryAfter) } });
    }

    const body = await request.json();
    const { step } = body;
    if (typeof step !== "string") throw new HttpError("Missing step");
    if (typeof body.corpusText === "string" && body.corpusText.length > MAX_CORPUS_CHARS) throw new HttpError("Document text too large", 413);
    if (Array.isArray(body.webChunks) && body.webChunks.length > MAX_CHUNKS) throw new HttpError("Too many evidence chunks", 413);
    const settings = getSettings(userId);
    if (settings._decryptFailed) {
      throw new HttpError("Your saved settings could not be decrypted (the server ENCRYPTION_KEY probably changed). Re-enter your API keys in Settings.", 409);
    }

    const callModelLogged = makeCaller({ userId, settings, step });

    switch (step) {

      // ── 1. Extract text from PDF ──────────────────────────────────────────
      case "ingest": {
        const { fileName, projectId } = body;
        requireProject(projectId, userId, orgId ?? null);
        const result = await readUpload(body, callModelLogged);
        // Index the full text server-side so every method can retrieve from the
        // whole document. Embeddings stay in the database - never sent to the browser.
        insertChunks(projectId, await indexDocument(result.text, fileName));
        return NextResponse.json({ text: result.text, chunks: chunkStats(projectId), truncated: result.truncated });
      }

      // ── 1b. Ingest additional document into chunks (with embeddings) ──────
      case "ingest_doc": {
        const { fileName, projectId } = body;
        requireProject(projectId, userId, orgId ?? null);

        // Extract text
        const ingest = await readUpload(body, callModelLogged);
        const docText = ingest.text;

        // Rechunk into tagged data points
        const rechunkResult = await callModelLogged({
          role: "fast",
          system: RECHUNK_SYSTEM,
          messages: [{ role: "user", content: `Additional document: "${fileName}". Extract and tag useful data points.\n\n${fence(fileName, docText.slice(0, 40000))}` }],
        });

        let rawChunks = [];
        try { rawChunks = parseJSON(rechunkResult.text); } catch { rawChunks = []; }

        const newChunks = rawChunks.map(c => ({
          ...c,
          source_type: "additional_doc",
          retrieved_by: fileName,
          ingested_at: new Date().toISOString(),
        }));

        // Embed tagged data points, and index the full text for retrieval
        if (newChunks.length > 0) {
          const embeddings = await embedBatch(newChunks.map(c => c.text));
          newChunks.forEach((c, i) => { c.embedding = embeddings[i]; });
        }
        const fullChunks = await indexDocument(docText, fileName);

        insertChunks(projectId, [...fullChunks, ...newChunks]);
        return NextResponse.json({ text: docText, chunks: chunkStats(projectId), truncated: ingest.truncated });
      }

      // ── 2. Entity scan ────────────────────────────────────────────────────
      case "entities": {
        const { corpusText } = body;
        const result = await callModelLogged({
          role: "fast",
          json: true,
          system: ENTITY_SCAN_SYSTEM,
          messages: [{ role: "user", content: `Scan this document for named entities:\n\n${fence("document", (corpusText || "").slice(0, 30000))}` }],
        });
        return NextResponse.json(result.json);
      }

      // ── 3a. P0 from document ──────────────────────────────────────────────
      case "p0_doc": {
        const { fileName, userContext, entities, priorityFocus, corpusText } = body;
        // PDFs/images are attached so the model can see charts and layout; for
        // Office/text files the already-extracted text is sent instead.
        const type = body.fileBase64 ? requireFile(body) : null;
        const attach = type?.kind === "model";
        const result = await callModelLogged({
          role: "smart",
          json: true,
          system: getP0DocSystem(userContext, entities, priorityFocus),
          messages: [{ role: "user", content: attach
            ? "Analyze this pitch deck. Produce the structured JSON classification."
            : `Analyze this document (${fileName || "uploaded file"}). Produce the structured JSON classification.\n\n${fence("document", (corpusText || "").slice(0, 60000))}` }],
          ...(attach ? { file: { base64: body.fileBase64, mimeType: type.mime } } : {}),
        });
        return NextResponse.json(result.json);
      }

      case "p0_concept": {
        const { conceptCard, priorityFocus } = body;
        const result = await callModelLogged({
          role: "smart",
          json: true,
          system: getP0ConceptSystem(conceptCard, priorityFocus),
          messages: [{ role: "user", content: `Analyze this venture concept and produce the structured JSON classification. Use web search to fill gaps.\n\nVENTURE: ${conceptCard.name} — ${conceptCard.description}` }],
          useSearch: true,
        });
        return NextResponse.json(result.json);
      }

      // ── 7. Method summary (after approve) ────────────────────────────────
      case "summarise": {
        const { methodologyId, result: analysisText, ventureCtx } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });
        const header = ventureHeader(ventureCtx);
        const res = await callModelLogged({
          role: "fast",
          json: true,
          system: `${header}${getMethodSummarySystem(mDef, ventureCtx)}`,
          messages: [{ role: "user", content: `Summarise this analysis:\n\n${fence("analysis", analysisText)}` }],
        });
        return NextResponse.json(res.json);
      }

      // ── 8. Pass summary (when all methods in pass done) ───────────────────
      case "pass_summarise": {
        const { passId, passTitle, methodResults: passResults, ventureCtx } = body;
        const header = ventureHeader(ventureCtx);
        const combinedResults = Object.entries(passResults)
          .map(([id, text]) => {
            const mDef = METHODOLOGY_REGISTRY[id];
            return `### ${mDef?.name || id}\n\n${text}`;
          }).join("\n\n---\n\n");
        const res = await callModelLogged({
          role: "smart",
          json: true,
          system: `${header}${getPassSummarySystem(passTitle, ventureCtx)}`,
          messages: [{ role: "user", content: `Synthesise the following methodology analyses for pass "${passTitle}":\n\n${fence("methodology analyses", combinedResults)}` }],
        });
        return NextResponse.json({ passId, ...res.json });
      }

      // ── 10. Compile pass chapter ──────────────────────────────────────────────
      case "compile_chapter": {
        const { passId, passTitle, methodResults: passMethodResults, passSummary, ventureCtx } = body;
        const text = await chapterStep({ call: callModelLogged, passId, passTitle, methodResults: passMethodResults, passSummary, ventureCtx });
        return NextResponse.json({ passId, text });
      }

      // ── 11. Compile executive summary ─────────────────────────────────────────
      case "compile_exec": {
        const { chapters, ventureCtx, finSummary } = body;
        return NextResponse.json(await executiveStep({ call: callModelLogged, chapters, ventureCtx, finSummary }));
      }

      // ── 11b. Propose financial-model assumptions (the model does no arithmetic) ──
      case "fin_assumptions": {
        const { methodResults: results = {}, ventureCtx, corpusText } = body;
        const analyses = Object.entries(results)
          .filter(([, text]) => typeof text === "string" && text.trim())
          .map(([id, text]) => `### ${METHODOLOGY_REGISTRY[id]?.name || id}\n${text}`)
          .join("\n\n---\n\n")
          .slice(0, 50000);
        const res = await callModelLogged({
          role: "smart",
          json: true,
          system: `${ventureHeader(ventureCtx)}${getFinAssumptionsSystem(ventureCtx)}`,
          messages: [{ role: "user", content: `${fence("analyses", analyses || "(no analyses yet)")}\n\n${fence("document excerpt", (corpusText || "").slice(0, 10000))}\n\nPropose the model inputs.` }],
          useSearch: true,
        });
        // Keep only known fields; shape-check values (they get clamped again on use)
        const out = {};
        for (const f of ASSUMPTION_FIELDS) {
          const a = res.json.assumptions?.[f.id];
          const v = a && typeof a === "object" ? a.value : a;
          out[f.id] = {
            value: v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v),
            source: typeof a?.source === "string" ? a.source.slice(0, 300) : "",
            confidence: ["high", "medium", "low"].includes(a?.confidence) ? a.confidence : "low",
          };
        }
        return NextResponse.json({ currency: String(res.json.currency || "").slice(0, 8), assumptions: out });
      }

      // ── 12. Validate & clean competitor list ─────────────────────────────────
      case "validate_competitors": {
        const { currentList, ventureCtx, corpusText } = body;

        const SYSTEM = `You are a competitive intelligence analyst tasked with cleaning and expanding a venture's competitor list.

The raw list was auto-generated and likely contains a mix of real competitors and noise: regulatory document titles, patent/application numbers (WO…, US…), standards bodies, academic paper titles, market research report names, URLs, and other irrelevant strings.

VALIDATION RULES:

A valid competitor is any entity competing for the same technological or commercial space:
• Companies or startups with a competing product or platform
• Research institutions or universities actively commercialising competing technology
• Patent or application numbers (WO…, US…, EP…) whose claims directly cover the same solution space — keep them as-is by patent number; downstream analysis passes will search for the patent directly, which is more precise than resolving to an assignee

DISCARD only items that are genuinely noise with no competitive relevance:
• Regulatory agencies and standards bodies (FDA, ISO, CE, ASTM, etc.) — unless they are also a market participant
• Purely procedural documents (inspection programs, classification guidance, form numbers)
• Generic material or chemistry names with no assignable owner
• Market research report titles or analyst firm names
• Patents whose claims are clearly unrelated to the venture's technology space

GREY AREA — use judgement:
• Academic papers: discard the paper title, but if the paper describes a directly competing technology, keep it as a short descriptive label (e.g. "Smith et al. 2023 — edible zinc-air battery")

YOUR TASK:
1. For each item in the raw list, decide: keep (normalize name), resolve to assignee/institution, or discard
2. Use web search to find 3–5 additional direct competitors not already in the resulting list
3. Respond with JSON only — no markdown, no explanation outside the JSON:
{"validated":[],"added":[],"removed":[],"notes":"one concise sentence describing what was resolved, removed, and discovered"}

"validated" = items kept from the original list (company/product name, or patent number as-is — no pipe-separated tags or metadata suffixes)
"added"     = new competitors discovered via web search
"removed"   = items discarded as genuine noise`;

        const content = [
          `VENTURE: ${ventureCtx?.venture_name || "Unknown"}`,
          `DESCRIPTION: ${ventureCtx?.venture_summary || ""}`,
          `STAGE: ${ventureCtx?.stage || ""}`,
          `BUSINESS MODEL: ${ventureCtx?.classification?.business_model || ""}`,
          ``,
          `RAW COMPETITOR LIST (${(currentList || []).length} items):`,
          (currentList || []).map((c, i) => `${i + 1}. ${c}`).join("\n"),
          ``,
          `DOCUMENT CONTEXT (first 3000 chars):`,
          fence("document", (corpusText || "").slice(0, 3000)),
        ].join("\n");

        const result = await callModelLogged({
          role: "smart",
          json: true,
          system: SYSTEM,
          messages: [{ role: "user", content }],
          useSearch: true,
        });
        return NextResponse.json(result.json);
      }

      default:
        return NextResponse.json({ error: `Unknown step: ${step}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[pipeline]", err);
    return NextResponse.json({ error: err.message }, { status: err instanceof HttpError ? err.status : 500 });
  }
}

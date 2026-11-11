import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSettings, logEvent } from "@/lib/db";
import { callModel } from "@/lib/llm";
import {
  METHODOLOGY_REGISTRY,
  getP0DocSystem, getP0ConceptSystem,
  getExtractSystem, getExecuteSystem, RECHUNK_SYSTEM,
  getReviseSystem, getMethodSummarySystem, getPassSummarySystem,
  getChapterSystem, getExecutiveSystem,
  buildExtractContext,
} from "@/lib/registry";
import { embedBatch, hybridRetrieve, chunkText } from "@/lib/embeddings";
import { parseJSON } from "@/lib/json";
import { fence, rateLimit } from "@/lib/security";
import { computeScore } from "@/lib/scoring";
import { SCORE_DIMENSIONS } from "@/lib/constants";

// Multi-call steps with web search can run for minutes
export const maxDuration = 300;

const ALLOWED_MIME = new Set(["application/pdf", "image/png", "image/jpeg"]);
const MAX_FILE_BASE64 = 28_000_000;   // ≈ 20 MB of binary
const MAX_CORPUS_CHARS = 2_000_000;
const MAX_CHUNKS = 3000;

class HttpError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

function requireFile(body) {
  const { fileBase64, fileType } = body;
  if (typeof fileBase64 !== "string" || !fileBase64) throw new HttpError("Missing file");
  if (fileBase64.length > MAX_FILE_BASE64) throw new HttpError("File too large (20 MB maximum)", 413);
  if (!ALLOWED_MIME.has(fileType)) throw new HttpError("Unsupported file type (PDF, PNG or JPEG only)", 415);
}

const TRUNCATION_NOTE = "\n\n> ⚠ **This output hit the model's length limit and may be incomplete.** Re-run, or choose a model with a larger output window in Settings.";

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

// Build compact venture header injected into every extract/execute call
function ventureHeader(ventureCtx) {
  if (!ventureCtx?.venture_name) return "";
  const c = ventureCtx.classification || {};
  return `VENTURE: ${ventureCtx.venture_name} | ${c.business_model?.toUpperCase() || "?"} | ${ventureCtx.stage || "?"}
SUMMARY: ${ventureCtx.venture_summary || ""}
`;
}

export async function POST(request) {
  try {
    const { userId } = await auth();
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

    // Logged wrapper — records every LLM call with step, model and real token usage.
    //   json: true → output is parsed (one corrective retry on bad/truncated JSON)
    //                and returned as result.json
    async function callModelLogged({ json = false, ...args }) {
      const roleConfig = settings.roles?.[args.role];
      const logCall = (r) => logEvent({
        userId,
        eventType: "pipeline_call",
        step,
        model: roleConfig?.model || args.role,
        inputText:  args.messages?.map(m => typeof m.content === "string" ? m.content : "").join("") || "",
        outputText: r.text || "",
        usage: r.usage,
      });

      let result = await callModel(args, settings);
      logCall(result);
      if (!json) return result;

      try {
        return { ...result, json: parseJSON(result.text) };
      } catch (firstErr) {
        const retry = await callModel({
          ...args,
          maxTokens: result.truncated ? Math.min((args.maxTokens || 16000) * 2, 32000) : args.maxTokens,
          messages: [
            ...args.messages,
            { role: "assistant", content: (result.text || "").slice(0, 4000) },
            { role: "user", content: "Your previous reply was not valid, complete JSON. Reply again with ONLY the complete JSON object, no commentary." },
          ],
        }, settings);
        logCall(retry);
        try {
          return { ...retry, json: parseJSON(retry.text) };
        } catch {
          throw new Error(`The model returned invalid JSON twice (${firstErr.message}). Try again or switch model in Settings.`);
        }
      }
    }

    switch (step) {

      // ── 1. Extract text from PDF ──────────────────────────────────────────
      case "ingest": {
        requireFile(body);
        const { fileBase64, fileType, fileName } = body;
        const result = await callModelLogged({
          role: "fast",
          system: TEXT_EXTRACT_SYSTEM,
          messages: [{ role: "user", content: "Transcribe all text from this document." }],
          file: { base64: fileBase64, mimeType: fileType },
          maxTokens: 24000,
        });
        // Index the full text so every method can retrieve from the whole document
        const chunks = await indexDocument(result.text, fileName);
        return NextResponse.json({ text: result.text, chunks, truncated: !!result.truncated });
      }

      // ── 1b. Ingest additional document into chunks (with embeddings) ──────
      case "ingest_doc": {
        requireFile(body);
        const { fileBase64, fileType, fileName } = body;

        // Extract text
        const ingest = await callModelLogged({
          role: "fast",
          system: TEXT_EXTRACT_SYSTEM,
          messages: [{ role: "user", content: "Transcribe all text from this document." }],
          file: { base64: fileBase64, mimeType: fileType },
          maxTokens: 24000,
        });
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

        return NextResponse.json({ text: docText, chunks: [...fullChunks, ...newChunks], truncated: !!ingest.truncated });
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
        requireFile(body);
        const { fileBase64, fileType, userContext, entities, priorityFocus } = body;
        const result = await callModelLogged({
          role: "smart",
          json: true,
          system: getP0DocSystem(userContext, entities, priorityFocus),
          messages: [{ role: "user", content: "Analyze this pitch deck. Produce the structured JSON classification." }],
          file: { base64: fileBase64, mimeType: fileType },
        });
        return NextResponse.json(result.json);
      }

      // ── 3b. P0 from concept (web search) ─────────────────────────────────
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

      // ── 4. Extract evidence (hybrid retrieval) ────────────────────────────
      case "extract": {
        const { methodologyId, corpusText, entities, webChunks, priorOutputs, methodSummaries, ventureCtx } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });

        // Hybrid retrieval: tag filter ∪ vector search
        const hybridChunks = (webChunks?.length)
          ? await hybridRetrieve(mDef.extract_query, webChunks, mDef.entity_filter, mDef.data_type_filter, 30)
          : [];

        const context = buildExtractContext(mDef, corpusText, hybridChunks, priorOutputs, methodSummaries || {});
        const header = ventureHeader(ventureCtx);

        const result = await callModelLogged({
          role: "fast",
          json: true,
          system: `${header}${getExtractSystem(mDef, entities)}`,
          messages: [{ role: "user", content: `${context}\n\nExtract evidence for "${mDef.name}".` }],
        });
        return NextResponse.json(result.json);
      }

      // ── 5. Execute methodology ────────────────────────────────────────────
      case "execute": {
        const { methodologyId, evidenceBundle, ventureCtx, userNotes } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });
        const header = ventureHeader(ventureCtx);
        const result = await callModelLogged({
          role: "smart",
          system: `${header}${getExecuteSystem(mDef, ventureCtx)}`,
          messages: [{ role: "user", content: `EVIDENCE BUNDLE:\n${fence("evidence bundle", JSON.stringify(evidenceBundle, null, 2))}\n\n${userNotes ? `USER NOTES:\n${userNotes}\n\n` : ""}Execute the "${mDef.name}" methodology. Use web search to fill gaps.` }],
          useSearch: true,
        });
        return NextResponse.json({ text: result.text + (result.truncated ? TRUNCATION_NOTE : ""), searchResults: result.searchResults, truncated: !!result.truncated });
      }

      // ── 6. Rechunk web results (with embeddings) ──────────────────────────
      case "rechunk": {
        const { searchResults, methodologyId } = body;
        if (!searchResults?.length) return NextResponse.json([]);
        const searchText = searchResults
          .filter(r => r.text?.length > 50)
          .map((r, i) => `[Source ${i}: ${r.title}]\nURL: ${r.url}\n${r.text}`)
          .join("\n\n---\n\n")
          .slice(0, 40000); // cap total input to fast model
        if (!searchText.trim()) return NextResponse.json([]);

        const result = await callModelLogged({
          role: "fast",
          system: RECHUNK_SYSTEM,
          messages: [{ role: "user", content: `Web search results from "${methodologyId}". Extract and tag useful data points.\n\n${fence("web search results", searchText)}` }],
        });

        let chunks = [];
        try { chunks = parseJSON(result.text); } catch { chunks = []; }

        const tagged = chunks.map(c => ({
          ...c, source_type: "web_search", retrieved_by: methodologyId, ingested_at: new Date().toISOString(),
        }));

        // Embed all chunks
        if (tagged.length > 0) {
          const embeddings = await embedBatch(tagged.map(c => c.text));
          tagged.forEach((c, i) => { c.embedding = embeddings[i]; });
        }

        return NextResponse.json(tagged);
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

      // ── 9. Revise existing analysis ───────────────────────────────────────
      case "revise": {
        const { methodologyId, evidenceBundle, priorResult, userNotes, ventureCtx, webChunks } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });

        // Hybrid-retrieve any new chunks relevant to this methodology
        const hybridChunks = (webChunks?.length)
          ? await hybridRetrieve(mDef.extract_query, webChunks, mDef.entity_filter, mDef.data_type_filter, 30)
          : [];
        const newEvidenceSection = hybridChunks.length
          ? `\n\nNEW EVIDENCE FROM ADDITIONAL DOCUMENTS:\n${fence("additional evidence", hybridChunks.map((c, i) => `[New${i}] ${c.entity}|${c.data_type}|via:${c.retrieved_by}\n${c.text}`).join("\n\n"))}`
          : "";

        const header = ventureHeader(ventureCtx);
        const res = await callModelLogged({
          role: "smart",
          system: `${header}${getReviseSystem(mDef, ventureCtx)}`,
          messages: [{ role: "user", content: `PRIOR DRAFT:\n${priorResult}\n\nEVIDENCE BUNDLE:\n${fence("evidence bundle", JSON.stringify(evidenceBundle, null, 2))}${newEvidenceSection}\n\n${userNotes ? `USER NOTES:\n${userNotes}\n\n` : ""}Revise the analysis. Use web search if needed.` }],
          useSearch: true,
        });
        return NextResponse.json({ text: res.text + (res.truncated ? TRUNCATION_NOTE : ""), searchResults: res.searchResults, truncated: !!res.truncated });
      }

      // ── 10. Compile pass chapter ──────────────────────────────────────────────
      case "compile_chapter": {
        const { passId, passTitle, methodResults: passMethodResults, passSummary, ventureCtx } = body;
        const passDef = { id: passId, title: passTitle };
        const header = ventureHeader(ventureCtx);
        const methodsText = Object.entries(passMethodResults)
          .map(([id, text]) => {
            const mDef = METHODOLOGY_REGISTRY[id];
            return `### ${mDef?.name || id}\n\n${text}`;
          }).join("\n\n---\n\n");
        const passSummaryText = passSummary
          ? `\n\nPASS SUMMARY:\nVerdict: ${passSummary.pass_verdict || ""}\nStrongest findings: ${(passSummary.strongest_findings || []).join("; ")}\nKey risks: ${(passSummary.key_risks || []).join("; ")}`
          : "";
        const res = await callModelLogged({
          role: "doc_chapter",
          system: `${header}${getChapterSystem(passDef, ventureCtx)}`,
          messages: [{ role: "user", content: `Write the chapter for "${passTitle}" using these methodology results:${passSummaryText}\n\n${fence("methodology results", methodsText.slice(0, 40000))}` }],
        });
        return NextResponse.json({ passId, text: res.text + (res.truncated ? TRUNCATION_NOTE : "") });
      }

      // ── 11. Compile executive summary ─────────────────────────────────────────
      case "compile_exec": {
        const { chapters, ventureCtx } = body;
        const header = ventureHeader(ventureCtx);
        const chaptersText = Object.entries(chapters)
          .map(([passId, text]) => `## ${passId}\n\n${text}`)
          .join("\n\n---\n\n");
        const res = await callModelLogged({
          role: "doc_exec",
          json: true,
          system: `${header}${getExecutiveSystem(ventureCtx)}`,
          messages: [{ role: "user", content: `Synthesise these analytical chapters into the executive summary:\n\n${fence("chapters", chaptersText.slice(0, 80000))}` }],
        });

        // Score and verdict are computed in code. A dimension is forced to null
        // when none of the passes that inform it were actually run.
        const ran = new Set(Object.keys(chapters || {}));
        const dimScores = { ...(res.json.dimension_scores || {}) };
        for (const d of SCORE_DIMENSIONS) {
          if (!d.passes.some(p => ran.has(p))) dimScores[d.id] = { score: null, confidence: null, evidence: ["Not assessed - the relevant analysis pass was not run."] };
        }
        const computed = computeScore(dimScores);
        return NextResponse.json({
          ...res.json,
          dimension_scores: undefined,
          score_breakdown: computed.dimensions,
          score_coverage: computed.coverage,
          verdict: computed.verdict,
          score: computed.score,
          score_rationale: computed.score_rationale,
        });
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

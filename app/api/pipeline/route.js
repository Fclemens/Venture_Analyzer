import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getSettings } from "@/lib/db";
import { callModel } from "@/lib/llm";
import {
  METHODOLOGY_REGISTRY,
  getP0DocSystem, getP0ConceptSystem,
  getExtractSystem, getExecuteSystem, RECHUNK_SYSTEM,
  getReviseSystem, getMethodSummarySystem, getPassSummarySystem,
  getChapterSystem, getExecutiveSystem,
  buildExtractContext,
} from "@/lib/registry";
import { embedBatch, hybridRetrieve } from "@/lib/embeddings";

function parseJSON(text) {
  let c = (text || "").replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
  const s = c.indexOf("{"), e = c.lastIndexOf("}");
  const sa = c.indexOf("["), ea = c.lastIndexOf("]");
  if (sa >= 0 && (s < 0 || sa < s)) c = c.substring(sa, ea + 1);
  else if (s >= 0) c = c.substring(s, e + 1);
  return JSON.parse(c);
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
    const body = await request.json();
    const { step } = body;
    const settings = getSettings(userId);

    switch (step) {

      // ── 1. Extract text from PDF ──────────────────────────────────────────
      case "ingest": {
        const { fileBase64, fileType } = body;
        const result = await callModel({
          role: "fast",
          system: TEXT_EXTRACT_SYSTEM,
          messages: [{ role: "user", content: "Transcribe all text from this document." }],
          file: { base64: fileBase64, mimeType: fileType },
        }, settings);
        return NextResponse.json({ text: result.text });
      }

      // ── 1b. Ingest additional document into chunks (with embeddings) ──────
      case "ingest_doc": {
        const { fileBase64, fileType, fileName, existingChunks = [] } = body;

        // Extract text
        const ingest = await callModel({
          role: "fast",
          system: TEXT_EXTRACT_SYSTEM,
          messages: [{ role: "user", content: "Transcribe all text from this document." }],
          file: { base64: fileBase64, mimeType: fileType },
        }, settings);
        const docText = ingest.text;

        // Rechunk into tagged data points
        const rechunkResult = await callModel({
          role: "fast",
          system: RECHUNK_SYSTEM,
          messages: [{ role: "user", content: `Additional document: "${fileName}". Extract and tag useful data points.\n\n${docText.slice(0, 15000)}` }],
        }, settings);

        let rawChunks = [];
        try { rawChunks = parseJSON(rechunkResult.text); } catch { rawChunks = []; }

        const newChunks = rawChunks.map(c => ({
          ...c,
          source_type: "additional_doc",
          retrieved_by: fileName,
          ingested_at: new Date().toISOString(),
        }));

        // Embed all new chunks
        if (newChunks.length > 0) {
          const embeddings = await embedBatch(newChunks.map(c => c.text));
          newChunks.forEach((c, i) => { c.embedding = embeddings[i]; });
        }

        return NextResponse.json({ text: docText, chunks: newChunks });
      }

      // ── 2. Entity scan ────────────────────────────────────────────────────
      case "entities": {
        const { corpusText } = body;
        const result = await callModel({
          role: "fast",
          system: ENTITY_SCAN_SYSTEM,
          messages: [{ role: "user", content: `Scan this document for named entities:\n\n${corpusText.slice(0, 8000)}` }],
        }, settings);
        return NextResponse.json(parseJSON(result.text));
      }

      // ── 3a. P0 from document ──────────────────────────────────────────────
      case "p0_doc": {
        const { fileBase64, fileType, userContext, entities, priorityFocus } = body;
        const result = await callModel({
          role: "smart",
          system: getP0DocSystem(userContext, entities, priorityFocus),
          messages: [{ role: "user", content: "Analyze this pitch deck. Produce the structured JSON classification." }],
          file: { base64: fileBase64, mimeType: fileType },
        }, settings);
        return NextResponse.json(parseJSON(result.text));
      }

      // ── 3b. P0 from concept (web search) ─────────────────────────────────
      case "p0_concept": {
        const { conceptCard, priorityFocus } = body;
        const result = await callModel({
          role: "smart",
          system: getP0ConceptSystem(conceptCard, priorityFocus),
          messages: [{ role: "user", content: `Analyze this venture concept and produce the structured JSON classification. Use web search to fill gaps.\n\nVENTURE: ${conceptCard.name} — ${conceptCard.description}` }],
          useSearch: true,
        }, settings);
        return NextResponse.json(parseJSON(result.text));
      }

      // ── 4. Extract evidence (hybrid retrieval) ────────────────────────────
      case "extract": {
        const { methodologyId, corpusText, entities, webChunks, priorOutputs, methodSummaries, ventureCtx } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });

        // Hybrid retrieval: tag filter ∪ vector search
        const hybridChunks = (webChunks?.length)
          ? await hybridRetrieve(mDef.extract_query, webChunks, mDef.entity_filter, mDef.data_type_filter)
          : [];

        const context = buildExtractContext(mDef, corpusText, hybridChunks, priorOutputs, methodSummaries || {});
        const header = ventureHeader(ventureCtx);

        const result = await callModel({
          role: "fast",
          system: `${header}${getExtractSystem(mDef, entities)}`,
          messages: [{ role: "user", content: `${context}\n\nExtract evidence for "${mDef.name}".` }],
        }, settings);
        return NextResponse.json(parseJSON(result.text));
      }

      // ── 5. Execute methodology ────────────────────────────────────────────
      case "execute": {
        const { methodologyId, evidenceBundle, ventureCtx, userNotes } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });
        const header = ventureHeader(ventureCtx);
        const result = await callModel({
          role: "smart",
          system: `${header}${getExecuteSystem(mDef, ventureCtx)}`,
          messages: [{ role: "user", content: `EVIDENCE BUNDLE:\n${JSON.stringify(evidenceBundle, null, 2)}\n\n${userNotes ? `USER NOTES:\n${userNotes}\n\n` : ""}Execute the "${mDef.name}" methodology. Use web search to fill gaps.` }],
          useSearch: true,
        }, settings);
        return NextResponse.json({ text: result.text, searchResults: result.searchResults });
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

        const result = await callModel({
          role: "fast",
          system: RECHUNK_SYSTEM,
          messages: [{ role: "user", content: `Web search results from "${methodologyId}". Extract and tag useful data points.\n\n${searchText}` }],
        }, settings);

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
        const res = await callModel({
          role: "fast",
          system: `${header}${getMethodSummarySystem(mDef, ventureCtx)}`,
          messages: [{ role: "user", content: `Summarise this analysis:\n\n${analysisText}` }],
        }, settings);
        return NextResponse.json(parseJSON(res.text));
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
        const res = await callModel({
          role: "smart",
          system: `${header}${getPassSummarySystem(passTitle, ventureCtx)}`,
          messages: [{ role: "user", content: `Synthesise the following methodology analyses for pass "${passTitle}":\n\n${combinedResults}` }],
        }, settings);
        return NextResponse.json({ passId, ...parseJSON(res.text) });
      }

      // ── 9. Revise existing analysis ───────────────────────────────────────
      case "revise": {
        const { methodologyId, evidenceBundle, priorResult, userNotes, ventureCtx, webChunks } = body;
        const mDef = METHODOLOGY_REGISTRY[methodologyId];
        if (!mDef) return NextResponse.json({ error: "Unknown methodology" }, { status: 400 });

        // Hybrid-retrieve any new chunks relevant to this methodology
        const hybridChunks = (webChunks?.length)
          ? await hybridRetrieve(mDef.extract_query, webChunks, mDef.entity_filter, mDef.data_type_filter)
          : [];
        const newEvidenceSection = hybridChunks.length
          ? `\n\nNEW EVIDENCE FROM ADDITIONAL DOCUMENTS:\n${hybridChunks.map((c, i) => `[New${i}] ${c.entity}|${c.data_type}|via:${c.retrieved_by}\n${c.text}`).join("\n\n")}`
          : "";

        const header = ventureHeader(ventureCtx);
        const res = await callModel({
          role: "smart",
          system: `${header}${getReviseSystem(mDef, ventureCtx)}`,
          messages: [{ role: "user", content: `PRIOR DRAFT:\n${priorResult}\n\nEVIDENCE BUNDLE:\n${JSON.stringify(evidenceBundle, null, 2)}${newEvidenceSection}\n\n${userNotes ? `USER NOTES:\n${userNotes}\n\n` : ""}Revise the analysis. Use web search if needed.` }],
          useSearch: true,
        }, settings);
        return NextResponse.json({ text: res.text, searchResults: res.searchResults });
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
        const res = await callModel({
          role: "doc_chapter",
          system: `${header}${getChapterSystem(passDef, ventureCtx)}`,
          messages: [{ role: "user", content: `Write the chapter for "${passTitle}" using these methodology results:${passSummaryText}\n\n${methodsText.slice(0, 30000)}` }],
        }, settings);
        return NextResponse.json({ passId, text: res.text });
      }

      // ── 11. Compile executive summary ─────────────────────────────────────────
      case "compile_exec": {
        const { chapters, ventureCtx } = body;
        const header = ventureHeader(ventureCtx);
        const chaptersText = Object.entries(chapters)
          .map(([passId, text]) => `## ${passId}\n\n${text}`)
          .join("\n\n---\n\n");
        const res = await callModel({
          role: "doc_exec",
          system: `${header}${getExecutiveSystem(ventureCtx)}`,
          messages: [{ role: "user", content: `Synthesise these analytical chapters into the executive summary:\n\n${chaptersText.slice(0, 60000)}` }],
        }, settings);
        return NextResponse.json(parseJSON(res.text));
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
          (corpusText || "").slice(0, 3000),
        ].join("\n");

        const result = await callModel({
          role: "smart",
          system: SYSTEM,
          messages: [{ role: "user", content }],
          useSearch: true,
        }, settings);
        return NextResponse.json(parseJSON(result.text));
      }

      default:
        return NextResponse.json({ error: `Unknown step: ${step}` }, { status: 400 });
    }
  } catch (err) {
    console.error("[pipeline]", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

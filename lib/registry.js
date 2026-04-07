import { DEPENDENCIES } from "./constants.js";

export const METHODOLOGY_REGISTRY = {
  value_chain_map:      { id: "value_chain_map",      name: "Value chain map",              pass: "p1", extraction_type: "structural",       extract_query: "Extract all mentions of value chain steps, suppliers, partners, distribution channels, transformation processes, make-vs-buy decisions.", entity_filter: ["startup","market","partner"],           data_type_filter: ["operational","strategic","product"],                      when_high: "Complex product, hardware, deep-tech",           when_low: "Simple consumer app, pure digital" },
  stakeholder_deep_map: { id: "stakeholder_deep_map", name: "Stakeholder deep map",          pass: "p1", extraction_type: "structural",       extract_query: "Extract buyers, users, decision-makers, influencers, blockers, procurement processes, buying committees, approval chains.", entity_filter: ["startup","customer","market"],           data_type_filter: ["customer_evidence","strategic","operational"],            when_high: "B2B multi-stakeholder, enterprise, regulated",   when_low: "B2C where user=payer=decider" },
  value_creation_capture:{ id: "value_creation_capture", name: "Value creation vs capture",  pass: "p1", extraction_type: "qualitative",      extract_query: "Extract where value is created vs where revenue is captured. Look for margin data, pricing power indicators, platform dependency risks.", entity_filter: ["startup","competitor","market"],          data_type_filter: ["financials","strategic","market_data"],                  when_high: "Platform/marketplace, intermediary models",      when_low: "Direct sale, simple value chain" },
  topdown_tam:          { id: "topdown_tam",           name: "Top-down TAM",                 pass: "p2", extraction_type: "quantitative",     extract_query: "Extract all market size figures, TAM data, industry revenue numbers, growth rates, forecasts. Note year, source, geographic scope.", entity_filter: ["market"],                                data_type_filter: ["market_data","financials"],                               when_high: "Always useful",                                  when_low: "Never skip" },
  bottomup_validation:  { id: "bottomup_validation",   name: "Bottom-up validation",         pass: "p2", extraction_type: "quantitative",     extract_query: "Extract customer counts, unit prices, transaction volumes, contract values, usage frequency. Note startup vs competitor vs market.", entity_filter: ["startup","competitor","market"],          data_type_filter: ["financials","market_data","customer_evidence"],           when_high: "Countable units, benchmark data available",      when_low: "Nascent markets, no adoption data" },
  sizing_unit_selection:{ id: "sizing_unit_selection", name: "Sizing unit selection",        pass: "p2", extraction_type: "structural",       extract_query: "Extract who pays vs who uses vs who decides. Pricing model descriptions (per-seat, per-company, per-transaction), contract structures.", entity_filter: ["startup","market"],                      data_type_filter: ["financials","strategic","customer_evidence"],             when_high: "Payer ≠ user, complex pricing",                  when_low: "Simple B2C with obvious unit" },
  direct_competitor_map:{ id: "direct_competitor_map", name: "Direct competitor map",        pass: "p3", extraction_type: "competitive_intel",extract_query: "Extract all competitor mentions: names, products, pricing, positioning, funding, team size, geographic presence, strengths, weaknesses.", entity_filter: ["competitor"],                            data_type_filter: ["product","financials","market_data","strategic"],         when_high: "Always run",                                     when_low: "Never skip" },
  feature_parity_grid:  { id: "feature_parity_grid",  name: "Feature parity grid",          pass: "p3", extraction_type: "competitive_intel",extract_query: "Extract feature lists, capability descriptions, technical specs, integration details for startup AND each competitor.", entity_filter: ["startup","competitor"],                   data_type_filter: ["product"],                                               when_high: "5+ competitors, feature-driven market",          when_low: "<3 competitors, brand-driven" },
  positioning_matrix:   { id: "positioning_matrix",   name: "Positioning matrix",           pass: "p3", extraction_type: "competitive_intel",extract_query: "Extract positioning claims, value proposition statements, brand differentiation, pricing tier positioning for startup and competitors.", entity_filter: ["startup","competitor","market"],          data_type_filter: ["strategic","market_data"],                               when_high: "Crowded market, nuanced positioning",            when_low: "Clear category leader" },
  switching_cost_analysis:{id:"switching_cost_analysis",name: "Switching cost analysis",    pass: "p3", extraction_type: "competitive_intel",extract_query: "Extract switching barriers: integration depth, data migration complexity, contract lock-in, retraining costs, workflow dependencies.", entity_filter: ["competitor","customer"],                  data_type_filter: ["product","customer_evidence","operational"],              when_high: "B2B deep integration, enterprise software",      when_low: "B2C low commitment, easy-to-switch" },
  jtbd_map:             { id: "jtbd_map",              name: "Jobs-to-be-done map",          pass: "p4", extraction_type: "qualitative",      extract_query: "Extract customer job descriptions, pain points, desired outcomes, hiring/firing criteria, outcome metrics.", entity_filter: ["customer","market"],                      data_type_filter: ["customer_evidence","strategic"],                         when_high: "Generally useful, especially for positioning",   when_low: "Well-understood commodity markets" },
  wtp_by_stakeholder:   { id: "wtp_by_stakeholder",   name: "WTP by stakeholder",           pass: "p4", extraction_type: "quantitative",     extract_query: "Extract willingness-to-pay signals: price sensitivity, budget constraints, ROI expectations, price comparison comments. Attribute to stakeholder roles.", entity_filter: ["customer","market"],               data_type_filter: ["customer_evidence","financials"],                        when_high: "Payer ≠ user, B2B budget holders",               when_low: "Low-price B2C, standard pricing" },
  customer_voice_synthesis:{id:"customer_voice_synthesis",name:"Customer voice synthesis",  pass: "p4", extraction_type: "qualitative",      extract_query: "Extract customer quotes, review excerpts, forum posts, interview snippets, survey responses. Cluster by sentiment and theme.", entity_filter: ["customer"],                              data_type_filter: ["customer_evidence"],                                     when_high: "Established category, review sites available",   when_low: "Niche B2B, no public customer voice" },
  icp_definition:       { id: "icp_definition",        name: "ICP definition",               pass: "p4", extraction_type: "structural",       extract_query: "Extract ideal customer profile signals: firmographics, technographics, behavioral signals, budget signals, urgency signals.", entity_filter: ["customer","market"],                     data_type_filter: ["customer_evidence","financials","market_data"],           when_high: "B2B diverse potential buyers",                   when_low: "B2C mass-market" },
  channel_inventory:    { id: "channel_inventory",     name: "Channel inventory",            pass: "p5", extraction_type: "structural",       extract_query: "Extract all distribution, sales, and marketing channels. Include cost-per-channel data if available.", entity_filter: ["startup","competitor","market"],          data_type_filter: ["strategic","operational","financials"],                  when_high: "Always useful",                                  when_low: "Never skip" },
  pricing_architecture: { id: "pricing_architecture",  name: "Pricing architecture",         pass: "p5", extraction_type: "quantitative",     extract_query: "Extract all pricing data: startup's model, competitor tiers, price points, discounting patterns, freemium thresholds.", entity_filter: ["startup","competitor"],                   data_type_filter: ["financials","product"],                                  when_high: "Always run",                                     when_low: "Depth varies" },
  stakeholder_routed_gtm:{id:"stakeholder_routed_gtm", name: "Stakeholder-routed GTM",      pass: "p5", extraction_type: "structural",       extract_query: "Extract evidence linking stakeholder roles to channels: where decision-makers get information, how procurement discovers vendors.", entity_filter: ["customer","market","startup"],           data_type_filter: ["customer_evidence","strategic","operational"],            when_high: "Complex stakeholder map, B2B/B2B2C",             when_low: "Simple B2C direct" },
  virality_coefficient: { id: "virality_coefficient",  name: "Virality coefficient",         pass: "p5", extraction_type: "quantitative",     extract_query: "Extract referral mechanics, sharing incentives, network effect signals, viral loop descriptions, K-factor data.", entity_filter: ["startup","customer"],                    data_type_filter: ["customer_evidence","market_data"],                       when_high: "B2C sharing/referral mechanics",                 when_low: "B2B enterprise, no viral loop" },
  ip_defensibility:     { id: "ip_defensibility",      name: "IP & defensibility scan",      pass: "p6", extraction_type: "qualitative",      extract_query: "Extract patents, trade secrets, proprietary technology, data moats, network effects, brand defensibility, first-mover advantages.", entity_filter: ["startup","competitor"],                  data_type_filter: ["strategic","product"],                                   when_high: "Deep-tech, pharma, hardware with patentable IP", when_low: "Commodity SaaS, services" },
  regulatory_requirements:{id:"regulatory_requirements",name:"Regulatory requirements",     pass: "p6", extraction_type: "qualitative",      extract_query: "Extract regulatory mentions, compliance requirements, certifications needed, licensing barriers, government body references.", entity_filter: ["market","regulatory"],                   data_type_filter: ["regulatory","strategic"],                                when_high: "Health, finance, food, transport",               when_low: "Unregulated digital software" },
  cost_structure:       { id: "cost_structure",         name: "Cost structure mapping",       pass: "p7", extraction_type: "quantitative",     extract_query: "Extract all cost data: COGS, operational costs, team costs, infrastructure, CAC, fixed vs variable, burn rate, runway.", entity_filter: ["startup"],                               data_type_filter: ["financials","operational"],                               when_high: "Always run",                                     when_low: "Never skip" },
  unit_economics:       { id: "unit_economics",         name: "Unit economics model",         pass: "p7", extraction_type: "quantitative",     extract_query: "Extract CAC, LTV, ACV, churn, retention, payback period, gross margin, NRR, expansion revenue, cohort data.", entity_filter: ["startup","competitor","market"],          data_type_filter: ["financials"],                                            when_high: "Always run",                                     when_low: "Never skip" },
  scenario_modeling:    { id: "scenario_modeling",      name: "Scenario modeling",            pass: "p7", extraction_type: "quantitative",     extract_query: "Extract assumptions that vary across scenarios: growth rates, penetration rates, pricing assumptions, cost trajectories, funding requirements.", entity_filter: ["startup","market"],                data_type_filter: ["financials","market_data","strategic"],                  when_high: "Always run",                                     when_low: "Depth varies" },
};

export const METHODOLOGY_LIST = Object.values(METHODOLOGY_REGISTRY)
  .map(m => `- ${m.id} (${m.pass}): ${m.name}. HIGH: ${m.when_high}. LOW: ${m.when_low}`)
  .join("\n");

// ─── Prompt builders ──────────────────────────────

const P0_SCHEMA = `{
  "venture_name": "string",
  "venture_summary": "2-3 sentences: what, for whom, how it makes money",
  "product_service": "string",
  "target_market": "string",
  "revenue_model": "string",
  "stage": "pre-seed|seed|series-A|growth",
  "classification": {
    "business_model": "b2c|b2b|b2b2c",
    "product_complexity": "simple|moderate|complex",
    "market_maturity": "nascent|growing|mature|declining",
    "regulatory_exposure": "none|light|moderate|heavy",
    "competitive_density": "low|medium|high|fragmented",
    "stakeholder_complexity": "simple|moderate|complex"
  },
  "stakeholder_hypothesis": { "decider":"","user":"","payer":"","influencer":"","blocker":"" },
  "initial_competitors": [],
  "initial_markets": [],
  "methodology_selections": [{"id":"","decision":"run|lite|skip","reason":""}]
}`;

function focusNote(priorityFocus) {
  if (!priorityFocus?.length) return "";
  return `USER PRIORITY FOCUS: ${priorityFocus.join(", ")} — elevate depth for related passes.\n`;
}

export function getP0DocSystem(userContext, entities, priorityFocus) {
  return `You are a senior venture analyst. Analyze the uploaded pitch deck and produce a structured assessment.
${userContext ? `ADDITIONAL CONTEXT:\n${userContext}\n` : ""}${focusNote(priorityFocus)}ENTITIES FOUND: ${JSON.stringify(entities)}
Respond ONLY with valid JSON:\n${P0_SCHEMA}
For methodology_selections: evaluate EVERY methodology. Score relevance×insight_value×data_availability (0-1 each). Run if product>0.3, lite if 0.1-0.3, skip if <0.1.
METHODOLOGY REGISTRY:\n${METHODOLOGY_LIST}`;
}

export function getP0ConceptSystem(conceptCard, priorityFocus) {
  return `You are a senior venture analyst classifying a venture from a concept brief — no pitch deck. Use web search aggressively.
CONCEPT: Name: ${conceptCard.name} | Desc: ${conceptCard.description} | Sector: ${conceptCard.category || "auto"} | Market: ${conceptCard.targetMarket || "auto"} | Known competitors: ${conceptCard.knownCompetitors?.join(", ") || "find them"}
${focusNote(priorityFocus)}Use web search to: find 3-5 direct competitors, find TAM estimates, identify regulatory requirements, find customer evidence.
Respond ONLY with valid JSON:\n${P0_SCHEMA}
METHODOLOGY REGISTRY:\n${METHODOLOGY_LIST}`;
}

export function getExtractSystem(methodology, entities) {
  return `You are an evidence retrieval specialist. Extract ONLY information relevant to running "${methodology.name}".
KNOWN ENTITIES: Startup: ${entities?.startup_name || "unknown"} | Competitors: ${(entities?.competitors || []).join(", ") || "none"} | Partners: ${(entities?.partners || []).join(", ") || "none"}
ENTITY ATTRIBUTION: Every data point must be attributed to the correct entity.
EXTRACTION QUERY: ${methodology.extract_query}
ENTITY FOCUS: ${methodology.entity_filter.join(", ")} | DATA TYPES: ${methodology.data_type_filter.join(", ")}
SPARSE DATA: Extract partial evidence, identify specific gaps, suggest web queries for analogous industries.
Respond ONLY with JSON:
{"methodology":"${methodology.id}","extraction_type":"${methodology.extraction_type}","evidence_quality":"high|medium|low|sparse","extracted_evidence":[{"content":"","entity":"","data_type":"","confidence":0.9,"source_id":""}],"gaps":[],"conflicts":[],"search_queries_needed":[],"analogues":[]}`;
}

export function getExecuteSystem(methodology, ventureCtx) {
  return `You are a senior analyst executing the "${methodology.name}" methodology.
VENTURE CONTEXT: ${typeof ventureCtx === "string" ? ventureCtx : JSON.stringify(ventureCtx)}
HIGH VALUE WHEN: ${methodology.when_high} | LOW VALUE WHEN: ${methodology.when_low}
RULES:
1. ALWAYS PRODUCE THE ANALYSIS. Never replace it with meta-commentary.
2. SPARSE DATA: State assumptions explicitly, use named analogues with real numbers, flag confidence per finding.
3. Use web search aggressively to fill gaps.
4. Be specific: names, numbers, sources.
5. End with:\n## Key insight\nThe single most important finding.\n## Assumptions made\nBullets (only if sparse data).\n## New data discovered\nAny web search findings with source URLs.
6. If something contradicts prior assumptions, flag as: REVISION TRIGGER: [description]
FORMAT: Clear markdown with ## headers.`;
}

export function getReviseSystem(methodology, ventureCtx) {
  return `You are a senior analyst revising an existing analysis of the "${methodology.name}" methodology.
VENTURE CONTEXT: ${typeof ventureCtx === "string" ? ventureCtx : JSON.stringify(ventureCtx)}
RULES:
1. You will receive a PRIOR DRAFT and may receive NEW EVIDENCE and USER NOTES.
2. Revise the draft to incorporate new evidence and address user notes. Keep what is still valid.
3. Flag every meaningful change with: ✏ REVISED: [what changed and why]
4. If new evidence contradicts the prior draft, flag as: REVISION TRIGGER: [description]
5. Be specific: names, numbers, sources.
6. End with:\n## Key insight\nThe single most important finding (updated if needed).\n## What changed\nBullet list of revisions made.
FORMAT: Clear markdown with ## headers.`;
}

export function getMethodSummarySystem(methodology, ventureCtx) {
  return `You are a senior analyst summarising the findings of the "${methodology.name}" methodology.
VENTURE CONTEXT: ${typeof ventureCtx === "string" ? ventureCtx : JSON.stringify(ventureCtx)}
Produce a structured summary of the analysis. Be specific — use names, numbers, and percentages from the analysis.
Respond ONLY with JSON:
{
  "key_insights": ["string — each a concrete, specific finding with numbers where available"],
  "confidence": "high|medium|low",
  "revision_triggers": ["string — any finding that contradicts P0 assumptions, empty array if none"],
  "one_liner": "string — single sentence capturing the most important finding"
}
Rules:
- key_insights: 5-10 bullets, each specific (not generic). Include the most important numbers.
- revision_triggers: only real contradictions with P0 classification, not just uncertainty.
- one_liner: punchy, investor-grade, max 20 words.`;
}

export function getPassSummarySystem(passTitle, ventureCtx) {
  return `You are a senior analyst synthesising findings across all methodologies in the "${passTitle}" pass.
VENTURE CONTEXT: ${typeof ventureCtx === "string" ? ventureCtx : JSON.stringify(ventureCtx)}
You will receive multiple methodology analyses. Synthesise across them — find patterns, tensions, and cross-cutting insights.
Respond ONLY with JSON:
{
  "synthesis": ["string — cross-methodology insight that couldn't come from any single analysis"],
  "strongest_findings": ["string — the 3-5 most investment-relevant findings from across all methods"],
  "key_risks": ["string — risks or gaps surfaced by this pass"],
  "revision_triggers": ["string — any finding that contradicts P0 assumptions, empty array if none"],
  "pass_verdict": "string — 2-3 sentence verdict on this pass for an investor"
}
Rules:
- synthesis: insights that emerge from combining methods, not just repeating individual results.
- strongest_findings: specific, with numbers. These go into the final report.
- pass_verdict: direct, no hedging, written for a VC reader.`;
}

export function getChapterSystem(passDef, ventureCtx) {
  const v = ventureCtx?.venture_name ? `${ventureCtx.venture_name} (${ventureCtx.stage || "?"}, ${ventureCtx.classification?.business_model?.toUpperCase() || "?"})` : "the venture";
  return `You are a senior investment analyst writing one chapter of a formal venture analysis report on ${v}.

Your chapter covers: ${passDef.title}.

Write a coherent analytical narrative (550–750 words) that synthesises the methodology results into a single flowing chapter. Do NOT just list results — weave them into a coherent argument.

Structure:
1. Opening verdict sentence (1 sentence, bold claim about this dimension)
2. Core findings (3–4 paragraphs, specific data points, numbers, names)
3. Key gaps or uncertainties (1 paragraph)
4. Closing implication for investors (1–2 sentences)

Use markdown: ## for the chapter title, ### for sub-sections if needed. Include specific numbers, names, and evidence. Be direct. Write for a VC reader.`;
}

export function getExecutiveSystem(ventureCtx) {
  const v = ventureCtx?.venture_name || "the venture";
  return `You are a senior investment analyst finalising a venture analysis report on ${v}.

You will receive narrative chapters from multiple analytical passes. Your task:
1. Write a compelling executive summary that synthesises across ALL passes
2. Identify any incoherences or tensions between passes (e.g. P2 claims $500M TAM but P4 demand data implies much smaller)
3. Produce a final investment recommendation with a score

Respond ONLY with JSON:
{
  "investment_thesis": "string — 2–3 sentence thesis capturing the core opportunity and wedge",
  "verdict": "string — one of: Strong Pass | Conditional Pass | Conditional Invest | Strong Invest",
  "score": "string — e.g. 6.5/10",
  "score_rationale": "string — 1 sentence explaining the score",
  "executive_summary": "string — 3–4 paragraph markdown narrative synthesising across all passes, written for a VC",
  "strongest_findings": ["string — 4–6 specific, data-backed findings across passes"],
  "key_risks": ["string — 3–5 specific risks with evidence"],
  "tensions": ["string — any contradiction or incoherence found across passes, empty array if none"],
  "recommendation": "string — 2–3 sentence actionable recommendation for an investor"
}

Rules:
- tensions: be explicit. E.g. "P2 Bottom-up TAM of $65M contradicts P3 competitor evidence showing market leader at $400M revenue"
- score: weight market size (20%), product differentiation (20%), team/execution (20%), business model (20%), risk profile (20%)
- executive_summary: DO NOT repeat section headers — write flowing prose`;
}

export const RECHUNK_SYSTEM = `You are a data librarian. Extract factual data points from web search results and tag them.
Rules: Only factual data (numbers, names, dates, features, pricing). One chunk = one coherent fact per entity. Skip generic text.
Respond with JSON array. Each item:
{"text":"","entity":"competitor:Name|market|regulatory|general","data_type":"financials|product|market_data|customer_evidence|regulatory|operational|strategic","pass_relevance":["p3"],"confidence":0.8,"source_url":"","source_type":"web_search"}
If no useful data: []`;

// hybridChunks: pre-merged result from hybrid retrieval in pipeline route.
// If provided, skips internal tag filter (retrieval already done upstream).
// methodSummaries: optional { [methodId]: { one_liner, key_insights, confidence } }
//   — used instead of truncated full results for more token-efficient prior context.
export function buildExtractContext(methodology, corpusText, hybridChunks, priorOutputs, methodSummaries = {}) {
  const docSection = (corpusText || "").slice(0, 12000);
  const webSection = (hybridChunks || []).length
    ? `\n\nWEB-DISCOVERED DATA:\n${hybridChunks.map((c, i) => `[Web${i}] ${c.entity}|${c.data_type}|via:${c.retrieved_by}\n${c.text}`).join("\n\n")}`
    : "";

  // Fix: look up each method's pass via METHODOLOGY_REGISTRY (method IDs ≠ pass IDs)
  const depPasses = new Set(DEPENDENCIES[methodology.pass] || []);
  const priorSection = Object.entries(priorOutputs || {})
    .filter(([k]) => {
      const methodPass = METHODOLOGY_REGISTRY[k]?.pass;
      return methodPass && depPasses.has(methodPass);
    })
    .map(([k, v]) => {
      const name = METHODOLOGY_REGISTRY[k]?.name || k;
      const summary = methodSummaries[k];
      if (summary?.one_liner || summary?.key_insights?.length) {
        // Prefer compact summary over raw truncated text
        const insights = (summary.key_insights || []).slice(0, 5).map(i => `• ${i}`).join("\n");
        return `[Prior:${name}] ${summary.one_liner || ""}\n${insights}`;
      }
      return `[Prior:${name}] ${(typeof v === "string" ? v : JSON.stringify(v)).slice(0, 1000)}`;
    })
    .join("\n\n");

  return `CORPUS:\n${docSection}${webSection}${priorSection ? `\n\nPRIOR PASS OUTPUTS:\n${priorSection}` : ""}`;
}

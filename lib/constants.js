// ─────────────────────────────────────────────
// PROVIDERS & MODELS
// ─────────────────────────────────────────────

export const PROVIDERS = {
  anthropic: { id: "anthropic", name: "Anthropic", color: "bg-orange-50 text-orange-700 border-orange-200" },
  openai:    { id: "openai",    name: "OpenAI",    color: "bg-green-50 text-green-700 border-green-200" },
  gemini:    { id: "gemini",    name: "Gemini",    color: "bg-blue-50 text-blue-700 border-blue-200" },
};

export const PROVIDER_MODELS = {
  anthropic: [
    { id: "claude-haiku-5-5",          name: "Claude Haiku 5.5",  tier: "fast",  note: "Fastest, cheapest" },
    { id: "claude-sonnet-5-5",         name: "Claude Sonnet 5.5", tier: "smart", note: "Best speed/quality, web search" },
    { id: "claude-opus-5-5",           name: "Claude Opus 5.5",   tier: "smart", note: "Most capable" },
    { id: "claude-haiku-4-5-20251001", name: "Claude Haiku 4.5",  tier: "fast",  note: "Previous generation" },
    { id: "claude-sonnet-4-6",         name: "Claude Sonnet 4.6", tier: "smart", note: "Best speed/quality, web search" },
    { id: "claude-opus-4-6",           name: "Claude Opus 4.6",   tier: "smart", note: "Most capable" },
  ],
  openai: [
    { id: "gpt-5.4-nano", name: "GPT-5.4 Nano", tier: "fast",  note: "Lightest, high-volume" },
    { id: "gpt-5.4-mini", name: "GPT-5.4 Mini", tier: "fast",  note: "Fast, efficient, web search" },
    { id: "gpt-5.4",      name: "GPT-5.4",      tier: "smart", note: "Best reasoning, web search, 1M ctx" },
  ],
  gemini: [
    { id: "gemini-2.5-flash-lite", name: "Gemini 2.5 Flash Lite", tier: "fast",  note: "Lightest" },
    { id: "gemini-2.5-flash",      name: "Gemini 2.5 Flash",      tier: "fast",  note: "Fast, efficient" },
    { id: "gemini-2.5-pro",        name: "Gemini 2.5 Pro",        tier: "smart", note: "Most capable Gemini" },
  ],
};

// Default settings — Anthropic only out of the box
export const DEFAULT_SETTINGS = {
  providers: {
    anthropic: { apiKey: "", enabled: true },
    openai:    { apiKey: "", enabled: false },
    gemini:    { apiKey: "", enabled: false },
  },
  // Third-party data sources; off until the user opts in (they receive company/founder names)
  connectors: {
    openalex:  { enabled: false },
    sec_edgar: { enabled: false },
  },
  roles: {
    fast:        { provider: "anthropic", model: "claude-haiku-5-5" },
    smart:       { provider: "anthropic", model: "claude-sonnet-5-5" },
    doc_chapter: { provider: "anthropic", model: "claude-sonnet-5-5" },
    doc_exec:    { provider: "anthropic", model: "claude-sonnet-5-5" },
  },
};

// ─────────────────────────────────────────────
// PIPELINE DEFINITIONS
// ─────────────────────────────────────────────

export const PASS_DEFS = [
  { id: "p0", num: 0, title: "Scoping & classification", group: "setup" },
  { id: "p1", num: 1, title: "Value architecture",       group: "foundation" },
  { id: "p2", num: 2, title: "Market sizing",            group: "core" },
  { id: "p3", num: 3, title: "Competitive landscape",    group: "core" },
  { id: "p4", num: 4, title: "Demand validation",        group: "core" },
  { id: "p5", num: 5, title: "GTM strategy",             group: "strategy" },
  { id: "p6", num: 6, title: "Regulatory & barriers",    group: "strategy" },
  { id: "p7", num: 7, title: "Financial viability",      group: "synthesis" },
  { id: "p8", num: 8, title: "Team & traction",          group: "foundation" },
  { id: "p9", num: 9, title: "Deal & red team",          group: "synthesis" },
];

export const DEPENDENCIES = {
  p1: ["p0"],
  p2: ["p0", "p1"],
  p3: ["p0", "p1"],
  p4: ["p0", "p1", "p2", "p3"],
  p5: ["p0", "p1", "p3", "p4"],
  p6: ["p0"],
  p7: ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p8"],
  p8: ["p0"],
  p9: ["p0", "p1", "p2", "p3", "p4", "p5", "p6", "p7", "p8"],
};

export const SKETCH_PASSES = ["p0", "p2", "p3", "p4"];

export const PRIORITY_FOCUS_MAP = {
  market_size:    { label: "Market size",    passes: ["p2"] },
  competition:    { label: "Competition",    passes: ["p3"] },
  gtm:            { label: "GTM strategy",   passes: ["p5"] },
  unit_economics: { label: "Unit economics", passes: ["p7"] },
  regulatory:     { label: "Regulatory",     passes: ["p6"] },
  team:           { label: "Team & traction", passes: ["p8"] },
  deal:           { label: "Deal & valuation", passes: ["p9"] },
};

// ─────────────────────────────────────────────
// SCORING RUBRIC — the final score is computed in code from per-dimension
// scores, never taken from a single model-written number.
// ─────────────────────────────────────────────

export const SCORE_DIMENSIONS = [
  { id: "market",          label: "Market",                  weight: 0.20, passes: ["p2"] },
  { id: "differentiation", label: "Differentiation & moat",  weight: 0.20, passes: ["p3", "p6"] },
  { id: "team",            label: "Team",                    weight: 0.20, passes: ["p8"] },
  { id: "traction",        label: "Traction & demand",       weight: 0.15, passes: ["p4", "p8"] },
  { id: "business_model",  label: "Business model",          weight: 0.15, passes: ["p5", "p7"] },
  { id: "risk",            label: "Risk profile",            weight: 0.10, passes: ["p6", "p9"] },
];

// Anchors given to the scoring model for every dimension
export const SCORE_ANCHORS = "1-3 weak/disqualifying · 4-5 below investable par · 6-7 solid · 8-9 strong · 10 exceptional. Use null (not a guess) when the evidence cannot support a score.";

// Verdict thresholds on the weighted 1–10 score
export const VERDICTS = [
  { min: 7.5, label: "Invest" },
  { min: 6.0, label: "Conditional Invest" },
  { min: 4.5, label: "Revisit later" },
  { min: 0,   label: "Decline" },
];
export const MIN_SCORE_COVERAGE = 0.6; // share of total weight that must be scored

// Shown in Settings so users know exactly what leaves their account before opting in
export const CONNECTOR_INFO = {
  openalex: {
    name: "OpenAlex (research literature)",
    sends: "founder names and short product keywords",
    helps: "Team assessment, Product & technology assessment",
  },
  sec_edgar: {
    name: "SEC EDGAR (US Form D funding filings)",
    sends: "the company name",
    helps: "Traction analysis, Deal & valuation",
    needs: "SEC_CONTACT_EMAIL (the SEC requires a contact address in the User-Agent)",
  },
};

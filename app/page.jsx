"use client";
import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import {
  Upload, Play, FileText, Lightbulb, Loader, AlertTriangle, Plus, X,
  Check, ChevronDown, ChevronRight,
  Globe, StickyNote, Search,
} from "lucide-react";
import Sidebar from "@/components/Sidebar";
import SettingsPanel from "@/components/SettingsPanel";
import MethodCard from "@/components/MethodCard";
import PassSummaryCard from "@/components/PassSummaryCard";
import { PASS_DEFS, DEPENDENCIES, SKETCH_PASSES, PRIORITY_FOCUS_MAP } from "@/lib/constants";
import { METHODOLOGY_REGISTRY } from "@/lib/registry";
import { escapeHtml as esc } from "@/lib/security-client";
import { staleDependents } from "@/lib/staleness";
import { UPLOAD_PATTERN, ACCEPT_ATTR, typeOf } from "@/lib/filetypes";
import CommentsPanel from "@/components/CommentsPanel";
import { useOrganization } from "@clerk/nextjs";
import { Users } from "lucide-react";
import FinancialModel from "@/components/FinancialModel";
import DealOverview, { passColor } from "@/components/DealOverview";
import ReportView from "@/components/ReportView";
import { ToastProvider, useToast, ProgressRing, Pill } from "@/components/ui";
import { nextStep, pipelineProgress } from "@/lib/next-step";
import { LayoutDashboard, Coins, FileStack, Globe2 } from "lucide-react";

// ─── API helpers (all LLM calls server-side) ──────────────────────────────────
// The active project, so every model call is attributed to it for usage tracking
let pipelineProjectId = null;
async function pipeline(step, body) {
  const res = await fetch("/api/pipeline", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ step, projectId: pipelineProjectId, ...body }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Pipeline error ${res.status}`);
  return data;
}

// ─── Markdown → HTML (for self-contained HTML report download) ───────────────
function mdToHtml(rawText) {
  if (!rawText) return '';
  const text = esc(rawText); // never let model/web text inject markup into the exported report
  const inline = (t) => (t || '')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/`(.+?)`/g, '<code>$1</code>');
  const lines = text.split('\n');
  let html = '';
  let listItems = [];
  const flushList = () => {
    if (!listItems.length) return;
    html += '<ul>' + listItems.map(li => `<li>${li}</li>`).join('') + '</ul>\n';
    listItems = [];
  };
  for (const line of lines) {
    const t = line.trim();
    if (!t) { flushList(); continue; }
    let m;
    if ((m = t.match(/^#{4} (.*)/)))      { flushList(); html += `<h4>${inline(m[1])}</h4>\n`; }
    else if ((m = t.match(/^#{3} (.*)/))) { flushList(); html += `<h3>${inline(m[1])}</h3>\n`; }
    else if ((m = t.match(/^#{2} (.*)/))) { flushList(); html += `<h2>${inline(m[1])}</h2>\n`; }
    else if ((m = t.match(/^# (.*)/)))    { flushList(); html += `<h1>${inline(m[1])}</h1>\n`; }
    else if (/^---+$/.test(t))            { flushList(); html += '<hr>\n'; }
    else if ((m = t.match(/^[-*] (.*)/))) { listItems.push(inline(m[1])); }
    else                                  { flushList(); html += `<p>${inline(t)}</p>\n`; }
  }
  flushList();
  return html;
}

// ─── Entity chip editor ───────────────────────────────────────────────────────
function EntityChipEditor({ items = [], onAdd, onRemove, onClear, placeholder, color = "blue" }) {
  const [val, setVal] = useState("");
  const cls = { blue:"bg-blue-50 text-blue-700", red:"bg-red-50 text-red-700", purple:"bg-purple-50 text-purple-700", amber:"bg-amber-50 text-amber-700", teal:"bg-teal-50 text-teal-700" };
  return (
    <div>
      <div className="flex flex-wrap gap-1 mb-1.5 min-h-5">
        {items.map((item, i) => (
          <span key={i} className={`inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full font-medium ${cls[color] || cls.blue}`}>
            {item}
            <button onClick={() => onRemove(i)} className="hover:opacity-60"><X size={9} /></button>
          </span>
        ))}
        {items.length === 0 && <span className="text-xs text-gray-300 italic">None</span>}
      </div>
      <div className="flex gap-1 items-center">
        {onClear && items.length > 0 && (
          <button onClick={onClear} className="text-[10px] text-gray-400 hover:text-red-500 underline whitespace-nowrap">Clear all</button>
        )}
        <input value={val} onChange={e => setVal(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter" && val.trim()) { onAdd(val.trim()); setVal(""); } }}
          placeholder={placeholder}
          className="flex-1 text-xs px-2 py-1 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 bg-white text-gray-900 placeholder-gray-400" />
        <button onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(""); } }}
          className="px-2 bg-gray-100 rounded-lg hover:bg-gray-200 text-gray-500"><Plus size={11} /></button>
      </div>
    </div>
  );
}

// ─── Seed input component ──────────────────────────────────────────────────────
function SeedInput({ seeds, onAdd, onRemove, label, placeholder }) {
  const [val, setVal] = useState("");
  return (
    <div className="mb-2">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <div className="flex gap-1.5 mb-1">
        <input value={val} onChange={e => setVal(e.target.value)} placeholder={placeholder}
          onKeyDown={e => { if (e.key === "Enter" && val.trim()) { onAdd(val.trim()); setVal(""); } }}
          className="flex-1 text-xs px-2.5 py-1.5 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
        <button onClick={() => { if (val.trim()) { onAdd(val.trim()); setVal(""); } }}
          className="px-2 bg-gray-100 rounded-lg hover:bg-gray-200"><Plus size={12} /></button>
      </div>
      <div className="flex flex-wrap gap-1">
        {seeds.map((s, i) => (
          <span key={i} className="inline-flex items-center gap-1 text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded-md">
            {s}<button onClick={() => onRemove(i)}><X size={9} /></button>
          </span>
        ))}
      </div>
    </div>
  );
}

// ─── Badge ─────────────────────────────────────────────────────────────────────
function Badge({ type, children }) {
  const s = { doc:"bg-blue-50 text-blue-700", concept:"bg-yellow-50 text-yellow-700", url:"bg-teal-50 text-teal-700", note:"bg-yellow-50 text-yellow-700", web_discovered:"bg-purple-50 text-purple-700" };
  return <span className={`text-xs px-1.5 py-0.5 rounded-full font-medium border ${s[type] || "bg-gray-100 text-gray-500"}`}>{children}</span>;
}

const SOURCE_ICONS = { document: FileText, url: Globe, note: StickyNote, web_discovered: Search };
const SOURCE_LABELS = { document: "PDF", url: "URL", note: "Note", web_discovered: "Web" };

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
function PageInner() {
  const toast = useToast();
  // ── Projects ──────────────────────────────────────────────────────────────────
  const [projects, setProjects] = useState([]);
  const [activeId, setActiveId] = useState(null);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // ── Setup inputs (not persisted to DB until analysis starts) ──────────────────
  const [entryMode, setEntryMode] = useState("document");
  const [files, setFiles] = useState([]); // [{ file, base64, mimeType }] — first is primary
  const [dropDragging, setDropDragging] = useState(false);
  const [conceptCard, setConceptCard] = useState({ name: "", description: "", category: "", targetMarket: "", knownCompetitors: [] });
  const [userCtx, setUserCtx] = useState("");
  const [priorityFocus, setPriorityFocus] = useState([]);
  const [pipelineMode, setPipelineMode] = useState("full");

  // ── Pipeline state (persisted to DB) ─────────────────────────────────────────
  const [screen, setScreen] = useState("setup");
  const [corpusText, setCorpusText] = useState("");
  const [entities, setEntities] = useState(null);
  const [p0, setP0] = useState(null);
  const [methods, setMethods] = useState([]);
  const [methodStatus, setMethodStatus] = useState({});
  const [evidenceBundles, setEvidenceBundles] = useState({});
  const [methodResults, setMethodResults] = useState({});
  const [methodNotes, setMethodNotes] = useState({});
  const [methodSummaries, setMethodSummaries] = useState({});   // { [methodId]: { key_insights, confidence, revision_triggers, one_liner } }
  const [passSummaries, setPassSummaries] = useState({});       // { [passId]: { synthesis, strongest_findings, key_risks, revision_triggers, pass_verdict } }
  const [passSummaryStale, setPassSummaryStale] = useState({}); // { [passId]: true } when stale
  const [docState, setDocState] = useState({ chapters: {}, execSummary: null, generating: false, progress: "" });
  const [sources, setSources] = useState([]);
  // Searchable evidence chunks (and their embeddings) live on the server; the
  // browser only keeps counts for display.
  const [chunkStats, setChunkStats] = useState({ total: 0, web: 0, document: 0 });
  const { organization } = useOrganization();
  const [projectMeta, setProjectMeta] = useState({ is_owner: true, shared: false });
  const [commentCounts, setCommentCounts] = useState({});
  const [usage, setUsage] = useState({ calls: 0, tokens: 0 });
  const [founderAnswers, setFounderAnswers] = useState({}); // { question text: { asked, answer } }
  const [focusMethodId, setFocusMethodId] = useState(null);
  const [mobileNav, setMobileNav] = useState(false);
  const [runStartedAt, setRunStartedAt] = useState({}); // methodId → when its current step started (for the elapsed timer)
  const [finModel, setFinModel] = useState(null);       // { currency, assumptions, scenarios } — inputs only; results are computed
  const [finProposing, setFinProposing] = useState(false);
  const finSaveTimer = useRef(null);
  const [resultTimes, setResultTimes] = useState({});   // methodId → when its result text last changed
  const runVersions = useRef({});   // last seen version per method run (cheap change detection)
  const activeIdRef = useRef(null);
  const entitiesRef = useRef(null);
  const syncRunsRef = useRef(null);
  const loadReportRef = useRef(null);
  const refreshCommentsRef = useRef(null);
  const [activePass, setActivePass] = useState("p0");

  // ── Competitor validation ─────────────────────────────────────────────────────
  const [competitorValidating, setCompetitorValidating] = useState(false);
  const [competitorValidationNote, setCompetitorValidationNote] = useState(null); // transient note after validation

  // ── Loading / error ───────────────────────────────────────────────────────────
  const [loading, setLoading] = useState(false);
  const [loadingMsg, setLoadingMsg] = useState("");
  const [error, setError] = useState(null);
  const [methodLoading, setMethodLoading] = useState({});
  const fileRef = useRef(null);
  const addDocRef = useRef(null);
  const [addingDoc, setAddingDoc] = useState(false);
  const [expandedSourceId, setExpandedSourceId] = useState(null);

  // ── Load project list on mount (and open ?project=<id> deep links) ─────────────
  const deepLinkRef = useRef(typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("project") : null);
  useEffect(() => {
    fetch("/api/projects").then(r => r.json()).then(setProjects).catch(console.error);
  }, []);

  // ── Save pipeline state to DB after each meaningful change ─────────────────────
  const saveState = useCallback(async (id, patch) => {
    if (!id) return;
    await fetch(`/api/projects/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state: patch }),
    });
    // Refresh project list
    fetch("/api/projects").then(r => r.json()).then(setProjects).catch(console.error);
  }, []);

  // ── File handler ───────────────────────────────────────────────────────────────
  const readFiles = useCallback((fileList) => {
    const MAX_BYTES = 20 * 1024 * 1024;
    const typed = Array.from(fileList).filter(f => UPLOAD_PATTERN.test(f.name));
    const accepted = typed.filter(f => f.size <= MAX_BYTES);
    if (typed.length > accepted.length) setError("Some files were skipped: the limit is 20 MB per file.");
    else if (!typed.length && fileList.length) setError("Supported files: PDF, images, Word, PowerPoint, Excel, CSV and text.");
    if (!accepted.length) return;
    Promise.all(accepted.map(f => new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve({ file: f, base64: reader.result.split(",")[1], mimeType: typeOf(f.name)?.mime });
      };
      reader.readAsDataURL(f);
    }))).then(loaded => setFiles(prev => {
      // Deduplicate by filename
      const existing = new Set(prev.map(x => x.file.name));
      return [...prev, ...loaded.filter(x => !existing.has(x.file.name))];
    }));
  }, []);

  // ── Build methods from P0 result ────────────────────────────────────────────────
  const buildMethods = useCallback((p0Result, pfocus, pmode) => {
    let selections = (p0Result.methodology_selections || [])
      .map(s => ({ ...s, ...METHODOLOGY_REGISTRY[s.id] }))
      .filter(s => s.id);
    // Elevate priority focus passes
    const focusPasses = (pfocus || []).flatMap(f => PRIORITY_FOCUS_MAP[f]?.passes || []);
    if (focusPasses.length) {
      selections = selections.map(s => focusPasses.includes(s.pass) && s.decision === "skip" ? { ...s, decision: "lite" } : s);
    }
    // Sketch mode
    if (pmode === "sketch") {
      selections = selections.map(s => SKETCH_PASSES.includes(s.pass) ? s : { ...s, decision: "skip" });
    }
    return selections;
  }, []);

  // ── Remove a source and its associated chunks (server-side) ───────────────────
  const removeSource = useCallback(async (sourceId) => {
    const source = sources.find(s => s.id === sourceId);
    if (!source || !activeId) return;
    const isWeb = source.type === "web_discovered";
    try {
      const qs = new URLSearchParams(isWeb ? { id: sourceId } : { id: sourceId, name: source.name });
      const res = await fetch(`/api/projects/${activeId}/sources?${qs}`, { method: "DELETE" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setChunkStats((await res.json()).chunks);
    } catch (err) {
      setError(`Could not remove source: ${err.message}`);
      return;
    }
    const newSources = sources.filter(s => s.id !== sourceId);
    // Remove source text from corpus (best effort — strip the appended block)
    const newCorpus = source.rawText
      ? corpusText.replace(`\n\n---\n\n${source.rawText}`, "").replace(source.rawText, "")
      : corpusText;
    setSources(newSources);
    setCorpusText(newCorpus);
    await saveState(activeId, { corpusText: newCorpus, entities, p0, methods, methodNotes, sources: newSources });
  }, [sources, corpusText, activeId, entities, p0, methods, methodNotes, saveState]);

  // ── Add additional document to source library ──────────────────────────────────
  // ── Update entities and persist ──────────────────────────────────────────────
  const updateEntities = useCallback(async (newEntities) => {
    setEntities(newEntities);
    await saveState(activeId, { corpusText, entities: newEntities, p0, methods, methodNotes, methodSummaries, passSummaries, passSummaryStale, sources });
  }, [activeId, corpusText, p0, methods, methodNotes, methodSummaries, passSummaries, passSummaryStale, sources, saveState]);

  // ── Validate & clean competitor list via LLM + web search ────────────────────
  const validateCompetitors = useCallback(async () => {
    if (!p0 || competitorValidating) return;
    setCompetitorValidating(true);
    setCompetitorValidationNote(null);
    try {
      const ventureCtx = { venture_name: p0.venture_name, venture_summary: p0.venture_summary, stage: p0.stage, classification: p0.classification };
      const currentList = entities?.competitors || [];
      const result = await pipeline("validate_competitors", { currentList, ventureCtx, corpusText });
      // result = { validated: [], added: [], removed: [], notes: "" }
      const cleanList = [...(result.validated || []), ...(result.added || [])];
      const newEntities = { ...entities, competitors: cleanList };
      setEntities(newEntities);
      await saveState(activeId, { corpusText, entities: newEntities, p0, methods, methodNotes, methodSummaries, passSummaries, passSummaryStale, sources });
      // Build a short summary note for the user
      const removedCount = (result.removed || []).length;
      const addedCount = (result.added || []).length;
      const note = result.notes || `Removed ${removedCount} non-competitor entries, added ${addedCount} discovered competitors.`;
      setCompetitorValidationNote(note);
      setTimeout(() => setCompetitorValidationNote(null), 8000);
    } catch (e) {
      setCompetitorValidationNote(`Validation failed: ${e.message}`);
      setTimeout(() => setCompetitorValidationNote(null), 5000);
    }
    setCompetitorValidating(false);
  }, [p0, entities, corpusText, competitorValidating, activeId, methods, methodNotes, methodSummaries, passSummaries, passSummaryStale, sources, saveState]);

  const addDocument = useCallback(async (f) => {
    if (!f || !activeId) return;
    setAddingDoc(true);
    setError(null);
    try {
      const reader = new FileReader();
      const { base64, mimeType } = await new Promise((resolve, reject) => {
        reader.onload = () => {
          resolve({ base64: reader.result.split(",")[1], mimeType: typeOf(f.name)?.mime });
        };
        reader.onerror = reject;
        reader.readAsDataURL(f);
      });
      const result = await pipeline("ingest_doc", { fileBase64: base64, fileType: mimeType, fileName: f.name, projectId: activeId });
      if (result.truncated) setError(`Warning: ${f.name} is very long and its text was cut at the model's output limit.`);
      const newSource = { id: crypto.randomUUID(), type: "document", name: f.name, rawText: result.text, addedAt: new Date().toISOString() };
      const newSources = [...sources, newSource];
      const newCorpus = corpusText + "\n\n---\n\n" + result.text;
      setSources(newSources);
      if (result.chunks) setChunkStats(result.chunks);
      setCorpusText(newCorpus);
      await saveState(activeId, { corpusText: newCorpus, entities, p0, methods, methodNotes, sources: newSources });
    } catch (err) {
      setError(`Failed to add document: ${err.message}`);
    }
    setAddingDoc(false);
  }, [activeId, sources, corpusText, entities, p0, methods, methodNotes, saveState]);

  // ── Reset pipeline state ────────────────────────────────────────────────────────
  const resetPipeline = useCallback(() => {
    setCorpusText(""); setEntities(null); setP0(null); setMethods([]);
    setMethodStatus({}); setEvidenceBundles({}); setMethodResults({});
    setMethodNotes({}); setMethodSummaries({}); setPassSummaries({}); setPassSummaryStale({});
    setSources([]); setChunkStats({ total: 0, web: 0, document: 0 }); runVersions.current = {}; setResultTimes({}); setFinModel(null); setSnapshots([]); setCommentCounts({}); setUsage({ calls: 0, tokens: 0 }); setProjectMeta({ is_owner: true, shared: false }); setFounderAnswers({}); setFocusMethodId(null); setActivePass("p0");
    setDocState({ chapters: {}, execSummary: null, generating: false, progress: "" });
    setError(null);
  }, []);

  // ── Load a saved project ────────────────────────────────────────────────────────
  const handleSelectProject = useCallback(async (id) => {
    const res = await fetch(`/api/projects/${id}`);
    if (!res.ok) { setError(`Failed to load project (${res.status})`); return; }
    const project = await res.json();
    setProjectMeta({ is_owner: project.is_owner !== false, shared: !!project.shared });
    activeIdRef.current = id; // synchronous: the first runs sync must not be dropped as "wrong project"
    setActiveId(id);
    const s = project.state || {};
    setCorpusText(s.corpusText || "");
    setEntities(s.entities || null);
    setP0(s.p0 || null);
    setMethods(s.methods || []);
    // Method statuses, evidence and results are owned by the server (they keep
    // updating while no tab is open) — load them from the runs API.
    setMethodStatus({}); setEvidenceBundles({}); setMethodResults({});
    runVersions.current = {};
    setMethodNotes(s.methodNotes || {});
    setMethodSummaries(s.methodSummaries || {});
    setPassSummaries(s.passSummaries || {});
    setPassSummaryStale(s.passSummaryStale || {});
    setFinModel(s.finModel || null);
    setSources(s.sources || []);
    setChunkStats(project.chunkStats || { total: 0, web: 0, document: 0 });
    setEntryMode(project.entry_mode || "document");
    setScreen(s.p0 ? "pipeline" : "setup");
    setFounderAnswers(s.founderAnswers || {});
    setActivePass("overview"); // existing deals open on their overview
    setDocState({
      chapters: s.docChapters || {},
      execSummary: s.docExecSummary || null,
      generating: false,
      progress: "",
    });
    syncRunsRef.current?.(id, { full: true });
    loadReportRef.current?.(id);
    refreshCommentsRef.current?.(id);
  }, []);

  useEffect(() => {
    const id = deepLinkRef.current;
    if (!id) return;
    deepLinkRef.current = null;
    handleSelectProject(id);
    window.history.replaceState(null, "", "/");
  }, [handleSelectProject]);

  // ── New project ────────────────────────────────────────────────────────────────
  const handleNewProject = useCallback(() => {
    activeIdRef.current = null;
    setActiveId(null);
    resetPipeline();
    setFiles([]);
    setConceptCard({ name: "", description: "", category: "", targetMarket: "", knownCompetitors: [] });
    setUserCtx(""); setPriorityFocus([]); setPipelineMode("full");
    setScreen("setup");
  }, [resetPipeline]);

  // ── Delete project ─────────────────────────────────────────────────────────────
  const handleDeleteProject = useCallback(async (id) => {
    await fetch(`/api/projects/${id}`, { method: "DELETE" });
    if (activeId === id) handleNewProject();
    setProjects(prev => prev.filter(p => p.id !== id));
  }, [activeId, handleNewProject]);

  // ── START ANALYSIS ──────────────────────────────────────────────────────────────
  const startAnalysis = useCallback(async () => {
    setLoading(true); setError(null); resetPipeline();
    const name = entryMode === "document" ? (files[0]?.file?.name?.replace(/\.[^.]+$/, "") || "Untitled") : (conceptCard.name || "Untitled");

    try {
      // Create project in DB
      const pRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, entryMode }),
      });
      const project = await pRes.json();
      activeIdRef.current = project.id;
      setActiveId(project.id);
      setProjects(prev => [project, ...prev]);

      let docText = "";
      let ents = {};

      if (entryMode === "document") {
        // Step 1: ingest all files — primary first, then additional
        setLoadingMsg(`Reading ${files.length > 1 ? `${files.length} documents` : "document"}…`);
        const ingestResults = await Promise.all(
          files.map(f => pipeline("ingest", { fileBase64: f.base64, fileType: f.mimeType, fileName: f.file.name, projectId: project.id }))
        );
        // The server indexed every page (chunks + embeddings stay in its database)
        setChunkStats(ingestResults.map(r => r.chunks).filter(Boolean).sort((a, b) => b.total - a.total)[0] || { total: 0, web: 0, document: 0 });
        const cut = ingestResults.map((r, i) => r.truncated ? files[i].file.name : null).filter(Boolean);
        if (cut.length) setError(`Warning: ${cut.join(", ")} is very long and its text was cut at the model's output limit. Later pages may be missing from the analysis.`);
        // Concatenate all text, separated by a clear divider
        docText = ingestResults.map((r, i) => (
          files.length > 1 ? `=== ${files[i].file.name} ===\n${r.text}` : r.text
        )).join("\n\n");
        setCorpusText(docText);

        // Step 2: entity scan
        setLoadingMsg("Scanning entities…");
        ents = await pipeline("entities", { corpusText: docText });
        setEntities(ents);

        // Add all files as sources
        const initialSources = files.map(f => ({ id: crypto.randomUUID(), type: "document", name: f.file.name, rawText: "", entities: ents, addedAt: new Date().toISOString() }));
        setSources(initialSources);

        // Step 3: P0 classification — uses primary (first) file for vision + full corpus text
        setLoadingMsg("Classifying venture…");
        const p0Result = await pipeline("p0_doc", { fileBase64: files[0].base64, fileType: files[0].mimeType, fileName: files[0].file.name, corpusText: docText, userContext: userCtx, entities: ents, priorityFocus });
        setP0(p0Result);
        const built = buildMethods(p0Result, priorityFocus, pipelineMode);
        setMethods(built);

        const projectName = p0Result.venture_name || name;
        await saveState(project.id, { corpusText: docText, entities: ents, p0: p0Result, methods: built, sources: initialSources });
        await fetch(`/api/projects/${project.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "running", name: projectName }) });
        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, name: projectName } : p));

      } else {
        // Concept-first: entity from card
        ents = { startup_name: conceptCard.name, competitors: conceptCard.knownCompetitors || [], partners: [], markets: conceptCard.targetMarket ? [conceptCard.targetMarket] : [], people: [], products: [], regulatory_bodies: [] };
        setEntities(ents);
        docText = `Venture: ${conceptCard.name}\nDescription: ${conceptCard.description}\nCategory: ${conceptCard.category}\nTarget market: ${conceptCard.targetMarket}`;
        setCorpusText(docText);
        setSources([{ id: crypto.randomUUID(), type: "note", name: `Concept: ${conceptCard.name}`, rawText: docText, entities: ents, addedAt: new Date().toISOString() }]);

        setLoadingMsg("Researching concept via web…");
        const p0Result = await pipeline("p0_concept", { conceptCard, priorityFocus });
        setP0(p0Result);
        const built = buildMethods(p0Result, priorityFocus, pipelineMode);
        setMethods(built);

        const projectName = p0Result.venture_name || name;
        await saveState(project.id, { corpusText: docText, entities: ents, p0: p0Result, methods: built });
        await fetch(`/api/projects/${project.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "running", name: projectName }) });
        setProjects(prev => prev.map(p => p.id === project.id ? { ...p, name: projectName } : p));
      }

      setScreen("pipeline");
      setActivePass("p0");
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [entryMode, files, conceptCard, userCtx, priorityFocus, pipelineMode, buildMethods, resetPipeline, saveState]);

  // ── SERVER-SIDE RUNS ────────────────────────────────────────────────────────────
  // Extract / execute / revise run on the server as durable jobs: the browser
  // queues them and polls. Closing the tab does not stop a run, independent
  // methods run in parallel, and evidence, results and embeddings never travel
  // through the browser.
  useEffect(() => { activeIdRef.current = activeId; pipelineProjectId = activeId; }, [activeId]);
  useEffect(() => { entitiesRef.current = entities; }, [entities]);

  // Fold competitor names the server discovered into the entity list (idempotent)
  const mergeCompetitors = useCallback((names) => {
    if (!names?.length) return;
    const cur = entitiesRef.current || {};
    const existing = cur.competitors || [];
    const fresh = [...new Set(names)].filter(n => !existing.includes(n));
    if (!fresh.length) return;
    const merged = { ...cur, competitors: [...existing, ...fresh] };
    entitiesRef.current = merged;
    setEntities(merged);
    if (activeIdRef.current) saveState(activeIdRef.current, { entities: merged });
  }, [saveState]);

  const syncRuns = useCallback(async (projectId, { full = false } = {}) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/runs${full ? "?full=1" : ""}`);
      if (!res.ok || projectId !== activeIdRef.current) return;
      const data = await res.json();
      if (data.chunks) setChunkStats(data.chunks);
      if (data.usage) setUsage(data.usage);

      if (full) {
        const st = {}, ev = {}, rs = {}, times = {};
        const started = {};
        for (const [mid, r] of Object.entries(data.runs)) {
          st[mid] = r.status;
          if (r.status === "extracting" || r.status === "executing") started[mid] = r.updated_at;
          if (r.result_updated_at) times[mid] = r.result_updated_at;
          if (r.evidence) ev[mid] = r.evidence;
          if (r.result != null) rs[mid] = r.result;
          runVersions.current[mid] = r.version;
        }
        setMethodStatus(st); setEvidenceBundles(ev); setMethodResults(rs); setResultTimes(times); setRunStartedAt(started);
        return;
      }

      const settled = [];
      setRunStartedAt(prev => {
        const n = { ...prev };
        for (const [mid, r] of Object.entries(data.runs)) {
          if (r.status === "extracting" || r.status === "executing") { if (!n[mid]) n[mid] = r.updated_at; } else delete n[mid];
        }
        return n;
      });
      setResultTimes(prev => {
        const next = { ...prev };
        for (const [mid, r] of Object.entries(data.runs)) if (r.result_updated_at) next[mid] = r.result_updated_at;
        return next;
      });
      setMethodStatus(prev => {
        const next = { ...prev };
        for (const [mid, r] of Object.entries(data.runs)) {
          next[mid] = r.status;
          if (runVersions.current[mid] !== r.version) {
            runVersions.current[mid] = r.version;
            if (r.status !== "extracting" && r.status !== "executing") settled.push([mid, r]);
          }
        }
        return next;
      });
      // Pull the full record only for runs that just finished
      await Promise.all(settled.map(async ([mid, r]) => {
        if (r.status === "error") { setError(`${METHODOLOGY_REGISTRY[mid]?.name || mid} failed: ${r.error || "unknown error"}`); return; }
        const detail = await fetch(`/api/projects/${projectId}/runs?method=${mid}`).then(x => x.json());
        if (projectId !== activeIdRef.current || !detail.run) return;
        if (detail.run.evidence) setEvidenceBundles(p => ({ ...p, [mid]: detail.run.evidence }));
        if (detail.run.result != null) setMethodResults(p => ({ ...p, [mid]: detail.run.result }));
        if (detail.webSources?.length) {
          setSources(p => { const have = new Set(p.map(x => x.id)); return [...p, ...detail.webSources.filter(w => !have.has(w.id))]; });
        }
        if (detail.chunks) setChunkStats(detail.chunks);
        mergeCompetitors(detail.run.new_competitors);
      }));
    } catch (e) { console.warn("Run sync failed:", e.message); }
  }, [mergeCompetitors]);
  useEffect(() => { syncRunsRef.current = syncRuns; }, [syncRuns]);

  // Poll only while something is in flight
  useEffect(() => {
    if (!activeId) return;
    const inflight = Object.values(methodStatus).some(st => st === "extracting" || st === "executing");
    if (!inflight) return;
    const t = setInterval(() => syncRuns(activeId), 2500);
    return () => clearInterval(t);
  }, [activeId, methodStatus, syncRuns]);

  const queueRun = useCallback(async (methodId, action, notes = "") => {
    if (!activeId) return;
    setError(null);
    setMethodStatus(p => ({ ...p, [methodId]: action === "extract" || action === "run" ? "extracting" : "executing" }));
    setRunStartedAt(p => ({ ...p, [methodId]: Date.now() }));
    try {
      const res = await fetch(`/api/projects/${activeId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, methodId, notes }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      runVersions.current[methodId] = data.run?.version;
    } catch (err) {
      setError(`${action} failed (${methodId}): ${err.message}`);
      syncRuns(activeId, { full: true }); // restore the true server-side status
    }
  }, [activeId, syncRuns]);

  const runExtract = useCallback((methodId) => queueRun(methodId, "extract"), [queueRun]);
  const runExecute = useCallback((methodId) => {
    if (!evidenceBundles[methodId]) {
      setError(`Evidence bundle missing for ${methodId} — please re-extract`);
      return;
    }
    return queueRun(methodId, "execute", methodNotes[methodId] || "");
  }, [evidenceBundles, methodNotes, queueRun]);

  // ── APPROVE — just marks done and invalidates pass summary (no auto-generation)
  const approveMethod = useCallback(async (methodId) => {
    try {
      const res = await fetch(`/api/projects/${activeId}/runs`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "approve", methodId }),
      });
      if (!res.ok) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    } catch (err) {
      setError(`Approve failed (${methodId}): ${err.message}`);
      return;
    }
    const newStatus = { ...methodStatus, [methodId]: "done" };
    setMethodStatus(newStatus);

    // Mark pass summary stale so user can regenerate manually
    const method = methods.find(m => m.id === methodId);
    const passId = method?.pass;
    const newPassSummaryStale = passId ? { ...passSummaryStale, [passId]: true } : passSummaryStale;
    if (passId) setPassSummaryStale(newPassSummaryStale);

    await saveState(activeId, { corpusText, entities, p0, methods, methodNotes, methodSummaries, passSummaries, passSummaryStale: newPassSummaryStale, sources });

    // Mark project done if all methods complete
    const allDone = methods.filter(m => m.decision !== "skip").every(m => newStatus[m.id] === "done");
    if (allDone && activeId) {
      await fetch(`/api/projects/${activeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status: "done" }) });
      fetch("/api/projects").then(r => r.json()).then(setProjects);
    }
  }, [methodStatus, passSummaryStale, activeId, corpusText, entities, p0, methods, methodNotes, methodSummaries, passSummaries, sources, saveState]);

  // ── RE-RUN (full extract + execute, picks up new chunks) ─────────────────────
  const runRerun = useCallback(async (methodId) => {
    // Invalidate pass summary for this method's pass
    const method = methods.find(m => m.id === methodId);
    if (method?.pass) {
      const newStale = { ...passSummaryStale, [method.pass]: true };
      setPassSummaryStale(newStale);
    }
    // Clear existing summary for this method
    const newMethodSummaries = { ...methodSummaries };
    delete newMethodSummaries[methodId];
    setMethodSummaries(newMethodSummaries);
    // Run full extract then execute
    await runExtract(methodId);
    // runExecute will be triggered by the user after reviewing evidence
  }, [methods, passSummaryStale, methodSummaries, runExtract]);

  // ── REVISE (prior draft + notes + newly added evidence; runs on the server) ───
  const runRevise = useCallback(async (methodId) => {
    if (!evidenceBundles[methodId] || !methodResults[methodId]) return;
    // Invalidate this method's summary and its pass summary — they describe the old draft
    const method = methods.find(m => m.id === methodId);
    if (method?.pass) setPassSummaryStale(st => ({ ...st, [method.pass]: true }));
    setMethodSummaries(prev => { const n = { ...prev }; delete n[methodId]; return n; });
    await queueRun(methodId, "revise", methodNotes[methodId] || "");
  }, [evidenceBundles, methodResults, methods, methodNotes, queueRun]);

  // ── FINANCIAL MODEL (AI proposes inputs; maths is deterministic) ─────────────────
  const updateFinModel = useCallback((next) => {
    setFinModel(next);
    clearTimeout(finSaveTimer.current);
    finSaveTimer.current = setTimeout(() => { if (activeIdRef.current) saveState(activeIdRef.current, { finModel: next }); }, 800);
  }, [saveState]);

  const proposeFinAssumptions = useCallback(async () => {
    setFinProposing(true); setError(null);
    try {
      const ventureCtx = p0 ? { venture_name: p0.venture_name, venture_summary: p0.venture_summary, stage: p0.stage, classification: p0.classification } : null;
      const res = await pipeline("fin_assumptions", { methodResults, ventureCtx, corpusText });
      // Keep the user's own edits; refresh everything else
      const prev = finModel?.assumptions || {};
      const merged = Object.fromEntries(Object.entries(res.assumptions).map(([id, a]) => [id, prev[id]?.edited ? prev[id] : a]));
      updateFinModel({ ...(finModel || {}), currency: finModel?.currency || res.currency, assumptions: merged });
    } catch (err) { setError(`Could not propose assumptions: ${err.message}`); }
    setFinProposing(false);
  }, [methodResults, p0, corpusText, finModel, updateFinModel]);

  // ── REGENERATE PASS SUMMARY ───────────────────────────────────────────────────
  const regeneratePassSummary = useCallback(async (passId) => {
    const ventureCtx = p0 ? { venture_name: p0.venture_name, venture_summary: p0.venture_summary, stage: p0.stage, classification: p0.classification } : null;
    const passDef = PASS_DEFS.find(p => p.id === passId);
    const passMethods = methods.filter(m => m.pass === passId && m.decision !== "skip" && methodResults[m.id]);
    if (!passMethods.length) return;
    const passResults = Object.fromEntries(passMethods.map(m => [m.id, methodResults[m.id]]));
    try {
      const ps = await pipeline("pass_summarise", { passId, passTitle: passDef?.title || passId, methodResults: passResults, ventureCtx });
      const newPassSummaries = { ...passSummaries, [passId]: ps };
      const newPassSummaryStale = { ...passSummaryStale, [passId]: false };
      setPassSummaries(newPassSummaries);
      setPassSummaryStale(newPassSummaryStale);
      await saveState(activeId, { corpusText, entities, p0, methods, methodNotes, methodSummaries, passSummaries: newPassSummaries, passSummaryStale: newPassSummaryStale, sources });
    } catch (e) { console.warn("Pass summary regen failed:", e.message); }
  }, [passSummaries, passSummaryStale, p0, methods, methodResults, activeId, corpusText, entities, methodNotes, methodSummaries, sources, saveState]);

  const toggleDecision = useCallback((methodId) => {
    setMethods(prev => prev.map(m => m.id !== methodId ? m : { ...m, decision: { run: "lite", lite: "skip", skip: "run" }[m.decision] }));
  }, []);

  // ── TEAM: comments + sharing ───────────────────────────────────────────────────
  const refreshComments = useCallback(async (projectId) => {
    try {
      const res = await fetch(`/api/projects/${projectId}/comments`);
      if (res.ok && projectId === activeIdRef.current) setCommentCounts((await res.json()).counts || {});
    } catch { /* counts are cosmetic */ }
  }, []);
  useEffect(() => { refreshCommentsRef.current = refreshComments; }, [refreshComments]);
  // Teammates comment while you're away: refresh counts when the tab regains focus
  useEffect(() => {
    const onFocus = () => activeIdRef.current && refreshComments(activeIdRef.current);
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshComments]);

  const [reindexing, setReindexing] = useState(false);
  const reindexProject = useCallback(async () => {
    setReindexing(true); setError(null);
    try {
      const res = await fetch(`/api/projects/${activeId}/reindex`, { method: "POST" });
      if (!res.ok && res.status !== 409) throw new Error((await res.json()).error || `HTTP ${res.status}`);
      // poll the chunk stats until nothing is stale any more
      for (let i = 0; i < 600; i++) {
        await new Promise(r => setTimeout(r, 3000));
        const d = await fetch(`/api/projects/${activeId}/runs`).then(r => r.json());
        if (d.chunks) setChunkStats(d.chunks);
        if (!d.chunks || d.chunks.stale === 0) break;
      }
    } catch (err) { setError(`Re-index failed: ${err.message}`); }
    setReindexing(false);
  }, [activeId]);

  const toggleShare = useCallback(async () => {
    const next = !projectMeta.shared;
    const res = await fetch(`/api/projects/${activeId}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ shared: next }) });
    if (!res.ok) { setError((await res.json()).error || "Could not change sharing"); return; }
    setProjectMeta(m => ({ ...m, shared: next }));
    fetch("/api/projects").then(r => r.json()).then(setProjects).catch(console.error);
  }, [activeId, projectMeta.shared]);

  // ── REPORT (server-side job: survives closing the tab) ─────────────────────────
  const [snapshots, setSnapshots] = useState([]);

  const loadReport = useCallback(async (projectId) => {
    const res = await fetch(`/api/projects/${projectId}/report?full=1`);
    if (!res.ok || projectId !== activeIdRef.current) return;
    const r = await res.json();
    setSnapshots(r.snapshots || []);
    setDocState({ chapters: r.chapters || {}, execSummary: r.execSummary || null, generating: r.status === "running", progress: r.progress || "" });
    if (r.status === "error" && r.error) setError(`Document generation failed: ${r.error}`);
  }, []);

  useEffect(() => { loadReportRef.current = loadReport; }, [loadReport]);

  const generateDocument = useCallback(async () => {
    setError(null);
    setDocState(st => ({ ...st, generating: true, progress: "Starting…" }));
    try {
      // The server builds the report from stored state, so flush anything only held in the browser first
      await saveState(activeId, { methods, methodNotes, methodSummaries, passSummaries, passSummaryStale, finModel });
      const res = await fetch(`/api/projects/${activeId}/report`, { method: "POST" });
      if (!res.ok && res.status !== 409) throw new Error((await res.json()).error || `HTTP ${res.status}`);
    } catch (err) {
      setError(`Document generation failed: ${err.message}`);
      setDocState(st => ({ ...st, generating: false, progress: "" }));
    }
  }, [activeId, methods, methodNotes, methodSummaries, passSummaries, passSummaryStale, finModel, saveState]);

  // While a report is being written, poll its progress; load it when finished
  useEffect(() => {
    if (!activeId || !docState.generating) return;
    const t = setInterval(async () => {
      try {
        const res = await fetch(`/api/projects/${activeId}/report`);
        if (!res.ok || activeId !== activeIdRef.current) return;
        const r = await res.json();
        if (r.status === "running") setDocState(st => ({ ...st, progress: r.progress || st.progress }));
        else loadReport(activeId);
      } catch { /* transient — try again on the next tick */ }
    }, 2500);
    return () => clearInterval(t);
  }, [activeId, docState.generating, loadReport]);

  const downloadHTML = useCallback(() => {
    const { chapters, execSummary } = docState;
    if (!execSummary) return;
    const passChapters = PASS_DEFS.slice(1)
      .filter(pd => chapters[pd.id])
      .map(pd => `
<section class="chapter">
  <div class="chapter-header"><span class="chapter-num">P${pd.num}</span><h2>${pd.title}</h2></div>
  <div class="chapter-body">${mdToHtml(chapters[pd.id])}</div>
</section>`)
      .join('\n');
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Venture Analysis — ${p0?.venture_name || 'Report'}</title>
<style>
  *{box-sizing:border-box}
  body{font-family:Georgia,serif;max-width:900px;margin:0 auto;padding:56px 48px;color:#111;line-height:1.75;font-size:15px}
  h1{font-size:2.2em;margin:0 0 6px;letter-spacing:-.02em}
  h2{font-size:1.2em;margin:40px 0 10px;border-bottom:1px solid #e0e0e0;padding-bottom:6px;color:#111;font-weight:700}
  h3{font-size:.95em;font-weight:700;margin:24px 0 6px;color:#222}
  h4{font-size:.88em;font-weight:700;margin:16px 0 4px;color:#444;text-transform:uppercase;letter-spacing:.05em}
  p{margin:8px 0 12px;color:#333}
  ul,ol{padding-left:1.5em;margin:8px 0 12px}
  li{margin-bottom:5px;color:#333}
  code{background:#f4f4f2;padding:2px 5px;border-radius:3px;font-size:.88em;font-family:monospace}
  hr{border:none;border-top:1px solid #e8e8e8;margin:24px 0}
  strong{color:#111}
  .meta{color:#777;font-size:.83em;margin:0 0 48px;letter-spacing:.01em}
  /* Executive block */
  .exec{background:#f9f8f5;border-left:4px solid #111;padding:28px 32px;margin:36px 0;border-radius:0 10px 10px 0}
  .exec-top{display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px}
  .verdict{display:inline-block;padding:5px 13px;border-radius:20px;font-weight:700;font-size:.8em;background:#111;color:#fff;letter-spacing:.04em}
  .score{font-size:2.4em;font-weight:800;color:#111;line-height:1}
  .exec h2{margin-top:8px;border:none;padding:0;font-size:1.1em}
  .thesis{font-style:italic;color:#555;border-left:3px solid #ccc;padding-left:14px;margin:12px 0 16px;font-size:.94em}
  /* Findings / Risks */
  .two-col{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin:32px 0}
  .findings-box,.risks-box{padding:20px 24px;border-radius:10px}
  .findings-box{background:#f0faf4;border:1px solid #b8e8c8}
  .risks-box{background:#fdf4f4;border:1px solid #f0c0c0}
  .findings-box h3,.risks-box h3{margin-top:0;font-size:.8em;text-transform:uppercase;letter-spacing:.06em}
  .findings-box h3{color:#1a7a40}
  .risks-box h3{color:#b03030}
  .findings-box li{color:#1a5c30;font-size:.9em}
  .risks-box li{color:#8c2424;font-size:.9em}
  .recommendation{background:#111;color:#fff;padding:24px 28px;border-radius:10px;margin:32px 0}
  .recommendation h2{color:#ccc;border:none;font-size:.8em;text-transform:uppercase;letter-spacing:.06em;margin:0 0 8px}
  .recommendation p{color:#eee;font-size:.95em;margin:0}
  .recommendation em{color:#aaa;font-size:.85em;display:block;margin-bottom:8px}
  table{border-collapse:collapse;width:100%;font-size:.85em;margin:12px 0 28px}
  th,td{border:1px solid #e3e3e3;padding:7px 10px;text-align:left;vertical-align:top}
  th{background:#f5f5f2;font-size:.8em;text-transform:uppercase;letter-spacing:.04em}
  /* Chapters */
  .chapter{margin:56px 0;padding-top:4px}
  .chapter-header{display:flex;align-items:baseline;gap:12px;margin-bottom:16px;border-bottom:2px solid #111;padding-bottom:10px}
  .chapter-num{font-size:.75em;font-weight:800;color:#fff;background:#111;padding:3px 9px;border-radius:4px;letter-spacing:.04em;flex-shrink:0}
  .chapter-header h2{margin:0;border:none;padding:0;font-size:1.25em;font-weight:700}
  .chapter-body{color:#333;font-size:.94em;line-height:1.78}
  .chapter-body h2{font-size:1.05em;margin:28px 0 8px;border-bottom:1px solid #ececec;padding-bottom:5px;color:#111}
  .chapter-body h3{font-size:.9em;font-weight:700;margin:20px 0 5px;color:#222}
  .chapter-body h4{font-size:.8em;font-weight:700;text-transform:uppercase;letter-spacing:.05em;color:#555;margin:14px 0 4px}
  .chapter-body p{margin:6px 0 10px}
  .chapter-body ul,.chapter-body ol{margin:6px 0 10px}
  .chapter-body hr{margin:16px 0}
  @media print{
    body{padding:24px 32px;font-size:13px}
    .chapter{page-break-before:always}
    .two-col{grid-template-columns:1fr 1fr}
  }
</style>
</head>
<body>
<h1>${esc(p0?.venture_name || 'Venture Analysis')}</h1>
<p class="meta">${new Date().toLocaleDateString('en-GB', {day:'numeric',month:'long',year:'numeric'})} &nbsp;·&nbsp; ${esc(p0?.classification?.business_model?.toUpperCase() || '')} &nbsp;·&nbsp; ${esc(p0?.stage || '')} &nbsp;·&nbsp; ${Object.keys(chapters).length} passes analysed</p>

<div class="exec">
  <div class="exec-top">
    <div>
      <div class="verdict">${esc(execSummary.verdict || '')}</div>
      <h2>Executive Summary</h2>
    </div>
    <div class="score">${esc(execSummary.score || '')}</div>
  </div>
  ${execSummary.investment_thesis ? `<p class="thesis">${esc(execSummary.investment_thesis)}</p>` : ''}
  ${execSummary.executive_summary ? `<div>${mdToHtml(execSummary.executive_summary)}</div>` : ''}
</div>

${(execSummary.strongest_findings?.length || execSummary.key_risks?.length) ? `
<div class="two-col">
  ${execSummary.strongest_findings?.length ? `<div class="findings-box"><h3>Key Findings</h3><ul>${execSummary.strongest_findings.map(f=>`<li>${esc(f)}</li>`).join('')}</ul></div>` : '<div></div>'}
  ${execSummary.key_risks?.length ? `<div class="risks-box"><h3>Key Risks</h3><ul>${execSummary.key_risks.map(r=>`<li>${esc(r)}</li>`).join('')}</ul></div>` : '<div></div>'}
</div>` : ''}

${execSummary.recommendation ? `<div class="recommendation"><h2>Recommendation</h2>${execSummary.score_rationale ? `<em>${esc(execSummary.score_rationale)}</em>` : ''}<p>${esc(execSummary.recommendation)}</p></div>` : ''}

${execSummary.score_breakdown?.length ? `<h2>Score breakdown</h2><table><tr><th>Dimension</th><th>Weight</th><th>Score</th><th>Confidence</th><th>Basis</th></tr>${execSummary.score_breakdown.map(d=>`<tr><td>${esc(d.label)}</td><td>${Math.round(d.weight*100)}%</td><td>${d.score ?? 'n/a'}</td><td>${esc(d.confidence || '')}</td><td>${esc((d.evidence||[]).join('; '))}</td></tr>`).join('')}</table>` : ''}

${execSummary.tensions?.length ? `<h2>Tensions across the analysis</h2><ul>${execSummary.tensions.map(t=>`<li>${esc(t)}</li>`).join('')}</ul>` : ''}

${execSummary.founder_questions?.length ? `<h2>Questions for the founders</h2><ol>${execSummary.founder_questions.map(q=>`<li>${esc(q)}</li>`).join('')}</ol>` : ''}

${passChapters}
</body>
</html>`;
    const blob = new Blob([html], { type: 'text/html' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(p0?.venture_name || 'analysis').replace(/\s+/g,'-')}-report.html`;
    a.click();
  }, [docState, p0]);

  // ── OVERVIEW: progress, the next best action, run-all ──────────────────────────
  const progress = useMemo(() => pipelineProgress(methods, methodStatus), [methods, methodStatus]);
  const reportStale = useMemo(() => {
    const at = snapshots[0]?.created_at;
    return !!at && Object.values(resultTimes).some(t => t > at);
  }, [snapshots, resultTimes]);
  const next = useMemo(() => nextStep({
    methods, status: methodStatus, hasP0: !!p0,
    report: { exists: !!docState.execSummary, generating: docState.generating, stale: reportStale },
  }), [methods, methodStatus, p0, docState.execSummary, docState.generating, reportStale]);

  const runAllRemaining = useCallback(async () => {
    const todo = methods.filter(m => m.decision !== "skip" && !["done", "review", "extracting", "executing"].includes(methodStatus[m.id]));
    for (const m of todo) await queueRun(m.id, methodStatus[m.id] === "extracted" ? "execute" : "run", methodNotes[m.id] || "");
    if (todo.length) toast(`Queued ${todo.length} ${todo.length === 1 ? "analysis" : "analyses"} — they keep running if you close this tab.`, "success");
  }, [methods, methodStatus, methodNotes, queueRun, toast]);

  const onNextStep = useCallback(() => {
    switch (next.kind) {
      case "runAll": return runAllRemaining();
      case "fix": case "review": setActivePass(next.pass); setFocusMethodId(next.methodId); return;
      case "report": setScreen("output"); return generateDocument();
      case "share": return setScreen("output");
      case "setup": return setScreen("setup");
      default: return;
    }
  }, [next, runAllRemaining, generateDocument]);

  // Founder Q&A tracked against the report's questions (saved with the deal, debounced)
  const answersTimer = useRef(null);
  const updateFounderAnswer = useCallback((question, patch) => {
    setFounderAnswers(prev => {
      const next = { ...prev, [question]: { ...prev[question], ...patch } };
      clearTimeout(answersTimer.current);
      answersTimer.current = setTimeout(() => activeIdRef.current && saveState(activeIdRef.current, { founderAnswers: next }), 700);
      return next;
    });
  }, [saveState]);

  const cancelRun = useCallback(async (methodId) => {
    const res = await fetch(`/api/projects/${activeId}/runs`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "cancel", methodId }) });
    const data = await res.json();
    if (!res.ok) { toast(data.error || "Could not cancel", "error"); return; }
    toast("Cancelled.", "success");
    syncRuns(activeId, { full: true });
  }, [activeId, toast, syncRuns]);

  // Every "this contradicts the initial scoping" flag raised by a method or pass summary
  const revisionTriggers = useMemo(() => {
    const out = [];
    for (const m of methods) {
      if (m.decision === "skip") continue;
      for (const t of methodSummaries[m.id]?.revision_triggers || []) out.push({ pass: m.pass, source: METHODOLOGY_REGISTRY[m.id]?.name || m.id, text: t });
    }
    for (const [pid, ps] of Object.entries(passSummaries)) {
      const pd = PASS_DEFS.find(p => p.id === pid);
      for (const t of ps?.revision_triggers || []) out.push({ pass: pid, source: `P${pd?.num ?? ""} ${pd?.title ?? pid} (pass summary)`, text: t });
    }
    return out;
  }, [methods, methodSummaries, passSummaries]);

  const staleMap = useMemo(
    () => staleDependents({ methods, resultTimes, dependencies: DEPENDENCIES }),
    [methods, resultTimes]
  );

  const passGroups = useMemo(() => PASS_DEFS.map(pd => ({
    ...pd,
    methods: methods.filter(m => m.pass === pd.id),
    doneCount: methods.filter(m => m.pass === pd.id && methodStatus[m.id] === "done").length,
    totalActive: methods.filter(m => m.pass === pd.id && m.decision !== "skip").length,
  })), [methods, methodStatus]);

  const canStart = entryMode === "document" ? files.length > 0 : (!!conceptCard.name && !!conceptCard.description);

  // ═══════════════════════════════════════════════════════════════════════════
  // RENDER
  // ═══════════════════════════════════════════════════════════════════════════
  return (
    <div className="flex h-screen overflow-hidden bg-gray-50">
      <Sidebar projects={projects} activeId={activeId} onSelect={handleSelectProject} onNew={handleNewProject} onDelete={handleDeleteProject} onSettings={() => setSettingsOpen(true)} />

      {/* Main area */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* ── SETUP SCREEN ── */}
        {screen === "setup" && (
          <div className="flex-1 overflow-y-auto flex items-center justify-center p-6" style={{ background: "linear-gradient(160deg,#f5f4f0 0%,#edf0f8 100%)" }}>
            <div className="w-full max-w-lg space-y-3">
              <div className="text-center mb-6">
                <p className="text-sm text-gray-500">Extract · Execute · Synthesize</p>
              </div>

              {/* Entry mode */}
              <div className="bg-white rounded-2xl border border-gray-200 p-5 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Start from</label>
                  <div className="flex gap-2">
                    {[["document","Document",FileText],["concept","Concept",Lightbulb]].map(([v,l,Icon]) => (
                      <button key={v} onClick={() => setEntryMode(v)}
                        className={`flex-1 py-2.5 rounded-xl border text-sm flex items-center justify-center gap-2 transition-all ${entryMode === v ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
                        <Icon size={14} /> {l}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Document mode */}
                {entryMode === "document" && (
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Documents</label>
                    {/* Drop zone */}
                    <div
                      onClick={() => fileRef.current?.click()}
                      onDragOver={e => { e.preventDefault(); setDropDragging(true); }}
                      onDragEnter={e => { e.preventDefault(); setDropDragging(true); }}
                      onDragLeave={e => { e.preventDefault(); setDropDragging(false); }}
                      onDrop={e => { e.preventDefault(); setDropDragging(false); readFiles(e.dataTransfer.files); }}
                      className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition-all ${dropDragging ? "border-blue-400 bg-blue-50/40" : "border-gray-200 hover:border-blue-300 hover:bg-blue-50/20"}`}>
                      <Upload size={18} className={`mx-auto mb-1.5 ${dropDragging ? "text-blue-400" : "text-gray-300"}`} />
                      <p className="text-sm text-gray-400">{dropDragging ? "Drop to add" : "Drop files or click to browse"}</p>
                      <p className="text-xs text-gray-300 mt-0.5">PDF · Word · PowerPoint · Excel · CSV · text · images — up to 20 MB each, multiple files supported</p>
                    </div>
                    <input ref={fileRef} type="file" accept={ACCEPT_ATTR} multiple onChange={e => readFiles(e.target.files)} className="hidden" />
                    {/* File list */}
                    {files.length > 0 && (
                      <ul className="mt-2 space-y-1">
                        {files.map((f, i) => (
                          <li key={f.file.name} className="flex items-center gap-2 text-xs bg-gray-50 border border-gray-100 rounded-lg px-3 py-1.5">
                            <FileText size={12} className={i === 0 ? "text-blue-500 flex-shrink-0" : "text-gray-300 flex-shrink-0"} />
                            <span className="truncate flex-1 text-gray-700">{f.file.name}</span>
                            {i === 0 && <span className="text-[10px] text-blue-400 font-medium flex-shrink-0">primary</span>}
                            <span className="text-gray-300 flex-shrink-0">{(f.file.size/1024/1024).toFixed(1)} MB</span>
                            <button onClick={e => { e.stopPropagation(); setFiles(prev => prev.filter((_, j) => j !== i)); }}
                              className="text-gray-300 hover:text-red-400 flex-shrink-0 transition-colors"><X size={11} /></button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* Concept mode */}
                {entryMode === "concept" && (
                  <div className="space-y-3">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Venture name *</label>
                        <input value={conceptCard.name} onChange={e => setConceptCard(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Stripe"
                          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">Sector</label>
                        <input value={conceptCard.category} onChange={e => setConceptCard(p => ({ ...p, category: e.target.value }))} placeholder="e.g. B2B SaaS"
                          className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">One-liner *</label>
                      <textarea value={conceptCard.description} onChange={e => setConceptCard(p => ({ ...p, description: e.target.value }))} rows={2}
                        placeholder="What it does, for whom, how it makes money"
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-none" />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Target market</label>
                      <input value={conceptCard.targetMarket} onChange={e => setConceptCard(p => ({ ...p, targetMarket: e.target.value }))} placeholder="e.g. US mid-market SaaS companies"
                        className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400" />
                    </div>
                    <SeedInput seeds={conceptCard.knownCompetitors} label="Known competitors (optional)" placeholder="Competitor name"
                      onAdd={v => setConceptCard(p => ({ ...p, knownCompetitors: [...(p.knownCompetitors||[]), v] }))}
                      onRemove={i => setConceptCard(p => ({ ...p, knownCompetitors: p.knownCompetitors.filter((_,j) => j !== i) }))} />
                  </div>
                )}

                {/* Context */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-1.5 uppercase tracking-wide">Additional context</label>
                  <textarea value={userCtx} onChange={e => setUserCtx(e.target.value)} rows={2}
                    placeholder="Market nuances, specific questions, investor thesis…"
                    className="w-full text-sm px-3 py-2 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-400 resize-y" />
                </div>

                {/* Priority focus */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Priority focus</label>
                  <div className="flex flex-wrap gap-1.5">
                    {Object.entries(PRIORITY_FOCUS_MAP).map(([key, { label }]) => (
                      <button key={key} onClick={() => setPriorityFocus(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border transition-all ${priorityFocus.includes(key) ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Pipeline depth */}
                <div>
                  <label className="block text-xs font-medium text-gray-500 mb-2 uppercase tracking-wide">Pipeline depth</label>
                  <div className="flex gap-2">
                    {[["full","Full","All passes · ~30–60 min"],["sketch","Sketch","P0+P2+P3+P4 · ~10 min"]].map(([v,l,hint]) => (
                      <button key={v} onClick={() => setPipelineMode(v)}
                        className={`flex-1 text-xs py-2.5 rounded-xl border transition-all ${pipelineMode === v ? "bg-gray-900 text-white border-gray-900" : "bg-white text-gray-600 border-gray-200 hover:border-gray-400"}`}>
                        <div className="font-medium">{l}</div>
                        <div className={`mt-0.5 ${pipelineMode === v ? "text-gray-300" : "text-gray-400"}`}>{hint}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {error && <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg text-xs text-red-700"><AlertTriangle size={13} className="mt-0.5 flex-shrink-0" />{error}</div>}

                <button onClick={startAnalysis} disabled={!canStart || loading}
                  className="w-full py-3 bg-gray-900 text-white rounded-xl text-sm font-medium hover:bg-gray-700 disabled:opacity-40 flex items-center justify-center gap-2">
                  {loading ? <><Loader size={15} className="animate-spin" /> {loadingMsg}</> : <><Play size={15} /> {entryMode === "concept" ? "Research & analyze" : "Start analysis"}</>}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── REPORT SCREEN ── */}
        {screen === "output" && (
          <ReportView docState={docState} error={error} p0={p0} snapshots={snapshots} reportStale={reportStale} activeId={activeId}
            founderAnswers={founderAnswers} onAnswer={updateFounderAnswer}
            onBack={() => setScreen("pipeline")} onGenerate={generateDocument} onDownloadHTML={downloadHTML} />
        )}

        {/* ── PIPELINE SCREEN ── */}
        {screen === "pipeline" && (
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Top bar */}
            <div className="bg-white border-b border-gray-200 px-4 py-2.5 flex items-center gap-3 flex-shrink-0 flex-wrap print:hidden">
              <button onClick={() => setMobileNav(v => !v)} className="md:hidden text-gray-600 px-1" aria-label="Toggle navigation">☰</button>
              <span className="text-base font-semibold text-gray-900">{p0?.venture_name || "Analysis"}</span>
              {activeId && (projectMeta.is_owner ? (
                <button onClick={toggleShare} disabled={!organization && !projectMeta.shared}
                  title={organization ? (projectMeta.shared ? `Shared with everyone in ${organization.name}. Click to make private.` : `Share with everyone in ${organization.name}`) : "Select an organization (top of the sidebar) to share with your team"}
                  className={`text-xs px-2 py-0.5 rounded-full border inline-flex items-center gap-1 disabled:opacity-40 ${projectMeta.shared ? "bg-blue-50 text-blue-700 border-blue-200" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"}`}>
                  <Users size={11} /> {projectMeta.shared ? "Shared with team" : "Share with team"}
                </button>
              ) : (
                <Pill tone="blue" icon={<Users size={11} />}>Shared with you</Pill>
              ))}
              <div className="hidden lg:flex items-center gap-1.5">
                {p0?.classification?.business_model && <Pill>{p0.classification.business_model.toUpperCase()}</Pill>}
                <Pill icon={<FileStack size={11} />} title="Searchable passages from uploaded documents">{chunkStats.document} doc passages</Pill>
                <Pill icon={<Globe2 size={11} />} title="Facts gathered from web search and outside data">{chunkStats.web} web facts</Pill>
                {usage.tokens > 0 && <Pill icon={<Coins size={11} />} title={`${usage.calls} model calls on this deal (all team members)`}>{usage.tokens >= 1e6 ? (usage.tokens / 1e6).toFixed(2) + "M" : Math.round(usage.tokens / 1000) + "k"} tokens</Pill>}
              </div>
              {activeId && (
                <span className="inline-block align-top">
                  <CommentsPanel projectId={activeId} methodId={null} count={commentCounts._project || 0} label="Discussion" onChanged={() => refreshComments(activeId)} />
                </span>
              )}
              <div className="ml-auto flex items-center gap-3">
                <div className="hidden sm:flex items-center gap-2" title={`${progress.done} of ${progress.total} analyses approved`}>
                  <div className="w-28 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full bg-emerald-600" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
                  </div>
                  <span className="text-xs text-gray-600 tabular-nums">{progress.done}/{progress.total}</span>
                </div>
                <button onClick={() => setScreen("setup")} className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1">New deal</button>
                <button onClick={() => setScreen("output")} className="text-xs bg-gray-900 text-white px-3 py-1.5 rounded-lg hover:bg-gray-700 flex items-center gap-1.5">
                  <FileText size={12} /> Report
                  <span className={`w-1.5 h-1.5 rounded-full ${docState.generating ? "bg-blue-400 animate-pulse" : docState.execSummary ? (reportStale ? "bg-amber-400" : "bg-emerald-400") : "bg-gray-500"}`}
                    title={docState.generating ? "Being written" : docState.execSummary ? (reportStale ? "Out of date: analyses changed" : "Ready") : "Not generated yet"} />
                </button>
              </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
              {/* Pass sidebar — grouped by stage, with progress rings */}
              <nav className={`${mobileNav ? "block absolute z-30 inset-y-0 left-0 shadow-xl" : "hidden"} md:block md:static w-56 flex-shrink-0 bg-white border-r border-gray-100 overflow-y-auto print:hidden`} aria-label="Analysis sections">
                {[
                  { id: "overview", label: "Overview", icon: <LayoutDashboard size={13} /> },
                  { id: "p0", label: "Scoping", icon: p0 ? <Check size={13} className="text-emerald-600" /> : null, badge: revisionTriggers.length ? <span className="w-1.5 h-1.5 rounded-full bg-amber-500" title="Findings challenge the scoping" /> : null },
                  { id: "sources", label: "Sources", count: sources.length },
                ].map(item => (
                  <button key={item.id} onClick={() => { setActivePass(item.id); setFocusMethodId(null); setMobileNav(false); }}
                    className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 transition-colors ${activePass === item.id ? "bg-blue-50 text-blue-800 font-medium" : "text-gray-700 hover:bg-gray-50"}`}>
                    <span className="w-[18px] flex justify-center text-gray-500">{item.icon}</span>
                    <span className="flex-1">{item.label}</span>
                    {item.badge}
                    {item.count !== undefined && <span className="text-xs text-gray-500 tabular-nums">{item.count}</span>}
                  </button>
                ))}
                {[
                  { label: "Foundation", passes: ["p1", "p8"] },
                  { label: "Market & customers", passes: ["p2", "p3", "p4"] },
                  { label: "Strategy", passes: ["p5", "p6"] },
                  { label: "Synthesis", passes: ["p7", "p9"] },
                ].map(g => (
                  <div key={g.label} className="pt-3">
                    <div className="px-3 pb-1 text-[11px] uppercase tracking-wide text-gray-500">{g.label}</div>
                    {g.passes.map(pid => {
                      const pg = passGroups.find(p => p.id === pid);
                      if (!pg) return null;
                      const stale = pg.methods.some(m => staleMap[m.id]);
                      const running = pg.methods.some(m => methodStatus[m.id] === "extracting" || methodStatus[m.id] === "executing");
                      return (
                        <button key={pg.id} onClick={() => { setActivePass(pg.id); setFocusMethodId(null); setMobileNav(false); }}
                          className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${activePass === pg.id ? "bg-blue-50 text-blue-800 font-medium" : "text-gray-700 hover:bg-gray-50"} ${pg.totalActive === 0 ? "opacity-50" : ""}`}>
                          <span className={`w-[18px] flex justify-center ${running ? "animate-pulse" : ""}`}>
                            <ProgressRing value={pg.doneCount} total={pg.totalActive} color={passColor(pg, methodStatus, stale)} label={`${pg.title}: ${pg.doneCount} of ${pg.totalActive} approved`} />
                          </span>
                          <span className="flex-1 truncate">{pg.title}</span>
                          {stale && <span className="w-1.5 h-1.5 rounded-full bg-orange-500" title="An upstream analysis changed" />}
                          <span className="text-xs text-gray-500 tabular-nums">{pg.totalActive ? `${pg.doneCount}/${pg.totalActive}` : "–"}</span>
                        </button>
                      );
                    })}
                  </div>
                ))}
              </nav>

              {/* Main panel */}
              <div className="flex-1 overflow-y-auto p-4">
                {error && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3 flex items-start gap-2">
                    <AlertTriangle size={13} className="text-red-600 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-red-700">{error}</p>
                  </div>
                )}

                {/* Overview */}
                {activePass === "overview" && p0 && (
                  <DealOverview p0={p0} exec={docState.execSummary} snapshots={snapshots} passGroups={passGroups}
                    methodStatus={methodStatus} staleMap={staleMap} progress={progress} next={next} onNext={onNextStep}
                    onNavigate={(pid) => setActivePass(pid)} founderAnswers={founderAnswers} revisionCount={revisionTriggers.length} />
                )}

                {/* P0 View */}
                {activePass === "p0" && p0 && (
                  <div className="space-y-3 max-w-3xl">
                    {revisionTriggers.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                        <h2 className="text-sm font-semibold text-amber-900 mb-1">Findings that challenge the initial scoping ({revisionTriggers.length})</h2>
                        <p className="text-xs text-amber-800 mb-2">The analyses below contradict an assumption made when this venture was classified. Review them — they may change which analyses matter, or the classification itself.</p>
                        <ul className="space-y-1.5">
                          {revisionTriggers.map((t, i) => (
                            <li key={i} className="text-xs text-amber-900">
                              <button onClick={() => setActivePass(t.pass)} className="font-medium underline decoration-amber-300 hover:decoration-amber-600">{t.source}</button>
                              <span className="text-amber-700"> — </span>{t.text}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <h2 className="text-sm font-semibold mb-2">Venture classification</h2>
                      <p className="text-sm text-gray-600 mb-3">{p0.venture_summary}</p>
                      <div className="grid grid-cols-3 gap-2">
                        {Object.entries(p0.classification || {}).map(([k, v]) =>
                          k === "business_model" ? (
                            <div key={k} className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-xs text-gray-400 mb-1">business model <span className="text-gray-300">(detected)</span></p>
                              <div className="flex gap-1">
                                {["b2c","b2b","b2b2c"].map(opt => (
                                  <button key={opt} onClick={() => setP0(prev => ({ ...prev, classification: { ...prev.classification, business_model: opt } }))}
                                    className={`text-xs px-2 py-0.5 rounded transition-all ${v === opt ? "bg-gray-900 text-white" : "bg-white border border-gray-200 text-gray-500 hover:border-gray-400"}`}>
                                    {opt.toUpperCase()}
                                  </button>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <div key={k} className="bg-gray-50 rounded-lg px-3 py-2">
                              <p className="text-xs text-gray-400">{k.replace(/_/g, " ")}</p>
                              <p className="text-sm font-medium text-gray-800">{v}</p>
                            </div>
                          )
                        )}
                      </div>
                    </div>

                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <h2 className="text-sm font-semibold mb-2">Stakeholder hypothesis</h2>
                      <div className="grid grid-cols-5 gap-2">
                        {Object.entries(p0.stakeholder_hypothesis || {}).map(([k, v]) => (
                          <div key={k} className="bg-gray-50 rounded-lg px-3 py-2">
                            <p className="text-xs text-gray-400">{k}</p>
                            <p className="text-xs font-medium text-gray-800">{v}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {entities && (
                      <div className="bg-white rounded-xl border border-gray-200 p-4">
                        <div className="flex items-center justify-between mb-3">
                          <h2 className="text-sm font-semibold">Entity list</h2>
                          <span className="text-xs text-gray-400">Fed into every Extract call · auto-updated from web search</span>
                        </div>
                        <div className="grid grid-cols-3 gap-4">
                          {/* Competitors column — with Validate button */}
                          <div>
                            <div className="flex items-center justify-between mb-2">
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Competitors</p>
                              <button
                                onClick={validateCompetitors}
                                disabled={competitorValidating}
                                title="Use AI + web search to clean noise and discover real competitors"
                                className="flex items-center gap-1 text-[10px] text-blue-500 hover:text-blue-700 disabled:opacity-40 transition-colors">
                                {competitorValidating
                                  ? <><Loader size={9} className="animate-spin" />Validating…</>
                                  : <><Search size={9} />Validate</>}
                              </button>
                            </div>
                            {competitorValidationNote && (
                              <p className="text-[10px] text-gray-500 italic mb-2 leading-tight">{competitorValidationNote}</p>
                            )}
                            <EntityChipEditor
                              items={entities.competitors || []}
                              color="red"
                              placeholder="Add competitor…"
                              onClear={() => updateEntities({ ...entities, competitors: [] })}
                              onAdd={name => {
                                if (!(entities.competitors || []).includes(name))
                                  updateEntities({ ...entities, competitors: [...(entities.competitors || []), name] });
                              }}
                              onRemove={i => updateEntities({ ...entities, competitors: (entities.competitors || []).filter((_, j) => j !== i) })}
                            />
                          </div>

                          {/* Markets & Partners columns */}
                          {[
                            { key: "markets",  label: "Markets",  color: "blue",   placeholder: "Add market…" },
                            { key: "partners", label: "Partners", color: "purple", placeholder: "Add partner…" },
                          ].map(({ key, label, color, placeholder }) => (
                            <div key={key}>
                              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{label}</p>
                              <EntityChipEditor
                                items={entities[key] || []}
                                color={color}
                                placeholder={placeholder}
                                onAdd={name => {
                                  if (!(entities[key] || []).includes(name))
                                    updateEntities({ ...entities, [key]: [...(entities[key] || []), name] });
                                }}
                                onRemove={i => updateEntities({ ...entities, [key]: (entities[key] || []).filter((_, j) => j !== i) })}
                              />
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="bg-white rounded-xl border border-gray-200 p-4">
                      <h2 className="text-sm font-semibold mb-1">Methodology plan</h2>
                      <p className="text-xs text-gray-400 mb-3">{methods.filter(m=>m.decision==="run").length} run · {methods.filter(m=>m.decision==="lite").length} lite · {methods.filter(m=>m.decision==="skip").length} skip · ~{methods.filter(m=>m.decision!=="skip").length*2} API calls</p>
                      {passGroups.slice(1).map(pg => pg.methods.length > 0 && (
                        <div key={pg.id} className="mb-3">
                          <p className="text-xs font-medium text-gray-500 mb-1.5">P{pg.num} · {pg.title}</p>
                          <div className="flex flex-wrap gap-1">
                            {pg.methods.map(m => (
                              <button key={m.id} onClick={() => toggleDecision(m.id)}
                                className={`text-xs px-2 py-0.5 rounded-md border transition-colors ${m.decision==="run" ? "bg-emerald-50 text-emerald-700 border-emerald-200" : m.decision==="lite" ? "bg-amber-50 text-amber-700 border-amber-200" : "bg-gray-50 text-gray-400 border-gray-200 line-through"}`}>
                                {METHODOLOGY_REGISTRY[m.id]?.name || m.id}
                              </button>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Sources view */}
                {activePass === "sources" && (
                  <div className="max-w-2xl space-y-5">
                    {/* Header */}
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-semibold">Source library</h2>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">{Math.round(corpusText.length/1000)}k chars · {chunkStats.total} chunks</span>
                        {chunkStats.stale > 0 && (
                          <button onClick={reindexProject} disabled={reindexing}
                            title="These chunks were embedded with a different model than the one now configured; search ignores their vectors until re-indexed."
                            className="text-xs px-2 py-1 bg-amber-50 text-amber-800 border border-amber-200 rounded-lg hover:bg-amber-100 disabled:opacity-60">
                            {reindexing ? "Re-indexing…" : `Re-index ${chunkStats.stale} chunks`}
                          </button>
                        )}
                        <button onClick={() => addDocRef.current?.click()} disabled={addingDoc}
                          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 disabled:opacity-50 transition-colors">
                          {addingDoc ? <><Loader size={11} className="animate-spin" /> Processing…</> : <><Plus size={11} /> Add document</>}
                        </button>
                        <input ref={addDocRef} type="file" accept={ACCEPT_ATTR} className="hidden"
                          onChange={e => { const f = e.target.files?.[0]; if (f) { addDocument(f); e.target.value = ""; } }} />
                      </div>
                    </div>

                    {/* ── Documents section ── */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Documents</p>
                      <div className="space-y-2">
                        {sources.filter(s => s.type === "document" || s.type === "note").map(s => {
                          const Icon = SOURCE_ICONS[s.type] || FileText;
                          return (
                            <div key={s.id} className="group bg-white rounded-xl border border-gray-200 p-3 flex items-start gap-2.5">
                              <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 ${s.type==="document"?"bg-blue-50":"bg-yellow-50"}`}>
                                <Icon size={13} className={s.type==="document"?"text-blue-600":"text-yellow-600"} />
                              </div>
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-1.5 mb-0.5">
                                  <Badge type={s.type}>{SOURCE_LABELS[s.type]}</Badge>
                                  <span className="text-xs font-medium text-gray-800 truncate">{s.name}</span>
                                </div>
                                <div className="flex gap-2 text-xs text-gray-400">
                                  <span>{Math.round((s.rawText?.length||0)/1000)}k chars</span>
                                  {s.addedAt && <span>{new Date(s.addedAt).toLocaleDateString()}</span>}
                                </div>
                              </div>
                              <button onClick={() => removeSource(s.id)}
                                className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all flex-shrink-0 mt-0.5">
                                <X size={13} />
                              </button>
                            </div>
                          );
                        })}
                        {sources.filter(s => s.type === "document" || s.type === "note").length === 0 && (
                          <p className="text-xs text-gray-400 py-3">No documents uploaded.</p>
                        )}
                      </div>
                    </div>

                    {/* ── Web chunks section ── */}
                    <div>
                      <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">
                        Web discoveries · {sources.filter(s => s.type === "web_discovered").length} sources · {chunkStats.web} chunks
                      </p>
                      <div className="space-y-1.5">
                        {sources.filter(s => s.type === "web_discovered").map(s => {
                          const isExpanded = expandedSourceId === s.id;
                          return (
                            <div key={s.id} className="group bg-white rounded-xl border border-gray-200 overflow-hidden">
                              <div className="p-3 flex items-start gap-2.5 cursor-pointer" onClick={() => setExpandedSourceId(isExpanded ? null : s.id)}>
                                <div className="w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 bg-purple-50">
                                  <Search size={13} className="text-purple-600" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center gap-1.5 mb-0.5">
                                    <Badge type="web_discovered">Web</Badge>
                                    <span className="text-xs font-medium text-gray-700 truncate">{s.name}</span>
                                  </div>
                                  <div className="flex gap-2 text-xs text-gray-400">
                                    <span>{Math.round((s.rawText?.length||0)/1000)}k chars</span>
                                    {s.retrievedBy && <span className="text-purple-400">via {s.retrievedBy}</span>}
                                    {s.addedAt && <span>{new Date(s.addedAt).toLocaleDateString()}</span>}
                                  </div>
                                </div>
                                <div className="flex items-center gap-1.5 flex-shrink-0">
                                  <button onClick={e => { e.stopPropagation(); removeSource(s.id); }}
                                    className="opacity-0 group-hover:opacity-100 text-gray-300 hover:text-red-400 transition-all">
                                    <X size={13} />
                                  </button>
                                  {isExpanded ? <ChevronDown size={12} className="text-gray-400" /> : <ChevronRight size={12} className="text-gray-400" />}
                                </div>
                              </div>
                              {isExpanded && s.rawText && (
                                <div className="border-t border-gray-100 px-3 py-2.5 bg-gray-50">
                                  <pre className="text-xs text-gray-600 whitespace-pre-wrap leading-relaxed max-h-64 overflow-y-auto font-sans">{s.rawText}</pre>
                                </div>
                              )}
                            </div>
                          );
                        })}
                        {sources.filter(s => s.type === "web_discovered").length === 0 && (
                          <p className="text-xs text-gray-400 py-3">No web sources yet — web searches run automatically during Execute.</p>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {/* Pass group views */}
                {activePass && !["p0","sources"].includes(activePass) && (() => {
                  const pg = passGroups.find(p => p.id === activePass);
                  if (!pg) return null;
                  return (
                    <div className="max-w-3xl">
                      <div className="flex items-center justify-between mb-3">
                        <div>
                          <h2 className="text-sm font-semibold">P{pg.num} · {pg.title}</h2>
                          <p className="text-xs text-gray-400">{pg.doneCount}/{pg.totalActive} complete</p>
                        </div>
                        <button onClick={async () => {
                            const todo = pg.methods.filter(m => m.decision !== "skip" && !["done", "review", "extracting", "executing"].includes(methodStatus[m.id]));
                            for (const m of todo) await queueRun(m.id, methodStatus[m.id] === "extracted" ? "execute" : "run", methodNotes[m.id] || "");
                            toast(todo.length ? `Queued ${todo.length} in ${pg.title}.` : "Nothing left to run in this pass.", todo.length ? "success" : "info");
                          }}
                          className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded-lg hover:bg-gray-700 flex items-center gap-1.5">
                          <Play size={11} /> Run all in this pass
                        </button>
                      </div>
                      <PassSummaryCard
                        passId={pg.id}
                        summary={passSummaries[pg.id]}
                        stale={!!passSummaryStale[pg.id] || (pg.doneCount === pg.totalActive && pg.totalActive > 0 && !passSummaries[pg.id])}
                        onRegenerate={regeneratePassSummary}
                      />
                      {pg.id === "p7" && (
                        <FinancialModel finModel={finModel} onChange={updateFinModel} onPropose={proposeFinAssumptions} exportHref={`/api/projects/${activeId}/export?format=xlsx`}
                          proposing={finProposing} hasAnalyses={Object.keys(methodResults).length > 0} />
                      )}
                      {pg.methods.map(m => (
                        <MethodCard key={m.id} method={m}
                          status={methodStatus[m.id]}
                          evidence={evidenceBundles[m.id]}
                          result={methodResults[m.id]}
                          summary={methodSummaries[m.id]}
                          notes={methodNotes[m.id]}
                          projectId={activeId}
                          focused={focusMethodId === m.id}
                          onCancel={() => cancelRun(m.id)}
                          startedAt={runStartedAt[m.id]}
                          commentCount={commentCounts[m.id] || 0}
                          onCommentsChanged={() => refreshComments(activeId)}
                          runVersion={runVersions.current[m.id]}
                          staleBecause={staleMap[m.id]}
                          onRestored={() => syncRuns(activeId, { full: true })}
                          loading={!!methodLoading[m.id] || methodStatus[m.id] === "extracting" || methodStatus[m.id] === "executing"}
                          onRunExtract={() => runExtract(m.id)}
                          onRunAll={() => queueRun(m.id, methodStatus[m.id] === "extracted" ? "execute" : "run", methodNotes[m.id] || "")}
                          onRunExecute={() => runExecute(m.id)}
                          onApprove={() => approveMethod(m.id)}
                          onRerun={() => runRerun(m.id)}
                          onRevise={() => runRevise(m.id)}
                          onSummarise={async () => {
                            setMethodLoading(p => ({ ...p, [m.id]: true }));
                            try {
                              const ventureCtx = p0 ? { venture_name: p0.venture_name, venture_summary: p0.venture_summary, stage: p0.stage, classification: p0.classification } : null;
                              const summary = await pipeline("summarise", { methodologyId: m.id, result: methodResults[m.id], ventureCtx });
                              let newMethodSummaries;
                              setMethodSummaries(prev => { newMethodSummaries = { ...prev, [m.id]: summary }; return newMethodSummaries; });
                              let latestNotes, latestPassSummaries, latestPassStale, latestSources;
                              setMethodNotes(prev => { latestNotes = prev; return prev; });
                              setPassSummaries(prev => { latestPassSummaries = prev; return prev; });
                              setPassSummaryStale(prev => { latestPassStale = prev; return prev; });
                              setSources(prev => { latestSources = prev; return prev; });
                              await saveState(activeId, { corpusText, entities, p0, methods, methodNotes: latestNotes, methodSummaries: newMethodSummaries, passSummaries: latestPassSummaries, passSummaryStale: latestPassStale, sources: latestSources });
                            } catch (e) { setError(`Summarise failed: ${e.message}`); }
                            setMethodLoading(p => ({ ...p, [m.id]: false }));
                          }}
                          onToggle={() => toggleDecision(m.id)}
                          onNotesChange={v => setMethodNotes(prev => ({ ...prev, [m.id]: v }))} />
                      ))}
                    </div>
                  );
                })()}
              </div>
            </div>
          </div>
        )}
      </div>

      {settingsOpen && <SettingsPanel onClose={() => setSettingsOpen(false)} />}
    </div>
  );
}

export default function Page() {
  return <ToastProvider><PageInner /></ToastProvider>;
}

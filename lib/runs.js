// Repository for server-owned pipeline state: method runs, version history,
// searchable chunks (with embeddings), web sources and the job queue.
// All SQL lives here so the storage engine can later be swapped (e.g. Postgres
// + pgvector) without touching routes or the pipeline.

import { getDb, getProject } from "./db.js";
import { activeEmbeddingKey, DEFAULT_EMBEDDING_MODEL } from "./embedding-models.js";

const now = () => Date.now();
const parse = (s, fallback = null) => { try { return s == null ? fallback : JSON.parse(s); } catch { return fallback; } };

// ─── Chunks ──────────────────────────────────────────────────────────────────

const toBlob = (vec) => (Array.isArray(vec) || ArrayBuffer.isView(vec))
  ? Buffer.from(new Float32Array(vec).buffer)
  : null;

// Copy into an aligned buffer: Buffer.byteOffset is not guaranteed to be a multiple of 4
const fromBlob = (buf) => buf
  ? new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
  : null;

export function insertChunks(projectId, chunks) {
  if (!chunks?.length) return 0;
  const db = getDb();
  const stmt = db.prepare(`INSERT INTO chunks
    (project_id, text, entity, data_type, source_type, retrieved_by, chunk_index, source_url, published, confidence, pass_relevance, ingested_at, embedding, embedding_model)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const modelKey = activeEmbeddingKey(); // vectors are embedded just before insert, so they belong to the active model
  db.transaction(() => {
    for (const c of chunks) {
      stmt.run(
        projectId, String(c.text ?? ""), c.entity ?? null, c.data_type ?? null, c.source_type ?? null,
        c.retrieved_by ?? null, c.chunk_index ?? null, c.source_url ?? null, c.published ?? null,
        c.confidence ?? null, JSON.stringify(c.pass_relevance ?? []), c.ingested_at ?? new Date().toISOString(),
        toBlob(c.embedding), c.embedding?.length ? modelKey : null
      );
    }
  })();
  return chunks.length;
}

export function loadChunks(projectId) {
  return getDb().prepare("SELECT * FROM chunks WHERE project_id = ? ORDER BY id").all(projectId).map(r => ({
    id: r.id,
    text: r.text,
    entity: r.entity,
    data_type: r.data_type,
    source_type: r.source_type,
    retrieved_by: r.retrieved_by,
    chunk_index: r.chunk_index,
    source_url: r.source_url,
    published: r.published,
    confidence: r.confidence,
    pass_relevance: parse(r.pass_relevance, []),
    ingested_at: r.ingested_at,
    embedding: fromBlob(r.embedding),
    embedding_model: r.embedding_model,
  }));
}

export function chunkStats(projectId) {
  const db = getDb();
  const rows = db.prepare("SELECT source_type, COUNT(*) AS n FROM chunks WHERE project_id = ? GROUP BY source_type").all(projectId);
  const by = Object.fromEntries(rows.map(r => [r.source_type, r.n]));
  const total = rows.reduce((a, r) => a + r.n, 0);
  // chunks whose vector came from a different model than the active one (need a re-index)
  const stale = db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE project_id = ? AND embedding IS NOT NULL AND COALESCE(embedding_model, ?) != ?")
    .get(projectId, DEFAULT_EMBEDDING_MODEL, activeEmbeddingKey()).n;
  return { total, web: (by.web_search || 0) + (by.connector || 0), document: (by.document || 0) + (by.additional_doc || 0), stale };
}

// Chunks to re-embed after switching EMBEDDING_MODEL
export function staleChunks(projectId, limit = 200) {
  return getDb().prepare("SELECT id, text FROM chunks WHERE project_id = ? AND (embedding IS NULL OR COALESCE(embedding_model, ?) != ?) ORDER BY id LIMIT ?")
    .all(projectId, DEFAULT_EMBEDDING_MODEL, activeEmbeddingKey(), limit);
}

export function setChunkEmbeddings(updates) {
  const db = getDb();
  const stmt = db.prepare("UPDATE chunks SET embedding = ?, embedding_model = ? WHERE id = ?");
  const key = activeEmbeddingKey();
  db.transaction(() => { for (const { id, embedding } of updates) stmt.run(toBlob(embedding), key, id); })();
}

// Remove everything that came from one uploaded document
export function deleteDocumentChunks(projectId, fileName) {
  return getDb()
    .prepare("DELETE FROM chunks WHERE project_id = ? AND retrieved_by = ? AND source_type IN ('document','additional_doc')")
    .run(projectId, fileName).changes;
}

// Connector evidence for one method is replaced on every extraction
export function deleteConnectorChunks(projectId, methodId) {
  return getDb().prepare("DELETE FROM chunks WHERE project_id = ? AND source_type = 'connector' AND retrieved_by LIKE ?")
    .run(projectId, `%:${methodId}`).changes;
}

// ─── Web sources ─────────────────────────────────────────────────────────────

export function addWebSources(projectId, sources) {
  if (!sources?.length) return;
  const db = getDb();
  const stmt = db.prepare("INSERT OR REPLACE INTO web_sources (id, project_id, name, raw_text, retrieved_by, added_at) VALUES (?, ?, ?, ?, ?, ?)");
  db.transaction(() => { for (const s of sources) stmt.run(s.id, projectId, s.name, s.rawText, s.retrievedBy, s.addedAt); })();
}

const rowToSource = (r) => ({ id: r.id, type: "web_discovered", name: r.name, rawText: r.raw_text, entities: null, retrievedBy: r.retrieved_by, addedAt: r.added_at });

export function listWebSources(projectId, retrievedBy = null) {
  const db = getDb();
  const rows = retrievedBy
    ? db.prepare("SELECT * FROM web_sources WHERE project_id = ? AND retrieved_by = ? ORDER BY added_at").all(projectId, retrievedBy)
    : db.prepare("SELECT * FROM web_sources WHERE project_id = ? ORDER BY added_at").all(projectId);
  return rows.map(rowToSource);
}

export function deleteWebSource(projectId, sourceId) {
  return getDb().prepare("DELETE FROM web_sources WHERE project_id = ? AND id = ?").run(projectId, sourceId).changes;
}

// ─── Method runs ─────────────────────────────────────────────────────────────

const rowToRun = (r, { full }) => {
  const base = { method_id: r.method_id, status: r.status, error: r.error, version: r.version, updated_at: r.updated_at, result_updated_at: r.result_updated_at };
  if (!full) return base;
  return { ...base, evidence: parse(r.evidence), result: r.result, new_competitors: parse(r.new_competitors, []) };
};

export function getRun(projectId, methodId, { full = true } = {}) {
  const r = getDb().prepare("SELECT * FROM method_runs WHERE project_id = ? AND method_id = ?").get(projectId, methodId);
  return r ? rowToRun(r, { full }) : null;
}

export function listRuns(projectId, { full = false } = {}) {
  return getDb().prepare("SELECT * FROM method_runs WHERE project_id = ?").all(projectId).map(r => rowToRun(r, { full }));
}

// Upsert; only provided fields change. Always bumps version.
export function saveRun(projectId, methodId, patch) {
  const db = getDb();
  return db.transaction(() => {
    const cur = db.prepare("SELECT * FROM method_runs WHERE project_id = ? AND method_id = ?").get(projectId, methodId);
    const next = {
      status: patch.status ?? cur?.status ?? "pending",
      evidence: "evidence" in patch ? (patch.evidence == null ? null : JSON.stringify(patch.evidence)) : cur?.evidence ?? null,
      result: "result" in patch ? patch.result : cur?.result ?? null,
      error: "error" in patch ? patch.error : cur?.error ?? null,
      new_competitors: "new_competitors" in patch ? JSON.stringify(patch.new_competitors ?? []) : cur?.new_competitors ?? null,
      version: (cur?.version ?? 0) + 1,
    };
    const resultChanged = "result" in patch && patch.result !== (cur?.result ?? null);
    next.result_updated_at = resultChanged ? now() : cur?.result_updated_at ?? (next.result ? now() : null);
    db.prepare(`INSERT INTO method_runs (project_id, method_id, status, evidence, result, error, new_competitors, version, updated_at, result_updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id, method_id) DO UPDATE SET
        status = excluded.status, evidence = excluded.evidence, result = excluded.result, error = excluded.error,
        new_competitors = excluded.new_competitors, version = excluded.version, updated_at = excluded.updated_at,
        result_updated_at = excluded.result_updated_at`)
      .run(projectId, methodId, next.status, next.evidence, next.result, next.error, next.new_competitors, next.version, now(), next.result_updated_at);
    return getRun(projectId, methodId, { full: false });
  })();
}

export function appendVersion(projectId, methodId, kind, result) {
  getDb().prepare("INSERT INTO run_versions (project_id, method_id, kind, result, created_at) VALUES (?, ?, ?, ?, ?)")
    .run(projectId, methodId, kind, result, now());
}

export function getVersion(projectId, methodId, versionId) {
  return getDb().prepare("SELECT id, kind, result, created_at FROM run_versions WHERE project_id = ? AND method_id = ? AND id = ?")
    .get(projectId, methodId, versionId) || null;
}

export function listVersions(projectId, methodId) {
  return getDb().prepare("SELECT id, kind, result, created_at FROM run_versions WHERE project_id = ? AND method_id = ? ORDER BY id DESC")
    .all(projectId, methodId);
}

// ─── Jobs ────────────────────────────────────────────────────────────────────

export function activeJob(projectId, methodId) {
  return getDb().prepare("SELECT * FROM jobs WHERE project_id = ? AND method_id = ? AND status IN ('queued','running')").get(projectId, methodId) || null;
}

export function enqueueJob({ projectId, userId, methodId, action, payload = null }) {
  const info = getDb().prepare(
    "INSERT INTO jobs (project_id, user_id, method_id, action, payload, status, created_at) VALUES (?, ?, ?, ?, ?, 'queued', ?)"
  ).run(projectId, userId, methodId, action, payload ? JSON.stringify(payload) : null, now());
  return Number(info.lastInsertRowid);
}

// Oldest queued job whose owner is below the per-user concurrency cap
export function claimNextJob({ perUserCap = 2 } = {}) {
  const db = getDb();
  return db.transaction(() => {
    const job = db.prepare(`
      SELECT j.* FROM jobs j
      WHERE j.status = 'queued'
        AND (SELECT COUNT(*) FROM jobs r WHERE r.user_id = j.user_id AND r.status = 'running') < ?
      ORDER BY j.id LIMIT 1`).get(perUserCap);
    if (!job) return null;
    db.prepare("UPDATE jobs SET status = 'running', started_at = ? WHERE id = ?").run(now(), job.id);
    return { ...job, status: "running", payload: parse(job.payload, {}) };
  })();
}

export function finishJob(id, error = null) {
  getDb().prepare("UPDATE jobs SET status = ?, error = ?, finished_at = ? WHERE id = ?")
    .run(error ? "error" : "done", error ? String(error).slice(0, 2000) : null, now(), id);
}

// After a crash/restart: work that was in flight goes back to the queue
export function requeueRunningJobs() {
  return getDb().prepare("UPDATE jobs SET status = 'queued', started_at = NULL WHERE status = 'running'").run().changes;
}

export function setJobProgress(id, text) {
  getDb().prepare("UPDATE jobs SET progress = ? WHERE id = ?").run(String(text).slice(0, 200), id);
}

export function latestJob(projectId, methodId) {
  return getDb().prepare("SELECT * FROM jobs WHERE project_id = ? AND method_id = ? ORDER BY id DESC LIMIT 1").get(projectId, methodId) || null;
}

// ─── Report snapshots ────────────────────────────────────────────────────────

export function insertSnapshot(projectId, exec) {
  const score = Number.parseFloat(exec?.score);
  getDb().prepare("INSERT INTO report_snapshots (project_id, created_at, verdict, score_num, coverage, exec_json) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, now(), exec?.verdict ?? null, Number.isFinite(score) ? score : null, exec?.score_coverage ?? null, JSON.stringify(exec));
}

// Newest first. Each entry also carries the score change vs the previous report.
export function listSnapshots(projectId) {
  const rows = getDb().prepare("SELECT id, created_at, verdict, score_num, coverage, exec_json FROM report_snapshots WHERE project_id = ? ORDER BY id DESC").all(projectId);
  return rows.map((r, i) => {
    const prev = rows[i + 1];
    const dims = (j) => Object.fromEntries((parse(j, {}).score_breakdown || []).map(d => [d.id, d.score]));
    const cur = dims(r.exec_json), before = prev ? dims(prev.exec_json) : null;
    return {
      id: r.id, created_at: r.created_at, verdict: r.verdict, score: r.score_num, coverage: r.coverage,
      delta: prev && r.score_num !== null && prev.score_num !== null ? Math.round((r.score_num - prev.score_num) * 10) / 10 : null,
      dimensionChanges: before ? Object.keys(cur).filter(k => cur[k] !== before[k]).map(k => ({ id: k, from: before[k] ?? null, to: cur[k] ?? null })) : [],
    };
  });
}

export function jobCounts() {
  const rows = getDb().prepare("SELECT status, COUNT(*) AS n FROM jobs WHERE status IN ('queued','running') GROUP BY status").all();
  return Object.fromEntries(rows.map(r => [r.status, r.n]));
}

// ─── Project load for the client (+ one-time legacy migration) ───────────────

// Projects created before this change kept chunks, evidence, results and
// statuses inside the JSON blob. Move them into tables once, on first load.
export function migrateLegacyState(projectId) {
  const db = getDb();
  const row = db.prepare("SELECT state FROM projects WHERE id = ?").get(projectId); // access was authorised by the caller
  if (!row) return false;
  const s = parse(row.state, {});
  const legacyKeys = ["methodStatus", "evidenceBundles", "methodResults", "chunks"];
  const hasLegacy = legacyKeys.some(k => s[k] && (Array.isArray(s[k]) ? s[k].length : Object.keys(s[k]).length));
  const sourcesNeedSplit = Array.isArray(s.sources) && s.sources.some(x => x?.type === "web_discovered");
  if (!hasLegacy && !sourcesNeedSplit && !legacyKeys.some(k => k in s)) return false;

  db.transaction(() => {
    const haveRuns = db.prepare("SELECT COUNT(*) AS n FROM method_runs WHERE project_id = ?").get(projectId).n > 0;
    if (!haveRuns) {
      const ids = new Set([...Object.keys(s.methodStatus || {}), ...Object.keys(s.evidenceBundles || {}), ...Object.keys(s.methodResults || {})]);
      for (const id of ids) {
        let status = s.methodStatus?.[id] || (s.methodResults?.[id] ? "review" : s.evidenceBundles?.[id] ? "extracted" : "pending");
        // Mid-run statuses from a closed tab can never finish → fall back to a stable state
        if (status === "executing") status = s.methodResults?.[id] ? "review" : s.evidenceBundles?.[id] ? "extracted" : "error";
        if (status === "extracting") status = s.evidenceBundles?.[id] ? "extracted" : "error";
        saveRun(projectId, id, {
          status,
          evidence: s.evidenceBundles?.[id] ?? null,
          result: s.methodResults?.[id] ?? null,
          error: status === "error" ? "Interrupted - please run again." : null,
        });
        if (s.methodResults?.[id]) appendVersion(projectId, id, "execute", s.methodResults[id]);
      }
    }
    if (Array.isArray(s.chunks) && s.chunks.length && db.prepare("SELECT COUNT(*) AS n FROM chunks WHERE project_id = ?").get(projectId).n === 0) {
      insertChunks(projectId, s.chunks);
    }
    const web = (s.sources || []).filter(x => x?.type === "web_discovered");
    if (web.length) addWebSources(projectId, web);

    const cleaned = { ...s };
    for (const k of legacyKeys) delete cleaned[k];
    if (Array.isArray(cleaned.sources)) cleaned.sources = cleaned.sources.filter(x => x?.type !== "web_discovered");
    db.prepare("UPDATE projects SET state = ? WHERE id = ?").run(JSON.stringify(cleaned), projectId);
  })();
  return true;
}

// What GET /api/projects/:id returns: the blob plus web sources from their table
export function loadProjectForClient(projectId, userId, orgId = null) {
  if (!getProject(projectId, userId, orgId)) return null;
  migrateLegacyState(projectId);
  const project = getProject(projectId, userId, orgId);
  if (!project) return null;
  const sources = [...(project.state.sources || []), ...listWebSources(projectId)];
  return { ...project, state: { ...project.state, sources }, chunkStats: chunkStats(projectId) };
}

// Real provider-reported tokens spent on a deal (all team members combined)
export function projectUsage(projectId) {
  const r = getDb().prepare("SELECT COUNT(*) AS calls, COALESCE(SUM(token_est), 0) AS tokens FROM usage_events WHERE project_id = ? AND event_type = 'pipeline_call'").get(projectId);
  return { calls: r.calls, tokens: r.tokens };
}

// ─── Cross-deal comparison ───────────────────────────────────────────────────

// One row per project that has a generated report, for ranking deals on the
// same rubric. Reads only the small summary parts of each project's state.
export function listDealSummaries(userId, orgId = null) {
  const rows = getDb().prepare("SELECT id, name, status, updated_at, state, user_id, org_id FROM projects WHERE user_id = @userId OR (org_id IS NOT NULL AND org_id = @orgId) ORDER BY updated_at DESC").all({ userId, orgId });
  return rows.map(r => {
    const st = parse(r.state, {});
    const ex = st.docExecSummary;
    const shared = !!r.org_id, mine = r.user_id === userId;
    if (!ex) return { id: r.id, name: st.p0?.venture_name || r.name, status: r.status, updated_at: r.updated_at, stage: st.p0?.stage || null, hasReport: false, shared, mine };
    return {
      id: r.id,
      name: st.p0?.venture_name || r.name,
      status: r.status,
      updated_at: r.updated_at,
      stage: st.p0?.stage || null,
      model: st.p0?.classification?.business_model || null,
      hasReport: true,
      shared, mine,
      verdict: ex.verdict,
      score: Number.parseFloat(ex.score),
      scoreLabel: ex.score,
      coverage: ex.score_coverage ?? null,
      dimensions: Object.fromEntries((ex.score_breakdown || []).map(d => [d.id, d.score])),
      thesis: ex.investment_thesis || "",
    };
  });
}

// ─── Comments ────────────────────────────────────────────────────────────────

export function addComment({ projectId, methodId = null, userId, authorName, body }) {
  const text = String(body ?? "").trim().slice(0, 4000);
  if (!text) throw new Error("Comment is empty");
  const info = getDb().prepare("INSERT INTO comments (project_id, method_id, user_id, author_name, body, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .run(projectId, methodId, userId, String(authorName || "Team member").slice(0, 80), text, now());
  return Number(info.lastInsertRowid);
}

export function listComments(projectId, methodId = undefined) {
  const db = getDb();
  const rows = methodId === undefined
    ? db.prepare("SELECT * FROM comments WHERE project_id = ? ORDER BY id").all(projectId)
    : methodId === null
      ? db.prepare("SELECT * FROM comments WHERE project_id = ? AND method_id IS NULL ORDER BY id").all(projectId)
      : db.prepare("SELECT * FROM comments WHERE project_id = ? AND method_id = ? ORDER BY id").all(projectId, methodId);
  return rows.map(r => ({ id: r.id, method_id: r.method_id, user_id: r.user_id, author_name: r.author_name, body: r.body, created_at: r.created_at }));
}

export function commentCounts(projectId) {
  const rows = getDb().prepare("SELECT COALESCE(method_id, '') AS m, COUNT(*) AS n FROM comments WHERE project_id = ? GROUP BY m").all(projectId);
  return Object.fromEntries(rows.map(r => [r.m || "_project", r.n]));
}

// Only the author may delete their own comment
export function deleteComment(projectId, commentId, userId) {
  return getDb().prepare("DELETE FROM comments WHERE project_id = ? AND id = ? AND user_id = ?").run(projectId, commentId, userId).changes > 0;
}

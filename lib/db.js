import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { DEFAULT_SETTINGS } from "./constants.js";
import { encrypt, decrypt } from "./crypto.js";

// VENTURE_DATA_DIR lets deployments (and tests) point at a persistent volume
const DB_DIR  = process.env.VENTURE_DATA_DIR || path.join(process.cwd(), ".data");
const DB_PATH = path.join(DB_DIR, "venture.db");

let _db = null;

export function getDb() {
  if (_db) return _db;
  fs.mkdirSync(DB_DIR, { recursive: true });
  _db = new Database(DB_PATH);
  _db.pragma("journal_mode = WAL");
  migrate(_db);
  return _db;
}

function migrate(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS projects (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL DEFAULT '',
      name       TEXT NOT NULL,
      entry_mode TEXT NOT NULL DEFAULT 'document',
      status     TEXT NOT NULL DEFAULT 'setup',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      state      TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS user_settings (
      user_id TEXT PRIMARY KEY,
      data    TEXT NOT NULL
    );

    -- Append-only event log for usage monitoring
    CREATE TABLE IF NOT EXISTS usage_events (
      id           INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id      TEXT    NOT NULL,
      event_type   TEXT    NOT NULL,  -- 'pipeline_call' | 'project_created' | 'sign_in'
      step         TEXT,              -- pipeline step name (for pipeline_call events)
      model        TEXT,              -- model used
      token_est    INTEGER DEFAULT 0, -- rough token estimate
      created_at   INTEGER NOT NULL
    );

    -- ── Server-owned pipeline state (previously one JSON blob in the browser) ──

    -- One row per (project, method): its lifecycle status, evidence and latest result.
    -- status: pending | extracting | extracted | executing | review | done | error
    -- version increments on every change so clients can poll cheaply.
    CREATE TABLE IF NOT EXISTS method_runs (
      project_id      TEXT NOT NULL,
      method_id       TEXT NOT NULL,
      status          TEXT NOT NULL DEFAULT 'pending',
      evidence        TEXT,
      result          TEXT,
      error           TEXT,
      new_competitors TEXT,
      version         INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (project_id, method_id)
    );

    -- Every execute/revise output is kept: full history instead of overwrite
    CREATE TABLE IF NOT EXISTS run_versions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      method_id  TEXT NOT NULL,
      kind       TEXT NOT NULL,           -- 'execute' | 'revise'
      result     TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_versions_run ON run_versions(project_id, method_id);

    -- Searchable evidence: document chunks and web-discovered facts, with embeddings
    CREATE TABLE IF NOT EXISTS chunks (
      id             INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id     TEXT NOT NULL,
      text           TEXT NOT NULL,
      entity         TEXT,
      data_type      TEXT,
      source_type    TEXT,                -- document | additional_doc | web_search
      retrieved_by   TEXT,
      chunk_index    INTEGER,
      source_url     TEXT,
      published      TEXT,
      confidence     REAL,
      pass_relevance TEXT,
      ingested_at    TEXT,
      embedding      BLOB                 -- Float32 little-endian
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_project ON chunks(project_id);

    CREATE TABLE IF NOT EXISTS web_sources (
      id           TEXT PRIMARY KEY,
      project_id   TEXT NOT NULL,
      name         TEXT,
      raw_text     TEXT,
      retrieved_by TEXT,
      added_at     TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_web_sources_project ON web_sources(project_id);

    -- Durable work queue processed by lib/jobs.js
    CREATE TABLE IF NOT EXISTS jobs (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      method_id   TEXT NOT NULL,
      action      TEXT NOT NULL,          -- extract | execute | revise
      payload     TEXT,
      status      TEXT NOT NULL DEFAULT 'queued',   -- queued | running | done | error
      error       TEXT,
      created_at  INTEGER NOT NULL,
      started_at  INTEGER,
      finished_at INTEGER
    );
    -- One row per generated report: how a deal's score moves over time
    CREATE TABLE IF NOT EXISTS report_snapshots (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      verdict    TEXT,
      score_num  REAL,
      coverage   REAL,
      exec_json  TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_project ON report_snapshots(project_id);

    -- Team discussion on a deal (method_id NULL = about the whole deal)
    CREATE TABLE IF NOT EXISTS comments (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      project_id  TEXT NOT NULL,
      method_id   TEXT,
      user_id     TEXT NOT NULL,
      author_name TEXT NOT NULL,
      body        TEXT NOT NULL,
      created_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_comments_project ON comments(project_id, method_id);

    CREATE INDEX IF NOT EXISTS idx_jobs_status  ON jobs(status);
    CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, method_id);

    CREATE INDEX IF NOT EXISTS idx_usage_user_id   ON usage_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created   ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_type      ON usage_events(event_type);
  `);

  const projCols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!projCols.includes("org_id")) db.exec("ALTER TABLE projects ADD COLUMN org_id TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS idx_projects_org ON projects(org_id)");

  const jobCols = db.prepare("PRAGMA table_info(jobs)").all().map(c => c.name);
  if (!jobCols.includes("progress")) db.exec("ALTER TABLE jobs ADD COLUMN progress TEXT");

  // When a run's *result text* last changed (approve/status changes don't count);
  // lets the UI flag analyses whose upstream inputs changed afterwards.
  const runCols = db.prepare("PRAGMA table_info(method_runs)").all().map(c => c.name);
  if (!runCols.includes("result_updated_at")) {
    db.exec("ALTER TABLE method_runs ADD COLUMN result_updated_at INTEGER");
    db.exec("UPDATE method_runs SET result_updated_at = updated_at WHERE result IS NOT NULL");
  }

  // Add user_id column to existing projects table if it was created before this migration
  const cols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!cols.includes("user_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }
}

// ─── Settings (per-user, encrypted) ─────────────────────────────────────────

export function getSettings(userId) {
  if (!userId) return DEFAULT_SETTINGS;
  const row = getDb().prepare("SELECT data FROM user_settings WHERE user_id = ?").get(userId);
  if (!row) return DEFAULT_SETTINGS;
  try {
    const stored = JSON.parse(decrypt(row.data));
    // Deep-merge with DEFAULT_SETTINGS so new roles/providers always have a fallback
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      providers: { ...DEFAULT_SETTINGS.providers, ...(stored.providers || {}) },
      roles:     { ...DEFAULT_SETTINGS.roles,     ...(stored.roles     || {}) },
      connectors: { ...DEFAULT_SETTINGS.connectors, ...(stored.connectors || {}) },
    };
  } catch (err) {
    // Typically ENCRYPTION_KEY changed. Surface it instead of silently resetting.
    console.error("[db] Could not decrypt stored settings for user — falling back to defaults:", err.message);
    return { ...DEFAULT_SETTINGS, _decryptFailed: true };
  }
}

export function saveSettings(userId, data) {
  if (!userId) throw new Error("userId required to save settings");
  const encrypted = encrypt(JSON.stringify(data));
  getDb()
    .prepare("INSERT OR REPLACE INTO user_settings (user_id, data) VALUES (?, ?)")
    .run(userId, encrypted);
  return data;
}

// ─── Projects (scoped to user_id) ────────────────────────────────────────────

// A user can see their own projects plus those shared with their active organization.
// `orgId` is null when no organization is active → only own projects.
const VISIBLE = "(user_id = @userId OR (org_id IS NOT NULL AND org_id = @orgId))";

export function listProjects(userId, orgId = null) {
  return getDb()
    .prepare(`SELECT id, name, entry_mode, status, created_at, updated_at, user_id, org_id FROM projects WHERE ${VISIBLE} ORDER BY updated_at DESC`)
    .all({ userId, orgId })
    .map(({ user_id, org_id, ...p }) => ({ ...p, is_owner: user_id === userId, shared: !!org_id }));
}

export function getProject(id, userId, orgId = null) {
  const row = getDb()
    .prepare(`SELECT * FROM projects WHERE id = @id AND ${VISIBLE}`)
    .get({ id, userId, orgId });
  if (!row) return null;
  return { ...row, state: JSON.parse(row.state), is_owner: row.user_id === userId, shared: !!row.org_id };
}

// 'owner' | 'member' (via a shared organization) | null
export function projectAccess(id, userId, orgId = null) {
  const row = getDb().prepare("SELECT user_id, org_id FROM projects WHERE id = ?").get(id);
  if (!row) return null;
  if (row.user_id === userId) return "owner";
  if (row.org_id && orgId && row.org_id === orgId) return "member";
  return null;
}

// Owner only. orgId = the organization to share with, or null to make private.
export function setProjectOrg(id, userId, orgId) {
  return getDb().prepare("UPDATE projects SET org_id = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(orgId, Date.now(), id, userId).changes > 0;
}

// Access to a project is authorised by the route (ownership/sharing); background
// jobs use these id-only variants.
export function getProjectById(id) {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  return row ? { ...row, state: JSON.parse(row.state) } : null;
}

export function patchProjectState(id, patch) {
  const db = getDb();
  db.transaction(() => {
    const row = db.prepare("SELECT state FROM projects WHERE id = ?").get(id);
    if (!row) return;
    let existing = {};
    try { existing = JSON.parse(row.state) || {}; } catch { /* corrupt → start fresh */ }
    db.prepare("UPDATE projects SET state = ?, updated_at = ? WHERE id = ?")
      .run(JSON.stringify({ ...existing, ...sanitizeStatePatch(patch) }), Date.now(), id);
  })();
}

export function createProject({ id, name, entryMode = "document", userId }) {
  const now = Date.now();
  getDb().prepare(
    "INSERT INTO projects (id, user_id, name, entry_mode, status, created_at, updated_at, state) VALUES (?, ?, ?, ?, 'setup', ?, ?, '{}')"
  ).run(id, userId, name, entryMode, now, now);
  return getProject(id, userId);
}

// State keys that now live in dedicated tables. Older clients may still send
// them; they are ignored so a stale browser can never overwrite server state.
export const SERVER_OWNED_STATE_KEYS = ["methodStatus", "evidenceBundles", "methodResults", "chunks"];

export function sanitizeStatePatch(state) {
  const out = { ...state };
  for (const k of SERVER_OWNED_STATE_KEYS) delete out[k];
  // Web-discovered sources are rows in web_sources, not part of the blob
  if (Array.isArray(out.sources)) out.sources = out.sources.filter(s => s?.type !== "web_discovered");
  return out;
}

export function projectExists(id, userId) {
  return !!getDb().prepare("SELECT 1 FROM projects WHERE id = ? AND user_id = ?").get(id, userId);
}

// Callers must already have authorised access (projectAccess); orgId widens the
// lookup to projects shared with that organization.
export function updateProject(id, userId, { name, status, state }, orgId = null) {
  const now = Date.now();
  const db  = getDb();
  const where = `id = @id AND ${VISIBLE}`;
  const args = { id, userId, orgId, now };
  if (name)   db.prepare(`UPDATE projects SET name = @v, updated_at = @now WHERE ${where}`).run({ ...args, v: name });
  if (status) db.prepare(`UPDATE projects SET status = @v, updated_at = @now WHERE ${where}`).run({ ...args, v: status });
  if (state !== undefined && state !== null) {
    // Shallow-merge into the stored blob (atomic: better-sqlite3 is synchronous),
    // so partial patches never drop keys written by other code paths.
    db.transaction(() => {
      const row = db.prepare(`SELECT state FROM projects WHERE ${where}`).get({ id, userId, orgId });
      if (!row) return;
      let existing = {};
      try { existing = JSON.parse(row.state) || {}; } catch { /* corrupt blob → start fresh */ }
      const merged = { ...existing, ...sanitizeStatePatch(state) };
      db.prepare(`UPDATE projects SET state = @v, updated_at = @now WHERE ${where}`).run({ ...args, v: JSON.stringify(merged) });
    })();
  }
  return getProject(id, userId, orgId);
}

// Remove a project and everything derived from it
export function deleteProjectData(db, projectId) {
  for (const t of ["method_runs", "run_versions", "chunks", "web_sources", "jobs", "report_snapshots", "comments"]) {
    db.prepare(`DELETE FROM ${t} WHERE project_id = ?`).run(projectId);
  }
}

export function deleteProject(id, userId) {
  const db = getDb();
  db.transaction(() => {
    if (!projectExists(id, userId)) return;
    deleteProjectData(db, id);
    db.prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
  })();
}

// ─── Usage events (fire-and-forget, never throws) ────────────────────────────

// Rough token estimator: ~4 chars per token for English text
function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

export function logEvent({ userId, eventType, step = null, model = null, inputText = "", outputText = "", usage = null }) {
  try {
    // Prefer the provider's real token counts; fall back to a character-based estimate
    const tokenEst = usage && (usage.input || usage.output)
      ? (usage.input || 0) + (usage.output || 0)
      : estimateTokens(inputText) + estimateTokens(outputText);
    getDb()
      .prepare("INSERT INTO usage_events (user_id, event_type, step, model, token_est, created_at) VALUES (?, ?, ?, ?, ?, ?)")
      .run(userId, eventType, step, model, tokenEst, Date.now());
  } catch {
    // Never let logging crash the main request
  }
}

// ─── Admin stats ─────────────────────────────────────────────────────────────

export function getAdminStats() {
  const db = getDb();
  const now = Date.now();
  const day7  = now - 7  * 24 * 60 * 60 * 1000;
  const day30 = now - 30 * 24 * 60 * 60 * 1000;
  const day14 = now - 14 * 24 * 60 * 60 * 1000;

  // All users who have ever logged an event or created a project
  const users = db.prepare(`
    SELECT DISTINCT user_id FROM (
      SELECT user_id FROM usage_events
      UNION
      SELECT user_id FROM projects WHERE user_id != ''
    )
  `).all().map(r => r.user_id);

  const stats = users.map(userId => {
    const projectCount = db.prepare(
      "SELECT COUNT(*) as n FROM projects WHERE user_id = ?"
    ).get(userId).n;

    const calls7d = db.prepare(
      "SELECT COUNT(*) as n FROM usage_events WHERE user_id = ? AND event_type = 'pipeline_call' AND created_at > ?"
    ).get(userId, day7).n;

    const calls30d = db.prepare(
      "SELECT COUNT(*) as n FROM usage_events WHERE user_id = ? AND event_type = 'pipeline_call' AND created_at > ?"
    ).get(userId, day30).n;

    const tokens30d = db.prepare(
      "SELECT COALESCE(SUM(token_est), 0) as n FROM usage_events WHERE user_id = ? AND created_at > ?"
    ).get(userId, day30).n;

    const lastActive = db.prepare(
      "SELECT MAX(created_at) as ts FROM usage_events WHERE user_id = ?"
    ).get(userId).ts;

    const signInCount = db.prepare(
      "SELECT COUNT(*) as n FROM usage_events WHERE user_id = ? AND event_type = 'sign_in'"
    ).get(userId).n;

    // Most-used pipeline step
    const topStep = db.prepare(`
      SELECT step, COUNT(*) as n FROM usage_events
      WHERE user_id = ? AND event_type = 'pipeline_call' AND step IS NOT NULL
      GROUP BY step ORDER BY n DESC LIMIT 1
    `).get(userId);

    return {
      userId,
      projectCount,
      calls7d,
      calls30d,
      tokens30d,
      lastActive,
      signInCount,
      topStep: topStep?.step || null,
      inactive: !lastActive || lastActive < day14,
    };
  });

  // Global totals
  const totalCalls30d  = db.prepare("SELECT COUNT(*) as n FROM usage_events WHERE event_type = 'pipeline_call' AND created_at > ?").get(day30).n;
  const totalTokens30d = db.prepare("SELECT COALESCE(SUM(token_est), 0) as n FROM usage_events WHERE created_at > ?").get(day30).n;
  const totalProjects  = db.prepare("SELECT COUNT(*) as n FROM projects WHERE user_id != ''").get().n;
  const activeUsers7d  = db.prepare("SELECT COUNT(DISTINCT user_id) as n FROM usage_events WHERE created_at > ?").get(day7).n;

  // Daily call volume for the last 30 days (for sparkline)
  const dailyVolume = db.prepare(`
    SELECT
      date(created_at / 1000, 'unixepoch') as day,
      COUNT(*) as calls
    FROM usage_events
    WHERE event_type = 'pipeline_call' AND created_at > ?
    GROUP BY day ORDER BY day ASC
  `).all(day30);

  return { users: stats, totals: { totalCalls30d, totalTokens30d, totalProjects, activeUsers7d, userCount: users.length }, dailyVolume };
}

// ─── Privacy: remove everything stored for a user ────────────────────────────
export function deleteUserData(userId) {
  if (!userId) return;
  const db = getDb();
  db.transaction(() => {
    for (const { id } of db.prepare("SELECT id FROM projects WHERE user_id = ?").all(userId)) deleteProjectData(db, id);
    db.prepare("DELETE FROM jobs WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM projects WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM user_settings WHERE user_id = ?").run(userId);
    db.prepare("DELETE FROM usage_events WHERE user_id = ?").run(userId);
  })();
}

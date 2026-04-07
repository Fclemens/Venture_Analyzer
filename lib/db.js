import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { DEFAULT_SETTINGS } from "./constants.js";
import { encrypt, decrypt } from "./crypto.js";

const DB_DIR  = path.join(process.cwd(), ".data");
const DB_PATH = path.join(DB_DIR, "venture.db");

let _db = null;

function getDb() {
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

    CREATE INDEX IF NOT EXISTS idx_usage_user_id   ON usage_events(user_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created   ON usage_events(created_at);
    CREATE INDEX IF NOT EXISTS idx_usage_type      ON usage_events(event_type);
  `);

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
    };
  } catch {
    return DEFAULT_SETTINGS;
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

export function listProjects(userId) {
  return getDb()
    .prepare("SELECT id, name, entry_mode, status, created_at, updated_at FROM projects WHERE user_id = ? ORDER BY updated_at DESC")
    .all(userId);
}

export function getProject(id, userId) {
  const row = getDb()
    .prepare("SELECT * FROM projects WHERE id = ? AND user_id = ?")
    .get(id, userId);
  if (!row) return null;
  return { ...row, state: JSON.parse(row.state) };
}

export function createProject({ id, name, entryMode = "document", userId }) {
  const now = Date.now();
  getDb().prepare(
    "INSERT INTO projects (id, user_id, name, entry_mode, status, created_at, updated_at, state) VALUES (?, ?, ?, ?, 'setup', ?, ?, '{}')"
  ).run(id, userId, name, entryMode, now, now);
  return getProject(id, userId);
}

export function updateProject(id, userId, { name, status, state }) {
  const now = Date.now();
  const db  = getDb();
  if (name)   db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(name, now, id, userId);
  if (status) db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(status, now, id, userId);
  if (state !== undefined) {
    db.prepare("UPDATE projects SET state = ?, updated_at = ? WHERE id = ? AND user_id = ?").run(JSON.stringify(state), now, id, userId);
  }
  return getProject(id, userId);
}

export function deleteProject(id, userId) {
  getDb().prepare("DELETE FROM projects WHERE id = ? AND user_id = ?").run(id, userId);
}

// ─── Usage events (fire-and-forget, never throws) ────────────────────────────

// Rough token estimator: ~4 chars per token for English text
function estimateTokens(text) {
  if (!text || typeof text !== "string") return 0;
  return Math.ceil(text.length / 4);
}

export function logEvent({ userId, eventType, step = null, model = null, inputText = "", outputText = "" }) {
  try {
    const tokenEst = estimateTokens(inputText) + estimateTokens(outputText);
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

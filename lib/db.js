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
  `);

  // Add user_id column to existing projects table if it was created before this migration
  const cols = db.prepare("PRAGMA table_info(projects)").all().map(c => c.name);
  if (!cols.includes("user_id")) {
    db.exec("ALTER TABLE projects ADD COLUMN user_id TEXT NOT NULL DEFAULT ''");
  }

  // Drop old global settings table if it exists (no longer used)
  // We keep it present so old DBs don't error, but all reads/writes use user_settings
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

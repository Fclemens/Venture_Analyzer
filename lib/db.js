import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { DEFAULT_SETTINGS } from "./constants.js";

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
      name       TEXT NOT NULL,
      entry_mode TEXT NOT NULL DEFAULT 'document',
      status     TEXT NOT NULL DEFAULT 'setup',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      state      TEXT NOT NULL DEFAULT '{}'
    );

    CREATE TABLE IF NOT EXISTS settings (
      id   INTEGER PRIMARY KEY,
      data TEXT NOT NULL
    );
  `);

  // Seed default settings if missing
  const existing = db.prepare("SELECT id FROM settings WHERE id = 1").get();
  if (!existing) {
    db.prepare("INSERT INTO settings (id, data) VALUES (1, ?)").run(JSON.stringify(DEFAULT_SETTINGS));
  }
}

// ─── Settings ───────────────────────────────
export function getSettings() {
  const row = getDb().prepare("SELECT data FROM settings WHERE id = 1").get();
  if (!row) return DEFAULT_SETTINGS;
  const stored = JSON.parse(row.data);
  // Deep-merge with DEFAULT_SETTINGS so any new roles/providers added after
  // initial seed are always present with fallback values.
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    providers: { ...DEFAULT_SETTINGS.providers, ...(stored.providers || {}) },
    roles:     { ...DEFAULT_SETTINGS.roles,     ...(stored.roles     || {}) },
  };
}

export function saveSettings(data) {
  getDb().prepare("INSERT OR REPLACE INTO settings (id, data) VALUES (1, ?)").run(JSON.stringify(data));
  return data;
}

// ─── Projects ───────────────────────────────
export function listProjects() {
  return getDb()
    .prepare("SELECT id, name, entry_mode, status, created_at, updated_at FROM projects ORDER BY updated_at DESC")
    .all();
}

export function getProject(id) {
  const row = getDb().prepare("SELECT * FROM projects WHERE id = ?").get(id);
  if (!row) return null;
  return { ...row, state: JSON.parse(row.state) };
}

export function createProject({ id, name, entryMode = "document" }) {
  const now = Date.now();
  getDb().prepare(
    "INSERT INTO projects (id, name, entry_mode, status, created_at, updated_at, state) VALUES (?, ?, ?, 'setup', ?, ?, '{}')"
  ).run(id, name, entryMode, now, now);
  return getProject(id);
}

export function updateProject(id, { name, status, state }) {
  const now = Date.now();
  const db  = getDb();
  if (name)   db.prepare("UPDATE projects SET name = ?, updated_at = ? WHERE id = ?").run(name, now, id);
  if (status) db.prepare("UPDATE projects SET status = ?, updated_at = ? WHERE id = ?").run(status, now, id);
  if (state !== undefined) {
    db.prepare("UPDATE projects SET state = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(state), now, id);
  }
  return getProject(id);
}

export function deleteProject(id) {
  getDb().prepare("DELETE FROM projects WHERE id = ?").run(id);
}

import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";

// DB path is configurable so the packaged Electron app can store it in userData
// (a writable per-user dir) instead of the read-only install directory.
const dbPath = process.env.CASPER_DB_PATH || "data.db";
const sqlite = new Database(dbPath);
sqlite.pragma("journal_mode = WAL");

// Ensure tables exist (drizzle doesn't auto-migrate; create explicitly).
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS bookmarks (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT NOT NULL,
    url        TEXT NOT NULL,
    favicon    TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS history (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    title      TEXT,
    url        TEXT NOT NULL,
    visited_at INTEGER NOT NULL
  );
`);

export const db = drizzle(sqlite);

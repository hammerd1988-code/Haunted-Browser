import { db } from "./db";
import { bookmarks, history, settings } from "@shared/schema";
import type { Bookmark, InsertBookmark, HistoryEntry, InsertHistory } from "@shared/schema";
import { eq, desc } from "drizzle-orm";

export interface IStorage {
  // settings (kv)
  getSetting(key: string): Promise<string | null>;
  setSetting(key: string, value: string): Promise<void>;
  getAllSettings(): Promise<Record<string, string>>;
  // bookmarks
  listBookmarks(): Promise<Bookmark[]>;
  addBookmark(b: InsertBookmark): Promise<Bookmark>;
  removeBookmark(id: number): Promise<void>;
  // history
  listHistory(limit?: number): Promise<HistoryEntry[]>;
  addHistory(h: InsertHistory): Promise<void>;
  clearHistory(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  async getSetting(key: string): Promise<string | null> {
    const row = db.select().from(settings).where(eq(settings.key, key)).get();
    return row?.value ?? null;
  }

  async setSetting(key: string, value: string): Promise<void> {
    db.insert(settings)
      .values({ key, value })
      .onConflictDoUpdate({ target: settings.key, set: { value } })
      .run();
  }

  async getAllSettings(): Promise<Record<string, string>> {
    const rows = db.select().from(settings).all();
    const out: Record<string, string> = {};
    for (const r of rows) out[r.key] = r.value;
    return out;
  }

  async listBookmarks(): Promise<Bookmark[]> {
    return db.select().from(bookmarks).orderBy(desc(bookmarks.createdAt)).all();
  }

  async addBookmark(b: InsertBookmark): Promise<Bookmark> {
    return db.insert(bookmarks).values(b).returning().get();
  }

  async removeBookmark(id: number): Promise<void> {
    db.delete(bookmarks).where(eq(bookmarks.id, id)).run();
  }

  async listHistory(limit = 50): Promise<HistoryEntry[]> {
    return db.select().from(history).orderBy(desc(history.visitedAt)).limit(limit).all();
  }

  async addHistory(h: InsertHistory): Promise<void> {
    db.insert(history).values(h).run();
  }

  async clearHistory(): Promise<void> {
    db.delete(history).run();
  }
}

export const storage = new DatabaseStorage();

// ensure data dir / db is initialized by better-sqlite3 on first query.
// Run a harmless pragma to warm the connection.
db.run("PRAGMA journal_mode = WAL");

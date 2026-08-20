import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import type * as z from "zod/mini";

// Key-value store for app settings (ollama base url, selected model, etc.)
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const bookmarks = sqliteTable("bookmarks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  url: text("url").notNull(),
  favicon: text("favicon"),
  createdAt: integer("created_at").notNull().$defaultFn(() => Date.now()),
});

export const history = sqliteTable("history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title"),
  url: text("url").notNull(),
  visitedAt: integer("visited_at").notNull().$defaultFn(() => Date.now()),
});

export const insertBookmarkSchema = createInsertSchema(bookmarks).pick({
  title: true,
  url: true,
  favicon: true,
});

export const insertHistorySchema = createInsertSchema(history).pick({
  title: true,
  url: true,
});

export type InsertBookmark = z.infer<typeof insertBookmarkSchema>;
export type Bookmark = typeof bookmarks.$inferSelect;
export type InsertHistory = z.infer<typeof insertHistorySchema>;
export type HistoryEntry = typeof history.$inferSelect;

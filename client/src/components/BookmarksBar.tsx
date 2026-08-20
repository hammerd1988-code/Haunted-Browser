import { Star } from "lucide-react";
import type { Bookmark } from "@shared/schema";
import { faviconFor } from "@/lib/ghost";

export function BookmarksBar({
  bookmarks,
  onOpen,
  onRemove,
}: {
  bookmarks: Bookmark[];
  onOpen: (url: string) => void;
  onRemove: (id: number) => void;
}) {
  if (bookmarks.length === 0) return null;
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-sidebar/30 glass border-b border-border overflow-x-auto ghost-scroll">
      {bookmarks.map((bm) => (
        <div key={bm.id} className="group flex items-center shrink-0">
          <button
            type="button"
            onClick={() => onOpen(bm.url)}
            className="flex items-center gap-1.5 h-7 px-2 rounded-md text-xs text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors max-w-[180px]"
          >
            <img
              src={bm.favicon || faviconFor(bm.url)}
              alt=""
              className="w-3.5 h-3.5 rounded"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
              }}
            />
            <span className="truncate">{bm.title}</span>
          </button>
          <button
            type="button"
            aria-label="Remove bookmark"
            onClick={() => onRemove(bm.id)}
            className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/15 text-muted-foreground hover:text-destructive transition-all"
          >
            <Star className="w-3 h-3" fill="currentColor" />
          </button>
        </div>
      ))}
    </div>
  );
}

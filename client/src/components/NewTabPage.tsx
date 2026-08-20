import { useState } from "react";
import { Search, Sparkles, Ghost } from "lucide-react";
import type { Bookmark } from "@shared/schema";
import { GhostMascot, faviconFor, hostOf } from "@/lib/ghost";

const QUICK_LINKS = [
  { title: "Wikipedia", url: "https://www.wikipedia.org" },
  { title: "MDN Web Docs", url: "https://developer.mozilla.org" },
  { title: "Hacker News", url: "https://news.ycombinator.com" },
  { title: "GitHub", url: "https://github.com" },
  { title: "YouTube", url: "https://youtube.com" },
  { title: "Reddit", url: "https://reddit.com" },
];

export function NewTabPage({
  bookmarks,
  onNavigate,
  onAskCasper,
}: {
  bookmarks: Bookmark[];
  onNavigate: (input: string) => void;
  onAskCasper: (prompt: string) => void;
}) {
  const [query, setQuery] = useState("");

  const dial = [...bookmarks.slice(0, 6), ...QUICK_LINKS.filter((q) => !bookmarks.some((b) => b.url === q.url))];
  const uniqueDial = Array.from(new Map(dial.map((d) => [d.url, d])).values()).slice(0, 8);

  return (
    <div className="h-full overflow-auto ghost-scroll">
      <div className="min-h-full flex flex-col items-center justify-center px-6 py-16">
        <div className="flex flex-col items-center gap-4 mb-10">
          <GhostMascot size={84} floating glow />
          <div className="text-center">
            <h1 className="font-[family-name:var(--font-display)] text-3xl font-bold tracking-tight ghost-text-glow">
              Haunted Browser
            </h1>
            <p className="text-muted-foreground text-sm mt-1">Your friendly ghost in the browser</p>
          </div>
        </div>

        <form
          className="w-full max-w-xl"
          onSubmit={(e) => {
            e.preventDefault();
            onNavigate(query);
            setQuery("");
          }}
        >
          <div className="flex items-center gap-3 h-14 px-5 rounded-full glass border border-border focus-within:border-primary/60 focus-within:ghost-glow transition-all">
            <Search className="w-5 h-5 text-muted-foreground shrink-0" />
            <input
              type="text"
              value={query}
              data-testid="input-newtab-search"
              placeholder="Search the web or ask Casper…"
              onChange={(e) => setQuery(e.target.value)}
              className="flex-1 bg-transparent outline-none text-base placeholder:text-muted-foreground"
              autoFocus
            />
            <button
              type="button"
              onClick={() => onAskCasper(query || "Hey Casper, what can you do?")}
              className="shrink-0 flex items-center gap-1.5 h-9 px-3 rounded-full bg-primary/15 text-primary text-sm font-medium hover:bg-primary/25 transition-colors"
            >
              <Sparkles className="w-4 h-4" />
              Ask Casper
            </button>
          </div>
        </form>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-12 w-full max-w-xl">
          {uniqueDial.map((link) => (
            <button
              key={link.url}
              type="button"
              onClick={() => onNavigate(link.url)}
              className="group flex flex-col items-center gap-2 p-4 rounded-2xl glass border border-border hover:border-primary/40 hover:-translate-y-0.5 transition-all"
            >
              <div className="w-10 h-10 rounded-xl bg-background/80 flex items-center justify-center group-hover:ghost-glow transition-all">
                <img
                  src={faviconFor(link.url)}
                  alt=""
                  className="w-6 h-6 rounded"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).outerHTML =
                      '<span class="text-muted-foreground text-sm font-semibold">' + hostOf(link.url).slice(0, 1).toUpperCase() + "</span>";
                  }}
                />
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground truncate max-w-full">
                {link.title}
              </span>
            </button>
          ))}
        </div>

        <p className="mt-12 text-xs text-muted-foreground/70 flex items-center gap-1.5">
          <Ghost className="w-3.5 h-3.5" />
          Casper runs on your local LM Studio or Ollama. Start LM Studio's Local Server and load a model to go live.
        </p>
      </div>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Ghost, ShieldAlert, Sparkles, Loader2 } from "lucide-react";
import { NewTabPage } from "./NewTabPage";
import type { Bookmark } from "@shared/schema";
import { GhostMascot, hostOf } from "@/lib/ghost";
import { probeUrl } from "@/lib/api";

type LoadState = "probing" | "embeddable" | "blocked";

export function BrowserViewport({
  url,
  bookmarks,
  onNavigate,
  onAskCasper,
}: {
  url: string;
  bookmarks: Bookmark[];
  onNavigate: (input: string) => void;
  onAskCasper: (prompt: string) => void;
}) {
  const [state, setState] = useState<LoadState>("probing");
  const [reason, setReason] = useState("");
  const reqId = useRef(0);

  useEffect(() => {
    if (url === "about:newtab") return;
    setState("probing");
    setReason("");

    const id = ++reqId.current;
    let cancelled = false;
    probeUrl(url)
      .then((result) => {
        if (cancelled || id !== reqId.current) return;
        if (result.embeddable) {
          setState("embeddable");
        } else {
          setReason(result.reason || "blocked by site headers");
          setState("blocked");
        }
      })
      .catch(() => {
        if (cancelled || id !== reqId.current) return;
        setState("embeddable"); // optimistic fallback
      });

    return () => {
      cancelled = true;
    };
  }, [url]);

  if (url === "about:newtab") {
    return (
      <NewTabPage bookmarks={bookmarks} onNavigate={onNavigate} onAskCasper={onAskCasper} />
    );
  }

  return (
    <div className="relative h-full bg-background">
      {state === "embeddable" && (
        <iframe
          key={url}
          src={url}
          title="browser content"
          data-testid="browser-iframe"
          className="w-full h-full border-0 bg-white"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox allow-presentation"
          referrerPolicy="no-referrer"
        />
      )}

      {/* always-available external open chip */}
      {state !== "probing" && (
        <div className="absolute top-3 right-3 z-10">
          <a
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1.5 h-8 px-3 rounded-full glass-strong border border-border text-xs text-foreground/80 hover:text-foreground shadow-lg"
          >
            <ExternalLink className="w-3.5 h-3.5" />
            Open externally
          </a>
        </div>
      )}

      {state === "probing" && (
        <div className="absolute inset-0 z-10 flex items-center justify-center bg-background">
          <div className="flex flex-col items-center gap-3">
            <GhostMascot size={56} floating glow />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="w-4 h-4 animate-spin" />
              Materializing {hostOf(url)}…
            </div>
          </div>
        </div>
      )}

      {state === "blocked" && (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-background/95 backdrop-blur p-6">
          <div className="max-w-md text-center">
            <GhostMascot size={72} floating glow />
            <h2 className="font-[family-name:var(--font-display)] text-xl font-bold mt-4">
              This site won't be embedded
            </h2>
            <p className="text-sm text-muted-foreground mt-2 leading-relaxed">
              <span className="text-foreground font-medium">{hostOf(url)}</span> sends headers
              {reason ? ` (${reason})` : ""} that stop it from loading inside another page. This is a
              browser security rule, not a bug.
            </p>
            <div className="flex flex-col gap-2 mt-6">
              <a
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 h-11 rounded-full bg-primary text-primary-foreground font-medium hover:opacity-90 transition-opacity"
              >
                <ExternalLink className="w-4 h-4" />
                Open {hostOf(url)} in a new tab
              </a>
              <button
                type="button"
                onClick={() => onAskCasper(`Tell me about the website ${url} — what is it and what's it for?`)}
                className="flex items-center justify-center gap-2 h-11 rounded-full glass border border-border text-sm hover:border-primary/40 transition-colors"
              >
                <Sparkles className="w-4 h-4 text-primary" />
                Ask Casper about this site
              </button>
            </div>
            <p className="text-xs text-muted-foreground/70 mt-6 flex items-center justify-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5" />
              In the Electron desktop build, every site loads natively with no embed limits.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { NewTabPage } from "./NewTabPage";
import type { Bookmark } from "@shared/schema";
import { hostOf } from "@/lib/ghost";

const NEWTAB = "about:newtab";

type TabMeta = { title?: string; favicon?: string; loading?: boolean };

/**
 * Electron-only viewport. Uses a real <webview> so ANY site loads natively
 * (no iframe X-Frame-Options / CSP frame-ancestors limits). Navigation is driven
 * imperatively via the `src` attribute so link clicks inside a page don't cause
 * reload loops. Also wires page title/favicon/loading events, per-tab zoom, and an
 * in-page find bar (Ctrl+F).
 */
export function ElectronViewport({
  url,
  bookmarks,
  onNavigate,
  onAskCasper,
  reloadNonce,
  onContext,
  tabId,
  zoomFactor = 1,
  findOpen,
  onFindClose,
  onTabMeta,
  onExecutor,
}: {
  url: string;
  bookmarks: Bookmark[];
  onNavigate: (input: string) => void;
  onAskCasper: (prompt: string) => void;
  reloadNonce: number;
  onContext?: (ctx: PageContext) => void;
  tabId?: string;
  zoomFactor?: number;
  findOpen?: boolean;
  onFindClose?: () => void;
  onTabMeta?: (meta: TabMeta) => void;
  /** Hands the parent a fixed-script page executor (null when no live page). */
  onExecutor?: (fn: ((code: string) => Promise<unknown>) | null) => void;
}) {
  const wvRef = useRef<any>(null);
  const lastReportedUrl = useRef<string>("");
  const cbRef = useRef({ onNavigate, onContext, onTabMeta });
  cbRef.current = { onNavigate, onContext, onTabMeta };
  const zoomRef = useRef(zoomFactor);
  zoomRef.current = zoomFactor;
  const findInputRef = useRef<HTMLInputElement>(null);
  const [findState, setFindState] = useState<{ query: string; index: number; total: number }>({
    query: "",
    index: 0,
    total: 0,
  });
  const findReqId = useRef<number>(0);

  // Wire listeners + navigate. Depends on [url] so it runs AFTER the <webview>
  // mounts — it only renders when url !== NEWTAB, so a [] effect would run during
  // the initial NewTabPage render when wvRef.current is still null and never wire up.
  // Track the actual DOM node (not a boolean): when the <webview> is destroyed
  // (url → NEWTAB) and later recreated, the node reference changes so we re-attach
  // listeners to the fresh element. A boolean would stay true and skip wiring.
  const wired = useRef<any>(null);
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || url === NEWTAB) return;

    if (wired.current !== wv) {
      wired.current = wv;

      // A navigation (or in-page nav) inside the guest. Update the address bar.
      const handleNav = (e: any) => {
        if (!e || !e.url) return;
        lastReportedUrl.current = e.url;
        cbRef.current.onNavigate(e.url);
      };
      wv.addEventListener("did-navigate", handleNav);
      wv.addEventListener("did-navigate-in-page", handleNav);
      wv.addEventListener("new-window", (e: any) => {
        if (e && e.url) cbRef.current.onNavigate(e.url);
      });

      // --- Tab meta: loading state, real title, real favicon ---
      // Guard against stale events from a previous navigation by checking the guest's
      // current URL still matches the active tab (hash differences ignored).
      const samePage = () => {
        try {
          const cur = wv.getURL ? wv.getURL() : "";
          if (!cur) return true;
          const a = cur.split("#")[0];
          const b = url.split("#")[0];
          return a === b;
        } catch {
          return true;
        }
      };
      const reportMeta = (m: TabMeta) => {
        if (!samePage()) return;
        cbRef.current.onTabMeta?.(m);
      };
      wv.addEventListener("did-start-loading", () => reportMeta({ loading: true }));
      wv.addEventListener("did-stop-loading", () => reportMeta({ loading: false }));
      wv.addEventListener("page-title-updated", (e: any) => {
        const t = e?.title;
        if (t && String(t).trim()) reportMeta({ title: String(t).trim() });
      });
      wv.addEventListener("page-favicon-updated", (e: any) => {
        const favs: string[] = Array.isArray(e?.favicons) ? e.favicons : [];
        const pick =
          favs.find((f) => typeof f === "string" && /^https:/i.test(f)) || favs.find((f) => typeof f === "string" && f);
        if (pick) reportMeta({ favicon: pick });
      });

      // --- Per-tab zoom: reapply on attach / ready / navigate (webview resets zoom) ---
      const tryApplyZoom = () => {
        const w = wvRef.current;
        if (!w || typeof w.setZoomFactor !== "function") return;
        try {
          w.setZoomFactor(zoomRef.current);
        } catch {
          /* guest not ready yet — will retry on dom-ready */
        }
      };
      wv.addEventListener("did-attach", tryApplyZoom);
      wv.addEventListener("dom-ready", tryApplyZoom);
      wv.addEventListener("did-navigate", tryApplyZoom);

      // --- In-page find: results come back via found-in-page ---
      wv.addEventListener("found-in-page", (e: any) => {
        // The <webview> DOM event carries the result in e.result (not on the event itself).
        const r = (e && e.result) ? e.result : e;
        const req = r?.requestId;
        // Only reject as stale if we actually tracked a request id and it differs.
        // (Some Electron webview builds don't return a request id from findInPage.)
        if (typeof req === "number" && findReqId.current && req !== findReqId.current) return;
        (window as any).__findDebug && ((window as any).__findDebug.found = (((window as any).__findDebug.found) || 0) + 1);
        setFindState((prev) => ({
          query: prev.query,
          index: r?.activeMatchOrdinal ?? 0,
          total: r?.matches ?? 0,
        }));
      });

      // Clear stale context when a new navigation starts, so a page action never
      // injects the previous page's text while the new page is still loading.
      wv.addEventListener("did-start-loading", () => {
        cbRef.current.onContext?.({ url: "", text: "", at: Date.now() });
      });
      // Collect a page-context snapshot by running a script in the guest page.
      // We use <webview>.executeJavaScript (not a guest preload) because sandboxed
      // webview preloads fail to load from app.asar in packaged builds. The snapshot
      // is capped at 30k chars and contains only safe, page-derived text.
      const SNAPSHOT = `(function(){var s='';try{s=window.getSelection().toString().trim();}catch(e){}var d='';try{var m=document.querySelector('meta[name="description"]');if(m)d=m.getAttribute('content')||'';}catch(e){}var t='';try{t=(document.body&&document.body.innerText)||'';t=t.slice(0,30000);}catch(e){}return {url:location.href,title:document.title||'',description:d,selection:s,text:t,at:Date.now()};})()`;
      const requestContext = () => {
        const wv2 = wvRef.current;
        if (!wv2 || typeof wv2.executeJavaScript !== "function") return;
        Promise.resolve()
          .then(() => wv2.executeJavaScript(SNAPSHOT))
          .then((ctx: any) => {
            if (ctx && ctx.url) cbRef.current.onContext?.(ctx);
          })
          .catch(() => {
            /* page not ready */
          });
      };
      wv.addEventListener("did-stop-loading", requestContext);
      wv.addEventListener("dom-ready", () => {
        requestContext();
        // SPAs render content after load — re-collect once more shortly after.
        setTimeout(requestContext, 1500);
      });
    }

    // Use the `src` attribute (not loadURL): loadURL does not spawn the webview's
    // guest process on first mount, leaving the webview blank. Setting `src`
    // reliably starts the guest. The lastReportedUrl guard prevents reload loops
    // on in-page link clicks (did-navigate updates lastReportedUrl first).
    if (lastReportedUrl.current !== url) {
      try {
        wv.src = url;
      } catch {
        /* webview not ready yet */
      }
    }
  }, [url]);

  // Expose a controlled page-script executor to the parent (Casper's agent
  // toolbelt). Only fixed app-generated scripts are ever passed in.
  useEffect(() => {
    if (!onExecutor) return;
    if (url === NEWTAB) {
      onExecutor(null);
      return;
    }
    onExecutor((code: string) => {
      const wv = wvRef.current;
      if (!wv || typeof wv.executeJavaScript !== "function") {
        return Promise.reject(new Error("page not ready"));
      }
      // The webview can still be showing the previous document while a
      // navigation is committing; only run scripts once the committed URL
      // matches the tab's URL so an action never hits the wrong page.
      try {
        const current = typeof wv.getURL === "function" ? wv.getURL() : "";
        const same = current && (current === url || current.split("#")[0] === url.split("#")[0]);
        if (!same || (typeof wv.isLoading === "function" && wv.isLoading())) {
          return Promise.reject(new Error("page is still loading — readPage or retry once it settles"));
        }
      } catch {
        return Promise.reject(new Error("page not ready"));
      }
      return wv.executeJavaScript(code);
    });
    return () => onExecutor(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  // Apply zoom when the per-tab zoomFactor prop changes.
  useEffect(() => {
    const wv = wvRef.current;
    if (!wv || typeof wv.setZoomFactor !== "function") return;
    try {
      wv.setZoomFactor(zoomFactor);
    } catch {
      /* guest not ready — re-applied on dom-ready/did-navigate */
    }
  }, [zoomFactor]);

  // Reload button — depends only on reloadNonce so link clicks / URL updates don't reload.
  useEffect(() => {
    if (reloadNonce === 0) return;
    const wv = wvRef.current;
    if (!wv || url === NEWTAB) return;
    try {
      wv.reload();
    } catch {
      /* ignore */
    }
  }, [reloadNonce]);

  // Open / close the find bar. On open, focus the input; on close, clear the selection.
  useEffect(() => {
    const wv = wvRef.current;
    if (findOpen) {
      findInputRef.current?.focus();
      findInputRef.current?.select();
    } else {
      try {
        wv?.stopFindInPage?.("clearSelection");
      } catch {
        /* ignore */
      }
      setFindState({ query: "", index: 0, total: 0 });
    }
  }, [findOpen]);

  // Close find bar when navigating to a different page (stale matches otherwise).
  useEffect(() => {
    if (!findOpen) return;
    onFindClose?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const runFind = (query: string, opts?: { forward?: boolean; findNext?: boolean }) => {
    const wv = wvRef.current;
    if (!wv || typeof wv.findInPage !== "function") return;
    const q = query.trim();
    if (!q) {
      try {
        wv.stopFindInPage("clearSelection");
      } catch {
        /* ignore */
      }
      setFindState((p) => ({ query: q, index: 0, total: 0 }));
      return;
    }
    findReqId.current = wv.findInPage(q, { forward: opts?.forward ?? true, findNext: opts?.findNext ?? false });
    (window as any).__findDebug = (window as any).__findDebug || { calls: 0, found: 0 };
    (window as any).__findDebug.calls++;
    (window as any).__findDebug.lastReq = findReqId.current;
    (window as any).__findDebug.hasFind = typeof wv.findInPage;
    setFindState((p) => ({ query: q, index: p.index, total: p.total }));
  };

  if (url === NEWTAB) {
    return <NewTabPage bookmarks={bookmarks} onNavigate={onNavigate} onAskCasper={onAskCasper} />;
  }

  return (
    <div className="relative h-full bg-background">
      <webview
        ref={wvRef}
        allowpopups={true}
        data-testid="browser-webview"
        className="w-full h-full border-0 bg-white"
        style={{ display: "inline-flex", width: "100%", height: "100%" }}
      />

      {findOpen && (
        <div className="absolute top-2 right-3 z-20 w-[min(420px,90vw)] glass-strong border border-border rounded-lg shadow-xl overflow-hidden">
          <div className="flex items-center gap-1 px-2 h-10">
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
            <input
              ref={findInputRef}
              type="text"
              data-testid="input-find"
              placeholder="Find in page"
              value={findState.query}
              onChange={(e) => runFind(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  runFind(findState.query, { findNext: true, forward: !e.shiftKey });
                } else if (e.key === "Escape") {
                  e.preventDefault();
                  onFindClose?.();
                }
              }}
              className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
              spellCheck={false}
              autoComplete="off"
            />
            <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap" data-testid="text-find-count">
              {findState.total > 0 ? `${findState.index} / ${findState.total}` : findState.query ? "0 / 0" : ""}
            </span>
            <button
              type="button"
              aria-label="Previous match"
              data-testid="button-find-prev"
              onClick={() => runFind(findState.query, { findNext: true, forward: false })}
              className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground"
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Next match"
              data-testid="button-find-next"
              onClick={() => runFind(findState.query, { findNext: true, forward: true })}
              className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="w-4 h-4" />
            </button>
            <button
              type="button"
              aria-label="Close find bar"
              data-testid="button-find-close"
              onClick={() => onFindClose?.()}
              className="p-1 rounded hover:bg-accent/60 text-muted-foreground hover:text-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      <div className="absolute top-3 left-3 z-10">
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-1.5 h-8 px-3 rounded-full glass-strong border border-border text-xs text-foreground/80 hover:text-foreground shadow-lg"
        >
          <ExternalLink className="w-3.5 h-3.5" />
          Open {hostOf(url)} externally
        </a>
      </div>
    </div>
  );
}

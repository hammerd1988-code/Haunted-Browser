import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TabBar } from "./TabBar";
import { Toolbar } from "./Toolbar";
import { BookmarksBar } from "./BookmarksBar";
import { BrowserViewport } from "./BrowserViewport";
import { ElectronViewport } from "./ElectronViewport";
import { CasperPanel } from "./CasperPanel";
import { SettingsDialog } from "./SettingsDialog";
import {
  fetchStatus,
  fetchBookmarks,
  addBookmark,
  removeBookmark,
  addHistory,
  fetchSettings,
  saveSettings,
  streamChat,
  agentStep,
  sshRun,
  type EngineSettings,
} from "@/lib/api";
import type { Tab, ChatMessage, CasperStatus } from "@/lib/ghost";
import { uid, resolveAddress, hostOf, clampZoom, ZOOM_STEP } from "@/lib/ghost";
import { runAgent, type AutonomyMode, type AgentToolbelt, type AgentAction } from "@/lib/agent";

const NEWTAB = "about:newtab";

// Whether a collected page-context snapshot still corresponds to the active tab.
// Used to reject stale snapshots from a previous page after navigation or a
// tab switch (the webview is unmounted on New Tab, so no did-start-loading
// clear fires there — this effect is the backstop).
function samePageUrl(ctxUrl?: string, currentUrl?: string): boolean {
  if (!ctxUrl || !currentUrl || currentUrl === NEWTAB) return false;
  return ctxUrl === currentUrl || ctxUrl.split("#")[0] === currentUrl.split("#")[0];
}

function makeTab(url = NEWTAB): Tab {
  return { id: uid(), title: "New Tab", url, history: [], future: [] };
}

export function BrowserApp() {
  const queryClient = useQueryClient();
  const [tabs, setTabs] = useState<Tab[]>([makeTab()]);
  const [activeId, setActiveId] = useState(() => tabs[0].id);
  const [casperOpen, setCasperOpen] = useState(true);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streaming, setStreaming] = useState(false);
  const [status, setStatus] = useState<CasperStatus>({ connected: false, baseUrl: "", models: [], demo: true });
  const abortRef = useRef<AbortController | null>(null);
  const pageContextRef = useRef<PageContext | null>(null);
  const [hasPageContext, setHasPageContext] = useState(false);
  const [agentMode, setAgentMode] = useState<AutonomyMode>("supervised");
  const [agentRunning, setAgentRunning] = useState(false);
  const [pendingApproval, setPendingApproval] = useState<AgentAction | null>(null);
  const approvalRef = useRef<((ok: boolean) => void) | null>(null);
  const agentAbortRef = useRef<AbortController | null>(null);
  const pageExecutorRef = useRef<((code: string) => Promise<unknown>) | null>(null);
  const isElectron = typeof window !== "undefined" && Boolean((window as any).casperElectron?.isElectron);

  const bookmarksQuery = useQuery({ queryKey: ["/api/bookmarks"], queryFn: fetchBookmarks });
  const settingsQuery = useQuery({ queryKey: ["/api/settings"], queryFn: fetchSettings });
  const bookmarks = bookmarksQuery.data ?? [];

  const activeTab = tabs.find((t) => t.id === activeId) ?? tabs[0];
  const currentUrl = activeTab.url;
  const isBookmarked = bookmarks.some((b) => b.url === currentUrl);
  const model = settingsQuery.data?.model || status.models[0] || "";

  const sshSettings = useMemo(
    () => ({
      sshHost: settingsQuery.data?.sshHost ?? "",
      sshUser: settingsQuery.data?.sshUser ?? "",
      sshPort: settingsQuery.data?.sshPort ?? "22",
      sshKeyPath: settingsQuery.data?.sshKeyPath ?? "",
      serverGuiUrl: settingsQuery.data?.serverGuiUrl ?? "",
    }),
    [settingsQuery.data],
  );

  // Backstop clear: whenever the active tab or its URL changes (including to
  // New Tab, where the webview is unmounted and no navigation clear fires),
  // drop any page context so a page action never injects a stale page's text.
  useEffect(() => {
    pageContextRef.current = null;
    setHasPageContext(false);
  }, [activeId, currentUrl]);

  const refreshStatus = useCallback(async (url?: string, opts?: { discover?: boolean }) => {
    try {
      const s = await fetchStatus(url, opts);
      setStatus(s);
      return s;
    } catch {
      const fallback: CasperStatus = { connected: false, baseUrl: "", models: [], demo: true };
      setStatus(fallback);
      return fallback;
    }
  }, []);

  useEffect(() => {
    refreshStatus();
  }, [refreshStatus, settingsQuery.data?.ollamaUrl, settingsQuery.data?.apiKey]);

  // Flip out of demo mode automatically once LM Studio comes online.
  useEffect(() => {
    if (status.connected) return;
    const timer = window.setInterval(() => {
      refreshStatus();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [status.connected, refreshStatus]);

  useEffect(() => {
    const onFocus = () => {
      refreshStatus();
    };
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [refreshStatus]);

  // ---- tab ops ----
  const navigate = useCallback(
    (input: string, opts?: { pushHistory?: boolean }) => {
      const push = opts?.pushHistory ?? true;
      const target = resolveAddress(input);
      setTabs((prev) =>
        prev.map((t) => {
          if (t.id !== activeId) return t;
          const history = push && t.url !== target ? [...t.history, t.url] : t.history;
          return {
            ...t,
            url: target,
            title: target === NEWTAB ? "New Tab" : hostOf(target),
            favicon: target === NEWTAB ? undefined : t.favicon,
            loading: target !== NEWTAB,
            history,
            future: [],
          };
        }),
      );
      if (target !== NEWTAB) {
        addHistory({ title: hostOf(target), url: target }).catch(() => {});
      }
    },
    [activeId],
  );

  const newTab = useCallback(() => {
    const t = makeTab();
    setTabs((prev) => [...prev, t]);
    setActiveId(t.id);
  }, []);

  const closeTab = useCallback(
    (id: string) => {
      setTabs((prev) => {
        const idx = prev.findIndex((t) => t.id === id);
        if (idx === -1) return prev;
        const next = prev.filter((t) => t.id !== id);
        if (next.length === 0) {
          const fresh = makeTab();
          setActiveId(fresh.id);
          return [fresh];
        }
        // Only move focus when the closed tab was the active one; closing a
        // background tab must not steal focus from the page being viewed.
        setActiveId((cur) => (cur === id ? (prev[idx + 1] ?? prev[idx - 1]).id : cur));
        return next;
      });
    },
    [],
  );

  const goBack = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId || t.history.length === 0) return t;
        const future = [t.url, ...t.future];
        const history = t.history.slice(0, -1);
        const url = t.history[t.history.length - 1];
        return { ...t, url, history, future, title: url === NEWTAB ? "New Tab" : hostOf(url) };
      }),
    );
  }, [activeId]);

  const goForward = useCallback(() => {
    setTabs((prev) =>
      prev.map((t) => {
        if (t.id !== activeId || t.future.length === 0) return t;
        const history = [...t.history, t.url];
        const future = t.future.slice(1);
        const url = t.future[0];
        return { ...t, url, history, future, title: url === NEWTAB ? "New Tab" : hostOf(url) };
      }),
    );
  }, [activeId]);

  const [reloadNonce, setReloadNonce] = useState(0);
  const reload = useCallback(() => {
    // force iframe reload by re-mounting the viewport via key
    setReloadNonce((n) => n + 1);
  }, []);

  const [findOpen, setFindOpen] = useState(false);

  // ---- tab meta from the live page (title / favicon / loading) ----
  const updateTabMeta = useCallback(
    (id: string, meta: { title?: string; favicon?: string; loading?: boolean }) => {
      setTabs((prev) =>
        prev.map((t) => (t.id === id ? { ...t, ...meta } : t)),
      );
    },
    [],
  );

  // ---- per-tab zoom (Ctrl+= / - / 0) ----
  const setZoom = useCallback(
    (next: number) => {
      const clamped = clampZoom(next);
      setTabs((prev) =>
        prev.map((t) => (t.id === activeId ? { ...t, zoomFactor: clamped } : t)),
      );
    },
    [activeId],
  );
  const zoomIn = useCallback(() => setZoom((activeTab.zoomFactor ?? 1) + ZOOM_STEP), [setZoom, activeTab.zoomFactor]);
  const zoomOut = useCallback(() => setZoom((activeTab.zoomFactor ?? 1) - ZOOM_STEP), [setZoom, activeTab.zoomFactor]);
  const zoomReset = useCallback(() => setZoom(1), [setZoom]);

  // ---- tab cycling (Ctrl+Tab / Ctrl+Shift+Tab) ----
  const cycleTab = useCallback(
    (dir: 1 | -1) => {
      setTabs((prev) => {
        if (prev.length < 2) return prev;
        const idx = prev.findIndex((t) => t.id === activeId);
        const nextIdx = (idx + dir + prev.length) % prev.length;
        setActiveId(prev[nextIdx].id);
        return prev;
      });
    },
    [activeId],
  );

  const focusAddress = useCallback(() => {
    const el = document.querySelector<HTMLInputElement>('[data-testid="input-address"]');
    el?.focus();
    el?.select();
  }, []);

  // Central dispatch for browser shortcuts. Reached two ways: (1) when the
  // <webview> page has focus, the Electron main process intercepts the key via
  // before-input-event and forwards a `casper:shortcut` IPC; (2) when the shell
  // chrome has focus, a plain window keydown below calls the same dispatcher.
  const dispatchShortcut = useCallback(
    (action: string) => {
      switch (action) {
        case "new-tab": newTab(); break;
        case "close-tab": closeTab(activeId); break;
        case "focus-address": focusAddress(); break;
        case "reload": reload(); break;
        case "find": setFindOpen(true); break;
        case "next-tab": cycleTab(1); break;
        case "prev-tab": cycleTab(-1); break;
        case "back": goBack(); break;
        case "forward": goForward(); break;
        case "zoom-in": zoomIn(); break;
        case "zoom-out": zoomOut(); break;
        case "zoom-reset": zoomReset(); break;
      }
    },
    [newTab, closeTab, activeId, focusAddress, reload, cycleTab, goBack, goForward, zoomIn, zoomOut, zoomReset],
  );

  // (1) Electron: shortcuts intercepted from the focused webview page.
  useEffect(() => {
    const bridge = (window as any).casperElectron;
    if (!bridge?.onShortcut) return;
    const off = bridge.onShortcut((e: { action: string }) => dispatchShortcut(e.action));
    return () => off?.();
  }, [dispatchShortcut]);

  // (2) Shell-focused shortcuts (works in web + Electron when chrome has focus).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Escape closes the find bar (no modifier needed).
      if (e.key === "Escape" && findOpen) {
        e.preventDefault();
        setFindOpen(false);
        return;
      }
      // Otherwise only act on browser-chrome combos (Ctrl/Cmd or Alt modifiers),
      // so normal typing in the address bar, Casper composer, or page inputs
      // is never hijacked.
      const command = e.ctrlKey || e.metaKey;
      if (!command && !e.altKey) return;
      const shift = e.shiftKey;
      let action: string | null = null;
      const k = e.key;
      if (command && k === "t" && !shift) action = "new-tab";
      else if (command && k === "w" && !shift) action = "close-tab";
      else if (command && k === "l" && !shift) action = "focus-address";
      else if (command && k === "r" && !shift) action = "reload";
      else if (command && k === "f" && !shift) action = "find";
      else if (command && shift && k === "Tab") action = "prev-tab";
      else if (command && !shift && k === "Tab") action = "next-tab";
      else if (e.altKey && !shift && k === "ArrowLeft") action = "back";
      else if (e.altKey && !shift && k === "ArrowRight") action = "forward";
      else if (command && (k === "+" || k === "=")) action = "zoom-in";
      else if (command && k === "-") action = "zoom-out";
      else if (command && k === "0") action = "zoom-reset";
      if (!action) return;
      e.preventDefault();
      if (action === "find" && findOpen) setFindOpen(false);
      else dispatchShortcut(action);
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [dispatchShortcut, findOpen]);

  // ---- casper ----
  const sendToCasper = useCallback(
    async (text: string, opts: { injectPage?: boolean } = {}) => {
      if (streaming) return;
      const userMsg: ChatMessage = { id: uid(), role: "user", content: text };
      const asstId = uid();

      // In Electron, inject the active page's text so Casper can reason about what
      // the user is actually looking at (Summarize / Explain / Key points, etc.).
      const ctx = pageContextRef.current;
      const pageKeywords = /(summar|explain|this page|current page|fix site|fix this|about this|describe|key points|extract|tldr)/i;
      const shouldInject = opts.injectPage || pageKeywords.test(text);
      // Only inject if the stored snapshot is fresh — its URL must still match the
      // active tab (rejects stale snapshots left over after navigation/tab switch).
      const ctxFresh = !!(ctx?.text && ctx.text.trim() && samePageUrl(ctx.url, currentUrl));
      let contextMessages: ChatMessage[] = [];
      let finalText = text;
      if (ctxFresh && shouldInject) {
        const pageText = ctx!.text!;
        const snippet = pageText.slice(0, 12000);
        const selection = ctx!.selection?.trim()
          ? `\n\nThe user has selected this text on the page — focus on it if relevant:\n"${ctx!.selection!.slice(0, 1500)}"`
          : "";
        contextMessages = [
          {
            id: uid(),
            role: "system",
            content: `You are Casper, helping the user with the web page they are currently viewing: ${ctx!.url}${ctx!.title ? ` ("${ctx!.title}")` : ""}.\nUse the page text below to answer their request accurately. Quote or reference specific parts when useful.${selection}\n\nPage text:\n${snippet}`,
          },
        ];
        finalText = `${text}\n\n(Answer using the provided page text excerpt when relevant.)`;
      } else if (opts.injectPage && !ctxFresh) {
        // A page action was requested but there's no fresh page text — either the
        // page hasn't loaded readable text yet, the active tab is the New Tab page,
        // or we're in the web preview whose iframe can't expose page contents.
        // Tell the user clearly instead of injecting a stale page.
        finalText = `${text}\n\n(Note: I can't read the active page's text here. In the Casper desktop app I read the page you're viewing directly — install it to use this with live pages.)`;
      }
      const userMsgFinal = { ...userMsg, content: finalText };
      const apiMessages = [...messages, ...contextMessages, userMsgFinal];
      setMessages((prev) => [...prev, userMsg, { id: asstId, role: "assistant", content: "", pending: true }]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      await streamChat(apiMessages, model, {
        signal: ctrl.signal,
        onToken: (token) =>
          setMessages((prev) =>
            prev.map((m) => (m.id === asstId ? { ...m, content: m.content + token, pending: false } : m)),
          ),
        onDemo: (demo) =>
          setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, demo } : m))),
        onError: (err) =>
          setMessages((prev) =>
            prev.map((m) =>
              m.id === asstId ? { ...m, content: (m.content || "") + `\n\n⚠️ ${err}`, pending: false } : m,
            ),
          ),
        onDone: () => {
          setMessages((prev) => prev.map((m) => (m.id === asstId ? { ...m, pending: false } : m)));
          setStreaming(false);
        },
      });
    },
    [messages, model, streaming, currentUrl],
  );

  // ---- casper agent mode ----
  // Latest-value refs so the agent toolbelt always sees current tab state even
  // as the run mutates it (open/close/switch happen mid-run).
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;

  const PAGE_SNAPSHOT = `(function(){var t='';try{t=(document.body&&document.body.innerText)||'';}catch(e){}return {url:location.href,title:document.title||'',text:t.slice(0,30000)};})()`;

  const runAgentGoal = useCallback(
    async (goal: string) => {
      if (agentRunning || streaming) return;
      setMessages((prev) => [...prev, { id: uid(), role: "user", content: goal }]);
      setAgentRunning(true);
      const ctrl = new AbortController();
      agentAbortRef.current = ctrl;

      const toolbelt: AgentToolbelt = {
        listTabs: () =>
          tabsRef.current.map((t, i) => ({
            index: i,
            title: t.title,
            url: t.url,
            active: t.id === activeIdRef.current,
          })),
        openTab: (url: string) => {
          const t = makeTab(resolveAddress(url));
          setTabs((prev) => [...prev, t]);
          setActiveId(t.id);
          addHistory({ title: hostOf(t.url), url: t.url }).catch(() => {});
        },
        closeTab: (index: number) => {
          const t = tabsRef.current[index];
          if (!t) return `ERROR: no tab at index ${index}.`;
          closeTab(t.id);
        },
        switchTab: (index: number) => {
          const t = tabsRef.current[index];
          if (!t) return `ERROR: no tab at index ${index}.`;
          setActiveId(t.id);
        },
        navigate: (url: string) => navigateRef.current(url),
        readPage: async () => {
          const exec = pageExecutorRef.current;
          if (!exec) return { error: "no live page (New Tab or web preview) — navigate somewhere first." };
          try {
            const r = (await exec(PAGE_SNAPSHOT)) as { url?: string; title?: string; text?: string };
            return { url: r?.url || "", title: r?.title || "", text: r?.text || "" };
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
        get executeInPage() {
          return pageExecutorRef.current;
        },
        sshRun: (command: string) => sshRun(command),
        serverGuiUrl: settingsQuery.data?.serverGuiUrl || "",
      };

      try {
        await runAgent({
          goal,
          mode: agentMode,
          toolbelt,
          signal: ctrl.signal,
          callAgentStep: (msgs) => agentStep(msgs, model, ctrl.signal),
          requestApproval: (action) =>
            new Promise<boolean>((resolve) => {
              setPendingApproval(action);
              approvalRef.current = (ok: boolean) => {
                setPendingApproval(null);
                approvalRef.current = null;
                resolve(ok);
              };
            }),
          onEvent: (e) => {
            if (e.type === "final") {
              setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: e.text }]);
            } else {
              const kind =
                e.type === "thought"
                  ? "thought"
                  : e.type === "action"
                    ? "action"
                    : e.type === "blocked" || e.type === "error"
                      ? "blocked"
                      : "observation";
              setMessages((prev) => [...prev, { id: uid(), role: "assistant", content: e.text, kind }]);
            }
          },
        });
      } finally {
        setAgentRunning(false);
        setPendingApproval(null);
        approvalRef.current = null;
        agentAbortRef.current = null;
      }
    },
    [agentRunning, streaming, agentMode, model, closeTab, settingsQuery.data?.serverGuiUrl],
  );

  const resolveApproval = useCallback((ok: boolean) => {
    approvalRef.current?.(ok);
  }, []);

  const stopAgent = useCallback(() => {
    agentAbortRef.current?.abort();
    approvalRef.current?.(false);
  }, []);

  const askCasper = useCallback(
    (prompt: string) => {
      setCasperOpen(true);
      sendToCasper(prompt);
    },
    [sendToCasper],
  );

  // ---- bookmarks ----
  const toggleBookmark = useCallback(async () => {
    if (currentUrl === NEWTAB) return;
    if (isBookmarked) {
      const bm = bookmarks.find((b) => b.url === currentUrl);
      if (bm) {
        await removeBookmark(bm.id);
        queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
      }
    } else {
      await addBookmark({ title: hostOf(currentUrl), url: currentUrl });
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    }
  }, [currentUrl, isBookmarked, bookmarks, queryClient]);

  const removeBookmarkById = useCallback(
    async (id: number) => {
      await removeBookmark(id);
      queryClient.invalidateQueries({ queryKey: ["/api/bookmarks"] });
    },
    [queryClient],
  );

  const openBookmark = useCallback((url: string) => navigate(url), [navigate]);

  const handleSaveSettings = useCallback(
    async (settings: EngineSettings) => {
      await saveSettings(settings);
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      await refreshStatus();
    },
    [queryClient, refreshStatus],
  );

  const testConnection = useCallback(
    async (url: string, opts?: { discover?: boolean }) => {
      return refreshStatus(url, opts);
    },
    [refreshStatus],
  );

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden text-foreground">
      <TabBar tabs={tabs} activeId={activeId} onSelect={setActiveId} onClose={closeTab} onNew={newTab} />
      <Toolbar
        url={currentUrl}
        canGoBack={activeTab.history.length > 0}
        canGoForward={activeTab.future.length > 0}
        onBack={goBack}
        onForward={goForward}
        onReload={reload}
        onHome={() => navigate(NEWTAB, { pushHistory: true })}
        onNavigate={(v) => navigate(v)}
        onToggleCasper={() => setCasperOpen((v) => !v)}
        casperOpen={casperOpen}
        onOpenSettings={() => setSettingsOpen(true)}
        onToggleBookmark={toggleBookmark}
        isBookmarked={isBookmarked}
      />
      <BookmarksBar bookmarks={bookmarks} onOpen={openBookmark} onRemove={removeBookmarkById} />

      <div className="flex flex-1 min-h-0">
        <main className="flex-1 min-w-0 relative" data-reload={reloadNonce}>
          {isElectron ? (
            <ElectronViewport
              url={currentUrl}
              bookmarks={bookmarks}
              onNavigate={(v) => navigate(v)}
              onAskCasper={askCasper}
              reloadNonce={reloadNonce}
              tabId={activeId}
              zoomFactor={activeTab.zoomFactor ?? 1}
              findOpen={findOpen}
              onFindClose={() => setFindOpen(false)}
              onContext={(ctx) => {
                // Ignore stale snapshots from a previous page: only accept context
                // whose URL matches the active tab (allowing in-page hash changes).
                const samePage =
                  !ctx.url ||
                  ctx.url === currentUrl ||
                  ctx.url.split("#")[0] === currentUrl.split("#")[0];
                if (!samePage) return;
                if (!ctx.text || !ctx.text.trim()) {
                  pageContextRef.current = null;
                  setHasPageContext(false);
                  return;
                }
                pageContextRef.current = ctx;
                setHasPageContext(true);
              }}
              onTabMeta={(meta) => updateTabMeta(activeId, meta)}
              onExecutor={(fn) => {
                pageExecutorRef.current = fn;
              }}
            />
          ) : (
            <BrowserViewport
              key={reloadNonce + "-" + currentUrl}
              url={currentUrl}
              bookmarks={bookmarks}
              onNavigate={(v) => navigate(v)}
              onAskCasper={askCasper}
            />
          )}
        </main>

        {casperOpen && (
          <div className="w-full sm:w-[380px] shrink-0 h-full">
            <CasperPanel
              status={status}
              messages={messages}
              streaming={streaming}
              onSend={sendToCasper}
              currentUrl={currentUrl}
              pageContextAvailable={hasPageContext}
              onClose={() => setCasperOpen(false)}
              onOpenSettings={() => setSettingsOpen(true)}
              onRefreshStatus={() => refreshStatus()}
              agentMode={agentMode}
              onAgentModeChange={setAgentMode}
              agentRunning={agentRunning}
              onRunAgent={runAgentGoal}
              onStopAgent={stopAgent}
              pendingApproval={pendingApproval}
              onApprove={resolveApproval}
            />
          </div>
        )}
      </div>

      <SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        status={status}
        engine={settingsQuery.data?.engine ?? "lmstudio"}
        ollamaUrl={settingsQuery.data?.ollamaUrl ?? "http://127.0.0.1:1234"}
        customBaseUrl={settingsQuery.data?.customBaseUrl ?? ""}
        model={model}
        apiKey={settingsQuery.data?.apiKey ?? ""}
        ssh={sshSettings}
        onSave={handleSaveSettings}
        onTest={testConnection}
      />
    </div>
  );
}

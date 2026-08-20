import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Send, X, Settings as SettingsIcon, Sparkles, BookOpen, Wrench, LifeBuoy, RefreshCw, ListChecks, FileText } from "lucide-react";
import type { ChatMessage, CasperStatus } from "@/lib/ghost";
import { GhostMascot, cx } from "@/lib/ghost";

export function CasperPanel({
  status,
  messages,
  streaming,
  onSend,
  currentUrl,
  pageContextAvailable,
  onClose,
  onOpenSettings,
  onRefreshStatus,
}: {
  status: CasperStatus;
  messages: ChatMessage[];
  streaming: boolean;
  onSend: (text: string, opts?: { injectPage?: boolean }) => void;
  currentUrl: string;
  pageContextAvailable: boolean;
  onClose: () => void;
  onOpenSettings: () => void;
  onRefreshStatus: () => void;
}) {
  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const host = currentUrl === "about:newtab" ? null : (() => {
    try {
      return new URL(currentUrl).hostname.replace(/^www\./, "");
    } catch {
      return null;
    }
  })();

  const quickActions: { label: string; icon: typeof BookOpen; prompt: string; inject: boolean }[] =
    pageContextAvailable
      ? [
          { label: "Summarize page", icon: BookOpen, prompt: "Summarize this page — what is it about and what are the main points?", inject: true },
          { label: "Explain page", icon: Sparkles, prompt: "Explain this page in simple terms for someone unfamiliar with the topic.", inject: true },
          { label: "Key points", icon: ListChecks, prompt: "Extract the key points from this page as a short bullet list.", inject: true },
          { label: "Help", icon: LifeBuoy, prompt: "What else can you do with the page I'm viewing?", inject: false },
        ]
      : [
          { label: "What can you do", icon: Sparkles, prompt: "What can you help me with while browsing?", inject: false },
          { label: "Connect model", icon: Wrench, prompt: "How do I connect you to my local LM Studio so you leave demo mode and answer with a real model?", inject: false },
          { label: "About Casper", icon: BookOpen, prompt: "Tell me about yourself, Casper.", inject: false },
        ];

  return (
    <aside className="flex flex-col h-full w-full bg-sidebar/50 glass border-l border-border">
      {/* header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <GhostMascot size={32} glow />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="font-[family-name:var(--font-display)] font-semibold text-sm">Casper</h2>
            <StatusBadge status={status} />
          </div>
          <p className="text-xs text-muted-foreground truncate">
            {status.connected ? status.models.length ? `${status.models.length} models · ${shortModel(status)}` : "Connected — load a model in LM Studio" : "Demo mode — start LM Studio's Developer server"}
          </p>
        </div>
        <button type="button" aria-label="Refresh connection" onClick={onRefreshStatus} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors">
          <RefreshCw className="w-4 h-4" />
        </button>
        <button type="button" aria-label="Settings" onClick={onOpenSettings} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors">
          <SettingsIcon className="w-4 h-4" />
        </button>
        <button type="button" aria-label="Close panel" onClick={onClose} className="p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {!status.connected && (
        <div className="px-4 py-2 border-b border-border bg-amber-500/10 text-[11px] text-amber-200/90">
          {status.hint || "Start LM Studio → Developer → local server on http://127.0.0.1:1234, load a chat model, then hit refresh."}
          <button
            type="button"
            onClick={onOpenSettings}
            className="ml-1 underline underline-offset-2 hover:text-amber-100"
          >
            Open settings
          </button>
        </div>
      )}

      {/* page-context indicator */}
      {pageContextAvailable && (
        <div className="px-4 pt-2 flex items-center gap-1.5 text-[11px] text-primary/80">
          <FileText className="w-3 h-3" />
          Reading {host ?? "this page"}
          <span className="text-muted-foreground">· context ready</span>
        </div>
      )}

      {/* messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto ghost-scroll px-4 py-4 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center text-center gap-3 pt-8">
            <GhostMascot size={56} floating />
            <p className="text-sm text-muted-foreground max-w-[240px]">
              Boo! I'm Casper, your ghost in the browser. Ask me anything, or pick a quick action below.
            </p>
          </div>
        )}
        {messages.map((m) => (
          <MessageBubble key={m.id} message={m} />
        ))}
        {streaming && (
          <div className="flex items-center gap-2 pl-1">
            <GhostMascot size={20} />
            <div className="flex items-center gap-1">
              <span className="ghost-dot w-1.5 h-1.5 rounded-full bg-primary" style={{ animationDelay: "0ms" }} />
              <span className="ghost-dot w-1.5 h-1.5 rounded-full bg-primary" style={{ animationDelay: "160ms" }} />
              <span className="ghost-dot w-1.5 h-1.5 rounded-full bg-primary" style={{ animationDelay: "320ms" }} />
            </div>
          </div>
        )}
      </div>

      {/* quick actions */}
      <div className="px-3 py-2 border-t border-border flex flex-wrap items-center gap-1.5 ghost-scroll">
        {quickActions.map((a) => (
          <button
            key={a.label}
            type="button"
            onClick={() => onSend(a.prompt, { injectPage: a.inject })}
            className={cx(
              "shrink-0 flex items-center gap-1.5 h-8 px-2.5 rounded-full text-xs transition-colors",
              a.inject
                ? "bg-primary/15 text-primary hover:bg-primary/25"
                : "bg-accent/60 text-muted-foreground hover:text-foreground hover:bg-accent",
            )}
          >
            <a.icon className="w-3.5 h-3.5" />
            {a.label}
          </button>
        ))}
      </div>

      {/* input */}
      <form
        className="p-3 border-t border-border"
        onSubmit={(e) => {
          e.preventDefault();
          if (input.trim() && !streaming) {
            onSend(input.trim());
            setInput("");
          }
        }}
      >
        <div className="flex items-end gap-2 rounded-2xl bg-background/70 border border-border focus-within:border-primary/50 focus-within:ghost-glow transition-all p-2">
          <textarea
            value={input}
            data-testid="input-casper"
            placeholder="Ask Casper…"
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (input.trim() && !streaming) {
                  onSend(input.trim());
                  setInput("");
                }
              }
            }}
            rows={1}
            className="flex-1 bg-transparent outline-none resize-none text-sm px-2 py-1.5 max-h-32 placeholder:text-muted-foreground ghost-scroll"
          />
          <button
            type="submit"
            aria-label="Send"
            disabled={!input.trim() || streaming}
            className="shrink-0 w-9 h-9 rounded-xl bg-primary text-primary-foreground flex items-center justify-center disabled:opacity-40 hover:opacity-90 transition-opacity"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
      </form>
    </aside>
  );
}

function StatusBadge({ status }: { status: CasperStatus }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium",
        status.connected
          ? "bg-primary/15 text-primary"
          : "bg-amber-500/15 text-amber-500",
      )}
    >
      <span className={cx("w-1.5 h-1.5 rounded-full", status.connected ? "bg-primary animate-ghost-pulse" : "bg-amber-500")} />
      {status.connected ? "Live" : "Demo"}
    </span>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <div className={cx("flex gap-2.5", isUser ? "flex-row-reverse" : "flex-row")}>
      {!isUser && <GhostMascot size={22} className="mt-0.5 shrink-0" />}
      <div
        className={cx(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm leading-relaxed",
          isUser
            ? "bg-primary text-primary-foreground rounded-br-sm"
            : "glass border border-border rounded-bl-sm",
        )}
      >
        <FormattedContent text={message.content} />
        {message.demo && (
          <span className="block mt-1.5 text-[10px] text-amber-500/80">demo reply · connect a model for live answers</span>
        )}
      </div>
    </div>
  );
}

function FormattedContent({ text }: { text: string }) {
  // minimal markdown: **bold**, `code`, and line breaks
  const lines = text.split("\n");
  return (
    <div className="space-y-1.5 whitespace-pre-wrap break-words">
      {lines.map((line, i) => (
        <span key={i} className="contents">
          {renderInline(line)}
          {i < lines.length - 1 ? <br /> : null}
        </span>
      ))}
    </div>
  );
}

function renderInline(text: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = regex.exec(text))) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    const token = m[0];
    if (token.startsWith("**")) {
      parts.push(<strong key={key++}>{token.slice(2, -2)}</strong>);
    } else {
      parts.push(
        <code key={key++} className="px-1 py-0.5 rounded bg-accent/60 text-[0.85em] font-mono">
          {token.slice(1, -1)}
        </code>,
      );
    }
    last = regex.lastIndex;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

function shortModel(status: CasperStatus): string {
  const m = status.models[0] || "";
  return m.length > 24 ? m.slice(0, 22) + "…" : m;
}

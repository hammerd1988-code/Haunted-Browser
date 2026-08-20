import { useRef } from "react";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  ArrowRight,
  RotateCw,
  Home,
  Search,
  Star,
  Ghost,
  Settings as SettingsIcon,
  Lock,
} from "lucide-react";
import { cx } from "@/lib/ghost";

export function Toolbar({
  url,
  canGoBack,
  canGoForward,
  onBack,
  onForward,
  onReload,
  onHome,
  onNavigate,
  onToggleCasper,
  casperOpen,
  onOpenSettings,
  onToggleBookmark,
  isBookmarked,
}: {
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  onBack: () => void;
  onForward: () => void;
  onReload: () => void;
  onHome: () => void;
  onNavigate: (input: string) => void;
  onToggleCasper: () => void;
  casperOpen: boolean;
  onOpenSettings: () => void;
  onToggleBookmark: () => void;
  isBookmarked: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const isSecure = url.startsWith("https://");
  const isNewTab = url === "about:newtab";

  return (
    <div className="flex items-center gap-1.5 px-2 py-2 bg-sidebar/40 glass border-b border-border">
      <NavButton onClick={onBack} disabled={!canGoBack} label="Back">
        <ArrowLeft className="w-[18px] h-[18px]" />
      </NavButton>
      <NavButton onClick={onForward} disabled={!canGoForward} label="Forward">
        <ArrowRight className="w-[18px] h-[18px]" />
      </NavButton>
      <NavButton onClick={onReload} disabled={isNewTab} label="Reload">
        <RotateCw className="w-[18px] h-[18px]" />
      </NavButton>
      <NavButton onClick={onHome} label="Home">
        <Home className="w-[18px] h-[18px]" />
      </NavButton>

      <form
        className="flex-1 flex items-center"
        onSubmit={(e) => {
          e.preventDefault();
          const value = inputRef.current?.value ?? "";
          onNavigate(value);
          inputRef.current?.blur();
        }}
      >
        <div className="flex-1 flex items-center gap-2 h-10 px-3 rounded-full bg-background/70 border border-border focus-within:border-primary/60 focus-within:ghost-glow transition-all">
          {isNewTab ? (
            <Search className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : isSecure ? (
            <Lock className="w-3.5 h-3.5 text-primary shrink-0" />
          ) : null}
          <input
            key={isNewTab ? "newtab" : url}
            ref={inputRef}
            type="text"
            defaultValue={isNewTab ? "" : url}
            data-testid="input-address"
            placeholder="Search DuckDuckGo or type a URL"
            onFocus={(e) => e.currentTarget.select()}
            className="flex-1 bg-transparent outline-none text-sm placeholder:text-muted-foreground"
            spellCheck={false}
            autoComplete="off"
          />
        </div>
      </form>

      <NavButton onClick={onToggleBookmark} label={isBookmarked ? "Remove bookmark" : "Add bookmark"} active={isBookmarked}>
        <Star className="w-[18px] h-[18px]" fill={isBookmarked ? "currentColor" : "none"} />
      </NavButton>
      <NavButton onClick={onOpenSettings} label="Settings">
        <SettingsIcon className="w-[18px] h-[18px]" />
      </NavButton>
      <button
        type="button"
        data-testid="button-casper"
        aria-label="Toggle Casper assistant"
        onClick={onToggleCasper}
        className={cx(
          "shrink-0 flex items-center gap-2 h-10 px-3 rounded-full border transition-all",
          casperOpen
            ? "bg-primary text-primary-foreground border-primary ghost-glow"
            : "bg-primary/10 text-primary border-primary/30 hover:bg-primary/20",
        )}
      >
        <Ghost className="w-[18px] h-[18px]" />
        <span className="text-sm font-medium hidden sm:inline">Casper</span>
      </button>
    </div>
  );
}

function NavButton({
  children,
  onClick,
  disabled,
  label,
  active,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  label: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={cx(
        "shrink-0 p-2 rounded-lg transition-colors disabled:opacity-30 disabled:cursor-default",
        active
          ? "text-primary"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/60",
      )}
    >
      {children}
    </button>
  );
}

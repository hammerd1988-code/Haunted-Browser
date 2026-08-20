import { X, Plus, Loader2 } from "lucide-react";
import type { Tab } from "@/lib/ghost";
import { cx, faviconFor, prettyTitle } from "@/lib/ghost";

export function TabBar({
  tabs,
  activeId,
  onSelect,
  onClose,
  onNew,
}: {
  tabs: Tab[];
  activeId: string;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
}) {
  return (
    <div className="flex items-center gap-1 px-2 pt-2 bg-sidebar/60 glass-strong border-b border-border">
      <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto ghost-scroll">
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          const isNewTab = tab.url === "about:newtab";
          return (
            <div
              key={tab.id}
              data-testid={`tab-${tab.id}`}
              role="tab"
              aria-selected={active}
              onClick={() => onSelect(tab.id)}
              onAuxClick={(e) => {
                if (e.button === 1) onClose(tab.id);
              }}
              className={cx(
                "group relative flex items-center gap-2 max-w-[200px] min-w-[120px] h-9 px-3 rounded-t-lg cursor-default text-sm transition-colors shrink-0",
                active
                  ? "bg-background text-foreground"
                  : "text-muted-foreground hover:bg-accent/50 hover:text-foreground",
              )}
            >
              <span className="absolute inset-x-2 -bottom-px h-px bg-border" aria-hidden />
              {active && (
                <span className="absolute inset-x-2 -bottom-px h-px bg-primary ghost-glow" aria-hidden />
              )}
              {isNewTab ? (
                <span className="w-4 h-4 rounded-full bg-gradient-to-b from-primary/80 to-primary/40 shrink-0" />
              ) : tab.loading ? (
                <Loader2 className="w-4 h-4 shrink-0 animate-spin text-muted-foreground" />
              ) : (
                <img
                  src={tab.favicon || faviconFor(tab.url)}
                  alt=""
                  className="w-4 h-4 rounded shrink-0"
                  onError={(e) => {
                    (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
                  }}
                />
              )}
              <span className="truncate flex-1">{isNewTab ? "New Tab" : tab.title || prettyTitle(tab.url)}</span>
              <button
                type="button"
                aria-label="Close tab"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(tab.id);
                }}
                className="opacity-0 group-hover:opacity-100 hover:bg-destructive/15 rounded p-0.5 transition-opacity"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
      <button
        type="button"
        aria-label="New tab"
        onClick={onNew}
        className="shrink-0 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/60 transition-colors"
      >
        <Plus className="w-4 h-4" />
      </button>
    </div>
  );
}

import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, AlertTriangle, Loader2, Ghost, Download, RefreshCw } from "lucide-react";
import type { CasperStatus } from "@/lib/ghost";
import { GhostMascot } from "@/lib/ghost";

export function SettingsDialog({
  open,
  onOpenChange,
  status,
  ollamaUrl,
  model,
  apiKey,
  onSave,
  onTest,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: CasperStatus;
  ollamaUrl: string;
  model: string;
  apiKey: string;
  onSave: (ollamaUrl: string, model: string, apiKey: string) => void;
  onTest: (url: string, opts?: { discover?: boolean }) => Promise<CasperStatus | void> | void;
}) {
  const [draftUrl, setDraftUrl] = useState(ollamaUrl);
  const [draftModel, setDraftModel] = useState(model);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [testing, setTesting] = useState(false);
  const [update, setUpdate] = useState<{ type: string; version?: string; message?: string; percent?: number } | null>(null);

  const isElectron = typeof window !== "undefined" && Boolean((window as any).casperElectron?.isElectron);

  useEffect(() => {
    if (open) {
      setDraftUrl(ollamaUrl);
      setDraftModel(model);
      setDraftKey(apiKey);
    }
  }, [open, ollamaUrl, model, apiKey]);

  useEffect(() => {
    const bridge = (window as any).casperElectron;
    if (!bridge?.updates?.onEvent) return;
    const off = bridge.updates.onEvent((e: any) => setUpdate(e));
    return () => off && off();
  }, []);

  const models = status.models;

  async function runTest(discover = false) {
    setTesting(true);
    try {
      const result = await onTest(draftUrl, { discover });
      if (result?.origin) setDraftUrl(result.origin);
      if (result?.models?.length && !draftModel) setDraftModel(result.models[0]);
    } finally {
      setTesting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="glass-strong border-border max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2.5">
            <GhostMascot size={28} glow />
            <div>
              <DialogTitle className="font-[family-name:var(--font-display)]">Casper Settings</DialogTitle>
              <DialogDescription>Connect your local model server</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="ollama-url">Model server URL</Label>
            <Input
              id="ollama-url"
              data-testid="input-ollama-url"
              value={draftUrl}
              onChange={(e) => setDraftUrl(e.target.value)}
              placeholder="http://127.0.0.1:1234"
            />
            <p className="text-xs text-muted-foreground">
              LM Studio: open the <strong>Developer</strong> tab, start the local server, and load a
              chat model. Default is <code className="font-mono">http://127.0.0.1:1234</code>. Ollama
              uses <code className="font-mono">http://127.0.0.1:11434</code>.
            </p>
          </div>

          <div className="space-y-2">
            <Label>Connection</Label>
            <div className="flex items-center gap-2 text-sm">
              {status.connected ? (
                <>
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <Check className="w-4 h-4" /> Connected
                  </span>
                  <span className="text-muted-foreground">{models.length} models available</span>
                </>
              ) : testing ? (
                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Testing…
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-amber-500">
                  <AlertTriangle className="w-4 h-4" /> Not reachable — running in demo mode
                </span>
              )}
            </div>
            {(status.error || status.hint) && (
              <p className="text-xs text-amber-500/90" data-testid="text-connection-hint">
                {status.error}
                {status.error && status.hint ? " — " : ""}
                {status.hint}
              </p>
            )}
            <div className="flex items-center gap-2 mt-1">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={testing}
                onClick={() => runTest(false)}
              >
                Test connection
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={testing}
                onClick={() => runTest(true)}
              >
                Find my server
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="model">Model</Label>
            {models.length > 0 ? (
              <select
                id="model"
                data-testid="select-model"
                value={draftModel || models[0]}
                onChange={(e) => setDraftModel(e.target.value)}
                className="flex h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none focus:border-primary/60"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            ) : (
              <Input
                id="model"
                value={draftModel}
                onChange={(e) => setDraftModel(e.target.value)}
                placeholder="loaded-model"
              />
            )}
            <p className="text-xs text-muted-foreground">
              Pick a model from your LM Studio / Ollama server, or type a name. The loaded model is used
              automatically.
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">API token (optional)</Label>
            <Input
              id="api-key"
              data-testid="input-api-key"
              type="password"
              autoComplete="off"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder="Only if LM Studio requires authentication"
            />
            <p className="text-xs text-muted-foreground">
              Leave blank unless you enabled an API token in LM Studio → Developer → server settings.
            </p>
          </div>

          {isElectron && (
            <div className="space-y-2" data-testid="updates-section">
              <Label>Updates</Label>
              <div className="flex items-center gap-2 text-sm">
                {update?.type === "checking" && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" /> Checking for updates…
                  </span>
                )}
                {update?.type === "available" && (
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <Download className="w-4 h-4" /> Downloading v{update.version}…
                  </span>
                )}
                {update?.type === "progress" && (
                  <span className="text-muted-foreground">
                    {update.percent ? Math.round(update.percent) : 0}%
                  </span>
                )}
                {update?.type === "downloaded" && (
                  <span className="inline-flex items-center gap-1.5 text-primary">
                    <Check className="w-4 h-4" /> v{update.version} ready
                  </span>
                )}
                {update?.type === "up-to-date" && (
                  <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                    <Check className="w-4 h-4" /> Up to date
                  </span>
                )}
                {update?.type === "error" && (
                  <span className="inline-flex items-center gap-1.5 text-amber-500">
                    <AlertTriangle className="w-4 h-4" /> {update.message || "Update check failed"}
                  </span>
                )}
                {update === null && (
                  <span className="text-muted-foreground">Auto-checked on launch</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={update?.type === "checking" || update?.type === "available"}
                  onClick={() => (window as any).casperElectron?.updates?.checkForUpdates?.()}
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1" />
                  Check for updates
                </Button>
                {update?.type === "downloaded" && (
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => (window as any).casperElectron?.updates?.quitAndInstall?.()}
                  >
                    Restart to update
                  </Button>
                )}
              </div>
              <p className="text-xs text-muted-foreground">
                Updates are fetched from the configured release channel. In dev mode this is disabled.
              </p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(draftUrl, draftModel || models[0] || "", draftKey);
              onOpenChange(false);
            }}
          >
            <Ghost className="w-4 h-4 mr-1" />
            Save & haunt
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

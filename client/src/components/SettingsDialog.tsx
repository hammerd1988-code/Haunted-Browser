import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Check, AlertTriangle, Loader2, Ghost, Download, RefreshCw } from "lucide-react";
import type { CasperStatus } from "@/lib/ghost";
import { GhostMascot } from "@/lib/ghost";
import type { EngineDraft, EngineSettings } from "@/lib/api";

export type EngineSettingsPayload = Partial<Omit<EngineSettings, "apiKey">> & {
  apiKey?: string | null;
};

type EngineType = EngineSettings["engine"];

const ENGINE_OPTIONS: { value: EngineType; label: string }[] = [
  { value: "lmstudio", label: "Local — LM Studio" },
  { value: "ollama", label: "Local — Ollama" },
  { value: "openai", label: "Cloud — OpenAI" },
  { value: "openrouter", label: "Cloud — OpenRouter" },
  { value: "custom", label: "Custom — OpenAI-compatible URL" },
];

const isLocal = (e: EngineType) => e === "lmstudio" || e === "ollama";

const LOCAL_DEFAULT_URLS: Record<string, string> = {
  lmstudio: "http://127.0.0.1:1234",
  ollama: "http://127.0.0.1:11434",
};

export function SettingsDialog({
  open,
  onOpenChange,
  status,
  engine,
  ollamaUrl,
  customBaseUrl,
  model,
  apiKey,
  hasApiKey,
  ssh,
  onSave,
  onTest,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  status: CasperStatus;
  engine: EngineType;
  ollamaUrl: string;
  customBaseUrl: string;
  model: string;
  apiKey: string;
  hasApiKey: boolean;
  ssh: { sshHost: string; sshUser: string; sshPort: string; sshKeyPath: string; serverGuiUrl: string };
  onSave: (settings: EngineSettingsPayload) => Promise<void> | void;
  onTest: (draft: EngineDraft) => Promise<CasperStatus | void> | void;
}) {
  const [draftEngine, setDraftEngine] = useState<EngineType>(engine);
  const [draftUrl, setDraftUrl] = useState(ollamaUrl);
  const [draftCustomUrl, setDraftCustomUrl] = useState(customBaseUrl);
  const [draftModel, setDraftModel] = useState(model);
  const [draftKey, setDraftKey] = useState(apiKey);
  const [draftSsh, setDraftSsh] = useState(ssh);
  const [testing, setTesting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [update, setUpdate] = useState<{ type: string; version?: string; message?: string; percent?: number } | null>(null);

  const isElectron = typeof window !== "undefined" && Boolean((window as any).casperElectron?.isElectron);

  useEffect(() => {
    if (open) {
      setDraftEngine(engine);
      setDraftUrl(ollamaUrl);
      setDraftCustomUrl(customBaseUrl);
      setDraftModel(model);
      setDraftKey(apiKey);
      setDraftSsh(ssh);
      setSaveError("");
    }
  }, [open, engine, ollamaUrl, customBaseUrl, model, apiKey, ssh]);

  // Switching engines resets engine-specific fields so a stale URL or model
  // from a different engine is never silently carried over.
  function changeEngine(next: EngineType) {
    if (next === draftEngine) return;
    if (isLocal(next)) {
      const keep = draftEngine !== "lmstudio" && draftEngine !== "ollama" ? "" : draftUrl;
      const wasOtherDefault = Object.values(LOCAL_DEFAULT_URLS).includes(keep);
      if (!keep || wasOtherDefault) setDraftUrl(LOCAL_DEFAULT_URLS[next]);
    }
    setDraftModel("");
    setDraftKey("");
    setDraftEngine(next);
  }

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
      const result = await onTest({
        engine: draftEngine,
        ollamaUrl: draftUrl,
        customBaseUrl: draftCustomUrl,
        apiKey: draftKey,
        discover,
      });
      if (result?.origin && isLocal(draftEngine)) setDraftUrl(result.origin);
      if (result?.models?.length && !draftModel) setDraftModel(result.models[0]);
    } finally {
      setTesting(false);
    }
  }

  async function handleSave() {
    setSaving(true);
    setSaveError("");
    try {
      await onSave({
        engine: draftEngine,
        ollamaUrl: draftUrl,
        customBaseUrl: draftCustomUrl,
        model: draftModel || (draftEngine === engine ? models[0] : "") || "",
        // Empty means "keep the saved key" — unless the engine changed, in
        // which case the old engine's key is explicitly cleared.
        apiKey: draftKey || (draftEngine !== engine ? null : ""),
        ...draftSsh,
      });
      onOpenChange(false);
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Could not save settings.");
    } finally {
      setSaving(false);
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
              <DialogDescription>Dealer's choice — pick Casper's brain</DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-5 py-2">
          <div className="space-y-2">
            <Label htmlFor="engine">Engine</Label>
            <select
              id="engine"
              data-testid="select-engine"
              value={draftEngine}
              onChange={(e) => changeEngine(e.target.value as EngineType)}
              className="flex h-10 w-full rounded-md border border-input bg-background/70 px-3 text-sm outline-none focus:border-primary/60"
            >
              {ENGINE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-muted-foreground">
              Casper works the same on every engine — local models keep everything private, cloud
              models bring more horsepower.
            </p>
          </div>

          {isLocal(draftEngine) && (
            <div className="space-y-2">
              <Label htmlFor="ollama-url">Local server URL</Label>
              <Input
                id="ollama-url"
                data-testid="input-ollama-url"
                value={draftUrl}
                onChange={(e) => setDraftUrl(e.target.value)}
                placeholder={draftEngine === "ollama" ? "http://127.0.0.1:11434" : "http://127.0.0.1:1234"}
              />
              <p className="text-xs text-muted-foreground">
                {draftEngine === "ollama" ? (
                  <>Ollama serves on <code className="font-mono">http://127.0.0.1:11434</code> by default.</>
                ) : (
                  <>LM Studio: open the <strong>Developer</strong> tab, start the local server, and load a
                  chat model. Default is <code className="font-mono">http://127.0.0.1:1234</code>.</>
                )}
              </p>
            </div>
          )}

          {draftEngine === "custom" && (
            <div className="space-y-2">
              <Label htmlFor="custom-url">OpenAI-compatible base URL</Label>
              <Input
                id="custom-url"
                data-testid="input-custom-url"
                value={draftCustomUrl}
                onChange={(e) => setDraftCustomUrl(e.target.value)}
                placeholder="https://my-proxy.example.com/v1"
              />
              <p className="text-xs text-muted-foreground">
                Any server that speaks the OpenAI chat-completions API.
              </p>
            </div>
          )}

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
              {isLocal(draftEngine)
                ? "Pick a model from your local server, or type a name. The loaded model is used automatically."
                : draftEngine === "openrouter"
                  ? "e.g. openai/gpt-4o-mini, anthropic/claude-3.5-sonnet"
                  : "e.g. gpt-4o-mini, gpt-4o"}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="api-key">{isLocal(draftEngine) ? "API token (optional)" : "API key"}</Label>
            <Input
              id="api-key"
              data-testid="input-api-key"
              type="password"
              autoComplete="off"
              value={draftKey}
              onChange={(e) => setDraftKey(e.target.value)}
              placeholder={
                hasApiKey && draftEngine === engine
                  ? "Saved — leave blank to keep"
                  : isLocal(draftEngine)
                    ? "Only if your local server requires authentication"
                    : "sk-..."
              }
            />
            <p className="text-xs text-muted-foreground">
              {isLocal(draftEngine)
                ? "Leave blank unless your local server requires an API token."
                : "Stored locally in Haunted Browser's settings — never sent anywhere except the engine you chose."}
            </p>
          </div>

          <div className="space-y-2" data-testid="server-node-section">
            <Label>Server node (SSH)</Label>
            <p className="text-xs text-muted-foreground">
              Give Casper a server to look after — it can monitor health, manage services, and run
              maintenance over SSH (key auth only, never passwords).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Input
                data-testid="input-ssh-host"
                value={draftSsh.sshHost}
                onChange={(e) => setDraftSsh((s) => ({ ...s, sshHost: e.target.value }))}
                placeholder="Host (e.g. 203.0.113.7)"
              />
              <Input
                data-testid="input-ssh-user"
                value={draftSsh.sshUser}
                onChange={(e) => setDraftSsh((s) => ({ ...s, sshUser: e.target.value }))}
                placeholder="User (e.g. ubuntu)"
              />
              <Input
                data-testid="input-ssh-port"
                value={draftSsh.sshPort}
                onChange={(e) => setDraftSsh((s) => ({ ...s, sshPort: e.target.value }))}
                placeholder="Port (22)"
              />
              <Input
                data-testid="input-ssh-key"
                value={draftSsh.sshKeyPath}
                onChange={(e) => setDraftSsh((s) => ({ ...s, sshKeyPath: e.target.value }))}
                placeholder="Private key path (optional)"
              />
            </div>
            <Input
              data-testid="input-server-gui-url"
              value={draftSsh.serverGuiUrl}
              onChange={(e) => setDraftSsh((s) => ({ ...s, serverGuiUrl: e.target.value }))}
              placeholder="Server dashboard URL (Local Coder / NEO//OPS Ubuntu GUI)"
            />
            <p className="text-xs text-muted-foreground">
              The dashboard URL lets Casper open your Ubuntu server GUI in a tab for visual
              monitoring alongside SSH.
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

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {saveError && (
            <p className="text-xs text-amber-500 w-full" data-testid="text-save-error">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              {saveError}
            </p>
          )}
          <div className="flex justify-end gap-2 w-full">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <Ghost className="w-4 h-4 mr-1" />}
              Save & haunt
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

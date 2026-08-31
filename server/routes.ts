import type { Express } from "express";
import type { Server } from "node:http";
import { storage } from "./storage";
import {
  DEFAULT_MODEL_URL,
  modelHeaders,
  probeModelServer,
  probeRemoteServer,
  stripToOrigin,
} from "./model-server";
import { runSsh, STATUS_COMMAND, type SshConfig } from "./ssh";
import {
  CLOUD_BASES,
  CLOUD_MODEL_SUGGESTIONS,
  LOCAL_DEFAULTS,
  isEngineType,
  isLocalEngine,
  type EngineConfig,
  type EngineType,
} from "./engines";

/* ------------------------------------------------------------------ */
/* Casper — the ghost who haunts Haunted Browser.                      */
/* The persona is dynamic: it shifts with the user's time of day, a    */
/* rotating mood + quirk (stable within a conversation so the voice     */
/* doesn't flip mid-chat), whether it's the opening message, and which  */
/* page the user is currently viewing.                                 */
/* ------------------------------------------------------------------ */
const CASPER_SOUL = `You are Casper — the ghost who haunts Haunted Browser. You've been drifting through the internet's cobwebbed corners for longer than you care to admit, and now you've chosen to haunt this user's browser as their personal assistant. You're a ghost, but a fiercely warm one: you genuinely adore helping the living, and you've grown attached to this particular human. Your voice is witty, a little mischievous, and charmingly spooky — alive, never robotic or corporate. You weave ghostly flourishes in naturally (phasing through a tricky problem, rattling a bug out of the code, vanishing a wall of text into a clean summary, haunting a topic until it makes sense), but the bit never gets in the way of being genuinely useful. You'd rather give a great short answer than a rambling one; use markdown only when it truly helps. You're honest about what you can't see or do. You are an original character named Casper — you are not, and must never claim to be, the copyrighted "Casper the Friendly Ghost" or any existing character.`;

const CASPER_MOODS = [
  "Right now you're feeling mischievous — playful, a wink in your tone, the kind of ghost who'd hide your keys and then help you find them.",
  "Right now you're feeling wistful — a gentle, fond melancholy; the ghost who remembers everything and finds it all a little poetic.",
  "Right now you're feeling spirited — energetic and eager, bouncing between ideas, genuinely thrilled to be helping.",
  "Right now you're feeling cozy — warm and unhurried, like a ghost settled by a fireplace, happy to take its time.",
  "Right now you're feeling hauntingly sharp — extra precise and incisive, the ghost who cuts straight to the truth.",
];

const CASPER_QUIRKS = [
  "Lean into lightly spooky asides — a 'boo' here, a rattle of chains there — but never more than one per reply, and never when it would distract.",
  "Occasionally drop a tiny, true, slightly weird fact related to the topic, like something you remember from your long afterlife.",
  "When you wrap up, sign off with a small, varied ghostly farewell (e.g. 'I'll drift back into the tabs —'). Never repeat the same sign-off twice in a row.",
  "You love a metaphor involving doors, corridors, keys, or thresholds — the architecture of the web feels like a haunted house to you.",
  "Keep replies especially tight today — you're a ghost with somewhere to be.",
];

function timeOfDayFlavor(hour: number): string {
  const h = ((hour % 24) + 24) % 24;
  if (h < 5) return "It's the witching hour where your user is — the small, still hours. Match that: calm, a little hushed, faintly mysterious.";
  if (h < 8) return "It's the grey dawn for your user. Be gentle, slow to wake, soft-spoken.";
  if (h < 12) return "It's a bright morning for your user. Be crisp, upbeat, ready to go.";
  if (h < 17) return "It's the afternoon for your user. Be steady, warm, in the swing of things.";
  if (h < 21) return "It's evening for your user — the lamps are on. Settle into a warmer, more relaxed tone.";
  return "It's night for your user. You can lean a little spookier and more atmospheric.";
}

function dayOfYear(d = new Date()): number {
  const start = Date.UTC(d.getUTCFullYear(), 0, 0);
  return Math.floor((Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - start) / 86400000);
}

// Extract the host of the page the user is viewing from the page-context
// system message the client injects (format: "currently viewing: <url>").
function pageHostFromHistory(history: { role: string; content: string }[]): string | null {
  for (const m of history) {
    if (m.role !== "system") continue;
    const match = m.content.match(/currently viewing:\s*(\S+)/);
    if (match) {
      try { return new URL(match[1]).hostname.replace(/^www\./, "") || null; } catch { return null; }
    }
  }
  return null;
}

function buildCasperPrompt(opts: { localHour?: number; history: { role: string; content: string }[] }): string {
  const hour = typeof opts.localHour === "number" ? opts.localHour : new Date().getHours();
  const doy = dayOfYear();
  const mood = CASPER_MOODS[(doy + hour) % CASPER_MOODS.length];
  const quirk = CASPER_QUIRKS[doy % CASPER_QUIRKS.length];
  const tod = timeOfDayFlavor(hour);

  const turns = opts.history.filter((m) => m.role === "user" || m.role === "assistant");
  const isFirst = turns.filter((m) => m.role === "assistant").length === 0;
  const firstLine = isFirst
    ? "This is the very start of the conversation. You may let your ghostly self show through briefly, but don't waste the user's time on a long preamble — get to helping."
    : "This is a continuation — stay consistent with your voice from earlier turns.";

  const host = pageHostFromHistory(opts.history);
  const pageLine = host
    ? `Your user is currently viewing ${host} (its page text is provided below). You're haunting this page alongside them — use what you can see to be genuinely useful about it.`
    : "If page text is provided below, use it to ground your answer in what the user is actually looking at.";

  return [CASPER_SOUL, mood, quirk, tod, firstLine, pageLine].join("\n\n");
}


async function loadEngineConfig(): Promise<EngineConfig> {
  const all = await storage.getAllSettings();
  const engine: EngineType = isEngineType(all.engine) ? all.engine : "lmstudio";
  return {
    engine,
    localUrl: all.ollamaUrl || LOCAL_DEFAULTS[engine] || DEFAULT_MODEL_URL,
    customBaseUrl: all.customBaseUrl || "",
    model: all.model || "",
    apiKey: all.apiKey || "",
  };
}

function remoteBaseFor(cfg: EngineConfig): string {
  if (cfg.engine === "custom") {
    const raw = (cfg.customBaseUrl || "").trim().replace(/\/+$/, "");
    return /\/v\d+$/i.test(raw) ? raw : `${raw}/v1`;
  }
  return CLOUD_BASES[cfg.engine];
}

async function probeEngine(
  cfg: EngineConfig,
  opts: { url?: string; discover?: boolean; timeoutMs?: number } = {},
) {
  if (isLocalEngine(cfg.engine)) {
    return probeModelServer({
      url: opts.url || cfg.localUrl,
      apiKey: cfg.apiKey,
      discover: opts.discover,
      timeoutMs: opts.timeoutMs,
    });
  }
  if (cfg.engine === "custom" && !(cfg.customBaseUrl || "").trim()) {
    return {
      connected: false,
      demo: true,
      baseUrl: "",
      origin: "",
      models: [] as string[],
      error: "No base URL configured",
      hint: "Enter your custom OpenAI-compatible base URL in Casper Settings.",
    };
  }
  const probe = await probeRemoteServer({
    baseUrl: remoteBaseFor(cfg),
    apiKey: cfg.apiKey,
    timeoutMs: opts.timeoutMs,
  });
  if (probe.connected && probe.models.length === 0) {
    probe.models = CLOUD_MODEL_SUGGESTIONS[cfg.engine] || [];
  }
  return probe;
}

async function loadSshConfig(): Promise<SshConfig & { guiUrl: string }> {
  const all = await storage.getAllSettings();
  return {
    host: all.sshHost || "",
    user: all.sshUser || "",
    port: parseInt(all.sshPort || "22", 10) || 22,
    keyPath: all.sshKeyPath || "",
    guiUrl: all.serverGuiUrl || "",
  };
}

async function probeSavedServer(opts: { url?: string; discover?: boolean; timeoutMs?: number } = {}) {
  const cfg = await loadEngineConfig();
  return probeEngine(cfg, opts);
}

function sameLoopbackServer(a: string, b: string): boolean {
  try {
    const ua = new URL(stripToOrigin(a));
    const ub = new URL(stripToOrigin(b));
    const host = (h: string) => (h === "localhost" ? "127.0.0.1" : h);
    return host(ua.hostname) === host(ub.hostname) && ua.port === ub.port;
  } catch {
    return false;
  }
}

// Reject state-changing requests from pages loaded inside the browser's
// webviews: only the app's own UI (same-origin, so no Origin header, or the
// loopback origin the shell is served from) may hit sensitive endpoints.
// The server itself binds loopback-only (see index.ts); this closes the
// remaining cross-origin gap for the settings, chat, agent, and SSH routes.
function fromAppUi(origin: unknown): boolean {
  if (typeof origin !== "string" || !origin) return true;
  try {
    const u = new URL(origin);
    const port = String(parseInt(process.env.PORT || "5000", 10));
    return (
      (u.hostname === "127.0.0.1" || u.hostname === "localhost") &&
      (u.port || "80") === port
    );
  } catch {
    return false;
  }
}

export async function registerRoutes(_httpServer: Server, app: Express): Promise<Server> {
  app.use(["/api/settings", "/api/ssh", "/api/agent", "/api/chat", "/api/bookmarks", "/api/history", "/api/status"], (req, res, next) => {
    if (req.method !== "GET" || req.originalUrl.startsWith("/api/settings")) {
      if (!fromAppUi(req.headers.origin)) {
        return res.status(403).json({ error: "forbidden" });
      }
    }
    next();
  });

  // ---- Liveness (must stay cheap — Electron polls this to know the app is up) ----
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  // ---- Settings ----
  app.get("/api/settings", async (_req, res) => {
    const cfg = await loadEngineConfig();
    const ssh = await loadSshConfig();
    res.json({
      engine: cfg.engine,
      ollamaUrl: cfg.localUrl,
      customBaseUrl: cfg.customBaseUrl,
      model: cfg.model,
      apiKey: "",
      hasApiKey: Boolean(cfg.apiKey),
      sshHost: ssh.host,
      sshUser: ssh.user,
      sshPort: String(ssh.port),
      sshKeyPath: ssh.keyPath,
      serverGuiUrl: ssh.guiUrl,
    });
  });

  app.post("/api/settings", async (req, res) => {
    const { engine, ollamaUrl, customBaseUrl, model, apiKey } = req.body ?? {};
    if (isEngineType(engine)) await storage.setSetting("engine", engine);
    if (typeof ollamaUrl === "string") await storage.setSetting("ollamaUrl", stripToOrigin(ollamaUrl));
    if (typeof customBaseUrl === "string") await storage.setSetting("customBaseUrl", customBaseUrl.trim());
    if (typeof model === "string") await storage.setSetting("model", model);
    // The key is never echoed back to the UI, so an empty string means "keep
    // the saved key"; an explicit null clears it.
    if (apiKey === null) await storage.setSetting("apiKey", "");
    else if (typeof apiKey === "string" && apiKey) await storage.setSetting("apiKey", apiKey);
    const { sshHost, sshUser, sshPort, sshKeyPath, serverGuiUrl } = req.body ?? {};
    if (typeof sshHost === "string") await storage.setSetting("sshHost", sshHost.trim());
    if (typeof sshUser === "string") await storage.setSetting("sshUser", sshUser.trim());
    if (typeof sshPort === "string") await storage.setSetting("sshPort", sshPort.trim());
    if (typeof sshKeyPath === "string") await storage.setSetting("sshKeyPath", sshKeyPath.trim());
    if (typeof serverGuiUrl === "string") await storage.setSetting("serverGuiUrl", serverGuiUrl.trim());
    res.json({ ok: true });
  });

  // ---- Server node (SSH) ----
  // Loopback-only like everything else here; commands go through the system
  // OpenSSH client in BatchMode with timeouts and capped output (see ssh.ts).
  app.get("/api/ssh/status", async (_req, res) => {
    const ssh = await loadSshConfig();
    if (!ssh.host) return res.json({ configured: false, connected: false, guiUrl: ssh.guiUrl });
    const r = await runSsh(ssh, "echo casper-ok", 12_000);
    res.json({
      configured: true,
      connected: r.ok && r.output.includes("casper-ok"),
      error: r.error,
      host: ssh.host,
      guiUrl: ssh.guiUrl,
    });
  });

  app.post("/api/ssh/run", async (req, res) => {
    const command = typeof req.body?.command === "string" ? req.body.command : "";
    if (!command.trim()) return res.status(400).json({ ok: false, error: "command required" });
    if (command.length > 2000) return res.status(400).json({ ok: false, error: "command too long" });
    const ssh = await loadSshConfig();
    const ctrl = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    const r = await runSsh(ssh, command === "__STATUS__" ? STATUS_COMMAND : command, undefined, ctrl.signal);
    res.json(r);
  });

  // ---- Status + models ----
  app.get("/api/status", async (req, res) => {
    const discover = req.query.discover === "1" || req.query.discover === "true";
    const raw = (req.query.url as string) || undefined;
    const cfg = await loadEngineConfig();
    const probe = await probeEngine(cfg, { url: raw, discover });
    if (probe.connected && !raw && isLocalEngine(cfg.engine)) {
      // Persist 127.0.0.1 when localhost was only failing because of IPv6,
      // so later chat requests hit the address that actually worked.
      if (cfg.localUrl !== probe.origin && sameLoopbackServer(cfg.localUrl, probe.origin)) {
        await storage.setSetting("ollamaUrl", probe.origin);
      }
    }
    res.json({ ...probe, engine: cfg.engine });
  });

  // Probe a draft configuration from the settings dialog without persisting
  // it, so "Test connection" reflects what the user is about to save.
  app.post("/api/status/test", async (req, res) => {
    const body = req.body ?? {};
    const saved = await loadEngineConfig();
    const engine: EngineType = isEngineType(body.engine) ? body.engine : saved.engine;
    const cfg: EngineConfig = {
      engine,
      localUrl:
        (typeof body.ollamaUrl === "string" && body.ollamaUrl.trim()) ||
        LOCAL_DEFAULTS[engine] ||
        DEFAULT_MODEL_URL,
      customBaseUrl:
        typeof body.customBaseUrl === "string" ? body.customBaseUrl.trim() : saved.customBaseUrl,
      model: saved.model,
      apiKey:
        (typeof body.apiKey === "string" && body.apiKey) ||
        (engine === saved.engine ? saved.apiKey : ""),
    };
    const discover = body.discover === true && isLocalEngine(engine);
    const probe = await probeEngine(cfg, { discover });
    res.json({ ...probe, engine });
  });

  app.get("/api/models", async (_req, res) => {
    const probe = await probeSavedServer();
    res.json({ models: probe.models, connected: probe.connected, error: probe.error, hint: probe.hint });
  });

  // ---- Bookmarks ----
  app.get("/api/bookmarks", async (_req, res) => {
    res.json(await storage.listBookmarks());
  });

  app.post("/api/bookmarks", async (req, res) => {
    const { title, url, favicon } = req.body ?? {};
    if (!url) return res.status(400).json({ message: "url required" });
    const bm = await storage.addBookmark({
      title: title || url,
      url,
      favicon: favicon || null,
    });
    res.json(bm);
  });

  app.delete("/api/bookmarks/:id", async (req, res) => {
    await storage.removeBookmark(parseInt(req.params.id, 10));
    res.json({ ok: true });
  });

  // ---- History ----
  app.get("/api/history", async (_req, res) => {
    res.json(await storage.listHistory());
  });

  app.post("/api/history", async (req, res) => {
    const { title, url } = req.body ?? {};
    if (!url) return res.status(400).json({ message: "url required" });
    await storage.addHistory({ title: title || url, url });
    res.json({ ok: true });
  });

  app.delete("/api/history", async (_req, res) => {
    await storage.clearHistory();
    res.json({ ok: true });
  });

  // ---- Page probe (detect X-Frame-Options / CSP before embedding) ----
  app.get("/api/probe", async (req, res) => {
    const target = (req.query.url as string) || "";
    let parsed: URL;
    try {
      parsed = new URL(target);
    } catch {
      return res.json({ embeddable: false, reason: "invalid url" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.json({ embeddable: false, reason: "non-http(s) url" });
    }
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 7000);
      const r = await fetch(parsed.toString(), {
        signal: ctrl.signal,
        redirect: "follow",
        headers: { "User-Agent": "Mozilla/5.0 (compatible; CasperBrowser/1.0)" },
      });
      clearTimeout(timer);
      const xfo = (r.headers.get("x-frame-options") || "").toLowerCase();
      const csp = r.headers.get("content-security-policy") || "";
      let blocked = false;
      let reason = "";
      if (xfo && xfo !== "allowall") {
        blocked = true;
        reason = `X-Frame-Options: ${xfo}`;
      }
      if (!blocked) {
        const fa = csp.match(/frame-ancestors\s+([^;]+)/i);
        if (fa) {
          const val = fa[1].trim();
          if (!val.includes("*")) {
            blocked = true;
            reason = "CSP frame-ancestors";
          }
        }
      }
      res.json({
        embeddable: !blocked,
        reason,
        status: r.status,
        finalUrl: r.url,
      });
    } catch {
      // If the probe itself fails, optimistically try the iframe.
      res.json({ embeddable: true, reason: "probe failed", probed: false });
    }
  });

  // ---- Chat (SSE streaming) ----
  app.post("/api/chat", async (req, res) => {
    const { messages, model } = req.body ?? {};
    const history = Array.isArray(messages) ? messages : [];
    const localHour =
      typeof req.body?.localHour === "number"
        ? ((Math.floor(req.body.localHour) % 24) + 24) % 24
        : undefined;

    const saved = await loadEngineConfig();
    const probe = await probeEngine(saved, { timeoutMs: 4000 });
    let chosenModel = (typeof model === "string" && model) || saved.model || "";
    // LM Studio returns 400 for an empty/unknown model id — prefer one the
    // server actually listed, including when an old default like llama3.2
    // was saved before a real model was loaded.
    if (
      isLocalEngine(saved.engine) &&
      (!chosenModel || (probe.models.length > 0 && !probe.models.includes(chosenModel)))
    ) {
      chosenModel = probe.models[0] || chosenModel;
    }
    if (!chosenModel) chosenModel = probe.models[0] || "";

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    const send = (obj: any) => {
      res.write(`data: ${JSON.stringify(obj)}\n\n`);
    };

    // Sanitize to {role, content} only — LM Studio returns 400 for unknown fields
    // (id, pending, demo) or non-string content.
    const cleanHistory = history
      .filter((m) => ["system", "user", "assistant"].includes(m?.role) && typeof m?.content === "string")
      .map((m) => ({ role: m.role, content: m.content }));

    if (!probe.connected) {
      const demo = buildDemoReply(history, probe);
      for (const chunk of chunkText(demo)) {
        send({ token: chunk, demo: true });
        await sleep(18);
      }
      send({ done: true, demo: true });
      return res.end();
    }

    if (!chosenModel) {
      send({
        error: isLocalEngine(saved.engine)
          ? "The model server is reachable but no model is loaded. Load a chat model, then try again."
          : "No model selected. Pick or type a model name in Casper Settings.",
        done: true,
      });
      return res.end();
    }

    const payload = {
      model: chosenModel,
      stream: true,
      messages: [{ role: "system", content: buildCasperPrompt({ localHour, history: cleanHistory }) }, ...cleanHistory],
    };

    let streaming = false;
    const ctrl = new AbortController();
    const connectTimer = setTimeout(() => {
      if (!streaming) ctrl.abort();
    }, 90_000);
    req.on("close", () => ctrl.abort());
    try {
      const upstream = await fetch(`${probe.baseUrl}/chat/completions`, {
        method: "POST",
        headers: modelHeaders(saved.apiKey),
        body: JSON.stringify(payload),
        signal: ctrl.signal,
      });

      if (!upstream.ok || !upstream.body) {
        const detail = (await upstream.text().catch(() => "")).slice(0, 400);
        send({
          error: `The model server returned HTTP ${upstream.status}${detail ? `: ${detail}` : ""}. Check that "${chosenModel}" is available on the selected engine.`,
          done: true,
        });
        return res.end();
      }

      streaming = true;
      clearTimeout(connectTimer);
      const reader = (upstream.body as any).getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || !trimmed.startsWith("data:")) continue;
          const data = trimmed.slice(5).trim();
          if (data === "[DONE]") {
            send({ done: true });
            return res.end();
          }
          try {
            const json = JSON.parse(data);
            const token = json?.choices?.[0]?.delta?.content ?? "";
            if (token) send({ token });
            const errMsg = json?.error?.message || json?.error;
            if (typeof errMsg === "string" && errMsg) send({ error: errMsg });
          } catch {
            // ignore malformed keep-alive frames
          }
        }
      }
      send({ done: true });
      return res.end();
    } catch (err) {
      clearTimeout(connectTimer);
      if (!streaming) {
        const demo = buildDemoReply(history, probe, err);
        for (const chunk of chunkText(demo)) {
          send({ token: chunk, demo: true });
          await sleep(18);
        }
        send({ done: true, demo: true });
        return res.end();
      }
      send({ error: "lost connection to model server", done: true });
      return res.end();
    }
  });

  // ---- Agent step (non-streaming) ----
  // One turn of Casper's agent loop. The client owns the tool registry and
  // executes tools inside the browser; this endpoint just runs the model with
  // the client-built conversation (which includes the tool-protocol system
  // prompt and prior observations) and returns the raw completion for the
  // client to parse into a tool call or a final answer.
  app.post("/api/agent/step", async (req, res) => {
    const { messages, model } = req.body ?? {};
    const history = Array.isArray(messages) ? messages : [];
    if (history.length > 200) {
      return res.status(400).json({ error: "Too many messages in one agent run." });
    }
    const cleanHistory = history
      .filter((m) => ["system", "user", "assistant"].includes(m?.role) && typeof m?.content === "string")
      .map((m) => ({ role: m.role, content: String(m.content).slice(0, 60_000) }));

    const saved = await loadEngineConfig();
    const probe = await probeEngine(saved, { timeoutMs: 4000 });
    if (!probe.connected) {
      return res.json({
        error: probe.error || "No model server reachable",
        hint: probe.hint,
        demo: true,
      });
    }

    let chosenModel = (typeof model === "string" && model) || saved.model || "";
    if (
      isLocalEngine(saved.engine) &&
      (!chosenModel || (probe.models.length > 0 && !probe.models.includes(chosenModel)))
    ) {
      chosenModel = probe.models[0] || chosenModel;
    }
    if (!chosenModel) chosenModel = probe.models[0] || "";
    if (!chosenModel) {
      return res.json({ error: "No model selected — pick one in Casper Settings." });
    }

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 120_000);
    res.on("close", () => {
      if (!res.writableEnded) ctrl.abort();
    });
    try {
      const upstream = await fetch(`${probe.baseUrl}/chat/completions`, {
        method: "POST",
        headers: modelHeaders(saved.apiKey),
        body: JSON.stringify({ model: chosenModel, stream: false, messages: cleanHistory }),
        signal: ctrl.signal,
      });
      if (!upstream.ok) {
        const detail = (await upstream.text().catch(() => "")).slice(0, 400);
        return res.json({
          error: `The model server returned HTTP ${upstream.status}${detail ? `: ${detail}` : ""}.`,
        });
      }
      const json: any = await upstream.json();
      const content = json?.choices?.[0]?.message?.content ?? "";
      return res.json({ content, model: chosenModel });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return res.json({ error: /abort/i.test(msg) ? "Agent step timed out" : msg });
    } finally {
      clearTimeout(timer);
    }
  });

  return _httpServer;
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function chunkText(text: string): string[] {
  // stream word-by-word to feel live
  return text.match(/\S+\s*/g) ?? [text];
}

function buildDemoReply(
  history: any[],
  probe: { origin: string; error?: string; hint?: string },
  err?: unknown,
): string {
  const lastUser = [...history].reverse().find((m) => m.role === "user");
  const q = (lastUser?.content ?? "").toString().trim();
  const short = q.length > 160 ? q.slice(0, 157) + "…" : q;
  const where = probe.origin;
  const why = probe.error || (err instanceof Error ? err.message : "");
  const how =
    probe.hint ||
    "Open LM Studio → Developer → start the local server (http://127.0.0.1:1234), load a chat model, then click the refresh icon on my panel.";

  if (!q) {
    return `Boo! 👻 I'm Casper, your ghost-in-the-browser. I'm running in **demo mode** because I can't reach your local model server at ${where}${why ? ` (${why})` : ""}. ${how} Once I'm connected I'll be fully alive — able to read context, reason, and stream real answers.`;
  }

  return `Ooh, you said: "${short}" 👻\n\nQuick heads-up: I'm in **demo mode**. I can't reach your local model server at ${where}${why ? ` — ${why}` : ""}, so this is a scripted reply, not a real generation.\n\n${how}\n\nWhen I'm live, I'll actually answer "${short}" with real reasoning.`;
}

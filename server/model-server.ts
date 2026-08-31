/**
 * Talk to a local OpenAI-compatible model server (LM Studio on :1234,
 * Ollama on :11434). Connection quirks we have to paper over:
 *
 * - Node's fetch often resolves `localhost` to IPv6 (::1) while LM Studio
 *   binds IPv4 127.0.0.1, so the request fails even though the server is up.
 * - A 4s abort looks identical to "server down" when a model is still loading.
 * - HTTP 400/401 from a bad model id or API token used to fall through to
 *   demo-mode scripted replies, hiding the real error.
 */

export const DEFAULT_MODEL_URL = "http://127.0.0.1:1234";
export const OLLAMA_URL = "http://127.0.0.1:11434";

export const DISCOVERY_ORIGINS = [
  "http://127.0.0.1:1234",
  "http://localhost:1234",
  "http://127.0.0.1:11434",
  "http://localhost:11434",
];

export interface ProbeResult {
  connected: boolean;
  demo: boolean;
  /** OpenAI-compatible base, e.g. http://127.0.0.1:1234/v1 */
  baseUrl: string;
  /** User-facing origin without /v1 */
  origin: string;
  models: string[];
  error?: string;
  hint?: string;
}

export function stripToOrigin(raw: string): string {
  let b = (raw || "").trim();
  if (!b) return DEFAULT_MODEL_URL;
  if (!/^https?:\/\//i.test(b)) b = `http://${b}`;
  b = b.replace(/\/+$/, "");
  b = b.replace(/\/(?:chat\/completions|completions|models|embeddings)$/i, "");
  b = b.replace(/\/v\d+$/i, "");
  return b;
}

export function openaiBaseFromOrigin(origin: string): string {
  return `${stripToOrigin(origin)}/v1`;
}

export function originFromBase(baseUrl: string): string {
  return stripToOrigin(baseUrl);
}

export function withLoopback(origin: string): string[] {
  const cleaned = stripToOrigin(origin);
  try {
    const u = new URL(cleaned);
    // Node's fetch often resolves `localhost` to ::1. LM Studio binds IPv4, so
    // always prefer 127.0.0.1 and skip the IPv6 hang.
    if (u.hostname === "localhost") {
      u.hostname = "127.0.0.1";
      return [u.origin];
    }
    return [cleaned];
  } catch {
    return [cleaned];
  }
}

export function candidateOrigins(raw: string, discover = false): string[] {
  const primary = withLoopback(raw || DEFAULT_MODEL_URL);
  if (!discover) return primary;
  return unique([...primary, ...DISCOVERY_ORIGINS.flatMap((o) => withLoopback(o))]);
}

export function modelHeaders(apiKey?: string | null): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    "Content-Type": "application/json",
  };
  const key = (apiKey || "").trim();
  if (key) headers.Authorization = `Bearer ${key}`;
  return headers;
}

export function parseModelIds(json: unknown): string[] {
  const body = json as { data?: unknown; models?: unknown } | null;
  const data = body?.data ?? body?.models ?? [];
  if (!Array.isArray(data)) return [];
  return data
    .map((m: unknown) => {
      if (typeof m === "string") return m;
      const rec = m as { id?: unknown; name?: unknown; model?: unknown };
      const id = rec?.id ?? rec?.name ?? rec?.model;
      return typeof id === "string" ? id : "";
    })
    .filter(Boolean);
}

export function describeFailure(err: unknown, tried: string[]): { error: string; hint: string } {
  const where = tried[0] || DEFAULT_MODEL_URL;
  const msg = err instanceof Error ? err.message : String(err);
  const code = errorCode(err);

  if (code === "ABORT_ERR" || /aborted|abort/i.test(msg)) {
    return {
      error: `Timed out waiting for ${where}`,
      hint: "If a model is still loading in LM Studio, wait until it finishes, then retry. Otherwise confirm the Developer server is started on port 1234.",
    };
  }
  if (code === "ECONNREFUSED" || /ECONNREFUSED/i.test(msg) || /fetch failed/i.test(msg)) {
    return {
      error: `Nothing is listening at ${where}`,
      hint: "Open LM Studio → Developer → start the local server (default http://127.0.0.1:1234) and load a chat model. Ollama users: ollama serve on http://127.0.0.1:11434.",
    };
  }
  if (code === "ENOTFOUND" || code === "EAI_AGAIN") {
    return {
      error: `Could not resolve host for ${where}`,
      hint: "Use http://127.0.0.1:1234 instead of a hostname. LM Studio's server only listens on your machine.",
    };
  }
  if (/401|403|unauthorized|forbidden/i.test(msg)) {
    return {
      error: "Model server asked for an API token",
      hint: "In LM Studio open Developer → server settings, copy the API token, and paste it in Casper Settings.",
    };
  }
  return {
    error: msg || `Could not reach ${where}`,
    hint: "Open LM Studio → Developer, start the local server, load a chat model, then click Test connection.",
  };
}

export async function fetchModels(
  baseUrl: string,
  opts: { timeoutMs?: number; apiKey?: string | null } = {},
): Promise<string[]> {
  const timeoutMs = opts.timeoutMs ?? 2500;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl.replace(/\/+$/, "")}/models`, {
      signal: ctrl.signal,
      headers: modelHeaders(opts.apiKey),
    });
    if (res.status === 401 || res.status === 403) {
      throw Object.assign(new Error(`HTTP ${res.status} unauthorized`), { status: res.status });
    }
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    return parseModelIds(await res.json());
  } finally {
    clearTimeout(t);
  }
}

/**
 * Probe a remote (cloud or custom) OpenAI-compatible server. Unlike local
 * probing there is no discovery or loopback rewriting — just list models at
 * the given base. A failed /models listing on a cloud engine is not fatal
 * (some proxies gate it), so callers may treat "unauthorized" as the only
 * hard failure.
 */
export async function probeRemoteServer(opts: {
  baseUrl: string;
  apiKey?: string | null;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const baseUrl = opts.baseUrl.replace(/\/+$/, "");
  const origin = stripToOrigin(baseUrl);
  try {
    const models = await fetchModels(baseUrl, {
      timeoutMs: opts.timeoutMs ?? 6000,
      apiKey: opts.apiKey,
    });
    return { connected: true, demo: false, baseUrl, origin, models };
  } catch (err) {
    const status = (err as { status?: number })?.status;
    // Some OpenAI-compatible proxies gate or omit /models while still serving
    // /chat/completions — treat "endpoint unsupported" as connected.
    if (status === 404 || status === 405 || status === 501) {
      return { connected: true, demo: false, baseUrl, origin, models: [] };
    }
    if (status === 401 || status === 403) {
      return {
        connected: false,
        demo: true,
        baseUrl,
        origin,
        models: [],
        error: "The API rejected your key",
        hint: "Check the API key in Casper Settings — it must be valid for the selected engine.",
      };
    }
    const msg = err instanceof Error ? err.message : String(err);
    return {
      connected: false,
      demo: true,
      baseUrl,
      origin,
      models: [],
      error: `Could not reach ${origin} (${msg})`,
      hint: "Check your internet connection and the base URL for the selected engine.",
    };
  }
}

export async function probeModelServer(opts: {
  url?: string;
  apiKey?: string | null;
  discover?: boolean;
  timeoutMs?: number;
}): Promise<ProbeResult> {
  const tried = candidateOrigins(opts.url || DEFAULT_MODEL_URL, Boolean(opts.discover));
  let lastErr: unknown;
  for (const origin of tried) {
    const baseUrl = openaiBaseFromOrigin(origin);
    try {
      const models = await fetchModels(baseUrl, {
        timeoutMs: opts.timeoutMs ?? 2500,
        apiKey: opts.apiKey,
      });
      const hint =
        models.length === 0
          ? "Server is up but no models are listed. Load a chat model in LM Studio (or run ollama pull), then retry."
          : undefined;
      return {
        connected: true,
        demo: false,
        baseUrl,
        origin: stripToOrigin(origin),
        models,
        hint,
      };
    } catch (err) {
      lastErr = err;
      const status = (err as { status?: number })?.status;
      if (status === 401 || status === 403) {
        const { error, hint } = describeFailure(err, [origin]);
        return {
          connected: false,
          demo: true,
          baseUrl,
          origin: stripToOrigin(origin),
          models: [],
          error,
          hint,
        };
      }
    }
  }
  const { error, hint } = describeFailure(lastErr, tried.map(stripToOrigin));
  const fallbackOrigin = stripToOrigin(opts.url || DEFAULT_MODEL_URL);
  return {
    connected: false,
    demo: true,
    baseUrl: openaiBaseFromOrigin(fallbackOrigin),
    origin: preferIpv4Origin(fallbackOrigin),
    models: [],
    error,
    hint,
  };
}

function preferIpv4Origin(origin: string): string {
  return withLoopback(origin)[0] || origin;
}

function unique(items: string[]): string[] {
  return Array.from(new Set(items));
}

function errorCode(err: unknown): string | undefined {
  if (!err || typeof err !== "object") return undefined;
  const rec = err as { code?: unknown; cause?: { code?: unknown } };
  if (typeof rec.code === "string") return rec.code;
  if (typeof rec.cause?.code === "string") return rec.cause.code;
  if (err instanceof Error && err.name === "AbortError") return "ABORT_ERR";
  return undefined;
}

import { apiRequest } from "./queryClient";
import type { CasperStatus, ChatMessage } from "./ghost";
import type { Bookmark } from "@shared/schema";

const API_BASE = "__PORT_5000__".startsWith("__") ? "" : "__PORT_5000__";

export async function fetchStatus(url?: string, opts?: { discover?: boolean }): Promise<CasperStatus> {
  const params = new URLSearchParams();
  if (url) params.set("url", url);
  if (opts?.discover) params.set("discover", "1");
  const qs = params.toString() ? `?${params.toString()}` : "";
  const res = await apiRequest("GET", `/api/status${qs}`);
  return res.json();
}

export async function fetchBookmarks(): Promise<Bookmark[]> {
  const res = await apiRequest("GET", "/api/bookmarks");
  return res.json();
}

export async function addBookmark(body: { title: string; url: string; favicon?: string }) {
  const res = await apiRequest("POST", "/api/bookmarks", body);
  return res.json();
}

export async function removeBookmark(id: number) {
  await apiRequest("DELETE", `/api/bookmarks/${id}`);
}

export async function fetchHistory() {
  const res = await apiRequest("GET", "/api/history");
  return res.json();
}

export async function addHistory(body: { title: string; url: string }) {
  await apiRequest("POST", "/api/history", body);
}

export async function clearHistory() {
  await apiRequest("DELETE", "/api/history");
}

export interface EngineSettings {
  engine: "lmstudio" | "ollama" | "openai" | "openrouter" | "custom";
  ollamaUrl: string;
  customBaseUrl: string;
  model: string;
  apiKey: string;
  sshHost: string;
  sshUser: string;
  sshPort: string;
  sshKeyPath: string;
  serverGuiUrl: string;
}

export async function fetchSettings(): Promise<EngineSettings> {
  const res = await apiRequest("GET", "/api/settings");
  return res.json();
}

export async function saveSettings(body: Partial<EngineSettings>) {
  await apiRequest("POST", "/api/settings", body);
}

export async function agentStep(
  messages: { role: string; content: string }[],
  model: string,
  signal?: AbortSignal,
): Promise<{ content?: string; error?: string; hint?: string; demo?: boolean }> {
  const res = await fetch(`${API_BASE}/api/agent/step`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, model }),
    signal,
  });
  if (!res.ok) return { error: `Agent request failed (${res.status})` };
  return res.json();
}

export async function sshRun(command: string): Promise<{ ok: boolean; output: string; error?: string }> {
  const res = await fetch(`${API_BASE}/api/ssh/run`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ command }),
  });
  return res.json();
}

export async function probeUrl(url: string): Promise<{ embeddable: boolean; reason?: string; finalUrl?: string }> {
  const res = await apiRequest("GET", `/api/probe?url=${encodeURIComponent(url)}`);
  return res.json();
}

export interface ChatStreamCallbacks {
  onToken: (token: string) => void;
  onDemo?: (isDemo: boolean) => void;
  onError?: (message: string) => void;
  onDone: () => void;
  signal?: AbortSignal;
}

export async function streamChat(
  messages: ChatMessage[],
  model: string,
  cb: ChatStreamCallbacks,
): Promise<void> {
  const res = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      model,
      localHour: new Date().getHours(),
    }),
    signal: cb.signal,
  });

  if (!res.ok || !res.body) {
    cb.onError?.(`Request failed (${res.status})`);
    cb.onDone();
    return;
  }

  const reader = res.body.getReader();
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
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data) continue;
      try {
        const json = JSON.parse(data);
        if (json.token) cb.onToken(json.token);
        if (json.demo) cb.onDemo?.(true);
        if (json.error) cb.onError?.(json.error);
        if (json.done) {
          cb.onDone();
          return;
        }
      } catch {
        // ignore
      }
    }
  }
  cb.onDone();
}

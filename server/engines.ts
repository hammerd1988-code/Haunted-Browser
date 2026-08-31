/**
 * Dealer's-choice engine abstraction. Every engine exposes an
 * OpenAI-compatible /v1 API, so switching engines only changes the
 * base URL, the API key, and how we probe for models.
 */

export type EngineType = "lmstudio" | "ollama" | "openai" | "openrouter" | "custom";

export const ENGINE_TYPES: EngineType[] = ["lmstudio", "ollama", "openai", "openrouter", "custom"];

export interface EngineConfig {
  engine: EngineType;
  /** Local server origin for lmstudio/ollama (e.g. http://127.0.0.1:1234) */
  localUrl: string;
  /** Full OpenAI-compatible base for custom engines (e.g. https://my-proxy/v1) */
  customBaseUrl: string;
  model: string;
  apiKey: string;
}

export const CLOUD_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  openrouter: "https://openrouter.ai/api/v1",
};

export const LOCAL_DEFAULTS: Record<string, string> = {
  lmstudio: "http://127.0.0.1:1234",
  ollama: "http://127.0.0.1:11434",
};

export function isEngineType(v: unknown): v is EngineType {
  return typeof v === "string" && (ENGINE_TYPES as string[]).includes(v);
}

export function isLocalEngine(engine: EngineType): boolean {
  return engine === "lmstudio" || engine === "ollama";
}

/** Curated fallbacks when a cloud /models listing is unavailable. */
export const CLOUD_MODEL_SUGGESTIONS: Record<string, string[]> = {
  openai: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini", "gpt-4.1"],
  openrouter: [
    "openai/gpt-4o-mini",
    "anthropic/claude-3.5-sonnet",
    "meta-llama/llama-3.1-70b-instruct",
    "qwen/qwen-2.5-72b-instruct",
  ],
};

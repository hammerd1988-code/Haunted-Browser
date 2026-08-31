import type { ReactNode } from "react";

/* ------------------------------------------------------------------ */
/* Ghost mascot — original friendly ghost, "Casper"                   */
/* ------------------------------------------------------------------ */
export function GhostMascot({
  size = 28,
  className = "",
  floating = false,
  glow = false,
}: {
  size?: number;
  className?: string;
  floating?: boolean;
  glow?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      className={`${floating ? "animate-ghost-float" : ""} ${className}`}
      aria-label="Casper ghost mascot"
      role="img"
      style={glow ? { filter: "drop-shadow(0 0 10px hsl(168 76% 56% / 0.55))" } : undefined}
    >
      <defs>
        <linearGradient id="ghostBody" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#e9fff8" />
          <stop offset="100%" stopColor="#9ff3e0" />
        </linearGradient>
      </defs>
      {/* body */}
      <path
        d="M32 6C20 6 12 14.5 12 26v22.5a3 3 0 0 0 5.1 2.1l2.2-1.9a2.2 2.2 0 0 1 3.3.2l1.6 1.8a2.2 2.2 0 0 0 3.6 0l1.6-1.8a2.2 2.2 0 0 1 3.3-.2l2.2 1.9A3 3 0 0 0 52 48.5V26C52 14.5 44 6 32 6Z"
        fill="url(#ghostBody)"
        stroke="hsl(168 60% 45% / 0.35)"
        strokeWidth="1.2"
      />
      {/* eyes */}
      <ellipse cx="25.5" cy="27" rx="3.4" ry="4" fill="#1a1730" />
      <ellipse cx="38.5" cy="27" rx="3.4" ry="4" fill="#1a1730" />
      <circle cx="26.8" cy="25.6" r="1.1" fill="#fff" />
      <circle cx="39.8" cy="25.6" r="1.1" fill="#fff" />
      {/* blush */}
      <circle cx="21" cy="33" r="2.2" fill="hsl(320 70% 70% / 0.35)" />
      <circle cx="43" cy="33" r="2.2" fill="hsl(320 70% 70% / 0.35)" />
      {/* mouth */}
      <path
        d="M28 36.5c2 2.4 6 2.4 8 0"
        stroke="#1a1730"
        strokeWidth="1.6"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}

/* ------------------------------------------------------------------ */
/* URL / search helpers                                                */
/* ------------------------------------------------------------------ */
const SEARCH_URL = "https://duckduckgo.com/?q=";

export function isLikelyUrl(input: string): boolean {
  const s = input.trim();
  if (!s) return false;
  if (/\s/.test(s)) return false; // contains whitespace -> search
  if (/^https?:\/\//i.test(s)) return true;
  if (/^[a-z0-9-]+(\.[a-z0-9-]+)+(\/.*)?$/i.test(s) && s.includes(".")) return true;
  return false;
}

export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^https?:\/\//i.test(s)) return s;
  return `https://${s}`;
}

export function buildSearchUrl(query: string): string {
  return `${SEARCH_URL}${encodeURIComponent(query.trim())}`;
}

export function resolveAddress(input: string): string {
  return isLikelyUrl(input) ? normalizeUrl(input) : buildSearchUrl(input);
}

export function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function faviconFor(url: string): string {
  const host = hostOf(url);
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`;
}

export function prettyTitle(url: string): string {
  const h = hostOf(url);
  if (h && h !== url) return h;
  return url;
}

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */
export interface Tab {
  id: string;
  title: string;
  url: string; // "about:newtab" for the new-tab page
  favicon?: string;
  loading?: boolean;
  zoomFactor?: number; // per-tab page zoom (1 = 100%), applied to the <webview>
  history: string[];
  future: string[];
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 3.0;
export const ZOOM_STEP = 0.2;
export function clampZoom(z: number): number {
  return Math.round(Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z)) * 100) / 100;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  demo?: boolean;
  pending?: boolean;
  /** Agent-run step messages get special rendering in the panel. */
  kind?: "thought" | "action" | "observation" | "blocked" | "approval";
}

export interface CasperStatus {
  connected: boolean;
  baseUrl: string;
  origin?: string;
  models: string[];
  demo: boolean;
  error?: string;
  hint?: string;
}

/* ------------------------------------------------------------------ */
/* Misc                                                                */
/* ------------------------------------------------------------------ */
export function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export type { ReactNode };

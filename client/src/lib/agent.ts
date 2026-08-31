/**
 * Casper's agent loop — a ReAct-style tool loop that lets the model operate
 * the browser through a fixed, validated tool set. The model never emits raw
 * JS; it can only call the tools below, and every argument is validated
 * before execution. Mutating actions respect the autonomy mode:
 *
 * - supervised: every action that changes browser state needs user approval
 * - auto:       actions run automatically (sensitive domains still blocked)
 * - dryrun:     mutating actions are described but never executed
 */

export type AutonomyMode = "supervised" | "auto" | "dryrun";

export interface AgentTabInfo {
  index: number;
  title: string;
  url: string;
  active: boolean;
}

export interface AgentToolbelt {
  listTabs: () => AgentTabInfo[];
  openTab: (url: string) => void;
  closeTab: (index: number) => string | void;
  switchTab: (index: number) => string | void;
  navigate: (url: string) => void;
  readPage: () => Promise<{ url: string; title: string; text: string } | { error: string }>;
  /** Run a fixed, tool-generated script in the active page. Null when unavailable (web preview / New Tab). */
  executeInPage: ((code: string) => Promise<unknown>) | null;
  /** Run a shell command on the configured server node over SSH. */
  sshRun: (command: string) => Promise<{ ok: boolean; output: string; error?: string }>;
  /** URL of the user's server dashboard (local-coder NEO//OPS Ubuntu GUI), if configured. */
  serverGuiUrl: string;
}

export interface AgentAction {
  tool: string;
  args: Record<string, unknown>;
  /** Human-readable description shown in the panel and approval prompt. */
  describe: string;
  mutating: boolean;
}

export interface AgentStepEvent {
  type: "thought" | "action" | "observation" | "blocked" | "final" | "error";
  text: string;
  action?: AgentAction;
}

export interface AgentRunOptions {
  goal: string;
  mode: AutonomyMode;
  toolbelt: AgentToolbelt;
  callAgentStep: (messages: { role: string; content: string }[]) => Promise<{ content?: string; error?: string; hint?: string }>;
  onEvent: (e: AgentStepEvent) => void;
  requestApproval: (action: AgentAction) => Promise<boolean>;
  signal?: AbortSignal;
  maxSteps?: number;
}

/* ------------------------------------------------------------------ */
/* Guardrails                                                          */
/* ------------------------------------------------------------------ */

// Domains Casper must never act on autonomously: banking, payments, email,
// and auth portals. Reading is fine; acting (click/fill/navigate) is not.
const SENSITIVE_HOST_PATTERNS = [
  /(^|\.)paypal\.com$/i,
  /(^|\.)(chase|bankofamerica|wellsfargo|citibank|capitalone|usbank|schwab|fidelity)\.com$/i,
  /(^|\.)(coinbase|binance|kraken)\.(com|us)$/i,
  /(^|\.)mail\.google\.com$/i,
  /(^|\.)outlook\.(com|live\.com)$/i,
  /(^|\.)mail\.yahoo\.com$/i,
  /(^|\.)accounts\.google\.com$/i,
  /(^|\.)login\.(microsoftonline|live)\.com$/i,
  /bank/i,
];

export function isSensitiveUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return SENSITIVE_HOST_PATTERNS.some((p) => p.test(host));
  } catch {
    return false;
  }
}

function validHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* Tool protocol                                                       */
/* ------------------------------------------------------------------ */

export const AGENT_TOOLS_DOC = `You can operate the browser by calling tools. To call a tool, reply with EXACTLY one line in this format (nothing else on the line):

TOOL: toolName {"arg": "value"}

Available tools:
- listTabs {} — list open tabs with their index, title, url, and which is active
- openTab {"url": "https://..."} — open a new tab at the url and switch to it
- closeTab {"index": 0} — close the tab at that index
- switchTab {"index": 0} — make the tab at that index active
- navigate {"url": "https://..."} — navigate the ACTIVE tab to the url
- readPage {} — read the active page's title, url, and visible text
- click {"selector": "css selector"} — click the first element matching the selector on the active page
- fill {"selector": "css selector", "value": "text"} — set the value of the matching input/textarea and dispatch input events
- scroll {"direction": "down"} — scroll the active page ("up", "down", "top", or "bottom")

Server node tools (available when the user has configured a server node in Casper Settings):
- serverStatus {} — health snapshot of the server node (host, uptime, disk, memory, failed services)
- sshRun {"command": "systemctl restart nginx"} — run a shell command on the server node over SSH; use for monitoring, maintenance, service management, log reading, and fixes
- openServerGui {} — open the user's server dashboard (Ubuntu GUI) in a new tab for visual monitoring

Rules:
- Call at most ONE tool per reply. After each call you'll receive an OBSERVATION with the result.
- When the goal is complete (or impossible), reply with your final answer as plain text WITHOUT any TOOL: line. Summarize what you did.
- Never invent tool names or arguments. Never ask to run arbitrary JavaScript.
- Prefer readPage before clicking or filling so you know what's on the page.`;

export function buildAgentSystemPrompt(mode: AutonomyMode): string {
  const modeLine =
    mode === "dryrun"
      ? "You are in DRY RUN mode: actions that would change browser state are simulated, not executed. Still plan them normally."
      : mode === "supervised"
        ? "You are in SUPERVISED mode: the user approves each state-changing action before it runs. If an action is denied, adapt or finish."
        : "You are in AUTONOMOUS mode: approved tools run automatically. Be careful and precise.";
  return `You are Casper, the ghost who haunts Haunted Browser — now acting as the user's browser operator and server caretaker. You complete browsing goals by calling tools, step by step, observing results as you go. Keep your spooky charm to a light touch; precision comes first.\n\n${AGENT_TOOLS_DOC}\n\n${modeLine}\n\nSafety: you must not act on banking, payment, email, or login pages — those actions will be blocked. Do not enter passwords or other credentials anywhere.`;
}

interface ParsedToolCall {
  tool: string;
  args: Record<string, unknown>;
}

export function parseToolCall(content: string): ParsedToolCall | null {
  const m = content.match(/^\s*TOOL:\s*([a-zA-Z]+)\s*(\{[\s\S]*\})?\s*$/m);
  if (!m) return null;
  const tool = m[1];
  let args: Record<string, unknown> = {};
  if (m[2]) {
    try {
      const parsed = JSON.parse(m[2]);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) args = parsed;
    } catch {
      return { tool, args: { __parseError: true } };
    }
  }
  return { tool, args };
}

/** The model's commentary around a TOOL: line, shown as its "thought". */
function thoughtAround(content: string): string {
  return content.replace(/^\s*TOOL:.*$/m, "").trim();
}

/* ------------------------------------------------------------------ */
/* Page scripts (fixed templates — model input is JSON-escaped)        */
/* ------------------------------------------------------------------ */

function clickScript(selector: string): string {
  return `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return {ok:false,error:'no element matches selector'};el.scrollIntoView({block:'center'});el.click();return {ok:true,tag:el.tagName.toLowerCase(),text:(el.innerText||el.value||'').slice(0,120)};})()`;
}

function fillScript(selector: string, value: string): string {
  return `(function(){var el=document.querySelector(${JSON.stringify(selector)});if(!el)return {ok:false,error:'no element matches selector'};var v=${JSON.stringify(value)};var proto=el.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;var d=Object.getOwnPropertyDescriptor(proto,'value');if(d&&d.set){d.set.call(el,v);}else{el.value=v;}el.dispatchEvent(new Event('input',{bubbles:true}));el.dispatchEvent(new Event('change',{bubbles:true}));return {ok:true,tag:el.tagName.toLowerCase()};})()`;
}

function scrollScript(direction: string): string {
  const move =
    direction === "up"
      ? "window.scrollBy(0,-Math.round(window.innerHeight*0.8))"
      : direction === "top"
        ? "window.scrollTo(0,0)"
        : direction === "bottom"
          ? "window.scrollTo(0,document.body.scrollHeight)"
          : "window.scrollBy(0,Math.round(window.innerHeight*0.8))";
  return `(function(){${move};return {ok:true,scrollY:Math.round(window.scrollY)};})()`;
}

/* ------------------------------------------------------------------ */
/* Action resolution + execution                                       */
/* ------------------------------------------------------------------ */


function resolveAction(call: ParsedToolCall): AgentAction | { error: string } {
  const { tool, args } = call;
  if (args.__parseError) return { error: `Could not parse the JSON arguments for ${tool}. Use valid JSON on the TOOL: line.` };
  switch (tool) {
    case "listTabs":
      return { tool, args: {}, describe: "List open tabs", mutating: false };
    case "readPage":
      return { tool, args: {}, describe: "Read the active page", mutating: false };
    case "openTab":
    case "navigate": {
      const url = validHttpUrl(args.url);
      if (!url) return { error: `${tool} needs a valid http(s) "url" argument.` };
      return {
        tool,
        args: { url },
        describe: tool === "openTab" ? `Open a new tab at ${url}` : `Navigate the active tab to ${url}`,
        mutating: true,
      };
    }
    case "closeTab":
    case "switchTab": {
      const index = Number(args.index);
      if (!Number.isInteger(index) || index < 0) return { error: `${tool} needs a non-negative integer "index".` };
      return {
        tool,
        args: { index },
        describe: `${tool === "closeTab" ? "Close" : "Switch to"} tab ${index}`,
        mutating: true,
      };
    }
    case "click": {
      const selector = typeof args.selector === "string" ? args.selector.trim() : "";
      if (!selector || selector.length > 300) return { error: `click needs a css "selector" argument.` };
      return { tool, args: { selector }, describe: `Click "${selector}" on the active page`, mutating: true };
    }
    case "fill": {
      const selector = typeof args.selector === "string" ? args.selector.trim() : "";
      const value = typeof args.value === "string" ? args.value : "";
      if (!selector || selector.length > 300) return { error: `fill needs a css "selector" argument.` };
      if (value.length > 2000) return { error: "fill value is too long." };
      return {
        tool,
        args: { selector, value },
        describe: `Fill "${selector}" with "${value.length > 60 ? value.slice(0, 57) + "…" : value}"`,
        mutating: true,
      };
    }
    case "scroll": {
      const dir = typeof args.direction === "string" ? args.direction : "down";
      if (!["up", "down", "top", "bottom"].includes(dir)) return { error: `scroll direction must be up, down, top, or bottom.` };
      return { tool, args: { direction: dir }, describe: `Scroll ${dir}`, mutating: false };
    }
    case "serverStatus":
      return { tool, args: {}, describe: "Check server node health (uptime, disk, memory, services)", mutating: false };
    case "sshRun": {
      const command = typeof args.command === "string" ? args.command.trim() : "";
      if (!command || command.length > 2000) return { error: `sshRun needs a "command" argument (max 2000 chars).` };
      return {
        tool,
        args: { command },
        describe: `Run on server node: ${command.length > 80 ? command.slice(0, 77) + "…" : command}`,
        mutating: true,
      };
    }
    case "openServerGui":
      return { tool, args: {}, describe: "Open the server dashboard (Ubuntu GUI) in a new tab", mutating: true };
    default:
      return { error: `Unknown tool "${tool}". Use only the documented tools.` };
  }
}

async function executeAction(action: AgentAction, toolbelt: AgentToolbelt): Promise<string> {
  const activeUrl = toolbelt.listTabs().find((t) => t.active)?.url || "";
  const target = action.tool === "openTab" || action.tool === "navigate" ? String(action.args.url) : activeUrl;
  const serverTool = action.tool === "sshRun" || action.tool === "serverStatus" || action.tool === "openServerGui";
  if (action.mutating && !serverTool && isSensitiveUrl(target)) {
    return `BLOCKED: ${action.describe} — acting on sensitive domains (banking, email, auth) is not allowed.`;
  }
  switch (action.tool) {
    case "listTabs":
      return JSON.stringify(toolbelt.listTabs());
    case "openTab":
      toolbelt.openTab(String(action.args.url));
      return `Opened new tab at ${action.args.url}. It may still be loading — readPage to inspect it.`;
    case "closeTab":
      return toolbelt.closeTab(Number(action.args.index)) || `Closed tab ${action.args.index}.`;
    case "switchTab":
      return toolbelt.switchTab(Number(action.args.index)) || `Switched to tab ${action.args.index}.`;
    case "navigate":
      toolbelt.navigate(String(action.args.url));
      return `Navigating the active tab to ${action.args.url}. It may still be loading — readPage to inspect it.`;
    case "readPage": {
      const r = await toolbelt.readPage();
      if ("error" in r) return `ERROR: ${r.error}`;
      return `url: ${r.url}\ntitle: ${r.title}\npage text (truncated):\n${r.text.slice(0, 8000)}`;
    }
    case "serverStatus": {
      const r = await toolbelt.sshRun("__STATUS__");
      return r.ok ? r.output : `ERROR: ${r.error || "server status check failed"}`;
    }
    case "sshRun": {
      const r = await toolbelt.sshRun(String(action.args.command));
      const body = r.output.trim() ? r.output : "(no output)";
      return r.ok ? body : `ERROR: ${r.error || "command failed"}${r.output ? `\n${r.output}` : ""}`;
    }
    case "openServerGui": {
      if (!toolbelt.serverGuiUrl) return "ERROR: no server dashboard URL configured. Set it in Casper Settings.";
      toolbelt.openTab(toolbelt.serverGuiUrl);
      return `Opened the server dashboard at ${toolbelt.serverGuiUrl}. It may still be loading — readPage to inspect it.`;
    }
    case "click":
    case "fill":
    case "scroll": {
      if (!toolbelt.executeInPage) {
        return "ERROR: no live page to act on (New Tab or web preview). Navigate somewhere first.";
      }
      const code =
        action.tool === "click"
          ? clickScript(String(action.args.selector))
          : action.tool === "fill"
            ? fillScript(String(action.args.selector), String(action.args.value))
            : scrollScript(String(action.args.direction));
      try {
        const result = await toolbelt.executeInPage(code);
        return JSON.stringify(result);
      } catch (err) {
        return `ERROR: ${err instanceof Error ? err.message : String(err)}`;
      }
    }
    default:
      return `ERROR: unhandled tool ${action.tool}`;
  }
}

/* ------------------------------------------------------------------ */
/* The loop                                                            */
/* ------------------------------------------------------------------ */

export async function runAgent(opts: AgentRunOptions): Promise<void> {
  const maxSteps = opts.maxSteps ?? 12;
  const convo: { role: string; content: string }[] = [
    { role: "system", content: buildAgentSystemPrompt(opts.mode) },
    { role: "user", content: opts.goal },
  ];

  for (let step = 0; step < maxSteps; step++) {
    if (opts.signal?.aborted) {
      opts.onEvent({ type: "error", text: "Agent run cancelled." });
      return;
    }
    let reply: { content?: string; error?: string; hint?: string };
    try {
      reply = await opts.callAgentStep(convo);
    } catch (err) {
      if (opts.signal?.aborted) {
        opts.onEvent({ type: "error", text: "Agent run cancelled." });
      } else {
        opts.onEvent({ type: "error", text: err instanceof Error ? err.message : String(err) });
      }
      return;
    }
    if (reply.error) {
      opts.onEvent({ type: "error", text: reply.hint ? `${reply.error} — ${reply.hint}` : reply.error });
      return;
    }
    const content = reply.content || "";
    const call = parseToolCall(content);
    if (!call) {
      opts.onEvent({ type: "final", text: content.trim() || "(no reply)" });
      return;
    }

    const thought = thoughtAround(content);
    if (thought) opts.onEvent({ type: "thought", text: thought });

    const resolved = resolveAction(call);
    if ("error" in resolved) {
      opts.onEvent({ type: "blocked", text: resolved.error });
      convo.push({ role: "assistant", content });
      convo.push({ role: "system", content: `OBSERVATION: ${resolved.error}` });
      continue;
    }

    let observation: string;
    if (resolved.mutating && opts.mode === "dryrun") {
      observation = `DRY RUN: would ${resolved.describe.charAt(0).toLowerCase()}${resolved.describe.slice(1)} (not executed). Assume it succeeded and continue planning, or finish with a summary of the plan.`;
      opts.onEvent({ type: "action", text: `[dry run] ${resolved.describe}`, action: resolved });
    } else if (resolved.mutating && opts.mode === "supervised") {
      opts.onEvent({ type: "action", text: `Wants to: ${resolved.describe}`, action: resolved });
      const approved = await opts.requestApproval(resolved);
      if (opts.signal?.aborted) {
        opts.onEvent({ type: "error", text: "Agent run cancelled." });
        return;
      }
      if (!approved) {
        observation = `DENIED: the user declined "${resolved.describe}". Adapt or finish.`;
        opts.onEvent({ type: "blocked", text: `Denied: ${resolved.describe}` });
      } else {
        observation = await executeAction(resolved, opts.toolbelt);
        opts.onEvent({ type: "observation", text: observation });
      }
    } else {
      if (resolved.mutating) opts.onEvent({ type: "action", text: resolved.describe, action: resolved });
      observation = await executeAction(resolved, opts.toolbelt);
      opts.onEvent({ type: "observation", text: observation });
      if (observation.startsWith("BLOCKED:")) {
        opts.onEvent({ type: "blocked", text: observation.slice(9).trim() });
      }
    }

    convo.push({ role: "assistant", content });
    convo.push({ role: "system", content: `OBSERVATION: ${observation}` });
  }
  opts.onEvent({
    type: "final",
    text: "I hit my step limit for this run — here's where things stand. Give me a follow-up goal to continue.",
  });
}

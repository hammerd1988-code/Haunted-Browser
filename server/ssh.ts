/**
 * Casper's SSH bridge to the user's server nodes. Commands run through the
 * system OpenSSH client in BatchMode (key auth only — never interactive
 * password prompts), with hard timeouts and capped output. The HTTP endpoints
 * that call this are loopback-only (see server/index.ts).
 */
import { spawn } from "node:child_process";

export interface SshConfig {
  host: string;
  user: string;
  port: number;
  keyPath: string;
}

export interface SshResult {
  ok: boolean;
  output: string;
  error?: string;
}

const MAX_OUTPUT = 20_000;
const DEFAULT_TIMEOUT_MS = 30_000;

export function sshArgs(cfg: SshConfig, command: string): string[] {
  const args = [
    "-o", "BatchMode=yes",
    "-o", "ConnectTimeout=8",
    "-o", "StrictHostKeyChecking=accept-new",
    "-p", String(cfg.port || 22),
  ];
  if (cfg.keyPath) args.push("-i", cfg.keyPath);
  args.push(`${cfg.user}@${cfg.host}`, command);
  return args;
}

export function runSsh(
  cfg: SshConfig,
  command: string,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<SshResult> {
  return new Promise((resolve) => {
    if (!cfg.host || !cfg.user) {
      return resolve({ ok: false, output: "", error: "No server node configured — set host and user in Casper Settings." });
    }
    const child = spawn("ssh", sshArgs(cfg, command), { windowsHide: true });
    let out = "";
    let err = "";
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, output: out.slice(0, MAX_OUTPUT), error: `Command timed out after ${Math.round(timeoutMs / 1000)}s.` });
    }, timeoutMs);
    child.stdout.on("data", (d) => { if (out.length < MAX_OUTPUT) out += String(d); });
    child.stderr.on("data", (d) => { if (err.length < MAX_OUTPUT) err += String(d); });
    child.on("error", (e) => {
      clearTimeout(timer);
      resolve({ ok: false, output: "", error: `Could not run ssh: ${e.message}. Is OpenSSH installed?` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ ok: true, output: out.slice(0, MAX_OUTPUT) });
      } else {
        resolve({
          ok: false,
          output: out.slice(0, MAX_OUTPUT),
          error: err.trim().slice(0, 2000) || `ssh exited with code ${code}`,
        });
      }
    });
  });
}

/** One-call health snapshot used by the serverStatus agent tool. */
export const STATUS_COMMAND =
  "echo '--- host ---'; hostname; uname -a; echo '--- uptime ---'; uptime; " +
  "echo '--- disk ---'; df -h / 2>/dev/null; echo '--- memory ---'; free -m 2>/dev/null; " +
  "echo '--- load/services ---'; systemctl list-units --state=failed --no-pager 2>/dev/null | head -20";

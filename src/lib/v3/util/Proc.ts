import { spawn } from "node:child_process";
import { ayasCheckEnv } from "../../brain/autonomy/AyasCheckEnv";

export interface ProcResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  /** Set when stdout or stderr reached the in-memory cap and the rest was dropped (a cut JSON never parses). */
  readonly truncated?: boolean;
}

/** The default in-memory cap per stream; a call that reads a large JSON passes `maxOutputBytes`. */
export const PROC_DEFAULT_MAX_OUTPUT = 2 * 1024 * 1024;

export class ProcError extends Error {
  constructor(readonly code: string, message: string, readonly result?: ProcResult) {
    super(`${code}: ${message}`);
  }
}

/**
 * Runs an executable without a shell (arguments are never re-parsed, so Unicode and spaces in paths are
 * safe). `onLine` receives progress lines; output kept in memory is capped.
 */
export function runProcess(
  command: string,
  args: readonly string[],
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; onLine?: (line: string) => void; input?: string; maxOutputBytes?: number } = {},
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const cap = opts.maxOutputBytes ?? PROC_DEFAULT_MAX_OUTPUT;
    let stdout = "", stderr = "";
    let truncated = false;
    let pending = "";
    const feed = (chunk: string) => {
      if (!opts.onLine) return;
      pending += chunk;
      const lines = pending.split(/\r?\n|\r/);
      pending = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) opts.onLine(l);
    };
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    // Kept up to exactly `cap` characters; anything past it is dropped and flagged.
    child.stdout.on("data", (d: string) => {
      if (stdout.length + d.length > cap) truncated = true;
      if (stdout.length < cap) stdout += d.slice(0, cap - stdout.length);
      feed(d);
    });
    child.stderr.on("data", (d: string) => {
      if (stderr.length + d.length > cap) truncated = true;
      if (stderr.length < cap) stderr += d.slice(0, cap - stderr.length);
      feed(d);
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill();
          reject(new ProcError("PROC_TIMEOUT", `${command} ${opts.timeoutMs} ms içinde bitmedi`));
        }, opts.timeoutMs)
      : undefined;
    child.on("error", (e) => {
      if (timer) clearTimeout(timer);
      reject(new ProcError("PROC_START", `${command}: ${e.message}`));
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code: code ?? -1, stdout, stderr, ...(truncated ? { truncated: true } : {}) });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input, "utf8");
    else child.stdin.end();
  });
}

/**
 * The environment the checks of an unattended developer build run with (11 Nov 2026 security review): a copy of
 * `env` without any credential-shaped variable. The rule itself is `ayasCheckEnv` (AyasCheckEnv.ts): since 12 Nov 2026
 * the one list both these checks and the code-apply runner's re-verification use, kept where the code lane refuses
 * every change so a build cannot loosen it. Kept here for its existing callers. Opt-in per call; `runProcess` keeps
 * `process.env` as its default.
 */
export function checkEnv(env: Readonly<Record<string, string | undefined>> = process.env): NodeJS.ProcessEnv {
  return ayasCheckEnv(env) as NodeJS.ProcessEnv;
}

export async function runChecked(command: string, args: readonly string[], opts: Parameters<typeof runProcess>[2] = {}): Promise<ProcResult> {
  const r = await runProcess(command, args, opts);
  if (r.code !== 0) throw new ProcError("PROC_EXIT", `${command} çıkış kodu ${r.code}: ${(r.stderr || r.stdout).slice(-1200)}`, r);
  return r;
}

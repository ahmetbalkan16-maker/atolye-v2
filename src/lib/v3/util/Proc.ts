import { spawn } from "node:child_process";

export interface ProcResult {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

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
  opts: { cwd?: string; env?: NodeJS.ProcessEnv; timeoutMs?: number; onLine?: (line: string) => void; input?: string } = {},
): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: opts.cwd, env: opts.env ?? process.env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    const cap = 2 * 1024 * 1024;
    let stdout = "", stderr = "";
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
    child.stdout.on("data", (d: string) => {
      if (stdout.length < cap) stdout += d;
      feed(d);
    });
    child.stderr.on("data", (d: string) => {
      if (stderr.length < cap) stderr += d;
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
      resolve({ code: code ?? -1, stdout, stderr });
    });
    if (opts.input !== undefined) child.stdin.end(opts.input, "utf8");
    else child.stdin.end();
  });
}

export async function runChecked(command: string, args: readonly string[], opts: Parameters<typeof runProcess>[2] = {}): Promise<ProcResult> {
  const r = await runProcess(command, args, opts);
  if (r.code !== 0) throw new ProcError("PROC_EXIT", `${command} çıkış kodu ${r.code}: ${(r.stderr || r.stdout).slice(-1200)}`, r);
  return r;
}

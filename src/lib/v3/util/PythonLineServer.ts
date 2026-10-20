import { type ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync } from "node:fs";

/**
 * A long-lived Python side process (a model loaded once) speaking one JSON object per line: it prints
 * `{"ready": true, ...}` when loaded, then answers each `{"id": …}` request with `{"id": …, "ok": …}`.
 * `{"cmd": "quit"}` ends it. Used by the TTS engines and the background designer.
 */
export class PythonLineServerError extends Error {
  constructor(readonly code: string, message: string) {
    super(`${code}: ${message}`);
  }
}

export interface PythonLineServerOptions {
  readonly python: string;
  readonly script: string;
  readonly env: NodeJS.ProcessEnv;
  /** Shown in errors and the ready log line. */
  readonly label: string;
  readonly startTimeoutMs: number;
  /**
   * Working folder of the side process (default: this process's). A tool that writes caches into its working folder
   * (ACE-Step's `.cache/`) runs in its own folder: an untracked folder in the repo would stop the Observer.
   */
  readonly cwd?: string;
  readonly requestTimeoutMs: number;
  readonly log: (s: string) => void;
}

export type LineReply = { readonly ok: boolean; readonly error?: string } & Readonly<Record<string, unknown>>;

export class PythonLineServer {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<void>;
  private waiting = new Map<string, (msg: LineReply) => void>();
  private counter = 0;

  constructor(private readonly o: PythonLineServerOptions) {}

  start(): Promise<void> {
    if (this.ready) return this.ready;
    this.ready = (async () => {
      if (!existsSync(this.o.python)) throw new PythonLineServerError("V3_PYTHON_MISSING", this.o.python);
      const child = spawn(this.o.python, ["-u", this.o.script], { env: this.o.env, windowsHide: true, ...(this.o.cwd ? { cwd: this.o.cwd } : {}) });
      this.child = child;
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      let buffer = "";
      let resolveReady!: () => void, rejectReady!: (e: Error) => void;
      const readyPromise = new Promise<void>((res, rej) => ((resolveReady = res), (rejectReady = rej)));
      child.stdout.on("data", (d: string) => {
        buffer += d;
        const lines = buffer.split(/\r?\n/);
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim().startsWith("{")) continue;
          const msg = JSON.parse(line) as LineReply & { ready?: boolean; id?: string; device?: string; load_seconds?: number };
          if (msg.ready) {
            this.o.log(`${this.o.label} hazır (${msg.device ?? "?"}, ${msg.load_seconds ?? "?"} sn)`);
            resolveReady();
          } else if (msg.id && this.waiting.has(msg.id)) {
            this.waiting.get(msg.id)!(msg);
            this.waiting.delete(msg.id);
          }
        }
      });
      let stderrTail = "";
      child.stderr.on("data", (d: string) => {
        stderrTail = (stderrTail + d).slice(-4000);
      });
      child.on("exit", (code) => {
        rejectReady(new PythonLineServerError("V3_PYTHON_EXIT", `${this.o.label} süreci kapandı (${code}): ${stderrTail.slice(-800)}`));
        for (const [, cb] of this.waiting) cb({ ok: false, error: `süreç kapandı (${code})` });
        this.waiting.clear();
        this.child = undefined;
        this.ready = undefined;
      });
      const timer = setTimeout(() => rejectReady(new PythonLineServerError("V3_PYTHON_START_TIMEOUT", `${this.o.label} ${Math.round(this.o.startTimeoutMs / 60000)} dk içinde yüklenmedi`)), this.o.startTimeoutMs);
      await readyPromise.finally(() => clearTimeout(timer));
    })();
    return this.ready;
  }

  /** Sends one request (an `id` is added) and waits for its answer; a timeout answers `ok: false`. */
  async request(body: Readonly<Record<string, unknown>>): Promise<LineReply> {
    await this.start();
    const id = `r${++this.counter}`;
    const reply = new Promise<LineReply>((resolve) => this.waiting.set(id, resolve));
    this.child!.stdin.write(JSON.stringify({ id, ...body }) + "\n", "utf8");
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<LineReply>((resolve) => (timer = setTimeout(() => resolve({ ok: false, error: `istek ${Math.round(this.o.requestTimeoutMs / 1000)} sn içinde bitmedi` }), this.o.requestTimeoutMs)));
    try {
      return await Promise.race([reply, timeout]);
    } finally {
      clearTimeout(timer);
    }
  }

  async close(): Promise<void> {
    if (!this.child) return;
    this.child.stdin.write(JSON.stringify({ cmd: "quit" }) + "\n");
    await new Promise((r) => setTimeout(r, 300));
    this.child?.kill();
  }
}

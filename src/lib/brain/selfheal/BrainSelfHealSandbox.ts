/**
 * Atölye Brain — Self-Healing: git-worktree sandbox (Node, operator-CLI only).
 *
 * Emir §7. A patch is NEVER applied to the live working tree by the loop. It is
 * built + tested in an isolated `git worktree` under a dedicated dir, and only
 * an explicit operator `apply` copies a VERIFIED change back.
 *
 *   CREATE   git worktree add <sandboxDir> <baseCommit>   (detached)
 *   PATCH    write the changed files into the worktree
 *   TEST     run whitelisted argv IN the worktree (cwd = sandboxDir)
 *   DESTROY  git worktree remove --force <sandboxDir>
 *
 * Every command passes `assertSelfHealActionAllowed` first: no `git push`, no
 * `remote`, no network egress, no `.env` reads. `execFile`, never a shell.
 *
 * FORBIDDEN for the Brain to self-modify (BrainPatchSafety) — and it is never
 * imported by the browser bundle or the autonomous loop; only by
 * `scripts/selfheal-*.ts`.
 */

import { execFile } from "node:child_process";
import { promises as fsp } from "node:fs";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { assertSelfHealActionAllowed, isSecretPath } from "./BrainSelfHealGuards";
import { classifyPatchSet } from "./BrainPatchSafety";

const ASCII_SHA = /^[0-9a-f]{7,40}$/i;

export interface SandboxCommandResult {
  readonly argv: readonly string[];
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly ms: number;
}

export interface BrainSelfHealSandboxOptions {
  /** Repo root (must be a git repo). Defaults to `process.cwd()`. */
  readonly repoRoot?: string;
  /** Parent dir for worktrees. Defaults to `<os.tmpdir()>/atolye-selfheal`. */
  readonly parentDir?: string;
  /** Per-command timeout (ms). */
  readonly commandTimeoutMs?: number;
  /** Injectable runner (tests). */
  readonly run?: (argv: readonly string[], cwd: string, timeoutMs: number) => Promise<SandboxCommandResult>;
}

export interface BrainSelfHealSandboxHandle {
  readonly dir: string;
  readonly baseCommit: string;
  /** Write files into the worktree. Rejects a path outside the tree / a secret / a FORBIDDEN target. */
  applyFiles(files: readonly { readonly path: string; readonly content: string }[]): Promise<void>;
  /** Run a whitelisted command in the worktree. */
  command(argv: readonly string[]): Promise<SandboxCommandResult>;
  /** `git diff` of the worktree vs its base — the candidate patch. */
  diff(): Promise<{ diff: string; changedFiles: string[]; diffLines: number }>;
  destroy(): Promise<void>;
}

function defaultRun(argv: readonly string[], cwd: string, timeoutMs: number): Promise<SandboxCommandResult> {
  const started = Date.now();
  return new Promise((resolve) => {
    execFile(
      argv[0],
      argv.slice(1),
      { cwd, timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024, killSignal: "SIGKILL" },
      (error, stdout, stderr) => {
        const e = error as (NodeJS.ErrnoException & { killed?: boolean }) | null;
        resolve({
          argv: [...argv],
          code: e && typeof e.code === "number" ? e.code : e ? 1 : 0,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
          timedOut: Boolean(e?.killed) || /ETIMEDOUT/.test(String(e?.code ?? "")),
          ms: Date.now() - started,
        });
      },
    );
  });
}

export async function createBrainSelfHealSandbox(
  baseCommit: string,
  options: BrainSelfHealSandboxOptions = {},
): Promise<BrainSelfHealSandboxHandle> {
  if (!ASCII_SHA.test(baseCommit) && baseCommit !== "HEAD") {
    throw new Error(`refusing to create a sandbox at a non-sha base: ${JSON.stringify(baseCommit)}`);
  }
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const parent = options.parentDir ?? path.join(os.tmpdir(), "atolye-selfheal");
  const timeoutMs = options.commandTimeoutMs ?? 10 * 60 * 1000;
  const run = options.run ?? defaultRun;

  await fsp.mkdir(parent, { recursive: true });
  const dir = await fsp.mkdtemp(path.join(parent, "wt-"));

  const createVerdict = assertSelfHealActionAllowed({ kind: "sandbox-create" });
  if (!createVerdict.allowed) throw new Error(`sandbox create denied: ${createVerdict.reason}`);

  const add = await run(["git", "-C", repoRoot, "worktree", "add", "--detach", dir, baseCommit], repoRoot, timeoutMs);
  if (add.code !== 0) {
    await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`git worktree add failed: ${add.stderr.slice(0, 400)}`);
  }
  const resolvedBase = (await run(["git", "-C", dir, "rev-parse", "HEAD"], dir, timeoutMs)).stdout.trim() || baseCommit;

  const handle: BrainSelfHealSandboxHandle = {
    dir,
    baseCommit: resolvedBase,

    async applyFiles(files) {
      const verdict = classifyPatchSet(files.map((f) => f.path));
      if (verdict.forbidden.length > 0) {
        throw new Error(`refusing to patch a FORBIDDEN_AUTONOMOUS target in the sandbox: ${verdict.forbidden.map((f) => f.path).join(", ")}`);
      }
      for (const f of files) {
        const rel = f.path.replace(/\\/g, "/");
        if (rel.startsWith("/") || rel.includes("..") || isSecretPath(rel)) {
          throw new Error(`refusing to write ${JSON.stringify(rel)} in the sandbox`);
        }
        const abs = path.join(dir, rel);
        if (!abs.startsWith(dir + path.sep) && abs !== dir) {
          throw new Error(`path escapes the sandbox: ${rel}`);
        }
        await fsp.mkdir(path.dirname(abs), { recursive: true });
        await fsp.writeFile(abs, f.content, "utf-8");
      }
    },

    async command(argv) {
      const verdict = assertSelfHealActionAllowed({ kind: "sandbox-command", argv });
      if (!verdict.allowed) throw new Error(`command denied: ${verdict.reason}`);
      return run(argv, dir, timeoutMs);
    },

    async diff() {
      const nameOnly = await run(["git", "-C", dir, "diff", "--name-only"], dir, timeoutMs);
      const full = await run(["git", "-C", dir, "diff", "--unified=3"], dir, timeoutMs);
      const changedFiles = nameOnly.stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const diffLines = full.stdout.split(/\r?\n/).filter((l) => /^[+-]/.test(l) && !/^[+-]{3} /.test(l)).length;
      return { diff: full.stdout, changedFiles, diffLines };
    },

    async destroy() {
      await run(["git", "-C", repoRoot, "worktree", "remove", "--force", dir], repoRoot, timeoutMs).catch(() => ({}) as SandboxCommandResult);
      await fsp.rm(dir, { recursive: true, force: true }).catch(() => {});
    },
  };

  return handle;
}

/** Best-effort cleanup of stale sandbox worktrees (operator maintenance). */
export async function pruneBrainSelfHealSandboxes(options: BrainSelfHealSandboxOptions = {}): Promise<number> {
  const repoRoot = path.resolve(options.repoRoot ?? process.cwd());
  const parent = options.parentDir ?? path.join(os.tmpdir(), "atolye-selfheal");
  const run = options.run ?? defaultRun;
  await run(["git", "-C", repoRoot, "worktree", "prune"], repoRoot, 60_000).catch(() => ({}) as SandboxCommandResult);
  let removed = 0;
  try {
    for (const entry of fs.readdirSync(parent)) {
      if (!entry.startsWith("wt-")) continue;
      fs.rmSync(path.join(parent, entry), { recursive: true, force: true });
      removed += 1;
    }
  } catch {
    /* nothing to prune */
  }
  return removed;
}

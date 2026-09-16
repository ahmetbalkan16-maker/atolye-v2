import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * M18 — the ONE persistent, server-owned integration surface where
 * validated MICRO_SAFE patches accumulate, outside the real repository, so
 * the real working tree stays clean while discovery keeps running. This is
 * the single genuinely new mechanism M18 adds; everything else (patch
 * drafting, per-item sandbox validation, bounded writes, rollback) reuses
 * the M17 `AyasPatchSandbox`/`AyasBoundedFileWrite`/`AyasPatchArtifact`
 * machinery unchanged.
 *
 * Unlike an M17 sandbox (created fresh, destroyed after one candidate),
 * this worktree is long-lived: it is created once at a given `baseHead` and
 * reused across many discovery ticks as items accumulate. It is torn down
 * and recreated only when the real branch's trusted HEAD moves past the
 * worktree's own `baseHead` (see `ensureAyasMicroBatchWorktree`'s rebuild
 * path) — the batch-level analogue of M17's baseHead staleness handling.
 *
 * Location: a FIXED path under `os.tmpdir()` (never inside this repo, never
 * a random-per-call path like M17's sandboxes) so it can be found again
 * across process restarts — the durable pointer that makes it "persistent"
 * is this fixed, well-known path plus the on-disk git worktree metadata
 * itself (its own HEAD is the source of truth for what baseHead it's at).
 */
const AYAS_MICRO_BATCH_WORKTREE_DIRNAME = "ayas-micro-batch-worktree";

export class AyasMicroBatchWorktreeError extends Error {
  constructor(readonly code: "AYAS_MICRO_BATCH_WORKTREE_CREATE_FAILED" | "AYAS_MICRO_BATCH_WORKTREE_REBUILD_FAILED", message: string) {
    super(message);
    this.name = "AyasMicroBatchWorktreeError";
    this.stack = undefined;
  }
}

export interface AyasMicroBatchWorktreeHandle {
  readonly repoRoot: string;
  readonly worktreeRoot: string;
  readonly baseHead: string;
}

async function git(cwd: string, args: readonly string[], timeout = 30_000): Promise<string> {
  const { stdout } = await execFileAsync("git", [...args], { cwd, encoding: "utf8", windowsHide: true, timeout, maxBuffer: 4_000_000 });
  return stdout;
}

function resolveAyasMicroBatchWorktreeRoot(): string {
  return path.join(os.tmpdir(), AYAS_MICRO_BATCH_WORKTREE_DIRNAME);
}

function linkNodeModules(repoRoot: string, worktreeRoot: string): void {
  try {
    const real = path.join(repoRoot, "node_modules");
    const link = path.join(worktreeRoot, "node_modules");
    if (fs.existsSync(real) && !fs.existsSync(link)) fs.symlinkSync(real, link, process.platform === "win32" ? "junction" : "dir");
  } catch { /* validators degrade to "unavailable", never a hard crash — matches AyasPatchSandbox's own posture */ }
}

async function isValidWorktreeAt(repoRoot: string, worktreeRoot: string, expectedHead: string): Promise<boolean> {
  if (!fs.existsSync(path.join(worktreeRoot, ".git"))) return false;
  try {
    const list = await git(repoRoot, ["worktree", "list", "--porcelain"]);
    if (!list.includes(worktreeRoot.replace(/\\/g, "/")) && !list.toLowerCase().includes(worktreeRoot.toLowerCase())) return false;
    const head = (await git(worktreeRoot, ["rev-parse", "HEAD"])).trim();
    return head === expectedHead;
  } catch {
    return false;
  }
}

async function destroyIfPresent(repoRoot: string, worktreeRoot: string): Promise<void> {
  try { await git(repoRoot, ["worktree", "remove", "--force", worktreeRoot]); } catch { /* may already be gone */ }
  try { fs.rmSync(worktreeRoot, { recursive: true, force: true }); } catch { /* best-effort */ }
  try { await git(repoRoot, ["worktree", "prune"]); } catch { /* best-effort */ }
}

/**
 * Idempotent: if a valid worktree already exists at exactly `baseHead`,
 * reuses it as-is (accumulated items remain). If it exists but at a
 * DIFFERENT head (real branch moved on), it is destroyed and rebuilt fresh
 * at the new `baseHead` — callers are responsible for re-integrating any
 * still-valid micro items afterward (see `AyasMicroBatchAccumulator.ts`).
 * If it doesn't exist at all, it is created fresh.
 */
export async function ensureAyasMicroBatchWorktree(repoRoot: string, baseHead: string): Promise<{ readonly handle: AyasMicroBatchWorktreeHandle; readonly rebuilt: boolean }> {
  const worktreeRoot = resolveAyasMicroBatchWorktreeRoot();
  const valid = await isValidWorktreeAt(repoRoot, worktreeRoot, baseHead);
  if (valid) return { handle: { repoRoot, worktreeRoot, baseHead }, rebuilt: false };

  await destroyIfPresent(repoRoot, worktreeRoot);
  try {
    await git(repoRoot, ["worktree", "add", "--detach", "--force", worktreeRoot, baseHead]);
  } catch (error) {
    throw new AyasMicroBatchWorktreeError("AYAS_MICRO_BATCH_WORKTREE_CREATE_FAILED", error instanceof Error ? error.message : String(error));
  }
  linkNodeModules(repoRoot, worktreeRoot);
  return { handle: { repoRoot, worktreeRoot, baseHead }, rebuilt: true };
}

/** True only when the worktree's own on-disk HEAD still matches `handle.baseHead` — a cheap, direct staleness check independent of any cached in-memory state. */
export async function isAyasMicroBatchWorktreeCurrent(handle: AyasMicroBatchWorktreeHandle): Promise<boolean> {
  return isValidWorktreeAt(handle.repoRoot, handle.worktreeRoot, handle.baseHead);
}

/** `git diff` of the worktree against its own baseHead — the combined batch diff, for human review. Uses `git add -N` (intent-to-add only) first, exactly like `AyasPatchSandbox.captureAyasPatchSandboxDiff`, since every accumulated item is currently a brand-new untracked file. */
export async function captureAyasMicroBatchWorktreeDiff(handle: AyasMicroBatchWorktreeHandle): Promise<string> {
  try {
    await git(handle.worktreeRoot, ["add", "-N", "-A"], 15_000);
    return await git(handle.worktreeRoot, ["diff", "--no-color", handle.baseHead, "--"], 15_000);
  } catch {
    return "";
  }
}

/** Permanently discards the persistent worktree and everything accumulated in it — used after a batch is fully executed/committed (a fresh one starts accumulating the next batch) or when explicitly resetting. Never called merely because discovery found nothing this tick. */
export async function destroyAyasMicroBatchWorktree(repoRoot: string): Promise<void> {
  await destroyIfPresent(repoRoot, resolveAyasMicroBatchWorktreeRoot());
}

export { resolveAyasMicroBatchWorktreeRoot };

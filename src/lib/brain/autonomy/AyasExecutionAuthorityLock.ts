import { execFile } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

/**
 * Durable mutual exclusion for a single `gateRoot`, modeled on this
 * project's proven convention (`PipelineJobMutationLock.ts`): exclusive
 * atomic directory creation, atomic owner publication (temp file +
 * rename), PID-*and*-process-start-time liveness verification (so a
 * reused PID can never impersonate the original owner), and a
 * double-observation-then-quarantine-then-delete reclaim protocol for a
 * genuinely stale lock — never a blind delete of a live path. This module
 * has no dependency on the approval store, the daemon, or the execution
 * gate — it only knows how to exclude concurrent callers from one
 * filesystem root.
 */
export type AyasExecutionAuthorityLockErrorCode =
  | "AYAS_LOCK_BUSY"
  | "AYAS_LOCK_IO"
  | "AYAS_LOCK_OWNERSHIP_CHANGED"
  | "AYAS_LOCK_OWNER_INVALID";

export class AyasExecutionAuthorityLockError extends Error {
  constructor(readonly code: AyasExecutionAuthorityLockErrorCode, message: string) {
    super(message);
    this.name = "AyasExecutionAuthorityLockError";
    this.stack = undefined;
  }
}

interface LockOwner {
  readonly schemaVersion: "1";
  readonly gateRoot: string;
  readonly ownerNonce: string;
  readonly pid: number;
  readonly processStartEpochMs: number;
  readonly acquiredAt: string;
}

const execFileAsync = promisify(execFile);
const DEFAULT_STALE_AFTER_MS = 10 * 60_000;
const DEFAULT_ACQUIRE_RETRY_LIMIT = 50;
const DEFAULT_ACQUIRE_RETRY_DELAY_MS = 20;
const DOUBLE_OBSERVATION_DELAY_MS = 30;

export interface AyasExecutionAuthorityLockOptions {
  /** How old (by lock-directory mtime) an unresponsive-owner lock must be before it's even considered for reclaim. */
  readonly staleAfterMs?: number;
  /** Bounded retry budget while a lock looks busy — NOT a queue: a genuinely live concurrent owner causes this to exhaust and throw `AYAS_LOCK_BUSY`, never an indefinite wait. */
  readonly acquireRetryLimit?: number;
  readonly acquireRetryDelayMs?: number;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

async function readProcessStartEpochMs(pid: number): Promise<number> {
  if (process.platform === "win32") {
    const script = `$p=Get-Process -Id ${pid} -ErrorAction Stop;([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds()`;
    const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 3_000, windowsHide: true });
    const value = Number(stdout.trim());
    if (!Number.isSafeInteger(value)) throw new Error("process start time unavailable");
    return value;
  }
  const [stat, system, ticksResult] = await Promise.all([
    fs.readFile(`/proc/${pid}/stat`, "utf8"),
    fs.readFile("/proc/stat", "utf8"),
    execFileAsync("getconf", ["CLK_TCK"], { timeout: 3_000 }),
  ]);
  const end = stat.lastIndexOf(")");
  const fields = stat.slice(end + 2).split(" ");
  const startTicks = Number(fields[19]);
  const boot = Number(/^btime\s+(\d+)$/m.exec(system)?.[1]);
  const ticks = Number(ticksResult.stdout.trim());
  const value = Math.round((boot + startTicks / ticks) * 1_000);
  if (![startTicks, boot, ticks, value].every(Number.isFinite)) throw new Error("process start time unavailable");
  return value;
}

/**
 * `true` only if `owner.pid` is currently alive AND its OS-reported start
 * time matches what was recorded — a reused PID (a different process that
 * happens to share the same number) is correctly treated as NOT the same
 * live owner, so its lock remains reclaimable despite the PID appearing
 * "alive". Any uncertainty (can't read start time, race, permission,
 * platform issue) fails closed toward "still the same live owner", so a
 * possibly-live process is never reclaimed out from under itself.
 */
async function sameLiveProcess(owner: LockOwner): Promise<boolean> {
  if (!processIsAlive(owner.pid)) return false;
  try {
    const currentStart = await readProcessStartEpochMs(owner.pid);
    return Math.abs(currentStart - owner.processStartEpochMs) <= 1_000;
  } catch {
    return true;
  }
}

function parseOwner(bytes: string): LockOwner {
  const value = JSON.parse(bytes) as Partial<LockOwner>;
  if (value?.schemaVersion !== "1" || typeof value.gateRoot !== "string" || typeof value.ownerNonce !== "string" || value.ownerNonce.length === 0 ||
    !Number.isSafeInteger(value.pid) || (value.pid ?? 0) <= 0 || !Number.isSafeInteger(value.processStartEpochMs) || typeof value.acquiredAt !== "string") {
    throw new AyasExecutionAuthorityLockError("AYAS_LOCK_OWNER_INVALID", "lock owner.json is structurally invalid");
  }
  return value as LockOwner;
}

/**
 * Attempts to reclaim `lockDir` if it is genuinely stale: old enough, AND
 * its recorded owner is confirmed not the same live process. Uses a
 * double-observation protocol (read, wait, re-read, compare) before ever
 * touching the filesystem, then an atomic rename-to-quarantine (never a
 * direct delete of the live path) so a legitimate new owner that raced in
 * between is never destroyed. Returns `true` only if a stale lock was
 * actually removed.
 */
async function tryReclaimStaleLock(lockDir: string, staleAfterMs: number): Promise<boolean> {
  const ownerFile = path.join(lockDir, "owner.json");
  let firstStat: Awaited<ReturnType<typeof fs.stat>>;
  let firstBytes: string;
  let firstOwner: LockOwner;
  try {
    firstStat = await fs.stat(lockDir);
    firstBytes = await fs.readFile(ownerFile, "utf8");
    firstOwner = parseOwner(firstBytes);
  } catch {
    // Lock vanished (released concurrently) or owner.json not yet published
    // by its creator (a benign race) — not ours to reclaim; the caller's
    // own mkdir retry will sort itself out.
    return false;
  }
  if (Date.now() - firstStat.mtimeMs <= staleAfterMs) return false;
  if (await sameLiveProcess(firstOwner)) return false;

  await delay(DOUBLE_OBSERVATION_DELAY_MS);
  let secondBytes: string;
  try { secondBytes = await fs.readFile(ownerFile, "utf8"); } catch { return false; }
  if (secondBytes !== firstBytes) return false;

  const quarantine = path.join(path.dirname(lockDir), `.execution-authority-lock.stale-${crypto.randomUUID()}`);
  try {
    await fs.rename(lockDir, quarantine);
  } catch {
    return false; // someone else raced us to it — they win, caller retries mkdir
  }
  const capturedBytes = await fs.readFile(path.join(quarantine, "owner.json"), "utf8").catch(() => undefined);
  await fs.rm(quarantine, { recursive: true, force: true }).catch(() => { /* best effort */ });
  if (capturedBytes !== firstBytes) {
    throw new AyasExecutionAuthorityLockError("AYAS_LOCK_OWNERSHIP_CHANGED", "reclaimed lock identity did not match the observed stale owner");
  }
  return true;
}

async function releaseOwnedLock(lockDir: string, expectedBytes: string): Promise<void> {
  const ownerFile = path.join(lockDir, "owner.json");
  let actualBytes: string;
  try { actualBytes = await fs.readFile(ownerFile, "utf8"); }
  catch { return; } // already gone — best-effort release
  if (actualBytes !== expectedBytes) {
    throw new AyasExecutionAuthorityLockError("AYAS_LOCK_OWNERSHIP_CHANGED", "lock ownership changed before release — refusing to remove a lock this call does not own");
  }
  await fs.rm(lockDir, { recursive: true, force: true });
}

/**
 * Runs `operation` while holding exclusive ownership of `gateRoot`'s
 * execution-authority lock. A second concurrent call against the SAME
 * `gateRoot` is rejected (bounded retry against a busy-but-not-yet-stale
 * lock, then `AYAS_LOCK_BUSY` — never an indefinite wait, never a silent
 * interleave). Calls against different `gateRoot`s never contend.
 */
export async function withAyasExecutionAuthorityLock<T>(
  gateRoot: string,
  operation: () => Promise<T>,
  options: AyasExecutionAuthorityLockOptions = {},
): Promise<T> {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  const retryLimit = options.acquireRetryLimit ?? DEFAULT_ACQUIRE_RETRY_LIMIT;
  const retryDelayMs = options.acquireRetryDelayMs ?? DEFAULT_ACQUIRE_RETRY_DELAY_MS;
  const canonicalRoot = path.resolve(gateRoot);
  const executionDir = path.join(canonicalRoot, "execution");
  const lockDir = path.join(executionDir, ".authority-lock");
  const ownerFile = path.join(lockDir, "owner.json");

  await fs.mkdir(executionDir, { recursive: true });

  const owner: LockOwner = {
    schemaVersion: "1",
    gateRoot: canonicalRoot,
    ownerNonce: crypto.randomUUID(),
    pid: process.pid,
    processStartEpochMs: await readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000)),
    acquiredAt: new Date().toISOString(),
  };
  const ownerBytes = `${JSON.stringify(owner)}\n`;

  let acquired = false;
  for (let attempt = 0; attempt <= retryLimit; attempt++) {
    try {
      await fs.mkdir(lockDir);
      acquired = true;
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") {
        throw new AyasExecutionAuthorityLockError("AYAS_LOCK_IO", error instanceof Error ? error.message : String(error));
      }
      const reclaimed = await tryReclaimStaleLock(lockDir, staleAfterMs);
      if (reclaimed) continue;
      if (attempt === retryLimit) throw new AyasExecutionAuthorityLockError("AYAS_LOCK_BUSY", `execution authority lock busy at ${lockDir}`);
      await delay(retryDelayMs);
    }
  }
  if (!acquired) throw new AyasExecutionAuthorityLockError("AYAS_LOCK_BUSY", `execution authority lock busy at ${lockDir}`);

  try {
    const tmp = path.join(lockDir, `.owner.${process.pid}.${crypto.randomUUID()}.tmp`);
    const handle = await fs.open(tmp, "wx");
    try { await handle.writeFile(ownerBytes, "utf8"); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(tmp, ownerFile);
  } catch (error) {
    await fs.rm(lockDir, { recursive: true, force: true }).catch(() => { /* best effort */ });
    throw new AyasExecutionAuthorityLockError("AYAS_LOCK_IO", error instanceof Error ? error.message : String(error));
  }

  try {
    return await operation();
  } finally {
    await releaseOwnedLock(lockDir, ownerBytes);
  }
}

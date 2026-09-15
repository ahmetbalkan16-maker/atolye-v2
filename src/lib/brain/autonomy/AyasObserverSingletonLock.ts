/**
 * AYAS autonomy observer singleton lock (M9).
 *
 * A deliberately LIGHTER-WEIGHT, distinct lock domain from the M3
 * execution-authority mutual-exclusion primitive — this only prevents two
 * observer processes from running concurrently; it never gates a
 * mutation, an approval, or a gate transition, and the observer itself
 * never touches any of those either. A stolen or double-acquired lock
 * here has a low blast radius (at most a racy write to the observer's own
 * low-stakes state file) — so this stays a small, self-contained
 * PID-liveness check rather than the full M3-style protocol
 * (process-start-time cross-check, double-observation-then-quarantine).
 * The two domains are kept intentionally separate rather than merged or
 * duplicated.
 *
 * Fixes a real gap in the pre-M9 inline version of this lock (in
 * `scripts/ayas-autonomy-daemon.ts`): staleness was judged by the lock
 * file's mtime ALONE, with no check on whether the recorded PID was still
 * alive. The lock is written once at acquisition and never refreshed, so
 * a genuinely healthy `--continuous` observer running longer than the
 * staleness window could have its own live lock "stolen" by a second
 * launch attempt. Reclaim now requires BOTH conditions.
 */

import fs from "node:fs";

export interface AyasObserverLockOptions {
  /** How old (by lock-file mtime) an unresponsive-owner lock must be before it's even considered for reclaim. */
  readonly staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60_000;

export class AyasObserverLockError extends Error {
  constructor(readonly code: "AYAS_OBSERVER_ALREADY_RUNNING", message: string) {
    super(message);
    this.name = "AyasObserverLockError";
    this.stack = undefined;
  }
}

function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

function readLockPid(lockFile: string): number | null {
  try {
    const pid = Number(fs.readFileSync(lockFile, "utf8").trim());
    return Number.isSafeInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/**
 * Acquires the observer singleton lock at `lockFile` (creating
 * `autonomyDir` first). Reclaims an existing lock only when it is BOTH old
 * (mtime older than `staleAfterMs`) AND its recorded PID is confirmed not
 * alive — an aged lock whose process is still genuinely running is never
 * stolen, no matter how long that process has been alive. An unreadable
 * or malformed lock file (no parseable PID) fails closed toward "treat as
 * still live" — it is never reclaimed merely because it couldn't be read.
 */
export function acquireAyasObserverLock(autonomyDir: string, lockFile: string, options: AyasObserverLockOptions = {}): void {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  fs.mkdirSync(autonomyDir, { recursive: true });
  try {
    const fd = fs.openSync(lockFile, "wx");
    try { fs.writeFileSync(fd, `${process.pid}\n`, "utf8"); } finally { fs.closeSync(fd); }
    return;
  } catch (error) {
    let stat: ReturnType<typeof fs.statSync>;
    try {
      stat = fs.statSync(lockFile);
    } catch {
      throw new AyasObserverLockError("AYAS_OBSERVER_ALREADY_RUNNING", error instanceof Error ? error.message : String(error));
    }
    const age = Date.now() - stat.mtimeMs;
    const lockedPid = readLockPid(lockFile);
    const ownerConfirmedAlive = lockedPid === null || processIsAlive(lockedPid);
    if (age > staleAfterMs && !ownerConfirmedAlive) {
      try {
        fs.rmSync(lockFile);
      } catch {
        throw new AyasObserverLockError("AYAS_OBSERVER_ALREADY_RUNNING", `observer lock at ${lockFile} is held and could not be reclaimed`);
      }
      acquireAyasObserverLock(autonomyDir, lockFile, options);
      return;
    }
    throw new AyasObserverLockError(
      "AYAS_OBSERVER_ALREADY_RUNNING",
      lockedPid !== null && ownerConfirmedAlive
        ? `an AYAS autonomy observer (pid ${lockedPid}) is already running`
        : `observer lock at ${lockFile} is held (age ${Math.round(age / 1000)}s, below the ${Math.round(staleAfterMs / 1000)}s staleness window or its owner could not be confirmed dead)`,
    );
  }
}

export function releaseAyasObserverLock(lockFile: string): void {
  try { fs.rmSync(lockFile, { force: true }); } catch { /* best effort */ }
}

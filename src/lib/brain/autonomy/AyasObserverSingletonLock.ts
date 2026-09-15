/**
 * AYAS autonomy observer singleton lock (M9, hardened M12).
 *
 * A deliberately LIGHTER-WEIGHT, distinct lock domain from the M3
 * execution-authority mutual-exclusion primitive — this only prevents two
 * observer processes from running concurrently; it never gates a
 * mutation, an approval, or a gate transition, and the observer itself
 * never touches any of those either. A stolen or double-acquired lock here
 * has a low blast radius (at most a racy write to the observer's own
 * low-stakes state file). The two domains stay separate; only the pure,
 * side-effect-free process-identity helpers (`AyasProcessLiveness.ts`) are
 * shared between them, to avoid two drifting copies of the same check.
 *
 * M12 fix: a lock whose owner PID is POSITIVELY confirmed dead (or whose
 * process-start-time no longer matches — a different process reusing the
 * same PID number) is now reclaimed promptly, with a double-observation
 * race check, instead of always waiting out the full `staleAfterMs`
 * window. A lock whose liveness genuinely cannot be determined (the
 * identity check itself fails) still falls back to the original,
 * conservative age-gated policy — unchanged from before this fix. A lock
 * whose owner is confirmed alive is NEVER reclaimed, regardless of age —
 * this invariant is unchanged and is not weakened by the above.
 */

import fs from "node:fs";

import { processIsAlive, readProcessStartEpochMs } from "./AyasProcessLiveness";

export interface AyasObserverLockOptions {
  /** How old (by lock-file mtime) a lock whose liveness could NOT be determined must be before it's even considered for reclaim. A positively confirmed-dead owner does not wait for this. */
  readonly staleAfterMs?: number;
}

const DEFAULT_STALE_AFTER_MS = 30 * 60_000;
/** Delay between the two observations a reclaim requires before touching anything — long enough to catch a genuinely concurrent acquire/release race, short enough that a confirmed-dead owner's lock is not left blocking for any meaningful time. */
const DOUBLE_OBSERVATION_DELAY_MS = 50;

export class AyasObserverLockError extends Error {
  constructor(readonly code: "AYAS_OBSERVER_ALREADY_RUNNING", message: string) {
    super(message);
    this.name = "AyasObserverLockError";
    this.stack = undefined;
  }
}

interface LockOwnerRecord {
  readonly pid: number;
  /** Absent for a lock written by a pre-M12 observer (bare-PID format) — treated as "no identity to cross-check", never a reason to distrust an alive PID. */
  readonly processStartEpochMs?: number;
}

/**
 * Reads the lock file as either the current JSON owner record or the
 * legacy bare-integer-PID format a pre-M12 observer wrote — both are
 * valid, real ownership records. Anything else (unreadable, empty,
 * non-numeric, non-positive) is malformed and returns `null`, which the
 * caller treats as "never reclaim" — fail closed, unchanged from before.
 */
function readLockOwner(lockFile: string): LockOwnerRecord | null {
  let text: string;
  try {
    text = fs.readFileSync(lockFile, "utf8").trim();
  } catch {
    return null;
  }
  // `JSON.parse` succeeds on a bare number too (e.g. the legacy "12345\n"
  // format), so a plain `try { JSON.parse } catch { legacy }` would never
  // reach the legacy branch for that exact format — check the parsed
  // SHAPE explicitly instead of relying on `JSON.parse` throwing.
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const obj = parsed as Partial<LockOwnerRecord>;
      if (Number.isSafeInteger(obj.pid) && (obj.pid as number) > 0) {
        return {
          pid: obj.pid as number,
          ...(Number.isSafeInteger(obj.processStartEpochMs) ? { processStartEpochMs: obj.processStartEpochMs as number } : {}),
        };
      }
      return null;
    }
  } catch {
    /* not JSON at all — fall through to the legacy bare-integer format below */
  }
  const pid = Number(text);
  return Number.isSafeInteger(pid) && pid > 0 ? { pid } : null;
}

type AyasObserverOwnerStatus = "alive" | "dead" | "unknown";

/**
 * "dead" only when POSITIVELY established — either the PID itself is gone,
 * or (when we recorded one) the PID is alive but its OS-reported start
 * time no longer matches, meaning a DIFFERENT process now happens to reuse
 * the same PID number and the original owner is provably gone. "unknown"
 * is reserved for when the identity check itself could not be completed
 * (permission, platform, transient failure) — genuinely ambiguous, never
 * treated as proof of anything. "alive" needs no further reclaim
 * consideration at all, regardless of lock age.
 */
async function determineAyasObserverOwnerStatus(owner: LockOwnerRecord): Promise<AyasObserverOwnerStatus> {
  if (!processIsAlive(owner.pid)) return "dead";
  if (owner.processStartEpochMs === undefined) return "alive";
  try {
    const currentStart = await readProcessStartEpochMs(owner.pid);
    return Math.abs(currentStart - owner.processStartEpochMs) <= 1_000 ? "alive" : "dead";
  } catch {
    return "unknown";
  }
}

/**
 * Attempts to reclaim `lockFile`. Returns `true` only if it actually
 * removed a genuinely abandoned lock. Never reclaims a lock whose owner is
 * confirmed alive, and never reclaims based on a single observation alone
 * — a second read must still show the SAME owner record before anything is
 * deleted, so a legitimate new acquire that raced in between is never
 * destroyed.
 */
async function tryReclaimAyasObserverLock(lockFile: string, staleAfterMs: number): Promise<boolean> {
  const first = readLockOwner(lockFile);
  if (!first) return false;

  const status = await determineAyasObserverOwnerStatus(first);
  if (status === "alive") return false;

  if (status === "unknown") {
    let stat: ReturnType<typeof fs.statSync>;
    try {
      stat = fs.statSync(lockFile);
    } catch {
      return false;
    }
    if (Date.now() - stat.mtimeMs <= staleAfterMs) return false;
  }

  // Positively dead, or unknown-and-old-enough — either way, double-observe
  // before touching the file: if the recorded owner changed at all, a new
  // acquire raced in and this reclaim must not proceed.
  await new Promise((resolve) => setTimeout(resolve, DOUBLE_OBSERVATION_DELAY_MS));
  const second = readLockOwner(lockFile);
  if (!second || second.pid !== first.pid || second.processStartEpochMs !== first.processStartEpochMs) return false;
  if (status === "dead") {
    const secondStatus = await determineAyasObserverOwnerStatus(second);
    if (secondStatus === "alive") return false;
  }

  try {
    fs.rmSync(lockFile);
    return true;
  } catch {
    return false;
  }
}

/**
 * Acquires the observer singleton lock at `lockFile` (creating
 * `autonomyDir` first). Records both this process's PID and its OS-reported
 * start time in the lock file, so a future reclaim attempt can positively
 * distinguish "this exact process is still alive" from "a different
 * process now happens to reuse this PID" — never treating a reused PID
 * number alone as proof of live ownership.
 */
export async function acquireAyasObserverLock(autonomyDir: string, lockFile: string, options: AyasObserverLockOptions = {}): Promise<void> {
  const staleAfterMs = options.staleAfterMs ?? DEFAULT_STALE_AFTER_MS;
  fs.mkdirSync(autonomyDir, { recursive: true });

  const processStartEpochMs = await readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000));
  const ownerBytes = `${JSON.stringify({ pid: process.pid, processStartEpochMs })}\n`;

  for (;;) {
    try {
      const fd = fs.openSync(lockFile, "wx");
      try {
        fs.writeFileSync(fd, ownerBytes, "utf8");
      } finally {
        fs.closeSync(fd);
      }
      return;
    } catch (error) {
      const reclaimed = await tryReclaimAyasObserverLock(lockFile, staleAfterMs);
      if (reclaimed) continue;

      let stat: ReturnType<typeof fs.statSync> | undefined;
      try {
        stat = fs.statSync(lockFile);
      } catch {
        // The lock vanished between our failed create and this stat — a
        // concurrent release/reclaim. Loop and try to create it again
        // rather than reporting a busy lock that is no longer there.
        continue;
      }
      const owner = readLockOwner(lockFile);
      const age = Date.now() - stat.mtimeMs;
      throw new AyasObserverLockError(
        "AYAS_OBSERVER_ALREADY_RUNNING",
        owner
          ? `an AYAS autonomy observer (pid ${owner.pid}) is already running`
          : `observer lock at ${lockFile} is held (age ${Math.round(age / 1000)}s) but its owner could not be determined: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

export function releaseAyasObserverLock(lockFile: string): void {
  try { fs.rmSync(lockFile, { force: true }); } catch { /* best effort */ }
}

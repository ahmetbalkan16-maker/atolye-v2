import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import { promisify } from "node:util";

/**
 * Pure, side-effect-free process-identity helpers (M12) — extracted so the
 * M3 execution-authority lock and the M9 observer singleton lock stop
 * duplicating the SAME `processIsAlive` check (and so the observer lock can
 * gain the same PID-reuse-safe process-start-time check the execution lock
 * already had, without a second, drifting copy of it). This module knows
 * nothing about locks, files, or any lock's own reclaim policy — it only
 * answers "is this PID alive" and "when did this PID start". The two lock
 * protocols remain fully separate; only this identity primitive is shared.
 */

const execFileAsync = promisify(execFile);

export function processIsAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === "EPERM"; }
}

/**
 * The OS-reported start time of `pid`, in epoch milliseconds. Throws if it
 * cannot be determined (process gone, permission issue, platform quirk) —
 * callers are expected to treat a thrown error as "unknown", which their
 * own fail-closed policy then resolves (never as proof of death).
 */
export async function readProcessStartEpochMs(pid: number): Promise<number> {
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
 * `true` only if `pid` is currently alive AND (when `expectedStartEpochMs`
 * is given) its OS-reported start time matches — a reused PID (a different
 * process that happens to share the same number) is correctly treated as
 * NOT the same live process. Any uncertainty (can't read start time, race,
 * permission, platform issue) fails closed toward "still the same live
 * process", so a possibly-live process is never reported dead by mistake.
 * Without `expectedStartEpochMs` this is a plain liveness check.
 */
export async function isSameLiveProcess(pid: number, expectedStartEpochMs?: number): Promise<boolean> {
  if (!processIsAlive(pid)) return false;
  if (expectedStartEpochMs === undefined) return true;
  try {
    const currentStart = await readProcessStartEpochMs(pid);
    return Math.abs(currentStart - expectedStartEpochMs) <= 1_000;
  } catch {
    return true;
  }
}

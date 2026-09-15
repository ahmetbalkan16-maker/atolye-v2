import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { withAyasExecutionAuthorityLock, AyasExecutionAuthorityLockError } from "../src/lib/brain/autonomy/AyasExecutionAuthorityLock";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-exec-lock-")); }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

/** Polls for the lock directory to exist, rather than a fixed delay — acquiring involves a Windows PowerShell round-trip (`Get-Process`) whose latency is not bounded tightly enough for a fixed sleep. */
async function waitForLockAcquired(gateRoot: string, timeoutMs = 5_000): Promise<void> {
  const lockDir = path.join(gateRoot, "execution", ".authority-lock", "owner.json");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(lockDir)) return;
    await delay(15);
  }
  throw new Error(`timed out waiting for lock to be acquired at ${lockDir}`);
}

/** Spawns and awaits the exit of a genuinely short-lived child process, returning its (now-dead) PID. */
async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) throw new Error("failed to spawn fixture child process");
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  // Give the OS a brief moment to fully reap the process table entry.
  await delay(50);
  return pid;
}

function writeFixtureLock(gateRoot: string, owner: Record<string, unknown>, mtimeMsAgo: number): void {
  const lockDir = path.join(gateRoot, "execution", ".authority-lock");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "owner.json"), `${JSON.stringify(owner)}\n`);
  const past = new Date(Date.now() - mtimeMsAgo);
  fs.utimesSync(lockDir, past, past);
}

async function main() {
  await scenario("an isolated root can be locked and released", async () => {
    const gateRoot = root();
    const result = await withAyasExecutionAuthorityLock(gateRoot, async () => 42);
    assert.equal(result, 42);
    assert.equal(fs.existsSync(path.join(gateRoot, "execution", ".authority-lock")), false, "the lock directory must be removed on release");
  });

  await scenario("a second concurrent attempt on the SAME gateRoot is rejected — never a silent interleave", async () => {
    const gateRoot = root();
    let insideCount = 0;
    let maxConcurrent = 0;
    let releaseFirst: (() => void) | undefined;
    const heldUntilReleased = new Promise<void>((resolve) => { releaseFirst = resolve; });
    const holdFirst = (async () => {
      await withAyasExecutionAuthorityLock(gateRoot, async () => {
        insideCount += 1;
        maxConcurrent = Math.max(maxConcurrent, insideCount);
        await heldUntilReleased;
        insideCount -= 1;
      });
    })();
    await waitForLockAcquired(gateRoot); // let the first call actually acquire before the second attempts
    // The holder stays held (manual release, not a fixed delay) until the
    // second attempt's bounded retry budget has fully exhausted and
    // rejected — this removes any dependency on how long the second
    // caller's own owner-computation (a Windows PowerShell round-trip)
    // takes relative to a fixed hold duration.
    await assert.rejects(
      () => withAyasExecutionAuthorityLock(gateRoot, async () => { insideCount += 1; maxConcurrent = Math.max(maxConcurrent, insideCount); insideCount -= 1; }, { acquireRetryLimit: 3, acquireRetryDelayMs: 20 }),
      (error: unknown) => error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY",
    );
    releaseFirst?.();
    await holdFirst;
    assert.equal(maxConcurrent, 1, "the two operations must never have run concurrently");
  });

  await scenario("two DIFFERENT isolated gateRoots operate independently, without contention", async () => {
    const rootA = root();
    const rootB = root();
    let concurrentlyInsideBoth = false;
    const a = withAyasExecutionAuthorityLock(rootA, async () => {
      await delay(150);
      return "a";
    });
    await waitForLockAcquired(rootA);
    const b = withAyasExecutionAuthorityLock(rootB, async () => {
      concurrentlyInsideBoth = true; // reached while `a` is still holding rootA — proves no cross-root contention
      return "b";
    });
    const [resultA, resultB] = await Promise.all([a, b]);
    assert.equal(resultA, "a");
    assert.equal(resultB, "b");
    assert.equal(concurrentlyInsideBoth, true);
  });

  await scenario("this represents Bridge-vs-autonomy: two conceptually different callers sharing one gateRoot still cannot interleave", async () => {
    const gateRoot = root();
    let overlap = false;
    let daemonLikeRunning = false;
    let releaseDaemonLike: (() => void) | undefined;
    const heldUntilReleased = new Promise<void>((resolve) => { releaseDaemonLike = resolve; });
    const daemonLike = (async () => {
      await withAyasExecutionAuthorityLock(gateRoot, async () => {
        daemonLikeRunning = true;
        await heldUntilReleased;
        daemonLikeRunning = false;
      });
    })();
    await waitForLockAcquired(gateRoot);
    // Manual release (not a fixed delay) so the daemon-like holder is
    // guaranteed to still be inside its critical section for the entire
    // duration of the second caller's bounded retry budget, regardless of
    // how long that caller's own owner-computation takes.
    await assert.rejects(
      () => withAyasExecutionAuthorityLock(gateRoot, async () => { if (daemonLikeRunning) overlap = true; }, { acquireRetryLimit: 3, acquireRetryDelayMs: 20 }),
      (error: unknown) => error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY",
    );
    releaseDaemonLike?.();
    await daemonLike;
    assert.equal(overlap, false);
  });

  await scenario("a dead owner (confirmed-exited PID) is safely reclaimed once stale", async () => {
    const gateRoot = root();
    const pid = await deadPid();
    writeFixtureLock(gateRoot, { schemaVersion: "1", gateRoot: path.resolve(gateRoot), ownerNonce: "fixture-dead", pid, processStartEpochMs: 0, acquiredAt: new Date(0).toISOString() }, 20 * 60_000);
    const result = await withAyasExecutionAuthorityLock(gateRoot, async () => "reclaimed", { staleAfterMs: 60_000 });
    assert.equal(result, "reclaimed");
  });

  await scenario("a live owner is NOT reclaimed merely due to lock age", async () => {
    const gateRoot = root();
    let releaseHeld: (() => void) | undefined;
    const held = new Promise<void>((resolve) => { releaseHeld = resolve; });
    const holder = withAyasExecutionAuthorityLock(gateRoot, async () => { await held; });
    await waitForLockAcquired(gateRoot); // let the holder actually acquire and durably publish its (correct) owner.json first
    const lockDir = path.join(gateRoot, "execution", ".authority-lock");
    // Age the lock far into the past by timestamp alone — the owner record
    // itself is still the real, live, correctly-published current process.
    const past = new Date(Date.now() - 20 * 60_000);
    fs.utimesSync(lockDir, past, past);
    await assert.rejects(
      () => withAyasExecutionAuthorityLock(gateRoot, async () => "must not run", { staleAfterMs: 1, acquireRetryLimit: 3, acquireRetryDelayMs: 20 }),
      (error: unknown) => error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY",
    );
    releaseHeld?.();
    await holder;
  });

  await scenario("PID reuse does not impersonate the original owner — a live PID with a mismatched start time is still reclaimable", async () => {
    const gateRoot = root();
    // Our own PID is alive, but we record a deliberately wrong start time —
    // simulating "a different process now happens to reuse this PID".
    writeFixtureLock(gateRoot, { schemaVersion: "1", gateRoot: path.resolve(gateRoot), ownerNonce: "fixture-reused-pid", pid: process.pid, processStartEpochMs: 1, acquiredAt: new Date(0).toISOString() }, 20 * 60_000);
    const result = await withAyasExecutionAuthorityLock(gateRoot, async () => "reclaimed-despite-live-pid", { staleAfterMs: 60_000 });
    assert.equal(result, "reclaimed-despite-live-pid");
  });

  await scenario("a lock that changes between the two observations is NOT deleted", async () => {
    const gateRoot = root();
    const pid = await deadPid();
    const ownerFile = path.join(gateRoot, "execution", ".authority-lock", "owner.json");
    writeFixtureLock(gateRoot, { schemaVersion: "1", gateRoot: path.resolve(gateRoot), ownerNonce: "fixture-changing-0", pid, processStartEpochMs: 0, acquiredAt: new Date(0).toISOString() }, 20 * 60_000);
    // Continuously rewrite the owner file (much faster than the module's
    // ~30ms gap between its two observations) instead of a single
    // fixed-delay write — the acquire call's OWN owner-computation first
    // spawns a Windows PowerShell process whose latency is not tightly
    // bounded, so a one-shot timer cannot reliably land inside the actual
    // observation window. A rewrite every 8ms is virtually guaranteed to
    // land inside any 30ms window, however late that window starts.
    let generation = 0;
    const rewrite = setInterval(() => {
      generation += 1;
      try {
        fs.writeFileSync(ownerFile, `${JSON.stringify({ schemaVersion: "1", gateRoot: path.resolve(gateRoot), ownerNonce: `fixture-changing-${generation}`, pid, processStartEpochMs: 0, acquiredAt: new Date(0).toISOString() })}\n`);
      } catch { /* lock may already be gone if the race lost — fine */ }
    }, 8);
    try {
      await assert.rejects(
        () => withAyasExecutionAuthorityLock(gateRoot, async () => "must not run", { staleAfterMs: 60_000, acquireRetryLimit: 5, acquireRetryDelayMs: 20 }),
        (error: unknown) => error instanceof AyasExecutionAuthorityLockError && error.code === "AYAS_LOCK_BUSY",
      );
    } finally {
      clearInterval(rewrite);
    }
  });

  await scenario("operation errors propagate, and the lock is still released", async () => {
    const gateRoot = root();
    const thrown = new Error("operation boom");
    await assert.rejects(() => withAyasExecutionAuthorityLock(gateRoot, async () => { throw thrown; }), (error: unknown) => error === thrown);
    assert.equal(fs.existsSync(path.join(gateRoot, "execution", ".authority-lock")), false, "the lock must be released even when the operation throws");
  });

  await scenario("the module never references the execution gate, the approval store, or the daemon — pure mutual exclusion only", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasExecutionAuthorityLock.ts"), "utf8");
    assert.doesNotMatch(src, /AyasExecutionGateStore|AyasApprovalInboxStore|AyasAutonomyDaemon|consumeApproval|reserveApproval|applyWhileExecuting/);
  });

  await scenario("no Package D (autostart) involvement", () => {
    const src = fs.readFileSync(path.join(process.cwd(), "src", "lib", "brain", "autonomy", "AyasExecutionAuthorityLock.ts"), "utf8");
    assert.doesNotMatch(src, /autostart|Startup|WScript\.Shell/i);
  });

  console.log(`AYAS execution authority lock smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-execution-authority-lock", scenarios: count }));
}
main().catch((error) => { console.error("AYAS execution authority lock smoke FAILED:", error); process.exitCode = 1; });

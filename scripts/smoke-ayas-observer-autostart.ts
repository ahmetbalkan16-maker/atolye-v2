import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { acquireAyasObserverLock, releaseAyasObserverLock, AyasObserverLockError } from "../src/lib/brain/autonomy/AyasObserverSingletonLock";
import { readProcessStartEpochMs } from "../src/lib/brain/autonomy/AyasProcessLiveness";

let count = 0;
function scenario(name: string, fn: () => void | Promise<void>) { return Promise.resolve(fn()).then(() => { count += 1; if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`); }); }
function root() { return fs.mkdtempSync(path.join(os.tmpdir(), "ayas-observer-")); }
function lockPaths(rootDir: string) { const autonomyDir = path.join(rootDir, "data", "brain", "autonomy"); return { autonomyDir, lockFile: path.join(autonomyDir, "daemon.lock") }; }
function delay(ms: number) { return new Promise<void>((resolve) => setTimeout(resolve, ms)); }

async function deadPid(): Promise<number> {
  const child = spawn(process.execPath, ["-e", "process.exit(0)"], { stdio: "ignore" });
  const pid = child.pid;
  if (!pid) throw new Error("failed to spawn fixture child process");
  await new Promise<void>((resolve) => child.on("exit", () => resolve()));
  await delay(50);
  return pid;
}

/** Writes the CURRENT (M12, JSON) lock format: `{"pid", "processStartEpochMs"}`. */
function writeFixtureLock(lockFile: string, pid: number, ageMs: number, processStartEpochMs?: number): void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, `${JSON.stringify({ pid, ...(processStartEpochMs !== undefined ? { processStartEpochMs } : {}) })}\n`);
  const past = new Date(Date.now() - ageMs);
  fs.utimesSync(lockFile, past, past);
}

/** Writes the LEGACY (pre-M12, bare-integer) lock format, for backward-compatibility testing. */
function writeLegacyFixtureLock(lockFile: string, pid: number, ageMs: number): void {
  fs.mkdirSync(path.dirname(lockFile), { recursive: true });
  fs.writeFileSync(lockFile, `${pid}\n`);
  const past = new Date(Date.now() - ageMs);
  fs.utimesSync(lockFile, past, past);
}

const REPO_ROOT = process.cwd();
const PS = "powershell.exe";

function runPs(scriptRelPath: string, args: readonly string[]): { stdout: string; code: number } {
  try {
    const stdout = execFileSync(PS, ["-NoProfile", "-File", path.join(REPO_ROOT, scriptRelPath), ...args], { encoding: "utf8", windowsHide: true });
    return { stdout, code: 0 };
  } catch (error) {
    const e = error as { stdout?: string; status?: number };
    return { stdout: e.stdout ?? "", code: e.status ?? 1 };
  }
}

async function main() {
  // === Lock module: single-instance / stale / live / restart behavior ===

  await scenario("an isolated observer lock can be acquired and released", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    await acquireAyasObserverLock(autonomyDir, lockFile);
    assert.ok(fs.existsSync(lockFile));
    releaseAyasObserverLock(lockFile);
    assert.equal(fs.existsSync(lockFile), false);
  });

  await scenario("a second acquire attempt against the SAME live lock is rejected, not silently interleaved", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    await acquireAyasObserverLock(autonomyDir, lockFile);
    await assert.rejects(acquireAyasObserverLock(autonomyDir, lockFile), (e: unknown) => e instanceof AyasObserverLockError && e.code === "AYAS_OBSERVER_ALREADY_RUNNING");
    releaseAyasObserverLock(lockFile);
  });

  await scenario("M12 fix: a CONFIRMED-dead owner's lock is reclaimed IMMEDIATELY — no 30-minute wait — even though it is only seconds old", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    const pid = await deadPid();
    // Deliberately only 1s old (nowhere near any staleAfterMs window) — the
    // fix is precisely that a POSITIVELY confirmed-dead PID does not need
    // to wait out the age gate at all.
    writeFixtureLock(lockFile, pid, 1_000, Date.now() - 1_000);
    const started = Date.now();
    await acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 });
    const elapsedMs = Date.now() - started;
    assert.ok(elapsedMs < 5_000, `reclaim of a confirmed-dead owner must be near-immediate, took ${elapsedMs}ms`);
    const owner = JSON.parse(fs.readFileSync(lockFile, "utf8").trim()) as { pid: number };
    assert.equal(owner.pid, process.pid, "the reclaiming process must now own the lock");
    releaseAyasObserverLock(lockFile);
  });

  await scenario("legacy (pre-M12, bare-PID-format) lock from a confirmed-dead owner is ALSO reclaimed immediately", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    const pid = await deadPid();
    writeLegacyFixtureLock(lockFile, pid, 1_000);
    const started = Date.now();
    await acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 });
    assert.ok(Date.now() - started < 5_000);
    releaseAyasObserverLock(lockFile);
  });

  await scenario("a live owner's lock is NEVER stolen merely because it is old — B1: this invariant is unchanged by the M12 fix", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    // Our OWN pid is genuinely alive, with our OWN real start time recorded
    // — simulates a long-running --continuous observer whose lock file was
    // never refreshed past the staleness window.
    const ownStart = await readProcessStartEpochMs(process.pid).catch(() => Date.now() - Math.floor(process.uptime() * 1000));
    writeFixtureLock(lockFile, process.pid, 40 * 60_000, ownStart);
    await assert.rejects(
      acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }),
      (e: unknown) => e instanceof AyasObserverLockError && /already running/.test(e.message),
    );
    fs.rmSync(lockFile, { force: true });
  });

  await scenario("PID reuse: a live PID whose recorded start time no longer matches is treated as a DIFFERENT (dead-original) process, reclaimed immediately", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    // Our own PID is alive, but the recorded start time is deliberately
    // wrong — simulates "a different process now happens to reuse this
    // PID number", which must NOT be mistaken for the original live owner.
    writeFixtureLock(lockFile, process.pid, 1_000, 1);
    const started = Date.now();
    await acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 });
    assert.ok(Date.now() - started < 5_000, "a positively-established PID-reuse mismatch must reclaim immediately, like a confirmed-dead owner");
    releaseAyasObserverLock(lockFile);
  });

  await scenario("a lock whose owner cannot be confirmed dead (unparseable content) fails closed — never reclaimed, at any age", () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, "not-a-pid\n");
    const past = new Date(Date.now() - 40 * 60_000);
    fs.utimesSync(lockFile, past, past);
    return assert.rejects(acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }), (e: unknown) => e instanceof AyasObserverLockError)
      .finally(() => fs.rmSync(lockFile, { force: true }));
  });

  await scenario("a young (not-yet-stale) lock whose liveness is unknown is never reclaimed — the original conservative fallback is unchanged", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    // A malformed record's liveness can never be positively determined, so
    // it always falls to the age-gated "unknown" path — young means never.
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, "not-a-pid\n");
    const past = new Date(Date.now() - 5_000);
    fs.utimesSync(lockFile, past, past);
    await assert.rejects(acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }), (e: unknown) => e instanceof AyasObserverLockError);
    fs.rmSync(lockFile, { force: true });
  });

  await scenario("concurrent-reclaim race: if the lock record changes between the two observations, the in-flight reclaim aborts and does not steal it", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    const pid = await deadPid();
    writeFixtureLock(lockFile, pid, 1_000, Date.now() - 1_000);
    // Race a rewrite to land between the module's two observations (~50ms
    // apart) — simulates a different process legitimately re-acquiring at
    // the same moment. Continuously rewrite (not a single timed write) so
    // the race lands reliably regardless of exact scheduling.
    let generation = 0;
    const rewrite = setInterval(() => {
      generation += 1;
      try {
        fs.writeFileSync(lockFile, `${JSON.stringify({ pid: pid + 1, processStartEpochMs: generation })}\n`);
      } catch { /* fine if the file is briefly gone */ }
    }, 8);
    try {
      await assert.rejects(
        acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }),
        (e: unknown) => e instanceof AyasObserverLockError,
      );
    } finally {
      clearInterval(rewrite);
      fs.rmSync(lockFile, { force: true });
    }
  });

  await scenario("restart-safety: a fresh acquire call (simulating a process restart) still respects a live lock", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    await acquireAyasObserverLock(autonomyDir, lockFile);
    // No in-memory state carries over between these two calls other than the durable lock file itself.
    await assert.rejects(acquireAyasObserverLock(autonomyDir, lockFile), (e: unknown) => e instanceof AyasObserverLockError);
    releaseAyasObserverLock(lockFile);
  });

  await scenario("restart-safety: after a clean release, a fresh acquire call succeeds immediately", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    await acquireAyasObserverLock(autonomyDir, lockFile);
    releaseAyasObserverLock(lockFile);
    await acquireAyasObserverLock(autonomyDir, lockFile);
    assert.ok(fs.existsSync(lockFile));
    releaseAyasObserverLock(lockFile);
  });

  await scenario("the lock module has zero dependency on approval/gate/daemon authority, or the M3 execution-authority lock", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "brain", "autonomy", "AyasObserverSingletonLock.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasExecutionGateStore|AyasAutonomyDaemon|AyasExecutionAuthorityLock|reserveApproval|finalizeApproval|consumeApproval|executeApproved/);
  });

  await scenario("the shared process-liveness helper module has zero dependency on any lock domain or authority surface", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "brain", "autonomy", "AyasProcessLiveness.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasExecutionGateStore|AyasAutonomyDaemon|reserveApproval|finalizeApproval|consumeApproval|executeApproved|AyasObserverSingletonLock/);
  });

  // === Startup entrypoint classification: OBSERVER_ONLY_SAFE ===

  await scenario("the startup entrypoint imports ONLY the read-only observer, never the authority-bearing daemon module", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.match(src, /from ["']\.\.\/src\/lib\/brain\/autonomy\/AyasAutonomyObserver["']/);
    assert.doesNotMatch(src, /AyasAutonomyDaemon["']|from ["']\.\.\/src\/lib\/brain\/autonomy\/AyasAutonomyDaemon["']/);
  });

  await scenario("the startup entrypoint has no path to executeApproved, an approval decision, reserve/consume/finalize, or a gate transition", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.doesNotMatch(src, /executeApproved|\.decide\(|reserveApproval|finalizeApproval|consumeApproval|AyasExecutionGateStore|AyasExecutionGate\b|AyasApprovalInboxStore/);
  });

  await scenario("M17: the startup entrypoint imports none of the sandboxed patch-drafting modules either — sandbox drafting stays behind the same arm's-length child-process boundary as the rest of discovery", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.doesNotMatch(src, /AyasNovelPatchDiscovery|AyasPatchSandbox|AyasPatchDetectors|AyasPatchArtifact|AyasPatchArtifactMutation/);
  });

  await scenario("M17: ayas-discovery-daemon.ts (the child process) is the one place novel-patch discovery is wired in — not any other script", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-discovery-daemon.ts"), "utf8");
    assert.match(src, /discoverAyasNovelPatchCandidates/);
  });

  await scenario("the startup entrypoint resolves its repo root explicitly (process.cwd()), not an ambient/relative assumption", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.match(src, /const root = process\.cwd\(\)/);
  });

  await scenario("startup failure is visible: main() reports and exits non-zero on any error, never a silent best-effort continue", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ts"), "utf8");
    assert.match(src, /main\(\)\.catch\(\(error\) => \{ console\.error\("AYAS autonomy daemon FAILED:", error\); process\.exitCode = 1; \}\)/);
  });

  await scenario("the PowerShell wrapper checks the launched process's real exit code — a failed launch cannot silently report success", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "utf8");
    assert.match(src, /\$LASTEXITCODE/);
  });

  await scenario("the package.json ayas:autonomy script launches exactly the observer-only entrypoint", () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "package.json"), "utf8")) as { scripts: Record<string, string> };
    assert.equal(pkg.scripts["ayas:autonomy"], "tsx scripts/ayas-autonomy-daemon.ts");
  });

  // === PowerShell register/unregister lifecycle (real invocations, isolated fixture Startup dir) ===

  await scenario("register dry-run reports what WOULD happen (continuous mode) and makes no filesystem change", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const before = fs.readdirSync(fixture);
    const { stdout, code } = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture]);
    assert.equal(code, 0);
    assert.match(stdout, /DRY-RUN/);
    assert.match(stdout, /observe-only/);
    assert.match(stdout, /-Continuous/, "the product decision (continuous mode) must be visible in the dry-run preview");
    assert.deepEqual(fs.readdirSync(fixture), before, "dry-run must not write anything");
  });

  await scenario("register -Apply creates exactly one shortcut, and a second -Apply detects and replaces it rather than duplicating", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const first = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    assert.equal(first.code, 0);
    assert.match(first.stdout, /Installed/);
    const afterFirst = fs.readdirSync(fixture);
    assert.equal(afterFirst.length, 1);
    const dryRunSecond = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture]);
    assert.match(dryRunSecond.stdout, /Existing installation detected/);
    const second = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    assert.equal(second.code, 0);
    const afterSecond = fs.readdirSync(fixture);
    assert.equal(afterSecond.length, 1, "re-applying must replace, never duplicate, the fixed-name shortcut");
  });

  await scenario("the generated shortcut's Arguments literally contain -Continuous, and the wrapper script maps it to --continuous for the real entrypoint", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    const readArgs = execFileSync(
      PS,
      ["-NoProfile", "-Command", `$s = New-Object -ComObject WScript.Shell; $lnk = $s.CreateShortcut("${path.join(fixture, "AYAS Autonomy Observer.lnk")}"); Write-Output $lnk.Arguments`],
      { encoding: "utf8", windowsHide: true },
    );
    assert.match(readArgs, /-Continuous\b/);
    const wrapperSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "utf8");
    assert.match(wrapperSrc, /if \(\$Continuous\) \{ \$args \+= "--continuous" \}/, "the wrapper must translate -Continuous into --continuous for the real observer entrypoint");
  });

  await scenario("unregister dry-run reports what WOULD happen and removes nothing", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    const before = fs.readdirSync(fixture);
    const { stdout, code } = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture]);
    assert.equal(code, 0);
    assert.match(stdout, /DRY-RUN: would remove/);
    assert.deepEqual(fs.readdirSync(fixture), before);
  });

  await scenario("unregister -Apply is idempotent: removes when present, reports honestly when already absent", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    const first = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    assert.match(first.stdout, /Removed/);
    assert.equal(fs.readdirSync(fixture).length, 0);
    const second = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture]);
    assert.equal(second.code, 0);
    assert.match(second.stdout, /No AYAS autonomy observer shortcut was installed/);
  });

  await scenario("a repo path containing spaces resolves and quotes correctly end-to-end, including the generated shortcut", () => {
    const spacedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ayas repo with spaces "));
    fs.mkdirSync(path.join(spacedRoot, "scripts"), { recursive: true });
    fs.copyFileSync(path.join(REPO_ROOT, "scripts", "register-ayas-autonomy-autostart.ps1"), path.join(spacedRoot, "scripts", "register-ayas-autonomy-autostart.ps1"));
    fs.copyFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), path.join(spacedRoot, "scripts", "ayas-autonomy-daemon.ps1"));
    const fixtureStartup = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-spaced-"));
    const { stdout, code } = (() => {
      try {
        const out = execFileSync(PS, ["-NoProfile", "-File", path.join(spacedRoot, "scripts", "register-ayas-autonomy-autostart.ps1"), "-Apply", "-StartupDir", fixtureStartup], { encoding: "utf8", windowsHide: true });
        return { stdout: out, code: 0 };
      } catch (error) {
        const e = error as { stdout?: string; status?: number };
        return { stdout: e.stdout ?? "", code: e.status ?? 1 };
      }
    })();
    assert.equal(code, 0, stdout);
    assert.match(stdout, /Installed/);
    const files = fs.readdirSync(fixtureStartup);
    assert.equal(files.length, 1);
  });

  console.log(`AYAS observer autostart smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-observer-autostart", scenarios: count }));
}
main().catch((error) => { console.error("AYAS observer autostart smoke FAILED:", error); process.exitCode = 1; });

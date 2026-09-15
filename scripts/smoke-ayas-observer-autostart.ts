import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { acquireAyasObserverLock, releaseAyasObserverLock, AyasObserverLockError } from "../src/lib/brain/autonomy/AyasObserverSingletonLock";

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

function writeFixtureLock(lockFile: string, pid: number, ageMs: number): void {
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

  await scenario("an isolated observer lock can be acquired and released", () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    acquireAyasObserverLock(autonomyDir, lockFile);
    assert.ok(fs.existsSync(lockFile));
    releaseAyasObserverLock(lockFile);
    assert.equal(fs.existsSync(lockFile), false);
  });

  await scenario("a second acquire attempt against the SAME live lock is rejected, not silently interleaved", () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    acquireAyasObserverLock(autonomyDir, lockFile);
    assert.throws(() => acquireAyasObserverLock(autonomyDir, lockFile), (e: unknown) => e instanceof AyasObserverLockError && e.code === "AYAS_OBSERVER_ALREADY_RUNNING");
    releaseAyasObserverLock(lockFile);
  });

  await scenario("a confirmed-dead owner's stale lock is safely reclaimed", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    const pid = await deadPid();
    writeFixtureLock(lockFile, pid, 40 * 60_000);
    acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 });
    assert.ok(fs.existsSync(lockFile));
    const owner = Number(fs.readFileSync(lockFile, "utf8").trim());
    assert.equal(owner, process.pid, "the reclaiming process must now own the lock");
    releaseAyasObserverLock(lockFile);
  });

  await scenario("a live owner's lock is NOT stolen merely because it is old — the real M9 fix: age alone used to be sufficient", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    // Our OWN pid is genuinely alive — simulates a long-running --continuous
    // observer whose lock file was never refreshed past the staleness window.
    writeFixtureLock(lockFile, process.pid, 40 * 60_000);
    assert.throws(
      () => acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }),
      (e: unknown) => e instanceof AyasObserverLockError && /already running/.test(e.message),
    );
    fs.rmSync(lockFile, { force: true });
  });

  await scenario("a lock that is old but whose owner cannot be confirmed dead (unparseable PID) fails closed — never reclaimed", () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    fs.mkdirSync(path.dirname(lockFile), { recursive: true });
    fs.writeFileSync(lockFile, "not-a-pid\n");
    const past = new Date(Date.now() - 40 * 60_000);
    fs.utimesSync(lockFile, past, past);
    assert.throws(() => acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }), (e: unknown) => e instanceof AyasObserverLockError);
    fs.rmSync(lockFile, { force: true });
  });

  await scenario("a young (not-yet-stale) lock is never reclaimed, even from a confirmed-dead owner", async () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    const pid = await deadPid();
    writeFixtureLock(lockFile, pid, 5_000); // 5s old, well under the staleness window
    assert.throws(() => acquireAyasObserverLock(autonomyDir, lockFile, { staleAfterMs: 30 * 60_000 }), (e: unknown) => e instanceof AyasObserverLockError);
    fs.rmSync(lockFile, { force: true });
  });

  await scenario("restart-safety: a fresh acquire call (simulating a process restart) still respects a live lock", () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    acquireAyasObserverLock(autonomyDir, lockFile);
    // No in-memory state carries over between these two calls other than the durable lock file itself.
    assert.throws(() => acquireAyasObserverLock(autonomyDir, lockFile), (e: unknown) => e instanceof AyasObserverLockError);
    releaseAyasObserverLock(lockFile);
  });

  await scenario("restart-safety: after a clean release, a fresh acquire call succeeds immediately", () => {
    const { autonomyDir, lockFile } = lockPaths(root());
    acquireAyasObserverLock(autonomyDir, lockFile);
    releaseAyasObserverLock(lockFile);
    acquireAyasObserverLock(autonomyDir, lockFile);
    assert.ok(fs.existsSync(lockFile));
    releaseAyasObserverLock(lockFile);
  });

  await scenario("the lock module has zero dependency on approval/gate/daemon authority, or the M3 execution-authority lock", () => {
    const src = fs.readFileSync(path.join(REPO_ROOT, "src", "lib", "brain", "autonomy", "AyasObserverSingletonLock.ts"), "utf8");
    assert.doesNotMatch(src, /AyasApprovalInboxStore|AyasExecutionGateStore|AyasAutonomyDaemon|AyasExecutionAuthorityLock|reserveApproval|finalizeApproval|consumeApproval|executeApproved/);
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

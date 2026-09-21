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
  // `-ForceStartupShortcut` pins these scenarios to the shortcut-only code
  // path (M25 added a Task Scheduler-first path — see the dedicated
  // scheduled-task scenarios below) so they stay isolated from this
  // machine's real "AYAS Autonomy Observer" registration.

  await scenario("register dry-run reports what WOULD happen (continuous mode) and makes no filesystem change", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const before = fs.readdirSync(fixture);
    const { stdout, code } = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture, "-ForceStartupShortcut"]);
    assert.equal(code, 0);
    assert.match(stdout, /DRY-RUN/);
    assert.match(stdout, /observe-only/);
    assert.match(stdout, /-Continuous/, "the product decision (continuous mode) must be visible in the dry-run preview");
    assert.deepEqual(fs.readdirSync(fixture), before, "dry-run must not write anything");
  });

  await scenario("register -Apply creates exactly one shortcut, and a second -Apply detects and replaces it rather than duplicating", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const first = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-ForceStartupShortcut"]);
    assert.equal(first.code, 0);
    assert.match(first.stdout, /Installed/);
    const afterFirst = fs.readdirSync(fixture);
    assert.equal(afterFirst.length, 1);
    const dryRunSecond = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture, "-ForceStartupShortcut"]);
    assert.match(dryRunSecond.stdout, /Existing installation detected/);
    const second = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-ForceStartupShortcut"]);
    assert.equal(second.code, 0);
    const afterSecond = fs.readdirSync(fixture);
    assert.equal(afterSecond.length, 1, "re-applying must replace, never duplicate, the fixed-name shortcut");
  });

  await scenario("the generated shortcut's Arguments literally contain -Continuous, and the wrapper script maps it to --continuous for the real entrypoint", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-ForceStartupShortcut"]);
    const readArgs = execFileSync(
      PS,
      ["-NoProfile", "-Command", `$s = New-Object -ComObject WScript.Shell; $lnk = $s.CreateShortcut("${path.join(fixture, "AYAS Autonomy Observer.lnk")}"); Write-Output $lnk.Arguments`],
      { encoding: "utf8", windowsHide: true },
    );
    assert.match(readArgs, /-Continuous\b/);
    const wrapperSrc = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "utf8");
    assert.match(wrapperSrc, /if \(\$Continuous\) \{ \$daemonArgs \+= "--continuous" \}/, "the wrapper must translate -Continuous into --continuous for the real observer entrypoint");
  });

  await scenario("the wrapper never assigns to PowerShell's reserved automatic $args variable", () => {
    // npm's own `npx.ps1` shim re-parses the caller's raw invocation text and
    // re-runs it through `Invoke-Expression`, so the literal token written in
    // the wrapper is re-evaluated in a NEW scope. `$args` is automatic and
    // therefore exists — empty — in that new scope, so `@args` splats nothing
    // and npx launches bare. Comments are stripped first so the explanatory
    // prose in the wrapper itself is not mistaken for a real assignment.
    const src = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "utf8").replace(/^\s*#.*$/gm, "");
    assert.doesNotMatch(src, /\$args\s*(?:\+?=)/, "the wrapper must not assign to the reserved automatic $args variable");
  });

  await scenario("BEHAVIOR: the wrapper actually forwards its arguments to npx — a bare, argument-less launch must be impossible", () => {
    // Every assertion above reads only the wrapper's SOURCE, which is exactly
    // how the `$args` defect survived: the source read correctly while the real
    // invocation forwarded nothing, so `npx` ran bare, opened an interactive
    // shell, hit EOF and exited 0 — a silent startup failure the $LASTEXITCODE
    // guard could not see. This runs the real wrapper against a PATH-shimmed
    // `npx` that records what it received. No observer is started and nothing
    // touches the network.
    //
    // The shim MUST reproduce npm's own dispatch to be meaningful: a naive shim
    // that just reads its bound `$args` forwards correctly even for the broken
    // wrapper, and so catches nothing. npm's `npx.ps1`, when invoked from a
    // script, ignores its bound arguments entirely — it re-parses the caller's
    // raw `$MyInvocation.Statement`, drops the command name, and re-evaluates
    // the remainder via `Invoke-Expression`, whose new scope supplies a fresh
    // empty automatic `$args`. That re-evaluation step is the whole bug, so it
    // is mirrored verbatim here.
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-npx-shim-"));
    const received = path.join(shim, "received.txt");
    // PowerShell resolves `npx.ps1` (ExternalScript) ahead of `npx.cmd`
    // (Application), so the ExternalScript is the path that must be exercised.
    // The recorder is invoked BY the shim and simply reports the arguments it
    // was really given — it reads its own bound `$args` directly, with no
    // re-parse, so it faithfully reports whatever survived npm's dispatch.
    const recorder = path.join(shim, "recorder.ps1");
    const psQuote = (value: string) => `'${value.replace(/'/g, "''")}'`;
    fs.writeFileSync(recorder, `Set-Content -LiteralPath ${psQuote(received)} -Value ($args -join ' ')\n`);
    fs.writeFileSync(
      path.join(shim, "npx.ps1"),
      [
        // Mirrors npm's npx.ps1 exactly, including its PS 5.1 reflection
        // fallback for the `Statement` property.
        `if (($MyInvocation | Get-Member -Name 'Statement') -and $MyInvocation.Statement) {`,
        `  $ORIGINAL = $MyInvocation.Statement`,
        `} else {`,
        `  $ORIGINAL = ([Management.Automation.InvocationInfo].GetProperty('ScriptPosition', [Reflection.BindingFlags] 'Instance, NonPublic')).GetValue($MyInvocation).Text`,
        `}`,
        `$ELEMENTS = [Management.Automation.Language.Parser]::ParseInput($ORIGINAL, [ref] $null, [ref] $null).EndBlock.Statements.PipelineElements.CommandElements.Extent.Text`,
        `$FORWARDED = ($ELEMENTS | Select-Object -Skip 1) -join ' '`,
        // The load-bearing step: the caller's literal argument token is
        // re-evaluated here, in Invoke-Expression's own new scope.
        `Invoke-Expression "& ${psQuote(recorder)} $FORWARDED"`,
        `exit 0`,
      ].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(shim, "npx.cmd"), `@echo off\r\n> ${JSON.stringify(received)} echo %*\r\nexit /b 0\r\n`);
    let code: number;
    try {
      execFileSync(PS, ["-NoProfile", "-File", path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "-Continuous", "-IntervalMs", "12345"], {
        encoding: "utf8",
        windowsHide: true,
        env: { ...process.env, PATH: `${shim}${path.delimiter}${process.env.PATH ?? ""}` },
      });
      code = 0;
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
    }
    assert.equal(code, 0, "the wrapper must exit 0 when the launched command succeeds");
    assert.ok(fs.existsSync(received), "the wrapper must actually invoke npx");
    const forwarded = fs.readFileSync(received, "utf8").trim();
    assert.notEqual(forwarded, "", "npx must NEVER be launched with an empty argument list — that starts no observer yet still exits 0");
    assert.match(forwarded, /\btsx\b/);
    assert.match(forwarded, /scripts[\\/]ayas-autonomy-daemon\.ts/);
    assert.match(forwarded, /--continuous\b/, "-Continuous must reach the real entrypoint as --continuous");
    assert.match(forwarded, /--interval-ms\s+12345\b/, "-IntervalMs must reach the real entrypoint");
  });

  await scenario("M25 BEHAVIOR: a continuous observer that keeps crashing is restarted a bounded number of times, then exits non-zero rather than looping forever", () => {
    // A `-Continuous` run has no code path that exits 0 on its own (see the
    // wrapper's own comment), so a persistently non-zero-exiting child is
    // the realistic crash shape this test reproduces - counted via a PATH
    // shim, exactly like the argument-forwarding test above, but exiting 7
    // on every invocation instead of forwarding to a recorder.
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-npx-crash-shim-"));
    const countFile = path.join(shim, "count.txt");
    fs.writeFileSync(countFile, "0");
    fs.writeFileSync(
      path.join(shim, "npx.ps1"),
      [
        `$n = [int](Get-Content -LiteralPath ${JSON.stringify(countFile)}) + 1`,
        `Set-Content -LiteralPath ${JSON.stringify(countFile)} -Value $n`,
        `exit 7`,
      ].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(shim, "npx.cmd"), `@echo off\r\nexit /b 7\r\n`);
    let code: number;
    let combined = "";
    try {
      const out = execFileSync(
        PS,
        ["-NoProfile", "-File", path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "-Continuous", "-MaxRestarts", "3", "-RestartDelaySeconds", "0"],
        { encoding: "utf8", windowsHide: true, env: { ...process.env, PATH: `${shim}${path.delimiter}${process.env.PATH ?? ""}` } },
      );
      combined = out;
      code = 0;
    } catch (error) {
      const e = error as { stdout?: string; stderr?: string; status?: number };
      combined = `${e.stdout ?? ""}\n${e.stderr ?? ""}`;
      code = e.status ?? 1;
    }
    assert.notEqual(code, 0, "a persistently crashing continuous observer must eventually report failure, never a silent success");
    assert.equal(fs.readFileSync(countFile, "utf8").trim(), "3", "must attempt exactly -MaxRestarts launches, no more and no fewer");
    assert.match(combined, /restarting in/i);
    assert.match(combined, /giving up after 3 restarts/i);
  });

  await scenario("M25 BEHAVIOR: a continuous observer that exits cleanly (code 0) is trusted as a deliberate stop and is never retried", () => {
    // Exercises the boundary the restart loop must NOT touch: an exact 0
    // exit is never a crash, so this must behave exactly like the pre-M25
    // wrapper (one attempt, exit 0), regardless of -MaxRestarts.
    const shim = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-npx-clean-shim-"));
    const countFile = path.join(shim, "count.txt");
    fs.writeFileSync(countFile, "0");
    fs.writeFileSync(
      path.join(shim, "npx.ps1"),
      [
        `$n = [int](Get-Content -LiteralPath ${JSON.stringify(countFile)}) + 1`,
        `Set-Content -LiteralPath ${JSON.stringify(countFile)} -Value $n`,
        `exit 0`,
      ].join("\n") + "\n",
    );
    fs.writeFileSync(path.join(shim, "npx.cmd"), `@echo off\r\nexit /b 0\r\n`);
    let code: number;
    try {
      execFileSync(
        PS,
        ["-NoProfile", "-File", path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), "-Continuous", "-MaxRestarts", "3", "-RestartDelaySeconds", "0"],
        { encoding: "utf8", windowsHide: true, env: { ...process.env, PATH: `${shim}${path.delimiter}${process.env.PATH ?? ""}` } },
      );
      code = 0;
    } catch (error) {
      code = (error as { status?: number }).status ?? 1;
    }
    assert.equal(code, 0);
    assert.equal(fs.readFileSync(countFile, "utf8").trim(), "1", "a clean exit must never be retried, even though -MaxRestarts allows more");
  });

  await scenario("unregister dry-run reports what WOULD happen and removes nothing", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-ForceStartupShortcut"]);
    const before = fs.readdirSync(fixture);
    const { stdout, code } = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture]);
    assert.equal(code, 0);
    assert.match(stdout, /DRY-RUN: would remove/);
    assert.deepEqual(fs.readdirSync(fixture), before);
  });

  await scenario("unregister -Apply is idempotent: removes when present, reports honestly when already absent", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-ForceStartupShortcut"]);
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
        const out = execFileSync(PS, ["-NoProfile", "-File", path.join(spacedRoot, "scripts", "register-ayas-autonomy-autostart.ps1"), "-Apply", "-StartupDir", fixtureStartup, "-ForceStartupShortcut"], { encoding: "utf8", windowsHide: true });
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

  // === M25: Task Scheduler-first autostart (crash-restart supervision) ===
  // Real `Register-ScheduledTask`/`Unregister-ScheduledTask` calls against a
  // distinct, per-test-run task name — never the real "AYAS Autonomy
  // Observer" registration — cleaned up in a `finally` even on assertion
  // failure so a failing test can never leave a stray task behind.
  //
  // Task Scheduler registration is itself refused by SOME sessions' own
  // permissions (observed directly on the machine this suite was written
  // against: `Register-ScheduledTask` → "Erişim engellendi" / HRESULT
  // 0x80070005 — the exact condition `register-ayas-autonomy-autostart.ps1`
  // is designed to fall back from, matching the pre-existing "AYAS Access
  // Online" precedent). These scenarios must therefore pass in EITHER
  // outcome: probe once for real, then assert the Task-Scheduler-specific
  // contract only when this session can actually grant it, and assert the
  // fallback contract (Startup shortcut, hidden window, task cleaned up)
  // otherwise — never silently skip the coverage either way.

  function uniqueTestTaskName(): string { return `AYAS Autonomy Observer TEST ${process.pid}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`; }
  function getScheduledTaskInfo(taskName: string): { exists: boolean; xml: string } {
    // `-ErrorAction Stop` is required: Get-ScheduledTask's own "not found"
    // error is non-terminating by default, so without it execFileSync would
    // never throw and this would report `exists: true` for a missing task.
    try {
      const xml = execFileSync(PS, ["-NoProfile", "-Command", `(Get-ScheduledTask -TaskName ${JSON.stringify(taskName)} -ErrorAction Stop | Export-ScheduledTask)`], { encoding: "utf8", windowsHide: true });
      return { exists: true, xml };
    } catch { return { exists: false, xml: "" }; }
  }
  function removeScheduledTaskIfPresent(taskName: string): void {
    try { execFileSync(PS, ["-NoProfile", "-Command", `Unregister-ScheduledTask -TaskName ${JSON.stringify(taskName)} -Confirm:$false -ErrorAction SilentlyContinue`], { encoding: "utf8", windowsHide: true }); } catch { /* best effort */ }
  }
  const taskSchedulerAvailable = (() => {
    const probeName = uniqueTestTaskName();
    try {
      execFileSync(
        PS,
        ["-NoProfile", "-Command", `$a = New-ScheduledTaskAction -Execute "cmd.exe" -Argument "/c exit 0"; $t = New-ScheduledTaskTrigger -AtLogOn; Register-ScheduledTask -TaskName ${JSON.stringify(probeName)} -Action $a -Trigger $t -Force | Out-Null`],
        { encoding: "utf8", windowsHide: true },
      );
      return true;
    } catch { return false; }
    finally { removeScheduledTaskIfPresent(probeName); }
  })();
  if (process.env.SMOKE_TRACE === "1") console.log(`Task Scheduler registration available in this session: ${taskSchedulerAvailable}`);

  await scenario("register -Apply (default, no -ForceStartupShortcut) prefers Task Scheduler when available, else falls back to a hidden-window Startup shortcut — never both, never neither", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const taskName = uniqueTestTaskName();
    try {
      const { stdout, code } = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      assert.equal(code, 0, stdout);
      const info = getScheduledTaskInfo(taskName);
      if (taskSchedulerAvailable) {
        assert.match(stdout, /scheduled task/);
        assert.equal(fs.readdirSync(fixture).length, 0, "the Task Scheduler path must not also create a Startup shortcut");
        assert.ok(info.exists, "the scheduled task must actually be registered");
        assert.match(info.xml, /<LogonType>InteractiveToken<\/LogonType>/, "must run interactively (no stored credentials / unattended widening)");
        assert.match(info.xml, /<RestartOnFailure>/, "must declare restart-on-failure so a crash mid-run is recovered without a fresh logon");
        assert.match(info.xml, /<Interval>PT1M<\/Interval>/, "restart interval must match the 1-minute cadence");
        assert.match(info.xml, /<Count>3<\/Count>/, "restart count must match the bounded (never infinite) retry budget");
        assert.doesNotMatch(info.xml, /<ExecutionTimeLimit>PT[1-9][0-9]*[MH]<\/ExecutionTimeLimit>/, "a genuinely continuous process must not carry a finite execution time cap");
        assert.match(info.xml, /--Continuous|-Continuous/, "continuous mode must still reach the daemon wrapper");
        assert.match(info.xml, /WindowStyle Hidden/, "the window must be hidden so it cannot be closed by an unaware user - the plausible trigger for the incident this fix addresses");
      } else {
        assert.match(stdout, /falling back to a Startup-folder shortcut/);
        assert.equal(info.exists, false, "a refused Task Scheduler registration must leave no task behind");
        const files = fs.readdirSync(fixture);
        assert.equal(files.length, 1, "the fallback must still install exactly one Startup shortcut");
      }
    } finally { removeScheduledTaskIfPresent(taskName); }
  });

  await scenario("register -Apply is idempotent: a second -Apply replaces, never duplicates, whichever mechanism this session actually uses", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const taskName = uniqueTestTaskName();
    try {
      const first = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      assert.equal(first.code, 0, first.stdout);
      const second = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      assert.equal(second.code, 0, second.stdout);
      if (taskSchedulerAvailable) {
        const count = execFileSync(PS, ["-NoProfile", "-Command", `(Get-ScheduledTask -TaskName ${JSON.stringify(taskName)} | Measure-Object).Count`], { encoding: "utf8", windowsHide: true }).trim();
        assert.equal(count, "1", "re-applying must replace, never duplicate, the task");
      } else {
        assert.equal(fs.readdirSync(fixture).length, 1, "re-applying must replace, never duplicate, the fallback shortcut");
      }
    } finally { removeScheduledTaskIfPresent(taskName); }
  });

  await scenario("register dry-run makes no registration either way, and honestly reports an existing one on the mechanism this session actually uses", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const taskName = uniqueTestTaskName();
    try {
      const dryBefore = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture, "-TaskName", taskName]);
      assert.equal(dryBefore.code, 0);
      assert.equal(getScheduledTaskInfo(taskName).exists, false, "dry-run must never register anything");
      assert.equal(fs.readdirSync(fixture).length, 0, "dry-run must never write a shortcut either");
      runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      const dryAfter = runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture, "-TaskName", taskName]);
      if (taskSchedulerAvailable) {
        assert.match(dryAfter.stdout, /Existing scheduled task detected/);
      } else {
        assert.match(dryAfter.stdout, /Existing Startup shortcut detected/);
      }
    } finally { removeScheduledTaskIfPresent(taskName); }
  });

  await scenario("unregister removes whichever mechanism is installed (dry-run first, then -Apply, then idempotent re-run)", () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
    const taskName = uniqueTestTaskName();
    try {
      runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      const dry = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-StartupDir", fixture, "-TaskName", taskName]);
      assert.match(dry.stdout, /DRY-RUN: would remove/);
      const apply = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      assert.match(apply.stdout, /Removed/);
      assert.equal(getScheduledTaskInfo(taskName).exists, false);
      assert.equal(fs.readdirSync(fixture).length, 0);
      const again = runPs("scripts/unregister-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
      assert.equal(again.code, 0);
      assert.match(again.stdout, /No AYAS autonomy observer shortcut was installed/);
    } finally { removeScheduledTaskIfPresent(taskName); }
  });

  if (taskSchedulerAvailable) {
    await scenario("registering via Task Scheduler cleans up a leftover Startup shortcut from a prior less-reliable install, so exactly one mechanism is ever active", () => {
      const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-startup-"));
      const taskName = uniqueTestTaskName();
      try {
        runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-ForceStartupShortcut"]);
        assert.equal(fs.readdirSync(fixture).length, 1, "precondition: a shortcut exists from the forced-fallback path");
        runPs("scripts/register-ayas-autonomy-autostart.ps1", ["-Apply", "-StartupDir", fixture, "-TaskName", taskName]);
        assert.equal(fs.readdirSync(fixture).length, 0, "the Task Scheduler registration must remove the now-superseded shortcut");
        assert.ok(getScheduledTaskInfo(taskName).exists);
      } finally { removeScheduledTaskIfPresent(taskName); }
    });
  }

  console.log(`AYAS observer autostart smoke: PASS (${count} scenarios)`);
  console.log(JSON.stringify({ status: "PASS", suite: "ayas-observer-autostart", scenarios: count }));
}
main().catch((error) => { console.error("AYAS observer autostart smoke FAILED:", error); process.exitCode = 1; });

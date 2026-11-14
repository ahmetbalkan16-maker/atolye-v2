import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { AYAS_CANONICAL_SYNC_MARKER, requestAyasCanonicalDependencySync } from "../src/lib/brain/autonomy/AyasUpdateTrialStore";

/**
 * The observer wrapper (`scripts/ayas-autonomy-daemon.ps1 -Continuous`) run the way the logon launcher
 * (`scripts/ayas-observer-hidden.vbs`) runs it: `powershell -Command "& '<wrapper>' -Continuous *> '<log>'"`.
 *
 * 14 Nov 2026 audit: under that `*>` redirection and the wrapper's `$ErrorActionPreference = "Stop"`, Windows
 * PowerShell 5.1 turned every stderr line of a native command into a terminating NativeCommandError. Live log
 * (`handover/observer-task-native.log`): "AYAS dependency sync failed: npm warn ERESOLVE overriding peer dependency;
 * current node_modules kept." 19+ times after the 13 Nov Transformers.js update, and a crashing observer's stderr report
 * ended the whole M25 restart loop instead of being retried. `smoke-ayas-observer-autostart.ts` (never run unattended:
 * it registers a real scheduled task) covers the loop with `-File` and silent shims, which never showed this.
 *
 * Every scenario runs a COPY of the wrapper in a temp tree with PATH shims; the real repository, its node_modules,
 * the live observer and Windows Task Scheduler are never touched. Windows only (powershell.exe).
 */

const REPO_ROOT = process.cwd();
const PS = "powershell.exe";
const BOM = "﻿"; // generated .ps1 files: Windows PowerShell 5.1 reads BOM-less files as ANSI (non-ASCII TEMP paths)

let count = 0;
function scenario(name: string, fn: () => void): void {
  fn();
  count += 1;
  if (process.env.SMOKE_TRACE === "1") console.log(`PASS ${count}: ${name}`);
}

function q(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/** The launcher's own command form: `-Command "& '<script>' <args> *> '<log>'; exit $LASTEXITCODE"`. */
function runLikeLauncher(script: string, args: string, log: string, shimDir?: string): number {
  try {
    execFileSync(PS, ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", `& ${q(script)} ${args} *> ${q(log)}; exit $LASTEXITCODE`], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 120_000,
      env: shimDir ? { ...process.env, PATH: `${shimDir}${path.delimiter}${process.env.PATH ?? ""}` } : process.env,
    });
    return 0;
  } catch (error) {
    return (error as { status?: number }).status ?? 1;
  }
}

function readLog(log: string): string {
  return fs.existsSync(log) ? fs.readFileSync(log, "utf16le").replace(/^﻿/, "") : "";
}

/**
 * A wrapper copy in <base>\studio\Atolye\repo (its studio temp is then <base>\studio\private\temp) and an `npx` shim
 * that recovers its arguments exactly like npm's own npx.ps1 does under `-Command` (re-parses the caller's statement
 * and re-evaluates the rest), records them, and exits with the next code; a non-zero exit first writes a crash report
 * to stderr through a real native process, as `scripts/ayas-autonomy-daemon.ts` does on failure.
 */
function wrapperFixture(npxCodes: readonly number[]) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-wrapper-stderr-"));
  const repo = path.join(base, "studio", "Atolye", "repo");
  fs.mkdirSync(path.join(repo, "scripts"), { recursive: true });
  const wrapper = path.join(repo, "scripts", "ayas-autonomy-daemon.ps1");
  fs.copyFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"), wrapper);
  fs.writeFileSync(path.join(repo, "package.json"), "{\"name\":\"fixture\"}\n");
  fs.writeFileSync(path.join(repo, "package-lock.json"), `{"lockfileVersion":3,"fixture":"${path.basename(base)}"}\n`);
  fs.mkdirSync(path.join(repo, "node_modules", "old-pkg"), { recursive: true });
  fs.writeFileSync(path.join(repo, "node_modules", "old-pkg", "index.js"), "old\n");
  const shim = path.join(base, "shim");
  fs.mkdirSync(shim);
  fs.writeFileSync(path.join(shim, "count.txt"), "0");
  fs.writeFileSync(path.join(shim, "argdump.ps1"), `${BOM}Add-Content -LiteralPath (Join-Path $PSScriptRoot 'args.txt') -Value ($args -join ' ')\n`);
  fs.writeFileSync(path.join(shim, "npx.ps1"), BOM + [
    "$countFile = Join-Path $PSScriptRoot 'count.txt'",
    "$n = [int](Get-Content -LiteralPath $countFile) + 1",
    "Set-Content -LiteralPath $countFile -Value $n",
    "$statement = if (($MyInvocation | Get-Member -Name 'Statement') -and $MyInvocation.Statement) { $MyInvocation.Statement } else { ([Management.Automation.InvocationInfo].GetProperty('ScriptPosition', [Reflection.BindingFlags] 'Instance, NonPublic')).GetValue($MyInvocation).Text }",
    "$rest = ([Management.Automation.Language.Parser]::ParseInput($statement, [ref] $null, [ref] $null).EndBlock.Statements.PipelineElements.CommandElements.Extent.Text | Select-Object -Skip 1) -join ' '",
    "$dump = Join-Path $PSScriptRoot 'argdump.ps1'",
    "Invoke-Expression \"& '$dump' $rest\"",
    `$codes = @(${npxCodes.join(", ")})`,
    "$code = $codes[[Math]::Min($n, $codes.Count) - 1]",
    "if ($code -ne 0) { & node -e \"process.stderr.write('AYAS autonomy daemon FAILED: simulated crash\\n'); process.exit($code)\" }",
    "exit $code",
  ].join("\r\n") + "\r\n");
  const install = path.join(base, "install.ps1");
  fs.writeFileSync(install, BOM + [
    "param([string]$staging)",
    "& node -e \"process.stderr.write('npm warn ERESOLVE overriding peer dependency\\n')\"",
    "if ($LASTEXITCODE -ne 0) { exit 7 }",
    "New-Item -ItemType Directory -Force -Path (Join-Path $staging 'node_modules\\new-pkg') | Out-Null",
    "exit 0",
  ].join("\r\n") + "\r\n");
  const markerDir = path.join(repo, "data", "brain", "self-improvement", "update-trials");
  return {
    base, repo, wrapper, shim, install, log: path.join(base, "observer-task-native.log"),
    marker: path.join(markerDir, AYAS_CANONICAL_SYNC_MARKER),
    requestSync: () => requestAyasCanonicalDependencySync(markerDir, { requestedAt: new Date().toISOString(), applyId: "fixture-apply", commitSha: "0".repeat(40), packageLockSha256: "f".repeat(64) }),
    launches: () => Number(fs.readFileSync(path.join(shim, "count.txt"), "utf8").trim()),
    npxArgs: () => fs.existsSync(path.join(shim, "args.txt")) ? fs.readFileSync(path.join(shim, "args.txt"), "utf8").split(/\r?\n/).filter(Boolean) : [],
  };
}

function main(): void {
  if (process.platform !== "win32") {
    console.log("SKIP (Windows PowerShell only)");
    return;
  }

  scenario("harness: under Stop + the launcher's *> redirection a native stderr line really is terminating (so the scenarios below are not vacuous)", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "ayas-wrapper-stderr-control-"));
    const script = path.join(base, "control.ps1");
    fs.writeFileSync(script, BOM + [
      "$ErrorActionPreference = 'Stop'",
      "try { & node -e \"process.stderr.write('npm warn ERESOLVE\\n')\"; Write-Output 'NOT-THROWN' } catch { Write-Output 'THROWN' }",
    ].join("\r\n") + "\r\n");
    const log = path.join(base, "control.log");
    runLikeLauncher(script, "", log);
    assert.match(readLog(log), /THROWN/);
    assert.doesNotMatch(readLog(log), /NOT-THROWN/);
  });

  scenario("the wrapper stays pure ASCII (it is read without a BOM by Windows PowerShell 5.1)", () => {
    const bytes = fs.readFileSync(path.join(REPO_ROOT, "scripts", "ayas-autonomy-daemon.ps1"));
    assert.ok(bytes.every((b) => b < 0x80), "non-ASCII byte in scripts/ayas-autonomy-daemon.ps1");
  });

  scenario("a crash report on stderr is retried by the M25 loop, not fatal to the wrapper; npx still receives the observer's arguments", () => {
    const f = wrapperFixture([1, 0]);
    const code = runLikeLauncher(f.wrapper, "-Continuous -MaxRestarts 3 -RestartDelaySeconds 0", f.log, f.shim);
    const log = readLog(f.log);
    assert.equal(code, 0, log);
    assert.equal(f.launches(), 2, `the crashed observer must be launched again\n${log}`);
    assert.match(log, /exited unexpectedly \(exit code 1, attempt 1\/3\)/);
    assert.match(log, /simulated crash/, "stderr still reaches the log");
    assert.deepEqual(f.npxArgs(), ["tsx scripts/ayas-autonomy-daemon.ts --continuous --interval-ms 300000", "tsx scripts/ayas-autonomy-daemon.ts --continuous --interval-ms 300000"]);
  });

  scenario("a dependency sync whose installer warns on stderr still swaps node_modules in and clears the marker", () => {
    const f = wrapperFixture([0]);
    f.requestSync();
    assert.ok(fs.existsSync(f.marker));
    const code = runLikeLauncher(f.wrapper, `-Continuous -MaxRestarts 3 -RestartDelaySeconds 0 -DependencySyncScript ${q(f.install)}`, f.log, f.shim);
    const log = readLog(f.log);
    assert.equal(code, 0, log);
    assert.doesNotMatch(log, /dependency sync failed/, log);
    assert.match(log, /node_modules replaced from package-lock\.json/);
    assert.ok(fs.existsSync(path.join(f.repo, "node_modules", "new-pkg")), "the new tree is in place");
    assert.equal(fs.existsSync(path.join(f.repo, "node_modules", "old-pkg")), false, "the old tree is gone");
    assert.equal(fs.existsSync(f.marker), false, "the marker is cleared, so no further planned restarts");
    assert.equal(f.launches(), 1);
  });

  scenario("an installer that really fails (non-zero exit) still keeps node_modules and the marker", () => {
    const f = wrapperFixture([0]);
    f.requestSync();
    fs.writeFileSync(f.install, `${BOM}param([string]$staging)\r\n& node -e "process.stderr.write('npm error E404\\n'); process.exit(3)"\r\nexit $LASTEXITCODE\r\n`);
    const code = runLikeLauncher(f.wrapper, `-Continuous -MaxRestarts 3 -RestartDelaySeconds 0 -DependencySyncScript ${q(f.install)}`, f.log, f.shim);
    const log = readLog(f.log);
    assert.equal(code, 0, log);
    assert.match(log, /install failed \(exit 3\); current node_modules kept/);
    assert.equal(fs.readFileSync(path.join(f.repo, "node_modules", "old-pkg", "index.js"), "utf8"), "old\n");
    assert.ok(fs.existsSync(f.marker));
  });

  console.log(`PASS (${count} scenarios)`);
}

main();

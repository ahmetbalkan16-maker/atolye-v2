param(
  [switch]$Continuous,
  [int]$IntervalMs = 300000,
  # M25: bounded restart-loop tuning, overridable ONLY so this is testable
  # without a real test waiting out real minutes - production callers
  # (the Startup shortcut / Task Scheduler action) never pass these.
  [int]$MaxRestarts = 10,
  [int]$RestartDelaySeconds = 30,
  # Owner decisions 2026-10-15 (update executor): overridable ONLY so the
  # dependency sync is testable without a real npm install. A script that
  # receives the staging folder and installs node_modules into it.
  [string]$DependencySyncScript = ""
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot

# The observer asks for this restart (exit 75) after an owner-approved update
# changed package-lock.json: no node process of this tree holds node_modules
# between two launches, so this is the one moment it can be replaced. First a
# rename probe: a tree another process still holds (an editor's language
# server loads native modules from it) cannot be renamed, so nothing is
# installed until it can; the observer asks again at most hourly. Then the new
# tree is installed beside it (D temp) and swapped in by two renames on the
# same volume. Any failure leaves the current node_modules as it was and keeps
# the marker; nothing here can stop the observer from launching. Never touches
# the live copy, which runs from its own snapshot.
$PlannedSyncExitCode = 75
function Sync-AyasDependencies {
  $marker = Join-Path $repo "data\brain\self-improvement\update-trials\canonical-sync-required.json"
  if (-not (Test-Path -LiteralPath $marker)) { return }
  $studio = Split-Path -Parent (Split-Path -Parent $repo)
  $current = Join-Path $repo "node_modules"
  $probe = Join-Path $repo "node_modules.ayas-sync-probe"
  $staging = Join-Path $studio ("private\temp\ayas-node-modules-sync-" + (Get-Date -Format "yyyyMMdd-HHmmss"))
  $previous = Join-Path $staging "node_modules.previous"
  try {
    # A probe left by an interrupted earlier attempt is the real tree.
    if (-not (Test-Path -LiteralPath $current) -and (Test-Path -LiteralPath $probe)) { Rename-Item -LiteralPath $probe -NewName "node_modules" }
    if (Test-Path -LiteralPath $current) {
      try { Rename-Item -LiteralPath $current -NewName (Split-Path -Leaf $probe) }
      catch { Write-Output "AYAS dependency sync: node_modules is in use; deferred, current node_modules kept."; return }
      Rename-Item -LiteralPath $probe -NewName "node_modules"
    }
    New-Item -ItemType Directory -Force -Path $staging | Out-Null
    Copy-Item -LiteralPath (Join-Path $repo "package.json"), (Join-Path $repo "package-lock.json") -Destination $staging
    $global:LASTEXITCODE = 0
    if ($DependencySyncScript) {
      & $DependencySyncScript $staging
    } else {
      $npmCli = Join-Path (Split-Path -Parent (Get-Command node).Source) "node_modules\npm\bin\npm-cli.js"
      $env:TEMP = Join-Path $studio "private\temp"; $env:TMP = $env:TEMP
      $env:NPM_CONFIG_CACHE = Join-Path $studio "private\npm-cache"
      Push-Location -LiteralPath $staging
      try { & node $npmCli ci --ignore-scripts --prefer-offline --no-audit --no-fund } finally { Pop-Location }
    }
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath (Join-Path $staging "node_modules"))) {
      Write-Output "AYAS dependency sync: install failed (exit $LASTEXITCODE); current node_modules kept."
      return
    }
    if (Test-Path -LiteralPath $current) { Move-Item -LiteralPath $current -Destination $previous }
    try { Move-Item -LiteralPath (Join-Path $staging "node_modules") -Destination $current }
    catch { if (Test-Path -LiteralPath $previous) { Move-Item -LiteralPath $previous -Destination $current }; throw }
    Remove-Item -LiteralPath $marker -Force
    Write-Output "AYAS dependency sync: node_modules replaced from package-lock.json."
  } catch {
    Write-Output "AYAS dependency sync failed: $($_.Exception.Message); current node_modules kept."
  } finally {
    if (Test-Path -LiteralPath $staging) {
      try { Remove-Item -LiteralPath $staging -Recurse -Force } catch { Write-Output "AYAS dependency sync: staging left at $staging" }
    }
  }
}
# NEVER name this `$args`. On Windows `npx` resolves to npm's own `npx.ps1`
# shim, and when that shim is called from a SCRIPT it deliberately ignores the
# arguments PowerShell bound for it: it re-parses the caller's raw invocation
# text (`$MyInvocation.Statement`), drops the command name, and re-runs the
# remainder through `Invoke-Expression`. So the literal token we write here -
# `@args` or `@daemonArgs` - is what gets re-evaluated, and it is evaluated
# inside `Invoke-Expression`'s OWN new scope. `$args` is an automatic variable
# that exists per-scope, so there it resolves to that new scope's empty
# collection and `@args` splats NOTHING. Any other name is not automatic, so
# PowerShell's dynamic scoping walks back up the call stack and finds the array
# assigned right here, which is why `$daemonArgs` forwards correctly.
# The pre-fix symptom was silent: `npx` ran with no arguments at all, which
# opens an interactive shell that immediately reads EOF and exits 0, so the
# $LASTEXITCODE guard below saw "success" while the observer never started.
$daemonArgs = @("tsx", "scripts/ayas-autonomy-daemon.ts")
if ($Continuous) { $daemonArgs += "--continuous" }
$daemonArgs += @("--interval-ms", [string]$IntervalMs)
Push-Location $repo
try {
  if ($Continuous) {
    # M25 forensics: a `-Continuous` observer is designed to run forever
    # (`ayas-autonomy-daemon.ts`'s own `do {...} while (continuous)` never
    # returns while continuous is true), so ANY exit of the launched process
    # - crash, unhandled exception, or an abrupt external termination of the
    # whole process tree - is unexpected. Live evidence: a real observer
    # acquired the research scheduler's lock for an overdue cycle and the
    # entire process tree vanished within minutes, with nothing outside this
    # wrapper to notice or recover it until the next interactive logon (in
    # that incident, ~3 days later). Neither the Startup-folder shortcut nor
    # Task Scheduler's own restart-on-failure (see
    # register-ayas-autonomy-autostart.ps1 - preferred when available, but
    # confirmed refused by this session's own permissions, matching the
    # documented Access-daemon fallback precedent) fire again mid-session, so
    # recovery has to live here, in the one process guaranteed to still be
    # running. Only a NON-ZERO exit is retried - `ayas-autonomy-daemon.ts`'s
    # continuous loop has no code path that returns 0 (its only exits are an
    # uncaught exception, which reports 1, or an external termination, which
    # Windows never reports as a clean 0) - so an exact 0 is trusted as a
    # deliberate stop, never retried. Bounded, not infinite, so a
    # persistently broken build/config produces one final, visible non-zero
    # exit rather than a silent, resource-consuming crash loop running forever.
    $attempt = 0
    # Only this loop handles exit 75, so only its observer may ask for it.
    $env:AYAS_OBSERVER_SYNC_RESTART = "1"
    while ($true) {
      Sync-AyasDependencies
      & npx @daemonArgs
      $code = $LASTEXITCODE
      if ($code -eq 0) { exit 0 }
      # A planned restart for the dependency sync is not a crash: not counted, no delay.
      if ($code -eq $PlannedSyncExitCode) { Write-Output "AYAS autonomy observer: planned restart for the dependency sync."; continue }
      $attempt += 1
      if ($attempt -ge $MaxRestarts) {
        Write-Error "AYAS autonomy observer exited $attempt time(s) (last exit code $code) - giving up after $MaxRestarts restarts; will resume at the next logon."
        exit 1
      }
      Write-Output "AYAS autonomy observer exited unexpectedly (exit code $code, attempt $attempt/$MaxRestarts) - restarting in ${RestartDelaySeconds}s."
      Start-Sleep -Seconds $RestartDelaySeconds
    }
  }
  & npx @daemonArgs
  # PowerShell does not throw on a failed NATIVE command by itself, so
  # `$ErrorActionPreference = "Stop"` alone would silently let a failed
  # launch (missing repo, missing node_modules, tsx not resolvable) report
  # success to whatever started this (Windows Startup/Task Scheduler) -
  # fail visibly instead of falling through.
  if ($LASTEXITCODE -ne 0) {
    Write-Error "AYAS autonomy observer failed to start (npx tsx exited $LASTEXITCODE)"
    exit $LASTEXITCODE
  }
} finally { Pop-Location }

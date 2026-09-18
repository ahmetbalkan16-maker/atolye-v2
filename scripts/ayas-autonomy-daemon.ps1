param(
  [switch]$Continuous,
  [int]$IntervalMs = 300000
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
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

param(
  [switch]$Continuous,
  [int]$IntervalMs = 300000
)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$args = @("tsx", "scripts/ayas-autonomy-daemon.ts")
if ($Continuous) { $args += "--continuous" }
$args += @("--interval-ms", [string]$IntervalMs)
Push-Location $repo
try {
  & npx @args
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

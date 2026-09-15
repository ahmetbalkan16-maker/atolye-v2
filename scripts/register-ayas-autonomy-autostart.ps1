param([switch]$Apply, [string]$StartupDir)

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
# `-StartupDir` exists ONLY so this script is testable against an isolated
# fixture directory (dry-run and duplicate-detection tests) without ever
# touching the real per-user Startup folder; omitted, it is the real one.
$startup = if ($StartupDir) { $StartupDir } else { [Environment]::GetFolderPath("Startup") }
$shortcutPath = Join-Path $startup "AYAS Autonomy Observer.lnk"
$target = Join-Path $PSScriptRoot "ayas-autonomy-daemon.ps1"
$alreadyInstalled = Test-Path -LiteralPath $shortcutPath

if (-not $Apply) {
  Write-Output "DRY-RUN: $shortcutPath"
  Write-Output "Target: $target -Continuous"
  Write-Output "Mode: continuous, observe-only; approvals are required before any development apply."
  if ($alreadyInstalled) {
    Write-Output "Existing installation detected at this path - applying would REPLACE it (same fixed shortcut name, never a duplicate)."
  } else {
    Write-Output "No existing installation detected - applying would CREATE it."
  }
  exit 0
}

if ($alreadyInstalled) {
  Write-Output "Existing installation detected at $shortcutPath - replacing it with the current target."
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = "powershell.exe"
# Continuous mode (product decision): AYAS keeps observing development state
# for the session, not just a single tick at login, so Gelisim Merkezi and
# the natural-language status path have something current to show. This
# changes ONLY how long the read-only observer runs - never what it is
# authorized to do. See AyasAutonomyObserver.ts / ayas-autonomy-daemon.ts:
# no code path here or downstream gains execution/approval authority from
# running longer.
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$target`" -Continuous"
$shortcut.WorkingDirectory = $repo
$shortcut.Description = "AYAS approval-gated autonomy observer (continuous, observer-only)"
$shortcut.Save()
Write-Output "Installed user-level AYAS autonomy observer startup shortcut (continuous mode): $shortcutPath"

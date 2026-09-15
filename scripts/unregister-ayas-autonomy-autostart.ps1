param([switch]$Apply, [string]$StartupDir)

$ErrorActionPreference = "Stop"
# `-StartupDir` exists ONLY for isolated dry-run/idempotence testing - see
# the matching parameter in register-ayas-autonomy-autostart.ps1.
$startup = if ($StartupDir) { $StartupDir } else { [Environment]::GetFolderPath("Startup") }
$shortcutPath = Join-Path $startup "AYAS Autonomy Observer.lnk"
$exists = Test-Path -LiteralPath $shortcutPath

if (-not $Apply) {
  if ($exists) { Write-Output "DRY-RUN: would remove $shortcutPath" } else { Write-Output "DRY-RUN: no AYAS autonomy observer shortcut is installed; nothing to remove." }
  exit 0
}

if ($exists) { Remove-Item -LiteralPath $shortcutPath -Force; Write-Output "Removed $shortcutPath" } else { Write-Output "No AYAS autonomy observer shortcut was installed." }

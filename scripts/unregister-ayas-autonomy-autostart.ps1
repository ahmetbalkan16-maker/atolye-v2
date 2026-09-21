param([switch]$Apply, [string]$StartupDir, [string]$TaskName = "AYAS Autonomy Observer")

$ErrorActionPreference = "Stop"
# `-StartupDir`/`-TaskName` exist ONLY for isolated dry-run/idempotence
# testing - see the matching parameters in register-ayas-autonomy-autostart.ps1.
# M25: removes whichever mechanism is actually installed (scheduled task,
# Startup shortcut, or - defensively - both), mirroring
# unregister-ayas-autostart.ps1's own defensive-removal pattern.
$startup = if ($StartupDir) { $StartupDir } else { [Environment]::GetFolderPath("Startup") }
$shortcutPath = Join-Path $startup "AYAS Autonomy Observer.lnk"
$taskExists = [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue)
$shortcutExists = Test-Path -LiteralPath $shortcutPath

if (-not $Apply) {
  if (-not $taskExists -and -not $shortcutExists) {
    Write-Output "DRY-RUN: no AYAS autonomy observer autostart registration is installed; nothing to remove."
  } else {
    if ($taskExists) { Write-Output "DRY-RUN: would remove scheduled task '$TaskName'" }
    if ($shortcutExists) { Write-Output "DRY-RUN: would remove $shortcutPath" }
  }
  exit 0
}

$removedAny = $false
if ($taskExists) { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false; Write-Output "Removed scheduled task '$TaskName'"; $removedAny = $true }
if ($shortcutExists) { Remove-Item -LiteralPath $shortcutPath -Force; Write-Output "Removed $shortcutPath"; $removedAny = $true }
if (-not $removedAny) { Write-Output "No AYAS autonomy observer shortcut was installed." }

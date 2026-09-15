<#
.SYNOPSIS
  Removes "AYAS Access Online" autostart, however it was registered — the
  Task Scheduler task, the Startup-folder shortcut, or (defensively) both.
  Does not stop an already-running app server / tunnel.
#>
$ErrorActionPreference = "Stop"
$TaskName = "AYAS Access Online"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "AYAS Access Online.lnk"

$removedAny = $false

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
  Write-Host "Removed scheduled task '$TaskName'."
  $removedAny = $true
}

if (Test-Path $ShortcutPath) {
  Remove-Item $ShortcutPath -Force
  Write-Host "Removed Startup shortcut: $ShortcutPath"
  $removedAny = $true
}

if (-not $removedAny) {
  Write-Host "No AYAS autostart registration found (neither a scheduled task nor a Startup shortcut) - nothing to remove."
}

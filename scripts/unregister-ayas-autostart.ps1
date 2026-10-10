<#
.SYNOPSIS
  Dry-run by default. -Apply disables this project's task and removes only
  its verified startup shortcut. Preserves definitions, logs and manifest;
  does not stop any running process.
#>
param([switch]$Apply)
$ErrorActionPreference = "Stop"
$TaskName = "AYAS Access Online"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "AYAS Access Online.lnk"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$task = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
if ($task -and $task.Actions[0].WorkingDirectory -ne $RepoRoot) { throw 'AYAS_ACCESS_TASK_IDENTITY_UNVERIFIED' }
$shortcut = $null
if (Test-Path -LiteralPath $ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  # Current hidden launcher, or the earlier direct powershell.exe shortcut.
  $hiddenExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
  $hiddenArgs = '//B //NoLogo "' + (Join-Path $RepoRoot 'scripts\ayas-access-hidden.vbs') + '"'
  $visibleExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
  $visibleArgs = '-NoProfile -WindowStyle Hidden -File "' + (Join-Path $RepoRoot 'scripts\ayas-access-daemon.ps1') + '" -Continuous -IntervalSeconds 60'
  $isHidden = $shortcut.TargetPath -eq $hiddenExe -and $shortcut.Arguments -eq $hiddenArgs
  $isVisible = $shortcut.TargetPath -eq $visibleExe -and $shortcut.Arguments -eq $visibleArgs
  if ($shortcut.WorkingDirectory -ne $RepoRoot -or -not ($isHidden -or $isVisible)) {
    throw 'AYAS_ACCESS_SHORTCUT_IDENTITY_UNVERIFIED'
  }
}
if (-not $Apply) { Write-Output 'DRY-RUN: disable owned autostart only; preserve all running services, definitions, data and qualification.'; return }

$removedAny = $false

if ($task -and $task.Settings.Enabled) {
  Disable-ScheduledTask -TaskName $TaskName | Out-Null
  Write-Host "Disabled scheduled task '$TaskName'; definition preserved."
  $removedAny = $true
}

if ($shortcut) {
  Remove-Item -LiteralPath $ShortcutPath
  Write-Host "Removed Startup shortcut: $ShortcutPath"
  $removedAny = $true
}

if (-not $removedAny) {
  Write-Host "No AYAS autostart registration found (neither a scheduled task nor a Startup shortcut) - nothing to remove."
}

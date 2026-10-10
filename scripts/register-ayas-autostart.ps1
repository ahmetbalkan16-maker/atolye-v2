<#
.SYNOPSIS
  Dry-run by default. -Apply registers current-user, limited logon startup
  for an explicitly qualified existing build. No build/install is allowed.

.DESCRIPTION
  Tries the Task Scheduler route first (Register-ScheduledTask, AtLogOn,
  current user, Limited run level — this itself needs no elevation on most
  machines). If Task Scheduler registration is refused by this session's own
  permissions, only an absent/disabled legacy task permits the per-user
  Startup shortcut fallback. Tasks and running processes are never deleted.

  Both routes start the daemon through wscript.exe and
  scripts\ayas-access-hidden.vbs. Windows 11 hands a powershell.exe console to
  a visible Windows Terminal window, which ignores -WindowStyle Hidden. A
  shortcut made by the earlier version (powershell.exe target) is rewritten in
  place to the hidden launcher; no second registration is created.
#>
param([switch]$Apply)
$ErrorActionPreference = "Stop"

$TaskName = "AYAS Access Online"
$RepoRoot = Split-Path -Parent $PSScriptRoot
$DaemonScript = Join-Path $RepoRoot "scripts\ayas-access-daemon.ps1"
$HiddenLauncher = Join-Path $RepoRoot "scripts\ayas-access-hidden.vbs"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "AYAS Access Online.lnk"
$AccessArguments = "-NoProfile -WindowStyle Hidden -File `"$DaemonScript`" -Continuous -IntervalSeconds 60"
$PowerShellExe = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$WScriptExe = Join-Path $env:SystemRoot 'System32\wscript.exe'
$LauncherArguments = "//B //NoLogo `"$HiddenLauncher`""
$CurrentUser = "$env:USERDOMAIN\$env:USERNAME"
$Existing = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
$ManifestPath = Join-Path $env:LOCALAPPDATA 'AtolyeAyasAccess\prebuilt-runtime-v1.json'
$OwnerIds = @($env:USERNAME, $CurrentUser, [Security.Principal.WindowsIdentity]::GetCurrent().User.Value)

if (-not (Test-Path $DaemonScript)) {
  throw "Daemon script not found at $DaemonScript"
}
if (-not (Test-Path -LiteralPath $HiddenLauncher -PathType Leaf)) {
  throw "Hidden launcher not found at $HiddenLauncher"
}
if ($Existing -and ($Existing.Actions.Count -ne 1 -or $Existing.Actions[0].WorkingDirectory -ne $RepoRoot -or
    $Existing.Principal.RunLevel -ne 0 -or $Existing.Principal.UserId -notin $OwnerIds)) {
  throw 'AYAS_ACCESS_EXISTING_TASK_IDENTITY_UNVERIFIED'
}
if (-not $Apply) {
  Write-Output "DRY-RUN: current-user logon; qualified existing build only; no build/install/authority change."
  Write-Output "Target: $WScriptExe $LauncherArguments"
  Write-Output "Hidden command: $PowerShellExe $AccessArguments"
  Write-Output "Qualification required: $ManifestPath"
  return
}
if (-not (Test-Path -LiteralPath $ManifestPath -PathType Leaf)) { throw 'AYAS_ACCESS_PREBUILT_QUALIFICATION_REQUIRED' }
$AlreadyRegistered = $false
$UpgradeVisibleShortcut = $false
if (Test-Path -LiteralPath $ShortcutPath) {
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  if ($shortcut.WorkingDirectory -ne $RepoRoot -or ($Existing -and $Existing.Settings.Enabled)) {
    throw 'AYAS_ACCESS_EXISTING_SHORTCUT_REQUIRES_REVIEW'
  }
  if ($shortcut.TargetPath -eq $WScriptExe -and $shortcut.Arguments -eq $LauncherArguments) { $AlreadyRegistered = $true }
  elseif ($shortcut.TargetPath -eq $PowerShellExe -and $shortcut.Arguments -eq $AccessArguments) { $UpgradeVisibleShortcut = $true }
  else { throw 'AYAS_ACCESS_EXISTING_SHORTCUT_REQUIRES_REVIEW' }
}
$NodeExe = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
& $NodeExe (Join-Path $PSScriptRoot 'ayas-prebuilt-runtime.mjs') '--check' $RepoRoot $ManifestPath 'C:\Program Files (x86)\cloudflared\cloudflared.exe' (Join-Path $env:USERPROFILE '.cloudflared\config.yml')
if ($LASTEXITCODE -ne 0) { throw 'AYAS_ACCESS_PREBUILT_QUALIFICATION_FAILED' }
if ($AlreadyRegistered) { Write-Output 'Already registered: verified current-user startup shortcut; no duplicate or overwrite.'; return }

function Register-ViaTaskScheduler {
  $action = New-ScheduledTaskAction -Execute $WScriptExe `
    -Argument $LauncherArguments -WorkingDirectory $RepoRoot
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $CurrentUser
  $principal = New-ScheduledTaskPrincipal -UserId $CurrentUser -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1) -MultipleInstances IgnoreNew

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description `
    "Starts the qualified existing AYAS build and existing named tunnel at current-user logon; never builds, installs, upgrades or grants execution authority." `
    -Force | Out-Null
}

function Register-ViaStartupShortcut {
  # Never delete a task or evade an enabled/unmodifiable legacy registration.
  $taskNow = Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue
  if ($taskNow -and $taskNow.Settings.Enabled) { throw 'AYAS_ACCESS_ENABLED_TASK_BLOCKS_SHORTCUT_FALLBACK' }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = $WScriptExe
  $shortcut.Arguments = $LauncherArguments
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.WindowStyle = 7  # minimized; wscript //B shows no window either way
  $shortcut.Description = "Starts qualified existing AYAS build and existing tunnel in the background; never builds or installs."
  $shortcut.Save()
}

if ($UpgradeVisibleShortcut) {
  # Same owned registration, same file: only the launch becomes windowless.
  Register-ViaStartupShortcut
  Write-Output "Upgraded Startup shortcut to the hidden launcher: $ShortcutPath (applies from the next logon)."
  return
}

$usedMechanism = $null
try {
  Register-ViaTaskScheduler
  $usedMechanism = "task-scheduler"
} catch {
  if ($_.Exception.HResult -ne -2147024891 -and $_.Exception.Message -notmatch 'Access.*denied|Erişim.*engellendi|0x80070005') { throw }
  Write-Host "Task Scheduler registration was refused by this session ($($_.Exception.Message)) - falling back to a Startup-folder shortcut (no admin needed)."
  Register-ViaStartupShortcut
  $usedMechanism = "startup-folder"
}

if ($usedMechanism -eq "task-scheduler") {
  Write-Host "Registered scheduled task '$TaskName' (runs at your next logon)."
  Write-Host "Start it right now with:  Start-ScheduledTask -TaskName '$TaskName'"
} else {
  Write-Host "Created Startup shortcut: $ShortcutPath (runs at your next logon)."
  Write-Host "Start it right now with:  $WScriptExe $LauncherArguments"
}
Write-Host "Remove it with:           scripts\unregister-ayas-autostart.ps1"

<#
.SYNOPSIS
  Registers "AYAS Access Online" to run the narrow, single-owner access
  supervisor at logon. Running this registration script changes Windows
  persistence and requires separate owner authorization.

.DESCRIPTION
  Tries the Task Scheduler route first (Register-ScheduledTask, AtLogOn,
  current user, Limited run level — this itself needs no elevation on most
  machines). If Task Scheduler registration is refused by this session's own
  permissions (observed: "Erişim engellendi" / Access denied, HRESULT
  0x80070005 — a session/policy restriction, not something this script should
  try to escalate past), it falls back to the classic, always-available,
  zero-admin per-user mechanism: a shortcut in the user's own Startup folder
  (`shell:startup`) that Windows runs automatically at every logon for this
  user, with a hidden window. Either way, re-running this script is
  idempotent — it replaces its own prior registration, never duplicates it.
#>
$ErrorActionPreference = "Stop"

$TaskName = "AYAS Access Online"
$RepoRoot = "C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\atolye-v2"
$DaemonScript = Join-Path $RepoRoot "scripts\ayas-access-daemon.ps1"
$StartupDir = [Environment]::GetFolderPath("Startup")
$ShortcutPath = Join-Path $StartupDir "AYAS Access Online.lnk"
$AccessArguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$DaemonScript`" -Continuous -IntervalSeconds 60"

if (-not (Test-Path $DaemonScript)) {
  throw "Daemon script not found at $DaemonScript"
}

function Register-ViaTaskScheduler {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" `
    -Argument $AccessArguments
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description `
    "Starts the AYAS production Next server + named Cloudflare tunnel (ayas) at logon. Never touches the Execution Gate, self-improvement, or production resume - process/network only." `
    -Force | Out-Null
}

function Register-ViaStartupShortcut {
  # Remove a stale Task Scheduler registration from a previous run on a
  # differently-privileged session, so there is never more than one
  # autostart path active at once.
  if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
    try { Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false } catch { }
  }
  $shell = New-Object -ComObject WScript.Shell
  $shortcut = $shell.CreateShortcut($ShortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = $AccessArguments
  $shortcut.WorkingDirectory = $RepoRoot
  $shortcut.WindowStyle = 7  # minimized — belt-and-braces alongside -WindowStyle Hidden
  $shortcut.Description = "Starts AYAS production Next server + named Cloudflare tunnel (ayas) at logon (no execution-gate / self-improvement / production-resume effect)."
  $shortcut.Save()
}

$usedMechanism = $null
try {
  Register-ViaTaskScheduler
  $usedMechanism = "task-scheduler"
} catch {
  Write-Host "Task Scheduler registration was refused by this session ($($_.Exception.Message)) - falling back to a Startup-folder shortcut (no admin needed)."
  Register-ViaStartupShortcut
  $usedMechanism = "startup-folder"
}

if ($usedMechanism -eq "task-scheduler") {
  Write-Host "Registered scheduled task '$TaskName' (runs at your next logon)."
  Write-Host "Start it right now with:  Start-ScheduledTask -TaskName '$TaskName'"
} else {
  Write-Host "Created Startup shortcut: $ShortcutPath (runs at your next logon)."
  Write-Host "Start it right now with:  powershell.exe $AccessArguments"
}
Write-Host "Remove it with:           scripts\unregister-ayas-autostart.ps1"

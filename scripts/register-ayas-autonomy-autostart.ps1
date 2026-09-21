param([switch]$Apply, [string]$StartupDir, [string]$TaskName = "AYAS Autonomy Observer", [switch]$ForceStartupShortcut)

<#
  M25 forensics: a plain Startup-folder shortcut has NO crash-restart
  supervision. Live evidence — a real observer process (PID confirmed dead
  afterward) started at a genuine interactive logon, acquired the research
  scheduler's execution-authority lock for an overdue DEEP research cycle,
  and then the entire process tree vanished within minutes, with nothing to
  bring it back until the NEXT interactive logon (in this case, ~3 days
  later). A visible perpetual console window is also a plausible proximate
  trigger (easy for a user to close without realizing what it is) — this
  fix removes that risk too (hidden window) as a secondary, low-cost hardening.

  Mirrors the already-proven pattern this same repo uses for "AYAS Access
  Online" (`register-ayas-autostart.ps1`): Task Scheduler first (AtLogOn,
  current user, no elevation, `-RestartCount`/`-RestartInterval` for crash
  recovery), falling back to the classic Startup-folder shortcut only if
  Task Scheduler registration is refused by this session's own permissions.
  Unlike the Access daemon (a short idempotent check-and-launch that exits
  quickly), the observer is a genuinely long-running `-Continuous` process,
  so `ExecutionTimeLimit` is explicitly set to zero (indefinite) rather than
  left at the module's 3-day default, which would otherwise kill it outright
  every 3 days regardless of crashes.
#>

$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent $PSScriptRoot
$target = Join-Path $PSScriptRoot "ayas-autonomy-daemon.ps1"
# `-StartupDir` exists ONLY so the shortcut fallback path is testable against
# an isolated fixture directory (dry-run and duplicate-detection tests)
# without ever touching the real per-user Startup folder; omitted, it is the
# real one. `-TaskName` gives the Task Scheduler path the same isolation.
# `-ForceStartupShortcut` exists ONLY so the shortcut mechanism itself stays
# testable in isolation without depending on Task Scheduler being refused by
# the test session's own permissions (which it normally is not).
$startup = if ($StartupDir) { $StartupDir } else { [Environment]::GetFolderPath("Startup") }
$shortcutPath = Join-Path $startup "AYAS Autonomy Observer.lnk"

# Continuous mode (product decision, unchanged by this fix): AYAS keeps
# observing development state for the session, not just a single tick at
# login, so Gelisim Merkezi and the natural-language status path have
# something current to show. This changes ONLY how long the read-only
# observer runs, and now how reliably it stays running - never what it is
# authorized to do. See AyasAutonomyObserver.ts / ayas-autonomy-daemon.ts: no
# code path here or downstream gains execution/approval authority from
# running longer or restarting automatically.
$argumentString = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$target`" -Continuous"

function Register-ViaTaskScheduler {
  $action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument $argumentString -WorkingDirectory $repo
  $trigger = New-ScheduledTaskTrigger -AtLogOn
  $principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
  $settings = New-ScheduledTaskSettingsSet `
    -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries `
    -StartWhenAvailable -ExecutionTimeLimit ([TimeSpan]::Zero) `
    -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)

  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger `
    -Principal $principal -Settings $settings -Description `
    "AYAS approval-gated autonomy observer (continuous, observer-only). Restarts itself up to 3 times (1 min apart) if it exits unexpectedly; never touches execution/approval authority." `
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
  $shortcut = $shell.CreateShortcut($shortcutPath)
  $shortcut.TargetPath = "powershell.exe"
  $shortcut.Arguments = $argumentString
  $shortcut.WorkingDirectory = $repo
  $shortcut.WindowStyle = 7  # minimized - belt-and-braces alongside -WindowStyle Hidden
  $shortcut.Description = "AYAS approval-gated autonomy observer (continuous, observer-only)"
  $shortcut.Save()
}

if (-not $Apply) {
  $taskExists = if ($ForceStartupShortcut) { $false } else { [bool](Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) }
  $shortcutExists = Test-Path -LiteralPath $shortcutPath
  if ($ForceStartupShortcut) {
    Write-Output "DRY-RUN (shortcut forced): $shortcutPath"
  } else {
    Write-Output "DRY-RUN: prefers Task Scheduler task '$TaskName' (AtLogOn, restart-on-exit up to 3x/1min), falls back to $shortcutPath only if Task Scheduler registration is refused."
  }
  Write-Output "Target: $target -Continuous"
  Write-Output "Mode: continuous, observe-only; approvals are required before any development apply."
  if ($taskExists) { Write-Output "Existing scheduled task detected - applying would REPLACE it." }
  if ($shortcutExists -and $ForceStartupShortcut) { Write-Output "Existing installation detected at this path - applying would REPLACE it (same fixed shortcut name, never a duplicate)." }
  elseif ($shortcutExists) { Write-Output "Existing Startup shortcut detected at this path - applying would remove/replace it depending on which mechanism succeeds." }
  if (-not $taskExists -and -not $shortcutExists) { Write-Output "No existing installation detected - applying would CREATE it." }
  exit 0
}

$usedMechanism = $null
if ($ForceStartupShortcut) {
  Register-ViaStartupShortcut
  $usedMechanism = "startup-folder"
} else {
  try {
    Register-ViaTaskScheduler
    $usedMechanism = "task-scheduler"
    # A Task Scheduler registration supersedes any leftover Startup shortcut
    # from a prior, less-reliable install - never leave both active.
    if (Test-Path -LiteralPath $shortcutPath) { Remove-Item -LiteralPath $shortcutPath -Force }
  } catch {
    Write-Output "Task Scheduler registration was refused by this session ($($_.Exception.Message)) - falling back to a Startup-folder shortcut (no admin needed)."
    Register-ViaStartupShortcut
    $usedMechanism = "startup-folder"
  }
}

if ($usedMechanism -eq "task-scheduler") {
  Write-Output "Installed AYAS autonomy observer as scheduled task '$TaskName' (continuous mode, restarts on unexpected exit)."
} else {
  Write-Output "Installed user-level AYAS autonomy observer startup shortcut (continuous mode): $shortcutPath"
}

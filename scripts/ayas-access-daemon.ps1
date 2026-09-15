<#
.SYNOPSIS
  AYAS phone access daemon — idempotent, zero-cost, no admin required.

.DESCRIPTION
  Ensures the AYAS production app server (`npm run build` + `npm start`) and
  the configured Cloudflare named tunnel (`cloudflared tunnel run ayas`) are running, then writes a small, bounded status file the app itself
  reads (`AyasPhoneAccessHealth.ts`). Safe to re-run at any time, including
  from Task Scheduler at every logon — it never starts a second app server or
  a second tunnel, and it never touches the Execution Gate, autonomous
  self-improvement, or production resume. Booting the PC means only one
  thing: "AYAS ACCESS ONLINE" (or an honest status file saying it isn't yet).

  Nothing here requires elevation. All state lives under
  `%LOCALAPPDATA%\AtolyeAyasAccess\` (pid files + rotated logs) except the
  small status JSON, which lives under the repo's existing `data/brain/`
  local-working-state convention so the running app can read it directly.

.NOTES
  Run manually any time:
    powershell -ExecutionPolicy Bypass -File scripts\ayas-access-daemon.ps1
  Registered for automatic use by scripts\register-ayas-autostart.ps1.
#>
param(
  [int]$Port = 3000,
  [string]$RepoRoot = "C:\Users\Metod\Desktop\solid\SW2020.x64.SP4.0\Program\Atölye\atolye-v2",
  [string]$CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe"
)

$ErrorActionPreference = "Stop"

$StateDir = Join-Path $env:LOCALAPPDATA "AtolyeAyasAccess"
$LogDir = Join-Path $StateDir "logs"
$StatusDir = Join-Path $RepoRoot "data\brain\phone-access"
$StatusFile = Join-Path $StatusDir "status.json"
$AppPidFile = Join-Path $StateDir "app-server.pid"
$TunnelPidFile = Join-Path $StateDir "cloudflared.pid"
$BuildLog = Join-Path $LogDir "next-build.log"
$BuildErrLog = Join-Path $LogDir "next-build.err.log"
$AppLog = Join-Path $LogDir "app-server.log"
$AppErrLog = Join-Path $LogDir "app-server.err.log"
$TunnelLog = Join-Path $LogDir "cloudflared.log"
$TunnelStdoutLog = Join-Path $LogDir "cloudflared-stdout.log"
$DaemonLog = Join-Path $LogDir "daemon.log"
$CloudflaredConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$TunnelName = "ayas"
$NamedTunnelUrl = "https://ayas.atolyeayas.com"

New-Item -ItemType Directory -Force -Path $StateDir, $LogDir, $StatusDir | Out-Null

function Write-Log([string]$Message) {
  $line = "[{0}] {1}" -f (Get-Date -Format "s"), $Message
  # Explicit UTF8 — Add-Content's default (system ANSI codepage) mangles the
  # non-ASCII characters (em dashes) used throughout this daemon's own log text.
  Add-Content -Path $DaemonLog -Value $line -Encoding utf8
}

# Sensible log rotation — one previous copy, capped size. Never grows unbounded.
function Invoke-LogRotation([string]$Path, [long]$MaxBytes = 5MB) {
  if ((Test-Path $Path) -and (Get-Item $Path).Length -gt $MaxBytes) {
    $old = "$Path.old"
    Remove-Item $old -Force -ErrorAction SilentlyContinue
    Rename-Item $Path $old -Force
  }
}
foreach ($log in @($BuildLog, $BuildErrLog, $AppLog, $AppErrLog, $TunnelLog, $TunnelStdoutLog, $DaemonLog)) { Invoke-LogRotation $log }

function Test-PortListening([int]$TargetPort) {
  try {
    return [bool](Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction Stop | Select-Object -First 1)
  } catch {
    return $false
  }
}

function Test-LocalHealth([int]$TargetPort) {
  # ANY response (incl. the 307 → /login access-gate redirect) proves the
  # origin is alive — that is the actual bar, not "200 OK".
  try {
    Invoke-WebRequest -Uri "http://127.0.0.1:$TargetPort/" -UseBasicParsing -TimeoutSec 3 -MaximumRedirection 0 | Out-Null
    return $true
  } catch [System.Net.WebException] {
    if ($_.Exception.Response) { return $true }
    return $false
  } catch {
    return $false
  }
}

function Get-RunningProcessByName([string]$PidFilePath, [string]$Name) {
  if (-not (Test-Path $PidFilePath)) { return $null }
  $storedId = Get-Content $PidFilePath -ErrorAction SilentlyContinue | Select-Object -First 1
  if (-not $storedId) { return $null }
  $proc = Get-Process -Id $storedId -ErrorAction SilentlyContinue
  if ($proc -and $proc.ProcessName -ieq $Name) { return $proc }
  return $null
}

# Best-effort command-line inspection narrows duplicate protection to the AYAS
# named tunnel. If WMI access is denied, the pid-file check remains the safe
# fallback; arbitrary cloudflared processes are never claimed as ours.
function Get-ProcessCommandLine([int]$ProcessId) {
  try {
    return (Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop).CommandLine
  } catch {
    return $null
  }
}

function Get-RunningNamedTunnel() {
  $fromPid = Get-RunningProcessByName $TunnelPidFile "cloudflared"
  if ($fromPid) { return $fromPid }
  foreach ($proc in @(Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue)) {
    $commandLine = Get-ProcessCommandLine $proc.Id
    if ($commandLine -and $commandLine -match "(?i)tunnel.*run.*$TunnelName" -and
        $commandLine -match [regex]::Escape($CloudflaredConfig)) {
      return $proc
    }
  }
  return $null
}

# ---- 1. production app server — idempotent via a real TCP listen check ----
$portAlreadyListening = Test-PortListening $Port
if (-not $portAlreadyListening) {
  Write-Log "Port $Port not listening — building production app."
  $build = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "build" `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $BuildLog -RedirectStandardError $BuildErrLog `
    -WindowStyle Hidden -Wait -PassThru
  if ($build.ExitCode -ne 0) {
    Write-Log "Production build failed with exit code $($build.ExitCode); app and tunnel will not start."
  } else {
    Write-Log "Production build passed — starting app server (npm start)."
    # Native Start-Process redirection — stdout/stderr must be different files.
    $p = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "start", "--", "-p", "$Port" `
      -WorkingDirectory $RepoRoot `
      -RedirectStandardOutput $AppLog -RedirectStandardError $AppErrLog `
      -WindowStyle Hidden -PassThru
    Set-Content -Path $AppPidFile -Value $p.Id
  }
} else {
  Write-Log "Port $Port already listening — not starting a duplicate app server."
}

# ---- 2. wait for REAL health with bounded, growing backoff (not a fixed sleep) ----
$healthy = if ($portAlreadyListening) { Test-LocalHealth $Port } else { $false }
$attempt = 0
$maxAttempts = 30
while (-not $healthy -and $attempt -lt $maxAttempts) {
  Start-Sleep -Seconds ([Math]::Min(2 + $attempt, 5))
  $healthy = Test-LocalHealth $Port
  $attempt++
}
Write-Log "App server health after $attempt attempt(s): $healthy"

# ---- 3. named cloudflared tunnel — only once the origin is real ----
$tunnelProc = Get-RunningNamedTunnel
$tunnelUrl = $null
$tunnelState = "offline"

if ($healthy -and -not $tunnelProc) {
  if (-not (Test-Path $CloudflaredConfig)) {
    Write-Log "Named tunnel config not found at $CloudflaredConfig — tunnel will not start."
  } else {
    Write-Log "Origin healthy — starting cloudflared named tunnel '$TunnelName'."
    $tunnelState = "starting"
    $p = Start-Process -FilePath $CloudflaredExe `
      -ArgumentList "tunnel", "--config", $CloudflaredConfig, "run", $TunnelName `
      -RedirectStandardOutput $TunnelStdoutLog -RedirectStandardError $TunnelLog -WindowStyle Hidden -PassThru
    Set-Content -Path $TunnelPidFile -Value $p.Id
    Start-Sleep -Seconds 2
    $tunnelProc = Get-RunningNamedTunnel
    if ($tunnelProc) {
      $tunnelUrl = $NamedTunnelUrl
      $tunnelState = "online"
    } else {
      Write-Log "Named tunnel exited before health confirmation — leaving state 'starting'."
    }
  }
} elseif ($tunnelProc) {
  Write-Log "Named cloudflared tunnel already running (pid $($tunnelProc.Id)) — not starting a duplicate."
  $tunnelUrl = $NamedTunnelUrl
  $tunnelState = "online"
} else {
  Write-Log "Origin not healthy — named cloudflared intentionally NOT started (never treat an unready app as tunnel-ready)."
}

# ---- 4. write the bounded status file — this is ALL the running app reads ----
# Reminder to any future reader: this file only ever describes process/network
# reachability. It must never gain an execution-gate, self-improvement, or
# production-resume field — those stay their own, separately-gated systems.
$status = [ordered]@{
  appServer   = if ($healthy) { "online" } elseif ($portAlreadyListening -or (Test-Path $AppPidFile)) { "starting" } else { "offline" }
  lanAccess   = if ($healthy) { "online" } else { "unknown" }
  tunnel      = $tunnelState
  ayasBackend = if (-not $healthy) { "offline" } elseif ($tunnelUrl) { "online" } else { "degraded" }
  tunnelUrl   = $tunnelUrl
  updatedAt   = (Get-Date).ToUniversalTime().ToString("o")
}
$json = $status | ConvertTo-Json -Compress
# Plain BOM-less UTF-8 — `Set-Content -Encoding utf8` writes a BOM in Windows
# PowerShell 5.1, which breaks `JSON.parse` in the Node reader (a real bug
# caught by testing against this script's actual output, not just a fixture).
[System.IO.File]::WriteAllText($StatusFile, $json, (New-Object System.Text.UTF8Encoding($false)))
Write-Log "Status written: $json"

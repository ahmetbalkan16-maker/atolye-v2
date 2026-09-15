<#
.SYNOPSIS
  AYAS phone access daemon — idempotent, zero-cost, no admin required.

.DESCRIPTION
  Ensures the AYAS app server (`npm run dev`) and a free Cloudflare Quick
  Tunnel are running, then writes a small, bounded status file the app itself
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
$DevPidFile = Join-Path $StateDir "dev-server.pid"
$TunnelPidFile = Join-Path $StateDir "cloudflared.pid"
$DevLog = Join-Path $LogDir "dev-server.log"
$DevErrLog = Join-Path $LogDir "dev-server.err.log"
$TunnelLog = Join-Path $LogDir "cloudflared.log"
$DaemonLog = Join-Path $LogDir "daemon.log"

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
foreach ($log in @($DevLog, $DevErrLog, $TunnelLog, $DaemonLog)) { Invoke-LogRotation $log }

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

# ---- 1. app server — idempotent via a real TCP listen check, not just a pid file ----
$portAlreadyListening = Test-PortListening $Port
if (-not $portAlreadyListening) {
  Write-Log "Port $Port not listening — starting app server (npm run dev)."
  # Native Start-Process redirection — no cmd.exe wrapper, no shell quoting to
  # get wrong. stdout/stderr must be DIFFERENT files (Start-Process rejects
  # the same path for both).
  $p = Start-Process -FilePath "npm.cmd" -ArgumentList "run", "dev" `
    -WorkingDirectory $RepoRoot `
    -RedirectStandardOutput $DevLog -RedirectStandardError $DevErrLog `
    -WindowStyle Hidden -PassThru
  Set-Content -Path $DevPidFile -Value $p.Id
} else {
  Write-Log "Port $Port already listening — not starting a duplicate app server."
}

# ---- 2. wait for REAL health with bounded, growing backoff (not a fixed sleep) ----
$healthy = $false
$attempt = 0
$maxAttempts = 30
while (-not $healthy -and $attempt -lt $maxAttempts) {
  Start-Sleep -Seconds ([Math]::Min(2 + $attempt, 5))
  $healthy = Test-LocalHealth $Port
  $attempt++
}
Write-Log "App server health after $attempt attempt(s): $healthy"

# ---- 3. cloudflared — only once the origin is real; never a duplicate process ----
$tunnelProc = Get-RunningProcessByName $TunnelPidFile "cloudflared"
if (-not $tunnelProc) {
  $existingByName = Get-Process -Name "cloudflared" -ErrorAction SilentlyContinue | Select-Object -First 1
  if ($existingByName) { $tunnelProc = $existingByName }
}
$tunnelUrl = $null
$tunnelState = "offline"

if ($healthy -and -not $tunnelProc) {
  Write-Log "Origin healthy — starting cloudflared quick tunnel."
  $tunnelState = "starting"
  $p = Start-Process -FilePath $CloudflaredExe `
    -ArgumentList "tunnel", "--url", "http://127.0.0.1:$Port" `
    -RedirectStandardOutput (Join-Path $LogDir "cloudflared-stdout.log") `
    -RedirectStandardError $TunnelLog -WindowStyle Hidden -PassThru
  Set-Content -Path $TunnelPidFile -Value $p.Id
  for ($i = 0; $i -lt 15; $i++) {
    Start-Sleep -Seconds 1
    if (Test-Path $TunnelLog) {
      $match = Select-String -Path $TunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -First 1
      if ($match) { $tunnelUrl = $match.Matches[0].Value; $tunnelState = "online"; break }
    }
  }
  if (-not $tunnelUrl) { Write-Log "cloudflared did not report a quick-tunnel URL within 15s — leaving state 'starting'." }
} elseif ($tunnelProc) {
  Write-Log "cloudflared already running (pid $($tunnelProc.Id)) — not starting a duplicate."
  $match = Select-String -Path $TunnelLog -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -ErrorAction SilentlyContinue | Select-Object -Last 1
  if ($match) { $tunnelUrl = $match.Matches[0].Value; $tunnelState = "online" }
  else { $tunnelState = "starting" }
} else {
  Write-Log "Origin not healthy — cloudflared intentionally NOT started (never treat an unready app as tunnel-ready)."
}

# ---- 4. write the bounded status file — this is ALL the running app reads ----
# Reminder to any future reader: this file only ever describes process/network
# reachability. It must never gain an execution-gate, self-improvement, or
# production-resume field — those stay their own, separately-gated systems.
$status = [ordered]@{
  appServer   = if ($healthy) { "online" } elseif ($portAlreadyListening -or (Test-Path $DevPidFile)) { "starting" } else { "offline" }
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

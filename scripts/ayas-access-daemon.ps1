<# AYAS access owner: one-shot by default; -Continuous is a bounded, singleton watch. #>
param(
  [switch]$Continuous,
  [int]$IntervalSeconds = 60,
  [int]$Port = 3000,
  [string]$RepoRoot = (Split-Path -Parent $PSScriptRoot),
  [string]$CloudflaredExe = "C:\Program Files (x86)\cloudflared\cloudflared.exe",
  [switch]$LibraryOnly
)
$ErrorActionPreference = "Stop"
if ($IntervalSeconds -lt 30 -or $Port -lt 1 -or $Port -gt 65535) { throw "AYAS_ACCESS_ARGUMENT_INVALID" }
$script:RepoRoot = [IO.Path]::GetFullPath($RepoRoot).TrimEnd('\')
$script:Port = $Port
$script:CloudflaredExe = [IO.Path]::GetFullPath($CloudflaredExe)
$script:TunnelConfig = Join-Path $env:USERPROFILE ".cloudflared\config.yml"
$script:StateDir = Join-Path $env:LOCALAPPDATA "AtolyeAyasAccess"
$script:LogDir = Join-Path $script:StateDir "logs"
$script:PhoneStatusDir = Join-Path $script:RepoRoot "data\brain\phone-access"
$script:PhoneStatusFile = Join-Path $script:PhoneStatusDir "status.json"
$script:RecoveryStateFile = Join-Path $script:StateDir "recovery-state.json"
$script:RecoveryAuditFile = Join-Path $script:LogDir "recovery-audit.jsonl"
$script:MonitorLockFile = Join-Path $script:StateDir "supervisor.lock"
$script:AppWrapperPidFile = Join-Path $script:StateDir "app-server.pid" # legacy wrapper PID
$script:AppListenerPidFile = Join-Path $script:StateDir "app-listener.pid"
$script:TunnelPidFile = Join-Path $script:StateDir "cloudflared.pid"
$script:BuildLog = Join-Path $script:LogDir "next-build.log"
$script:BuildErrLog = Join-Path $script:LogDir "next-build.err.log"
$script:AppLog = Join-Path $script:LogDir "app-server.log"
$script:AppErrLog = Join-Path $script:LogDir "app-server.err.log"
$script:TunnelLog = Join-Path $script:LogDir "cloudflared.log"
$script:TunnelStdoutLog = Join-Path $script:LogDir "cloudflared-stdout.log"
$script:NamedTunnelUrl = "https://ayas.atolyeayas.com"
$script:MaxFailures = 3
$script:CooldownSeconds = 120

function Write-AtomicText([string]$Path, [string]$Value) {
  $temporary = "$Path.$PID.tmp"
  try {
    [IO.File]::WriteAllText($temporary, $Value, (New-Object Text.UTF8Encoding($false)))
    Move-Item -LiteralPath $temporary -Destination $Path -Force
  } finally {
    if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
  }
}
function Write-AccessAudit([string]$Kind, [string]$Component, [string]$Action, [string]$Result, [string]$Stage, $Before, $After, [int]$Attempt = 0) {
  $entry = [ordered]@{ observedAt = (Get-Date).ToUniversalTime().ToString('o'); kind = $Kind; component = $Component; action = $Action; result = $Result; failureStage = $Stage; attempt = $Attempt; oldPid = $Before; newPid = $After }
  if ((Test-Path -LiteralPath $script:RecoveryAuditFile) -and (Get-Item -LiteralPath $script:RecoveryAuditFile).Length -gt 1MB) {
    Move-Item -LiteralPath $script:RecoveryAuditFile -Destination "$($script:RecoveryAuditFile).old" -Force
  }
  Add-Content -LiteralPath $script:RecoveryAuditFile -Value ($entry | ConvertTo-Json -Compress) -Encoding utf8
}
function New-ComponentState {
  [ordered]@{ attempts = 0; consecutiveFailures = 0; lastAttemptAt = $null; lastSuccessAt = $null; nextEligibleAt = $null; failureStage = $null }
}
function New-RecoveryState {
  [ordered]@{ schema = 1; observedAt = $null; mode = $null; origin = (New-ComponentState); tunnel = (New-ComponentState); originStatus = 'unknown'; tunnelStatus = 'unknown'; localHealth = $false; publicHealth = 'unknown'; lastHealthyAt = $null; ownerActionRecommended = $false; failureType = $null; recoveryAction = 'none'; result = 'unknown'; listenerPid = $null; wrapperPid = $null; tunnelPid = $null }
}
function Read-RecoveryState {
  if (-not (Test-Path -LiteralPath $script:RecoveryStateFile)) { return (New-RecoveryState) }
  try {
    $file = Get-Item -LiteralPath $script:RecoveryStateFile
    if ($file.Length -le 0 -or $file.Length -gt 16KB) { throw 'size' }
    $data = Get-Content -Raw -LiteralPath $script:RecoveryStateFile | ConvertFrom-Json
    if ($data.schema -ne 1 -or -not $data.origin -or -not $data.tunnel) { throw 'schema' }
    foreach ($component in @($data.origin, $data.tunnel)) {
      foreach ($key in @('attempts','consecutiveFailures','lastAttemptAt','lastSuccessAt','nextEligibleAt','failureStage')) {
        if ($null -eq $component.PSObject.Properties[$key]) { throw 'component-schema' }
      }
      if ($component.attempts -isnot [int] -and $component.attempts -isnot [long]) { throw 'attempts' }
      if ($component.consecutiveFailures -isnot [int] -and $component.consecutiveFailures -isnot [long]) { throw 'failures' }
      if ($component.attempts -lt 0 -or $component.consecutiveFailures -lt 0 -or $component.consecutiveFailures -gt $script:MaxFailures) { throw 'bounds' }
      if ($component.failureStage -and ($component.failureStage -isnot [string] -or $component.failureStage.Length -gt 64)) { throw 'stage' }
      foreach ($key in @('lastAttemptAt','lastSuccessAt','nextEligibleAt')) {
        if ($component.$key) { try { [void][datetimeoffset]::Parse([string]$component.$key, [Globalization.CultureInfo]::InvariantCulture) } catch { throw 'timestamp' } }
      }
    }
    return $data
  } catch { throw 'AYAS_ACCESS_RECOVERY_STATE_INVALID' }
}
function Save-RecoveryState($State) { Write-AtomicText $script:RecoveryStateFile ($State | ConvertTo-Json -Depth 6 -Compress) }
function Acquire-AccessLock {
  try {
    # The OS exclusive handle is authoritative. A stale file is safely reopened.
    $stream = New-Object IO.FileStream($script:MonitorLockFile, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    $bytes = [Text.Encoding]::UTF8.GetBytes("$PID $((Get-Date).ToUniversalTime().ToString('o'))")
    $stream.SetLength(0); $stream.Write($bytes, 0, $bytes.Length); $stream.Flush($true)
    return $stream
  } catch [IO.IOException] { return $null }
}
function Get-ProcessInfo([int]$ProcessId) { Get-CimInstance Win32_Process -Filter "ProcessId = $ProcessId" -ErrorAction Stop }
function Test-ExpectedOrigin($Process) {
  if (-not $Process -or $Process.Name -ine 'node.exe' -or -not $Process.ExecutablePath -or -not $Process.CommandLine) { return $false }
  if ([IO.Path]::GetFileName([string]$Process.ExecutablePath) -ine 'node.exe') { return $false }
  $command = ([string]$Process.CommandLine).Replace('/', '\')
  $expectedScript = [regex]::Escape($script:RepoRoot) + '\\node_modules\\(?:\.bin\\+(?:\.\.\\+)+)?next\\dist\\bin\\next'
  return $command -match ('(?i)"?' + $expectedScript + '"?\s+start\s+-p\s+' + $script:Port + '(?:\s|$)')
}
function Test-ExpectedTunnel($Process) {
  if (-not $Process -or $Process.Name -ine 'cloudflared.exe' -or -not $Process.ExecutablePath -or -not $Process.CommandLine) { return $false }
  if (-not [string]::Equals([IO.Path]::GetFullPath([string]$Process.ExecutablePath), $script:CloudflaredExe, [StringComparison]::OrdinalIgnoreCase)) { return $false }
  $command = ([string]$Process.CommandLine).Replace('/', '\')
  $config = [regex]::Escape($script:TunnelConfig)
  return $command -match ('(?i)\btunnel\s+--config\s+"?' + $config + '"?\s+run\s+ayas(?:\s|$)')
}
function Get-WrapperPid($Listener, $AllProcesses) {
  $parentId = [int]$Listener.ParentProcessId
  for ($depth = 0; $depth -lt 6 -and $parentId -gt 0; $depth++) {
    $parent = @($AllProcesses | Where-Object { $_.ProcessId -eq $parentId }) | Select-Object -First 1
    if (-not $parent) { return $null }
    if ($parent.Name -ieq 'cmd.exe' -and $parent.CommandLine -match '(?i)npm\.cmd.*run\s+start\s+--\s+-p\s+\d+') { return [int]$parent.ProcessId }
    $parentId = [int]$parent.ParentProcessId
  }
  return $null
}
function Get-AccessSnapshot {
  # Query all listeners: an empty target port is normal; a CIM error fails closed.
  $listeners = @(Get-NetTCPConnection -State Listen -ErrorAction Stop | Where-Object { $_.LocalPort -eq $script:Port })
  $all = @(Get-CimInstance Win32_Process -ErrorAction Stop)
  Resolve-AccessSnapshot -Listeners $listeners -AllProcesses $all
}
function Resolve-AccessSnapshot([object[]]$Listeners, [object[]]$AllProcesses) {
  $listeners = @($Listeners)
  $all = @($AllProcesses)
  $owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
  $expectedApps = @($all | Where-Object { Test-ExpectedOrigin $_ })
  $origin = 'down'; $listenerPid = $null; $wrapperPid = $null
  if ($owners.Count -gt 1 -or $expectedApps.Count -gt 1) { $origin = 'ambiguous' }
  elseif ($owners.Count -eq 1) {
    $listenerPid = [int]$owners[0]
    $owner = @($all | Where-Object { $_.ProcessId -eq $listenerPid }) | Select-Object -First 1
    if ($owner -and (Test-ExpectedOrigin $owner) -and $expectedApps.Count -eq 1) {
      $origin = 'healthy'; $wrapperPid = Get-WrapperPid $owner $all
    } else { $origin = 'ambiguous' }
  } elseif ($expectedApps.Count -gt 0) { $origin = 'ambiguous' }
  $cloud = @($all | Where-Object { $_.Name -ieq 'cloudflared.exe' })
  $expectedTunnels = @($cloud | Where-Object { Test-ExpectedTunnel $_ })
  $ambiguousTunnels = @($cloud | Where-Object { -not $_.CommandLine -or (($_.CommandLine -match '(?i)\brun\s+ayas(?:\s|$)') -and -not (Test-ExpectedTunnel $_)) })
  $tunnel = 'down'; $tunnelPid = $null
  if ($expectedTunnels.Count -gt 1 -or $ambiguousTunnels.Count -gt 0) { $tunnel = 'ambiguous' }
  elseif ($expectedTunnels.Count -eq 1) { $tunnel = 'healthy'; $tunnelPid = [int]$expectedTunnels[0].ProcessId }
  [pscustomobject]@{ origin = $origin; listenerPid = $listenerPid; wrapperPid = $wrapperPid; tunnel = $tunnel; tunnelPid = $tunnelPid; expectedAppCount = $expectedApps.Count; expectedTunnelCount = $expectedTunnels.Count }
}
function Test-AccessGateResponse([int]$StatusCode, [string]$GateHeader, [string]$Location, [string]$Path) {
  $expectedNext = if ($Path -eq '/') { '%2F' } else { '%2Fbrain' }
  $StatusCode -eq 307 -and $GateHeader -ieq 'enforced' -and $Location -eq "/login?next=$expectedNext"
}
function Test-HttpGate([string]$BaseUrl) {
  # HttpWebRequest with redirects disabled returns the raw 307 in both PS 5.1 and 7.
  foreach ($route in @('/', '/brain')) {
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create("$BaseUrl$route")
    $request.AllowAutoRedirect = $false; $request.Timeout = 5000
    $response = $null
    try {
      $response = [Net.HttpWebResponse]$request.GetResponse()
      if (-not (Test-AccessGateResponse ([int]$response.StatusCode) $response.Headers['x-ayas-access-gate'] $response.Headers['Location'] $route)) { return $false }
    } catch { return $false }
    finally { if ($response) { $response.Close() } }
  }
  return $true
}
function Test-LocalHealth([int]$TargetPort) { Test-HttpGate "http://127.0.0.1:$TargetPort" }
function Test-PublicHealth { Test-HttpGate $script:NamedTunnelUrl }
function Get-AccessPlan([string]$Origin, [string]$Tunnel, [bool]$LocalHealthy) {
  if ($Origin -eq 'ambiguous' -or $Tunnel -eq 'ambiguous') { return 'fail-closed' }
  if ($Origin -eq 'healthy' -and -not $LocalHealthy) { return 'fail-closed' }
  if ($Origin -eq 'healthy' -and $Tunnel -eq 'healthy') { return 'none' }
  if ($Origin -eq 'down' -and $Tunnel -eq 'healthy') { return 'origin' }
  if ($Origin -eq 'healthy' -and $Tunnel -eq 'down') { return 'tunnel' }
  if ($Origin -eq 'down' -and $Tunnel -eq 'down') { return 'origin-then-tunnel' }
  return 'fail-closed'
}
function Test-RetryEligible($Component, [datetime]$Now) {
  if ($Component.consecutiveFailures -ge $script:MaxFailures) { return $false }
  if (-not $Component.nextEligibleAt) { return $true }
  $eligibleUtc = if ($Component.nextEligibleAt -is [datetime]) {
    $Component.nextEligibleAt.ToUniversalTime()
  } else {
    ([datetimeoffset]::Parse([string]$Component.nextEligibleAt, [Globalization.CultureInfo]::InvariantCulture)).UtcDateTime
  }
  $Now.ToUniversalTime() -ge $eligibleUtc
}
function Set-AttemptStart($Component, [datetime]$Now) {
  $Component.attempts = [int]$Component.attempts + 1
  $Component.lastAttemptAt = $Now.ToUniversalTime().ToString('o')
}
function Set-AttemptFailure($Component, [string]$Stage, [datetime]$Now) {
  $Component.consecutiveFailures = [int]$Component.consecutiveFailures + 1
  $Component.failureStage = $Stage
  $Component.nextEligibleAt = if ($Component.consecutiveFailures -ge $script:MaxFailures) { $null } else { $Now.AddSeconds($script:CooldownSeconds * [math]::Pow(2, $Component.consecutiveFailures - 1)).ToUniversalTime().ToString('o') }
}
function Set-ComponentHealthy($Component, [datetime]$Now) {
  $Component.consecutiveFailures = 0; $Component.failureStage = $null; $Component.nextEligibleAt = $null
  $Component.lastSuccessAt = $Now.ToUniversalTime().ToString('o')
}
function Start-OwnedProcess([string]$FilePath, [string[]]$Arguments, [string]$Stdout, [string]$Stderr, [string]$WorkingDirectory, [switch]$Wait) {
  foreach ($log in @($Stdout, $Stderr)) {
    if ((Test-Path -LiteralPath $log) -and (Get-Item -LiteralPath $log).Length -gt 5MB) {
      Move-Item -LiteralPath $log -Destination "$log.old" -Force
    }
  }
  $options = @{ FilePath = $FilePath; ArgumentList = $Arguments; WorkingDirectory = $WorkingDirectory; RedirectStandardOutput = $Stdout; RedirectStandardError = $Stderr; WindowStyle = 'Hidden'; PassThru = $true }
  if ($Wait) { $options.Wait = $true }
  Start-Process @options
}
function Start-Origin {
  if ((Get-AccessSnapshot).origin -ne 'down') { return [pscustomobject]@{ ok = $false; stage = 'origin-race'; wrapperPid = $null } }
  $build = Start-OwnedProcess 'npm.cmd' @('run','build') $script:BuildLog $script:BuildErrLog $script:RepoRoot -Wait
  if ($build.ExitCode -ne 0) { return [pscustomobject]@{ ok = $false; stage = 'build'; wrapperPid = $null } }
  if ((Get-AccessSnapshot).origin -ne 'down') { return [pscustomobject]@{ ok = $false; stage = 'origin-race'; wrapperPid = $null } }
  $wrapper = Start-OwnedProcess 'npm.cmd' @('run','start','--','-p',[string]$script:Port) $script:AppLog $script:AppErrLog $script:RepoRoot
  Write-AtomicText $script:AppWrapperPidFile ([string]$wrapper.Id)
  for ($attempt = 0; $attempt -lt 15; $attempt++) {
    Start-Sleep -Seconds 2
    $snapshot = Get-AccessSnapshot
    if ($snapshot.origin -eq 'ambiguous') { return [pscustomobject]@{ ok = $false; stage = 'origin-identity'; wrapperPid = $wrapper.Id } }
    if ($snapshot.origin -eq 'healthy' -and (Test-LocalHealth $script:Port)) {
      Write-AtomicText $script:AppListenerPidFile ([string]$snapshot.listenerPid)
      return [pscustomobject]@{ ok = $true; stage = $null; wrapperPid = $wrapper.Id }
    }
  }
  [pscustomobject]@{ ok = $false; stage = 'local-health'; wrapperPid = $wrapper.Id }
}
function Start-Tunnel {
  if (-not (Test-Path -LiteralPath $script:TunnelConfig)) { return [pscustomobject]@{ ok = $false; stage = 'tunnel-config'; pid = $null } }
  if (-not (Test-Path -LiteralPath $script:CloudflaredExe)) { return [pscustomobject]@{ ok = $false; stage = 'tunnel-executable'; pid = $null } }
  $before = Get-AccessSnapshot
  if ($before.tunnel -ne 'down' -or $before.origin -ne 'healthy' -or -not (Test-LocalHealth $script:Port)) { return [pscustomobject]@{ ok = $false; stage = 'tunnel-race'; pid = $null } }
  $started = Start-OwnedProcess $script:CloudflaredExe @('tunnel','--config',$script:TunnelConfig,'run','ayas') $script:TunnelStdoutLog $script:TunnelLog $script:RepoRoot
  for ($attempt = 0; $attempt -lt 5; $attempt++) {
    Start-Sleep -Seconds 2
    $snapshot = Get-AccessSnapshot
    if ($snapshot.tunnel -eq 'ambiguous') { return [pscustomobject]@{ ok = $false; stage = 'tunnel-identity'; pid = $started.Id } }
    if ($snapshot.tunnel -eq 'healthy' -and $snapshot.tunnelPid -eq $started.Id) {
      Write-AtomicText $script:TunnelPidFile ([string]$started.Id)
      return [pscustomobject]@{ ok = $true; stage = $null; pid = $started.Id }
    }
  }
  [pscustomobject]@{ ok = $false; stage = 'tunnel-start'; pid = $started.Id }
}
function Write-PhoneStatus($Snapshot, [bool]$LocalHealthy, [bool]$PublicHealthy) {
  $originOnline = $Snapshot.origin -eq 'healthy' -and $LocalHealthy
  $tunnelOnline = $Snapshot.tunnel -eq 'healthy'
  $status = [ordered]@{
    appServer = if ($originOnline) { 'online' } elseif ($Snapshot.origin -eq 'down') { 'offline' } else { 'starting' }
    lanAccess = if ($originOnline) { 'online' } else { 'unknown' }
    tunnel = if ($tunnelOnline) { 'online' } elseif ($Snapshot.tunnel -eq 'down') { 'offline' } else { 'starting' }
    ayasBackend = if (-not $originOnline) { 'offline' } elseif ($tunnelOnline -and $PublicHealthy) { 'online' } else { 'degraded' }
    tunnelUrl = if ($tunnelOnline) { $script:NamedTunnelUrl } else { $null }
    updatedAt = (Get-Date).ToUniversalTime().ToString('o')
  }
  Write-AtomicText $script:PhoneStatusFile ($status | ConvertTo-Json -Compress)
}
function Invoke-AccessCycle([string]$Mode) {
  $now = (Get-Date).ToUniversalTime()
  $state = Read-RecoveryState
  $snapshot = Get-AccessSnapshot
  $localHealthy = $snapshot.origin -eq 'healthy' -and (Test-LocalHealth $script:Port)
  $plan = Get-AccessPlan $snapshot.origin $snapshot.tunnel $localHealthy
  $state.observedAt = $now.ToString('o'); $state.mode = $Mode; $state.recoveryAction = 'none'
  $state.failureType = if ($plan -eq 'fail-closed') { 'ambiguous-identity-or-health' } elseif ($plan -eq 'none') { $null } else { $plan }
  $state.ownerActionRecommended = $plan -eq 'fail-closed'
  $state.result = if ($plan -eq 'none') { 'healthy' } elseif ($plan -eq 'fail-closed') { 'fail-closed' } else { 'observed-down' }
  if ($snapshot.origin -eq 'healthy' -and $localHealthy) { Set-ComponentHealthy $state.origin $now; Write-AtomicText $script:AppListenerPidFile ([string]$snapshot.listenerPid) }
  if ($snapshot.tunnel -eq 'healthy') { Set-ComponentHealthy $state.tunnel $now; Write-AtomicText $script:TunnelPidFile ([string]$snapshot.tunnelPid) }
  if ($plan -eq 'origin' -or $plan -eq 'origin-then-tunnel') {
    if (Test-RetryEligible $state.origin $now) {
      Set-AttemptStart $state.origin $now; $state.recoveryAction = 'start-origin'
      try { $outcome = Start-Origin } catch { $outcome = [pscustomobject]@{ ok = $false; stage = 'origin-launch'; wrapperPid = $null } }
      Write-AccessAudit 'attempt' 'origin' 'start' $(if($outcome.ok){'success'}else{'failure'}) $outcome.stage $snapshot.listenerPid $outcome.wrapperPid $state.origin.attempts
      if ($outcome.ok) { Set-ComponentHealthy $state.origin (Get-Date).ToUniversalTime() }
      else { Set-AttemptFailure $state.origin $outcome.stage (Get-Date).ToUniversalTime() }
    } else { $state.result = 'cooldown-or-exhausted'; $state.ownerActionRecommended = $state.origin.consecutiveFailures -ge $script:MaxFailures }
  }
  $snapshot = Get-AccessSnapshot
  $localHealthy = $snapshot.origin -eq 'healthy' -and (Test-LocalHealth $script:Port)
  if ($localHealthy -and $snapshot.tunnel -eq 'down' -and $plan -ne 'fail-closed') {
    if (Test-RetryEligible $state.tunnel $now) {
      Set-AttemptStart $state.tunnel $now
      $state.recoveryAction = if ($state.recoveryAction -eq 'start-origin') { 'start-origin-then-tunnel' } else { 'start-tunnel' }
      try { $outcome = Start-Tunnel } catch { $outcome = [pscustomobject]@{ ok = $false; stage = 'tunnel-launch'; pid = $null } }
      Write-AccessAudit 'attempt' 'tunnel' 'start' $(if($outcome.ok){'success'}else{'failure'}) $outcome.stage $null $outcome.pid $state.tunnel.attempts
      if ($outcome.ok) { Set-ComponentHealthy $state.tunnel (Get-Date).ToUniversalTime() }
      else { Set-AttemptFailure $state.tunnel $outcome.stage (Get-Date).ToUniversalTime() }
    } else { $state.result = 'cooldown-or-exhausted'; $state.ownerActionRecommended = $state.tunnel.consecutiveFailures -ge $script:MaxFailures }
  }
  $snapshot = Get-AccessSnapshot
  $localHealthy = $snapshot.origin -eq 'healthy' -and (Test-LocalHealth $script:Port)
  $state.listenerPid = $snapshot.listenerPid; $state.wrapperPid = $snapshot.wrapperPid; $state.tunnelPid = $snapshot.tunnelPid
  $publicHealthy = $localHealthy -and $snapshot.tunnel -eq 'healthy' -and (Test-PublicHealth)
  $state.originStatus = $snapshot.origin; $state.tunnelStatus = $snapshot.tunnel; $state.localHealth = [bool]$localHealthy
  $state.publicHealth = if ($publicHealthy) { 'healthy' } elseif ($snapshot.tunnel -eq 'healthy') { 'unreachable' } else { 'unknown' }
  if (($state.origin.consecutiveFailures -ge $script:MaxFailures -and -not $localHealthy) -or
      ($state.tunnel.consecutiveFailures -ge $script:MaxFailures -and $snapshot.tunnel -ne 'healthy')) {
    $state.result = 'retries-exhausted'; $state.ownerActionRecommended = $true
  }
  if ($snapshot.origin -eq 'healthy' -and $localHealthy -and $snapshot.tunnel -eq 'healthy' -and $publicHealthy) {
    $state.lastHealthyAt = (Get-Date).ToUniversalTime().ToString('o')
    $state.result = 'healthy'; $state.failureType = $null; $state.ownerActionRecommended = $false
  } elseif ($snapshot.origin -eq 'healthy' -and $localHealthy -and $snapshot.tunnel -eq 'healthy') {
    $state.result = 'degraded-public'; $state.failureType = 'public-health'; $state.ownerActionRecommended = $true
  } elseif ($snapshot.origin -eq 'ambiguous' -or $snapshot.tunnel -eq 'ambiguous' -or ($snapshot.origin -eq 'healthy' -and -not $localHealthy)) {
    $state.result = 'fail-closed'; $state.ownerActionRecommended = $true
  }
  Save-RecoveryState $state
  Write-PhoneStatus $snapshot $localHealthy $publicHealthy
  return $state
}
if ($LibraryOnly) { return }
New-Item -ItemType Directory -Force -Path $script:StateDir, $script:LogDir, $script:PhoneStatusDir | Out-Null
$lock = Acquire-AccessLock
if (-not $lock) { throw 'AYAS_ACCESS_MONITOR_ALREADY_RUNNING_OR_LOCK_UNAVAILABLE' }
try {
  do {
    try { $result = Invoke-AccessCycle $(if ($Continuous) { 'continuous' } else { 'one-shot' }) }
    catch {
      Write-AccessAudit 'error' 'runtime' 'observe' 'failure' 'cycle' $null $null
      if (-not $Continuous) { throw }
    }
    if ($Continuous) { Start-Sleep -Seconds $IntervalSeconds }
  } while ($Continuous)
} finally { $lock.Dispose() }

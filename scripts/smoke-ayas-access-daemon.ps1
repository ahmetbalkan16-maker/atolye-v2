<# Deterministic access-owner contracts plus safe real Windows launch/probe. #>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
. (Join-Path $PSScriptRoot 'ayas-access-daemon.ps1') -LibraryOnly
$count = 0
function Scenario([string]$Name, [scriptblock]$Action) {
  try { & $Action; $script:count++; Write-Output "PASS $Name" }
  catch { throw "FAIL $Name : $($_.Exception.Message)" }
}
function Eq($Actual, $Expected) { if ($Actual -ne $Expected) { throw "expected '$Expected', got '$Actual'" } }
function Yes($Value) { if (-not $Value) { throw 'expected true' } }
function No($Value) { if ($Value) { throw 'expected false' } }
$temp = Join-Path ([IO.Path]::GetTempPath()) ("ayas-access-smoke-" + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $temp | Out-Null
$script:StateDir = $temp
$script:LogDir = $temp
$script:PhoneStatusFile = Join-Path $temp 'status.json'
$script:RecoveryStateFile = Join-Path $temp 'recovery-state.json'
$script:RecoveryAuditFile = Join-Path $temp 'audit.jsonl'
$script:MonitorLockFile = Join-Path $temp 'supervisor.lock'
$script:AppWrapperPidFile = Join-Path $temp 'app-server.pid'
$script:AppListenerPidFile = Join-Path $temp 'app-listener.pid'
$script:TunnelPidFile = Join-Path $temp 'cloudflared.pid'
$script:Port = 3000
$expectedNode = [pscustomobject]@{
  ProcessId = 444; ParentProcessId = 333; Name = 'node.exe'; ExecutablePath = 'C:\Program Files\nodejs\node.exe'
  CommandLine = '"node" "' + (Join-Path $root 'node_modules\.bin\..\next\dist\bin\next') + '" start -p 3000'
}
$wrapper = [pscustomobject]@{ ProcessId = 111; ParentProcessId = 0; Name = 'cmd.exe'; ExecutablePath = 'C:\Windows\System32\cmd.exe'; CommandLine = 'cmd.exe /c "npm.cmd run start -- -p 3000"' }
$npm = [pscustomobject]@{ ProcessId = 222; ParentProcessId = 111; Name = 'node.exe'; ExecutablePath = 'C:\Program Files\nodejs\node.exe'; CommandLine = 'npm-cli.js run start -- -p 3000' }
$inner = [pscustomobject]@{ ProcessId = 333; ParentProcessId = 222; Name = 'cmd.exe'; ExecutablePath = 'C:\Windows\System32\cmd.exe'; CommandLine = 'cmd.exe /d /s /c next start -p 3000' }
$expectedTunnel = [pscustomobject]@{
  ProcessId = 555; ParentProcessId = 0; Name = 'cloudflared.exe'; ExecutablePath = $script:CloudflaredExe
  CommandLine = '"' + $script:CloudflaredExe + '" tunnel --config "' + $script:TunnelConfig + '" run ayas'
}
$listener = [pscustomobject]@{ LocalPort = 3000; OwningProcess = 444 }
$appChain = @($expectedNode,$inner,$npm,$wrapper)
try {
  Scenario 'healthy no-op plan' { Eq (Get-AccessPlan healthy healthy $true) none }
  Scenario 'origin-only plan' { Eq (Get-AccessPlan down healthy $false) origin }
  Scenario 'tunnel-only plan' { Eq (Get-AccessPlan healthy down $true) tunnel }
  Scenario 'both-down order' { Eq (Get-AccessPlan down down $false) origin-then-tunnel }
  Scenario 'unhealthy expected origin fails closed' { Eq (Get-AccessPlan healthy healthy $false) fail-closed }
  Scenario 'expected origin identity' { Yes (Test-ExpectedOrigin $expectedNode) }
  Scenario 'sibling repository cannot claim AYAS origin identity' {
    $other=$expectedNode.PSObject.Copy()
    $other.CommandLine=$other.CommandLine.Replace($root, "${root}-other")
    No (Test-ExpectedOrigin $other)
  }
  Scenario 'actual listener and wrapper differ' {
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$expectedTunnel)
    Eq $s.origin healthy; Eq $s.listenerPid 444; Eq $s.wrapperPid 111; Eq $s.tunnelPid 555
  }
  Scenario 'stale wrapper record does not override listener' {
    Write-AtomicText $script:AppWrapperPidFile '999999'
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$expectedTunnel)
    Eq $s.listenerPid 444; Eq $s.wrapperPid 111
  }
  Scenario 'wrapper alive listener dead permits origin recovery' {
    $s=Resolve-AccessSnapshot @() @($wrapper,$npm,$inner,$expectedTunnel)
    Eq $s.origin down; Eq (Get-AccessPlan $s.origin $s.tunnel $false) origin
  }
  Scenario 'stale tunnel PID absent does not count as healthy' {
    Write-AtomicText $script:TunnelPidFile '999999'
    $s=Resolve-AccessSnapshot @($listener) $appChain
    Eq $s.tunnel down
  }
  Scenario 'reused tunnel PID with other tunnel is not ours' {
    $other=$expectedTunnel.PSObject.Copy(); $other.CommandLine='"cloudflared" tunnel --config C:\other.yml run other'
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$other)
    Eq $s.tunnel down
  }
  Scenario 'wrong config for ayas fails closed' {
    $other=$expectedTunnel.PSObject.Copy(); $other.CommandLine='"cloudflared" tunnel --config C:\other.yml run ayas'
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$other)
    Eq $s.tunnel ambiguous
  }
  Scenario 'unknown port owner fails closed' {
    $unknown=[pscustomobject]@{ ProcessId=666; ParentProcessId=0; Name='node.exe'; ExecutablePath='C:\Program Files\nodejs\node.exe'; CommandLine='node unrelated.js' }
    $s=Resolve-AccessSnapshot @([pscustomobject]@{LocalPort=3000;OwningProcess=666}) @($unknown,$expectedTunnel)
    Eq $s.origin ambiguous; Eq (Get-AccessPlan $s.origin $s.tunnel $false) fail-closed
  }
  Scenario 'duplicate expected app fails closed' {
    $copy=$expectedNode.PSObject.Copy(); $copy.ProcessId=777
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$copy+$expectedTunnel)
    Eq $s.origin ambiguous
  }
  Scenario 'duplicate named tunnel fails closed' {
    $copy=$expectedTunnel.PSObject.Copy(); $copy.ProcessId=778
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$expectedTunnel+$copy)
    Eq $s.tunnel ambiguous
  }
  Scenario 'uninspectable cloudflared fails closed' {
    $copy=$expectedTunnel.PSObject.Copy(); $copy.CommandLine=$null
    $s=Resolve-AccessSnapshot @($listener) @($appChain+$copy)
    Eq $s.tunnel ambiguous
  }
  Scenario '307 exact access gate root healthy' { Yes (Test-AccessGateResponse 307 enforced '/login?next=%2F' '/') }
  Scenario '307 exact access gate brain healthy' { Yes (Test-AccessGateResponse 307 enforced '/login?next=%2Fbrain' '/brain') }
  Scenario 'redirect without gate fails' { No (Test-AccessGateResponse 307 '' '/login?next=%2F' '/') }
  Scenario '200 is not expected gated health' { No (Test-AccessGateResponse 200 enforced '/login?next=%2F' '/') }
  Scenario 'retry cooldown and bound' {
    $c=New-ComponentState; $now=[datetime]::UtcNow
    Yes (Test-RetryEligible $c $now)
    Set-AttemptStart $c $now; Set-AttemptFailure $c build $now
    Eq $c.attempts 1; Eq $c.failureStage build; No (Test-RetryEligible $c $now.AddSeconds(119)); Yes (Test-RetryEligible $c $now.AddSeconds(121))
  }
  Scenario 'no restart storm after third failure' {
    $c=New-ComponentState; $now=[datetime]::UtcNow
    1..3|ForEach-Object { Set-AttemptStart $c $now; Set-AttemptFailure $c local-health $now }
    Eq $c.consecutiveFailures 3; No (Test-RetryEligible $c $now.AddDays(10))
  }
  Scenario 'healthy observation resets failure state' {
    $c=New-ComponentState; Set-AttemptFailure $c build ([datetime]::UtcNow)
    Set-ComponentHealthy $c ([datetime]::UtcNow)
    Eq $c.consecutiveFailures 0; Yes (Test-RetryEligible $c ([datetime]::UtcNow))
  }
  Scenario 'durable state roundtrip and freshness fields' {
    $state=New-RecoveryState; $state.observedAt=[datetime]::UtcNow.ToString('o'); $state.originStatus='healthy'; $state.tunnelStatus='healthy'; $state.listenerPid=444
    Save-RecoveryState $state; $loaded=Read-RecoveryState
    Eq $loaded.listenerPid 444; Eq $loaded.originStatus healthy; Eq $loaded.tunnelStatus healthy
  }
  Scenario 'corrupt durable state fails closed' {
    Write-AtomicText $script:RecoveryStateFile '{}'
    try { $null=Read-RecoveryState; throw 'accepted corrupt state' } catch { if ($_.Exception.Message -notmatch 'AYAS_ACCESS_RECOVERY_STATE_INVALID') { throw } }
  }
  Scenario 'one-shot status is timestamped not durable authority' {
    $s=[pscustomobject]@{origin='healthy';tunnel='healthy'}
    Write-PhoneStatus $s $true $true
    $status=Get-Content -Raw -LiteralPath $script:PhoneStatusFile|ConvertFrom-Json
    $updatedUtc = if ($status.updatedAt -is [datetime]) { $status.updatedAt.ToUniversalTime() } else { ([datetimeoffset]::Parse([string]$status.updatedAt, [Globalization.CultureInfo]::InvariantCulture)).UtcDateTime }
    Eq $status.ayasBackend online; Yes (([datetime]::UtcNow - $updatedUtc).TotalSeconds -lt 10)
  }
  Scenario 'public failure degrades status without duplicate tunnel' {
    $s=[pscustomobject]@{origin='healthy';tunnel='healthy'}
    Write-PhoneStatus $s $true $false
    $status=Get-Content -Raw -LiteralPath $script:PhoneStatusFile|ConvertFrom-Json
    Eq $status.tunnel online; Eq $status.ayasBackend degraded
  }
  Scenario 'singleton rejects concurrent owner and accepts stale file' {
    $a=Acquire-AccessLock; if(-not $a){throw 'first owner failed'}
    try { No (Acquire-AccessLock) } finally { $a.Dispose() }
    $b=Acquire-AccessLock; if(-not $b){throw 'stale lock not reconciled'}; $b.Dispose()
  }
  Scenario 'future autostart invocation is continuous without installation' {
    $source=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'register-ayas-autostart.ps1')
    Yes ($source.Contains('-Continuous -IntervalSeconds 60'))
    Yes ($source.Contains('ExecutionTimeLimit ([TimeSpan]::Zero)'))
  }
  Scenario 'no unknown-process kill or authority expansion' {
    $source=Get-Content -Raw -LiteralPath (Join-Path $PSScriptRoot 'ayas-access-daemon.ps1')
    No ($source -match '(?im)^\s*Stop-Process\b')
    No ($source -match '(?im)^\s*(?:git|graphify|cloudflared\s+tunnel\s+create)\b')
    No ($source -match 'AyasApproval|ExecutionGate|observerActions')
  }
  # Exercise the actual cycle with isolated state and injected process/HTTP seams.
  $saved = @{}
  foreach ($name in @('Get-AccessSnapshot','Test-LocalHealth','Test-PublicHealth','Start-Origin','Start-Tunnel')) {
    $saved[$name] = (Get-Command $name -CommandType Function).ScriptBlock
  }
  function Get-AccessSnapshot { $script:fakeSnapshot }
  function Test-LocalHealth { $script:fakeLocal }
  function Test-PublicHealth { $script:fakePublic }
  function Start-Origin {
    $script:originStarts++
    $script:launchOrder += 'origin'
    if ($script:originFailure) { return [pscustomobject]@{ok=$false;stage=$script:originFailure;wrapperPid=$null} }
    $script:fakeSnapshot.origin='healthy'; $script:fakeSnapshot.listenerPid=444; $script:fakeSnapshot.wrapperPid=111
    return [pscustomobject]@{ok=$true;stage=$null;wrapperPid=111}
  }
  function Start-Tunnel {
    $script:tunnelStarts++
    $script:launchOrder += 'tunnel'
    if ($script:tunnelFailure) { return [pscustomobject]@{ok=$false;stage=$script:tunnelFailure;pid=$null} }
    $script:fakeSnapshot.tunnel='healthy'; $script:fakeSnapshot.tunnelPid=555
    return [pscustomobject]@{ok=$true;stage=$null;pid=555}
  }
  function Reset-Fake([string]$Origin, [string]$Tunnel) {
    Remove-Item -LiteralPath $script:RecoveryStateFile -Force -ErrorAction SilentlyContinue
    $script:fakeSnapshot=[pscustomobject]@{origin=$Origin;listenerPid=$(if($Origin -eq 'healthy'){444}else{$null});wrapperPid=$(if($Origin -eq 'healthy'){111}else{$null});tunnel=$Tunnel;tunnelPid=$(if($Tunnel -eq 'healthy'){555}else{$null})}
    $script:fakeLocal=$true; $script:fakePublic=$true
    $script:originStarts=0; $script:tunnelStarts=0; $script:launchOrder=@()
    $script:originFailure=$null; $script:tunnelFailure=$null
  }
  try {
    Scenario 'cycle healthy no-op' {
      Reset-Fake healthy healthy
      $s=Invoke-AccessCycle one-shot
      Eq $s.result healthy; Eq $script:originStarts 0; Eq $script:tunnelStarts 0
    }
    Scenario 'cycle public failure requests owner action without restart' {
      Reset-Fake healthy healthy; $script:fakePublic=$false
      $s=Invoke-AccessCycle one-shot
      Eq $s.result degraded-public; Yes $s.ownerActionRecommended
      Eq $script:originStarts 0; Eq $script:tunnelStarts 0
    }
    Scenario 'cycle origin-only recovery' {
      Reset-Fake down healthy
      $s=Invoke-AccessCycle one-shot
      Eq $s.result healthy; Eq $script:originStarts 1; Eq $script:tunnelStarts 0
    }
    Scenario 'cycle tunnel-only recovery' {
      Reset-Fake healthy down
      $s=Invoke-AccessCycle one-shot
      Eq $s.result healthy; Eq $script:originStarts 0; Eq $script:tunnelStarts 1
    }
    Scenario 'cycle both-down origin before tunnel' {
      Reset-Fake down down
      $s=Invoke-AccessCycle one-shot
      Eq ($script:launchOrder -join ',') 'origin,tunnel'; Eq $s.result healthy
    }
    Scenario 'cycle origin build failure blocks tunnel' {
      Reset-Fake down down; $script:originFailure='build'
      $s=Invoke-AccessCycle one-shot
      Eq $s.origin.failureStage build; Eq $s.origin.attempts 1; Eq $script:tunnelStarts 0
      $audit=Get-Content -LiteralPath $script:RecoveryAuditFile | Select-Object -Last 1 | ConvertFrom-Json
      Eq $audit.attempt 1; Eq $audit.failureStage build; Eq $audit.component origin
    }
    Scenario 'cycle tunnel launch failure records stage' {
      Reset-Fake healthy down; $script:tunnelFailure='tunnel-start'
      $s=Invoke-AccessCycle one-shot
      Eq $s.tunnel.failureStage tunnel-start; Eq $s.tunnel.attempts 1
    }
    Scenario 'cycle local health failure blocks tunnel' {
      Reset-Fake down down; $script:originFailure='local-health'; $script:fakeLocal=$false
      $s=Invoke-AccessCycle one-shot
      Eq $s.origin.failureStage local-health; Eq $script:tunnelStarts 0
    }
    Scenario 'cycle cooldown prevents immediate retry' {
      Reset-Fake down down; $script:originFailure='build'
      $null=Invoke-AccessCycle one-shot
      $null=Invoke-AccessCycle one-shot
      Eq $script:originStarts 1
    }
    Scenario 'cycle three failures stop automatic spawning' {
      Reset-Fake down down; $script:originFailure='build'
      for($i=0;$i -lt 3;$i++) {
        if($i -gt 0) { $durable=Read-RecoveryState; $durable.origin.nextEligibleAt=[datetime]::UtcNow.AddSeconds(-1).ToString('o'); Save-RecoveryState $durable }
        $s=Invoke-AccessCycle one-shot
      }
      Eq $s.origin.consecutiveFailures 3; Yes $s.ownerActionRecommended
      $null=Invoke-AccessCycle one-shot
      Eq $script:originStarts 3
    }
    Scenario 'cycle ambiguous port owner never launches' {
      Reset-Fake ambiguous down
      $s=Invoke-AccessCycle one-shot
      Eq $s.result fail-closed; Eq $script:originStarts 0; Eq $script:tunnelStarts 0
    }
  } finally {
    foreach ($name in $saved.Keys) { Set-Item -Path "Function:$name" -Value $saved[$name] }
    Remove-Item -Path Function:Reset-Fake -ErrorAction SilentlyContinue
  }
  # Real Windows launch/inspection boundary, isolated from production. Only our own
  # short-lived fake process is stopped during cleanup.
  Scenario 'real Windows fake child launch and PID inspection' {
    $stdout=Join-Path $temp 'fake.out'; $stderr=Join-Path $temp 'fake.err'
    $child=Start-OwnedProcess 'powershell.exe' @('-NoProfile','-Command','Start-Sleep -Seconds 20') $stdout $stderr $temp
    try {
      Start-Sleep -Milliseconds 300
      $actual=Get-ProcessInfo $child.Id
      Eq $actual.ProcessId $child.Id
      Eq $actual.Name powershell.exe
      Yes ($actual.CommandLine -match 'Start-Sleep')
    } finally {
      $owned=Get-CimInstance Win32_Process -Filter "ProcessId = $($child.Id)" -ErrorAction SilentlyContinue
      if ($owned -and $owned.Name -eq 'powershell.exe' -and $owned.CommandLine -match 'Start-Sleep -Seconds 20') { Stop-Process -Id $child.Id -Force }
    }
  }
} finally {
  $resolvedTemp = [IO.Path]::GetFullPath($temp)
  $allowedRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolvedTemp.StartsWith($allowedRoot, [StringComparison]::OrdinalIgnoreCase) -or
      [IO.Path]::GetFileName($resolvedTemp) -notmatch '^ayas-access-smoke-[0-9a-f]{32}$') {
    throw 'unsafe test cleanup path'
  }
  Remove-Item -LiteralPath $resolvedTemp -Recurse -Force -ErrorAction SilentlyContinue
}
Write-Output "AYAS access daemon smoke: $count scenarios PASS"

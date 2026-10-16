<#
  AYAS phone-access application publication (owner maintenance action).
  Dry run by default; -Prepare builds the next snapshot; -Apply also swaps it in.

  Run as the normal (not elevated) user:
    powershell -NoProfile -ExecutionPolicy Bypass -File D:\<bundle>\Atolye\atolye-v2\scripts\ayas-publish-live.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File D:\<bundle>\Atolye\atolye-v2\scripts\ayas-publish-live.ps1 -Prepare
    powershell -NoProfile -ExecutionPolicy Bypass -File D:\<bundle>\Atolye\atolye-v2\scripts\ayas-publish-live.ps1 -Apply

  The live app is `next start <snapshot>` from a detached worktree
  (<bundle>\Atolye\ayas-live-<sha8>) with the canonical repo as cwd and data
  root. scripts\ayas-access-daemon.ps1 starts it only when
  private\AtolyeAyasAccess\prebuilt-runtime-v1.json matches that snapshot
  byte for byte, so a publication must replace the manifest and the
  published-application selector together while the supervisor is stopped.

  -Prepare (live app untouched): worktree of the commit, the Git-ignored
  runtime inputs copied from the current snapshot (.env.local, public\ort,
  public\wake), npm ci, npm run build (postbuild stamps it CLEAN) and a staged
  manifest qualified by scripts\ayas-prebuilt-runtime.mjs.
  -Apply: Prepare, then backup, stop supervisor + origin (the tunnel keeps
  running), swap both files, relaunch the supervisor through the same hidden
  launcher as the Startup shortcut and wait for a healthy origin. When the new
  snapshot is not healthy in time, the previous files are restored and the
  previous snapshot is started again. Old snapshots and backups are kept.
  It never edits runtime/authority/project data, never builds the canonical
  repo and refuses while the live app has a running child job.
  -Restart: the current snapshot again, after a runtime input changed (the
  owner's model switch writes AYAS_OLLAMA_MODEL into its .env.local): the same
  stop, supervisor start and health wait, nothing built or swapped. Exit 3
  while the live app has a running child job, 1 when it is not healthy in time.
  ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
#>
param([string]$Commit = 'HEAD', [switch]$Prepare, [switch]$Apply, [switch]$Force, [switch]$Restart, [int]$HealthTimeoutSeconds = 240)
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
  if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Normal kullanici olarak calistirin ("Yonetici olarak calistir" degil): erisim denetcisi yukseltilmis calismayi reddeder.'
  }
} finally { $identity.Dispose() }
if ($HealthTimeoutSeconds -lt 60) { throw 'HealthTimeoutSeconds en az 60 olmali.' }

$repo = Split-Path -Parent $PSScriptRoot
$production = Split-Path -Parent (Split-Path -Parent $repo)
$accessDir = Join-Path $production 'private\AtolyeAyasAccess'
$manifestFile = Join-Path $accessDir 'prebuilt-runtime-v1.json'
$publicationFile = Join-Path $accessDir 'published-application-v1.json'
$recoveryFile = Join-Path $accessDir 'recovery-state.json'
$tunnelConfig = Join-Path $production 'private\cloudflared\config.yml'
$cloudflared = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
$checker = Join-Path $PSScriptRoot 'ayas-prebuilt-runtime.mjs'
$launcher = Join-Path $PSScriptRoot 'ayas-access-hidden.vbs'
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$npm = (Get-Command npm.cmd -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
$port = 3000
# Changes outside these paths (docs, scripts, data) never change the published application.
$appPaths = @('app', 'src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'middleware.ts', 'instrumentation.ts', 'postcss.config.mjs', 'tsconfig.json')
$ignoredInputs = @('.env.local', 'public\ort', 'public\wake')

function Say([string]$state, [string]$text) { Write-Output ('[{0}] {1}' -f $state, $text) }
function Read-Json([string]$file) { Get-Content -Raw -Encoding UTF8 -LiteralPath $file | ConvertFrom-Json }
function Write-Utf8Atomic([string]$file, [string]$text) {
  $temporary = "$file.$PID.new"
  [IO.File]::WriteAllText($temporary, $text, (New-Object Text.UTF8Encoding($false)))
  Move-Item -LiteralPath $temporary -Destination $file -Force
}
function Copy-Atomic([string]$source, [string]$file) {
  $temporary = "$file.$PID.new"
  Copy-Item -LiteralPath $source -Destination $temporary -Force
  Move-Item -LiteralPath $temporary -Destination $file -Force
}
# Native tools write progress to stderr; keep it in the log instead of failing on it.
function Invoke-Logged([string]$name, [string]$log, [scriptblock]$block) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { & $block 2>&1 | ForEach-Object { "$_" } | Out-File -Append -Encoding utf8 -LiteralPath $log; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "$name basarisiz (cikis $code). Gunluk: $log" }
}
function Invoke-Checker([string]$mode, [string]$root, [string]$manifest) {
  $previous = $ErrorActionPreference; $ErrorActionPreference = 'Continue'
  try { $out = & $node $checker $mode $root $manifest $cloudflared $tunnelConfig 2>&1 | ForEach-Object { "$_" }; $code = $LASTEXITCODE }
  finally { $ErrorActionPreference = $previous }
  if ($code -ne 0) { throw "Snapshot dogrulamasi basarisiz ($mode): $($out -join ' ')" }
  return ($out | Select-Object -Last 1)
}
function Test-Gate([string]$baseUrl) {
  foreach ($route in @('/', '/brain')) {
    $expected = if ($route -eq '/') { '/login?next=%2F' } else { '/login?next=%2Fbrain' }
    $request = [Net.HttpWebRequest][Net.WebRequest]::Create("$baseUrl$route")
    $request.AllowAutoRedirect = $false; $request.Timeout = 5000
    $response = $null
    try {
      $response = [Net.HttpWebResponse]$request.GetResponse()
      if ([int]$response.StatusCode -ne 307 -or $response.Headers['x-ayas-access-gate'] -ine 'enforced' -or $response.Headers['Location'] -ne $expected) { return $false }
    } catch { return $false } finally { if ($response) { $response.Close() } }
  }
  return $true
}
function Find-Supervisors($all) {
  @($all | Where-Object { $_.Name -ieq 'powershell.exe' -and ([string]$_.CommandLine) -match '(?i)ayas-access-daemon\.ps1"?\s+.*-Continuous' })
}
function Find-Origins($all, [string]$root) {
  $cli = ($root.TrimEnd('\') + '\node_modules\next\dist\bin\next')
  @($all | Where-Object { $_.Name -ieq 'node.exe' -and ([string]$_.CommandLine).Replace('/', '\').IndexOf($cli, [StringComparison]::OrdinalIgnoreCase) -ge 0 })
}
function Find-AnyOrigins($all) {
  # Only a `next start` of this bundle that serves the published port: never an unrelated dev server.
  $bundle = (Join-Path $production 'Atolye').TrimEnd('\') + '\'
  @($all | Where-Object {
    $command = ([string]$_.CommandLine).Replace('/', '\')
    $_.Name -ieq 'node.exe' -and $command.IndexOf($bundle, [StringComparison]::OrdinalIgnoreCase) -ge 0 -and
      $command -match ('(?i)node_modules\\next\\dist\\bin\\next"?\s+start\b.*\s-p\s+' + $port + '(?:\s|$)')
  })
}
function Get-BusyChildren($all, [string]$root) {
  @(Find-Origins $all $root | ForEach-Object { $originPid = $_.ProcessId; $all | Where-Object { $_.ParentProcessId -eq $originPid -and $_.Name -ine 'conhost.exe' } })
}
function Stop-LiveProcesses {
  $all = @(Get-CimInstance Win32_Process)
  foreach ($supervisor in (Find-Supervisors $all)) {
    $parent = @($all | Where-Object { $_.ProcessId -eq $supervisor.ParentProcessId -and $_.Name -ieq 'wscript.exe' -and ([string]$_.CommandLine) -match '(?i)ayas-access-hidden\.vbs' }) | Select-Object -First 1
    Stop-Process -Id $supervisor.ProcessId -Force -ErrorAction SilentlyContinue
    if ($parent) { Stop-Process -Id $parent.ProcessId -Force -ErrorAction SilentlyContinue }
    Say 'YAPILDI' "Erisim denetcisi durduruldu (PID $($supervisor.ProcessId))"
  }
  foreach ($origin in (Find-AnyOrigins $all)) {
    Stop-Process -Id $origin.ProcessId -Force -ErrorAction SilentlyContinue
    Say 'YAPILDI' "Canli uygulama durduruldu (PID $($origin.ProcessId))"
  }
  for ($i = 0; $i -lt 20; $i++) {
    if (-not (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue)) { return }
    Start-Sleep -Seconds 1
  }
  throw "Port $port bosalmadi; elle inceleyin."
}
function Start-Supervisor {
  # Through the Windows shell, exactly like logon: a supervisor started as a child of this console (or of an agent
  # sandbox) can be ended together with it (docs/AYAS_LOCAL_CONVERSATION_2026-10-10.md, closing check).
  $shortcut = Join-Path ([Environment]::GetFolderPath('Startup')) 'AYAS Access Online.lnk'
  $shell = New-Object -ComObject WScript.Shell
  $viaShell = (Test-Path -LiteralPath $shortcut) -and ($shell.CreateShortcut($shortcut).Arguments -like "*$launcher*")
  if ($viaShell) { Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('"' + $shortcut + '"') | Out-Null }
  else { Start-Process -FilePath (Join-Path $env:SystemRoot 'System32\wscript.exe') -ArgumentList @('//B', '//NoLogo', ('"' + $launcher + '"')) -WorkingDirectory $repo | Out-Null }
  Say 'YAPILDI' ('Erisim denetcisi yeniden baslatildi (' + $(if ($viaShell) { 'Baslangic kisayolu, Windows kabugu' } else { 'gizli baslatici' }) + ')')
}
function Wait-Healthy([string]$root, [datetime]$since) {
  $deadline = (Get-Date).AddSeconds($HealthTimeoutSeconds)
  $local = $false
  while ((Get-Date) -lt $deadline) {
    Start-Sleep -Seconds 5
    $origins = @(Find-Origins @(Get-CimInstance Win32_Process) $root)
    $listener = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) | Select-Object -First 1
    $local = $origins.Count -eq 1 -and $listener -and $listener.OwningProcess -eq $origins[0].ProcessId -and (Test-Gate "http://127.0.0.1:$port")
    if (-not $local) { continue }
    try {
      $state = Read-Json $recoveryFile
      $observed = if ($state.observedAt -is [datetime]) { $state.observedAt.ToUniversalTime() } else { [datetimeoffset]::Parse([string]$state.observedAt, [Globalization.CultureInfo]::InvariantCulture).UtcDateTime }
    } catch { continue }
    if ($observed -gt $since.ToUniversalTime() -and $state.result -eq 'healthy') {
      return [pscustomobject]@{ ok = $true; listenerPid = $origins[0].ProcessId; publicHealth = $state.publicHealth }
    }
  }
  return [pscustomobject]@{ ok = $false; local = $local }
}

if (-not (Test-Path -LiteralPath $publicationFile -PathType Leaf)) { throw "Yayin secicisi yok: $publicationFile" }
$sha = [string](@(git -C $repo rev-parse --verify "$Commit^{commit}")[0])
if ($LASTEXITCODE -ne 0 -or $sha -notmatch '^[0-9a-f]{40}$') { throw "Commit cozulemedi: $Commit" }
$short = $sha.Substring(0, 8)
$target = Join-Path $production "Atolye\ayas-live-$short"
$staging = Join-Path $production "private\temp\live-publish-$short"
$stagedManifest = Join-Path $staging 'prebuilt-runtime-v1.json'
$publication = Read-Json $publicationFile
# The supervisor compares these paths exactly; an ASCII junction path would publish a root it refuses.
if ([string]$publication.workspaceRoot -cne $repo) { throw "Betigi $($publication.workspaceRoot)\scripts icinden calistirin (su an: $repo)." }
$current = [IO.Path]::GetFullPath([string]$publication.applicationRoot).TrimEnd('\')
$liveHead = [string](Read-Json $manifestFile).buildHead

if ($Restart) {
  Say 'BILGI' "Mod: YENIDEN BASLAT (ayni snapshot): $current ($liveHead)"
  $busy = Get-BusyChildren @(Get-CimInstance Win32_Process) $current
  if ($busy.Count -gt 0) { Say 'SORUN' "Canli uygulamada calisan bir is var ($(($busy | ForEach-Object { $_.Name }) -join ', ')); yeniden baslatilmadi."; exit 3 }
  $started = Get-Date
  Stop-LiveProcesses
  Start-Supervisor
  $result = Wait-Healthy $current $started
  if ($result.ok) { Say 'TAMAM' "Yeniden baslatildi: $current (PID $($result.listenerPid), dis erisim: $($result.publicHealth))"; return }
  Say 'SORUN' "Yeniden baslatilan uygulama $HealthTimeoutSeconds sn icinde saglikli olmadi; $recoveryFile ve $accessDir\logs inceleyin."
  exit 1
}

Say 'BILGI' ('Mod: ' + $(if ($Apply) { 'UYGULA (hazirla + gecis)' } elseif ($Prepare) { 'HAZIRLA (canli uygulamaya dokunmaz)' } else { 'KURU CALISMA (degisiklik yok; -Prepare veya -Apply)' }))
Say 'BILGI' "Canli: $current ($liveHead)"
Say 'BILGI' "Hedef: $target ($sha)"
if ($current -ieq $target) { Say 'TAMAM' 'Bu commit zaten canlida.'; return }
$appChanges = @(git -C $repo diff --name-only $liveHead $sha -- $appPaths)
if ($LASTEXITCODE -ne 0) { throw "Canli commit ($liveHead) ile hedef karsilastirilamadi." }
if ($appChanges.Count -eq 0 -and -not $Force) { Say 'TAMAM' 'Uygulama kodu canlidakiyle ayni; yayin gerekmez (yine de yayinlamak icin -Force).'; return }
Say 'BILGI' "Canliya gore degisen uygulama dosyasi: $($appChanges.Count)"

$all = @(Get-CimInstance Win32_Process)
$liveOrigins = @(Find-Origins $all $current)
$busy = Get-BusyChildren $all $current
Say 'BILGI' ("Denetci: " + ((Find-Supervisors $all | ForEach-Object { $_.ProcessId }) -join ',') + "; uygulama: " + (($liveOrigins | ForEach-Object { $_.ProcessId }) -join ',') + "; calisan alt is: $($busy.Count)")

if (-not ($Prepare -or $Apply)) {
  Say 'YAPILACAK' $(if (Test-Path -LiteralPath $target) { "Snapshot mevcut; build ve hazir manifest denetlenir" } else { "Snapshot olusturulur: worktree, npm ci, npm run build, manifest" })
  Say 'YAPILACAK' 'Gecis (-Apply): yedek, denetci + uygulama durdurulur, manifest ve secici degistirilir, denetci yeniden baslar, saglik beklenir; olmazsa geri donus'
  return
}

# --- Prepare: the live application is untouched until the swap below. ---
New-Item -ItemType Directory -Force -Path $staging | Out-Null
$log = Join-Path $staging 'prepare.log'
$savedEnv = @{ TEMP = $env:TEMP; TMP = $env:TMP; NPM_CONFIG_CACHE = $env:NPM_CONFIG_CACHE }
$env:TEMP = Join-Path $production 'private\temp'; $env:TMP = $env:TEMP; $env:NPM_CONFIG_CACHE = Join-Path $production 'private\npm-cache'
try {
  if (-not (Test-Path -LiteralPath $target)) {
    Invoke-Logged 'git worktree add' $log { git -C $repo worktree add --detach $target $sha }
    Say 'YAPILDI' "Worktree olusturuldu: $target"
  } elseif ([string](@(git -C $target rev-parse HEAD)[0]) -ne $sha) { throw "$target baska bir commit'te; elle inceleyin." }
  if (@(git -C $target status --porcelain).Count -ne 0) { throw "$target temiz degil; elle inceleyin." }
  foreach ($relative in $ignoredInputs) {
    $destination = Join-Path $target $relative
    if (Test-Path -LiteralPath $destination) { continue }
    $source = Join-Path $current $relative
    if (-not (Test-Path -LiteralPath $source)) { $source = Join-Path $repo $relative }
    if (-not (Test-Path -LiteralPath $source)) { throw "Gerekli git disi girdi bulunamadi: $relative" }
    Copy-Item -LiteralPath $source -Destination $destination -Recurse
    Say 'YAPILDI' "Git disi girdi kopyalandi: $relative"
  }
  if (-not (Test-Path -LiteralPath (Join-Path $target 'node_modules\next\package.json'))) {
    Invoke-Logged 'npm ci' $log { Push-Location -LiteralPath $target; try { & $npm ci --no-audit --no-fund } finally { Pop-Location } }
    Say 'YAPILDI' 'npm ci (package-lock.json ile birebir)'
  }
  $stampFile = Join-Path $target '.next\ayas-build-stamp.json'
  $stamp = if (Test-Path -LiteralPath $stampFile) { Read-Json $stampFile } else { $null }
  if (-not $stamp -or $stamp.gitHead -ne $sha -or $stamp.treeState -ne 'CLEAN') {
    Invoke-Logged 'npm run build' $log { Push-Location -LiteralPath $target; try { & $npm run build } finally { Pop-Location } }
    $stamp = Read-Json $stampFile
    if ($stamp.gitHead -ne $sha -or $stamp.treeState -ne 'CLEAN') { throw 'Build damgasi CLEAN degil; gunluge bakin.' }
    Say 'YAPILDI' 'npm run build (CLEAN damga)'
  }
  if (Test-Path -LiteralPath $stagedManifest) { Remove-Item -LiteralPath $stagedManifest -Force }
  $null = Invoke-Checker '--qualify' $target $stagedManifest
  Say 'TAMAM' ("Hazir manifest: " + (Invoke-Checker '--check' $target $stagedManifest))
} finally {
  foreach ($name in $savedEnv.Keys) { Set-Item -Path "Env:$name" -Value $savedEnv[$name] -ErrorAction SilentlyContinue; if ($null -eq $savedEnv[$name]) { Remove-Item -Path "Env:$name" -ErrorAction SilentlyContinue } }
}
if (-not $Apply) { Say 'BILGI' 'Gecis icin ayni komutu -Apply ile calistirin.'; return }

# --- Apply: swap manifest + selector together while the supervisor is stopped. ---
$busy = Get-BusyChildren @(Get-CimInstance Win32_Process) $current
if ($busy.Count -gt 0) { throw "Canli uygulamada calisan bir is var ($(($busy | ForEach-Object { $_.Name }) -join ', ')). Is bitince tekrar deneyin." }
$backup = Join-Path $production ("handover\live-publish\" + (Get-Date -Format 'yyyyMMdd-HHmmss') + "-$short")
New-Item -ItemType Directory -Force -Path $backup | Out-Null
Copy-Item -LiteralPath $manifestFile, $publicationFile -Destination $backup
if (Test-Path -LiteralPath $recoveryFile) { Copy-Item -LiteralPath $recoveryFile -Destination $backup }
Say 'YAPILDI' "Yedek: $backup"
$newPublication = [ordered]@{ schemaVersion = 1; workspaceRoot = [string]$publication.workspaceRoot; applicationRoot = $target } | ConvertTo-Json -Compress
$started = Get-Date
Stop-LiveProcesses
Copy-Atomic $stagedManifest $manifestFile
Write-Utf8Atomic $publicationFile $newPublication
Say 'YAPILDI' 'Manifest ve yayin secicisi degistirildi'
Start-Supervisor
$result = Wait-Healthy $target $started
$receipt = [ordered]@{ schemaVersion = 1; commit = $sha; target = $target; previous = $current; previousHead = $liveHead; startedAt = $started.ToUniversalTime().ToString('o'); backup = $backup }
if ($result.ok) {
  $receipt.result = 'PUBLISHED'; $receipt.listenerPid = $result.listenerPid; $receipt.publicHealth = $result.publicHealth
  Write-Utf8Atomic (Join-Path $backup 'receipt.json') ($receipt | ConvertTo-Json -Compress)
  Say 'TAMAM' "Yayinda: $target (PID $($result.listenerPid), dis erisim: $($result.publicHealth))"
  Say 'BILGI' "Onceki snapshot geri donus icin duruyor: $current"
  return
}
Say 'SORUN' "Yeni snapshot $HealthTimeoutSeconds sn icinde saglikli olmadi; geri donuluyor."
$rollbackStarted = Get-Date
Stop-LiveProcesses
Copy-Atomic (Join-Path $backup 'prebuilt-runtime-v1.json') $manifestFile
Copy-Atomic (Join-Path $backup 'published-application-v1.json') $publicationFile
Start-Supervisor
$rollback = Wait-Healthy $current $rollbackStarted
$receipt.result = if ($rollback.ok) { 'ROLLED_BACK' } else { 'ROLLBACK_UNHEALTHY' }
Write-Utf8Atomic (Join-Path $backup 'receipt.json') ($receipt | ConvertTo-Json -Compress)
if ($rollback.ok) { Say 'TAMAM' "Onceki surum yeniden yayinda: $current" } else { Say 'SORUN' "Geri donus de saglikli olmadi; $recoveryFile ve $accessDir\logs inceleyin." }
exit 1

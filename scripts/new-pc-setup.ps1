<#
  AYAS / Atolye new-PC host setup. Dry-run by default; -Apply makes the changes.

  Run from the copied bundle as the normal (not elevated) user:
    powershell -NoProfile -ExecutionPolicy Bypass -File D:\<bundle>\Atolye\atolye-v2\scripts\new-pc-setup.ps1
    powershell -NoProfile -ExecutionPolicy Bypass -File D:\<bundle>\Atolye\atolye-v2\scripts\new-pc-setup.ps1 -Apply

  Binds THIS host to the bundle: installs the exact tool versions the qualified
  phone-access build is pinned to (node.exe / cloudflared.exe SHA-256), sets the
  user env vars, profile junctions, .env.local tool paths and the three Startup
  launchers. It never edits runtime/authority records, never moves or deletes
  bundle data, and never grants production authority: a copied runtime still
  needs the official recovery transition (docs/AYAS_NEW_PC_SETUP.md, step 3).
  ASCII-only on purpose (Windows PowerShell 5.1 reads BOM-less files as ANSI).
#>
param([switch]$Apply, [switch]$SkipTools, [switch]$LocalCodingSandbox)
$ErrorActionPreference = 'Stop'

$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
try {
  if ((New-Object Security.Principal.WindowsPrincipal($identity)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
    throw 'Run as the normal user, not "Run as administrator": Startup, env and junctions are per-user. winget asks for elevation itself when an installer needs it.'
  }
} finally { $identity.Dispose() }

$repo = Split-Path -Parent $PSScriptRoot
$production = Split-Path -Parent (Split-Path -Parent $repo)
$expectedProduction = 'D:\' + [char]0x00DC + 'RET' + [char]0x0130 + 'M'
$asciiAlias = 'D:\URETIM'
$script:changes = 0
$script:problems = New-Object System.Collections.Generic.List[string]

function Say([string]$state, [string]$text) { Write-Output ('[{0}] {1}' -f $state, $text) }
function Plan([string]$text, [scriptblock]$action) {
  $script:changes += 1
  if ($Apply) { & $action; Say 'YAPILDI' $text } else { Say 'YAPILACAK' $text }
}
function Problem([string]$text) { $script:problems.Add($text); Say 'SORUN' $text }
function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}
function Sha([string]$file) { (Get-FileHash -LiteralPath $file -Algorithm SHA256).Hash.ToLowerInvariant() }

Say 'BILGI' ("Mod: " + $(if ($Apply) { 'UYGULA' } else { 'KURU CALISMA (degisiklik yok; uygulamak icin -Apply)' }))
Say 'BILGI' "Paket koku: $production"

# 1. Bundle location. .env.local, launch records and runtime authority all name
# the bundle by its absolute path, so it must sit at exactly the same place.
if ($production -ne $expectedProduction) {
  throw "Paket $expectedProduction altinda olmali (su an: $production). Klasoru D: surucusune ayni adla kopyalayin."
}
foreach ($dir in 'private\temp', 'private\npm-cache', 'private\cloudflared', 'models\ollama\models', 'runtime', 'handover') {
  if (-not (Test-Path -LiteralPath (Join-Path $production $dir) -PathType Container)) { Problem "Paket eksik: $production\$dir" }
}
$aliasItem = Get-Item -LiteralPath $asciiAlias -Force -ErrorAction SilentlyContinue
if (-not $aliasItem) {
  Plan "ASCII baglanti $asciiAlias -> $production (Whisper/Observer yollari)" { New-Item -ItemType Junction -Path $asciiAlias -Target $production | Out-Null }
} elseif (-not ($aliasItem.Attributes -band [IO.FileAttributes]::ReparsePoint) -or (@($aliasItem.Target)[0] -ne $production)) {
  Problem "$asciiAlias var ama $production baglantisi degil; elle inceleyin."
} else { Say 'TAMAM' "$asciiAlias -> $production" }

# 2. Tools from the internet (never stored in the bundle). Node and cloudflared
# are hash-pinned by the qualified phone-access build, so the exact versions are
# installed and then pinned in winget so an upgrade cannot break phone access.
$tools = @(
  @{ Name = 'Node.js'; Id = 'OpenJS.NodeJS.LTS'; Version = '24.18.0'; Exe = 'C:\Program Files\nodejs\node.exe'
     Sha256 = '9a4eb5f1c29c6a2e93852ead46b999e284a6a5ca8bab4d4e241d587d025a52de' },
  @{ Name = 'cloudflared'; Id = 'Cloudflare.cloudflared'; Version = '2026.8.3'; Exe = 'C:\Program Files (x86)\cloudflared\cloudflared.exe'
     Sha256 = '83e726ed18ea78c5ad5213c4c3a3a27051393950d2bc8ed4de69bec12d14eaae' },
  @{ Name = 'Ollama'; Id = 'Ollama.Ollama'; Version = '0.40.5'; Exe = (Join-Path $env:LOCALAPPDATA 'Programs\Ollama\ollama.exe') },
  @{ Name = 'Git'; Id = 'Git.Git'; Version = '2.55.0'; Exe = 'C:\Program Files\Git\cmd\git.exe' },
  @{ Name = 'FFmpeg'; Id = 'Gyan.FFmpeg'; Version = '9.0'; Exe = $null }
)
function Find-FFmpeg {
  $root = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
  if (-not (Test-Path -LiteralPath $root)) { return $null }
  Get-ChildItem -LiteralPath $root -Directory -Filter 'Gyan.FFmpeg*' -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ChildItem -LiteralPath $_.FullName -Recurse -Filter 'ffmpeg.exe' -ErrorAction SilentlyContinue } |
    Where-Object { $_.Directory.Name -eq 'bin' } | Select-Object -First 1 -ExpandProperty FullName
}
if ($SkipTools) { Say 'ATLANDI' 'Arac kurulumu (-SkipTools)' } else {
  $winget = Get-Command winget -ErrorAction SilentlyContinue
  if (-not $winget) { Problem 'winget yok: Microsoft Store > "App Installer" kurun, sonra tekrar calistirin.' }
  foreach ($tool in $tools) {
    $exe = if ($tool.Exe) { $tool.Exe } else { Find-FFmpeg }
    if ($exe -and (Test-Path -LiteralPath $exe)) {
      if ($tool.Sha256 -and (Sha $exe) -ne $tool.Sha256) {
        Problem "$($tool.Name) kurulu ama $($tool.Version) degil (hash farkli). Telefon erisimi bu surume bagli: winget uninstall --id $($tool.Id) ; sonra bu betigi -Apply ile tekrar calistirin."
      } else { Say 'TAMAM' "$($tool.Name) kurulu" }
      continue
    }
    if (-not $winget) { continue }
    Plan "$($tool.Name) $($tool.Version) kur (winget $($tool.Id))" {
      & winget install --id $tool.Id --exact --version $tool.Version --silent --accept-package-agreements --accept-source-agreements
      if ($LASTEXITCODE -ne 0) { throw "winget install $($tool.Id) failed ($LASTEXITCODE)" }
      if ($tool.Sha256) { & winget pin add --id $tool.Id --blocking --accept-source-agreements | Out-Null }
    }
  }
  Refresh-Path
  if ($Apply) {
    foreach ($tool in $tools | Where-Object { $_.Sha256 }) {
      if ((Test-Path -LiteralPath $tool.Exe) -and (Sha $tool.Exe) -ne $tool.Sha256) {
        Problem "$($tool.Name) kuruldu ama hash beklenenden farkli; telefon erisimi icin yeniden yeterlilik gerekir (docs/AYAS_NEW_PC_SETUP.md)."
      }
    }
  }
}

# Podman is only needed by the local coding-model qualification sandbox
# (scripts/run-ayas-local-coding-container.ts pins podman.exe 6.0.2 and an 8 CPU /
# 8 GiB / 40 GB rootless machine). winget stops at 5.8.x, so it is reported, not
# installed; AYAS, phone access and the Development Center run without it.
# Opt-in since 2026-10-15: no local model qualified, so the owner had the
# models and the machine removed; -LocalCodingSandbox restores the check.
$podmanExe = Join-Path $env:LOCALAPPDATA 'Programs\Podman\podman.exe'
$podmanSha = 'f6a555b075654fdb12580bdaf570ee90c2225f94a05781ecd6c1a16c8a5c95ea'
if (-not $LocalCodingSandbox) {
  Say 'TAMAM' 'Podman atlandi (yerel kod modeli sandbox''i kullanimda degil; gerekirse -LocalCodingSandbox)'
} elseif (-not (Test-Path -LiteralPath $podmanExe) -or (Sha $podmanExe) -ne $podmanSha) {
  Say 'UYARI' 'Podman 6.0.2 yok (yalniz yerel kod modeli yeterlilik sandbox''i icin): https://github.com/containers/podman/releases/tag/v6.0.2 adresindeki Windows installer''i kurun, sonra bu betigi tekrar calistirin.'
} else {
  $machines = (& $podmanExe machine list --format '{{.Name}}' 2>$null) -join ' '
  if ($machines -notmatch 'podman-machine-default') {
    Plan 'Podman makinesi (8 CPU, 8 GiB, 40 GB, rootless)' {
      & $podmanExe machine init --cpus 8 --memory 8192 --disk-size 40
      if ($LASTEXITCODE -ne 0) { throw "podman machine init failed ($LASTEXITCODE)" }
    }
  } else { Say 'TAMAM' 'Podman ve makinesi' }
}

# 3. Per-user environment (Windows-wide TEMP/TMP stay untouched).
$userEnv = [ordered]@{
  OLLAMA_MODELS = (Join-Path $production 'models\ollama\models')
  OLLAMA_TMPDIR = (Join-Path $production 'private\temp')
  NPM_CONFIG_CACHE = (Join-Path $production 'private\npm-cache')
  AYAS_TEMP_ROOT = (Join-Path $asciiAlias 'private\temp')
  ATOLYE_DURABLE_PIPELINE_EXECUTION = 'enabled'
}
foreach ($key in $userEnv.Keys) {
  $want = $userEnv[$key]
  if ([Environment]::GetEnvironmentVariable($key, 'User') -eq $want) { Say 'TAMAM' "$key" ; continue }
  Plan "Kullanici ortam degiskeni $key = $want" { [Environment]::SetEnvironmentVariable($key, $want, 'User') }
}

# 4. Profile junctions: Ollama keys/models and the tunnel config live in the bundle.
$junctions = [ordered]@{
  (Join-Path $env:USERPROFILE '.ollama') = (Join-Path $production 'models\ollama')
  (Join-Path $env:USERPROFILE '.cloudflared') = (Join-Path $production 'private\cloudflared')
}
foreach ($link in $junctions.Keys) {
  $target = $junctions[$link]
  $item = Get-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
  if ($item -and ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -and (@($item.Target)[0] -eq $target)) { Say 'TAMAM' "$link -> $target"; continue }
  Plan "Baglanti $link -> $target (varsa eski klasor .pre-ayas olarak saklanir)" {
    if ($item) {
      $kept = '{0}.pre-ayas-{1}' -f $link, (Get-Date -Format 'yyyyMMddHHmmss')
      if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) { cmd /c rmdir "$link" | Out-Null } else { Rename-Item -LiteralPath $link -NewName (Split-Path -Leaf $kept) }
    }
    New-Item -ItemType Junction -Path $link -Target $target | Out-Null
  }
}

# 5. .env.local tool paths: only the FFmpeg keys name an installed program.
$envFile = Join-Path $repo '.env.local'
$ffmpeg = Find-FFmpeg
if (-not (Test-Path -LiteralPath $envFile)) { Problem '.env.local yok (paketle birlikte kopyalanmali).' }
elseif (-not $ffmpeg) { if ($Apply -or $SkipTools) { Problem 'FFmpeg bulunamadi; .env.local FFmpeg yollari guncellenemedi.' } else { Say 'BEKLIYOR' '.env.local FFmpeg yollari (FFmpeg kurulunca guncellenecek)' } }
else {
  $ffprobe = Join-Path (Split-Path -Parent $ffmpeg) 'ffprobe.exe'
  $wanted = [ordered]@{ FFMPEG_PATH = $ffmpeg; FFPROBE_PATH = $ffprobe; FFMPEG_EXECUTABLE = $ffmpeg; FFPROBE_EXECUTABLE = $ffprobe; AYAS_FFMPEG_PATH = ($ffmpeg -replace '\\', '/') }
  $text = [IO.File]::ReadAllText($envFile)
  $updated = $text
  foreach ($key in $wanted.Keys) {
    $pattern = '(?m)^' + [regex]::Escape($key) + '=[^\r\n]*'
    $line = $key + '=' + $wanted[$key]
    if ([regex]::IsMatch($updated, $pattern)) { $updated = [regex]::Replace($updated, $pattern, { param($m) $line }) }
  }
  if ($updated -ceq $text) { Say 'TAMAM' '.env.local FFmpeg yollari' } else {
    Plan ".env.local FFmpeg yollari -> $(Split-Path -Parent $ffmpeg) (yedek private\host-settings-backup)" {
      $backupDir = Join-Path $production 'private\host-settings-backup'
      New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
      Copy-Item -LiteralPath $envFile -Destination (Join-Path $backupDir ('env.local.{0}.bak' -f (Get-Date -Format 'yyyyMMddHHmmss')))
      [IO.File]::WriteAllText($envFile, $updated, (New-Object Text.UTF8Encoding($false)))
    }
  }
}

# 6. Dependencies of the working repo (the published app snapshot keeps its own,
# hash-pinned node_modules and is never reinstalled here). Graphify is global.
Refresh-Path
if (-not (Test-Path -LiteralPath (Join-Path $repo 'node_modules\.package-lock.json'))) {
  Plan 'Repo bagimliliklari: npm ci (onbellek paket icinde)' {
    Push-Location $repo
    try {
      $env:NPM_CONFIG_CACHE = $userEnv.NPM_CONFIG_CACHE; $env:TEMP = $userEnv.OLLAMA_TMPDIR; $env:TMP = $env:TEMP
      & npm ci --no-audit --no-fund
      if ($LASTEXITCODE -ne 0) { throw "npm ci failed ($LASTEXITCODE)" }
    } finally { Pop-Location }
  }
} else { Say 'TAMAM' 'Repo node_modules' }
if (-not (Get-Command graphify -ErrorAction SilentlyContinue)) {
  Plan 'Graphify 0.17.1 (npm global)' { & npm install -g '@sentropic/graphify@0.17.1'; if ($LASTEXITCODE -ne 0) { throw 'graphify install failed' } }
} else { Say 'TAMAM' 'Graphify' }
$git = Get-Command git -ErrorAction SilentlyContinue
if ($git) {
  $null = & git -C $repo rev-parse --git-dir 2>&1
  if ($LASTEXITCODE -ne 0) {
    Plan "git safe.directory $repo (kopyalanan klasorun sahibi degisti)" { & git config --global --add safe.directory ($repo -replace '\\', '/') }
  } else { Say 'TAMAM' 'Git deposu okunuyor' }
}

# 7. Logon launchers (no admin, no visible window). All three derive their paths
# from their own location, so they keep working wherever the bundle is copied.
$startup = [Environment]::GetFolderPath('Startup')
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$launchers = [ordered]@{
  'AYAS Access Online' = (Join-Path $PSScriptRoot 'ayas-access-hidden.vbs')
  'AYAS Autonomy Observer' = (Join-Path $PSScriptRoot 'ayas-observer-hidden.vbs')
  'Ollama' = (Join-Path $PSScriptRoot 'ollama-production-hidden.vbs')
}
$shell = New-Object -ComObject WScript.Shell
foreach ($name in $launchers.Keys) {
  $lnk = Join-Path $startup "$name.lnk"
  $arguments = '//B //NoLogo "' + $launchers[$name] + '"'
  if (Test-Path -LiteralPath $lnk) {
    $current = $shell.CreateShortcut($lnk)
    if ($current.TargetPath -eq $wscript -and $current.Arguments -eq $arguments -and $current.WorkingDirectory -eq $repo) { Say 'TAMAM' "Baslangic: $name"; continue }
  }
  Plan "Baslangic kisayolu: $name" {
    $shortcut = $shell.CreateShortcut($lnk)
    $shortcut.TargetPath = $wscript
    $shortcut.Arguments = $arguments
    $shortcut.WorkingDirectory = $repo
    $shortcut.Description = "AYAS $name (D bundle launcher)"
    $shortcut.Save()
  }
}
foreach ($task in Get-ScheduledTask -ErrorAction SilentlyContinue | Where-Object { $_.TaskName -match '^AYAS ' }) {
  foreach ($action in $task.Actions) {
    if ($action.Arguments -match '"([^"]+\.vbs)"' -and -not (Test-Path -LiteralPath $Matches[1])) {
      Say 'UYARI' "Eski zamanlanmis gorev '$($task.TaskName)' olmayan dosyayi gosteriyor; yonetici PowerShell: Unregister-ScheduledTask -TaskName '$($task.TaskName)' -Confirm:`$false"
    }
  }
}

# 8. Read-only checks.
if ($Apply -or (Test-Path -LiteralPath (Join-Path $repo 'node_modules'))) {
  Push-Location $repo
  try {
    $layout = (& node --env-file=.env.local scripts/check-production-layout.mjs 2>&1 | Out-String)
    if ($layout -match 'QUALIFIED_CURRENT_HOST_LAYOUT') { Say 'TAMAM' 'Atolye runtime bu PC icin yeterli' }
    elseif ($layout -match 'requalification') { Say 'SONRAKI' 'Atolye runtime kopyalanmis: proje medyasi icin resmi kurtarma gecisi gerekli (docs/AYAS_NEW_PC_SETUP.md adim 3). AYAS ve Gelisim Merkezi bunu beklemeden calisir.' }
    else { Problem ('Runtime duzen kontrolu: ' + ($layout.Trim() -split "`n" | Select-Object -Last 1)) }
  } finally { Pop-Location }
}

Write-Output ''
if ($script:problems.Count) { Say 'SONUC' "$($script:problems.Count) sorun var; yukaridaki [SORUN] satirlarini cozun ve tekrar calistirin."; exit 1 }
if (-not $Apply -and $script:changes) { Say 'SONUC' "$($script:changes) degisiklik bekliyor. Uygulamak icin: -Apply"; exit 0 }
Say 'SONUC' 'Bu PC hazir. Bilgisayari yeniden baslatin; AYAS oturum acilisinda kendiliginden baslar ve telefondan erisilir.'

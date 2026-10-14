# Explicit qualified-current-host start. Never installs, copies, or grants authority.
$ErrorActionPreference = 'Stop'
$repo = Split-Path -Parent $PSScriptRoot
$production = Split-Path -Parent (Split-Path -Parent $repo)
$node = (Get-Command node.exe -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
Push-Location $repo
try {
  & $node "--env-file=.env.local" (Join-Path $PSScriptRoot 'check-production-layout.mjs')
  if ($LASTEXITCODE -ne 0) { throw 'PRODUCTION_REQUIRES_OFFICIAL_PHYSICAL_QUALIFICATION' }
  $launchers = @((Join-Path $PSScriptRoot 'ayas-access-hidden.vbs'), (Join-Path $production 'private\AtolyeAyasAccess\run-ayas-observer-hidden.vbs'))
  foreach ($launcher in $launchers) {
    if (-not (Test-Path -LiteralPath $launcher -PathType Leaf)) { throw 'QUALIFIED_PRODUCTION_LAUNCHER_MISSING' }
  }
  $wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
  foreach ($launcher in $launchers) { Start-Process -FilePath $wscript -ArgumentList ('//B //NoLogo "' + $launcher + '"') -WorkingDirectory $repo -WindowStyle Hidden }
  Write-Output 'Existing qualified production launchers requested; native singleton and safety gates remain active.'
} finally { Pop-Location }

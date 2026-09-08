param(
  [string]$DataRoot,
  [string]$ProjectionRoot,
  [string]$WorkingRoot
)

$ErrorActionPreference = 'Stop'
$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$root = if ($WorkingRoot) { $WorkingRoot } else { Split-Path $PSScriptRoot -Parent }
$dataRoot = if ($DataRoot) { $DataRoot } else { Join-Path $root 'data' }
$projectionRoot = if ($ProjectionRoot) { $ProjectionRoot } else { Join-Path $root 'data\runtime\cru34-live' }
$lockPath = Join-Path $projectionRoot 'worker.lock'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $projectionRoot, $logDir | Out-Null

if (Test-Path -LiteralPath $lockPath) {
  $incumbentPid = [int](Get-Content -LiteralPath $lockPath -Raw)
  $incumbent = Get-Process -Id $incumbentPid -ErrorAction SilentlyContinue
  if ($incumbent) { exit 0 }
}

$env:CRU34_LIVE_DATA_ROOT = $dataRoot
$env:CRU34_LIVE_PROJECTION_ROOT = $projectionRoot
$env:CRU34_LIVE_SNAPSHOT_PATH = Join-Path $projectionRoot 'latest.json'
$env:CRU34_LIVE_STATUS_PATH = Join-Path $projectionRoot 'status.json'

$stdout = Join-Path $logDir 'cru34-live-projection.log'
$stderr = Join-Path $logDir 'cru34-live-projection-error.log'
Start-Process -FilePath $node -ArgumentList 'scripts/run-cru34-live-projection.mjs' `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

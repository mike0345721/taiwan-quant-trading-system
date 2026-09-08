$ErrorActionPreference = 'Stop'
$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$root = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$existing = Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { $_.CommandLine -like '*run-cru34-live-projection.mjs*' }
if ($existing) { exit 0 }
$projectionRoot = Join-Path $root 'data\runtime\cru34-live'
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $projectionRoot, $logDir | Out-Null

$env:CRU34_LIVE_PROJECTION_ROOT = $projectionRoot
$env:CRU34_LIVE_SNAPSHOT_PATH = Join-Path $projectionRoot 'latest.json'
$env:CRU34_LIVE_STATUS_PATH = Join-Path $projectionRoot 'status.json'

$stdout = Join-Path $logDir 'cru34-live-projection.log'
$stderr = Join-Path $logDir 'cru34-live-projection-error.log'
Start-Process -FilePath $node -ArgumentList 'scripts/run-cru34-live-projection.mjs' `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

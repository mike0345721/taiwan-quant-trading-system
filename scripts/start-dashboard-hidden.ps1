$ErrorActionPreference = 'Stop'
$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$root = Split-Path $PSScriptRoot -Parent
$health = 'http://127.0.0.1:8787/healthz'
$projectionRoot = Join-Path $root 'data\runtime\cru34-live'
$env:CRU34_LIVE_SNAPSHOT_PATH = Join-Path $projectionRoot 'latest.json'
$env:CRU34_LIVE_STATUS_PATH = Join-Path $projectionRoot 'status.json'

# Opening the dashboard does not authorize background data actions.

try {
  $response = Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 2
  if ($response.StatusCode -eq 200) { exit 0 }
} catch { }

if (Get-NetTCPConnection -State Listen -LocalPort 8787 -ErrorAction SilentlyContinue) {
  throw 'DASHBOARD_ALREADY_LISTENING_BUT_HEALTH_UNVERIFIED'
}

$node = (Get-Command node.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir 'dashboard-server.log'
$stderr = Join-Path $logDir 'dashboard-server-error.log'

Start-Process -FilePath $node -ArgumentList 'launcher.mjs' -WorkingDirectory $root `
  -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr

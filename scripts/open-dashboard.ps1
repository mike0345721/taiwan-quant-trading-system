$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$url = 'http://127.0.0.1:8787/'
$health = "${url}healthz"
$commonGitDir = (& git -C $root rev-parse --path-format=absolute --git-common-dir 2>$null).Trim()
$sharedRoot = if ($commonGitDir) { Split-Path $commonGitDir -Parent } else { $root }
if (Test-Path (Join-Path $sharedRoot 'data\live-events')) {
  $env:CRU34_LIVE_DATA_ROOT = Join-Path $sharedRoot 'data'
  $env:TX_CHART_DATA_ROOT = Join-Path $sharedRoot 'data'
}
if (Test-Path (Join-Path $sharedRoot '.env')) {
  $env:DASHBOARD_ENV_PATH = Join-Path $sharedRoot '.env'
}

function Test-Dashboard {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

$shioajiStarter = if ($sharedRoot -ne $root) {
  Join-Path $sharedRoot 'scripts\start-shioaji-readonly-hidden.ps1'
} else { Join-Path $PSScriptRoot 'start-shioaji-readonly-hidden.ps1' }
& $shioajiStarter
& (Join-Path $PSScriptRoot 'start-cru34-live-projection-hidden.ps1')

if (-not (Test-Dashboard)) {
  & (Join-Path $PSScriptRoot 'start-dashboard-hidden.ps1')
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-Dashboard) { break }
  }
}

if (-not (Test-Dashboard)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Dashboard startup failed. Run node launcher.mjs to view the error.', 'Taiwan Stock Dashboard') | Out-Null
  exit 1
}

Start-Process $url

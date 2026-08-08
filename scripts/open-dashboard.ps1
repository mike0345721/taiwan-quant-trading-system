$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$url = 'http://127.0.0.1:8787/'
$health = "${url}healthz"

function Test-Dashboard {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $health -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch { return $false }
}

& (Join-Path $PSScriptRoot 'start-shioaji-readonly-hidden.ps1')

if (-not (Test-Dashboard)) {
  & (Join-Path $PSScriptRoot 'start-dashboard-hidden.ps1')
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 500
    if (Test-Dashboard) { break }
  }
}

if (-not (Test-Dashboard)) {
  Add-Type -AssemblyName PresentationFramework
  [System.Windows.MessageBox]::Show('Dashboard startup failed. Run 2_START.bat to view the error.', 'Taiwan Stock Dashboard') | Out-Null
  exit 1
}

Start-Process $url

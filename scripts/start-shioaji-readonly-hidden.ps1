$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$health = 'http://127.0.0.1:8790/health'
$credentials = Join-Path $root '.shioaji.credentials.json'

if (-not (Test-Path $credentials)) { exit 0 }

try {
  $response = Invoke-RestMethod -Uri $health -TimeoutSec 2
  if ($response.ok -and
      $response.mode -eq 'market_data_only' -and
      $response.formalWeight -eq 0 -and
      $response.researchOnly -eq $true -and
      -not $response.executionAuthorized -and
      -not $response.orderRoutesEnabled) { exit 0 }
} catch { }

$python = (Get-Command python.exe -ErrorAction Stop).Source
$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir 'shioaji-readonly.log'
$stderr = Join-Path $logDir 'shioaji-readonly-error.log'
$bridge = Join-Path $root 'broker\shioaji_readonly_bridge.py'

Start-Process -FilePath $python `
  -ArgumentList "`"$bridge`"" `
  -WorkingDirectory $root -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

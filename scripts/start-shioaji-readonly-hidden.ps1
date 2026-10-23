param([switch]$OwnerApprovedStart)
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$health = 'http://127.0.0.1:8790/health'
$credentials = Join-Path $root '.shioaji.credentials.json'

# A dashboard/boot invocation is not permission for another broker login.
if (-not $OwnerApprovedStart) {
  Write-Output 'BROKER_START_NOT_REQUESTED: existing sessions are left unchanged.'
  exit 0
}
$node = (Get-Command node.exe -ErrorAction Stop).Source
$gate = & $node (Join-Path $PSScriptRoot 'inspect-market-start-gate.mjs')
if ($LASTEXITCODE -ne 0) { throw 'BROKER_START_CALENDAR_BLOCKED' }
# A slow/unhealthy incumbent must never be duplicated.
if (Get-NetTCPConnection -State Listen -LocalPort 8790 -ErrorAction SilentlyContinue) {
  Write-Output 'BROKER_ALREADY_LISTENING: no restart or duplicate login.'
  exit 0
}

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

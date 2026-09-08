param(
  [int]$Port = 8793,
  [string]$SharedRoot = 'D:\Taiwan stock\standalone-v1'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$expectedBranch = 'codex/cru-46-dashboard-integration-mainline-v1'
$branch = (& git -c "safe.directory=$root" -C $root branch --show-current).Trim()
if ($branch -ne $expectedBranch) { throw "CRU46_BRANCH_MISMATCH:$branch" }
if (& git -c "safe.directory=$root" -C $root status --porcelain) { throw 'CRU46_WORKTREE_NOT_CLEAN' }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "CRU46_PORT_ALREADY_IN_USE:$Port" }

$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:DASHBOARD_ENV_PATH = Join-Path $SharedRoot '.env'
$env:TX_CHART_DATA_ROOT = Join-Path $SharedRoot 'data'
$env:CRU34_LIVE_SNAPSHOT_PATH = Join-Path $SharedRoot 'data\runtime\cru34-live\latest.json'
$env:CRU34_LIVE_STATUS_PATH = Join-Path $SharedRoot 'data\runtime\cru34-live\status.json'
$env:DASHBOARD_PREVIEW_TYPE = 'INTEGRATION_OWNER_PREVIEW'
$env:DASHBOARD_PREVIEW_BRANCH = $expectedBranch
$env:DASHBOARD_PREVIEW_DATA_MODE = 'GOVERNED_LOCAL_DATA'
$env:MOCK_DATA = 'false'

$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir 'cru46-owner-preview.log'
$stderr = Join-Path $logDir 'cru46-owner-preview-error.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList 'launcher.mjs' -WorkingDirectory $root `
  -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$health = "http://127.0.0.1:$Port/healthz"
for ($attempt = 0; $attempt -lt 30; $attempt += 1) {
  Start-Sleep -Milliseconds 250
  try {
    $response = Invoke-RestMethod -Uri $health -TimeoutSec 2
    if ($response.ok -and $response.versionTruth.previewType -eq 'INTEGRATION_OWNER_PREVIEW') {
      [pscustomobject]@{ ProcessId = $process.Id; Url = "http://127.0.0.1:$Port/"; ExactHead = $response.versionTruth.exactHead }
      exit 0
    }
  } catch { }
}

if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
throw "CRU46_PREVIEW_START_FAILED:$stderr"

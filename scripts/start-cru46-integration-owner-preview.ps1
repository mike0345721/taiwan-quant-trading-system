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
$expectedHead = (& git -c "safe.directory=$root" -C $root rev-parse HEAD).Trim().ToLowerInvariant()
if ($expectedHead -notmatch '^[0-9a-f]{40}$') { throw 'CRU46_EXPECTED_HEAD_UNVERIFIED' }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) { throw "CRU46_PORT_ALREADY_IN_USE:$Port" }

$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:DASHBOARD_ENV_PATH = Join-Path $SharedRoot '.env'
$env:TX_CHART_DATA_ROOT = Join-Path $SharedRoot 'data'
$env:CRU34_LIVE_DATA_ROOT = Join-Path $SharedRoot 'data'
$env:CRU34_LIVE_SNAPSHOT_PATH = Join-Path $SharedRoot 'data\runtime\cru34-live\latest.json'
$env:CRU34_LIVE_STATUS_PATH = Join-Path $SharedRoot 'data\runtime\cru34-live\status.json'
$env:DASHBOARD_LIGHTWEIGHT_CHARTS_PATH = Join-Path $SharedRoot 'node_modules\lightweight-charts\dist\lightweight-charts.standalone.production.js'
$env:DASHBOARD_LIGHTWEIGHT_CHARTS_PACKAGE_PATH = Join-Path $SharedRoot 'node_modules\lightweight-charts\package.json'
$env:DASHBOARD_PREVIEW_TYPE = 'INTEGRATION_OWNER_PREVIEW'
$env:DASHBOARD_PREVIEW_BRANCH = $expectedBranch
$env:DASHBOARD_PREVIEW_DATA_MODE = 'GOVERNED_LOCAL_DATA'
$env:MOCK_DATA = 'false'

$vendorPackage = Get-Content -LiteralPath $env:DASHBOARD_LIGHTWEIGHT_CHARTS_PACKAGE_PATH -Raw | ConvertFrom-Json
if ($vendorPackage.version -ne '5.2.0') { throw "CRU46_CHART_VENDOR_VERSION_MISMATCH:$($vendorPackage.version)" }
$vendor = Get-Item -LiteralPath $env:DASHBOARD_LIGHTWEIGHT_CHARTS_PATH -ErrorAction Stop
if ($vendor.Length -le 0) { throw 'CRU46_CHART_VENDOR_BUNDLE_EMPTY' }

$projectionRoot = Split-Path $env:CRU34_LIVE_SNAPSHOT_PATH -Parent
& (Join-Path $PSScriptRoot 'start-cru34-live-projection-hidden.ps1') `
  -DataRoot $env:CRU34_LIVE_DATA_ROOT -ProjectionRoot $projectionRoot -WorkingRoot $root
for ($attempt = 0; $attempt -lt 60; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  if ((Test-Path -LiteralPath $env:CRU34_LIVE_SNAPSHOT_PATH) -and (Test-Path -LiteralPath $env:CRU34_LIVE_STATUS_PATH)) {
    $producerStatus = Get-Content -LiteralPath $env:CRU34_LIVE_STATUS_PATH -Raw | ConvertFrom-Json
    if ($producerStatus.status -eq 'AVAILABLE' -and $producerStatus.snapshotPath -eq $env:CRU34_LIVE_SNAPSHOT_PATH `
      -and $producerStatus.statusPath -eq $env:CRU34_LIVE_STATUS_PATH) { break }
  }
}
if (!$producerStatus -or $producerStatus.status -ne 'AVAILABLE') {
  throw "CRU46_LIVE_PROJECTION_PREFLIGHT_FAILED:$($producerStatus.reason)"
}

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
    $truth = $response.versionTruth
    $exactHead = [string]$truth.exactHead
    $buildCommit = [string]$truth.buildCommit
    $runtimeCommit = [string]$truth.runtimeCommit
    $sourceTruthMatches = $truth.baseMainCommit -eq 'a6984a44c21ec3d012ca5d30acb86ae71215f64f' `
      -and $truth.includedSources.cru43 -eq 'e2427bef6b7659da684e9c82f7fa11680e4688f0' `
      -and $truth.includedSources.cru45 -eq '9f244e1171b2ecfab5c982343a42682858a489c2'
    if ($response.ok -and $response.identityReady.ready -eq $true `
      -and $response.runtimePreflightReady.ready -eq $true `
      -and $truth.previewType -eq 'INTEGRATION_OWNER_PREVIEW' `
      -and $exactHead -match '^[0-9a-f]{40}$' -and $buildCommit -match '^[0-9a-f]{40}$' `
      -and $runtimeCommit -match '^[0-9a-f]{40}$' -and $exactHead -eq $expectedHead `
      -and $buildCommit -eq $expectedHead -and $runtimeCommit -eq $expectedHead -and $sourceTruthMatches) {
      [pscustomobject]@{ ProcessId = $process.Id; Port = $Port; ExactHead = $response.versionTruth.exactHead; Gate = 'BROWSER_ACCEPTANCE_REQUIRED'; OwnerPreviewReady = $false }
      exit 0
    }
  } catch { }
}

if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
throw "CRU46_PREVIEW_START_FAILED:$stderr"

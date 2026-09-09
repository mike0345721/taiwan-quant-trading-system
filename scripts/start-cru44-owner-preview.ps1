param(
  [int]$Port = 8794,
  [string]$SharedRoot = 'D:\Taiwan stock\standalone-v1',
  [string]$ProjectionRoot = 'D:\Taiwan stock\standalone-v1\data\runtime\cru44-candidate-9768dd9'
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$expectedBranch = 'codex/cru-44-15m-30m-observed-flow-v1'
$approvedMain = '9768dd9df5b506f519b52cc1baf7bf9acb551f4c'
$branch = (& git -c "safe.directory=$root" -C $root branch --show-current).Trim()
if ($branch -ne $expectedBranch) { throw "CRU44_BRANCH_MISMATCH:$branch" }
if (& git -c "safe.directory=$root" -C $root status --porcelain) { throw 'CRU44_WORKTREE_NOT_CLEAN' }
$expectedHead = (& git -c "safe.directory=$root" -C $root rev-parse HEAD).Trim().ToLowerInvariant()
if ($expectedHead -notmatch '^[0-9a-f]{40}$') { throw 'CRU44_EXPECTED_HEAD_UNVERIFIED' }
$mergeBase = (& git -c "safe.directory=$root" -C $root merge-base HEAD $approvedMain).Trim().ToLowerInvariant()
if ($mergeBase -ne $approvedMain) { throw "CRU44_APPROVED_BASE_MISMATCH:$mergeBase" }

$listener = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  try {
    $existing = Invoke-RestMethod -Uri "http://127.0.0.1:$Port/healthz" -TimeoutSec 15
    if ($existing.versionTruth.exactHead -eq $expectedHead) {
      if ($existing.ownerPreviewReady.ready -eq $true) {
        [pscustomobject]@{ ProcessId = $listener.OwningProcess; Url = "http://127.0.0.1:$Port/";
          ExactHead = $expectedHead; Gate = 'READY_FOR_CRU44_15M_30M_OWNER_PREVIEW'; OwnerPreviewReady = $true }
        exit 0
      }
      if ($existing.identityReady.ready -eq $true -and $existing.runtimePreflightReady.ready -eq $true) {
        [pscustomobject]@{ ProcessId = $listener.OwningProcess; Url = "http://127.0.0.1:$Port/";
          ExactHead = $expectedHead; Gate = 'BROWSER_ACCEPTANCE_REQUIRED'; OwnerPreviewReady = $false }
        exit 0
      }
    }
    throw "CRU44_EXISTING_PREVIEW_NOT_READY:$($existing.ownerPreviewReady.reasons -join ',')"
  } catch {
    throw "CRU44_PORT_ALREADY_IN_USE:${Port}:$($_.Exception.Message)"
  }
}

$processPath = $env:Path
[Environment]::SetEnvironmentVariable('PATH', $null, 'Process')
[Environment]::SetEnvironmentVariable('Path', $processPath, 'Process')
$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:DASHBOARD_ENV_PATH = Join-Path $SharedRoot '.env'
$env:TX_CHART_DATA_ROOT = Join-Path $SharedRoot 'data'
$env:CRU34_LIVE_DATA_ROOT = Join-Path $SharedRoot 'data'
$env:CRU34_LIVE_SNAPSHOT_PATH = Join-Path $ProjectionRoot 'latest.json'
$env:CRU34_LIVE_STATUS_PATH = Join-Path $ProjectionRoot 'status.json'
$env:DASHBOARD_LIGHTWEIGHT_CHARTS_PATH = Join-Path $SharedRoot 'node_modules\lightweight-charts\dist\lightweight-charts.standalone.production.js'
$env:DASHBOARD_LIGHTWEIGHT_CHARTS_PACKAGE_PATH = Join-Path $SharedRoot 'node_modules\lightweight-charts\package.json'
$env:DASHBOARD_PREVIEW_TYPE = 'CRU44_OWNER_PREVIEW'
$env:DASHBOARD_PREVIEW_BRANCH = $expectedBranch
$env:DASHBOARD_PREVIEW_DATA_MODE = 'GOVERNED_LOCAL_DATA'
$env:MOCK_DATA = 'false'

$vendorPackage = Get-Content -LiteralPath $env:DASHBOARD_LIGHTWEIGHT_CHARTS_PACKAGE_PATH -Raw | ConvertFrom-Json
if ($vendorPackage.version -ne '5.2.0') { throw "CRU44_CHART_VENDOR_VERSION_MISMATCH:$($vendorPackage.version)" }
$vendor = Get-Item -LiteralPath $env:DASHBOARD_LIGHTWEIGHT_CHARTS_PATH -ErrorAction Stop
if ($vendor.Length -le 0) { throw 'CRU44_CHART_VENDOR_BUNDLE_EMPTY' }

& (Join-Path $PSScriptRoot 'start-cru34-live-projection-hidden.ps1') `
  -DataRoot $env:CRU34_LIVE_DATA_ROOT -ProjectionRoot $ProjectionRoot -WorkingRoot $root
$producerStatus = $null
for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  if ((Test-Path -LiteralPath $env:CRU34_LIVE_SNAPSHOT_PATH) -and (Test-Path -LiteralPath $env:CRU34_LIVE_STATUS_PATH)) {
    $producerStatus = Get-Content -LiteralPath $env:CRU34_LIVE_STATUS_PATH -Raw | ConvertFrom-Json
    if ($producerStatus.status -eq 'AVAILABLE' -and $producerStatus.snapshotPath -eq $env:CRU34_LIVE_SNAPSHOT_PATH `
      -and $producerStatus.statusPath -eq $env:CRU34_LIVE_STATUS_PATH `
      -and ((Get-Date) - [datetime]$producerStatus.observedAt).TotalSeconds -le 15) {
      $producerProcess = Get-Process -Id $producerStatus.pid -ErrorAction SilentlyContinue
      if ($producerProcess -and $producerStatus.workerInstanceId) { break }
    }
  }
}
if (!$producerStatus -or $producerStatus.status -ne 'AVAILABLE') {
  throw "CRU44_LIVE_PROJECTION_PREFLIGHT_FAILED:$($producerStatus.reason)"
}

$logDir = Join-Path $root 'data\automation-logs'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$stdout = Join-Path $logDir 'cru44-owner-preview.log'
$stderr = Join-Path $logDir 'cru44-owner-preview-error.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList 'launcher.mjs' -WorkingDirectory $root `
  -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

$health = "http://127.0.0.1:$Port/healthz"
$lastHealthReason = 'HEALTH_NOT_OBSERVED'
for ($attempt = 0; $attempt -lt 300; $attempt += 1) {
  Start-Sleep -Seconds 1
  try {
    $response = Invoke-RestMethod -Uri $health -TimeoutSec 15
    $truth = $response.versionTruth
    $exactHead = [string]$truth.exactHead
    $buildCommit = [string]$truth.buildCommit
    $runtimeCommit = [string]$truth.runtimeCommit
    $sourceTruthMatches = $truth.baseMainCommit -eq $approvedMain `
      -and $truth.includedSources.cru34 -eq 'frozen-semantics-v1' `
      -and $truth.includedSources.cru36 -eq 'governed-local-ledger-v1' `
      -and $truth.includedSources.cru43 -eq 'e2427bef6b7659da684e9c82f7fa11680e4688f0'
    $flow = $response.runtimeEvidence.observedFlow
    $longWindowsReady = $flow.fifteenMinuteStatus -ne 'UNAVAILABLE' `
      -and $flow.thirtyMinuteStatus -ne 'UNAVAILABLE'
    if ($response.ok -and $response.identityReady.ready -eq $true `
      -and $response.runtimePreflightReady.ready -eq $true -and $longWindowsReady `
      -and $truth.previewType -eq 'CRU44_OWNER_PREVIEW' `
      -and $exactHead -match '^[0-9a-f]{40}$' -and $buildCommit -match '^[0-9a-f]{40}$' `
      -and $runtimeCommit -match '^[0-9a-f]{40}$' -and $exactHead -eq $expectedHead `
      -and $buildCommit -eq $expectedHead -and $runtimeCommit -eq $expectedHead -and $sourceTruthMatches) {
      [pscustomobject]@{ ProcessId = $process.Id; Port = $Port; Url = "http://127.0.0.1:$Port/";
        ExactHead = $exactHead; Gate = 'BROWSER_ACCEPTANCE_REQUIRED'; OwnerPreviewReady = $false }
      exit 0
    }
    $lastHealthReason = ($response.runtimePreflightReady.reasons -join ',')
    if (!$lastHealthReason) { $lastHealthReason = 'CRU44_PREFLIGHT_NOT_READY' }
  } catch { $lastHealthReason = $_.Exception.Message }
}

if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
throw "CRU44_PREVIEW_START_FAILED:${lastHealthReason}:$stderr"

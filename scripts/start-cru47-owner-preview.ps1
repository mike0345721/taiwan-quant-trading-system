param(
  [int]$Port = 8796,
  [string]$SharedRoot = 'D:\Taiwan stock\approved-main-runtime',
  [string]$ProjectionRoot = '',
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$expectedBranch = 'codex/cru-47-localhost-owner-preview-auto-auth-v1'
$approvedMain = '8756efabe3a54e49154ed2fe6a705a354607c69b'
if (!$ProjectionRoot) { $ProjectionRoot = Join-Path $SharedRoot 'data\runtime\cru34-live' }

$branch = (& git -c "safe.directory=$root" -C $root branch --show-current).Trim()
if ($branch -ne $expectedBranch) { throw "CRU47_BRANCH_MISMATCH:$branch" }
if (& git -c "safe.directory=$root" -C $root status --porcelain) { throw 'CRU47_WORKTREE_NOT_CLEAN' }
$expectedHead = (& git -c "safe.directory=$root" -C $root rev-parse HEAD).Trim().ToLowerInvariant()
if ($expectedHead -notmatch '^[0-9a-f]{40}$') { throw 'CRU47_EXPECTED_HEAD_UNVERIFIED' }
$mergeBase = (& git -c "safe.directory=$root" -C $root merge-base HEAD $approvedMain).Trim().ToLowerInvariant()
if ($mergeBase -ne $approvedMain) { throw "CRU47_APPROVED_BASE_MISMATCH:$mergeBase" }

if (Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue) {
  throw "CRU47_PORT_ALREADY_IN_USE:$Port"
}

$sharedDataRoot = Join-Path $SharedRoot 'data'
$snapshotPath = Join-Path $ProjectionRoot 'latest.json'
$statusPath = Join-Path $ProjectionRoot 'status.json'
foreach ($requiredPath in @($sharedDataRoot, $snapshotPath, $statusPath)) {
  if (!(Test-Path -LiteralPath $requiredPath)) { throw "CRU47_GOVERNED_DEPENDENCY_MISSING:$requiredPath" }
}
$producerStatus = Get-Content -LiteralPath $statusPath -Raw | ConvertFrom-Json
if ($producerStatus.schemaVersion -ne 'cru34-live-worker-status-v1' `
  -or $producerStatus.dataRoot -ne $sharedDataRoot `
  -or $producerStatus.projectionRoot -ne $ProjectionRoot `
  -or $producerStatus.snapshotPath -ne $snapshotPath `
  -or $producerStatus.statusPath -ne $statusPath `
  -or !$producerStatus.workerInstanceId -or !$producerStatus.pid `
  -or $producerStatus.formalWeight -ne 0 -or $producerStatus.researchOnly -ne $true `
  -or $producerStatus.executionAuthorized -ne $false -or $producerStatus.orderRoutesEnabled -ne $false) {
  throw 'CRU47_PRODUCER_SAFETY_BOUNDARY_INVALID'
}
$producerObservedAt = [datetime]$producerStatus.observedAt
if (((Get-Date).ToUniversalTime() - $producerObservedAt.ToUniversalTime()).TotalSeconds -gt 30) {
  throw 'CRU47_PRODUCER_HEARTBEAT_STALE'
}
$producerProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $($producerStatus.pid)" -ErrorAction SilentlyContinue
if (!$producerProcess -or $producerProcess.Name -ne 'node.exe' `
  -or $producerProcess.CommandLine -notlike '*run-cru34-live-projection.mjs*') {
  throw 'CRU47_PRODUCER_PROCESS_NOT_VERIFIABLE'
}

$vendorPackagePath = Join-Path $SharedRoot 'node_modules\lightweight-charts\package.json'
$vendorBundlePath = Join-Path $SharedRoot 'node_modules\lightweight-charts\dist\lightweight-charts.standalone.production.js'
$vendorPackage = Get-Content -LiteralPath $vendorPackagePath -Raw | ConvertFrom-Json
if ($vendorPackage.version -ne '5.2.0') { throw "CRU47_CHART_VENDOR_VERSION_MISMATCH:$($vendorPackage.version)" }
if ((Get-Item -LiteralPath $vendorBundlePath -ErrorAction Stop).Length -le 0) { throw 'CRU47_CHART_VENDOR_BUNDLE_EMPTY' }

$envFile = Join-Path $SharedRoot '.env'
$passwordHashLine = Get-Content -LiteralPath $envFile -ErrorAction Stop | Where-Object { $_ -match '^\s*DASHBOARD_PASSWORD_HASH\s*=' } | Select-Object -Last 1
if (!$passwordHashLine) { throw 'CRU47_PASSWORD_HASH_NOT_AVAILABLE' }
$passwordHash = ($passwordHashLine -split '=', 2)[1].Trim().Trim('"').Trim("'")
if (!$passwordHash) { throw 'CRU47_PASSWORD_HASH_NOT_AVAILABLE' }

$instanceId = [guid]::NewGuid().ToString('N')
$randomBytes = New-Object byte[] 32
$rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
$rng.GetBytes($randomBytes)
$rng.Dispose()
$token = [Convert]::ToBase64String($randomBytes).TrimEnd('=').Replace('+', '-').Replace('/', '_')
$sha256 = [System.Security.Cryptography.SHA256]::Create()
$tokenDigest = $sha256.ComputeHash([System.Text.Encoding]::UTF8.GetBytes($token))
$sha256.Dispose()
$tokenHash = ([BitConverter]::ToString($tokenDigest)).Replace('-', '').ToLowerInvariant()
$origin = "http://127.0.0.1:$Port"
$stateRoot = Join-Path $root "data\runtime\cru47-owner-preview\$instanceId"
$logRoot = Join-Path $stateRoot 'logs'
New-Item -ItemType Directory -Force -Path $logRoot | Out-Null

$env:HOST = '127.0.0.1'
$env:PORT = [string]$Port
$env:NODE_ENV = 'development'
$env:TRUST_PROXY = '0'
$env:COOKIE_SECURE = '0'
$env:MOCK_DATA = 'false'
$env:REFRESH_INTERVAL_SECONDS = '0'
$env:DASHBOARD_PASSWORD_HASH = $passwordHash
$env:DASHBOARD_DATA_ROOT = $sharedDataRoot
$env:DASHBOARD_STATE_DIR = $stateRoot
$env:TX_CHART_DATA_ROOT = $sharedDataRoot
$env:TX_CHART_CACHE_ROOT = Join-Path $stateRoot 'dashboard-chart-cache'
$env:CRU34_LIVE_DATA_ROOT = $sharedDataRoot
$env:CRU34_LIVE_SNAPSHOT_PATH = $snapshotPath
$env:CRU34_LIVE_STATUS_PATH = $statusPath
$env:DASHBOARD_LIGHTWEIGHT_CHARTS_PATH = $vendorBundlePath
$env:DASHBOARD_LIGHTWEIGHT_CHARTS_PACKAGE_PATH = $vendorPackagePath
$env:DASHBOARD_PREVIEW_TYPE = 'CRU47_OWNER_PREVIEW'
$env:DASHBOARD_PREVIEW_BRANCH = $expectedBranch
$env:DASHBOARD_PREVIEW_DATA_MODE = 'GOVERNED_LOCAL_DATA'
$env:DASHBOARD_PREVIEW_AUTO_AUTH = '1'
$env:DASHBOARD_PREVIEW_INSTANCE_ID = $instanceId
$env:DASHBOARD_PREVIEW_EXPECTED_COMMIT = $expectedHead
$env:DASHBOARD_PREVIEW_BOOTSTRAP_SHA256 = $tokenHash
$env:DASHBOARD_PREVIEW_CANONICAL_ORIGIN = $origin
$env:DASHBOARD_PREVIEW_BOOTSTRAP_TTL_SECONDS = '60'
$env:DASHBOARD_PREVIEW_SESSION_TTL_MINUTES = '30'

$stdout = Join-Path $logRoot 'dashboard.log'
$stderr = Join-Path $logRoot 'dashboard-error.log'
$node = (Get-Command node.exe -ErrorAction Stop).Source
$process = Start-Process -FilePath $node -ArgumentList 'server.mjs' -WorkingDirectory $root `
  -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr -PassThru

foreach ($name in @('DASHBOARD_PREVIEW_BOOTSTRAP_SHA256', 'DASHBOARD_PASSWORD_HASH')) {
  Remove-Item "Env:$name" -ErrorAction SilentlyContinue
}

$healthUrl = "$origin/healthz"
$health = $null
$healthReady = $false
for ($attempt = 0; $attempt -lt 120; $attempt += 1) {
  Start-Sleep -Milliseconds 500
  try {
    $health = Invoke-RestMethod -Uri $healthUrl -Headers @{ Host = "127.0.0.1:$Port" } -TimeoutSec 5
    if ($health.ok -and $health.versionTruth.previewType -eq 'CRU47_OWNER_PREVIEW' `
      -and $health.versionTruth.exactHead -eq $expectedHead `
      -and $health.versionTruth.baseMainCommit -eq $approvedMain `
      -and $health.localPreviewAutoAuth.effective -eq $true `
      -and $health.localPreviewAutoAuth.instanceId -eq $instanceId) { $healthReady = $true; break }
  } catch { $health = $null }
}
if (!$healthReady) {
  if (!$process.HasExited) { Stop-Process -Id $process.Id -Force }
  throw "CRU47_PREVIEW_START_FAILED:$stderr"
}

$bootstrapUrl = "$origin/#preview-bootstrap=$token&instance=$instanceId&candidate=$expectedHead"
if (!$NoBrowser) { Start-Process -FilePath $bootstrapUrl }
[pscustomobject]@{
  ProcessId = $process.Id
  Port = $Port
  Origin = $origin
  Branch = $expectedBranch
  ExactHead = $expectedHead
  BaseMain = $approvedMain
  PreviewType = 'CRU47_OWNER_PREVIEW'
  AutoAuth = 'ENABLED_SINGLE_USE_60S'
  Session = 'ISOLATED_MEMORY_30M'
  StateRoot = $stateRoot
  Gate = 'BROWSER_ACCEPTANCE_REQUIRED'
  BootstrapUrl = '[REDACTED_SINGLE_USE_FRAGMENT]'
}

param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path

# Operational only: no Git mutation, preview, research runner, or execution route.
$dashboardUrl = 'http://127.0.0.1:8787'
$dashboardHealthUrl = "$dashboardUrl/healthz"
$bridgeHealthUrl = 'http://127.0.0.1:8790/health'
$launcherFile = Join-Path $ProjectRoot 'launcher.mjs'
$bridgeStarter = Join-Path $ProjectRoot 'scripts\start-shioaji-readonly-hidden.ps1'
$producerStarter = Join-Path $ProjectRoot 'scripts\start-cru34-live-projection-hidden.ps1'
$cru34DataRoot = Join-Path $ProjectRoot 'data'
$cru34ProjectionRoot = Join-Path $cru34DataRoot 'runtime\cru34-live'
$cru34SnapshotPath = Join-Path $cru34ProjectionRoot 'latest.json'
$cru34StatusPath = Join-Path $cru34ProjectionRoot 'status.json'
$logDir = Join-Path $ProjectRoot 'data\automation-logs\daily-use'
$lockPath = Join-Path $logDir 'daily-use-bootstrap.lock'
$script:ownsLock = $false

function Write-Status([string]$Message) {
  Write-Host "[Daily Dashboard] $Message"
}

function Stop-WithMessage([string]$Message) {
  Write-Status "Normal startup stopped: $Message"
  Write-Status 'The dashboard was not opened. Git, research, and Forward Shadow were not changed.'
  exit 1
}

function Test-HttpOk([string]$Url) {
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 15
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-DashboardHealth {
  try {
    $health = Invoke-RestMethod -Uri $dashboardHealthUrl -TimeoutSec 15
    if (($health.ok -ne $true) -or ($health.service -ne 'tw-chip-dashboard-v1')) { return $null }
    return $health
  } catch {
    return $null
  }
}

function Get-CurrentProjectCommit {
  $resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
  try {
    $commit = (& git -C $resolvedRoot -c "safe.directory=$resolvedRoot" rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
    if ($commit -notmatch '^[0-9a-f]{40}$') { return $null }
    return $commit
  } catch {
    return $null
  }
}

function Test-LoopbackPort([int]$Port) {
  $needle = "127.0.0.1:$Port"
  $lines = & netstat.exe -ano -p tcp 2>$null
  return [bool]($lines | Select-String -SimpleMatch $needle | Select-String -Pattern 'LISTENING')
}

function Get-LoopbackListenerPid([int]$Port) {
  $needle = "127.0.0.1:$Port"
  $line = & netstat.exe -ano -p tcp 2>$null |
    Where-Object { $_ -like "*$needle*" -and $_ -match 'LISTENING' } |
    Select-Object -First 1
  if (-not $line) { return $null }
  $parts = @($line -split '\s+' | Where-Object { $_ })
  if ($parts.Count -lt 5) { return $null }
  $listenerPid = 0
  if (-not [int]::TryParse($parts[-1], [ref]$listenerPid)) { return $null }
  return $listenerPid
}

function Get-BridgeStatus {
  try {
    $health = Invoke-RestMethod -Uri $bridgeHealthUrl -TimeoutSec 2
    $safe = ($health.ok -eq $true) -and
      ($health.mode -eq 'market_data_only') -and
      ($health.formalWeight -eq 0) -and
      ($health.researchOnly -eq $true) -and
      ($health.executionAuthorized -eq $false) -and
      ($health.orderRoutesEnabled -eq $false)
    if (-not $safe) {
      return [pscustomobject]@{ State = 'UNSAFE_OR_INVALID'; Detail = 'The market-data-only safety check did not pass.'; Health = $health }
    }
    $degraded = ([int]$health.callbackErrors -gt 0) -or ([int]$health.writerErrors -gt 0) -or
      ([int]$health.dropped -gt 0) -or ($health.sessionDown -eq $true) -or
      ($health.bridgeState -ne 'HEALTHY') -or ($health.quoteTypeDeliveryState -eq 'PARTIAL')
    $state = if ($degraded) { 'DEGRADED' } else { 'CONNECTED' }
    $detail = if ($degraded) { 'Read-only market data is connected with health warnings; the dashboard can use current legal data.' } else { 'Read-only market data is connected.' }
    return [pscustomobject]@{ State = $state; Detail = $detail; Health = $health }
  } catch {
    return [pscustomobject]@{ State = 'OFFLINE'; Detail = 'Read-only market data is unavailable; the dashboard can use current legal data.'; Health = $null }
  }
}

function Get-MarketSessionLabel([DateTimeOffset]$Now = [DateTimeOffset]::UtcNow) {
  $taipei = [TimeZoneInfo]::ConvertTimeBySystemTimeZoneId($Now, 'Taipei Standard Time')
  if ($taipei.DayOfWeek -in @([DayOfWeek]::Saturday, [DayOfWeek]::Sunday)) { return 'Weekend or non-trading day (informational only)' }
  $time = $taipei.TimeOfDay
  if ($time -ge [TimeSpan]::FromHours(8.75) -and $time -lt [TimeSpan]::FromHours(13.75)) { return 'Day session' }
  if ($time -ge [TimeSpan]::FromHours(15) -or $time -lt [TimeSpan]::FromHours(5)) { return 'Night session' }
  if ($time -lt [TimeSpan]::FromHours(8.75)) { return 'Pre-market' }
  return 'After market'
}

function Enter-LaunchLock {
  New-Item -ItemType Directory -Force -Path $logDir | Out-Null
  if (Test-Path -LiteralPath $lockPath) {
    $existing = $null
    try { $existing = Get-Content -LiteralPath $lockPath -Raw | ConvertFrom-Json } catch { }
    $isActive = $false
    if ($existing -and $existing.pid) {
      try { Get-Process -Id ([int]$existing.pid) -ErrorAction Stop | Out-Null; $isActive = $true } catch { }
    }
    if ($isActive) {
      Write-Status 'A normal startup is already running; the repeated click was safely ignored.'
      exit 0
    }
    # This lock belongs only to this launcher and can be replaced once its PID is stale.
    Remove-Item -LiteralPath $lockPath -Force
  }
  @{ pid = $PID; startedAt = (Get-Date).ToString('o'); purpose = 'daily-use-bootstrap-v1' } |
    ConvertTo-Json -Compress | Set-Content -LiteralPath $lockPath -Encoding utf8
  $script:ownsLock = $true
}

function Test-DashboardLaunchReady($Health, [string]$ExpectedCommit) {
  return (Test-DashboardIdentityAligned $Health $ExpectedCommit) -and
    ($Health.runtimeEvidence.producer.ready -eq $true) -and
    ($Health.runtimeEvidence.observedFlow.ready -eq $true) -and
    ($Health.runtimeEvidence.parity.ready -eq $true)
}

function Test-DashboardIdentityAligned($Health, [string]$ExpectedCommit) {
  return $Health -and ($Health.runtimeIdentityStatus -eq 'VERIFIED') -and
    ($Health.runtimeCommit -eq $ExpectedCommit) -and
    ($Health.approvedMainCommit -eq $ExpectedCommit) -and
    ($Health.syncState -eq 'SYNCED')
}

function Start-FormalDashboard([string]$ExpectedCommit) {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $logDir 'dashboard-launcher.log'
  $stderr = Join-Path $logDir 'dashboard-launcher-error.log'
  Start-Process -FilePath $node -ArgumentList 'launcher.mjs' -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  $deadline = (Get-Date).AddSeconds(60)
  do {
    Start-Sleep -Milliseconds 500
    $health = Get-DashboardHealth
    if (Test-DashboardLaunchReady $health $ExpectedCommit) { return $true }
  } while ((Get-Date) -lt $deadline)
  return $false
}

function Restart-FormalDashboard($Health, [string]$ExpectedCommit) {
  $worker = $Health.runtimeEvidence.producer.worker
  $belongsToProject = (Test-SamePath $worker.dataRoot $cru34DataRoot) -and
    (Test-SamePath $worker.projectionRoot $cru34ProjectionRoot) -and
    (Test-SamePath $worker.snapshotPath $cru34SnapshotPath) -and
    (Test-SamePath $worker.statusPath $cru34StatusPath)
  if (-not $belongsToProject) { throw 'FORMAL_DASHBOARD_PROJECT_IDENTITY_UNVERIFIED' }
  $listenerPid = Get-LoopbackListenerPid 8787
  if (-not $listenerPid) { throw 'FORMAL_DASHBOARD_LISTENER_PID_UNVERIFIED' }
  $listener = Get-Process -Id $listenerPid -ErrorAction SilentlyContinue
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  if (-not $listener -or -not (Test-SamePath $listener.Path $node)) {
    throw 'FORMAL_DASHBOARD_PROCESS_IDENTITY_UNVERIFIED'
  }
  Stop-Process -Id $listenerPid
  foreach ($attempt in 1..20) {
    Start-Sleep -Milliseconds 250
    if (-not (Test-LoopbackPort 8787)) { break }
  }
  if (Test-LoopbackPort 8787) { throw 'FORMAL_DASHBOARD_RESTART_STOP_TIMEOUT' }
  return Start-FormalDashboard $ExpectedCommit
}

function Test-SamePath([string]$Left, [string]$Right) {
  if (-not $Left -or -not $Right) { return $false }
  try {
    return [System.IO.Path]::GetFullPath($Left).TrimEnd('\') -eq [System.IO.Path]::GetFullPath($Right).TrimEnd('\')
  } catch { return $false }
}

try {
  Enter-LaunchLock
  Write-Status 'Preparing the normal environment.'

  if (-not (Test-Path -LiteralPath $ProjectRoot -PathType Container)) { Stop-WithMessage 'The project folder is missing.' }
  if (-not (Test-Path -LiteralPath $launcherFile -PathType Leaf)) { Stop-WithMessage 'The formal dashboard launcher is missing.' }
  if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot '.env') -PathType Leaf)) { Stop-WithMessage 'Local dashboard setup is incomplete.' }
  try { Get-Command node.exe -ErrorAction Stop | Out-Null } catch { Stop-WithMessage 'Node.js is not available.' }

  Write-Status "Market session: $(Get-MarketSessionLabel)"
  Write-Status 'Market data refresh uses the dashboard startup and configured official-source interval; it does not run a full daily pipeline or rebuild history.'

  $expectedRuntimeCommit = Get-CurrentProjectCommit
  if (-not $expectedRuntimeCommit) { Stop-WithMessage 'The approved local runtime identity could not be verified.' }

  $env:CRU34_LIVE_DATA_ROOT = $cru34DataRoot
  $env:CRU34_LIVE_SNAPSHOT_PATH = $cru34SnapshotPath
  $env:CRU34_LIVE_STATUS_PATH = $cru34StatusPath
  if (-not (Test-Path -LiteralPath $producerStarter -PathType Leaf)) {
    Stop-WithMessage 'The governed CRU34 live producer launcher is missing.'
  }
  Write-Status 'Ensuring the governed CRU34 live producer is ready.'
  & $producerStarter -DataRoot $cru34DataRoot -ProjectionRoot $cru34ProjectionRoot `
    -WorkingRoot $ProjectRoot -RestartMismatched

  $dashboardHealth = Get-DashboardHealth
  if ($dashboardHealth) {
    if (($dashboardHealth.runtimeIdentityStatus -ne 'VERIFIED') -or (-not $dashboardHealth.runtimeCommit)) {
      Stop-WithMessage 'The running 8787 service cannot prove which code version it loaded. A governed formal restart is required.'
    }
    if (Test-DashboardLaunchReady $dashboardHealth $expectedRuntimeCommit) {
      Write-Status 'Formal dashboard 8787 is already healthy and will be reused.'
    } elseif (Test-DashboardIdentityAligned $dashboardHealth $expectedRuntimeCommit) {
      Stop-WithMessage 'The formal dashboard identity is aligned, but the live readiness contract did not pass.'
    } else {
      if ($dashboardHealth.runtimeCommit -ne $expectedRuntimeCommit) {
        Write-Status "The running 8787 service loaded $($dashboardHealth.runtimeCommit), but the approved local code is $expectedRuntimeCommit."
      }
      Write-Status 'Restarting the governed formal dashboard to align approved-main identity and live paths.'
      if (-not (Restart-FormalDashboard $dashboardHealth $expectedRuntimeCommit)) {
        Stop-WithMessage 'The governed formal dashboard restart did not reach the approved readiness contract.'
      }
      Write-Status 'Formal dashboard restarted.'
    }
  } elseif (Test-LoopbackPort 8787) {
    Stop-WithMessage 'Port 8787 is occupied by a service that does not pass its health check. It was not replaced.'
  } else {
    Write-Status 'Starting formal dashboard 8787.'
    if (-not (Start-FormalDashboard $expectedRuntimeCommit)) { Stop-WithMessage 'The formal dashboard did not become healthy in time. See data/automation-logs/daily-use.' }
    Write-Status 'Formal dashboard started.'
  }

  $bridge = Get-BridgeStatus
  if ($bridge.State -eq 'UNSAFE_OR_INVALID') { Stop-WithMessage 'A service on 8790 did not satisfy the market-data-only safety boundary.' }
  if (($bridge.State -eq 'OFFLINE') -and -not (Test-LoopbackPort 8790) -and (Test-Path -LiteralPath $bridgeStarter -PathType Leaf)) {
    Write-Status 'Starting the existing read-only market-data bridge.'
    & $bridgeStarter
    foreach ($attempt in 1..20) {
      Start-Sleep -Milliseconds 500
      $bridge = Get-BridgeStatus
      if ($bridge.State -ne 'OFFLINE') { break }
    }
  }
  if ($bridge.State -eq 'UNSAFE_OR_INVALID') { Stop-WithMessage 'The read-only market-data bridge did not satisfy its safety boundary.' }
  Write-Status "Market data bridge: $($bridge.Detail)"

  $dailyStatusPath = Join-Path $ProjectRoot 'v2\reports\v3-daily-update-status.json'
  if (Test-Path -LiteralPath $dailyStatusPath) {
    try {
      $daily = Get-Content -LiteralPath $dailyStatusPath -Raw | ConvertFrom-Json
      Write-Status "Last existing batch status: $($daily.state). This shortcut does not rerun it."
    } catch { Write-Status 'Last existing batch status could not be read. Dashboard startup can continue.' }
  } else {
    Write-Status 'No existing batch status is available yet. Dashboard startup can continue.'
  }

  $dashboardState = if ($bridge.State -in @('CONNECTED', 'DEGRADED')) { 'READY' } else { 'DEGRADED' }
  Write-Status 'NORMAL ENVIRONMENT READY'
  Write-Status 'Code: CURRENT LOCAL APPROVED VERSION'
  Write-Status "Market Data: $($bridge.State)"
  Write-Status "Dashboard: $dashboardState"
  Write-Status 'Execution: DISABLED (executionAuthorized=false; orderRoutesEnabled=false)'

  if (-not $NoBrowser) {
    Start-Process $dashboardUrl
    Write-Status 'Opening browser: http://127.0.0.1:8787'
  }
  exit 0
} catch {
  Stop-WithMessage $_.Exception.Message
} finally {
  if ($script:ownsLock -and (Test-Path -LiteralPath $lockPath)) {
    Remove-Item -LiteralPath $lockPath -Force -ErrorAction SilentlyContinue
  }
}

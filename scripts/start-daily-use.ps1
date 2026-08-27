param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent),
  [switch]$NoBrowser
)

$ErrorActionPreference = 'Stop'

# Operational only: no Git mutation, preview, research runner, or execution route.
$dashboardUrl = 'http://127.0.0.1:8787'
$dashboardHealthUrl = "$dashboardUrl/healthz"
$bridgeHealthUrl = 'http://127.0.0.1:8790/health'
$launcherFile = Join-Path $ProjectRoot 'launcher.mjs'
$bridgeStarter = Join-Path $PSScriptRoot 'start-shioaji-readonly-hidden.ps1'
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
    $response = Invoke-WebRequest -UseBasicParsing -Uri $Url -TimeoutSec 2
    return $response.StatusCode -eq 200
  } catch {
    return $false
  }
}

function Get-DashboardHealth {
  try {
    $health = Invoke-RestMethod -Uri $dashboardHealthUrl -TimeoutSec 2
    if (($health.ok -ne $true) -or ($health.service -ne 'tw-chip-dashboard-v1')) { return $null }
    return $health
  } catch {
    return $null
  }
}

function Get-CurrentProjectCommit {
  $resolvedRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
  try {
    $commit = (& git -c "safe.directory=$resolvedRoot" rev-parse HEAD 2>$null).Trim().ToLowerInvariant()
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

function Start-FormalDashboard {
  $node = (Get-Command node.exe -ErrorAction Stop).Source
  $stdout = Join-Path $logDir 'dashboard-launcher.log'
  $stderr = Join-Path $logDir 'dashboard-launcher-error.log'
  Start-Process -FilePath $node -ArgumentList 'launcher.mjs' -WorkingDirectory $ProjectRoot `
    -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError $stderr
  foreach ($attempt in 1..40) {
    Start-Sleep -Milliseconds 500
    if (Test-HttpOk $dashboardHealthUrl) { return $true }
  }
  return $false
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
  $dashboardHealth = Get-DashboardHealth
  if ($dashboardHealth) {
    if (($dashboardHealth.runtimeIdentityStatus -ne 'VERIFIED') -or (-not $dashboardHealth.runtimeCommit)) {
      Stop-WithMessage 'The running 8787 service cannot prove which code version it loaded. A governed formal restart is required.'
    }
    if ($dashboardHealth.runtimeCommit -ne $expectedRuntimeCommit) {
      Stop-WithMessage "The running 8787 service loaded $($dashboardHealth.runtimeCommit), but the approved local code is $expectedRuntimeCommit. A governed formal restart is required."
    }
    Write-Status 'Formal dashboard 8787 is already healthy and will be reused.'
  } elseif (Test-LoopbackPort 8787) {
    Stop-WithMessage 'Port 8787 is occupied by a service that does not pass its health check. It was not replaced.'
  } else {
    Write-Status 'Starting formal dashboard 8787.'
    if (-not (Start-FormalDashboard)) { Stop-WithMessage 'The formal dashboard did not become healthy in time. See data/automation-logs/daily-use.' }
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

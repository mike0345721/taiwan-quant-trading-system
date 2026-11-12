# Daily launcher + watchdog (Windows PowerShell 5.1).
# Every IntervalSeconds: start whichever of Bridge / Producer / Dashboard is missing,
# then write one status line to a log file that rotates daily.
# Roles are spawned through WMI so they survive the tool/shell that started this script.
param(
  [string]$Root = (Split-Path $PSScriptRoot -Parent),
  [string]$ResearchRoot = 'D:\Taiwan stock\standalone-v1\v2',
  # The broker credentials live next to this starter; it is the same one the P0 automation uses.
  [string]$BridgeStarter = 'D:\Taiwan stock\standalone-v1\scripts\start-shioaji-readonly-hidden.ps1',
  [int]$BridgePort = 8790,
  [int]$DashboardPort = 8787,
  [ValidateRange(1,3600)][int]$IntervalSeconds = 60,
  [int]$BridgeWaitSeconds = 180,
  [int]$DashboardGraceSeconds = 90,
  [string]$Node = '',
  [string]$ProducerScript = '',
  [string]$DashboardScript = '',
  [string]$EnvFile = '',
  [string]$StatusPath = '',
  [string]$LogDir = '',
  [string]$MutexName = 'Global\TwChipStartDailyV2',
  # 0 = run forever. Tests pass a small number.
  [int]$Ticks = 0
)
$ErrorActionPreference = 'Stop'
if ($PSVersionTable.PSEdition -ne 'Desktop') {
  throw 'START_DAILY_REQUIRES_WINDOWS_POWERSHELL_51: use C:\Windows\System32\WindowsPowerShell\v1.0\powershell.exe'
}

if (-not $Node) { $Node = (Get-Command node.exe).Source }
if (-not $ProducerScript) { $ProducerScript = Join-Path $Root 'scripts\run-cru34-live-projection.mjs' }
if (-not $DashboardScript) { $DashboardScript = Join-Path $Root 'server.mjs' }
if (-not $EnvFile) { $EnvFile = Join-Path $Root '.env' }
$dataRoot = Join-Path $Root 'data'
$projectionRoot = Join-Path $dataRoot 'runtime\cru34-live'
if (-not $StatusPath) { $StatusPath = Join-Path $projectionRoot 'status.json' }
if (-not $LogDir) { $LogDir = Join-Path $dataRoot 'automation-logs\daily' }
New-Item -ItemType Directory -Force -Path $LogDir | Out-Null

function Get-Today { (Get-Date).ToString('yyyy-MM-dd') }

function Write-DailyLog([string]$Line) {
  $text = (Get-Date).ToString('yyyy-MM-ddTHH:mm:sszzz') + ' ' + $Line + "`r`n"
  try { [IO.File]::AppendAllText((Join-Path $LogDir ('start-daily-' + (Get-Today) + '.log')), $text, [Text.Encoding]::UTF8) } catch { }
}

function Test-DailyHttp([string]$Url) {
  try {
    $request = [Net.HttpWebRequest]::Create($Url)
    $request.Proxy = $null
    $request.Timeout = 5000
    $response = $request.GetResponse()
    $ok = [int]$response.StatusCode -eq 200
    $response.Close()
    return $ok
  } catch { return $false }
}

function Get-DailyNode([string]$ScriptPath) {
  # Match node.exe processes whose command line names this exact script.
  $needle = $ScriptPath.ToLowerInvariant()
  @(Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
    Where-Object { $_.CommandLine -and $_.CommandLine.ToLowerInvariant().Contains($needle) })
}

function Start-DailyDetached([string]$CommandLine) {
  $startup = New-CimInstance -ClassName Win32_ProcessStartup -ClientOnly -Property @{ ShowWindow = [uint16]0 }
  $result = Invoke-CimMethod -ClassName Win32_Process -MethodName Create -Arguments @{
    CommandLine = $CommandLine; CurrentDirectory = $Root; ProcessStartupInformation = $startup }
  if ($result.ReturnValue -ne 0) { throw "SPAWN_FAILED_$($result.ReturnValue)" }
  return [int]$result.ProcessId
}

function Get-RoleEnv {
  # Same producer paths the previous launcher passed to both roles.
  [ordered]@{
    CRU34_LIVE_DATA_ROOT = $dataRoot
    CRU34_LIVE_PROJECTION_ROOT = $projectionRoot
    CRU34_LIVE_SNAPSHOT_PATH = (Join-Path $projectionRoot 'latest.json')
    CRU34_LIVE_STATUS_PATH = (Join-Path $projectionRoot 'status.json')
  }
}

function New-NodeCommand([System.Collections.IDictionary]$Vars, [string]$NodeArgs, [string]$Role) {
  $sets = ($Vars.Keys | ForEach-Object { 'set "' + $_ + '=' + $Vars[$_] + '"' }) -join ' && '
  $log = Join-Path $LogDir ($Role + '-' + (Get-Today) + '.log')
  return 'cmd.exe /d /s /c "' + $sets + ' && "' + $Node + '" ' + $NodeArgs + ' >> "' + $log + '" 2>&1"'
}

function Read-ProducerStatus {
  try {
    $raw = [IO.File]::ReadAllText($StatusPath)
    $status = $raw | ConvertFrom-Json
    $age = [int]([datetime]::UtcNow - [datetime]::Parse($status.observedAt).ToUniversalTime()).TotalSeconds
    $truth = if ($age -le 30) { $status.truthState } else { 'STALE' }
    return "$truth,${age}s"
  } catch {
    # A half-written or locked status file is normal while the producer writes; try again next tick.
    return 'status-unreadable'
  }
}

$script:bridgeStartedAt = $null
$script:dashboardStartedAt = $null

function Invoke-DailyTick {
  $actions = @()

  # Bridge: start through the existing starter; never start a second one while it is coming up.
  $bridgeUp = Test-DailyHttp "http://127.0.0.1:$BridgePort/health"
  if ($bridgeUp) { $bridge = 'UP'; $script:bridgeStartedAt = $null }
  elseif ($script:bridgeStartedAt -and ((Get-Date) - $script:bridgeStartedAt).TotalSeconds -lt $BridgeWaitSeconds) {
    $bridge = 'STARTING(' + [int]((Get-Date) - $script:bridgeStartedAt).TotalSeconds + 's)'
  } else {
    if ($script:bridgeStartedAt) { $actions += 'bridge-start-timeout' }
    try {
      $null = Start-DailyDetached ('powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + $BridgeStarter + '"')
      $script:bridgeStartedAt = Get-Date
      $bridge = 'DOWN'; $actions += 'bridge-started'
    } catch { $bridge = 'DOWN'; $actions += ('bridge-start-error:' + $_.Exception.Message) }
  }

  # Producer: its own worker.lock prevents duplicates; we only check whether one is running.
  $checkFailed = $false
  try { $producers = @(Get-DailyNode $ProducerScript) } catch { $checkFailed = $true; $actions += 'producer-process-check-failed' }
  if ($checkFailed) { $producer = 'UNKNOWN' }
  elseif ($producers.Count -gt 0) { $producer = 'RUNNING(pid ' + (($producers | ForEach-Object { $_.ProcessId }) -join ',') + ')' }
  else {
    try {
      $null = Start-DailyDetached (New-NodeCommand (Get-RoleEnv) ('"' + $ProducerScript + '"') 'producer')
      $producer = 'MISSING'; $actions += 'producer-started'
    } catch { $producer = 'MISSING'; $actions += ('producer-start-error:' + $_.Exception.Message) }
  }
  $producer += ' ' + (Read-ProducerStatus)

  # Dashboard: start when /healthz does not answer, unless we started one moments ago.
  if (Test-DailyHttp "http://127.0.0.1:$DashboardPort/healthz") { $dashboard = 'UP'; $script:dashboardStartedAt = $null }
  elseif ($script:dashboardStartedAt -and ((Get-Date) - $script:dashboardStartedAt).TotalSeconds -lt $DashboardGraceSeconds) {
    $dashboard = 'STARTING(' + [int]((Get-Date) - $script:dashboardStartedAt).TotalSeconds + 's)'
  } else {
    $vars = Get-RoleEnv
    $vars['HOST'] = '127.0.0.1'
    $vars['PORT'] = [string]$DashboardPort
    $vars['V2_RESEARCH_DATABASE_PATH'] = Join-Path $ResearchRoot 'data\research-v2.sqlite'
    $vars['V2_BACKTEST_REPORT_PATH'] = Join-Path $ResearchRoot 'reports\latest-backtest.json'
    $envArg = if (Test-Path -LiteralPath $EnvFile) { '--env-file="' + $EnvFile + '" ' } else { '' }
    try {
      $null = Start-DailyDetached (New-NodeCommand $vars ($envArg + '"' + $DashboardScript + '"') 'dashboard')
      $script:dashboardStartedAt = Get-Date
      $dashboard = 'DOWN'; $actions += 'dashboard-started'
    } catch { $dashboard = 'DOWN'; $actions += ('dashboard-start-error:' + $_.Exception.Message) }
  }

  $line = "bridge=$bridge producer=$producer dashboard=$dashboard"
  if ($actions.Count) { $line += ' | ' + ($actions -join ' ') }
  Write-DailyLog $line
}

# Only one start-daily at a time.
$mutex = New-Object Threading.Mutex($false, $MutexName)
$owned = $false
try { $owned = $mutex.WaitOne(0) } catch [Threading.AbandonedMutexException] { $owned = $true }
if (-not $owned) {
  Write-DailyLog 'ALREADY_RUNNING: another start-daily owns the watchdog; exiting.'
  Write-Output 'ALREADY_RUNNING'
  exit 0
}
try {
  Write-DailyLog "WATCHDOG_START pid=$PID root=$Root"
  $count = 0
  while ($true) {
    try { Invoke-DailyTick } catch { Write-DailyLog ('TICK_ERROR ' + $_.Exception.Message) }
    $count++
    if ($Ticks -gt 0 -and $count -ge $Ticks) { break }
    Start-Sleep -Seconds $IntervalSeconds
  }
} finally {
  $mutex.ReleaseMutex()
  $mutex.Dispose()
}

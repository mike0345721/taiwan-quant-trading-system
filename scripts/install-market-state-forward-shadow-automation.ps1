param(
  [switch]$Install,
  [string]$ReadyManifestPath = '',
  [string]$OwnerApprovalPath = '',
  [string]$TradingCalendarPath = '',
  [string]$OutcomeTime = '14:00'
)

$ErrorActionPreference = 'Stop'
$stateTaskName = 'TwChipDashboard-MarketStateForwardShadow-State'
$outcomeTaskName = 'TwChipDashboard-MarketStateForwardShadow-Outcome'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-market-state-forward-shadow-hidden.ps1'
$validator = Join-Path $PSScriptRoot 'validate-market-state-forward-shadow-launch.mjs'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$definition = [ordered]@{
  lifecycle = 'STATE -> OUTCOME -> DAILY_COMPLETE'
  stateTask = [ordered]@{
    taskName = $stateTaskName
    phase = 'STATE'
    schedule = '08:25 Asia/Taipei'
    executable = $powershell
    nodeExecutable = $node
    wrapper = $runner
    workingDirectory = $projectRoot
    multipleInstances = 'IgnoreNew'
    wakeToRun = $true
  }
  outcomeTask = [ordered]@{
    taskName = $outcomeTaskName
    phase = 'OUTCOME'
    schedule = '14:00 Asia/Taipei'
    scheduleStatus = 'OWNER_APPROVED_OPERATIONAL_COLLECTION_TIME'
    frozenObservationWindowEnd = '13:45 Asia/Taipei'
    executable = $powershell
    nodeExecutable = $node
    wrapper = $runner
    workingDirectory = $projectRoot
    multipleInstances = 'IgnoreNew'
    wakeToRun = $true
  }
  tradingDaySourceStatus = 'OWNER_APPROVED_IMMUTABLE_SNAPSHOT'
  installBlocked = $false
  installBlockers = @()
  executable = $powershell
  nodeExecutable = $node
  wrapper = $runner
  workingDirectory = $projectRoot
  multipleInstances = 'IgnoreNew'
  wakeToRun = $true
  formalSchedulerEnabled = $false
  executionAuthorized = $false
}

if (-not $Install) {
  $definition | ConvertTo-Json -Depth 4
  exit 0
}

if ([string]::IsNullOrWhiteSpace($TradingCalendarPath)) {
  $TradingCalendarPath = Join-Path $projectRoot 'config\taifex-official-calendar-2026.json'
}

if ([string]::IsNullOrWhiteSpace($ReadyManifestPath)) { throw 'FORWARD_SHADOW_READY_MANIFEST_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($OwnerApprovalPath)) { throw 'FORWARD_SHADOW_OWNER_APPROVAL_ARTIFACT_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($TradingCalendarPath)) { throw 'FORWARD_SHADOW_TRADING_CALENDAR_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($OutcomeTime)) { throw 'FORWARD_SHADOW_OUTCOME_SCHEDULER_TIME_OWNER_DECISION_REQUIRED' }
if ($OutcomeTime -notmatch '^\d{2}:\d{2}$') { throw 'FORWARD_SHADOW_OUTCOME_SCHEDULER_TIME_INVALID' }
$outcomeTimeValue = [TimeSpan]::ParseExact($OutcomeTime, 'hh\:mm', $null)
if ($outcomeTimeValue -le [TimeSpan]::ParseExact('13:45', 'hh\:mm', $null)) { throw 'FORWARD_SHADOW_OUTCOME_SCHEDULER_BEFORE_FROZEN_WINDOW_END' }

$resolvedManifest = (Resolve-Path -LiteralPath $ReadyManifestPath).Path
$resolvedApproval = (Resolve-Path -LiteralPath $OwnerApprovalPath).Path
$resolvedCalendar = (Resolve-Path -LiteralPath $TradingCalendarPath).Path
& $node $validator --launch-manifest $resolvedManifest --owner-approval $resolvedApproval | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'FORWARD_SHADOW_LAUNCH_VALIDATION_FAILED' }
$manifest = Get-Content -Raw -LiteralPath $resolvedManifest | ConvertFrom-Json
if ($manifest.schedulerTime -ne '08:25 Asia/Taipei') { throw 'FORWARD_SHADOW_STATE_SCHEDULER_TIME_MISMATCH' }
if ($manifest.outcomeSchedulerTime -ne "$OutcomeTime Asia/Taipei") { throw 'FORWARD_SHADOW_OUTCOME_SCHEDULER_TIME_MISMATCH' }

$common = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Mode FORWARD_SHADOW -LaunchManifestPath `"$resolvedManifest`" -OwnerApprovalPath `"$resolvedApproval`" -TradingCalendarPath `"$resolvedCalendar`""
$stateAction = New-ScheduledTaskAction -Execute $powershell -Argument "$common -Phase STATE" -WorkingDirectory $projectRoot
$outcomeAction = New-ScheduledTaskAction -Execute $powershell -Argument "$common -Phase OUTCOME" -WorkingDirectory $projectRoot
$stateTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:25'
$outcomeTrigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At $OutcomeTime
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $stateTaskName -Action $stateAction -Trigger $stateTrigger -Settings $settings -Description 'Owner-approved Market State Forward Shadow STATE; executionAuthorized=false.' | Out-Null
Register-ScheduledTask -TaskName $outcomeTaskName -Action $outcomeAction -Trigger $outcomeTrigger -Settings $settings -Description 'Owner-approved Market State Forward Shadow OUTCOME; executionAuthorized=false.' | Out-Null

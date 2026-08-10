param(
  [switch]$Install,
  [switch]$OwnerApproved,
  [string]$ReadyManifestPath = ''
)

$ErrorActionPreference = 'Stop'
$taskName = 'TwChipDashboard-MarketStateForwardShadow'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-market-state-forward-shadow-hidden.ps1'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$definition = [ordered]@{
  taskName = $taskName
  schedule = 'Monday-Friday 08:25 Asia/Taipei'
  executable = $powershell
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

if (-not $OwnerApproved) { throw 'FORWARD_SHADOW_OWNER_APPROVAL_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($ReadyManifestPath)) { throw 'FORWARD_SHADOW_READY_MANIFEST_REQUIRED' }
$manifest = Get-Content -Raw -LiteralPath $ReadyManifestPath | ConvertFrom-Json
if ($manifest.launchStatus -ne 'READY_FOR_LAUNCH' -or $manifest.executionAuthorized -ne $false) {
  throw 'FORWARD_SHADOW_READY_MANIFEST_INVALID'
}

$action = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Mode NOT_ACTIVE" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:25'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Market State Forward Shadow candidate. Disabled until separate Owner launch approval; executionAuthorized=false.' | Out-Null
Disable-ScheduledTask -TaskName $taskName | Out-Null

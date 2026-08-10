param(
  [switch]$Install,
  [string]$ReadyManifestPath = '',
  [string]$OwnerApprovalPath = ''
)

$ErrorActionPreference = 'Stop'
$taskName = 'TwChipDashboard-MarketStateForwardShadow'
$projectRoot = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-market-state-forward-shadow-hidden.ps1'
$validator = Join-Path $PSScriptRoot 'validate-market-state-forward-shadow-launch.mjs'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$definition = [ordered]@{
  taskName = $taskName
  schedule = 'Monday-Friday 08:25 Asia/Taipei'
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

if ([string]::IsNullOrWhiteSpace($ReadyManifestPath)) { throw 'FORWARD_SHADOW_READY_MANIFEST_REQUIRED' }
if ([string]::IsNullOrWhiteSpace($OwnerApprovalPath)) { throw 'FORWARD_SHADOW_OWNER_APPROVAL_ARTIFACT_REQUIRED' }
$resolvedManifest = (Resolve-Path -LiteralPath $ReadyManifestPath).Path
$resolvedApproval = (Resolve-Path -LiteralPath $OwnerApprovalPath).Path
& $node $validator --launch-manifest $resolvedManifest --owner-approval $resolvedApproval | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'FORWARD_SHADOW_LAUNCH_VALIDATION_FAILED' }

$action = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -Mode FORWARD_SHADOW -LaunchManifestPath `"$resolvedManifest`" -OwnerApprovalPath `"$resolvedApproval`"" `
  -WorkingDirectory $projectRoot
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:25'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 8) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Owner-approved Market State research Forward Shadow; no broker/order route; executionAuthorized=false.' | Out-Null

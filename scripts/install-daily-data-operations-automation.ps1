param(
  [ValidateSet('Validate','Install','Remove')][string]$Mode = 'Validate',
  [switch]$CandidateTest,
  [switch]$OwnerFormalActivationAuthorized,
  [Parameter(Mandatory)][string]$TaskPrefix,
  [Parameter(Mandatory)][string]$DataRoot,
  [Parameter(Mandatory)][string]$OutputRoot,
  [Parameter(Mandatory)][string]$ManifestPath,
  [Parameter(Mandatory)][string]$EvidenceRoot,
  [Parameter(Mandatory)][string]$CalendarPath,
  [string]$DayCheckpointTime = '',
  [string]$EodCheckpointTime = '',
  [string]$FinalCheckpointTime = '',
  [string]$TradeDate = ''
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$runner = Join-Path $PSScriptRoot 'run-daily-data-operations-hidden.ps1'
$validator = Join-Path $PSScriptRoot 'run-daily-data-operations-acceptance.mjs'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$node = (Get-Command node.exe -ErrorAction Stop).Source
$userId = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$userSid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
if ($CandidateTest) {
  if ($TaskPrefix -notmatch '^TWQuant-CRU52-A2B-Test-[A-Za-z0-9-]+$') { throw 'OPERATIONS_TEST_TASK_ID_INVALID' }
  if ($TradeDate -notmatch '^\d{4}-\d{2}-\d{2}$') { throw 'OPERATIONS_TEST_DATE_REQUIRED' }
  $runMode = 'CANDIDATE_SCHEDULER_TEST'
} else {
  if ($TaskPrefix -ne 'TWQuant-DataOperations') { throw 'OPERATIONS_FORMAL_TASK_ID_INVALID' }
  if ($TradeDate) { throw 'OPERATIONS_FORMAL_REPLAY_REJECTED' }
  if ($Mode -ne 'Validate' -and -not $OwnerFormalActivationAuthorized) { throw 'OPERATIONS_OWNER_FORMAL_GATE_REQUIRED' }
  $runMode = 'SCHEDULED'
}
foreach ($value in @($DayCheckpointTime, $EodCheckpointTime, $FinalCheckpointTime)) {
  if ($value -notmatch '^([01]\d|2[0-3]):[0-5]\d$') { throw 'OPERATIONS_EXPLICIT_SCHEDULE_TIME_REQUIRED' }
}
foreach ($value in @($DataRoot,$OutputRoot,$ManifestPath,$EvidenceRoot,$CalendarPath,$runner,$root)) {
  if ($value -match '["`\r\n]' -or -not [System.IO.Path]::IsPathRooted($value)) { throw 'OPERATIONS_TASK_PATH_INVALID' }
}
$tasks = @(
  @{ Suffix = 'DAY'; Checkpoint = 'DAY_CHECKPOINT'; Time = $DayCheckpointTime },
  @{ Suffix = 'EOD'; Checkpoint = 'EOD_CHECKPOINT'; Time = $EodCheckpointTime },
  @{ Suffix = 'FINAL'; Checkpoint = 'FINAL_TRADEDATE_CHECKPOINT'; Time = $FinalCheckpointTime }
)
$definitions = @()
foreach ($entry in $tasks) {
  $name = "$TaskPrefix-$($entry.Suffix)"
  & $node $validator "--data-root=$DataRoot" "--output-root=$OutputRoot" "--manifest=$ManifestPath" `
    "--evidence-root=$EvidenceRoot" "--calendar=$CalendarPath" "--checkpoint=$($entry.Checkpoint)" `
    "--run-mode=$runMode" '--validate-only=true' | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'OPERATIONS_TASK_PATH_VALIDATION_FAILED' }
  $arguments = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`" -DataRoot `"$DataRoot`" -OutputRoot `"$OutputRoot`" -ManifestPath `"$ManifestPath`" -EvidenceRoot `"$EvidenceRoot`" -CalendarPath `"$CalendarPath`" -Checkpoint $($entry.Checkpoint) -RunMode $runMode -TriggerIdentity $name"
  if ($TradeDate) { $arguments += " -TradeDate $TradeDate" }
  $description = "CRU52-A2B acceptance consumer; $runMode; $root; executionAuthorized=false"
  $definitions += [pscustomobject]@{ taskName=$name; executable=$powershell; arguments=$arguments; workingDirectory=$root;
    userId=$userId; userSid=$userSid; description=$description; time=$entry.Time; checkpoint=$entry.Checkpoint; outputRoot=$OutputRoot }
}
function Assert-OwnedTask($task, $definition) {
  # Task Scheduler may persist the local account as "user" instead of "HOST\user".
  # Resolve both to the exact SID; do not weaken ownership to a username suffix.
  $actualSid = $task.Principal.UserId
  if ($actualSid -notmatch '^S-1-') {
    $account = New-Object System.Security.Principal.NTAccount($actualSid)
    $actualSid = $account.Translate([System.Security.Principal.SecurityIdentifier]).Value
  }
  if ($task.TaskPath -ne '\' -or $task.Description -ne $definition.description -or $task.Actions.Count -ne 1 `
    -or $task.Actions[0].Execute -ne $definition.executable -or $task.Actions[0].Arguments -ne $definition.arguments `
    -or $task.Actions[0].WorkingDirectory -ne $definition.workingDirectory `
    -or $actualSid -ne $definition.userSid `
    -or $task.Principal.LogonType -ne 'Interactive' -or $task.Principal.RunLevel -ne 'Limited') {
    throw 'OPERATIONS_TASK_OWNERSHIP_MISMATCH'
  }
}
if ($Mode -eq 'Validate') {
  [pscustomobject]@{ status='VALIDATED_ONLY'; formalSchedulerMutation=$false; definitions=$definitions } | ConvertTo-Json -Depth 5
  exit 0
}
# Preflight the complete task set before any mutation; never overwrite an existing task.
foreach ($definition in $definitions) {
  $existing = Get-ScheduledTask -TaskName $definition.taskName -TaskPath '\' -ErrorAction SilentlyContinue
  if ($Mode -eq 'Install' -and $existing) { throw 'OPERATIONS_TASK_ALREADY_EXISTS' }
  if ($Mode -eq 'Remove') {
    if (-not $existing) { continue } # Safe cleanup after a partially completed install.
    Assert-OwnedTask $existing $definition
    # Preserve definition/result before deleting only this exact owned identity.
    [pscustomobject]@{ definition=$definition; info=(Get-ScheduledTaskInfo -InputObject $existing); xml=(Export-ScheduledTask -InputObject $existing) } | ConvertTo-Json -Depth 8
  }
}
foreach ($definition in $definitions) {
  if ($Mode -eq 'Remove') {
    $existing = Get-ScheduledTask -TaskName $definition.taskName -TaskPath '\' -ErrorAction SilentlyContinue
    if (-not $existing) { continue }
    Assert-OwnedTask $existing $definition
    if ($existing.State -eq 'Running') { throw 'OPERATIONS_TASK_STILL_RUNNING' }
    Unregister-ScheduledTask -InputObject $existing -Confirm:$false
    continue
  }
  $action = New-ScheduledTaskAction -Execute $definition.executable -Argument $definition.arguments -WorkingDirectory $root
  # Candidate tasks have no automatic trigger. Run manually for disposable validation.
  $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit (New-TimeSpan -Minutes 15) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $userId -LogonType Interactive -RunLevel Limited
  $taskArguments = @{ TaskName=$definition.taskName; TaskPath='\'; Action=$action; Settings=$settings; Principal=$principal; Description=$definition.description }
  if (-not $CandidateTest) {
    $taskArguments.Trigger = New-ScheduledTaskTrigger -Daily -At $definition.time
  }
  Register-ScheduledTask @taskArguments | Out-Null
  $persisted = Get-ScheduledTask -TaskName $definition.taskName -TaskPath '\' -ErrorAction Stop
  Assert-OwnedTask $persisted $definition
}
[pscustomobject]@{ status=$Mode; candidateTest=[bool]$CandidateTest; definitions=$definitions } | ConvertTo-Json -Depth 5

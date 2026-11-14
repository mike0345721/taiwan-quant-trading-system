param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$taskName = 'TwChipDashboard-V310FrozenForward'

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'V3.10 frozen forward automation removed.'
  exit 0
}

$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$forwardScript = Join-Path $PSScriptRoot 'run-v310-forward-operations-hidden.ps1'
$action = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$forwardScript`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:35'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger `
  -Settings $settings `
  -Description 'Run the read-only V3.10 frozen forward prediction and outcome lifecycle.' `
  -Force | Out-Null

Write-Host 'V3.10 frozen forward automation installed.'
Write-Host 'It starts Monday-Friday at 08:35 and never enables execution.'

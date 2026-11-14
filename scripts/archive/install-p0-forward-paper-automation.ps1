param([switch]$Replace)
$ErrorActionPreference = 'Stop'
$taskName = 'TaiwanStock-P0-Forward-Paper-Observer'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  if (-not $Replace) { throw "Scheduled task already exists: $taskName" }
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false
}
$runner = Join-Path $PSScriptRoot 'run-p0-forward-paper-observer-hidden.ps1'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source
$action = New-ScheduledTaskAction -Execute $powershell -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$runner`"" -WorkingDirectory (Split-Path -Parent $PSScriptRoot)
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:35'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -ExecutionTimeLimit (New-TimeSpan -Hours 7) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Description 'P0 paper-only forward observer. No broker order route; executionAuthorized=false.' | Out-Null
Get-ScheduledTask -TaskName $taskName | Select-Object TaskName,State,TaskPath

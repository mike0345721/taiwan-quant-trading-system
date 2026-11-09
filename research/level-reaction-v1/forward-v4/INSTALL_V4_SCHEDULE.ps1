# Registers ONE read-only research task: V4 trend paper tracker, every day 10:05.
# It reads the official 5m archive and writes only to this folder's ledger. No orders.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$bat = Join-Path $here 'RUN_V4_PAPER.bat'
$name = 'TwChipDashboard-V4TrendPaper'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Daily -At '10:05'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Read-only V4 trend-following paper tracker. Never sends orders.' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $name
Write-Host "Installed: $($t.TaskName) daily 10:05, wake=$($t.Settings.WakeToRun)"
Write-Host 'Running once now...'
& cmd.exe /c "`"$bat`""
Get-Content (Join-Path $here 'ledger\run-log.txt') -Tail 3
Write-Host 'Done.'

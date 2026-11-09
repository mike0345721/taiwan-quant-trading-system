# Registers ONE read-only research task: refresh daily prices + V8/V9 paper tracker, every day 08:15 (before the 08:35 pre-open report). No orders.
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$bat = Join-Path $here 'RUN_MM_PAPER.bat'
$name = 'TwChipDashboard-MultiMarketPaper'
$action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`"" -WorkingDirectory $here
$trigger = New-ScheduledTaskTrigger -Daily -At '08:15'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 20) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $name -Action $action -Trigger $trigger -Settings $settings -Description 'Read-only multi-market paper tracker. Never sends orders.' -Force | Out-Null
$t = Get-ScheduledTask -TaskName $name
Write-Host "Installed: $($t.TaskName) daily 08:15, wake=$($t.Settings.WakeToRun)"
Write-Host 'Running once now...'
& cmd.exe /c "`"$bat`""
Get-Content (Join-Path $here 'ledger-mm\run-log.txt') -Tail 3
Write-Host 'Done.'

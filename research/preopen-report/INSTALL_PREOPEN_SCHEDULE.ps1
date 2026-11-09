# Registers 3 read-only tasks for the pre-open report. They only read local data / public quotes and write to .\out and .\cache. No orders.
#   05:20  cache  (summarise the night session)
#   13:55  cache  (summarise the day session)
#   08:35  report (build out\latest.html)
$ErrorActionPreference = 'Stop'
$here = $PSScriptRoot
$bat = Join-Path $here 'RUN_PREOPEN.bat'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -ExecutionTimeLimit (New-TimeSpan -Minutes 60) -MultipleInstances IgnoreNew
$jobs = @(
  @{ Name = 'TwChipDashboard-PreopenCacheNight'; At = '05:20'; Mode = 'cache' },
  @{ Name = 'TwChipDashboard-PreopenCacheDay';   At = '13:55'; Mode = 'cache' },
  @{ Name = 'TwChipDashboard-PreopenReport';     At = '08:35'; Mode = 'report' }
)
foreach ($j in $jobs) {
  $action = New-ScheduledTaskAction -Execute 'cmd.exe' -Argument "/c `"$bat`" $($j.Mode)" -WorkingDirectory $here
  $trigger = New-ScheduledTaskTrigger -Daily -At $j.At
  Register-ScheduledTask -TaskName $j.Name -Action $action -Trigger $trigger -Settings $settings -Description 'Read-only pre-open report. Never sends orders.' -Force | Out-Null
  $t = Get-ScheduledTask -TaskName $j.Name
  Write-Host "Installed: $($t.TaskName) daily $($j.At) mode=$($j.Mode) wake=$($t.Settings.WakeToRun)"
}
Write-Host 'Building the first report now (first run reads several days of tick files, may take 5-20 minutes)...'
& cmd.exe /c "`"$bat`" report"
Get-Content (Join-Path $here 'out\run-log.txt') -Tail 4
$latest = Join-Path $here 'out\latest.html'
if (Test-Path $latest) { Start-Process $latest }
Write-Host 'Done.'

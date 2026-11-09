# Updates ONLY the schedule/power settings of two existing read-only research tasks.
# It does not change any program, model, data, or the frozen research protocol. No orders.
$ErrorActionPreference = 'Stop'
$names = @('TwChipDashboard-V310FrozenForward')
$p0 = Get-ScheduledTask | Where-Object { $_.TaskName -like '*P0*Forward*' -or $_.TaskName -like '*p0*forward*' }
$all = @(Get-ScheduledTask | Where-Object { $names -contains $_.TaskName }) + @($p0)
if (-not $all) { Write-Host 'No matching tasks found. Nothing changed.'; exit 1 }
$log = Join-Path $PSScriptRoot ("fix-forward-schedule-" + (Get-Date -Format 'yyyyMMdd_HHmmss') + ".txt")
foreach ($t in $all) {
  $before = "BEFORE $($t.TaskName): trigger=$($t.Triggers[0].StartBoundary) wake=$($t.Settings.WakeToRun) battStart=$(-not $t.Settings.DisallowStartIfOnBatteries) battKeep=$(-not $t.Settings.StopIfGoingOnBatteries)"
  $before | Tee-Object -FilePath $log -Append
  $s = $t.Settings
  $s.WakeToRun = $true
  $s.DisallowStartIfOnBatteries = $false
  $s.StopIfGoingOnBatteries = $false
  $s.StartWhenAvailable = $true
  $trig = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:25'
  Set-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath -Trigger $trig -Settings $s | Out-Null
  $u = Get-ScheduledTask -TaskName $t.TaskName -TaskPath $t.TaskPath
  "AFTER  $($u.TaskName): trigger=$($u.Triggers[0].StartBoundary) wake=$($u.Settings.WakeToRun) battStart=$(-not $u.Settings.DisallowStartIfOnBatteries) battKeep=$(-not $u.Settings.StopIfGoingOnBatteries)" | Tee-Object -FilePath $log -Append
}
"`nPower plan (sleep/hibernate timeouts, AC and DC):" | Tee-Object -FilePath $log -Append
powercfg /query SCHEME_CURRENT SUB_SLEEP | Select-String -Pattern 'Power Setting GUID|Current AC|Current DC|電源設定|目前的 AC|目前的 DC' | ForEach-Object { $_.Line } | Tee-Object -FilePath $log -Append
"`nWake timers allowed (AC/DC):" | Tee-Object -FilePath $log -Append
powercfg /query SCHEME_CURRENT SUB_SLEEP RTCWAKE | Select-String -Pattern 'Current AC|Current DC|目前的 AC|目前的 DC' | ForEach-Object { $_.Line } | Tee-Object -FilePath $log -Append
Write-Host "`nDone. Result saved to $log"

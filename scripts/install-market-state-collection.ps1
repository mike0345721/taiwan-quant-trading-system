param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$taskName = 'TwChipDashboard-MarketStateCollection'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Write-Host 'Market State collection automation removed.'
  exit 0
}

$config = Join-Path $root 'config\market-state-forward-collection.json'
$runner = Join-Path $PSScriptRoot 'run-market-state-collector-hidden.ps1'
if (-not (Test-Path $config)) { throw "Missing config: $config" }
if (-not (Test-Path $runner)) { throw "Missing runner: $runner" }

$action = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$runner`"" `
  -WorkingDirectory $root
$trigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:35'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -WakeToRun `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew

Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings `
  -Description 'Collect research-only Market State stock leadership and TXO quote evidence. Execution remains disabled.' `
  -Force | Out-Null

Write-Host 'Market State collection task installed.'
Write-Host 'Schedule: Monday-Friday 08:35, maximum runtime 6 hours.'
Write-Host 'Research-only market data. No order routes are created.'

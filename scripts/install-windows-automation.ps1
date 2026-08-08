param([switch]$Remove)
$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$taskName = 'TwChipDashboard-DailyUpdate'
$forwardTaskName = 'TwChipDashboard-V310FrozenForward'
$startupDir = [Environment]::GetFolderPath('Startup')
$desktopDir = [Environment]::GetFolderPath('Desktop')
$desktopDirs = @($desktopDir)
$oneDriveDesktop = Join-Path $env:USERPROFILE 'OneDrive\Desktop'
if ((Test-Path $oneDriveDesktop) -and $oneDriveDesktop -ne $desktopDir) { $desktopDirs += $oneDriveDesktop }
$desktopDirs = $desktopDirs | Select-Object -Unique
$startupLink = Join-Path $startupDir 'TwChipDashboard.lnk'
$powershell = (Get-Command powershell.exe -ErrorAction Stop).Source

if ($Remove) {
  Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
  Unregister-ScheduledTask -TaskName $forwardTaskName -Confirm:$false -ErrorAction SilentlyContinue
  Remove-Item -LiteralPath $startupLink -Force -ErrorAction SilentlyContinue
  foreach ($folder in $desktopDirs) {
    Remove-Item -LiteralPath (Join-Path $folder 'Taiwan Stock Dashboard.lnk') -Force -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath (Join-Path $folder 'Taiwan Stock Dashboard.url') -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'Windows automation removed.'
  exit 0
}

if (-not (Test-Path (Join-Path $root '.env'))) {
  throw 'Please run 1_SETUP.bat before installing automation.'
}

$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($startupLink)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'start-dashboard-hidden.ps1')`""
$shortcut.WorkingDirectory = $root
$shortcut.Description = 'Start the local read-only Taiwan stock dashboard'
$shortcut.Save()

foreach ($folder in $desktopDirs) {
  Remove-Item -LiteralPath (Join-Path $folder 'Taiwan Stock Dashboard.url') -Force -ErrorAction SilentlyContinue
  $desktopShortcut = $shell.CreateShortcut((Join-Path $folder 'Taiwan Stock Dashboard.lnk'))
  $desktopShortcut.TargetPath = $powershell
  $desktopShortcut.Arguments = "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$(Join-Path $PSScriptRoot 'open-dashboard.ps1')`""
  $desktopShortcut.WorkingDirectory = $root
  $desktopShortcut.Description = 'Open the local read-only Taiwan stock dashboard'
  $desktopShortcut.Save()
}

$dailyScript = Join-Path $PSScriptRoot 'run-daily-update-hidden.ps1'
$action = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$dailyScript`"" `
  -WorkingDirectory $root
$triggerMorning = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:30'
$triggerEvening = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '21:15'
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 1) `
  -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger @($triggerMorning, $triggerEvening) -Settings $settings `
  -Description 'Refresh official Taiwan market data and frozen forward records only.' -Force | Out-Null

$forwardScript = Join-Path $PSScriptRoot 'run-v310-forward-operations-hidden.ps1'
$forwardAction = New-ScheduledTaskAction -Execute $powershell `
  -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$forwardScript`"" `
  -WorkingDirectory $root
$forwardTrigger = New-ScheduledTaskTrigger -Weekly `
  -DaysOfWeek Monday,Tuesday,Wednesday,Thursday,Friday -At '08:35'
$forwardSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable `
  -ExecutionTimeLimit (New-TimeSpan -Hours 6) -MultipleInstances IgnoreNew
Register-ScheduledTask -TaskName $forwardTaskName -Action $forwardAction -Trigger $forwardTrigger `
  -Settings $forwardSettings `
  -Description 'Run the read-only V3.10 frozen forward prediction and outcome lifecycle.' `
  -Force | Out-Null

& (Join-Path $PSScriptRoot 'start-dashboard-hidden.ps1')
Write-Host 'Automation installed.'
Write-Host 'The dashboard starts after Windows sign-in.'
Write-Host 'Official data updates Monday-Friday at 08:30 and 21:15.'
Write-Host 'V3.10 frozen forward observer starts Monday-Friday at 08:35 and never enables execution.'
Write-Host 'After Windows sign-in, missed official updates are checked and recovered automatically.'
Write-Host 'A dashboard shortcut was created on the desktop.'

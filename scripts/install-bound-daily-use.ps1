param(
  [Parameter(Mandatory=$true)][string]$BindingPath,
  [Parameter(Mandatory=$true)][string]$ReceiptDirectory,
  [ValidateSet('Install','Restore')][string]$Mode='Install'
)
$ErrorActionPreference='Stop'
Import-Module (Join-Path $PSScriptRoot 'bound-daily-use.psm1') -Force
$b=Read-BoundPlan $BindingPath (Split-Path $PSScriptRoot -Parent)
$manifestPath=Join-Path $ReceiptDirectory 'entry-backups.json'
$installedPath=Join-Path $ReceiptDirectory 'entry-installed.json'
if ($Mode -eq 'Restore') {
  $backups=Read-BoundJson $manifestPath
  $installed=Read-BoundJson $installedPath
  Assert-Bound ($null -ne $backups -and $null -ne $installed) 'RESTORE_RECEIPTS_REQUIRED'
  foreach ($entry in $backups.entries) {
    $post=@($installed.entries | Where-Object { $_.path -ceq $entry.path })
    $currentHash=(Get-FileHash $entry.path).Hash
    Assert-Bound ($post.Count -eq 1 -and ($currentHash -ceq $post[0].hash -or $currentHash -ceq $entry.hash) -and (Get-FileHash $entry.backup).Hash -ceq $entry.hash) 'RESTORE_DRIFT'
  }
  foreach ($entry in $backups.entries) { Copy-Item -LiteralPath $entry.backup -Destination $entry.path }
  Write-Output 'BOUND_ENTRIES_RESTORED_RUNTIME_UNCHANGED'
  exit 0
}
Assert-Bound (-not (Test-Path -LiteralPath $manifestPath) -and -not (Test-Path -LiteralPath $installedPath)) 'INSTALL_ALREADY_ATTEMPTED'
$desktop=[Environment]::GetFolderPath('Desktop')
$startup=[Environment]::GetFolderPath('Startup')
$bat=Join-Path $b.dataRoot 'launchers\START_DAILY_USE.bat'
$paths=@($bat,(Join-Path $desktop '台股量化籌碼神器－正常使用.lnk'),(Join-Path $desktop 'Taiwan Stock Dashboard.lnk'),(Join-Path $startup 'TwChipDashboard.lnk'))
$shell=New-Object -ComObject WScript.Shell
$powerShell=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$oldTargets=@($bat,$powerShell,$powerShell)
$oldArguments=@('',('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $b.dashboard.root 'scripts\open-dashboard.ps1')+'"'),('-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "'+(Join-Path $b.dashboard.root 'scripts\start-dashboard-hidden.ps1')+'"'))
foreach ($file in $paths) { Assert-Bound ([IO.File]::Exists($file)) 'INSTALLED_ENTRY_MISSING' }
for ($i=1;$i -lt $paths.Count;$i++) {
  $shortcut=$shell.CreateShortcut($paths[$i])
  Assert-Bound ($shortcut.TargetPath -ieq $oldTargets[$i-1] -and $shortcut.Arguments -ceq $oldArguments[$i-1]) 'INSTALLED_ENTRY_CHANGED'
}
New-Item -ItemType Directory -Path $ReceiptDirectory -Force | Out-Null
$entries=@()
for ($i=0;$i -lt $paths.Count;$i++) {
  $backup=Join-Path $ReceiptDirectory ("entry-$i"+[IO.Path]::GetExtension($paths[$i]))
  Assert-Bound (-not [IO.File]::Exists($backup)) 'BACKUP_EXISTS'
  Copy-Item -LiteralPath $paths[$i] -Destination $backup
  $hash=(Get-FileHash $paths[$i]).Hash
  Assert-Bound ($hash -ceq (Get-FileHash $backup).Hash) 'BACKUP_MISMATCH'
  $entries+=@{path=$paths[$i];backup=$backup;hash=$hash}
}
@{at=[datetime]::UtcNow.ToString('o');binding=$BindingPath;bindingHash=(Get-FileHash $BindingPath).Hash;entries=$entries} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
$script=Join-Path $PSScriptRoot 'start-bound-daily-use.ps1'
$arguments='-NoProfile -NonInteractive -WindowStyle Hidden -File "'+$script+'" -BindingPath "'+$BindingPath+'"'
# The machine-local launcher is configuration; application source remains in pinned Git worktrees.
$body="@echo off`r`nREM CRU21_BOUND_DAILY_USE_V1`r`nsetlocal`r`n`"$powerShell`" $arguments %*`r`nexit /b %errorlevel%`r`n"
$staged=@()
$stagedBat=Join-Path $ReceiptDirectory 'staged-0.bat'
[IO.File]::WriteAllText($stagedBat,$body,[Text.Encoding]::ASCII)
$staged+=$stagedBat
for ($i=1;$i -lt $paths.Count;$i++) {
  $stagedPath=Join-Path $ReceiptDirectory "staged-$i.lnk"
  Copy-Item -LiteralPath $paths[$i] -Destination $stagedPath
  $shortcut=$shell.CreateShortcut($stagedPath)
  if ($i -eq 1) { $shortcut.TargetPath=$bat; $shortcut.Arguments='' } else {
    $shortcut.TargetPath=$powerShell
    $shortcut.Arguments=$arguments+$(if ($i -eq 3) {' -NoBrowser'} else {''})
  }
  $shortcut.WorkingDirectory=$b.dashboard.root
  $shortcut.Save()
  $staged+=$stagedPath
}
$post=@(for ($i=0;$i -lt $paths.Count;$i++) { @{path=$paths[$i];hash=(Get-FileHash $staged[$i]).Hash} })
# Persist both old and intended hashes before changing any installed entry.
# Restore therefore also handles a partial installation without overwriting later changes.
@{at=[datetime]::UtcNow.ToString('o');entries=$post} | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath $installedPath -Encoding UTF8
for ($i=0;$i -lt $paths.Count;$i++) {
  Assert-Bound ((Get-FileHash $paths[$i]).Hash -ceq $entries[$i].hash) 'ENTRY_CHANGED_DURING_INSTALL'
  Copy-Item -LiteralPath $staged[$i] -Destination $paths[$i]
  Assert-Bound ((Get-FileHash $paths[$i]).Hash -ceq $post[$i].hash) 'ENTRY_COPY_FAILED'
}
Write-Output 'BOUND_EXISTING_ENTRIES_INSTALLED'

# Creates a desktop shortcut that opens today's pre-open report (builds it first if needed).
$here = $PSScriptRoot
$name = -join ([char[]](0x52E2,0x8861,0x958B,0x76E4,0x524D,0x5831,0x544A))  # shortcut name in Chinese
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop ($name + '.lnk')
$ws = New-Object -ComObject WScript.Shell
$s = $ws.CreateShortcut($lnk)
$s.TargetPath = Join-Path $here 'OPEN_LATEST_REPORT.bat'
$s.WorkingDirectory = $here
$s.WindowStyle = 7
$s.IconLocation = "$env:SystemRoot\System32\shell32.dll,21"
$s.Save()
Write-Host "Desktop shortcut created: $lnk"

param(
  [string]$ProjectRoot = (Split-Path $PSScriptRoot -Parent)
)

$ErrorActionPreference = 'Stop'
$ProjectRoot = (Resolve-Path -LiteralPath $ProjectRoot).Path
$launcherDir = Join-Path $ProjectRoot 'data\launchers'
$launcherPath = Join-Path $launcherDir 'START_DAILY_USE.bat'
$shortcutName = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5Y+w6IKh6YeP5YyW57GM56K856We5Zmo77yN5q2j5bi45L2/55SoLmxuaw=='))
$shortcutDescription = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('5ZWf5YuV5Y+w6IKh6YeP5YyW57GM56K856We5Zmo55qE5q2j5bi45ZSv6K6A5L2/55So55Kw5aKD'))

if (-not (Test-Path -LiteralPath (Join-Path $ProjectRoot 'scripts\start-daily-use.ps1') -PathType Leaf)) {
  throw 'The canonical daily-use launcher is missing.'
}

New-Item -ItemType Directory -Force -Path $launcherDir | Out-Null
$launcherBody = @'
@echo off
REM DAILY_USE_BOOTSTRAP_V1 - machine-local normal environment launcher
setlocal
cd /d "%~dp0\..\.."
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%CD%\scripts\start-daily-use.ps1"
'@

if (Test-Path -LiteralPath $launcherPath) {
  $existing = Get-Content -LiteralPath $launcherPath -Raw
  if ($existing -notmatch 'DAILY_USE_BOOTSTRAP_V1') {
    throw "Refusing to overwrite an unrecognized local launcher: $launcherPath"
  }
}
Set-Content -LiteralPath $launcherPath -Value $launcherBody -Encoding ascii

# Namespace 0x10 is the Windows Shell Desktop known folder, including a valid
# redirected / OneDrive desktop.  No username or absolute Desktop path is stored.
$desktop = (New-Object -ComObject Shell.Application).Namespace(0x10).Self.Path
$shortcutPath = Join-Path $desktop $shortcutName
$shell = New-Object -ComObject WScript.Shell
if (Test-Path -LiteralPath $shortcutPath) {
  $existingShortcut = $shell.CreateShortcut($shortcutPath)
  if ($existingShortcut.TargetPath -ne $launcherPath) {
    $existingTarget = $existingShortcut.TargetPath
    $recognizedTarget = $existingTarget -and
      (Split-Path $existingTarget -Leaf) -eq 'START_DAILY_USE.bat' -and
      (Test-Path -LiteralPath $existingTarget -PathType Leaf) -and
      ((Get-Content -LiteralPath $existingTarget -Raw) -match 'DAILY_USE_BOOTSTRAP_V1') -and
      ((Get-Content -LiteralPath $existingTarget -Raw) -match 'scripts\\start-daily-use\.ps1')
    if (-not $recognizedTarget) {
      throw "Refusing to overwrite an unrecognized shortcut: $shortcutPath"
    }
  }
}

$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $launcherPath
$shortcut.WorkingDirectory = $ProjectRoot
$shortcut.Description = $shortcutDescription
$shortcut.Save()

Write-Host "Desktop shortcut created: $shortcutPath"
Write-Host "Canonical launcher: $launcherPath"

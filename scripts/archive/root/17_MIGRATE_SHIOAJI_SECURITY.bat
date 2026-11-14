@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Upgrading Shioaji credentials to Windows DPAPI encryption...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\migrate-shioaji-credentials.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Migration failed. The old credential file was preserved.
) else (
  echo.
  echo Security upgrade completed.
)
echo.
pause

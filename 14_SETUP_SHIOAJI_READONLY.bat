@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\setup-shioaji-readonly.ps1"
if errorlevel 1 (
  echo.
  echo [ERROR] Setup failed. Do not share your API Key or Secret Key.
)
echo.
pause

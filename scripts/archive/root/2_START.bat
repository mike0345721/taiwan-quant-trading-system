@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found. Run 1_SETUP.bat first.
  pause
  exit /b 1
)

if not exist ".env" (
  echo The first-time setup has not been completed. Starting setup now.
  call "%~dp01_SETUP.bat"
  if not exist ".env" exit /b 1
)

echo.
echo Starting Taiwan Stock Chip Dashboard...
echo Login page: http://127.0.0.1:8787
echo Keep this black window open while using the dashboard.
echo Close this window to stop the dashboard.
echo.

start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:8787'"
node launcher.mjs

if errorlevel 1 (
  echo.
  echo [ERROR] Startup failed. Please take a screenshot of the error above.
  pause
)

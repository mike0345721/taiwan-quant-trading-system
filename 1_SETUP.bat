@echo off
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo [ERROR] Node.js was not found.
  echo Install Node.js 20 LTS or newer, then run this file again.
  start "" "https://nodejs.org/"
  pause
  exit /b 1
)

for /f "tokens=1 delims=." %%A in ('node -p "process.versions.node"') do set NODE_MAJOR=%%A
if %NODE_MAJOR% LSS 20 (
  echo [ERROR] Node.js 20 or newer is required.
  node --version
  pause
  exit /b 1
)

node scripts\windows-setup.mjs
if errorlevel 1 (
  echo.
  echo [ERROR] Setup failed. Please take a screenshot of the error above.
  pause
  exit /b 1
)

echo.
pause

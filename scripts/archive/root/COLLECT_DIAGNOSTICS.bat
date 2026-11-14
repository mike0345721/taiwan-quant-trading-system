@echo off
setlocal
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js was not found in PATH.
  pause
  exit /b 1
)

node scripts\collect-development-diagnostics.mjs
if errorlevel 1 (
  echo.
  echo [ERROR] Diagnostics collection failed.
  pause
  exit /b 1
)

echo.
echo [OK] Safe diagnostics created under data\diagnostics\latest.json
echo      This file is local-only and is not committed to Git.
echo.
pause

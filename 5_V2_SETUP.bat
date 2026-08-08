@echo off
setlocal
cd /d "%~dp0v2"
echo Building the V2 local research database...
node scripts\setup-all.mjs
if errorlevel 1 (
  echo.
  echo V2 setup failed. Please keep this window open and send a screenshot.
  pause
  exit /b 1
)
echo.
echo V2 setup completed successfully.
echo V1 is unchanged. Continue using 2_START.bat for the dashboard.
pause

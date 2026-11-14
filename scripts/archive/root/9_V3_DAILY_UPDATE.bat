@echo off
setlocal
cd /d "%~dp0"
echo V3.6.2 daily data update
echo This updates official data and forward records only.
echo It does not retune the formal research model.
echo.
node v2\scripts\run-v3-daily-update.mjs
if errorlevel 1 goto failed
echo.
echo Daily update completed. Return to the dashboard and click refresh.
pause
exit /b 0
:failed
echo.
echo Daily update stopped. Keep this window open and send a screenshot.
pause
exit /b 1

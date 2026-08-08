@echo off
setlocal
cd /d "%~dp0v2"
echo Running V2.3 Walk-forward research backtests...
echo This does not connect to a broker or place orders.
node scripts\run-backtests.mjs
if errorlevel 1 goto failed
echo.
echo V2.3 research report completed: v2\reports\latest-backtest.json
pause
exit /b 0
:failed
echo.
echo V2.3 backtest failed. Keep this window open and send a screenshot.
pause
exit /b 1

@echo off
setlocal
cd /d "%~dp0v2"
set "V2_BACKFILL_START=2023-07-01"
set "V2_RESEARCH_START=2023-07-01"
echo Expanding official TAIFEX research history to three years...
echo This is a one-time task and can take several minutes.
node scripts\backfill-taifex.mjs
if errorlevel 1 goto failed
node scripts\backfill-taifex-position-gaps.mjs
if errorlevel 1 goto failed
node scripts\quality-report.mjs
if errorlevel 1 goto failed
node scripts\validate-official-history.mjs
if errorlevel 1 goto failed
node scripts\status-report.mjs
if errorlevel 1 goto failed
node scripts\run-backtests.mjs
if errorlevel 1 goto failed
echo.
echo V2 three-year expansion completed successfully.
pause
exit /b 0
:failed
echo.
echo V2 three-year expansion failed. Keep this window open and send a screenshot.
pause
exit /b 1

@echo off
cd /d "%~dp0"
echo Building 5-minute buy/sell flow from TAIFEX tick files (Jan-Aug 2026, holdout refused)...
node build-flow-5m.mjs
echo.
pause

@echo off
rem One-click: open todays pre-open report; build it first if todays report does not exist yet.
cd /d "%~dp0"
for /f %%d in (powershell -NoProfile -Command "Get-Date -Format yyyy-MM-dd") do set TODAY=%%d
if not exist "out\%TODAY%.html" (
  echo Building todays report, please wait...
  call RUN_PREOPEN.bat report
)
if exist "out\%TODAY%.html" (start "" "out\%TODAY%.html") else if exist "out\latest.html" (start "" "out\latest.html") else (echo Report failed. See out\run-log.txt & pause)

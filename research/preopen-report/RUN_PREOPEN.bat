@echo off
rem Pre-open report (read-only). Usage: RUN_PREOPEN.bat cache  ^|  RUN_PREOPEN.bat report
cd /d "%~dp0"
if not exist out mkdir out
set MODE=%1
if "%MODE%"=="" set MODE=report
echo [%date% %time%] mode=%MODE% >> out\run-log.txt
node build-preopen-report.mjs --mode %MODE% >> out\run-log.txt 2>&1

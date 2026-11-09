@echo off
rem Read-only: download public daily prices for the multi-market trend study (about 1 minute).
cd /d "%~dp0"
node download-daily.mjs out
echo Finished %date% %time%
pause

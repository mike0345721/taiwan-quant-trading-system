@echo off
cd /d "%~dp0"
node pack-daily.mjs out packed
echo Finished %date% %time%

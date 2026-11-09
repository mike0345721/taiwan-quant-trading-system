@echo off
cd /d "%~dp0"
set OUT=%~dp0power-check.txt
echo === sleep settings (AC = plugged in, DC = battery; values are seconds, 0x0 = never) === > "%OUT%"
powercfg /query SCHEME_CURRENT SUB_SLEEP >> "%OUT%" 2>&1
echo. >> "%OUT%"
echo === lid / buttons === >> "%OUT%"
powercfg /query SCHEME_CURRENT SUB_BUTTONS >> "%OUT%" 2>&1
echo. >> "%OUT%"
echo === available sleep states === >> "%OUT%"
powercfg /a >> "%OUT%" 2>&1
echo. >> "%OUT%"
echo === wake timers === >> "%OUT%"
powercfg /waketimers >> "%OUT%" 2>&1
echo Done. Saved to power-check.txt
pause

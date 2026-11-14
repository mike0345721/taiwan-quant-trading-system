@echo off
chcp 65001 >nul
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\backfill-taifex-replay.ps1" -Limit 30 -DelayMs 3000
if errorlevel 1 pause

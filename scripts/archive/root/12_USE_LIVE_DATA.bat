@echo off
chcp 65001 >nul
cd /d "%~dp0"
where node >nul 2>&1
if errorlevel 1 exit /b 1
node scripts\set-data-mode.mjs live
echo Please restart the dashboard after changing data mode.
pause


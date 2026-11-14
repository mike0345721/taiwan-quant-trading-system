@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Installing local dashboard auto-start and weekday data update...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\install-windows-automation.ps1"
if errorlevel 1 goto failed
echo.
echo Installation completed. You can now open the desktop dashboard shortcut.
pause
exit /b 0
:failed
echo.
echo Installation failed. Keep this window open and send a screenshot.
pause
exit /b 1


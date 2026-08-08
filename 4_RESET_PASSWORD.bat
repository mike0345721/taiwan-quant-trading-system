@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo This will replace the current dashboard password.
echo.
call "%~dp01_SETUP.bat"

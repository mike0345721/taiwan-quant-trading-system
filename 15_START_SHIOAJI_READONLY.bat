@echo off
chcp 65001 >nul
cd /d "%~dp0"

if not exist ".shioaji.credentials.json" (
  echo Run 17_MIGRATE_SHIOAJI_SECURITY.bat first.
  pause
  exit /b 1
)

echo Starting Shioaji read-only stock quotes...
echo Local health: http://127.0.0.1:8790/health
echo No order routes are included.
echo Keep this window open. Press Ctrl+C to stop.
echo.
python "%~dp0broker\shioaji_readonly_bridge.py"

if errorlevel 1 (
  echo.
  echo [ERROR] Connection failed. Do not paste secrets into chat.
  pause
)

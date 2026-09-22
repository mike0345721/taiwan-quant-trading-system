@echo off
chcp 65001 >nul
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\update-local.ps1" -PlanFile "%~dp0data\cru55-update\update-plan.json"
if errorlevel 1 echo 更新未完成，請保留畫面與私人驗證紀錄。
pause

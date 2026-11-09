@echo off
cd /d "%~dp0"
if exist out\latest.html (start "" "out\latest.html") else (echo No report yet. Run RUN_PREOPEN.bat first. & pause)

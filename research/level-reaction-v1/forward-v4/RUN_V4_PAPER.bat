@echo off
cd /d "%~dp0"
if not exist ledger mkdir ledger
echo [%date% %time%] >> ledger\run-log.txt
node research\level-reaction-v1\runs\forward-v4-paper.mjs >> ledger\run-log.txt 2>&1

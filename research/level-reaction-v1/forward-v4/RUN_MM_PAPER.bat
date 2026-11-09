@echo off
rem Read-only: refresh public daily prices, then update the V8/V9 paper tracker. No orders.
cd /d "%~dp0"
if not exist ledger-mm mkdir ledger-mm
echo [%date% %time%] >> ledger-mm\run-log.txt
pushd "..\multi-market-20261109"
node download-daily.mjs out >> "%~dp0ledger-mm\run-log.txt" 2>&1
node pack-daily.mjs out packed >> "%~dp0ledger-mm\run-log.txt" 2>&1
popd
set MM_END=9999-12-31
node research\level-reaction-v1\runs\forward-mm-paper.mjs --data "..\multi-market-20261109\packed" --out ledger-mm >> ledger-mm\run-log.txt 2>&1

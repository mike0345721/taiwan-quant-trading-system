@echo off
setlocal
cd /d "%~dp0v2"
echo Updating the V2 official history database...
echo This can take several minutes.
node scripts\setup-all.mjs
if errorlevel 1 goto failed
node scripts\backfill-taifex.mjs
if errorlevel 1 goto failed
node scripts\backfill-twse-gaps.mjs
if errorlevel 1 goto failed
node scripts\backfill-twse-margin.mjs
if errorlevel 1 goto failed
node scripts\backfill-taifex-position-gaps.mjs
if errorlevel 1 goto failed
node scripts\backfill-global-context.mjs
if errorlevel 1 goto failed
node scripts\backfill-macro-environment.mjs
if errorlevel 1 goto failed
node scripts\backfill-taiwan-vix.mjs
if errorlevel 1 goto failed
node scripts\build-volatility-relative.mjs
if errorlevel 1 goto failed
node scripts\analyze-macro-environment.mjs
if errorlevel 1 goto failed
node scripts\analyze-macro-factor-candidates.mjs
if errorlevel 1 goto failed
node scripts\analyze-chip-interactions.mjs
if errorlevel 1 goto failed
node scripts\analyze-vix-relative.mjs
if errorlevel 1 goto failed
node scripts\build-basis-term-structure.mjs
if errorlevel 1 goto failed
node scripts\build-normalized-futures-oi.mjs
if errorlevel 1 goto failed
node scripts\analyze-basis-term-structure.mjs
if errorlevel 1 goto failed
node scripts\quality-report.mjs
if errorlevel 1 goto failed
node scripts\validate-official-history.mjs
if errorlevel 1 goto failed
node scripts\status-report.mjs
if errorlevel 1 goto failed
node scripts\run-backtests.mjs
if errorlevel 1 goto failed
node scripts\run-mirror-backtest.mjs
if errorlevel 1 goto failed
node scripts\run-multi-target-research.mjs
if errorlevel 1 goto failed
node scripts\analyze-reverse-events.mjs
if errorlevel 1 goto failed
node scripts\build-large-move-price-report.mjs
if errorlevel 1 goto failed
node scripts\analyze-foreign-risk-group.mjs
if errorlevel 1 goto failed
node scripts\analyze-no-trade-veto.mjs
if errorlevel 1 goto failed
node scripts\analyze-holding-selector.mjs
if errorlevel 1 goto failed
node scripts\update-v3-decision-ledger.mjs
if errorlevel 1 goto failed
node scripts\resolve-v3-outcomes.mjs
if errorlevel 1 goto failed
node scripts\update-v3-4-forward.mjs
if errorlevel 1 goto failed
echo.
echo V2 official history update completed successfully.
pause
exit /b 0
:failed
echo.
echo V2 history update failed. Keep this window open and send a screenshot.
pause
exit /b 1

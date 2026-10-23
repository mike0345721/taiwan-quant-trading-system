import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const read = (relative) => fs.readFileSync(new URL(`../${relative}`, import.meta.url), 'utf8');

test('Windows automation remains local-only and does not store credentials', () => {
  const installer = read('scripts/install-windows-automation.ps1');
  const starter = read('scripts/start-dashboard-hidden.ps1');
  const recovery = read('scripts/run-startup-recovery-hidden.ps1');
  const opener = read('scripts/open-dashboard.ps1');
  const combined = `${installer}\n${starter}\n${recovery}\n${opener}`;
  assert.match(combined, /127\.0\.0\.1:8787/);
  assert.doesNotMatch(combined, /0\.0\.0\.0|broker|password|DASHBOARD_PASSWORD_HASH/i);
  assert.match(installer, /Monday,Tuesday,Wednesday,Thursday,Friday/);
  assert.match(installer, /08:30/);
  assert.match(installer, /21:15/);
  assert.match(installer, /open-dashboard\.ps1/);
  assert.doesNotMatch(starter, /run-startup-recovery-hidden\.ps1|start-shioaji-readonly-hidden\.ps1/);
  assert.match(starter, /DASHBOARD_ALREADY_LISTENING_BUT_HEALTH_UNVERIFIED/);
  assert.match(recovery, /run-daily-update-hidden\.ps1/);
  assert.match(recovery, /v3-daily-update-status\.json/);
});

test('desktop shortcut also supports a OneDrive-managed desktop', () => {
  const installer = read('scripts/install-windows-automation.ps1');
  assert.match(installer, /OneDrive\\Desktop/);
  assert.match(installer, /Taiwan Stock Dashboard\.lnk/);
});

test('scheduled daily update preserves the frozen research workflow', () => {
  const runner = read('scripts/run-daily-update-hidden.ps1');
  assert.match(runner, /run-v3-daily-update\.mjs/);
  assert.doesNotMatch(runner, /run-backtests|cross-market-research|build-v3-6-2-final-report/i);
});

test('daily pipeline audits the append-only forward ledger without retuning research', () => {
  const pipeline = read('v2/scripts/run-v3-daily-update.mjs');
  assert.match(pipeline, /forward_ledger_audit/);
  assert.match(pipeline, /paper_event_ledger_audit/);
  assert.match(pipeline, /intraday_replay/);
  assert.match(pipeline, /intraday_features/);
  assert.match(pipeline, /intraday_strategy_engineering/);
  assert.doesNotMatch(pipeline, /run-v3-6-2-cross-market-research/);
});

test('intraday daily update uses the official 30-day archive without force rebuilding it', () => {
  const builder = read('scripts/build-intraday-research-features.mjs');
  const wrapper = read('v2/scripts/backfill-taifex-replay-root.mjs');
  assert.match(builder, /fileURLToPath/);
  assert.match(builder, /appRoot/);
  assert.match(wrapper, /backfill-taifex-replay\.ps1/);
  assert.match(wrapper, /-Limit', '30'/);
  assert.doesNotMatch(wrapper, /ForceRebuild/);
});

test('TAIFEX tick backfill is rate limited, capped at official 30 days and retries partial files', () => {
  const source = read('scripts/backfill-taifex-replay.ps1');
  assert.match(source, /ValidateRange\(1, 30\)/);
  assert.match(source, /Start-Sleep -Milliseconds/);
  assert.match(source, /futPrevious30DaysSalesData/);
  assert.match(source, /Date -lt \$todayTaipei/);
  assert.match(source, /Always download an unaudited day again/);
  assert.match(source, /verifiedArchiveDays/);
});

test('paid TAIFEX trade-summary preparation remains validation-only', () => {
  const source = read('scripts/validate-taifex-trade-summary.mjs');
  assert.match(source, /formatCompatible/);
  assert.match(source, /productionImportReady/);
  assert.match(source, /executionAuthorized:\s*false/);
  assert.doesNotMatch(source, /importFiveMinuteBars|archiveDir|order/i);
});

test('data mode tool changes only the MOCK_DATA setting', () => {
  const source = read('scripts/set-data-mode.mjs');
  assert.match(source, /\^MOCK_DATA=/);
  assert.doesNotMatch(source, /DASHBOARD_PASSWORD_HASH\s*=/);
});

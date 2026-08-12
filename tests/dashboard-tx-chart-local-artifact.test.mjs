import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { clearTxChartLedgerCache, loadTxDecisionChart } from '../src/dashboard-tx-chart-source.mjs';

const root = process.env.DW2_LOCAL_ARTIFACT_ROOT || '';
const ledger = root ? path.join(root, 'live-events', '2026-08-11.ndjson') : '';
const artifactAvailable = Boolean(root && fs.existsSync(ledger));

test('local governed TX Tick artifact integrates with the chart without future evidence', {
  skip: artifactAvailable ? false : 'LOCAL_ARTIFACT_REQUIRED:DW2_LOCAL_ARTIFACT_ROOT/live-events/2026-08-11.ndjson',
}, () => {
  const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
  const cacheRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-local-cache-'));
  try {
  clearTxChartLedgerCache();
  const first = loadTxDecisionChart({
    dataRoot: root,
    cacheRoot,
    calendar,
    timeframe: '5m',
    mode: 'REPLAY',
    tradeDate: '2026-08-11',
    session: 'DAY',
    asOf: '2026-08-11T13:45:00+08:00',
  });
  const second = loadTxDecisionChart({
    dataRoot: root,
    cacheRoot,
    calendar,
    timeframe: '5m',
    mode: 'REPLAY',
    tradeDate: '2026-08-11',
    session: 'DAY',
    asOf: '2026-08-11T13:45:00+08:00',
  });

  assert.equal(first.status, 'READY');
  assert.match(first.actualContract, /^TXF[A-L]\d$/);
  assert.ok(first.sourceEventCount > 0);
  assert.ok(first.bars.length > 0);
  assert.ok(first.bars.every((bar) => bar.actualContract === first.actualContract));
  assert.ok(first.bars.every((bar) => bar.volume > 0));
  assert.equal(first.futureDataViolations, 0);
  assert.equal(first.executionAuthorized, false);
  assert.deepEqual(first, second);
  clearTxChartLedgerCache();
  const cachedReplay = loadTxDecisionChart({
    dataRoot: root, cacheRoot, calendar, timeframe: '5m', mode: 'REPLAY',
    tradeDate: '2026-08-11', session: 'DAY', asOf: '2026-08-11T13:45:00+08:00',
  });
  assert.deepEqual(cachedReplay, first);
  } finally {
    fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

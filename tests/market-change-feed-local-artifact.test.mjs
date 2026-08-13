import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { clearTxChartLedgerCache, loadTxDecisionChart } from '../src/dashboard-tx-chart-source.mjs';
import { buildMarketChangeFeed, stableMarketChangeJson } from '../src/market-change-feed.mjs';

const root = process.env.DW3_LOCAL_ARTIFACT_ROOT || '';
const ledger = root ? path.join(root, 'live-events', '2026-08-11.ndjson') : '';
const artifactAvailable = Boolean(root && fs.existsSync(ledger));

test('real local TX replay produces deterministic governed Market Change events', {
  skip: artifactAvailable ? false : 'LOCAL_ARTIFACT_REQUIRED:DW3_LOCAL_ARTIFACT_ROOT/live-events/2026-08-11.ndjson',
}, () => {
  const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
  const temporaryCache = !process.env.DW3_LOCAL_CACHE_ROOT;
  const cacheRoot = process.env.DW3_LOCAL_CACHE_ROOT || fs.mkdtempSync(path.join(os.tmpdir(), 'dw3-local-cache-'));
  try {
    clearTxChartLedgerCache();
    const chart = loadTxDecisionChart({
      dataRoot: root, cacheRoot, calendar, timeframe: '5m', mode: 'REPLAY',
      tradeDate: '2026-08-11', session: 'DAY', asOf: '2026-08-11T13:45:00+08:00',
    });
    const first = buildMarketChangeFeed(chart);
    clearTxChartLedgerCache();
    const replay = loadTxDecisionChart({
      dataRoot: root, cacheRoot, calendar, timeframe: '5m', mode: 'REPLAY',
      tradeDate: '2026-08-11', session: 'DAY', asOf: '2026-08-11T13:45:00+08:00',
    });
    const second = buildMarketChangeFeed(replay);
    assert.equal(first.logicalHash, second.logicalHash);
    assert.equal(stableMarketChangeJson(first), stableMarketChangeJson(second));
    assert.equal(first.futureDataViolations, 0);
    assert.equal(first.events.every((event) => event.actualContract === chart.actualContract), true);
    assert.equal(first.events.every((event) => event.availableAt <= chart.asOf), true);
    assert.equal(first.dataQuality.nativeSequenceAvailable, false);
    assert.equal(first.dataQuality.trueTxTickLoss, 'unknown');
    assert.equal(first.executionAuthorized, false);
  } finally {
    if (temporaryCache) fs.rmSync(cacheRoot, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import {
  clearTxChartLedgerCache,
  loadTxDecisionChart,
  readTxLiveEventLedger,
  resolveDefaultChartSelection,
} from '../src/dashboard-tx-chart-source.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));

function record(timestamp, price, volume = 1) {
  return {
    kind: 'futures_tick', product: 'TXFH6', receivedAt: `${timestamp}+08:00`, exchangeTimestamp: timestamp,
    eventId: `${timestamp}-${price}`, duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { datetime: timestamp, close: String(price), volume, simtrade: false, _product_family: 'TX', _target_code: 'TXFH6' },
  };
}

test.afterEach(() => clearTxChartLedgerCache());

test('default session selection uses governed DAY/NIGHT trade dates rather than weekday guessing', () => {
  assert.deepEqual(resolveDefaultChartSelection(calendar, new Date('2026-08-12T01:00:00Z')), { tradeDate: '2026-08-12', session: 'DAY', reason: null });
  assert.deepEqual(resolveDefaultChartSelection(calendar, new Date('2026-08-12T08:00:00Z')), { tradeDate: '2026-08-13', session: 'NIGHT', reason: null });
  assert.equal(resolveDefaultChartSelection(calendar, new Date('2026-08-15T02:00:00Z')).tradeDate, null);
});

test('ledger reader incrementally consumes only actual TX ticks and source loader stays deterministic', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-source-'));
  try {
    const ledgerDir = path.join(root, 'live-events');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const ledger = path.join(ledgerDir, '2026-08-12.ndjson');
    fs.writeFileSync(ledger, `${JSON.stringify(record('2026-08-12T08:45:01.000', 100, 2))}\n`);
    assert.equal(readTxLiveEventLedger(ledger).length, 1);
    fs.appendFileSync(ledger, `${JSON.stringify({ ...record('2026-08-12T08:46:01.000', 101, 3), kind: 'futures_bidask' })}\n`);
    fs.appendFileSync(ledger, `${JSON.stringify(record('2026-08-12T08:46:02.000', 102, 4))}\n`);
    assert.equal(readTxLiveEventLedger(ledger).length, 2);
    const options = {
      dataRoot: root, cacheRoot: path.join(root, 'chart-cache'), calendar, timeframe: '5m', mode: 'REPLAY', tradeDate: '2026-08-12', session: 'DAY', asOf: '2026-08-12T09:00:00+08:00',
    };
    const first = loadTxDecisionChart(options);
    const second = loadTxDecisionChart(options);
    assert.deepEqual(first, second);
    assert.equal(first.sourceEventCount, 2);
    assert.equal(first.bars[0].volume, 6);
    assert.equal(first.futureDataViolations, 0);
    assert.equal(first.executionAuthorized, false);
    clearTxChartLedgerCache();
    const fromPersistentCache = loadTxDecisionChart(options);
    assert.deepEqual(fromPersistentCache, first);
    const cacheMetadata = fs.readdirSync(path.join(root, 'chart-cache')).find((name) => name.endsWith('.meta.json'));
    assert.ok(cacheMetadata);
    const metadata = JSON.parse(fs.readFileSync(path.join(root, 'chart-cache', cacheMetadata), 'utf8'));
    assert.equal(metadata.derivedCacheOnly, true);
    assert.equal(metadata.executionAuthorized, false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

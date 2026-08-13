import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { clearTxChartLedgerCache, loadTxDecisionChart } from '../src/dashboard-tx-chart-source.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));

function makeLedgerRecord() {
  return {
    schemaVersion: '1.0.0',
    provider: 'shioaji',
    kind: 'futures_tick',
    code: 'TXFH6',
    product: 'TXFH6',
    receivedAt: '2026-08-12T17:59:59.700+08:00',
    exchangeTimestamp: '2026-08-12T18:00:00.000',
    eventId: 'timestamp-lineage-hotfix-tick',
    duplicate: false,
    sequenceGap: 0,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: {
      code: 'TXFH6',
      datetime: '2026-08-12T18:00:00.000',
      close: '45910',
      volume: 2,
      simtrade: false,
      _product_family: 'TX',
      _target_code: 'TXFH6',
    },
  };
}

function withLedger() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-lineage-hotfix-'));
  const liveEvents = path.join(root, 'live-events');
  fs.mkdirSync(liveEvents, { recursive: true });
  fs.writeFileSync(path.join(liveEvents, '2026-08-12.ndjson'), `${JSON.stringify(makeLedgerRecord())}\n`, 'utf8');
  return root;
}

test('clock-skewed TX tick becomes visible only at exchange time and remains quality-insufficient', () => {
  clearTxChartLedgerCache();
  const dataRoot = withLedger();
  try {
    const chart = loadTxDecisionChart({
      dataRoot,
      calendar,
      timeframe: '5m',
      mode: 'REPLAY',
      tradeDate: '2026-08-13',
      session: 'NIGHT',
      asOf: '2026-08-12T18:05:00+08:00',
      now: new Date('2026-08-12T18:05:00+08:00'),
    });
    assert.equal(chart.sourceEventCount, 1);
    assert.equal(chart.bars.length, 1);
    assert.equal(chart.lastPrice, 45910);
    assert.equal(chart.actualContract, 'TXFH6');
    assert.equal(chart.timeLineageViolationCount, 1);
    assert.equal(chart.timestampLineageAdjustedEventCount, 1);
    assert.equal(chart.timestampLineagePolicy, 'EFFECTIVE_AVAILABLE_AT_MAX_RECEIVED_EXCHANGE');
    assert.equal(chart.qualityStatus, 'QUALITY_INSUFFICIENT');
    assert.ok(chart.qualityReasons.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
    assert.equal(chart.availableAt, '2026-08-12T10:00:00.000Z');
    assert.equal(chart.futureDataViolations, 0);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    clearTxChartLedgerCache();
  }
});

test('raw early receivedAt never makes the tick visible before exchange time', () => {
  clearTxChartLedgerCache();
  const dataRoot = withLedger();
  try {
    const chart = loadTxDecisionChart({
      dataRoot,
      calendar,
      timeframe: '5m',
      mode: 'REPLAY',
      tradeDate: '2026-08-13',
      session: 'NIGHT',
      asOf: '2026-08-12T17:59:59.800+08:00',
      now: new Date('2026-08-12T17:59:59.800+08:00'),
    });
    assert.equal(chart.sourceEventCount, 0);
    assert.deepEqual(chart.bars, []);
    assert.equal(chart.futureExcluded, 1);
    assert.equal(chart.timeLineageViolationCount, 0);
    assert.equal(chart.futureDataViolations, 0);
  } finally {
    fs.rmSync(dataRoot, { recursive: true, force: true });
    clearTxChartLedgerCache();
  }
});

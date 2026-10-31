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

test('live cache keeps small suffixes in memory and restart deterministically recovers them from the ledger', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-source-checkpoint-'));
  try {
    const ledgerDir = path.join(root, 'live-events');
    const cacheRoot = path.join(root, 'chart-cache');
    fs.mkdirSync(ledgerDir, { recursive: true });
    const ledger = path.join(ledgerDir, '2026-08-12.ndjson');
    fs.writeFileSync(ledger, `${JSON.stringify(record('2026-08-12T08:45:01.000', 100, 2))}\n`);
    const options = {
      dataRoot: root, cacheRoot, calendar, timeframe: '5m', mode: 'REPLAY', tradeDate: '2026-08-12', session: 'DAY', asOf: '2026-08-12T09:00:00+08:00',
    };
    const initial = loadTxDecisionChart(options);
    const metadataPath = path.join(cacheRoot, fs.readdirSync(cacheRoot).find((name) => name.endsWith('.meta.json')));
    const initialMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));

    fs.appendFileSync(ledger, `${JSON.stringify(record('2026-08-12T08:46:02.000', 102, 4))}\n`);
    const liveIncremental = loadTxDecisionChart(options);
    const deferredMetadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
    assert.equal(liveIncremental.sourceEventCount, 2);
    assert.equal(deferredMetadata.sourceOffset, initialMetadata.sourceOffset);

    clearTxChartLedgerCache();
    const restarted = loadTxDecisionChart(options);
    assert.deepEqual(restarted, liveIncremental);
    assert.notDeepEqual(restarted, initial);
  } finally {
    clearTxChartLedgerCache();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 25 });
    assert.equal(fs.existsSync(root), false, 'owned chart fixture directory must be removed');
  }
});

test('1D source reads governed previous NIGHT plus current DAY ledgers without changing lower timeframe anchors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-source-1d-'));
  try {
    const ledgerDir = path.join(root, 'live-events');
    fs.mkdirSync(ledgerDir, { recursive: true });
    fs.writeFileSync(path.join(ledgerDir, '2026-08-11.ndjson'), `${JSON.stringify(record('2026-08-11T15:00:01.000', 100, 2))}\n`);
    fs.writeFileSync(path.join(ledgerDir, '2026-08-12.ndjson'), [
      record('2026-08-12T04:59:59.000', 101, 3),
      record('2026-08-12T08:45:01.000', 102, 4),
      record('2026-08-12T13:44:59.000', 103, 5),
    ].map(JSON.stringify).join('\n') + '\n');
    const daily = loadTxDecisionChart({
      dataRoot: root, calendar, timeframe: '1D', mode: 'REPLAY', tradeDate: '2026-08-12', asOf: '2026-08-12T13:45:00+08:00',
    });
    assert.deepEqual(daily.sourceLedgerDates, ['2026-08-11', '2026-08-12']);
    assert.equal(daily.status, 'READY');
    assert.equal(daily.sessionCoverage.night.eventCount, 2);
    assert.equal(daily.sessionCoverage.day.eventCount, 2);
    assert.equal(daily.bars[0].volume, 14);
    const five = loadTxDecisionChart({
      dataRoot: root, calendar, timeframe: '5m', mode: 'REPLAY', tradeDate: '2026-08-12', session: 'DAY', asOf: '2026-08-12T13:45:00+08:00',
    });
    assert.deepEqual(five.sourceLedgerDates, ['2026-08-12']);
    assert.equal(five.bars[0].time, '2026-08-12T00:45:00.000Z');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('restored immutable ledger stays resident and adjusted lineage remains exact across cutoffs and appends', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-lineage-cache-'));
  try {
    const ledgerDir = path.join(root, 'live-events'); fs.mkdirSync(ledgerDir);
    const ledger = path.join(ledgerDir, '2026-08-12.ndjson');
    const tick = record('2026-08-12T08:45:01.000', 100, 2);
    tick.receivedAt = '2026-08-12T08:45:00.900+08:00';
    fs.writeFileSync(ledger, JSON.stringify(tick) + '\n');
    const options = {dataRoot:root, cacheRoot:path.join(root,'cache'), calendar, timeframe:'5m', tradeDate:'2026-08-12', session:'DAY', asOf:'2026-08-12T09:00:00+08:00'};
    const first = loadTxDecisionChart(options);
    clearTxChartLedgerCache();
    const restored = readTxLiveEventLedger(ledger,{cacheRoot:options.cacheRoot});
    assert.equal(restored[0], readTxLiveEventLedger(ledger,{cacheRoot:options.cacheRoot})[0]);
    assert.deepEqual(loadTxDecisionChart(options), first);
    assert.equal(first.timeLineageViolationCount, 1);
    assert.equal(first.qualityStatus, 'QUALITY_INSUFFICIENT');
    const earlier = {...options, asOf:'2026-08-12T08:45:00+08:00'};
    assert.equal(loadTxDecisionChart(earlier).sourceEventCount, 0);
    const next = record('2026-08-12T08:46:01.000', 101, 3);
    next.receivedAt = '2026-08-12T08:46:00.900+08:00';
    fs.appendFileSync(ledger, JSON.stringify(next) + '\n');
    const warm = loadTxDecisionChart(options);
    clearTxChartLedgerCache();
    assert.deepEqual(loadTxDecisionChart(options), warm);
    assert.equal(warm.sourceEventCount, 2);
    assert.equal(warm.timeLineageViolationCount, 2);
    assert.equal(warm.bars[0].volume, 5);
    assert.deepEqual(loadTxDecisionChart({...options,calendar:structuredClone(calendar)}),warm);
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
});

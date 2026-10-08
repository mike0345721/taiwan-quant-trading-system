import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildLiveBasis, buildLiveRvol, buildMarketPulseLive } from '../src/market-pulse-live.mjs';

let root;

test.beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru59-market-pulse-'));
});

test.afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

function writeDay(date, volume, { session = 'day', slot = '01:00' } = {}) {
  const suffix = session === 'day' ? 'day' : 'night';
  const payload = {
    schemaVersion: '1.0.0', product: 'TX', contract: '202609', session,
    bars: [{ timestamp: `${date}T${slot}:00.000Z`, open: 100, high: 101, low: 99, close: 100, volume }],
  };
  fs.writeFileSync(path.join(root, `${date}-${suffix}.json`), JSON.stringify(payload));
  if (session === 'day') {
    fs.writeFileSync(path.join(root, `${date}-audit.json`), JSON.stringify({ state: 'passed' }));
  }
}

function safeIndex({ date = '2026-09-30', close = 47940.13, receivedAt = '2026-09-30T05:29:00.000Z' } = {}) {
  return {
    data: {
      IX0001: {
        receivedAt,
        clockSkewMs: 0,
        formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
        payload: { date, close },
      },
    },
  };
}
test('completed 5m RVOL uses exactly 20 earlier audited same-session same-slot medians', () => {
  for (let index = 1; index <= 20; index += 1) {
    writeDay(`2026-08-${String(index).padStart(2, '0')}`, 90 + index);
  }
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    bars: [
      { time: '2026-09-30T01:00:00.000Z', volume: 200, availableAt: '2026-09-30T01:04:59.000Z' },
      { time: '2026-09-30T01:05:00.000Z', volume: 20, availableAt: '2026-09-30T01:06:00.000Z' },
    ],
  };
  const result = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:06:00.000Z') });
  assert.equal(result.state, 'READY');
  assert.equal(result.sampleDays, 20);
  assert.equal(result.currentVolume, 200);
  assert.equal(result.baselineMedian, 100.5);
  assert.ok(Math.abs(result.ratio - 200 / 100.5) < 1e-12);
  assert.equal(result.percentile, 100);
  assert.equal(result.completedBarTime, '2026-09-30T01:00:00.000Z');
  assert.equal(result.baselineMethod, 'MEDIAN_SAME_SESSION_SAME_5M_SLOT_PRIOR_20_AUDITED_DAYS');
});

test('forming 5m bar is never compared to a completed historical 5m baseline', () => {
  for (let index = 1; index <= 20; index += 1) {
    writeDay(`2026-08-${String(index).padStart(2, '0')}`, 100);
  }
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    bars: [{ time: '2026-09-30T01:05:00.000Z', volume: 500, availableAt: '2026-09-30T01:06:00.000Z' }],
  };
  const result = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:06:00.000Z') });
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.reason, 'NO_COMPLETED_5M_BAR');
});
test('RVOL stays BASELINE_NOT_READY with only 19 audited prior sessions', () => {
  for (let index = 1; index <= 19; index += 1) {
    writeDay(`2026-08-${String(index).padStart(2, '0')}`, 100);
  }
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    bars: [{ time: '2026-09-30T01:00:00.000Z', volume: 180, availableAt: '2026-09-30T01:04:59.000Z' }],
  };
  const result = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:06:00.000Z') });
  assert.equal(result.state, 'BASELINE_NOT_READY');
  assert.equal(result.sampleDays, 19);
  assert.equal(result.ratio, null);
  assert.equal(result.currentVolume, 180);
});

test('RVOL fails closed when the current chart source is stale', () => {
  for (let index = 1; index <= 20; index += 1) {
    writeDay(`2026-08-${String(index).padStart(2, '0')}`, 100);
  }
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    availableAt: '2026-09-30T01:00:00.000Z',
    bars: [{ time: '2026-09-30T00:55:00.000Z', volume: 180, availableAt: '2026-09-30T00:59:59.000Z' }],
  };
  const result = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:06:00.000Z') });
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.reason, 'RVOL_SOURCE_STALE');
});

test('reconnected fresh chart cannot label an old selected completed bar READY', () => {
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    availableAt: '2026-09-30T02:57:59.792Z',
    bars: [
      { time: '2026-09-30T01:10:00.000Z', volume: 1, availableAt: '2026-09-30T01:14:57.708Z' },
      { time: '2026-09-30T02:55:00.000Z', volume: 8, availableAt: '2026-09-30T02:57:59.792Z' },
    ],
  };
  const rvol = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T02:58:00.678Z') });
  assert.equal(rvol.state, 'UNAVAILABLE');
  assert.equal(rvol.reason, 'RVOL_COMPLETED_SLOT_NOT_CURRENT');
  assert.equal(rvol.completedBarTime, '2026-09-30T01:10:00.000Z');
  assert.equal(rvol.expectedCompletedBarTime, '2026-09-30T02:50:00.000Z');
  assert.equal(rvol.ratio, null);
});

test('RVOL refuses a missing intermediate completed slot after capture gap', () => {
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    availableAt: '2026-09-30T01:15:50.000Z',
    bars: [
      { time: '2026-09-30T01:00:00.000Z', volume: 180, availableAt: '2026-09-30T01:04:59.000Z' },
      { time: '2026-09-30T01:10:00.000Z', volume: 120, availableAt: '2026-09-30T01:14:59.000Z' },
      { time: '2026-09-30T01:15:00.000Z', volume: 10, availableAt: '2026-09-30T01:15:50.000Z' },
    ],
  };
  const rvol = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:16:00.000Z') });
  assert.equal(rvol.state, 'UNAVAILABLE');
  assert.equal(rvol.reason, 'RVOL_COMPLETED_SERIES_GAP');
  assert.equal(rvol.cumulativeRatio, null);
});

test('RVOL refuses a completed bar with unknown availability despite a live forming bar', () => {
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    availableAt: '2026-09-30T01:06:00.000Z',
    bars: [
      { time: '2026-09-30T01:00:00.000Z', volume: 180 },
      { time: '2026-09-30T01:05:00.000Z', volume: 10, availableAt: '2026-09-30T01:06:00.000Z' },
    ],
  };
  const rvol = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:06:00.000Z') });
  assert.equal(rvol.state, 'UNAVAILABLE');
  assert.equal(rvol.reason, 'RVOL_COMPLETED_BAR_AVAILABILITY_MISSING');
});

test('RVOL with partial observed session prefix never claims a cumulative ratio', () => {
  for (let day = 1; day <= 20; day += 1) writeDay(`2026-08-${String(day).padStart(2, '0')}`, 100);
  const chart = {
    timeframe: '5m', tradeDate: '2026-09-30', session: 'DAY',
    bars: [
      { time: '2026-09-30T01:00:00.000Z', volume: 200, availableAt: '2026-09-30T01:04:59.000Z' },
      { time: '2026-09-30T01:05:00.000Z', volume: 5, availableAt: '2026-09-30T01:06:00.000Z' },
    ],
  };
  const rvol = buildLiveRvol({ chart, archiveDir: root, now: new Date('2026-09-30T01:06:00.000Z') });
  assert.equal(rvol.state, 'READY');
  assert.equal(rvol.currentVolume, 200);
  assert.equal(rvol.cumulativeRatio, null);
  assert.equal(rvol.cumulativeVolume, null);
  assert.equal(rvol.cumulativeCoverage, 'SESSION_PREFIX_UNVERIFIED');
});

test('DAY basis requires same-day fresh TX and IX0001 observations', () => {
  const chart = {
    session: 'DAY', tradeDate: '2026-09-30', actualContract: 'TXFJ6',
    lastPrice: 48000, availableAt: '2026-09-30T05:29:30.000Z', bars: [],
  };
  const result = buildLiveBasis({
    chart,
    bridgeLatest: safeIndex(),
    now: new Date('2026-09-30T05:30:00.000Z'),
  });
  assert.equal(result.state, 'LIVE');
  assert.equal(result.label, '盤中基差');
  assert.equal(result.referenceMode, 'LIVE_IX0001');
  assert.ok(Math.abs(result.points - 59.87) < 1e-9);
  assert.equal(result.spotTradeDate, '2026-09-30');
});

test('DAY basis fails closed when the cash reference is stale or date-mismatched', () => {
  const chart = {
    session: 'DAY', tradeDate: '2026-09-30', actualContract: 'TXFJ6',
    lastPrice: 48000, availableAt: '2026-09-30T05:29:30.000Z', bars: [],
  };
  const stale = buildLiveBasis({
    chart,
    bridgeLatest: safeIndex({ receivedAt: '2026-09-30T05:20:00.000Z' }),
    now: new Date('2026-09-30T05:30:00.000Z'),
  });
  assert.equal(stale.state, 'UNAVAILABLE');
  assert.equal(stale.reason, 'BASIS_SOURCE_STALE');
  const mismatch = buildLiveBasis({
    chart,
    bridgeLatest: safeIndex({ date: '2026-09-29' }),
    now: new Date('2026-09-30T05:30:00.000Z'),
  });
  assert.equal(mismatch.reason, 'BASIS_TRADE_DATE_MISMATCH');
});

test('DAY basis refuses a delayed provider timestamp and cash-closed time', () => {
  const chart = {
    session: 'DAY', tradeDate: '2026-09-30', actualContract: 'TXFJ6',
    lastPrice: 48000, availableAt: '2026-09-30T05:29:30.000Z', bars: [],
  };
  const delayed = safeIndex();
  delayed.data.IX0001.clockSkewMs = 180_000;
  const lineage = buildLiveBasis({
    chart, bridgeLatest: delayed, now: new Date('2026-09-30T05:30:00.000Z'),
  });
  assert.equal(lineage.state, 'UNAVAILABLE');
  assert.equal(lineage.reason, 'BASIS_SPOT_TIMESTAMP_LINEAGE_INSUFFICIENT');

  const afterClose = buildLiveBasis({
    chart: { ...chart, availableAt: '2026-09-30T06:05:00.000Z' },
    bridgeLatest: safeIndex({ receivedAt: '2026-09-30T06:05:00.000Z' }),
    now: new Date('2026-09-30T06:05:30.000Z'),
  });
  assert.equal(afterClose.state, 'UNAVAILABLE');
  assert.equal(afterClose.reason, 'CASH_SESSION_CLOSED');
});
test('NIGHT basis is labeled as the gap versus the previous cash close, never LIVE spot basis', () => {
  const chart = {
    session: 'NIGHT', tradeDate: '2026-10-01', actualContract: 'TXFJ6',
    lastPrice: 48350, availableAt: '2026-09-30T10:30:00.000Z',
    bars: [{ sessionId: '2026-09-30-NIGHT' }],
  };
  const result = buildLiveBasis({
    chart,
    bridgeLatest: safeIndex({
      date: '2026-09-30',
      close: 47940.13,
      receivedAt: '2026-09-30T06:31:12.041Z',
    }),
    now: new Date('2026-09-30T10:31:00.000Z'),
  });
  assert.equal(result.state, 'SESSION_CLOSED_REFERENCE');
  assert.equal(result.label, '夜盤對現貨收盤差');
  assert.equal(result.referenceMode, 'LAST_CASH_CLOSE');
  assert.ok(Math.abs(result.points - 409.87) < 1e-9);
});

test('NIGHT cash reference date must match the night-session start date', () => {
  const chart = {
    session: 'NIGHT', tradeDate: '2026-10-01', actualContract: 'TXFJ6',
    lastPrice: 48350, availableAt: '2026-09-30T10:30:00.000Z',
    bars: [{ sessionId: '2026-09-30-NIGHT' }],
  };
  const result = buildLiveBasis({
    chart,
    bridgeLatest: safeIndex({ date: '2026-09-29' }),
    now: new Date('2026-09-30T10:31:00.000Z'),
  });
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.reason, 'NIGHT_CASH_REFERENCE_DATE_MISMATCH');
});

test('NIGHT gap also fails closed when the futures source is stale', () => {
  const chart = {
    session: 'NIGHT', tradeDate: '2026-10-01', actualContract: 'TXFJ6',
    lastPrice: 48350, availableAt: '2026-09-30T10:20:00.000Z',
    bars: [{ sessionId: '2026-09-30-NIGHT' }],
  };
  const result = buildLiveBasis({
    chart,
    bridgeLatest: safeIndex({ date: '2026-09-30' }),
    now: new Date('2026-09-30T10:31:00.000Z'),
  });
  assert.equal(result.state, 'UNAVAILABLE');
  assert.equal(result.reason, 'FUTURES_SOURCE_STALE');
});

test('pulse retains governed identity and availability without inventing missing values', () => {
  const chart = { actualContract: 'TXFJ6', tradeDate: '2026-10-08', session: 'NIGHT', availableAt: '2026-10-07T13:00:00Z' };
  const pulse = buildMarketPulseLive({chart, archiveDir: root, now: new Date('2026-10-07T13:00:01Z')});
  assert.deepEqual(pulse.identity, {actualContract:'TXFJ6',tradeDate:'2026-10-08',session:'NIGHT'});
  assert.equal(pulse.sourceAvailableAt, chart.availableAt);
  const missing = buildMarketPulseLive({archiveDir:root});
  assert.deepEqual(missing.identity, {actualContract:null,tradeDate:null,session:null});
  assert.equal(missing.sourceAvailableAt,null);
  assert.equal(pulse.executionAuthorized,false);
});

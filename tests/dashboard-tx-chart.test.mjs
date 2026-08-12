import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import {
  CHART_BAR_CONTRACT,
  aggregateChartBars,
  buildOneMinuteBars,
  buildTxDecisionChart,
  classifyTxChartSession,
} from '../src/dashboard-tx-chart.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));

function tick(timestamp, close, volume = 1, overrides = {}) {
  return {
    schemaVersion: '1.0.0', provider: 'shioaji', kind: 'futures_tick', code: 'TXFH6', product: 'TXFH6',
    receivedAt: `${timestamp}+08:00`, exchangeTimestamp: timestamp, eventId: `${timestamp}-${close}-${volume}`,
    duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code: 'TXFH6', datetime: timestamp, close: String(close), volume, simtrade: false,
      _product_family: 'TX', _target_code: 'TXFH6',
    },
    ...overrides,
  };
}

const dayTicks = [
  tick('2026-08-12T08:45:10.000', 100, 2),
  tick('2026-08-12T08:45:50.000', 102, 3),
  tick('2026-08-12T08:46:01.000', 99, 1),
  tick('2026-08-12T08:50:00.000', 104, 4),
  tick('2026-08-12T08:59:59.000', 98, 2),
  tick('2026-08-12T09:00:00.000', 110, 1),
  tick('2026-08-12T09:45:00.000', 108, 2),
  tick('2026-08-12T12:45:00.000', 106, 2),
];

test('CHART_BAR_CONTRACT_V2 freezes 1m base and Owner-approved NIGHT_PLUS_DAY 1D semantics', () => {
  assert.equal(CHART_BAR_CONTRACT.baseTimeframe, '1m');
  assert.deepEqual(CHART_BAR_CONTRACT.supportedTimeframes, ['1m', '5m', '15m', '30m', '1h', '4h', '1D']);
  assert.equal(CHART_BAR_CONTRACT.dailySemantics, 'NIGHT_PLUS_DAY_TRADE_DATE');
  assert.equal(CHART_BAR_CONTRACT.executionAuthorized, false);
});

test('DAY and NIGHT use governed trade-date semantics across midnight', () => {
  const day = classifyTxChartSession('2026-08-12T08:45:00.000', calendar);
  assert.equal(day.session, 'DAY');
  assert.equal(day.sessionTradeDate, '2026-08-12');
  const nightOpen = classifyTxChartSession('2026-08-12T15:00:00.000', calendar);
  const afterMidnight = classifyTxChartSession('2026-08-13T00:30:00.000', calendar);
  assert.equal(nightOpen.session, 'NIGHT');
  assert.equal(nightOpen.sessionTradeDate, '2026-08-13');
  assert.equal(afterMidnight.sessionId, nightOpen.sessionId);
  assert.equal(afterMidnight.sessionTradeDate, nightOpen.sessionTradeDate);
  assert.equal(afterMidnight.crossMidnight, true);
});

test('1m bars preserve governed OHLCV, lineage and missing volume is not fabricated as zero', () => {
  const missingVolume = tick('2026-08-12T08:47:00.000', 120, null);
  const result = buildOneMinuteBars([...dayTicks.slice(0, 3), missingVolume], { calendar, asOf: '2026-08-12T09:00:00+08:00' });
  assert.equal(result.bars.length, 2);
  assert.deepEqual(result.bars[0], {
    time: '2026-08-12T00:45:00.000Z', tradeDate: '2026-08-12', sessionTradeDate: '2026-08-12',
    session: 'DAY', sessionId: '2026-08-12-DAY', sessionStart: '2026-08-12T00:45:00.000Z', sessionEnd: '2026-08-12T05:45:00.000Z',
    actualContract: 'TXFH6', contractMonth: '202608', open: 100, high: 102, low: 100, close: 102,
    volume: 5, firstEventTime: '2026-08-12T00:45:10.000Z', lastEventTime: '2026-08-12T00:45:50.000Z',
    availableAt: '2026-08-12T00:45:50.000Z', qualityStatus: 'PASS', eventCount: 2, sequenceGapCount: 0,
  });
  assert.equal(result.bars.some((bar) => bar.volume === 0), false);
  assert.equal(result.futureDataViolations, 0);
});

test('5m, 15m, 30m, 1h and 4h aggregate only from the same 1m contract/session with fixed session anchors', () => {
  const base = buildOneMinuteBars(dayTicks, { calendar, asOf: '2026-08-12T13:45:00+08:00' });
  const expectations = { '5m': 6, '15m': 4, '30m': 3, '1h': 3, '4h': 2 };
  for (const [timeframe, expected] of Object.entries(expectations)) {
    const result = aggregateChartBars(base.internalBars, timeframe);
    assert.equal(result.status, 'READY');
    assert.equal(result.bars.length, expected, timeframe);
    assert.equal(result.bars.every((bar) => bar.actualContract === 'TXFH6' && bar.session === 'DAY'), true);
  }
  assert.equal(aggregateChartBars(base.internalBars, '1h').bars[0].time, '2026-08-12T00:45:00.000Z');
  assert.equal(aggregateChartBars(base.internalBars, '4h').bars[1].time, '2026-08-12T04:45:00.000Z');
});

test('same tick input is deterministic for LIVE/REPLAY, VWAP and frozen 08:45-09:00 OR', () => {
  const options = { calendar, timeframe: '5m', asOf: '2026-08-12T10:00:00+08:00', tradeDate: '2026-08-12', session: 'DAY' };
  const live = buildTxDecisionChart(dayTicks, { ...options, mode: 'LIVE' });
  const replay = buildTxDecisionChart(dayTicks, { ...options, mode: 'REPLAY' });
  assert.deepEqual(live.bars, replay.bars);
  assert.deepEqual(live.vwap, replay.vwap);
  assert.equal(live.openingRange.high, 104);
  assert.equal(live.openingRange.low, 98);
  assert.equal(live.openingRange.availableAt, '2026-08-12T01:00:00.000Z');
  assert.equal(live.levels.openingRangeHigh.value, 104);
  assert.equal(live.levels.openingRangeLow.value, 98);
  assert.equal(live.vwap.at(-1).value, (100 * 2 + 102 * 3 + 99 + 104 * 4 + 98 * 2 + 110 + 108 * 2) / 15);
  assert.equal(live.futureDataViolations, 0);
});

test('replay as-of excludes future ticks and cannot reveal future levels', () => {
  const result = buildTxDecisionChart(dayTicks, {
    calendar, timeframe: '5m', asOf: '2026-08-12T08:55:00+08:00', tradeDate: '2026-08-12', session: 'DAY', mode: 'REPLAY',
  });
  assert.equal(result.futureExcluded, 4);
  assert.equal(result.openingRange.status, 'FORMING');
  assert.equal(result.levels.openingRangeHigh.availability, 'UNAVAILABLE');
  assert.equal(result.lastPrice, 104);
});

test('invalid availableAt lineage is excluded and degrades quality without leaking future evidence', () => {
  const invalid = tick('2026-08-12T09:01:00.000', 101, 1, {
    receivedAt: '2026-08-12T09:00:59.000+08:00',
  });
  const valid = tick('2026-08-12T09:02:00.000', 102, 1);
  const result = buildTxDecisionChart([invalid, valid], {
    calendar,
    timeframe: '1m',
    tradeDate: '2026-08-12',
    session: 'DAY',
    asOf: '2026-08-12T10:00:00+08:00',
  });
  assert.equal(result.sourceEventCount, 1);
  assert.equal(result.timeLineageViolationCount, 1);
  assert.equal(result.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.deepEqual(result.qualityReasons, ['TIMESTAMP_LINEAGE_INSUFFICIENT']);
  assert.equal(result.sequenceGapEventCount, 0);
  assert.equal(result.sequenceGapSize, 0);
  assert.equal(result.futureDataViolations, 0);
});

test('contract rollover is explicit and different actual contracts never mix into one bar', () => {
  const next = tick('2026-08-12T13:00:00.000', 200, 1, {
    product: 'TXFI6', code: 'TXFI6', payload: { code: 'TXFI6', datetime: '2026-08-12T13:00:00.000', close: '200', volume: 1, simtrade: false, _product_family: 'TX', _target_code: 'TXFI6' },
  });
  const result = buildTxDecisionChart([...dayTicks, next], {
    calendar, timeframe: '5m', asOf: '2026-08-12T13:30:00+08:00', tradeDate: '2026-08-12', session: 'DAY', mode: 'LIVE',
  });
  assert.equal(result.actualContract, 'TXFI6');
  assert.equal(result.status, 'QUALITY_INSUFFICIENT');
  assert.equal(result.reason, 'SESSION_CONTRACT_CHANGE_DETECTED');
  assert.equal(result.contractRollover.detected, true);
  assert.deepEqual(result.contractRollover.excludedContracts, ['TXFH6']);
  assert.equal(result.bars.every((bar) => bar.actualContract === 'TXFI6'), true);
});

test('NIGHT OR remains not applicable', () => {
  const night = [tick('2026-08-12T15:00:01.000', 100, 1), tick('2026-08-13T00:30:00.000', 101, 2)];
  const result = buildTxDecisionChart(night, {
    calendar, timeframe: '1h', asOf: '2026-08-13T01:00:00+08:00', tradeDate: '2026-08-13', session: 'NIGHT', mode: 'REPLAY',
  });
  assert.equal(result.session, 'NIGHT');
  assert.equal(result.openingRange.status, 'NOT_APPLICABLE');
});

const tradeDateTicks = [
  tick('2026-08-11T15:00:01.000', 100, 2),
  tick('2026-08-12T04:59:59.000', 103, 3),
  ...dayTicks,
];

test('1D combines governed cross-midnight NIGHT and DAY of one sessionTradeDate with stable identity', () => {
  const result = buildTxDecisionChart(tradeDateTicks, {
    calendar, timeframe: '1D', asOf: '2026-08-12T13:45:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  });
  assert.equal(result.status, 'READY');
  assert.equal(result.windowState, 'CLOSED');
  assert.equal(result.coverageState, 'COMPLETE');
  assert.equal(result.session, 'NIGHT_PLUS_DAY');
  assert.equal(result.sessionId, '2026-08-12-TRADE_DATE');
  assert.equal(result.bars[0].time, '2026-08-11T16:00:00.000Z');
  assert.equal(result.bars[0].firstEventTime, '2026-08-11T07:00:01.000Z');
  assert.equal(result.bars[0].lastEventTime, '2026-08-12T04:45:00.000Z');
  assert.equal(result.bars[0].open, 100);
  assert.equal(result.bars[0].high, 110);
  assert.equal(result.bars[0].low, 98);
  assert.equal(result.bars[0].close, 106);
  assert.equal(result.bars[0].volume, tradeDateTicks.reduce((sum, row) => sum + row.payload.volume, 0));
  assert.equal(result.sessionCoverage.night.eventCount, 2);
  assert.equal(result.sessionCoverage.day.eventCount, dayTicks.length);
  assert.equal(result.futureDataViolations, 0);
  assert.deepEqual(result, buildTxDecisionChart(tradeDateTicks, {
    calendar, timeframe: '1D', asOf: '2026-08-12T13:45:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  }));
});

test('1D remains FORMING before DAY close and excludes future exchange/available ticks', () => {
  const delayed = tick('2026-08-12T09:05:00.000', 150, 5, { receivedAt: '2026-08-12T10:05:00.000+08:00' });
  const result = buildTxDecisionChart([...tradeDateTicks, delayed], {
    calendar, timeframe: '1D', asOf: '2026-08-12T09:30:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  });
  assert.equal(result.status, 'FORMING');
  assert.equal(result.windowState, 'FORMING');
  assert.equal(result.lastPrice, 110);
  assert.ok(result.futureExcluded > 0);
  assert.equal(result.futureDataViolations, 0);
});

test('1D missing NIGHT preserves a partial DAY bar and cannot become READY', () => {
  const result = buildTxDecisionChart(dayTicks, {
    calendar, timeframe: '1D', asOf: '2026-08-12T13:45:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  });
  assert.equal(result.status, 'QUALITY_INSUFFICIENT');
  assert.equal(result.coverageState, 'PARTIAL');
  assert.equal(result.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.ok(result.qualityReasons.includes('NIGHT_SESSION_MISSING'));
  assert.equal(result.bars.length, 1);
  assert.equal(result.sessionCoverage.night.eventCount, 0);
});

test('1D contract mismatch fails closed and never mixes NIGHT with DAY', () => {
  const changedDay = dayTicks.map((row) => ({
    ...row,
    product: 'TXFI6',
    code: 'TXFI6',
    payload: { ...row.payload, code: 'TXFI6', _target_code: 'TXFI6' },
  }));
  const result = buildTxDecisionChart([...tradeDateTicks.slice(0, 2), ...changedDay], {
    calendar, timeframe: '1D', asOf: '2026-08-12T13:45:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  });
  assert.equal(result.status, 'UNAVAILABLE');
  assert.equal(result.contractConsistencyState, 'MISMATCH');
  assert.deepEqual(result.bars, []);
  assert.equal(result.sessionCoverage.night.actualContract, 'TXFH6');
  assert.equal(result.sessionCoverage.day.actualContract, 'TXFI6');
});

test('1D VWAP remains session-only and switches from NIGHT to DAY without creating combined VWAP', () => {
  const nightOnly = buildTxDecisionChart(tradeDateTicks.slice(0, 2), {
    calendar, timeframe: '1D', asOf: '2026-08-12T05:00:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  });
  assert.equal(nightOnly.vwapSession, 'NIGHT');
  assert.equal(nightOnly.levels.vwap.vwapSession, 'NIGHT');
  const withDay = buildTxDecisionChart(tradeDateTicks, {
    calendar, timeframe: '1D', asOf: '2026-08-12T13:45:00+08:00', tradeDate: '2026-08-12', mode: 'REPLAY',
  });
  assert.equal(withDay.vwapSession, 'DAY');
  assert.equal(withDay.levels.vwap.vwapSession, 'DAY');
  assert.equal(withDay.levels.vwap.source, 'SESSION_EXACT_TX_TICK_VWAP');
  assert.notEqual(withDay.vwap[0].value, (100 * 2 + 103 * 3 + dayTicks.reduce((sum, row) => sum + Number(row.payload.close) * row.payload.volume, 0))
    / tradeDateTicks.reduce((sum, row) => sum + row.payload.volume, 0));
});

test('null native sequence never fabricates a gap and timestamp violations use the correct quality reason', () => {
  const valid = tick('2026-08-12T09:02:00.000', 102, 1, { sequence: null, sequenceGap: 0 });
  const invalid = tick('2026-08-12T09:01:00.000', 101, 1, { receivedAt: '2026-08-12T09:00:59.000+08:00', sequence: null, sequenceGap: 0 });
  const result = buildTxDecisionChart([invalid, valid], {
    calendar, timeframe: '1m', tradeDate: '2026-08-12', session: 'DAY', asOf: '2026-08-12T10:00:00+08:00',
  });
  assert.equal(result.sequenceGapEventCount, 0);
  assert.equal(result.sequenceGapSize, 0);
  assert.deepEqual(result.qualityReasons, ['TIMESTAMP_LINEAGE_INSUFFICIENT']);
  assert.equal(result.qualityReasons.includes('TX_TICK_GAP'), false);
});

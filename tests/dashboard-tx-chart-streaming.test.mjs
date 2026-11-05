import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { buildOneMinuteBars, buildTxDecisionChart, buildTxDecisionChartStreaming,
  buildTxDecisionChartFromOrderedTicks, compareTxChartTicks } from '../src/dashboard-tx-chart.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const defaults = { calendar, tradeDate: '2026-08-13', session: 'DAY',
  timeframe: '5m', asOf: '2026-08-13T13:45:00+08:00' };

function tick(timestamp, close = 100, volume = 1, overrides = {}) {
  const contract = overrides.product || 'TXFH6';
  return { kind: 'futures_tick', product: contract, receivedAt: `${timestamp}+08:00`,
    exchangeTimestamp: timestamp, eventId: `${timestamp}-${close}-${volume}`,
    duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    ...overrides,
    payload: { code: contract, datetime: timestamp, close, volume, simtrade: false,
      _product_family: 'TX', _target_code: contract, ...overrides.payload } };
}

// The production disk iterator has this same stable ordering contract. Keep the
// array oracle's full calculation independent of the new summary/reducer path.
function ordered(records) {
  return records.map((record) => ({ record, key: buildOneMinuteBars([record], { calendar }).ticks[0] }))
    .sort((left, right) => !left.key ? (!right.key ? 0 : -1)
      : !right.key ? 1 : compareTxChartTicks(left.key, right.key))
    .map(({ record }) => record);
}

function parity(records, options = {}) {
  const config = { ...defaults, ...options };
  const sorted = ordered(records);
  let iterations = 0;
  const iterable = { *[Symbol.iterator]() { assert.equal(++iterations, 1); yield* sorted; } };
  const actual = buildTxDecisionChartStreaming(iterable, config);
  const expected = buildTxDecisionChart(records, config);
  assert.deepEqual(actual, expected);
  assert.equal(iterations, 1);
  const normalized = buildOneMinuteBars(records, { calendar });
  let normalizedIterations = 0;
  const fromCache = { *[Symbol.iterator]() {
    assert.equal(++normalizedIterations, 1);
    for (const row of [...normalized.timeLineageViolations, ...normalized.ticks]) {
      // Cache decode yields plain objects rather than normalizer-frozen objects.
      yield JSON.parse(JSON.stringify(row));
    }
  } };
  assert.deepEqual(buildTxDecisionChartFromOrderedTicks(fromCache, config), expected);
  assert.equal(normalizedIterations, 1);
  return actual;
}

const sessions = [
  tick('2026-08-12T15:00:00.000', 90, 2),
  tick('2026-08-12T23:59:59.999', 95, 3),
  tick('2026-08-13T00:00:00.000', 92, 1),
  tick('2026-08-13T05:00:00.000', 93, 4),
  tick('2026-08-13T08:45:00.000', 100, 2),
  tick('2026-08-13T08:45:40.000', 102, 3),
  tick('2026-08-13T08:46:00.000', 99, 1),
  tick('2026-08-13T08:59:59.999', 98, 2),
  tick('2026-08-13T09:00:00.000', 110, 1),
  tick('2026-08-13T13:45:00.000', 107, 4),
];

test('streaming matches every timeframe across midnight, close boundaries and NIGHT_PLUS_DAY', () => {
  for (const timeframe of ['1m', '5m', '15m', '30m', '1h', '4h', '1D']) {
    for (const session of ['DAY', 'NIGHT', null]) {
      parity([...sessions].reverse(), { timeframe, session });
    }
  }
  const night = parity(sessions, { session: 'NIGHT', timeframe: '1m' });
  assert.equal(night.bars.at(-1).time, '2026-08-12T20:59:00.000Z');
  assert.equal(night.bars.at(-1).close, 93);
  const daily = parity(sessions, { timeframe: '1D' });
  assert.equal(daily.sourceEventCount, 10);
  assert.equal(daily.bars[0].open, 90);
  assert.equal(daily.bars[0].close, 107);
  assert.equal(daily.bars[0].volume, 23);
  assert.equal(daily.openingRange.high, 102);
  assert.equal(daily.openingRange.low, 98);
  assert.equal(daily.qualityStatus, 'PASS');
});

test('historical cutoff excludes future event/receipt without losing scoped negative lineage and gaps', () => {
  const records = [...sessions,
    tick('2026-08-13T08:48:00.000', 120, 2, { receivedAt: '2026-08-13T09:30:00+08:00' }),
    tick('2026-08-13T08:49:00.000', 105, 3, { sequenceGap: 2 }),
    tick('2026-08-13T12:30:00.000', 101, 1, { receivedAt: '2026-08-13T12:29:59+08:00' }),
    tick('2026-08-12T15:00:01.000', 91, 1, { receivedAt: '2026-08-12T15:00:00+08:00' }),
    tick('2026-08-13T08:47:00.000', 1000, 2, { duplicate: true }),
    tick('2026-08-13T08:47:01.000', 1000, 2, { payload: { simtrade: true } }),
    tick('2026-08-13T08:47:02.000', 1000, null),
    { kind: 'provider_event', payload: { eventCode: 12 } },
  ];
  for (const timeframe of ['5m', '1D']) {
    for (const asOf of ['2026-08-13T08:59:00+08:00', '2026-08-13T09:01:00+08:00',
      '2026-08-13T09:30:00+08:00', defaults.asOf]) parity(records, { timeframe, asOf });
  }
  const before = parity(records, { asOf: '2026-08-13T09:01:00+08:00' });
  assert.equal(before.timeLineageViolationCount, 1);
  assert.equal(before.sequenceGapSize, 2);
  assert.equal(before.openingRange.high, 105);
  assert.equal(before.qualityStatus, 'QUALITY_INSUFFICIENT');
  const after = parity(records, { asOf: '2026-08-13T09:30:00+08:00' });
  assert.equal(after.openingRange.high, 120);
  assert.equal(after.openingRange.availableAt, '2026-08-13T01:30:00.000Z');
});

test('contract candidate order, explicit selection, rollover and 1D mismatch retain original semantics', () => {
  const records = [
    tick('2026-08-13T09:00:00.000', 301, 2, { product: 'TXFJ6' }),
    ...sessions,
    tick('2026-08-13T08:46:00.000', 201, 1, { product: 'TXFI6' }),
    tick('2026-08-13T13:45:00.000', 302, 3, { product: 'TXFJ6', eventId: 'zzz-last' }),
  ];
  for (const timeframe of ['1m', '5m', '1D']) {
    for (const actualContract of [null, 'TXFH6', 'TXFI6', 'TXFJ6', 'TXFK6']) {
      parity(records, { timeframe, actualContract });
    }
  }
  const daily = parity(records, { timeframe: '1D' });
  assert.equal(daily.status, 'UNAVAILABLE');
  assert.equal(daily.reason, 'ACTUAL_CONTRACT_MISMATCH');
  assert.equal(daily.bars.length, 0);
  assert.deepEqual(daily.availableContracts, ['TXFH6', 'TXFI6', 'TXFJ6']);
});

test('sub-ms timestamps, receipt tie breaks, locale event IDs and stable equal keys preserve exact OHLC', () => {
  const records = [
    tick('2026-08-13T08:45:00.000999999', 104, 1, { eventId: 'z' }),
    tick('2026-08-13T08:45:00.000000001', 103, 1, { eventId: 'A' }),
    tick('2026-08-13T08:45:00.000123456', 102, 1, { eventId: 'a' }),
    tick('2026-08-13T08:45:00.000222222', 101, 1, { eventId: 'a' }),
    tick('2026-08-13T08:45:00.000333333', 105, 1, { eventId: '0', receivedAt: '2026-08-13T08:45:01+08:00' }),
    tick('2026-08-13T08:46:00.000', 106, 1, { eventId: null }),
    tick('2026-08-13T08:46:00', 107, 1, { eventId: null }),
  ];
  const result = parity(records, { timeframe: '1m' });
  assert.equal(result.bars[0].open, 102);
  assert.equal(result.bars[0].close, 105);
  assert.equal(result.bars[0].eventCount, 5);
});

test('floating-point sums follow sorted true-tick order, including allowed zero/negative prices', () => {
  const records = [
    tick('2026-08-13T08:45:03.000', -0.1, 0.2),
    tick('2026-08-13T08:45:00.000', 1e16, 0.1),
    tick('2026-08-13T08:45:01.000', -1e16, 0.2),
    tick('2026-08-13T08:45:02.000', 0, 0.3),
    tick('2026-08-13T08:46:00.000', 0.3, 0.1),
    tick('2026-08-12T16:00:00.000', 0.7, 0.1),
  ];
  parity(records, { timeframe: '1m' });
  parity(records, { timeframe: '5m' });
  parity(records, { timeframe: '1D' });
  assert.throws(() => buildTxDecisionChartStreaming(records, defaults), /TX_CHART_STREAM_ORDER_INVALID/);
  const normalized = buildOneMinuteBars(records, { calendar }).ticks;
  assert.throws(() => buildTxDecisionChartFromOrderedTicks([...normalized].reverse(), defaults), /TX_CHART_STREAM_ORDER_INVALID/);
});

test('missing sessions, forming OR/day window, empty input and missing requested contract match', () => {
  for (const records of [[], sessions.slice(0, 4), sessions.slice(4), [sessions.at(-1)]]) {
    for (const timeframe of ['5m', '1D']) {
      for (const asOf of ['2026-08-13T08:50:00+08:00', defaults.asOf]) parity(records, { timeframe, asOf });
    }
  }
  parity(sessions, { tradeDate: null, session: null });
  parity(sessions, { tradeDate: null, timeframe: '1D' });
  parity(sessions, { actualContract: 'TXFK6' });
});

test('prior-day identity and execution/calendar/argument validation remain unchanged', () => {
  const priorDay = { actualContract: 'TXFH6', high: { value: 150 }, low: { value: 80 }, close: { value: 91 } };
  parity(sessions, { priorDay });
  parity(sessions, { priorDay: { ...priorDay, actualContract: 'TXFI6' } });
  for (const [records, options, pattern] of [
    [[], { calendar: null }, /TX_CHART_GOVERNED_CALENDAR_REQUIRED/],
    [[], { asOf: 'invalid' }, /TX_CHART_AS_OF_INVALID/],
    [[], { timeframe: '2m' }, /TX_CHART_TIMEFRAME_UNSUPPORTED/],
    [[tick('2026-08-13T08:45:00.000', 100, 1, { executionAuthorized: true })], {}, /TX_CHART_EXECUTION_BOUNDARY_INVALID/],
    [[tick('2026-08-13T14:00:00.000')], {}, /TX_CHART_EVENT_OUTSIDE_GOVERNED_SESSION/],
  ]) {
    assert.throws(() => buildTxDecisionChart(records, { ...defaults, ...options }), pattern);
    assert.throws(() => buildTxDecisionChartStreaming(records, { ...defaults, ...options }), pattern);
  }
});

test('single-pass generated stream counts every real event without a per-tick input array', () => {
  let iterations = 0;
  let emitted = 0;
  const count = 20_001;
  const source = { *[Symbol.iterator]() {
    assert.equal(++iterations, 1);
    for (let index = 0; index < count; index += 1) {
      emitted += 1;
      const time = new Date(Date.parse('2026-08-13T00:45:00Z') + index).toISOString();
      yield tick(time.replace('Z', ''), 100 + index % 7, 1, { receivedAt: time,
        exchangeTimestamp: time, payload: { datetime: time } });
    }
  } };
  const result = buildTxDecisionChartStreaming(source, defaults);
  assert.equal(emitted, count);
  assert.equal(result.sourceEventCount, count);
  assert.equal(result.bars.length, 1);
  assert.equal(result.bars[0].eventCount, count);
  assert.equal(result.bars[0].volume, count);
  assert.equal(result.bars[0].high, 106);
  assert.equal(result.bars[0].low, 100);
  assert.equal(result.executionAuthorized, false);
});

test('seeded mixtures preserve the independent array oracle across scope, session and cutoff choices', () => {
  let seed = 71237;
  const random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);
  const starts = ['2026-08-12T00:45:00Z', '2026-08-12T07:00:00Z', '2026-08-13T00:45:00Z'];
  for (let scenario = 0; scenario < 12; scenario += 1) {
    const records = [];
    for (let index = 0; index < 120; index += 1) {
      const ms = Date.parse(starts[Math.floor(random() * starts.length)]) + Math.floor(random() * 1200) * 1000;
      const at = new Date(ms).toISOString();
      const receivedAt = new Date(ms + (index % 17 === 0 ? -1 : Math.floor(random() * 240_000))).toISOString();
      records.push(tick(at, (random() - 0.2) * 500, random() * 5 + 0.1, {
        receivedAt, eventId: index % 7 === 0 ? null : ['z', 'A', 'a', '0'][index % 4] + index,
        product: index % 11 === 0 ? 'TXFI6' : 'TXFH6', duplicate: index % 19 === 0,
        sequenceGap: [0, null, 0, 2][index % 4], payload: { datetime: at, simtrade: index % 23 === 0 },
      }));
    }
    for (const timeframe of ['1m', '4h', '1D']) {
      parity(records, { timeframe });
      parity(records, { timeframe, tradeDate: null, session: null });
      parity(records, { timeframe, session: 'NIGHT', actualContract: 'TXFI6',
        asOf: '2026-08-13T08:58:00+08:00' });
    }
  }
});

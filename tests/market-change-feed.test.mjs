import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MARKET_CHANGE_DERIVATION_VERSION,
  buildCompletedFiveMinuteObservations,
  buildMarketChangeFeed,
  chartMarkersFromEvents,
  deriveEvidenceChanges,
  groupMarketChangeEvents,
  stableMarketChangeJson,
} from '../src/market-change-feed.mjs';

function observation(overrides = {}) {
  return {
    schemaVersion: 'governed-5m-evidence-observation-v1',
    observationId: 'fixture',
    tradeDate: '2026-08-12',
    sessionTradeDate: '2026-08-12',
    session: 'DAY',
    sessionId: '2026-08-12-DAY',
    actualContract: 'TXFH6',
    barTime: '2026-08-12T01:00:00.000Z',
    observedAt: '2026-08-12T01:05:00.000Z',
    availableAt: '2026-08-12T01:04:59.000Z',
    asOf: '2026-08-12T02:00:00.000Z',
    completed: true,
    price: { open: 100, high: 101, low: 99, close: 100, volume: 10 },
    vwap: { availability: 'AVAILABLE', value: 100, sourceId: 'SESSION_EXACT_TX_TICK_VWAP' },
    openingRange: { availability: 'AVAILABLE', high: 102, low: 98, sourceId: 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900' },
    sessionHigh: 102,
    sessionLow: 98,
    qualityStatus: 'PASS',
    qualityReasons: [],
    dataHealthState: 'FRESH',
    derivationVersion: MARKET_CHANGE_DERIVATION_VERSION,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    ...overrides,
  };
}

function eventTypes(previous, current) {
  return deriveEvidenceChanges(previous, current).map((event) => event.eventType);
}

test('VWAP cross events use completed 5m close evidence in both directions', () => {
  const previous = observation({ price: { open: 99, high: 100, low: 98, close: 99, volume: 10 }, vwap: { availability: 'AVAILABLE', value: 100 } });
  const up = observation({ barTime: '2026-08-12T01:05:00.000Z', observedAt: '2026-08-12T01:10:00.000Z', price: { open: 100, high: 102, low: 100, close: 101, volume: 10 }, vwap: { availability: 'AVAILABLE', value: 100.5 } });
  assert.equal(eventTypes(previous, up).includes('VWAP_CROSS_UP'), true);
  const down = observation({ barTime: '2026-08-12T01:10:00.000Z', observedAt: '2026-08-12T01:15:00.000Z', price: { open: 101, high: 101, low: 98, close: 99, volume: 10 }, vwap: { availability: 'AVAILABLE', value: 100 } });
  assert.equal(eventTypes(up, down).includes('VWAP_CROSS_DOWN'), true);
});

test('Opening Range break and re-entry events are deterministic evidence changes', () => {
  const inside = observation({ price: { open: 100, high: 101, low: 99, close: 100, volume: 10 } });
  const above = observation({ barTime: '2026-08-12T01:05:00.000Z', observedAt: '2026-08-12T01:10:00.000Z', price: { open: 101, high: 104, low: 101, close: 103, volume: 10 }, sessionHigh: 104 });
  const backInside = observation({ barTime: '2026-08-12T01:10:00.000Z', observedAt: '2026-08-12T01:15:00.000Z', price: { open: 103, high: 103, low: 100, close: 101, volume: 10 }, sessionHigh: 104 });
  const below = observation({ barTime: '2026-08-12T01:15:00.000Z', observedAt: '2026-08-12T01:20:00.000Z', price: { open: 100, high: 100, low: 96, close: 97, volume: 10 }, sessionHigh: 104, sessionLow: 96 });
  const recoverInside = observation({ barTime: '2026-08-12T01:20:00.000Z', observedAt: '2026-08-12T01:25:00.000Z', price: { open: 97, high: 100, low: 97, close: 99, volume: 10 }, sessionHigh: 104, sessionLow: 96 });
  assert.equal(eventTypes(inside, above).includes('OR_BREAK_UP'), true);
  assert.equal(eventTypes(above, backInside).includes('OR_REENTRY_FROM_ABOVE'), true);
  assert.equal(eventTypes(backInside, below).includes('OR_BREAK_DOWN'), true);
  assert.equal(eventTypes(below, recoverInside).includes('OR_REENTRY_FROM_BELOW'), true);
});

test('session high/low retain current data trust without inventing historical health transitions', () => {
  const previous = observation();
  const degraded = observation({
    barTime: '2026-08-12T01:05:00.000Z', observedAt: '2026-08-12T01:10:00.000Z',
    price: { open: 100, high: 105, low: 97, close: 100, volume: 10 }, sessionHigh: 105, sessionLow: 97,
    qualityStatus: 'QUALITY_INSUFFICIENT', qualityReasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'],
    dataTrust: { status: 'QUALITY_INSUFFICIENT', reasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'] },
    dataHealthTransitionSupport: 'NOT_SUPPORTED_BY_TIME_LOCAL_EVIDENCE', timeLocalDataHealthState: null,
  });
  const types = eventTypes(previous, degraded);
  assert.equal(types.includes('NEW_SESSION_HIGH'), true);
  assert.equal(types.includes('NEW_SESSION_LOW'), true);
  assert.equal(types.includes('DATA_HEALTH_DEGRADED'), false);
  const events = deriveEvidenceChanges(previous, degraded);
  assert.equal(events.every((event) => event.qualityStatus === 'QUALITY_INSUFFICIENT'), true);
  assert.equal(events.every((event) => event.qualityReasons.includes('TIMESTAMP_LINEAGE_INSUFFICIENT')), true);
  assert.doesNotMatch(JSON.stringify(events), /BUY|SELL|LONG|SHORT|ENTRY|EXIT/);

  const recovered = observation({ barTime: '2026-08-12T01:10:00.000Z', observedAt: '2026-08-12T01:15:00.000Z', sessionHigh: 105, sessionLow: 97 });
  assert.equal(eventTypes(degraded, recovered).includes('DATA_HEALTH_RECOVERED'), false);
});

test('health transitions require explicit governed time-local evidence', () => {
  const previous = observation({ dataHealthTransitionSupport: 'GOVERNED_TIME_LOCAL_EVIDENCE', timeLocalDataHealthState: 'FRESH' });
  const current = observation({
    barTime: '2026-08-12T01:05:00.000Z', observedAt: '2026-08-12T01:10:00.000Z',
    dataHealthTransitionSupport: 'GOVERNED_TIME_LOCAL_EVIDENCE', timeLocalDataHealthState: 'DEGRADED',
  });
  assert.equal(eventTypes(previous, current).includes('DATA_HEALTH_DEGRADED'), true);
});

test('forming, cross-contract, rollover, session boundary and unknown evidence fail closed', () => {
  const previous = observation();
  assert.deepEqual(deriveEvidenceChanges(previous, observation({ completed: false })), []);
  assert.deepEqual(deriveEvidenceChanges(previous, observation({ actualContract: 'TXFJ6' })), []);
  assert.deepEqual(deriveEvidenceChanges(previous, observation({ session: 'NIGHT', sessionId: '2026-08-11-NIGHT' })), []);
  const unknown = observation({
    barTime: '2026-08-12T01:05:00.000Z', observedAt: '2026-08-12T01:10:00.000Z',
    vwap: { availability: 'UNAVAILABLE', value: null }, openingRange: { availability: 'UNAVAILABLE', high: null, low: null },
  });
  assert.equal(eventTypes(previous, unknown).some((type) => type.startsWith('VWAP_') || type.startsWith('OR_')), false);
  assert.deepEqual(deriveEvidenceChanges(previous, observation({
    barTime: '2026-08-12T01:05:00.000Z', observedAt: '2026-08-12T01:10:00.000Z',
    availableAt: '2026-08-12T02:00:01.000Z', asOf: '2026-08-12T02:00:00.000Z',
  })), []);
});

test('NIGHT observations compare across midnight only inside the same governed session', () => {
  const beforeMidnight = observation({
    tradeDate: '2026-08-13', sessionTradeDate: '2026-08-13', session: 'NIGHT', sessionId: '2026-08-12-NIGHT',
    barTime: '2026-08-12T15:55:00.000Z', observedAt: '2026-08-12T16:00:00.000Z', availableAt: '2026-08-12T16:00:00.000Z',
    asOf: '2026-08-12T17:00:00.000Z',
    price: { open: 99, high: 100, low: 98, close: 99, volume: 10 }, vwap: { availability: 'AVAILABLE', value: 100 },
    openingRange: { availability: 'UNAVAILABLE', high: null, low: null },
  });
  const afterMidnight = observation({
    tradeDate: '2026-08-13', sessionTradeDate: '2026-08-13', session: 'NIGHT', sessionId: '2026-08-12-NIGHT',
    barTime: '2026-08-12T16:00:00.000Z', observedAt: '2026-08-12T16:05:00.000Z', availableAt: '2026-08-12T16:05:00.000Z',
    asOf: '2026-08-12T17:00:00.000Z',
    price: { open: 99, high: 102, low: 99, close: 101, volume: 10 }, vwap: { availability: 'AVAILABLE', value: 100 },
    openingRange: { availability: 'UNAVAILABLE', high: null, low: null }, sessionHigh: 102,
  });
  assert.equal(eventTypes(beforeMidnight, afterMidnight).includes('VWAP_CROSS_UP'), true);
  assert.equal(eventTypes(beforeMidnight, afterMidnight).some((type) => type.startsWith('OR_')), false);
});

function chartFixture() {
  return {
    timeframe: '5m', mode: 'REPLAY', tradeDate: '2026-08-12', sessionTradeDate: '2026-08-12',
    session: 'DAY', sessionId: '2026-08-12-DAY', actualContract: 'TXFH6', asOf: '2026-08-12T01:17:00.000Z',
    qualityStatus: 'QUALITY_INSUFFICIENT', qualityReasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'],
    timeLineageViolationCount: 2, sequenceGapEventCount: 0,
    bars: [
      { time: '2026-08-12T01:00:00.000Z', tradeDate: '2026-08-12', sessionTradeDate: '2026-08-12', session: 'DAY', sessionId: '2026-08-12-DAY', actualContract: 'TXFH6', open: 99, high: 101, low: 99, close: 99, volume: 10, availableAt: '2026-08-12T01:04:59.000Z', qualityStatus: 'PASS' },
      { time: '2026-08-12T01:05:00.000Z', tradeDate: '2026-08-12', sessionTradeDate: '2026-08-12', session: 'DAY', sessionId: '2026-08-12-DAY', actualContract: 'TXFH6', open: 99, high: 104, low: 99, close: 103, volume: 11, availableAt: '2026-08-12T01:09:59.000Z', qualityStatus: 'PASS' },
      { time: '2026-08-12T01:10:00.000Z', tradeDate: '2026-08-12', sessionTradeDate: '2026-08-12', session: 'DAY', sessionId: '2026-08-12-DAY', actualContract: 'TXFH6', open: 103, high: 103, low: 100, close: 101, volume: 12, availableAt: '2026-08-12T01:14:59.000Z', qualityStatus: 'PASS' },
      { time: '2026-08-12T01:15:00.000Z', tradeDate: '2026-08-12', sessionTradeDate: '2026-08-12', session: 'DAY', sessionId: '2026-08-12-DAY', actualContract: 'TXFH6', open: 101, high: 110, low: 101, close: 109, volume: 13, availableAt: '2026-08-12T01:16:59.000Z', qualityStatus: 'PASS' },
    ],
    vwap: [
      { time: '2026-08-12T01:00:00.000Z', value: 100, availableAt: '2026-08-12T01:04:59.000Z' },
      { time: '2026-08-12T01:05:00.000Z', value: 100.5, availableAt: '2026-08-12T01:09:59.000Z' },
      { time: '2026-08-12T01:10:00.000Z', value: 101.5, availableAt: '2026-08-12T01:14:59.000Z' },
    ],
    openingRange: { status: 'READY', high: 102, low: 98, actualContract: 'TXFH6', availableAt: '2026-08-12T01:00:00.000Z' },
  };
}

test('feed uses completed bars only, rejects future/forming bar and remains deterministic across replay', () => {
  const chart = chartFixture();
  const observations = buildCompletedFiveMinuteObservations(chart);
  assert.equal(observations.length, 3);
  assert.equal(observations.some((item) => item.barTime === '2026-08-12T01:15:00.000Z'), false);
  assert.equal(observations.every((item) => item.availableAt <= chart.asOf), true);
  const first = buildMarketChangeFeed(chart);
  const second = buildMarketChangeFeed(structuredClone(chart));
  assert.equal(first.logicalHash, second.logicalHash);
  assert.equal(stableMarketChangeJson(first), stableMarketChangeJson(second));
  assert.equal(first.futureDataViolations, 0);
  assert.equal(first.engineAvailability, 'AVAILABLE');
  assert.equal(first.dataTrust.status, 'QUALITY_INSUFFICIENT');
  assert.equal(first.dataTrust.historicalTransitionSupport, 'NOT_SUPPORTED_BY_TIME_LOCAL_EVIDENCE');
  assert.equal(first.events.filter((event) => event.eventType === 'OR_BREAK_UP').length, 1);
  assert.equal(new Set(first.events.map((event) => event.eventId)).size, first.events.length);
  assert.equal(first.events.every((event) => event.formalWeight === 0 && event.researchOnly === true && event.executionAuthorized === false), true);
  const live = buildMarketChangeFeed({ ...structuredClone(chart), mode: 'LIVE' });
  assert.deepEqual(live.events, first.events);
});

test('chart markers are derived from the exact feed events and keep deterministic order', () => {
  const chart = chartFixture();
  const feed = buildMarketChangeFeed(chart);
  const markers = chartMarkersFromEvents(feed.events, chart);
  assert.deepEqual(markers.map((marker) => marker.eventId), feed.events.map((event) => event.eventId));
  assert.equal(markers.every((marker) => !/BUY|SELL|LONG|SHORT|ENTRY|EXIT/.test(marker.text)), true);
  assert.equal(markers.every((marker) => ['#8aa7ff', '#9aa8bd', '#f5c86b'].includes(marker.color)), true);
  for (const timeframe of ['15m', '1h', '1D']) {
    assert.deepEqual(chartMarkersFromEvents(feed.events, { ...chart, timeframe }), []);
  }
});

test('events from the same completed observation are grouped deterministically without scores', () => {
  const feed = buildMarketChangeFeed(chartFixture());
  const groups = groupMarketChangeEvents(feed.events);
  const multiEventGroup = groups.find((group) => group.events.length > 1);
  assert.ok(multiEventGroup);
  assert.equal(multiEventGroup.headline, '價格結構出現變化');
  assert.equal(multiEventGroup.events.every((event) => ['PRIMARY_STRUCTURE', 'SECONDARY_STRUCTURE', 'DATA_TRUST'].includes(event.evidenceGroup)), true);
  assert.doesNotMatch(JSON.stringify(groups), /importanceScore|confidenceScore|directionScore/);
  assert.deepEqual(groups, groupMarketChangeEvents(structuredClone(feed.events)));
});

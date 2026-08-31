import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { buildPriceResponsePathEfficiencyWindow } from '../src/tx-price-response-path-efficiency.mjs';

function tick({ eventTime, receivedAt, hash, price, tradeDate = '2026-08-26', session = 'DAY', code = 'TXFI6' }) {
  return {
    kind: 'futures_tick',
    code,
    product: code,
    receivedAt,
    exchangeTimestamp: eventTime,
    recordHash: hash,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    duplicate: false,
    payload: {
      code,
      productFamily: 'TX',
      actualContract: code,
      eventTime,
      datetime: eventTime,
      tradeDate,
      session,
      simtrade: false,
      price,
      close: price,
      executedVolume: 1,
      volume: 1,
      tick_type: 1,
    },
  };
}

function canonical(records) {
  return materializeTxCanonicalObservations(records, { sourceLedgerIdentity: 'ledger-P3' }).events;
}

test('price response uses first and last eligible tick in physical order', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 102 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 104 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), {
    tickSize: 1, pressureRatio: 0.5,
  });
  assert.equal(output.response.startPrice, 100);
  assert.equal(output.response.endPrice, 104);
  assert.equal(output.response.displacementPoints, 4);
  assert.equal(output.response.displacementTicks, 4);
  assert.equal(output.response.directionRelation, 'SAME_DIRECTION');
});

test('direct monotonic path has efficiency 1', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 101 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 103 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.pathEfficiency.status, 'READY');
  assert.equal(output.pathEfficiency.value, 1);
});

test('noisy path has lower efficiency for same net displacement', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 106 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 98 }),
    tick({ eventTime: '2026-08-26T09:00:30+08:00', receivedAt: '2026-08-26T09:00:30.010+08:00', hash: 'd', price: 104 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.response.displacementPoints, 4);
  assert.equal(output.pathEfficiency.pathLengthPoints, 20);
  assert.equal(output.pathEfficiency.value, 0.2);
});

test('all equal prices produce unavailable zero path', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 100 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.response.directionRelation, 'FLAT_PRICE');
  assert.equal(output.pathEfficiency.status, 'UNAVAILABLE');
  assert.equal(output.pathEfficiency.unavailableReason, 'UNAVAILABLE_ZERO_PATH');
});

test('fewer than three observations keeps response but path efficiency unavailable', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 101 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.response.status, 'READY');
  assert.equal(output.response.displacementPoints, 1);
  assert.equal(output.pathEfficiency.unavailableReason, 'INSUFFICIENT_OBSERVATIONS');
});

test('direct calculator rejects override of frozen minimum path observation count', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 101 }),
  ]);
  assert.throws(() => buildPriceResponsePathEfficiencyWindow(events, events.at(-1), {
    tickSize: 1,
    minPathTickCount: 2,
  }), /CRU34_V1_PATH_CONTRACT_INVALID/);
});

test('direct calculator rejects override of frozen maximum adjacent path gap', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 101 }),
    tick({ eventTime: '2026-08-26T09:00:40.001+08:00', receivedAt: '2026-08-26T09:00:40.011+08:00', hash: 'c', price: 102 }),
  ]);
  assert.throws(() => buildPriceResponsePathEfficiencyWindow(events, events.at(-1), {
    tickSize: 1,
    maxGapMs: 30_001,
  }), /CRU34_V1_PATH_CONTRACT_INVALID/);
});

test('event-time regression fails path efficiency without reordering physical ticks', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:05+08:00', receivedAt: '2026-08-26T09:00:10.020+08:00', hash: 'b', price: 102 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 104 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.response.startPrice, 100);
  assert.equal(output.response.endPrice, 104);
  assert.equal(output.pathEfficiency.status, 'QUALITY_INSUFFICIENT');
  assert.equal(output.pathEfficiency.unavailableReason, 'QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION');
});

test('gap over 30 seconds fails path efficiency closed', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 101 }),
    tick({ eventTime: '2026-08-26T09:00:50.001+08:00', receivedAt: '2026-08-26T09:00:50.011+08:00', hash: 'c', price: 103 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.pathEfficiency.status, 'QUALITY_INSUFFICIENT');
  assert.equal(output.pathEfficiency.unavailableReason, 'QUALITY_INSUFFICIENT_LONG_GAP');
  assert.ok(output.pathEfficiency.maxObservedGapMs > 30_000);
});

test('continuity epoch prevents path window crossing resubscribe boundary', () => {
  const lifecycle = {
    kind: 'quote_type_resubscribe', product: 'bridge',
    receivedAt: '2026-08-26T09:00:15+08:00', recordHash: 'life',
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'bridge', product: 'TX', quoteType: 'BidAsk', actualContract: 'TXFI6' },
  };
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 101 }),
    lifecycle,
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 110 }),
    tick({ eventTime: '2026-08-26T09:00:30+08:00', receivedAt: '2026-08-26T09:00:30.010+08:00', hash: 'd', price: 111 }),
    tick({ eventTime: '2026-08-26T09:00:40+08:00', receivedAt: '2026-08-26T09:00:40.010+08:00', hash: 'e', price: 112 }),
  ]);
  const output = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), { tickSize: 1 });
  assert.equal(output.tickCount, 3);
  assert.equal(output.response.startPrice, 110);
  assert.equal(output.response.endPrice, 112);
  assert.equal(output.pathEfficiency.value, 1);
});

test('response relation distinguishes opposite direction and balanced pressure', () => {
  const events = canonical([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'a', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b', price: 99 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'c', price: 98 }),
  ]);
  const opposite = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), {
    tickSize: 1, pressureRatio: 0.5,
  });
  assert.equal(opposite.response.directionRelation, 'OPPOSITE_DIRECTION');
  const balanced = buildPriceResponsePathEfficiencyWindow(events, events.at(-1), {
    tickSize: 1, pressureRatio: 0,
  });
  assert.equal(balanced.response.directionRelation, 'PRESSURE_UNAVAILABLE');
});

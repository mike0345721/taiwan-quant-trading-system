import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExecutedPressureWindow,
  buildSnapshotLineage,
  evaluateBestQuoteEligibility,
  materializeTxCanonicalObservations,
} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });

function record(kind, {
  eventTime,
  receivedAt,
  hash,
  code = 'TXFI6',
  tradeDate = '2026-08-26',
  session = 'DAY',
  payload = {},
} = {}) {
  return {
    kind,
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
      ...payload,
    },
  };
}

function lifecycle(kind, payload, receivedAt, hash) {
  return {
    kind,
    product: 'bridge',
    receivedAt,
    recordHash: hash,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: { code: 'bridge', ...payload },
  };
}

function chain(records) {
  let previousHash = 'GENESIS';
  return records.map((record) => {
    const linked = { ...record, previousHash };
    previousHash = record.recordHash;
    return linked;
  });
}

test('materializes stable physical ledger ordinal and exact identity', () => {
  const result = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'h1',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 'h2',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' });
  assert.equal(result.events[0].ledgerOrdinal, 1);
  assert.equal(result.events[1].ledgerOrdinal, 2);
  assert.equal(result.events[1].actualContract, 'TXFI6');
  assert.equal(result.events[1].tradeDate, '2026-08-26');
  assert.equal(result.events[1].session, 'DAY');
  assert.equal(result.events[1].continuityEpoch, 'TX:1');
  assert.equal(result.events[1].joinedContinuityStatus, 'USABLE');
});

test('later quote with equal availability cannot classify earlier tick', () => {
  const result = materializeTxCanonicalObservations([
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.200+08:00', hash: 't',
    }),
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00.050+08:00',
      receivedAt: '2026-08-26T09:00:00.200+08:00', hash: 'q',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' });
  const [tick, quote] = result.events;
  const eligibility = evaluateBestQuoteEligibility(quote, tick);
  assert.equal(eligibility.eligible, false);
  assert.equal(eligibility.reason, 'QUOTE_NOT_PHYSICALLY_PRIOR');
});

test('legal prior quote is eligible only after both streams establish epoch', () => {
  const result = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' });
  const [quote, tick] = result.events;
  assert.equal(quote.joinedContinuityStatus, 'WARMING');
  assert.equal(tick.joinedContinuityStatus, 'USABLE');
  assert.equal(evaluateBestQuoteEligibility(quote, tick).eligible, true);
});

test('delayed earlier-event quote is rejected by availability lineage', () => {
  const result = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.300+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.200+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' });
  const [quote, tick] = result.events;
  assert.equal(tick.availabilityLineageStatus, 'INVALID_NON_MONOTONIC_RECEIVED_AT');
  assert.equal(evaluateBestQuoteEligibility(quote, tick).reason, 'AVAILABILITY_LINEAGE_UNUSABLE');
});

test('future-event and stale quotes fail closed', () => {
  const future = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:01+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.500+08:00',
      receivedAt: '2026-08-26T09:00:00.510+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  assert.equal(evaluateBestQuoteEligibility(future[0], future[1]).reason, 'QUOTE_EVENT_TIME_FUTURE');

  const stale = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:03+08:00',
      receivedAt: '2026-08-26T09:00:03.010+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  assert.equal(evaluateBestQuoteEligibility(stale[0], stale[1]).reason, 'QUOTE_STALE_OR_FUTURE');
});

test('receivedAt regression never reorders and invalidates current epoch', () => {
  const result = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:01.000+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.950+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' });
  assert.equal(result.events[0].ledgerOrdinal, 1);
  assert.equal(result.events[1].ledgerOrdinal, 2);
  assert.equal(result.events[1].availabilityLineageStatus, 'INVALID_NON_MONOTONIC_RECEIVED_AT');
  assert.equal(evaluateBestQuoteEligibility(result.events[0], result.events[1]).eligible, false);
});

test('known partial resubscribe starts a new continuity epoch', () => {
  const records = [
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q1',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't1',
    }),
    lifecycle('quote_type_resubscribe', {
      product: 'TX', quoteType: 'BidAsk', actualContract: 'TXFI6',
    }, '2026-08-26T09:00:01+08:00', 'life'),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:01.100+08:00',
      receivedAt: '2026-08-26T09:00:01.110+08:00', hash: 't2',
    }),
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:01.200+08:00',
      receivedAt: '2026-08-26T09:00:01.210+08:00', hash: 'q2',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:01.300+08:00',
      receivedAt: '2026-08-26T09:00:01.310+08:00', hash: 't3',
    }),
  ];
  const events = materializeTxCanonicalObservations(records, {
    sourceLedgerIdentity: 'ledger-A',
  }).events;
  assert.equal(events[1].continuityEpoch, 'TX:1');
  assert.equal(events[2].continuityEpoch, 'TX:2');
  assert.equal(events[2].joinedContinuityStatus, 'WARMING');
  assert.equal(events[3].joinedContinuityStatus, 'USABLE');
  assert.equal(evaluateBestQuoteEligibility(events[0], events[2]).reason, 'CONTINUITY_EPOCH_MISMATCH');
  assert.equal(evaluateBestQuoteEligibility(events[3], events[4]).eligible, true);
});

test('identity mismatch fails quote eligibility', () => {
  const base = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  const mismatched = { ...base[0], tradeDate: '2026-08-25' };
  assert.equal(evaluateBestQuoteEligibility(mismatched, base[1]).reason, 'TRADE_DATE_MISMATCH');
});

test('snapshot lineage preserves physical cutoff and max used input', () => {
  const events = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00',
      receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't',
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.200+08:00',
      receivedAt: '2026-08-26T09:00:00.210+08:00', hash: 't2',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  const lineage = buildSnapshotLineage(events.slice(0, 2), events[2]);
  assert.equal(lineage.cutoffLedgerOrdinal, 3);
  assert.equal(lineage.cutoffRecordHash, 't2');
  assert.equal(lineage.maxUsedLedgerOrdinal, 2);
  assert.equal(lineage.maxUsedRecordHash, 't');
  assert.equal(lineage.availableAt, '2026-08-26T09:00:00.110+08:00');
});

test('non-TX physical clock regression invalidates the TX continuity segment', () => {
  const stock = {
    kind: 'stock_tick', product: '2330', receivedAt: '2026-08-26T09:00:00.900+08:00',
    recordHash: 's', formalWeight: 0, researchOnly: true, executionAuthorized: false,
    orderRoutesEnabled: false, payload: { code: '2330' },
  };
  const events = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00',
      receivedAt: '2026-08-26T09:00:01.000+08:00', hash: 'q',
    }),
    stock,
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:01.100+08:00',
      receivedAt: '2026-08-26T09:00:01.100+08:00', hash: 't',
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  assert.equal(events[1].availabilityLineageStatus, 'INVALID_NON_MONOTONIC_RECEIVED_AT');
  assert.equal(evaluateBestQuoteEligibility(events[0], events[1]).eligible, false);
});

test('safety boundary violation throws', () => {
  const bad = record('futures_tick', {
    eventTime: '2026-08-26T09:00:00+08:00',
    receivedAt: '2026-08-26T09:00:00.100+08:00', hash: 't',
  });
  bad.executionAuthorized = true;
  assert.throws(() => materializeTxCanonicalObservations([bad], {
    sourceLedgerIdentity: 'ledger-A',
  }), /CRU34_SAFETY_BOUNDARY_INVALID/);
});

test('safety-invalid continuity evidence fails closed before changing epoch', () => {
  for (const kind of ['futures_reconnect_resubscribe_started', 'quote_type_resubscribe']) {
    const badLifecycle = lifecycle(kind, {
      product: 'TX', quoteType: 'BidAsk', actualContract: 'TXFI6',
    }, '2026-08-26T09:00:01+08:00', `bad-${kind}`);
    badLifecycle.executionAuthorized = true;
    assert.throws(() => materializeTxCanonicalObservations([
      record('futures_tick', {
        eventTime: '2026-08-26T09:00:00.100+08:00',
        receivedAt: '2026-08-26T09:00:00.110+08:00', hash: `t-${kind}`,
      }),
      badLifecycle,
    ], { sourceLedgerIdentity: 'ledger-A' }), /CRU34_SAFETY_BOUNDARY_INVALID/);
  }
});

test('pressure window preserves BUY SELL UNKNOWN but fails closed below full classified coverage', () => {
  const events = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00',
      hash: 'q1', payload: { bid_price: [99], ask_price: [100] },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00',
      hash: 't1', payload: { close: 100, price: 100, volume: 2, executedVolume: 2, tick_type: 1 },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.200+08:00', receivedAt: '2026-08-26T09:00:00.210+08:00',
      hash: 't2', payload: { close: 99, price: 99, volume: 1, executedVolume: 1, tick_type: 2 },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.300+08:00', receivedAt: '2026-08-26T09:00:00.310+08:00',
      hash: 't3', payload: { close: 99.5, price: 99.5, volume: 1, executedVolume: 1, tick_type: 0 },
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  const output = buildExecutedPressureWindow(events, events.at(-1));
  assert.equal(output.status, 'QUALITY_INSUFFICIENT');
  assert.equal(output.unavailableReason, 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  assert.equal(output.buyProxyVolume, 2);
  assert.equal(output.sellProxyVolume, 1);
  assert.equal(output.unknownVolume, 1);
  assert.equal(output.netAggressiveFlowProxy, 1);
  assert.equal(output.pressureRatio, 1 / 3);
  assert.equal(output.classifiedCoverage, 0.75);
  assert.equal(output.direction, 'UNAVAILABLE');
  assert.equal(output.relativeIntensity, 'RESEARCH_PENDING');
});

test('zero classified coverage remains quality-insufficient with no directional pressure', () => {
  const events = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00',
      hash: 'q', payload: { bid_price: [99], ask_price: [100] },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00',
      hash: 't', payload: { close: 99.5, price: 99.5, volume: 2, executedVolume: 2, tick_type: 0 },
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  const output = buildExecutedPressureWindow(events, events.at(-1));
  assert.equal(output.status, 'QUALITY_INSUFFICIENT');
  assert.equal(output.pressureRatio, null);
  assert.equal(output.unavailableReason, 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  assert.equal(output.direction, 'UNAVAILABLE');
  assert.equal(output.classifiedCoverage, 0);
});

test('best-quote cross-check preserves provider conflict without replacing provider side', () => {
  const events = materializeTxCanonicalObservations([
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00',
      hash: 'q', payload: { bid_price: [100], ask_price: [101] },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00',
      hash: 't', payload: { close: 100, price: 100, volume: 3, executedVolume: 3, tick_type: 1 },
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  const output = buildExecutedPressureWindow(events, events.at(-1));
  assert.equal(output.buyProxyVolume, 3);
  assert.equal(output.sellProxyVolume, 0);
  assert.equal(output.bestQuoteCrossCheck.sellProxyVolume, 3);
  assert.equal(output.conflict.count, 1);
  assert.equal(output.conflict.rate, 1);
});

function invalidBookRecords({ bid, ask, name }) {
  const quotePayload = {};
  if (bid !== undefined) quotePayload.bid_price = [bid];
  if (ask !== undefined) quotePayload.ask_price = [ask];
  return [
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00',
      hash: `q-${name}`, payload: quotePayload,
    }),
    ...[100, 200, 300].map((offset) => record('futures_tick', {
      eventTime: `2026-08-26T09:00:00.${String(offset).padStart(3, '0')}+08:00`,
      receivedAt: `2026-08-26T09:00:00.${String(offset + 10).padStart(3, '0')}+08:00`,
      hash: `t-${name}-${offset}`,
      payload: { close: 45000, price: 45000, volume: 1, executedVolume: 1, tick_type: 2 },
    })),
  ];
}

for (const [name, bid, ask] of [
  ['zero_bid_and_ask', 0, 0],
  ['negative_bid', -1, 45000],
  ['negative_ask', 44999, -1],
  ['missing_bid', undefined, 45000],
  ['missing_ask', 44999, undefined],
  ['nonnumeric_bid', 'not-a-number', 45000],
  ['nonnumeric_ask', 44999, 'not-a-number'],
]) {
  test(`invalid best quote ${name} is unavailable without fabricated conflict evidence`, () => {
    const records = invalidBookRecords({ name, bid, ask });
    const events = materializeTxCanonicalObservations(records, { sourceLedgerIdentity: `ledger-${name}` }).events;
    const pressure = buildExecutedPressureWindow(events, events.at(-1));

    assert.equal(pressure.buyProxyVolume, 0);
    assert.equal(pressure.sellProxyVolume, 3);
    assert.equal(pressure.unknownVolume, 0);
    assert.deepEqual(pressure.bestQuoteCrossCheck, {
      buyProxyVolume: 0,
      sellProxyVolume: 0,
      insideSpreadVolume: 0,
      unavailableVolume: 3,
      matchedCoverage: 0,
      matchedTicks: 0,
    });
    assert.deepEqual(pressure.conflict, { count: 0, rate: null });

    const snapshot = buildTxIntradayResearchSnapshot(chain(records), {
      sourceLedgerIdentity: `ledger-snapshot-${name}`,
      instrumentProfile: PROFILE,
    });
    for (const window of Object.values(snapshot.windows)) {
      assert.equal(window.pressure.bestQuoteCrossCheck.unavailableVolume, 3);
      assert.equal(window.pressure.bestQuoteCrossCheck.matchedCoverage, 0);
      assert.deepEqual(window.contraryEvidence, []);
      assert.deepEqual(window.supportingEvidence, []);
    }
    assert.deepEqual(snapshot.contraryEvidence, []);
    assert.deepEqual(snapshot.supportingEvidence, []);
  });
}

test('best-quote controls preserve BUY, SELL, inside-spread, and crossed-book behavior', () => {
  const cases = [
    ['BUY_PROXY', 44999, 45000, 45000, 1, 'buyProxyVolume'],
    ['SELL_PROXY', 44999, 45000, 44999, 2, 'sellProxyVolume'],
    ['INSIDE_SPREAD', 44999, 45000, 44999.5, 1, 'insideSpreadVolume'],
    ['UNAVAILABLE', 45001, 45000, 45000, 1, 'unavailableVolume'],
  ];
  for (const [expected, bid, ask, price, tickType, metric] of cases) {
    const events = materializeTxCanonicalObservations([
      record('futures_bidask', {
        eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00',
        hash: `q-control-${expected}`, payload: { bid_price: [bid], ask_price: [ask] },
      }),
      record('futures_tick', {
        eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00',
        hash: `t-control-${expected}`,
        payload: { close: price, price, volume: 3, executedVolume: 3, tick_type: tickType },
      }),
    ], { sourceLedgerIdentity: `ledger-control-${expected}` }).events;
    const pressure = buildExecutedPressureWindow(events, events.at(-1));

    assert.equal(pressure.bestQuoteCrossCheck[metric], 3, expected);
    assert.equal(pressure.conflict.count, 0, expected);
    assert.equal(pressure.conflict.rate, expected === 'INSIDE_SPREAD' || expected === 'UNAVAILABLE' ? null : 0, expected);
  }
});

test('physically later quote never enters earlier pressure evidence', () => {
  const events = materializeTxCanonicalObservations([
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.200+08:00',
      hash: 't1', payload: { close: 100, price: 100, volume: 1, executedVolume: 1, tick_type: 1 },
    }),
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00.050+08:00', receivedAt: '2026-08-26T09:00:00.200+08:00',
      hash: 'q', payload: { bid_price: [99], ask_price: [100] },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.300+08:00', receivedAt: '2026-08-26T09:00:00.300+08:00',
      hash: 't2', payload: { close: 100, price: 100, volume: 1, executedVolume: 1, tick_type: 1 },
    }),
  ], { sourceLedgerIdentity: 'ledger-A' }).events;
  const firstOnly = buildExecutedPressureWindow(events, events[0]);
  assert.equal(firstOnly.bestQuoteCrossCheck.unavailableVolume, 1);
  const later = buildExecutedPressureWindow(events, events[2]);
  assert.equal(later.bestQuoteCrossCheck.buyProxyVolume, 1);
  assert.equal(later.bestQuoteCrossCheck.unavailableVolume, 1);
});

test('pressure output is deterministic for identical governed prefix', () => {
  const records = [
    record('futures_bidask', {
      eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00',
      hash: 'q', payload: { bid_price: [99], ask_price: [100] },
    }),
    record('futures_tick', {
      eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00',
      hash: 't', payload: { close: 100, price: 100, volume: 2, executedVolume: 2, tick_type: 1 },
    }),
  ];
  const a = materializeTxCanonicalObservations(records, { sourceLedgerIdentity: 'ledger-A' }).events;
  const b = materializeTxCanonicalObservations(records, { sourceLedgerIdentity: 'ledger-A' }).events;
  const left = buildExecutedPressureWindow(a, a.at(-1));
  const right = buildExecutedPressureWindow(b, b.at(-1));
  const comparable = (value) => JSON.stringify(value, (key, item) => (
    key === 'rawRecord' ? undefined : item
  ));
  assert.equal(comparable(left), comparable(right));
});

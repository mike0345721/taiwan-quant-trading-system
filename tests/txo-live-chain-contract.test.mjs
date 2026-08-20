import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TXO_LIVE_CHAIN_CONTRACT, TXO_UNIVERSE_OPTIONS, estimateTxoStorage,
  evaluateTxoCollectionHealth, normalizeTxoLiveRecord,
} from '../src/txo-live-chain-contract.mjs';

function record(overrides = {}) {
  return {
    kind: 'options_bidask', code: 'TXO45900H6', product: 'TXO',
    exchangeTimestamp: '2026-08-14T19:00:00', receivedAt: '2026-08-14T19:00:00.050+08:00',
    payload: {
      code: 'TXO45900H6', datetime: '2026-08-14T19:00:00',
      _received_at: '2026-08-14T19:00:00.050+08:00', _expiry: '2026-08-19',
      _strike: 45900, _call_put: 'C', _trade_date: '2026-08-15', _session: 'NIGHT',
      _collection_run_id: 'run-1', bid_price: [481], bid_volume: [3], ask_price: [491], ask_volume: [2],
      ...(overrides.payload || {}),
    }, ...overrides,
  };
}

test('TXO raw quote retains full lineage without fabricating IV, Greeks or sequence', () => {
  const value = normalizeTxoLiveRecord(record());
  assert.equal(value.contract, 'TXO45900H6');
  assert.equal(value.expiry, '2026-08-19');
  assert.equal(value.callPut, 'C');
  assert.equal(value.bidPrice, 481);
  assert.equal(value.nativeSequenceAvailability, 'UNAVAILABLE');
  assert.equal(value.impliedVolatility, null);
  assert.equal(value.providerGreeks, null);
  assert.equal(value.executionAuthorized, false);
});

test('bad quote and timestamp lineage stay quality insufficient', () => {
  const value = normalizeTxoLiveRecord(record({
    receivedAt: '2026-08-14T18:59:59+08:00',
    payload: { _received_at: '2026-08-14T18:59:59+08:00', bid_price: [500], ask_price: [490] },
  }));
  assert.equal(value.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.ok(value.qualityReasons.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
  assert.ok(value.qualityReasons.includes('TWO_SIDED_QUOTE_INVALID'));
});

test('health fails false green when subscriptions or writer are incomplete', () => {
  assert.equal(evaluateTxoCollectionHealth({ enabled: false }).collectorState, 'STOPPED_EXPECTED');
  assert.equal(evaluateTxoCollectionHealth({ enabled: true, expectedSubscriptionCount: 20,
    restoredSubscriptionCount: 18, writerState: 'PASS' }).collectorState, 'DEGRADED');
  assert.equal(evaluateTxoCollectionHealth({ enabled: true, expectedSubscriptionCount: 20,
    restoredSubscriptionCount: 20, writerState: 'FAIL' }).collectorState, 'DEGRADED');
  assert.equal(evaluateTxoCollectionHealth({ enabled: true, expectedSubscriptionCount: 20,
    restoredSubscriptionCount: 20, writerState: 'PASS', dropped: 1 }).collectorState, 'DEGRADED');
  assert.equal(evaluateTxoCollectionHealth({ enabled: true, expectedSubscriptionCount: 20,
    restoredSubscriptionCount: 20, writerState: 'PASS' }).collectorState, 'HEALTHY');
});

test('universe selection is governed and production stays default-off', () => {
  assert.equal(TXO_UNIVERSE_OPTIONS.B.decision, 'RECOMMENDED');
  assert.equal(TXO_LIVE_CHAIN_CONTRACT.recommendedUniverse, 'GOVERNED_NEAR_MARKET_LIQUID_PAIRS');
  assert.equal(TXO_LIVE_CHAIN_CONTRACT.productionActivationApproved, false);
  assert.equal(TXO_LIVE_CHAIN_CONTRACT.secondLoginAllowed, false);
  assert.equal(TXO_LIVE_CHAIN_CONTRACT.secondWriterAllowed, false);
  assert.equal(TXO_LIVE_CHAIN_CONTRACT.rawOptionsAreValidatedIv, false);
});

test('storage estimator is transparent and never labels estimates as measurements', () => {
  assert.deepEqual(estimateTxoStorage({ eventsPerMinute: 120, averageBytesPerEvent: 900, activeHoursPerDay: 19.75 }), {
    eventsPerMinute: 120, eventsPerHour: 7200, bytesPerHour: 6480000,
    bytesPerDay: 127980000, measured: false,
  });
});

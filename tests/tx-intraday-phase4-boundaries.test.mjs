import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });
const SNAPSHOT_OPTIONS = Object.freeze({
  sourceLedgerIdentity: 'ledger-cru34-boundaries',
  instrumentProfile: PROFILE,
});

function tick({ eventTime, receivedAt, hash, price, session = 'DAY', tradeDate = '2026-08-26' }) {
  return {
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt,
    exchangeTimestamp: eventTime, recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', eventTime, datetime: eventTime,
      tradeDate, session, simtrade: false, price, close: price,
      executedVolume: 1, volume: 1, tick_type: 1,
    },
  };
}

function quote({ eventTime, receivedAt, hash, bid, ask, session = 'DAY', tradeDate = '2026-08-26' }) {
  return {
    kind: 'futures_bidask', code: 'TXFI6', product: 'TXFI6', receivedAt,
    exchangeTimestamp: eventTime, recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', eventTime, datetime: eventTime,
      tradeDate, session, simtrade: false, bid_price: [bid], ask_price: [ask],
    },
  };
}

function lifecycle(kind, payload, receivedAt, hash) {
  return {
    kind, product: 'bridge', receivedAt, recordHash: hash,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'bridge', ...payload },
  };
}

test('equal eventTime keeps physical ledger order for path calculation', () => {
  const records = [
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 't1', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.020+08:00', hash: 't2', price: 105 }),
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.030+08:00', hash: 't3', price: 101 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, SNAPSHOT_OPTIONS);
  assert.equal(snapshot.windows.primary60s.response.startPrice, 100);
  assert.equal(snapshot.windows.primary60s.response.endPrice, 101);
  assert.equal(snapshot.windows.primary60s.pathEfficiency.pathLengthPoints, 9);
  assert.equal(snapshot.windows.primary60s.pathEfficiency.value, 1 / 9);
});

test('full reconnect starts a fresh joined continuity epoch', () => {
  const records = [
    quote({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q1', bid: 99, ask: 100 }),
    tick({ eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't1', price: 100 }),
    lifecycle('futures_reconnect_resubscribe_started', { products: ['TX', 'MTX', 'TMF'], subscriptionGeneration: 2 }, '2026-08-26T09:00:01+08:00', 'life'),
    quote({ eventTime: '2026-08-26T09:00:01.100+08:00', receivedAt: '2026-08-26T09:00:01.110+08:00', hash: 'q2', bid: 100, ask: 101 }),
    tick({ eventTime: '2026-08-26T09:00:01.200+08:00', receivedAt: '2026-08-26T09:00:01.210+08:00', hash: 't2', price: 101 }),
    tick({ eventTime: '2026-08-26T09:00:01.300+08:00', receivedAt: '2026-08-26T09:00:01.310+08:00', hash: 't3', price: 102 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, SNAPSHOT_OPTIONS);
  assert.equal(snapshot.identity.continuityEpoch, 'TX:2');
  assert.equal(snapshot.windows.primary60s.pressure.tickCount, 2);
  assert.equal(snapshot.windows.primary60s.response.startPrice, 101);
  assert.equal(snapshot.windows.primary60s.pressure.bestQuoteCrossCheck.matchedTicks, 2);
});

test('session identity boundary excludes earlier session observations', () => {
  const records = [
    tick({ eventTime: '2026-08-26T04:59:50+08:00', receivedAt: '2026-08-26T04:59:50.010+08:00', hash: 'night', price: 90, session: 'NIGHT' }),
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'd1', price: 100, session: 'DAY' }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'd2', price: 101, session: 'DAY' }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'd3', price: 102, session: 'DAY' }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, SNAPSHOT_OPTIONS);
  assert.equal(snapshot.identity.session, 'DAY');
  assert.equal(snapshot.windows.context300s.pressure.tickCount, 3);
  assert.equal(snapshot.windows.context300s.response.startPrice, 100);
});

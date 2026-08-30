import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });

function tick({
  eventTime,
  receivedAt,
  hash,
  price,
  volume = 1,
  tickType = 1,
  code = 'TXFI6',
  tradeDate = '2026-08-26',
  session = 'DAY',
} = {}) {
  return {
    kind: 'futures_tick', code, product: code, receivedAt, exchangeTimestamp: eventTime,
    recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code, productFamily: 'TX', actualContract: code, eventTime, datetime: eventTime,
      tradeDate, session, simtrade: false, price, close: price,
      executedVolume: volume, volume, tick_type: tickType,
    },
  };
}

function quote({
  eventTime,
  receivedAt,
  hash,
  bid,
  ask,
  code = 'TXFI6',
  tradeDate = '2026-08-26',
  session = 'DAY',
} = {}) {
  return {
    kind: 'futures_bidask', code, product: code, receivedAt, exchangeTimestamp: eventTime,
    recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code, productFamily: 'TX', actualContract: code, eventTime, datetime: eventTime,
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

function stock(receivedAt, hash = 'stock') {
  return {
    kind: 'stock_tick', product: '2330', receivedAt, recordHash: hash,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: '2330' },
  };
}

function options(extra = {}) {
  return {
    sourceLedgerIdentity: 'ledger-cru34-phase4',
    instrumentProfile: PROFILE,
    ...extra,
  };
}

function normalLedger() {
  return [
    quote({ eventTime: '2026-08-26T09:00:00.000+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q1', bid: 99, ask: 100 }),
    tick({ eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't1', price: 100, volume: 2, tickType: 1 }),
    quote({ eventTime: '2026-08-26T09:00:10.000+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'q2', bid: 100, ask: 101 }),
    tick({ eventTime: '2026-08-26T09:00:10.100+08:00', receivedAt: '2026-08-26T09:00:10.110+08:00', hash: 't2', price: 100, volume: 1, tickType: 2 }),
    quote({ eventTime: '2026-08-26T09:00:20.000+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'q3', bid: 101, ask: 102 }),
    tick({ eventTime: '2026-08-26T09:00:20.100+08:00', receivedAt: '2026-08-26T09:00:20.110+08:00', hash: 't3', price: 102, volume: 1, tickType: 1 }),
  ];
}

test('UI-ready snapshot combines pressure response efficiency lineage without promotion', () => {
  const snapshot = buildTxIntradayResearchSnapshot(normalLedger(), options());
  assert.equal(snapshot.status, 'READY');
  assert.equal(snapshot.identity.actualContract, 'TXFI6');
  assert.equal(snapshot.identity.tradeDate, '2026-08-26');
  assert.equal(snapshot.identity.session, 'DAY');
  assert.equal(snapshot.lineage.cutoffLedgerOrdinal, 6);
  assert.equal(snapshot.lineage.cutoffRecordHash, 't3');
  assert.equal(snapshot.lineage.maxUsedLedgerOrdinal, 6);
  assert.equal(snapshot.windows.primary60s.pressure.buyProxyVolume, 3);
  assert.equal(snapshot.windows.primary60s.pressure.sellProxyVolume, 1);
  assert.equal(snapshot.windows.primary60s.pressure.pressureRatio, 0.5);
  assert.equal(snapshot.windows.primary60s.pressure.classifiedCoverage, 1);
  assert.equal(snapshot.windows.primary60s.response.displacementPoints, 2);
  assert.equal(snapshot.windows.primary60s.pathEfficiency.value, 1);
  assert.equal(snapshot.promotionState.relativeIntensity, 'RESEARCH_PENDING');
  assert.equal(snapshot.promotionState.controlObservationState, 'RESEARCH_PENDING');
  assert.equal(snapshot.promotionState.absorption, 'RESEARCH_PENDING');
  assert.equal(snapshot.promotionState.marketState, 'NOT_PROVIDED');
  assert.equal(snapshot.executionAuthorized, false);
  assert.equal(snapshot.orderRoutesEnabled, false);
});

test('future suffix cannot rewrite an exact physical cutoff snapshot', () => {
  const prefix = normalLedger();
  const laterQuote = quote({
    eventTime: '2026-08-26T09:00:19.900+08:00',
    receivedAt: '2026-08-26T09:00:20.110+08:00',
    hash: 'future-q', bid: 90, ask: 91,
  });
  const expected = buildTxIntradayResearchSnapshot(prefix, options({ cutoffLedgerOrdinal: 6 }));
  const withFutureSuffix = buildTxIntradayResearchSnapshot([...prefix, laterQuote], options({ cutoffLedgerOrdinal: 6 }));
  assert.equal(JSON.stringify(withFutureSuffix), JSON.stringify(expected));
  assert.equal(withFutureSuffix.lineage.cutoffLedgerOrdinal, 6);
});

test('non-monotonic physical receivedAt fails snapshot lineage closed without reorder', () => {
  const records = [
    quote({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:01.000+08:00', hash: 'q', bid: 99, ask: 100 }),
    stock('2026-08-26T09:00:00.900+08:00'),
    tick({ eventTime: '2026-08-26T09:00:01.100+08:00', receivedAt: '2026-08-26T09:00:01.100+08:00', hash: 't', price: 100 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options({ cutoffLedgerOrdinal: 3 }));
  assert.equal(snapshot.status, 'UNAVAILABLE');
  assert.equal(snapshot.unavailableReason, 'CUTOFF_LINEAGE_UNUSABLE');
  assert.equal(snapshot.lineage.cutoffLedgerOrdinal, 3);
  assert.equal(snapshot.lineage.cutoffRecordHash, 't');
});

test('partial resubscribe creates a new epoch and prior quote cannot be reused', () => {
  const records = [
    quote({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q1', bid: 99, ask: 100 }),
    tick({ eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't1', price: 100 }),
    lifecycle('quote_type_resubscribe', { product: 'TX', quoteType: 'BidAsk', actualContract: 'TXFI6' }, '2026-08-26T09:00:01+08:00', 'life'),
    tick({ eventTime: '2026-08-26T09:00:01.100+08:00', receivedAt: '2026-08-26T09:00:01.110+08:00', hash: 't2', price: 101 }),
    quote({ eventTime: '2026-08-26T09:00:01.200+08:00', receivedAt: '2026-08-26T09:00:01.210+08:00', hash: 'q2', bid: 101, ask: 102 }),
    tick({ eventTime: '2026-08-26T09:00:01.300+08:00', receivedAt: '2026-08-26T09:00:01.310+08:00', hash: 't3', price: 102 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(snapshot.identity.continuityEpoch, 'TX:2');
  assert.equal(snapshot.windows.primary60s.pressure.tickCount, 2);
  assert.equal(snapshot.windows.primary60s.pressure.bestQuoteCrossCheck.matchedTicks, 1);
  assert.equal(snapshot.windows.primary60s.pressure.bestQuoteCrossCheck.matchedCoverage, 0.5);
  assert.equal(snapshot.windows.primary60s.pathEfficiency.unavailableReason, 'INSUFFICIENT_OBSERVATIONS');
});

test('Tick-only evidence keeps provider pressure while quote cross-check stays explicitly unmatched', () => {
  const records = [
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 't1', price: 100, volume: 2, tickType: 1 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 't2', price: 101, volume: 1, tickType: 2 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 't3', price: 102, volume: 1, tickType: 1 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(snapshot.windows.primary60s.pressure.status, 'READY');
  assert.equal(snapshot.windows.primary60s.pressure.pressureRatio, 0.5);
  assert.equal(snapshot.windows.primary60s.pressure.bestQuoteCrossCheck.matchedCoverage, 0);
  assert.equal(snapshot.windows.primary60s.pressure.bestQuoteCrossCheck.unavailableVolume, 4);
  assert.equal(snapshot.promotionState.controlObservationState, 'RESEARCH_PENDING');
});

test('low classified coverage stays measured evidence and never becomes relative strength', () => {
  const records = [
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 't1', price: 100, volume: 9, tickType: 0 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 't2', price: 101, volume: 1, tickType: 1 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 't3', price: 102, volume: 1, tickType: 0 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(snapshot.windows.primary60s.pressure.pressureRatio, 1);
  assert.equal(snapshot.windows.primary60s.pressure.classifiedCoverage, 1 / 11);
  assert.equal(snapshot.windows.primary60s.pressure.relativeIntensity, 'RESEARCH_PENDING');
  assert.equal(snapshot.promotionState.relativeIntensity, 'RESEARCH_PENDING');
});

test('provider/book conflict is preserved as contrary evidence instead of replacing provider side', () => {
  const records = [
    quote({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q1', bid: 100, ask: 101 }),
    tick({ eventTime: '2026-08-26T09:00:00.100+08:00', receivedAt: '2026-08-26T09:00:00.110+08:00', hash: 't1', price: 100, tickType: 1 }),
    quote({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'q2', bid: 100, ask: 101 }),
    tick({ eventTime: '2026-08-26T09:00:10.100+08:00', receivedAt: '2026-08-26T09:00:10.110+08:00', hash: 't2', price: 101, tickType: 1 }),
    quote({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'q3', bid: 101, ask: 102 }),
    tick({ eventTime: '2026-08-26T09:00:20.100+08:00', receivedAt: '2026-08-26T09:00:20.110+08:00', hash: 't3', price: 102, tickType: 1 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.ok(snapshot.windows.primary60s.pressure.conflict.count > 0);
  assert.ok(snapshot.contraryEvidence.some((item) => item.code === 'PROVIDER_BOOK_CLASSIFICATION_CONFLICT_PRESENT'));
  assert.equal(snapshot.windows.primary60s.pressure.direction, 'BUY_SIDE');
});

test('same availableAt with different physical cutoffs remains auditable by ordinal and hash', () => {
  const records = [
    tick({ eventTime: '2026-08-26T09:00:00.000+08:00', receivedAt: '2026-08-26T09:00:00.100+08:00', hash: 't1', price: 100 }),
    tick({ eventTime: '2026-08-26T09:00:00.050+08:00', receivedAt: '2026-08-26T09:00:00.100+08:00', hash: 't2', price: 101 }),
    tick({ eventTime: '2026-08-26T09:00:00.090+08:00', receivedAt: '2026-08-26T09:00:00.100+08:00', hash: 't3', price: 102 }),
  ];
  const two = buildTxIntradayResearchSnapshot(records, options({ cutoffLedgerOrdinal: 2 }));
  const three = buildTxIntradayResearchSnapshot(records, options({ cutoffLedgerOrdinal: 3 }));
  assert.equal(two.lineage.availableAt, three.lineage.availableAt);
  assert.equal(two.lineage.cutoffLedgerOrdinal, 2);
  assert.equal(three.lineage.cutoffLedgerOrdinal, 3);
  assert.equal(two.lineage.cutoffRecordHash, 't2');
  assert.equal(three.lineage.cutoffRecordHash, 't3');
  assert.notEqual(JSON.stringify(two), JSON.stringify(three));
});

test('tradeDate and contract identity boundaries cannot bleed into the current window', () => {
  const records = [
    tick({ eventTime: '2026-08-25T13:44:50+08:00', receivedAt: '2026-08-25T13:44:50.010+08:00', hash: 'old', price: 90, code: 'TXFH6', tradeDate: '2026-08-25' }),
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'n1', price: 100, code: 'TXFI6', tradeDate: '2026-08-26' }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'n2', price: 101, code: 'TXFI6', tradeDate: '2026-08-26' }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'n3', price: 102, code: 'TXFI6', tradeDate: '2026-08-26' }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(snapshot.identity.actualContract, 'TXFI6');
  assert.equal(snapshot.identity.tradeDate, '2026-08-26');
  assert.equal(snapshot.windows.primary60s.pressure.tickCount, 3);
  assert.equal(snapshot.windows.primary60s.response.startPrice, 100);
});

test('BidAsk-only prefix returns an explicit unavailable snapshot instead of inventing a result', () => {
  const records = [
    quote({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'q', bid: 99, ask: 100 }),
  ];
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(snapshot.status, 'UNAVAILABLE');
  assert.equal(snapshot.unavailableReason, 'NO_TX_TICK_CUTOFF');
  assert.equal(snapshot.promotionState.marketState, 'NOT_PROVIDED');
});

test('identical governed prefix produces byte-identical semantic snapshot JSON', () => {
  const records = normalLedger();
  const first = buildTxIntradayResearchSnapshot(records, options());
  const second = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(JSON.stringify(first), JSON.stringify(second));
});

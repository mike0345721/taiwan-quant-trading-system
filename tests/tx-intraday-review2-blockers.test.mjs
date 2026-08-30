import test from 'node:test';
import assert from 'node:assert/strict';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });

function tick({ eventTime, receivedAt, hash, price, volume = 1, tickType = 1 } = {}) {
  return {
    kind: 'futures_tick',
    code: 'TXFI6',
    product: 'TXFI6',
    receivedAt,
    exchangeTimestamp: eventTime,
    recordHash: hash,
    duplicate: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6',
      productFamily: 'TX',
      actualContract: 'TXFI6',
      eventTime,
      datetime: eventTime,
      tradeDate: '2026-08-26',
      session: 'DAY',
      simtrade: false,
      price,
      close: price,
      executedVolume: volume,
      volume,
      tick_type: tickType,
    },
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

function options(extra = {}) {
  return {
    sourceLedgerIdentity: 'ledger-cru34-review2',
    instrumentProfile: PROFILE,
    ...extra,
  };
}

function fullyClassifiedLedger() {
  return chain([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 't1', price: 100, tickType: 1 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 't2', price: 101, tickType: 1 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 't3', price: 102, tickType: 1 }),
  ]);
}

test('incomplete provider classification coverage cannot become READY or supporting directional evidence', () => {
  const records = chain([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 'u1', price: 100, volume: 9, tickType: 0 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 'b1', price: 101, volume: 1, tickType: 1 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 'u2', price: 102, volume: 1, tickType: 0 }),
  ]);
  const snapshot = buildTxIntradayResearchSnapshot(records, options());
  assert.equal(snapshot.windows.primary60s.pressure.pressureRatio, 1);
  assert.equal(snapshot.windows.primary60s.pressure.classifiedCoverage, 1 / 11);
  assert.equal(snapshot.windows.primary60s.status, 'QUALITY_INSUFFICIENT');
  assert.equal(snapshot.status, 'QUALITY_INSUFFICIENT');
  assert.equal(snapshot.unavailableReason, 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  assert.equal(snapshot.supportingEvidence.some((item) => item.code === 'PRICE_RESPONSE_SAME_DIRECTION'), false);
  assert.ok(snapshot.quality.reasons.includes('PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE'));
});

test('V1 rejects caller override of frozen minimum path observation count', () => {
  assert.throws(() => buildTxIntradayResearchSnapshot(
    fullyClassifiedLedger(),
    options({ minPathTickCount: 2 }),
  ), /CRU34_V1_PATH_CONTRACT_INVALID/);
});

test('V1 rejects caller override of frozen maximum adjacent path gap', () => {
  assert.throws(() => buildTxIntradayResearchSnapshot(
    fullyClassifiedLedger(),
    options({ maxPathGapMs: 30_001 }),
  ), /CRU34_V1_PATH_CONTRACT_INVALID/);
});

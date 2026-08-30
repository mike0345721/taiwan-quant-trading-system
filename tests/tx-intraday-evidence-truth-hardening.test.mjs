import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { buildPriceResponsePathEfficiencyWindow } from '../src/tx-price-response-path-efficiency.mjs';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';

const PROFILE = Object.freeze({ instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 });

function tick({ eventTime, receivedAt, hash, price, volume = 1, tickType = 1 } = {}) {
  return {
    kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt,
    exchangeTimestamp: eventTime, recordHash: hash, duplicate: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: {
      code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6',
      eventTime, datetime: eventTime, tradeDate: '2026-08-26', session: 'DAY',
      simtrade: false, price, close: price, executedVolume: volume, volume, tick_type: tickType,
    },
  };
}

function stock(receivedAt) {
  return {
    kind: 'stock_tick', product: '2330', receivedAt, recordHash: 'stock',
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: '2330' },
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

test('standalone price response refuses availability-lineage-invalid ticks', () => {
  const canonical = materializeTxCanonicalObservations([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:01.000+08:00', hash: 't1', price: 100 }),
    stock('2026-08-26T09:00:00.900+08:00'),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.000+08:00', hash: 't2', price: 101 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.000+08:00', hash: 't3', price: 102 }),
  ], { sourceLedgerIdentity: 'ledger-hardening' }).events;
  const result = buildPriceResponsePathEfficiencyWindow(canonical, canonical.at(-1), { tickSize: 1 });
  assert.equal(result.status, 'QUALITY_INSUFFICIENT');
  assert.equal(result.unavailableReason, 'TICK_AVAILABILITY_LINEAGE_UNUSABLE');
  assert.equal(result.response.status, 'UNAVAILABLE');
});

test('all-UNKNOWN pressure keeps snapshot quality-insufficient rather than falsely READY', () => {
  const records = chain([
    tick({ eventTime: '2026-08-26T09:00:00+08:00', receivedAt: '2026-08-26T09:00:00.010+08:00', hash: 't1', price: 100, volume: 1, tickType: 0 }),
    tick({ eventTime: '2026-08-26T09:00:10+08:00', receivedAt: '2026-08-26T09:00:10.010+08:00', hash: 't2', price: 101, volume: 1, tickType: 0 }),
    tick({ eventTime: '2026-08-26T09:00:20+08:00', receivedAt: '2026-08-26T09:00:20.010+08:00', hash: 't3', price: 102, volume: 1, tickType: 0 }),
  ]);
  const snapshot = buildTxIntradayResearchSnapshot(records, {
    sourceLedgerIdentity: 'ledger-hardening', instrumentProfile: PROFILE,
  });
  assert.equal(snapshot.status, 'QUALITY_INSUFFICIENT');
  assert.equal(snapshot.unavailableReason, 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE');
  assert.equal(snapshot.windows.primary60s.pressure.status, 'UNAVAILABLE');
  assert.equal(snapshot.windows.primary60s.pressure.unavailableReason, 'NO_CLASSIFIED_VOLUME');
  assert.equal(snapshot.windows.primary60s.pressure.pressureRatio, null);
  assert.equal(snapshot.windows.primary60s.pressure.direction, 'UNAVAILABLE');
  assert.equal(snapshot.windows.primary60s.pressure.classifiedCoverage, 0);
  assert.equal(snapshot.supportingEvidence.length, 0);
  assert.equal(snapshot.promotionState.relativeIntensity, 'RESEARCH_PENDING');
});

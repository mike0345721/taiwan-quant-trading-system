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

const WINDOW_ENTRIES = Object.freeze([
  ['primary60s', 'PRIMARY_60S'],
  ['context300s', 'CONTEXT_300S'],
]);

function coverageLedger(classifiedPercent, { priceStep = 1 } = {}) {
  const startMs = Date.parse('2026-08-26T09:00:00+08:00');
  return chain(Array.from({ length: 100 }, (_, index) => {
    const eventTime = new Date(startMs + (index * 100)).toISOString();
    return tick({
      eventTime,
      receivedAt: eventTime,
      hash: `coverage-${classifiedPercent}-${priceStep}-${index + 1}`,
      price: 200 + (index * priceStep),
      tickType: index < classifiedPercent ? 1 : 0,
    });
  }));
}

for (const classifiedPercent of [0, 1, 75, 99, 100]) {
  test(`snapshot gates pressure-direction semantics at ${classifiedPercent}% coverage in both windows`, () => {
    const snapshot = buildTxIntradayResearchSnapshot(
      coverageLedger(classifiedPercent),
      options({ sourceLedgerIdentity: `ledger-cru34-b01-${classifiedPercent}` }),
    );
    const complete = classifiedPercent === 100;
    const expectedCoverage = classifiedPercent / 100;

    for (const [windowKey, evidenceWindow] of WINDOW_ENTRIES) {
      const window = snapshot.windows[windowKey];
      assert.equal(window.pressure.status, complete ? 'READY' : 'QUALITY_INSUFFICIENT');
      assert.equal(window.pressure.direction, complete ? 'BUY_SIDE' : 'UNAVAILABLE');
      assert.equal(window.pressure.pressureRatio, classifiedPercent === 0 ? null : 1);
      assert.equal(window.pressure.classifiedCoverage, expectedCoverage);

      assert.equal(window.response.status, 'READY');
      assert.equal(window.response.displacementPoints, 99);
      assert.equal(window.response.displacementTicks, 99);
      assert.equal(
        window.response.directionRelation,
        complete ? 'SAME_DIRECTION' : 'PRESSURE_UNAVAILABLE',
      );
      assert.equal(window.pathEfficiency.status, 'READY');
      assert.equal(window.pathEfficiency.value, 1);

      assert.deepEqual(
        window.supportingEvidence,
        complete ? [{ code: 'PRICE_RESPONSE_SAME_DIRECTION' }] : [],
      );
      assert.deepEqual(window.contraryEvidence, []);
      assert.deepEqual(
        snapshot.supportingEvidence.filter((item) => item.window === evidenceWindow),
        complete ? [{ window: evidenceWindow, code: 'PRICE_RESPONSE_SAME_DIRECTION' }] : [],
      );
      assert.deepEqual(
        snapshot.contraryEvidence.filter((item) => item.window === evidenceWindow),
        [],
      );
    }

    assert.equal(snapshot.status, complete ? 'READY' : 'QUALITY_INSUFFICIENT');
    assert.equal(
      snapshot.unavailableReason,
      complete ? null : 'PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE',
    );
  });
}

test('fully classified buy pressure with falling prices emits only opposite-direction evidence', () => {
  const snapshot = buildTxIntradayResearchSnapshot(
    coverageLedger(100, { priceStep: -1 }),
    options({ sourceLedgerIdentity: 'ledger-cru34-b01-opposite' }),
  );

  for (const [windowKey, evidenceWindow] of WINDOW_ENTRIES) {
    const window = snapshot.windows[windowKey];
    assert.equal(window.pressure.status, 'READY');
    assert.equal(window.pressure.direction, 'BUY_SIDE');
    assert.equal(window.pressure.pressureRatio, 1);
    assert.equal(window.pressure.classifiedCoverage, 1);
    assert.equal(window.response.status, 'READY');
    assert.equal(window.response.displacementPoints, -99);
    assert.equal(window.response.displacementTicks, -99);
    assert.equal(window.response.directionRelation, 'OPPOSITE_DIRECTION');
    assert.deepEqual(window.supportingEvidence, []);
    assert.deepEqual(window.contraryEvidence, [{ code: 'PRICE_RESPONSE_OPPOSITE_DIRECTION' }]);
    assert.deepEqual(
      snapshot.supportingEvidence.filter((item) => item.window === evidenceWindow),
      [],
    );
    assert.deepEqual(
      snapshot.contraryEvidence.filter((item) => item.window === evidenceWindow),
      [{ window: evidenceWindow, code: 'PRICE_RESPONSE_OPPOSITE_DIRECTION' }],
    );
  }
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

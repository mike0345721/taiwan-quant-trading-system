import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDealerMap } from '../src/dealer-map.mjs';

function snapshot({
  date = '2026-07-24',
  contract = '202607F4',
  reference = 112,
  daysToExpiry = 1,
  strikes = [
    { strike: 100, callOi: 10, putOi: 60 },
    { strike: 110, callOi: 20, putOi: 30 },
    { strike: 120, callOi: 70, putOi: 10 },
  ],
} = {}) {
  const callWallRow = [...strikes].sort((a, b) => b.callOi - a.callOi)[0];
  const putWallRow = [...strikes].sort((a, b) => b.putOi - a.putOi)[0];
  return {
    dataMode: 'live',
    asOfDate: date,
    options: {
      dataDate: date,
      data: {
        contract,
        contractType: 'weekly',
        expiryDate: '2026-07-25',
        daysToExpiry,
        contracts: [{
          contract,
          type: 'weekly',
          expiryDate: '2026-07-25',
          daysToExpiry,
          callOi: strikes.reduce((sum, row) => sum + row.callOi, 0),
          putOi: strikes.reduce((sum, row) => sum + row.putOi, 0),
          callWall: { strike: callWallRow.strike, openInterest: callWallRow.callOi },
          putWall: { strike: putWallRow.strike, openInterest: putWallRow.putOi },
          maxPain: 110,
          strikes,
        }],
      },
    },
    futuresMarket: { data: { txDay: { close: reference } } },
  };
}

test('dealer map calculates transparent OI centers and central structure zones', () => {
  const result = buildDealerMap({ snapshot: snapshot() });
  assert.equal(result.available, true);
  assert.equal(result.oiCenters.call.weightedMean, 116);
  assert.equal(result.oiCenters.call.weightedMedian, 120);
  assert.equal(result.oiCenters.put.weightedMean, 105);
  assert.equal(result.oiCenters.put.weightedMedian, 100);
  assert.equal(result.oiCenters.combined.weightedMean, 110.5);
  assert.deepEqual(result.structureZones.map((row) => row.coveragePct), [50, 70, 90]);
  assert.equal(result.balanceZone.scope, 'oi_only');
  assert.deepEqual(
    { low: result.balanceZone.low, high: result.balanceZone.high, method: result.balanceZone.method },
    { low: 110, high: 110, method: 'call_put_central_50_overlap' },
  );
});

test('dealer map records same-contract wall movement, stability and max-pain context', () => {
  const prior = snapshot({
    date: '2026-07-23',
    reference: 109,
    daysToExpiry: 2,
    strikes: [
      { strike: 100, callOi: 20, putOi: 70 },
      { strike: 110, callOi: 80, putOi: 30 },
      { strike: 120, callOi: 10, putOi: 5 },
    ],
  });
  const current = snapshot();
  const result = buildDealerMap({ snapshot: current, history: [prior] });
  assert.equal(result.sameContractDays, 2);
  assert.equal(result.walls.call.movement, 10);
  assert.equal(result.walls.call.movementState, 'moved_up');
  assert.equal(result.walls.call.stabilityDays, 1);
  assert.equal(result.walls.put.movement, 0);
  assert.equal(result.walls.put.stabilityDays, 2);
  assert.equal(result.walls.put.oiDeltaAtStrike, -10);
  assert.equal(result.maxPain.distanceFromReference, 2);
  assert.equal(result.maxPain.proximity, 'near');
  assert.equal(result.maxPain.expiryPhase, 'near_expiry');
});

test('dealer map never labels public OI as observed dealer position or cost', () => {
  const result = buildDealerMap({ snapshot: snapshot() });
  assert.equal(result.researchOnly, true);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.safeguards.dealerPositionObserved, false);
  assert.equal(result.safeguards.dealerCostObserved, false);
  assert.equal(result.safeguards.greeksIncluded, false);
  assert.equal(result.balanceZone.missingComponents.includes('delta_neutral_scenario'), true);
  assert.equal(result.balanceZone.missingComponents.includes('gamma_center_scenario'), true);
  assert.match(result.balanceZone.meaning, /不是真實莊家成交成本/);
  assert.match(result.scoreMeaning, /不是勝率/);
});

test('dealer map keeps unavailable data explicit instead of inventing values', () => {
  const missingContract = buildDealerMap({ snapshot: { options: { data: {} } } });
  assert.deepEqual(
    { available: missingContract.available, state: missingContract.state, executionAuthorized: missingContract.executionAuthorized },
    { available: false, state: 'insufficient_data', executionAuthorized: false },
  );

  const noStrikes = buildDealerMap({
    snapshot: {
      options: {
        dataDate: '2026-07-24',
        data: { contract: '202607F4', contracts: [{ contract: '202607F4', strikes: [] }] },
      },
    },
  });
  assert.equal(noStrikes.available, false);
  assert.match(noStrikes.reason, /逐履約價OI/);
});

test('dealer map does not join a different expiry contract into wall history', () => {
  const prior = snapshot({ date: '2026-07-23', contract: '202607F3' });
  const result = buildDealerMap({ snapshot: snapshot(), history: [prior] });
  assert.equal(result.sameContractDays, 1);
  assert.equal(result.walls.call.movement, null);
  assert.match(result.warnings[0], /同契約歷史不足2日/);
});


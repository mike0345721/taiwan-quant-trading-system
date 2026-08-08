import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateFuturesRoundTripCost, calculateOptionRoundTripCost, costScenarios } from '../src/trading-costs.mjs';

test('futures costs separate tax, commission and slippage for each contract', () => {
  const tx = calculateFuturesRoundTripCost({ instrument: 'TX', entryPrice: 45_000, exitPrice: 45_000 });
  const mtx = calculateFuturesRoundTripCost({ instrument: 'MTX', entryPrice: 45_000, exitPrice: 45_000 });
  const tmf = calculateFuturesRoundTripCost({ instrument: 'TMF', entryPrice: 45_000, exitPrice: 45_000 });
  assert.ok(Math.abs(tx.taxCash - 360) < 1e-9);
  assert.ok(Math.abs(mtx.taxCash - 90) < 1e-9);
  assert.ok(Math.abs(tmf.taxCash - 18) < 1e-9);
  assert.equal(tx.commissionPerSide, 30);
  assert.equal(mtx.commissionPerSide, 17);
  assert.equal(tmf.commissionPerSide, 12);
  assert.ok(Math.abs(tx.totalPoints - 4.1) < 1e-9);
  assert.ok(Math.abs(mtx.totalPoints - 4.48) < 1e-9);
  assert.ok(Math.abs(tmf.totalPoints - 6.2) < 1e-9);
  assert.equal(costScenarios(45_000).length, 3);
});

test('option costs use entry and exit premium independently', () => {
  const cost = calculateOptionRoundTripCost({ entryPremium: 200, exitPremium: 250, slippagePremiumPointsRoundTrip: 1 });
  assert.equal(cost.commissionPerSide, 14);
  assert.equal(cost.taxCash, 22.5);
  assert.equal(cost.totalCash, 100.5);
  assert.equal(cost.totalPremiumPoints, 2.01);
});

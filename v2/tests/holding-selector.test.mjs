import test from 'node:test';
import assert from 'node:assert/strict';
import { chooseHoldingPeriod, riskAdjustedUtility } from '../src/holding-selector.mjs';

const candidate = (key, days, metrics) => ({ strategy: { key, holdingDays: days }, metrics });

test('holding selector chooses no trade unless preregistered inner gate passes', () => {
  const result = chooseHoldingPeriod([
    candidate('h1', 1, { trades: 20, profitFactor: 0.9, totalNetPoints: -10 }),
    candidate('h2', 2, { trades: 8, profitFactor: 2, totalNetPoints: 100 }),
  ]);
  assert.equal(result.choice, 'no_trade');
});

test('holding selector chooses risk-adjusted utility instead of PF alone', () => {
  const result = chooseHoldingPeriod([
    candidate('h1', 1, { trades: 20, profitFactor: 1.2, totalNetPoints: 400, maxDrawdownPoints: 100, mae10PctPoints: -30 }),
    candidate('h2', 2, { trades: 15, profitFactor: 1.8, totalNetPoints: 450, maxDrawdownPoints: 1200, mae10PctPoints: -500 }),
  ]);
  assert.equal(result.choice, 'h1');
  const tie = chooseHoldingPeriod([
    candidate('h1', 1, { trades: 30, profitFactor: 1.2, totalNetPoints: 300, maxDrawdownPoints: 100, mae10PctPoints: -20 }),
    candidate('h2', 2, { trades: 30, profitFactor: 1.2, totalNetPoints: 300, maxDrawdownPoints: 100, mae10PctPoints: -20 }),
  ]);
  assert.equal(tie.choice, 'h1');
});

test('risk-adjusted utility penalizes drawdown, tail MAE and small samples', () => {
  const stable = riskAdjustedUtility({ trades: 30, totalNetPoints: 600, maxDrawdownPoints: 200, mae10PctPoints: -50 });
  const risky = riskAdjustedUtility({ trades: 30, totalNetPoints: 600, maxDrawdownPoints: 1500, mae10PctPoints: -500 });
  const small = riskAdjustedUtility({ trades: 10, totalNetPoints: 200, maxDrawdownPoints: 200, mae10PctPoints: -50 });
  assert.ok(stable > risky);
  assert.ok(stable > small);
});

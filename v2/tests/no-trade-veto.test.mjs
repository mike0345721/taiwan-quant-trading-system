import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeNoTradeVeto } from '../src/no-trade-veto.mjs';

function trade(index, overrides = {}) {
  const signal = index % 2 ? 1 : -1;
  return { signal, netPoints: 20, netReturnPct: 0.1, maePoints: -20, mfePoints: 40, atr20: 100 + index,
    fredVix: 15 + index / 10, foreignSpot5d: signal * 100, regime: 'range', daysToExpiry: 3, ...overrides };
}

test('no-trade thresholds come only from development trades', () => {
  const development = Array.from({ length: 80 }, (_, index) => trade(index));
  const holdout = Array.from({ length: 20 }, (_, index) => trade(index, { atr20: 10_000 + index, fredVix: 100 + index }));
  const result = analyzeNoTradeVeto(development, holdout);
  assert.ok(result.thresholds.atr20DevelopmentQ75 < 200);
  assert.ok(result.thresholds.previousUsVixDevelopmentQ75 < 30);
  assert.equal(result.sample.holdoutTrades, 20);
});

test('veto study reports kept and removed risk separately', () => {
  const development = Array.from({ length: 80 }, (_, index) => trade(index));
  const holdout = Array.from({ length: 30 }, (_, index) => trade(index, index < 12 ? { regime: 'high_vol', netPoints: -50, maePoints: -100 } : {}));
  const result = analyzeNoTradeVeto(development, holdout);
  const highVol = result.studies.find((study) => study.key === 'high_vol_regime');
  assert.equal(highVol.holdout.vetoed.trades, 12);
  assert.equal(highVol.holdout.kept.trades, 18);
  assert.ok(highVol.holdout.kept.totalNetPoints > highVol.holdout.all.totalNetPoints);
});

test('missing spot history does not become a zero-magnitude conflict threshold', () => {
  const development = Array.from({ length: 80 }, (_, index) => trade(index, { foreignSpot5d: index < 60 ? null : 100 }));
  const holdout = Array.from({ length: 20 }, (_, index) => trade(index));
  const result = analyzeNoTradeVeto(development, holdout);
  assert.equal(result.thresholds.foreignSpot5dAbsoluteMedian, 100);
});

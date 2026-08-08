import test from 'node:test';
import assert from 'node:assert/strict';
import { compareMirrorTrades, mirrorTrade } from '../src/mirror-backtest.mjs';

test('mirror keeps date and cost but reverses direction and gross points', () => {
  const result = mirrorTrade({ tradeDate: '2026-01-02', signal: 1, grossPoints: 100, costPoints: 8 });
  assert.equal(result.signal, -1); assert.equal(result.grossPoints, -100); assert.equal(result.netPoints, -108);
});

test('mirror comparison uses exactly the same active samples', () => {
  const result = compareMirrorTrades([{ signal: 1, grossPoints: 100, costPoints: 8 }, { signal: -1, grossPoints: -50, costPoints: 8 }, { signal: 0, grossPoints: 0, costPoints: 0 }]);
  assert.equal(result.original.trades, 2); assert.equal(result.mirror.trades, 2);
  assert.equal(result.original.totalNetPoints, 34); assert.equal(result.mirror.totalNetPoints, -66);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { alignDailySeries, matchedLongDrift, movingBlockBootstrapDifference } from '../src/paired-bootstrap.mjs';

test('paired alignment keeps only common dates', () => {
  const aligned = alignDailySeries({
    candidate: [{ tradeDate: '2026-01-01', netPoints: 2 }, { tradeDate: '2026-01-02', netPoints: 3 }],
    benchmark: [{ tradeDate: '2026-01-02', netPoints: 1 }, { tradeDate: '2026-01-03', netPoints: 4 }],
  });
  assert.deepEqual(aligned, [{ tradeDate: '2026-01-02', values: { candidate: 3, benchmark: 1 } }]);
});

test('paired bootstrap is deterministic and detects a uniformly positive difference', () => {
  const aligned = Array.from({ length: 40 }, (_, index) => ({ tradeDate: String(index), values: { candidate: 2, benchmark: 0 } }));
  const first = movingBlockBootstrapDifference(aligned, 'candidate', 'benchmark', { iterations: 200, blockSize: 5, seed: 7 });
  const second = movingBlockBootstrapDifference(aligned, 'candidate', 'benchmark', { iterations: 200, blockSize: 5, seed: 7 });
  assert.deepEqual(first, second);
  assert.equal(first.supported, true);
  assert.deepEqual(first.ci95, [80, 80]);
});

test('matched long drift uses the same opportunities and costs', () => {
  const rows = matchedLongDrift([
    { tradeDate: 'a', signal: -1, entryClose: 100, exitClose: 90, netPoints: 2 },
    { tradeDate: 'b', signal: 0, entryClose: 100, exitClose: 120, netPoints: 0 },
  ], 8);
  assert.equal(rows[0].netPoints, -18);
  assert.equal(rows[1].netPoints, 0);
});

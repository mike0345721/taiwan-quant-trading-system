import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeTargetFeasibility } from '../src/target-feasibility.mjs';

test('Alternative targets expose daily-ready and intraday-limited research paths', () => {
  const rows = Array.from({ length: 12 }, (_, index) => ({
    tradeDate: `2026-01-${String(index + 1).padStart(2, '0')}`,
    txContract: '202601',
    txOpen: 20_000 + index * 10,
    txHigh: 20_080 + index * 10,
    txLow: 19_950 + index * 10,
    txClose: 20_020 + index * 10,
  }));
  const report = analyzeTargetFeasibility(rows);
  assert.equal(report.horizons[1].samples, 11);
  assert.equal(report.horizons[3].samples, 9);
  assert.equal(report.targets.find((row) => row.key === 'large_move').status, 'ready_daily');
  assert.equal(report.targets.find((row) => row.key === 'trend_range').status, 'daily_proxy_only');
  assert.ok(report.horizons[1].absoluteMovePct.q75 >= 0);
});

test('Target feasibility does not treat contract rollover as an overnight gap', () => {
  const rows = [
    { tradeDate: '2026-01-01', txContract: '202601', txOpen: 100, txHigh: 102, txLow: 99, txClose: 101 },
    { tradeDate: '2026-01-02', txContract: '202602', txOpen: 110, txHigh: 112, txLow: 109, txClose: 111 },
    { tradeDate: '2026-01-03', txContract: '202602', txOpen: 111, txHigh: 113, txLow: 110, txClose: 112 },
  ];
  const report = analyzeTargetFeasibility(rows);
  assert.equal(report.horizons[1].absoluteGapPct.samples, 1);
  assert.equal(report.horizons[2].samples, 1);
});

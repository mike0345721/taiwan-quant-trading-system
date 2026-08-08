import assert from 'node:assert/strict';
import test from 'node:test';
import { buildContinuityReport, missingDates } from '../src/data-continuity.mjs';

test('missingDates returns sorted gaps without duplicates', () => {
  assert.deepEqual(missingDates(['2026-07-28', '2026-07-27', '2026-07-27'], ['2026-07-27']), ['2026-07-28']);
});

test('continuity report separates recoverable gaps from exact live-ledger gaps', () => {
  const report = buildContinuityReport({
    generatedAt: '2026-07-29T00:00:00.000Z',
    expectedDates: ['2026-07-27', '2026-07-28'],
    recoverableCoverage: {
      marketDaily: ['2026-07-27', '2026-07-28'],
      optionsStrikeDaily: ['2026-07-27'],
    },
    liveCoverage: {
      '2026-07-27': ['IX0001', '2330'],
      '2026-07-28': ['IX0001'],
    },
  });
  assert.equal(report.executionAuthorized, false);
  assert.equal(report.recoverable.marketDaily.status, 'PASS');
  assert.deepEqual(report.recoverable.optionsStrikeDaily.missingDays, ['2026-07-28']);
  assert.equal(report.liveEventLedger.status, 'GAP_RECORDED');
  assert.deepEqual(report.liveEventLedger.incompleteDays, [{ date: '2026-07-28', missingProducts: ['2330'] }]);
});

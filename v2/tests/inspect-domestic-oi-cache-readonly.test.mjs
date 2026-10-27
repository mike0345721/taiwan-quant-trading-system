import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyOiCacheRow, planOiCacheRepair } from '../scripts/inspect-domestic-oi-cache-readonly.mjs';

const anomaly = {
  trade_date: '2026-07-15',
  institution_type: 'dealer',
  open_interest_long: 7573,
  open_interest_short: 5221,
  detail_net: -664,
  final_net: -664,
};
const verifiedShape = { state: 'AVAILABLE', fileName: '2026-07-01-2026-07-31.csv.gz', sha256: 'test-only' };

test('cached official triplet can be classified as candidate but never applied', () => {
  const source = { ...verifiedShape, item: { long: 3941, short: 4605, net: -664 } };
  const plan = planOiCacheRepair({
    generatedAt: '2026-10-27T00:55:04Z',
    institutionalFuturesOiConsistency: { mismatchDates: [anomaly] },
  }, () => source);
  assert.equal(plan.status, 'REVIEW_ONLY_HOLD');
  assert.equal(plan.readOnly, true);
  assert.equal(plan.databaseWritten, false);
  assert.equal(plan.repairApplied, false);
  assert.equal(plan.repairedRows, 0);
  assert.deepEqual(plan.counts, { CANDIDATE_PENDING_SOURCE_VERIFICATION: 1 });
  assert.equal(plan.rows[0].cacheNet, -664);
  assert.equal(plan.rows[0].databaseLong, 7573);
});

test('no cached source fails closed without treating report as repaired', () => {
  const result = classifyOiCacheRow(anomaly, null);
  assert.equal(result.status, 'CACHE_MISSING_HOLD');
  assert.equal(result.cacheFileName, null);
});

test('conflicting cache arithmetic or final net both remain HOLD', () => {
  const broken = classifyOiCacheRow(anomaly, {
    ...verifiedShape, item: { long: 3941, short: 4605, net: -663 },
  });
  assert.equal(broken.status, 'CACHE_ARITHMETIC_CONFLICT_HOLD');
  const otherNet = classifyOiCacheRow(anomaly, {
    ...verifiedShape, item: { long: 3941, short: 4606, net: -665 },
  });
  assert.equal(otherNet.status, 'CACHE_FINAL_NET_CONFLICT_HOLD');
});

test('invalid quality receipt is not silently converted to an empty success', () => {
  assert.throws(() => planOiCacheRepair({}, () => null), /OI_QUALITY_REPORT_OR_LOOKUP_INVALID/);
});

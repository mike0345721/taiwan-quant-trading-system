import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBasisTermRows, priorZScore, selectNearAndNext, thirdWednesday } from '../src/basis-term-structure.mjs';

test('selects active near month and the next outright monthly contract', () => {
  const selected = selectNearAndNext([
    { contract: '202607/202608', close: 100, is_active: 0 },
    { contract: '202609', close: 46166, is_active: 0 },
    { contract: '202607', close: 45678, is_active: 1 },
    { contract: '202608', close: 45987, is_active: 0 },
  ]);
  assert.equal(selected.near.contract, '202607');
  assert.equal(selected.next.contract, '202608');
});

test('third Wednesday calculation matches the TX monthly expiry rule', () => {
  assert.equal(thirdWednesday('202607').toISOString().slice(0, 10), '2026-07-15');
});

test('term changes do not cross a contract-pair rollover', () => {
  const rows = buildBasisTermRows([
    { trade_date: '2026-07-14', contract: '202607', close: 100, is_active: 1 },
    { trade_date: '2026-07-14', contract: '202608', close: 102, is_active: 0 },
    { trade_date: '2026-07-16', contract: '202608', close: 103, is_active: 1 },
    { trade_date: '2026-07-16', contract: '202609', close: 104, is_active: 0 },
  ]);
  assert.equal(rows[1].termChange1dBps, null);
});

test('rolling z-score uses prior observations only', () => {
  const values = [1, 2, 3, 100];
  const scores = priorZScore(values, 3, 3);
  assert.equal(scores[2], null);
  assert.ok(scores[3] > 100);
});

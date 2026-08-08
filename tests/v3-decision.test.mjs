import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { buildV3Decision, ledgerRecord, quantile } from '../src/v3-decision.mjs';

test('quantile interpolates and ignores invalid values', () => {
  assert.equal(quantile([1, 2, null, 4], 0.5), 2);
  assert.equal(quantile([], 0.5), null);
});

test('V3 decision fails closed when research tables are absent', () => {
  const db = new DatabaseSync(':memory:');
  const decision = buildV3Decision(db);
  assert.equal(decision.available, false);
  assert.equal(decision.reason, 'INSUFFICIENT_RESEARCH_HISTORY');
  db.close();
});

test('ledger record keeps risk, candidate direction and veto only', () => {
  const record = ledgerRecord({
    available: true, version: '3.1.0', dataDate: '2026-07-14', generatedAt: '2026-07-14T12:00:00.000Z',
    risk: { score: 60, level: '高', groups: [{ key: 'price', active: true }, { key: 'global', active: false }] },
    direction: { score: -100, bias: '偏空候選', votes: [{ key: 'short', vote: -1 }] },
    action: { status: '防守等待' }, vetoes: ['禁止追價'],
  });
  assert.deepEqual(record.activeRiskGroups, ['price']);
  assert.equal(record.directionBias, '偏空候選');
  assert.deepEqual(record.vetoes, ['禁止追價']);
});

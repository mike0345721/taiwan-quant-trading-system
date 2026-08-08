import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOiRows, cleanOiDelta, oiAudit } from '../src/oi-normalization.mjs';

test('OI normalization keeps near and total definitions separate', () => {
  const rows = normalizeOiRows([
    { tradeDate: '2026-06-15', nearContract: '202606', nearContractOi: 90_000, totalMarketOi: 120_000, daysToNearExpiry: 3 },
    { tradeDate: '2026-06-16', nearContract: '202606', nearContractOi: 80_000, totalMarketOi: 125_000, daysToNearExpiry: 2 },
  ], 'test');
  assert.equal(rows[0].researchOi, 90_000);
  assert.equal(rows[0].researchDefinition, 'near_contract_oi');
  assert.equal(rows[1].qualityStatus, 'rollover_window');
  assert.equal(cleanOiDelta(rows, 1, 1), null);
});

test('OI deltas require clean same-contract windows', () => {
  const rows = normalizeOiRows([
    { tradeDate: '2026-06-18', nearContract: '202607', nearContractOi: 70_000, daysToNearExpiry: 27 },
    { tradeDate: '2026-06-19', nearContract: '202607', nearContractOi: 72_000, daysToNearExpiry: 26 },
    { tradeDate: '2026-06-22', nearContract: '202607', nearContractOi: 75_000, daysToNearExpiry: 23 },
    { tradeDate: '2026-06-23', nearContract: '202607', nearContractOi: 74_000, daysToNearExpiry: 22 },
  ], 'test');
  assert.equal(cleanOiDelta(rows, 1, 1), 2_000);
  assert.equal(cleanOiDelta(rows, 3, 3), 4_000);
});

test('OI audit reports definition mismatches without merging them', () => {
  const rows = normalizeOiRows([
    { tradeDate: '2026-07-09', nearContract: '202607', nearContractOi: 91_340, totalMarketOi: 98_592, daysToNearExpiry: 6 },
  ], 'test');
  const audit = oiAudit(rows);
  assert.equal(audit.definitionMismatchDays, 1);
  assert.equal(audit.researchDefinition, 'near_contract_oi');
});

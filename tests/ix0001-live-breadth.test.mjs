import test from 'node:test';
import assert from 'node:assert/strict';
import { IX0001_BREADTH_CONTRACT, auditIx0001Breadth, extractIx0001Breadth } from '../src/ix0001-live-breadth.mjs';

function record(overrides = {}) {
  return {
    kind: 'index_quote', code: 'IX0001', product: 'IX0001',
    exchangeTimestamp: '2026-08-14T09:01:00', receivedAt: '2026-08-14T09:01:00.100+08:00',
    payload: {
      code: 'IX0001', date: '2026-08-14', datetime: '2026-08-14T09:01:00',
      _received_at: '2026-08-14T09:01:00.100+08:00', raise_count: 700, fall_count: 200,
      flat_count: 100, limit_up_count: 10, limit_down_count: 1, no_trade: 5,
      ...(overrides.payload || {}),
    },
    ...overrides,
  };
}

test('IX0001 extractor preserves governed fields and availability lineage', () => {
  const result = extractIx0001Breadth(record());
  assert.equal(result.sourceId, 'SHIOAJI_INDEX_QUOTE_IX0001');
  assert.equal(result.session, 'DAY');
  assert.equal(result.breadth.raise_count, 700);
  assert.equal(result.availableAt, '2026-08-14T01:01:00.100Z');
  assert.equal(result.nativeSequenceAvailability, 'UNAVAILABLE');
  assert.equal(result.promotionState, 'RAW_ONLY');
  assert.equal(result.directionState, 'NOT_ELIGIBLE');
});

test('missing breadth fields and non-day records fail closed', () => {
  const missing = extractIx0001Breadth(record({ payload: { fall_count: null } }));
  assert.equal(missing.qualityStatus, 'QUALITY_INSUFFICIENT');
  assert.ok(missing.qualityReasons.includes('MISSING_OR_INVALID_FALL_COUNT'));
  const night = extractIx0001Breadth(record({
    exchangeTimestamp: '2026-08-14T19:00:00',
    payload: { datetime: '2026-08-14T19:00:00', _received_at: '2026-08-14T19:00:00.050+08:00' },
  }));
  assert.equal(night.session, 'AFTER_MARKET');
  assert.ok(night.qualityReasons.includes('SESSION_AFTER_MARKET_NOT_ELIGIBLE_FOR_LIVE_BREADTH'));
});

test('breadth replay is deterministic, future-safe and not promoted', () => {
  const records = [record(), record({
    exchangeTimestamp: '2026-08-14T09:02:00',
    payload: { datetime: '2026-08-14T09:02:00', _received_at: '2026-08-14T09:02:00.050+08:00' },
  })];
  const left = auditIx0001Breadth(records, { tradeDate: '2026-08-14', asOf: '2026-08-14T01:03:00Z' });
  const right = auditIx0001Breadth([...records].reverse(), { tradeDate: '2026-08-14', asOf: '2026-08-14T01:03:00Z' });
  assert.equal(left.status, 'RAW_VALIDATED_CANDIDATE');
  assert.equal(left.futureDataViolations, 0);
  assert.equal(left.coverageState, 'PARTIAL');
  assert.equal(left.deterministicReplayHash, right.deterministicReplayHash);
  assert.equal(left.promotionState, 'RAW_ONLY');
});

test('future availability is excluded and blocks candidate readiness', () => {
  const result = auditIx0001Breadth([record()], {
    tradeDate: '2026-08-14', asOf: '2026-08-14T01:00:00Z',
  });
  assert.equal(result.status, 'NOT_READY');
  assert.equal(result.futureDataViolations, 1);
});

test('IX0001 reuses one governed callback and prohibits duplicate collector', () => {
  assert.equal(IX0001_BREADTH_CONTRACT.callback, 'set_on_quote_idx_v1_callback');
  assert.equal(IX0001_BREADTH_CONTRACT.duplicateCollectorAllowed, false);
  assert.equal(IX0001_BREADTH_CONTRACT.maximumPromotionReadiness, 'RAW_VALIDATED_CANDIDATE');
});

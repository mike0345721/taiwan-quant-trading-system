import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildDashboardDw4Evidence, DW4_DASHBOARD_FAMILIES } from '../src/dashboard-dw4-evidence.mjs';

function item(sourceId, overrides = {}) {
  return {
    sourceId,
    sourceType: 'TEST_FIXTURE',
    sourceAvailability: 'SOURCE_AVAILABLE',
    freshnessState: 'FRESH',
    quality: 'PASS',
    readinessState: 'READY',
    exchangeTimestamp: '2026-08-12T00:15:00.000Z',
    availableAt: '2026-08-12T00:16:00.000Z',
    ...overrides,
  };
}

test('dashboard adapter preserves unavailable, stale, quality and promotion exclusions', () => {
  const result = buildDashboardDw4Evidence({
    items: [
      item('chartBar', { quality: 'QUALITY_INSUFFICIENT', readinessState: 'QUALITY_INSUFFICIENT', reason: 'TIMESTAMP_LINEAGE_INSUFFICIENT' }),
      item('breadth', { freshnessState: 'STALE' }),
      item('futuresPositioning', { sourceAvailability: 'SOURCE_MISSING', freshnessState: 'UNAVAILABLE', quality: 'UNAVAILABLE', availableAt: null }),
      item('txoLiveChainRaw', { readinessState: 'RAW_VALIDATED_CANDIDATE' }),
      item('marketOverview'),
    ],
  });
  assert.equal(result.conflictState, 'NO_DIRECTIONAL_EVIDENCE');
  assert.equal(result.coverageState, 'INSUFFICIENT');
  assert.equal(result.dataTrustState, 'BLOCKED');
  assert.deepEqual(result.expectedEvidenceFamilies, [...DW4_DASHBOARD_FAMILIES].sort());
  assert.deepEqual(result.unavailableEvidenceFamilies, ['FUTURES_INSTITUTIONAL']);
  assert.deepEqual(result.staleEvidenceFamilies, ['PARTICIPATION_BREADTH']);
  assert.deepEqual(result.qualityExcludedFamilies, ['FUTURES_INSTITUTIONAL', 'OPTIONS_CONTEXT', 'PRICE_STRUCTURE']);
  assert.deepEqual(result.promotionExcludedFamilies, [...DW4_DASHBOARD_FAMILIES].sort());
  assert.equal(result.evidence.find((entry) => entry.family === 'OPTIONS_CONTEXT').promotionState, 'RAW_ONLY');
  assert.equal(result.evidence.every((entry) => entry.directionState === 'NOT_ELIGIBLE'), true);
});

test('missing backend data fails closed without inventing neutral evidence', () => {
  const result = buildDashboardDw4Evidence({ items: [] });
  assert.equal(result.conflictState, 'NO_DIRECTIONAL_EVIDENCE');
  assert.equal(result.coverageState, 'INSUFFICIENT');
  assert.equal(result.dataTrustState, 'BLOCKED');
  assert.equal(result.eligibleFamilies, 0);
  assert.equal(result.evidence.every((entry) => entry.availabilityState === 'UNAVAILABLE'), true);
  assert.equal(result.evidence.every((entry) => entry.directionState !== 'NEUTRAL'), true);
});

test('DW-4 UI is three-axis, progressive and contains no magic score or order route', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  for (const id of ['dw-conflict-state', 'dw-coverage-state', 'dw-trust-state', 'dw-family-grid']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const text of ['證據衝突', '完整度', '資料信任', '尚未 Promotion', 'READ ONLY · NOT A TRADING SIGNAL']) {
    assert.match(html, new RegExp(text));
  }
  assert.match(app, /renderDw4Evidence/);
  assert.match(styles, /\.dw-conflict-axis-grid/);
  assert.doesNotMatch(html, /Bullish Score|Bearish Score|confidence gauge/i);
  assert.doesNotMatch(app, /place_order|cancel_order|update_order/);
});

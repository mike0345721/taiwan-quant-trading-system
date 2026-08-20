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
  assert.equal(result.evidence.every((entry) => entry.detail.descriptiveStatus === 'UNAVAILABLE'), true);
});

test('available descriptive data remains visible while promotion and direction stay ineligible', () => {
  const result = buildDashboardDw4Evidence({
    items: [
      item('chartBar'), item('breadth', { readinessState: 'RAW_VALIDATED_CANDIDATE' }),
      item('futuresPositioning'), item('optionsEod'), item('marketOverview'),
    ],
  }, {
    chart: {
      lastPrice: 22510, actualContract: 'TXFH6', session: 'DAY',
      openingRange: { status: 'READY', high: 22520, low: 22480 },
      levels: { vwap: { availability: 'AVAILABLE', value: 22501.5, vwapSession: 'DAY' } },
    },
    snapshot: {
      marketBreadth: { data: { raise_count: 700, fall_count: 200, flat_count: 100 } },
      futuresInstitutional: { data: { foreignNet: -1000 } },
      options: { data: { oiPcRatio: 1.3, callWall: { strike: 23000 }, putWall: { strike: 22000 }, maxPain: 22500 } },
      marketOverview: { data: { vix: 18, usdtwd: 30.5, ndxProxy: 0.6 } },
    },
  });
  assert.equal(result.evidence.every((entry) => entry.directionState === 'NOT_ELIGIBLE'), true);
  assert.equal(result.evidence.every((entry) => entry.eligibleDirectionalEvidence === false), true);
  assert.equal(result.evidence.every((entry) => ['NOT_PROMOTED', 'RAW_ONLY'].includes(entry.promotionState)), true);
  assert.equal(result.evidence.every((entry) => entry.detail.descriptiveStatus === 'AVAILABLE'), true);
  const global = result.evidence.find((entry) => entry.family === 'GLOBAL_FX');
  const breadth = result.evidence.find((entry) => entry.family === 'PARTICIPATION_BREADTH');
  const futures = result.evidence.find((entry) => entry.family === 'FUTURES_INSTITUTIONAL');
  assert.equal(global.detail.identityWarning, 'NDX_PROXY != TRUE_NQ');
  assert.equal(global.detail.descriptiveValues.some((entry) => entry.label === 'NDX Proxy'), true);
  assert.equal(global.detail.descriptiveValues.some((entry) => /NQ Futures/i.test(entry.label)), false);
  assert.equal(breadth.detail.descriptiveValues.every((entry) => entry.sourceMode === 'LIVE_OR_REPLAY'), true);
  assert.equal(futures.detail.descriptiveValues.every((entry) => entry.sourceMode === 'EOD'), true);
  assert.equal(global.detail.descriptiveValues.find((entry) => entry.label === 'USD/TWD').sourceMode, 'EOD_OR_DELAYED');
  assert.equal(global.detail.descriptiveValues.find((entry) => entry.label === 'NDX Proxy').sourceMode, 'PROXY_ONLY');
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
  assert.match(app, /dw-family-status-grid/);
  assert.match(app, /描述資料；尚未納入 DW-4 方向彙總/);
  for (const label of ['可取得', '品質通過', '僅原始資料', '尚未升級為方向證據', '品質不足', '目前無法取得']) {
    assert.match(app, new RegExp(label));
  }
  assert.match(styles, /\.dw-conflict-axis-grid/);
  assert.match(styles, /\.dw-family-preview/);
  assert.doesNotMatch(html, /Bullish Score|Bearish Score|confidence gauge/i);
  assert.doesNotMatch(app, /place_order|cancel_order|update_order/);
});

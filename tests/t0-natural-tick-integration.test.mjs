import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';
import {
  buildResolutionRecord,
  buildTickBars,
  compareTickAndOhlc,
  executeNaturalTickSession,
  requiredPathCoverage,
  resolveRawTickSource,
  selectNaturalTickSessions,
} from '../src/t0-natural-tick-integration.mjs';

const root = path.resolve('.');
const row = {
  tradeDate: '2026-01-02', sessionId: '2026-01-02-DAY', selectedResearchContractCode: '202601',
  actualReplayContractCode: '202601', settlementClass: 'NORMAL_SESSION', rollSession: false, eligibilityClass: 'STRICT_PP1_ALIGNED',
};

function syntheticTicks() {
  const ticks = [];
  const start = Date.parse('2026-01-02T00:45:00.000Z');
  for (let bucket = 0; bucket < 28; bucket += 1) {
    const base = bucket < 3 ? 100 : bucket === 3 ? 102 : bucket === 4 ? 103 : 104;
    ticks.push({ sourceRowNumber: bucket + 1, normalizedSequence: bucket + 1, tradeDate: row.tradeDate, sessionId: row.sessionId, contractCode: row.actualReplayContractCode, exchangeTimestamp: new Date(start + bucket * 300_000).toISOString(), price: base, volume: 1 });
  }
  return ticks;
}

const costPolicy = {
  instruments: { TX: { commissionPerSideTwd: 30, contractMultiplier: 200, tickSizeIndexPoints: 1 } },
  tax: { futuresTransactionTaxRate: 0.00002 },
  costViews: [
    { viewId: 'GROSS', slippageTicksPerSide: 0 },
    { viewId: 'OPTIMISTIC_1_TICK_PER_SIDE', slippageTicksPerSide: 1 },
    { viewId: 'BASE_2_TICKS_PER_SIDE', slippageTicksPerSide: 2 },
    { viewId: 'CONSERVATIVE_3_TICKS_PER_SIDE', slippageTicksPerSide: 3 },
    { viewId: 'SEVERE_STRESS_5_TICKS_PER_SIDE', slippageTicksPerSide: 5 },
  ],
};

test('raw tick來源按日期確定性選取', () => {
  assert.match(resolveRawTickSource(root, '2026-06-30').zipPath, /paid-staging/);
  assert.match(resolveRawTickSource(root, '2026-07-01').zipPath, /intraday[\\/]raw/);
});

test('tick轉5分鐘K並通過28格必要路徑', () => {
  const bars = buildTickBars(syntheticTicks());
  assert.equal(bars.length, 28);
  assert.equal(requiredPathCoverage(row.tradeDate, bars).state, 'PASS');
});

test('缺少必要bucket不得判Tick PASS', () => {
  const ticks = syntheticTicks().slice(0, -1);
  const tickRead = { sourceState: 'AVAILABLE', source: { sourceClass: 'TEST', zipPath: 'x.zip', zipSha256: 'x' }, ticks, bars: buildTickBars(ticks), statistics: { normalizedOutOfOrderCount: 0, contractMismatchCount: 0, sequenceGapCount: 0, duplicateCount: 0, staleOrInvalidCount: 0 } };
  const output = buildResolutionRecord({ manifestRow: row, tickRead, ohlcAudit: { pass: true } });
  assert.equal(output.selectedReplayResolution, 'FIVE_MINUTE_OHLC_FALLBACK');
  assert.equal(output.fallbackReason, 'REQUIRED_TICK_PATH_INCOMPLETE');
});

test('完整Tick優先於OHLC', () => {
  const ticks = syntheticTicks();
  const tickRead = { sourceState: 'AVAILABLE', source: { sourceClass: 'TEST', zipPath: 'x.zip', zipSha256: 'x' }, ticks, bars: buildTickBars(ticks), statistics: { normalizedOutOfOrderCount: 0, contractMismatchCount: 0, sequenceGapCount: 0, duplicateCount: 0, staleOrInvalidCount: 0 } };
  assert.equal(buildResolutionRecord({ manifestRow: row, tickRead, ohlcAudit: { pass: true } }).selectedReplayResolution, 'TICK_REPLAY_PASS');
});

test('自然Tick執行使用Tick時間與五種成本視圖', () => {
  const ticks = syntheticTicks();
  const tickRead = { source: { zipPath: 'x.zip', zipSha256: 'x' }, ticks, bars: buildTickBars(ticks) };
  const output = executeNaturalTickSession({ manifestRow: row, tickRead, costPolicy });
  assert.equal(output.replayResolution, 'TICK_REPLAY_PASS');
  assert.equal(output.tradeState, 'TRADE');
  assert.equal(output.entryAt, '2026-01-02T01:05:00.000Z');
  assert.equal(output.costViews.length, 5);
  assert.ok(output.costViews.every((view) => view.accountingEquivalent));
});

test('三個自然Session依品質日期與分類決定，不看績效', () => {
  const records = [
    { tradeDate: '2026-01-03', sessionId: 'n', settlementClass: 'NORMAL_SESSION', rollSession: false, selectedReplayResolution: 'TICK_REPLAY_PASS' },
    { tradeDate: '2026-01-04', sessionId: 's', settlementClass: 'SETTLEMENT_FINAL_CONTRACT', rollSession: false, selectedReplayResolution: 'TICK_REPLAY_PASS' },
    { tradeDate: '2026-01-05', sessionId: 'r', settlementClass: 'NORMAL_SESSION', rollSession: true, selectedReplayResolution: 'TICK_REPLAY_PASS' },
  ];
  assert.deepEqual(selectNaturalTickSessions(records).selectedSessionList, ['n', 's', 'r']);
});

test('Tick與OHLC診斷明確隔離', () => {
  const output = compareTickAndOhlc({ tradeDate: row.tradeDate, sessionId: row.sessionId, tradeState: 'TRADE', entryReferencePrice: 100 }, { tradeState: 'NO_TRADE' });
  assert.equal(output.mixedIntoResearchStatistics, false);
  assert.equal(output.officialReplayResolution, 'TICK_REPLAY_PASS');
  assert.equal(output.comparisonReplayResolution, 'FIVE_MINUTE_OHLC_DIAGNOSTIC_ONLY');
});

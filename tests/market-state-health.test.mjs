import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMarketStateHealth } from '../src/market-state-health.mjs';

function record(tradeDate, state, overrides = {}) {
  return {
    tradeDate,
    state: {
      trend: 'UNCLEAR',
      direction: 'UNAVAILABLE',
      volatility: 'UNAVAILABLE',
      risk: 'UNAVAILABLE',
      globalAlignment: 'UNAVAILABLE',
      ...state,
    },
    evidence: [],
    conflicts: [],
    unavailable: [],
    researchOnly: true,
    executionAuthorized: false,
    ...overrides,
  };
}

function coreEvidence() {
  return [
    { key: 'localPricePersistence' },
    { key: 'twseBreadth' },
    { key: 'foreignCashFlow' },
  ];
}

test('health check reports transitions and run lengths without outcome data', () => {
  const report = analyzeMarketStateHealth([
    record('2026-01-01', { direction: 'BULLISH' }, { nextReturn: 99 }),
    record('2026-01-02', { direction: 'BULLISH' }, { nextReturn: -99 }),
    record('2026-01-03', { direction: 'CONFLICT' }),
    record('2026-01-04', { direction: 'CONFLICT' }),
    record('2026-01-05', { direction: 'BEARISH' }),
  ]);

  assert.equal(report.axes.direction.transitions.total, 4);
  assert.equal(report.axes.direction.transitions.stay, 2);
  assert.equal(report.axes.direction.transitions.change, 2);
  assert.equal(report.axes.direction.runs.longestRun, 2);
  assert.deepEqual(report.outcomeFieldsConsumed, []);
  assert.equal(JSON.stringify(report).includes('nextReturn'), false);
});

test('unobserved states are reported, not fabricated', () => {
  const report = analyzeMarketStateHealth([
    record('2026-01-01', { risk: 'NORMAL' }),
    record('2026-01-02', { risk: 'ELEVATED' }),
  ]);
  assert.ok(report.axes.risk.unobservedStates.includes('HIGH_RISK'));
  assert.equal(report.axes.risk.counts.HIGH_RISK, 0);
});

test('direction conflicts retain evidence-block vote patterns', () => {
  const report = analyzeMarketStateHealth([
    record('2026-01-01', { direction: 'CONFLICT' }, {
      conflicts: [{
        type: 'DIRECTION_BLOCK_CONFLICT',
        votes: [
          { block: 'localPrice', state: 'BULLISH' },
          { block: 'breadth', state: 'BEARISH' },
        ],
      }],
    }),
  ]);
  assert.equal(report.conflicts.byType.DIRECTION_BLOCK_CONFLICT, 1);
  assert.equal(report.conflicts.directionVotePatterns['breadth=BEARISH|localPrice=BULLISH'], 1);
});

test('UNCLEAR trend context is decomposed from local and breadth evidence', () => {
  const report = analyzeMarketStateHealth([
    record('2026-01-01', { trend: 'UNCLEAR' }, {
      evidence: [
        { key: 'localPricePersistence', trend: 'TREND_UP' },
        { key: 'twseBreadth', direction: 'BEARISH' },
      ],
    }),
  ]);
  assert.equal(report.trendUnclearContexts['TREND_UP|BEARISH'], 1);
});

test('core coverage subset excludes records missing local price, breadth or foreign flow without using outcomes', () => {
  const report = analyzeMarketStateHealth([
    record('2026-01-01', { trend: 'UNCLEAR' }, { evidence: [{ key: 'twseBreadth' }, { key: 'foreignCashFlow' }] }),
    record('2026-01-02', { trend: 'TREND_UP', direction: 'BULLISH' }, { evidence: coreEvidence() }),
    record('2026-01-03', { trend: 'TREND_DOWN', direction: 'BEARISH' }, { evidence: coreEvidence() }),
  ]);
  assert.equal(report.coreCoverageWindow.records, 2);
  assert.equal(report.coreCoverageWindow.excludedRecords, 1);
  assert.equal(report.coreCoverageWindow.firstTradeDate, '2026-01-02');
  assert.equal(report.coreCoverageWindow.contiguousSegments, 1);
  assert.equal(report.coreCoverageWindow.adjacentComparablePairs, 1);
  assert.equal(report.coreCoverageWindow.axes.trend.counts.TREND_UP, 1);
  assert.equal(report.coreCoverageWindow.axes.trend.counts.TREND_DOWN, 1);
  assert.deepEqual(report.outcomeFieldsConsumed, []);
});

test('core coverage transitions and runs do not bridge excluded source records', () => {
  const report = analyzeMarketStateHealth([
    record('2026-01-01', { direction: 'BULLISH' }, { evidence: coreEvidence() }),
    record('2026-01-02', { direction: 'BEARISH' }, { evidence: [{ key: 'twseBreadth' }, { key: 'foreignCashFlow' }] }),
    record('2026-01-03', { direction: 'BULLISH' }, { evidence: coreEvidence() }),
    record('2026-01-04', { direction: 'BULLISH' }, { evidence: coreEvidence() }),
  ]);
  const core = report.coreCoverageWindow;
  assert.equal(core.records, 3);
  assert.equal(core.contiguousSegments, 2);
  assert.equal(core.adjacentComparablePairs, 1);
  assert.equal(core.axes.direction.transitions.total, 1);
  assert.equal(core.axes.direction.transitions.stay, 1);
  assert.equal(core.axes.direction.runs.totalRuns, 2);
  assert.equal(core.axes.direction.runs.longestRun, 2);
});

test('health digest is deterministic for the same records regardless of input order', () => {
  const a = record('2026-01-01', { trend: 'TREND_UP', direction: 'BULLISH' }, { evidence: coreEvidence() });
  const b = record('2026-01-02', { trend: 'RANGE', direction: 'NEUTRAL' }, { evidence: coreEvidence() });
  const first = analyzeMarketStateHealth([a, b]);
  const second = analyzeMarketStateHealth([b, a]);
  assert.equal(first.healthDigest, second.healthDigest);
});

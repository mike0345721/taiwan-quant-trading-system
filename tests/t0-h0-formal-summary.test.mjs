import assert from 'node:assert/strict';
import test from 'node:test';
import { buildCostViewMetrics, buildFormalSummary, buildNaturalEventAudit, FORMAL_COST_VIEWS } from '../src/t0-h0-formal-summary.mjs';

function result({ date, direction = 'LONG', pnl = 100, settlementClass = 'NORMAL_SESSION', rollSession = false, state = 'TRADE', exitReason = 'TIME_EXIT' }) {
  const costs = FORMAL_COST_VIEWS.map(([id]) => ({ viewId: id, grossPnl: pnl + 10, netPnl: pnl, accountingEquivalent: true }));
  return {
    tradeDate: date, sessionId: `${date}-DAY`, tradeState: state,
    noTradeReason: state === 'NO_TRADE' ? 'NO_BREAKOUT_WITHIN_ENTRY_WINDOW' : null,
    replayResolution: 'TICK_REPLAY_PASS', breakoutDirection: direction, settlementClass, rollSession,
    exitReason: state === 'TRADE' ? exitReason : null, entryAt: `${date}T01:00:00.000Z`, exitAt: `${date}T02:00:00.000Z`,
    orHigh: 110, orLow: 100, maePoints: -5, mfePoints: 8, maeR: -0.5, mfeR: 0.8,
    falseBreakout: { falseBreakout: pnl < 0 }, costViews: state === 'TRADE' ? costs : undefined,
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

test('正式摘要固定五成本視圖與九個分層', () => {
  const rows = [result({ date: '2026-01-01', pnl: 100 }), result({ date: '2026-01-02', direction: 'SHORT', pnl: -50 }), result({ date: '2026-01-03', state: 'NO_TRADE' })];
  const summary = buildFormalSummary(rows);
  assert.equal(Object.keys(summary.costViews).length, 5);
  assert.ok(Object.values(summary.costViews).every((view) => Object.keys(view).length === 9));
  assert.equal(summary.counts.tradeCount, 2);
  assert.equal(summary.counts.noTradeCount, 1);
  assert.equal(summary.counts.noSampleCount, 0);
});

test('主要指標使用net PnL且Eligible Session含NO_TRADE', () => {
  const rows = [result({ date: '2026-01-01', pnl: 100 }), result({ date: '2026-01-02', pnl: -50 }), result({ date: '2026-01-03', state: 'NO_TRADE' })];
  const metrics = buildCostViewMetrics(rows, 'BASE_2_TICKS_PER_SIDE', 'BASE_2_TICKS_PER_SIDE');
  assert.equal(metrics.netPnl, 50);
  assert.equal(metrics.expectancyPerTrade, 25);
  assert.equal(metrics.averagePerEligibleSession, 50 / 3);
  assert.equal(metrics.profitFactor, 2);
  assert.equal(metrics.maximumDrawdown, -50);
});

test('小於20筆只標示DESCRIPTIVE_ONLY且不刪樣本', () => {
  const metrics = buildCostViewMetrics([result({ date: '2026-01-01' })], 'BASE_2_TICKS_PER_SIDE', 'BASE_2_TICKS_PER_SIDE');
  assert.equal(metrics.interpretationState, 'DESCRIPTIVE_ONLY');
  assert.equal(metrics.tradeCount, 1);
});

test('自然事件稽核依指定上限列出且保留實際數量', () => {
  const stop = result({ date: '2026-01-01', exitReason: 'STOP_EXIT' });
  stop.eventAudit = { firstTriggerTick: { exchangeTimestamp: stop.exitAt, price: 99 }, gapThroughStop: true, ambiguousSequence: true, eventOrderingBasis: 'AMBIGUOUS_SEQUENCE_CONSERVATIVE' };
  const audit = buildNaturalEventAudit([stop]);
  assert.equal(audit.firstFiveStopExits.actual, 1);
  assert.equal(audit.firstThreeGapThroughStops.actual, 1);
  assert.equal(audit.firstThreeAmbiguousSequence.actual, 1);
});

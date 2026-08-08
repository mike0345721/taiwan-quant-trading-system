import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  calculateRvol20,
  diagnoseFalseBreakout,
  evaluateEntryGapThroughStop,
  evaluateEntryWindow,
  hashJson,
  resolveBarStopExit,
  resolveTickStopExit,
  resolveTimeExit,
} from '../src/t0-data-replay-gate.mjs';

const costPolicy = JSON.parse(fs.readFileSync(path.resolve('research/t0-v1/cost-policy.json'), 'utf8'));
const spec = JSON.parse(fs.readFileSync(path.resolve('research/t0-v1/t0-final-spec.json'), 'utf8'));

test('已批准Cost Policy Hash保持不變', () => {
  assert.equal(hashJson(costPolicy), 'ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc');
  assert.equal(costPolicy.baseTicksPerSide, 2);
});

test('Long與Short Time Exit使用60分鐘後第一筆合法Tick', () => {
  const ticks = [
    { exchangeTimestamp: '2026-07-01T02:00:59.999Z', price: 101 },
    { exchangeTimestamp: '2026-07-01T02:01:00.000Z', price: 102 },
  ];
  const long = resolveTimeExit({ entryTimestamp: '2026-07-01T01:01:00.000Z', direction: 'LONG', ticks, slippageTicks: 2 });
  const short = resolveTimeExit({ entryTimestamp: '2026-07-01T01:01:00.000Z', direction: 'SHORT', ticks, slippageTicks: 2 });
  assert.equal(long.referencePrice, 102);
  assert.equal(long.finalFill, 100);
  assert.equal(short.finalFill, 104);
  assert.equal(long.exitReason, 'TIME_EXIT');
});

test('非整點Entry加60分鐘後取第一根barStart符合條件的完整5分鐘K開盤', () => {
  const result = resolveTimeExit({
    entryTimestamp: '2026-07-01T01:03:00.000Z',
    direction: 'LONG',
    bars: [
      { timestamp: '2026-07-01T02:00:00.000Z', open: 100, complete: true },
      { timestamp: '2026-07-01T02:05:00.000Z', open: 99, close: 95, complete: true },
    ],
    slippageTicks: 2,
  });
  assert.equal(result.timeExitAt, '2026-07-01T02:03:00.000Z');
  assert.equal(result.referenceTimestamp, '2026-07-01T02:05:00.000Z');
  assert.equal(result.referencePrice, 99);
  assert.equal(result.finalFill, 97);
  assert.equal(result.sourceType, 'FIVE_MINUTE_OPEN_FALLBACK');
});

test('Time Exit價格缺失不得用Session Close替代', () => {
  const result = resolveTimeExit({ entryTimestamp: '2026-07-01T01:00:00.000Z', direction: 'LONG', bars: [], slippageTicks: 2 });
  assert.deepEqual(result, { sampleState: 'NO_SAMPLE', noSampleReason: 'TIME_EXIT_PRICE_UNAVAILABLE', timeExitAt: '2026-07-01T02:00:00.000Z' });
});

test('Time Exit固定輸出0／1／2／3／5 tick情境', () => {
  const fills = costPolicy.costViews.map((view) => resolveTimeExit({
    entryTimestamp: '2026-07-01T01:00:00.000Z',
    direction: 'LONG',
    ticks: [{ exchangeTimestamp: '2026-07-01T02:00:00.000Z', price: 100 }],
    slippageTicks: view.slippageTicksPerSide,
  }).finalFill);
  assert.deepEqual(fills, [100, 99, 98, 97, 95]);
});

test('Bar Stop遵守Open gap優先與盤中觸價規則', () => {
  assert.deepEqual(resolveBarStopExit({ direction: 'LONG', stopPrice: 100, barOpen: 97, barHigh: 102, barLow: 96, slippageTicks: 2 }), { exitReason: 'STOP_EXIT', baseFill: 97, finalFill: 95 });
  assert.deepEqual(resolveBarStopExit({ direction: 'LONG', stopPrice: 100, barOpen: 101, barHigh: 102, barLow: 99, slippageTicks: 2 }), { exitReason: 'STOP_EXIT', baseFill: 100, finalFill: 98 });
  assert.deepEqual(resolveBarStopExit({ direction: 'SHORT', stopPrice: 100, barOpen: 103, barHigh: 104, barLow: 98, slippageTicks: 2 }), { exitReason: 'STOP_EXIT', baseFill: 103, finalFill: 105 });
  assert.deepEqual(resolveBarStopExit({ direction: 'SHORT', stopPrice: 100, barOpen: 99, barHigh: 101, barLow: 98, slippageTicks: 2 }), { exitReason: 'STOP_EXIT', baseFill: 100, finalFill: 102 });
});

test('Tick Stop使用首次合法穿越成交價', () => {
  const result = resolveTickStopExit({ direction: 'LONG', stopPrice: 100, ticks: [
    { exchangeTimestamp: '2026-07-01T01:00:00.000Z', price: 101 },
    { exchangeTimestamp: '2026-07-01T01:00:00.100Z', price: 98 },
    { exchangeTimestamp: '2026-07-01T01:00:00.200Z', price: 95 },
  ], slippageTicks: 2 });
  assert.equal(result.baseFill, 98);
  assert.equal(result.finalFill, 96);
});

test('Entry Window包含09:55確認棒但拒絕10:00後完成或進場', () => {
  assert.equal(evaluateEntryWindow({ confirmationBarStart: '2026-07-01T09:55:00+08:00', confirmationBarEnd: '2026-07-01T10:00:00+08:00', entryTimestamp: '2026-07-01T10:00:00+08:00' }).tradeState, 'ELIGIBLE');
  assert.deepEqual(evaluateEntryWindow({ confirmationBarStart: '2026-07-01T10:00:00+08:00', confirmationBarEnd: '2026-07-01T10:05:00+08:00', entryTimestamp: '2026-07-01T10:05:00+08:00' }), { tradeState: 'NO_TRADE', noTradeReason: 'ENTRY_WINDOW_EXPIRED' });
});

function referenceSessions(count = 22) {
  return Array.from({ length: count }, (_, index) => ({
    tradeDate: `2026-06-${String(index + 1).padStart(2, '0')}`,
    sessionId: `D${index + 1}`,
    sessionType: 'DAY',
    timeBucket: '09:30',
    cumulativeVolume: 100 + index,
    isSettlementSession: false,
    rollSession: false,
  }));
}

test('RVOL20只使用past-only、同日盤與同時槽，並排除Current Session', () => {
  const refs = referenceSessions();
  refs.push({ tradeDate: '2026-07-01', sessionId: 'CURRENT', sessionType: 'DAY', timeBucket: '09:30', cumulativeVolume: 99999, isSettlementSession: false, rollSession: false });
  refs.push({ tradeDate: '2026-06-30', sessionId: 'WRONG_BUCKET', sessionType: 'DAY', timeBucket: '09:35', cumulativeVolume: 99999, isSettlementSession: false, rollSession: false });
  refs.push({ tradeDate: '2026-06-30', sessionId: 'WRONG_SESSION', sessionType: 'NIGHT', timeBucket: '09:30', cumulativeVolume: 99999, isSettlementSession: false, rollSession: false });
  const result = calculateRvol20({ currentTradeDate: '2026-07-01', currentSessionId: 'CURRENT', currentSessionType: 'DAY', timeBucket: '09:30', currentCumulativeVolume: 220, referenceSessions: refs });
  assert.equal(result.validSessions, 20);
  assert.equal(result.referenceTradeDates.includes('2026-07-01'), false);
  assert.equal(result.qualityState, 'PASS');
});

test('RVOL20排除Settlement與Roll Session', () => {
  const refs = referenceSessions();
  refs[20].isSettlementSession = true;
  refs[21].rollSession = true;
  const result = calculateRvol20({ currentTradeDate: '2026-07-01', currentSessionId: 'CURRENT', currentSessionType: 'DAY', timeBucket: '09:30', currentCumulativeVolume: 200, referenceSessions: refs });
  assert.equal(result.validSessions, 20);
  assert.equal(result.referenceTradeDates.includes('2026-06-21'), false);
  assert.equal(result.referenceTradeDates.includes('2026-06-22'), false);
});

test('RVOL20不足15個合法Session保持UNAVAILABLE', () => {
  const result = calculateRvol20({ currentTradeDate: '2026-07-01', currentSessionId: 'CURRENT', currentSessionType: 'DAY', timeBucket: '09:30', currentCumulativeVolume: 200, referenceSessions: referenceSessions(14) });
  assert.deepEqual(result, { value: null, qualityState: 'UNAVAILABLE', validSessions: 14 });
});

test('T0正常Exit只有STOP_EXIT與TIME_EXIT，Safety Backstop不是一般離場', () => {
  assert.deepEqual(spec.baselineMechanics.normalExitPriority, ['STOP_EXIT', 'TIME_EXIT']);
  assert.equal(spec.baselineMechanics.sessionSafetyBackstop.normalT0ExitReason, false);
  assert.equal(spec.baselineMechanics.timeExit.sessionCloseFallbackForbidden, true);
});

test('Entry Gap Through Stop在Long與Short邊界正確拒絕交易', () => {
  assert.equal(evaluateEntryGapThroughStop({ direction: 'LONG', entryOpen: 101, stopPrice: 100 }).tradeState, 'ELIGIBLE');
  for (const entryOpen of [100, 99]) assert.equal(evaluateEntryGapThroughStop({ direction: 'LONG', entryOpen, stopPrice: 100 }).noTradeReason, 'ENTRY_GAP_THROUGH_STOP');
  assert.equal(evaluateEntryGapThroughStop({ direction: 'SHORT', entryOpen: 99, stopPrice: 100 }).tradeState, 'ELIGIBLE');
  for (const entryOpen of [100, 101]) assert.equal(evaluateEntryGapThroughStop({ direction: 'SHORT', entryOpen, stopPrice: 100 }).noTradeReason, 'ENTRY_GAP_THROUGH_STOP');
});

test('Entry Gap Through Stop不產生成本、稅、滑價或交易筆數且可重現', () => {
  const input = { direction: 'LONG', entryOpen: 100, stopPrice: 100 };
  const first = evaluateEntryGapThroughStop(input);
  assert.deepEqual(first, evaluateEntryGapThroughStop(input));
  assert.equal(first.countsAsEligibleSession, true);
  assert.equal(first.countsAsTrade, false);
  assert.equal(first.commission, 0);
  assert.equal(first.tax, 0);
  assert.equal(first.slippage, 0);
  assert.equal(first.entryPrice, null);
  assert.equal(first.exitPrice, null);
  assert.equal(first.grossPnl, null);
  assert.equal(first.netPnl, null);
});

function observationBar(timestamp, prices, close = prices.at(-1)) {
  return {
    timestamp, close, complete: true,
    pricePath: prices.map((price, index) => ({ exchangeTimestamp: new Date(Date.parse(timestamp) + index * 1_000).toISOString(), price })),
  };
}

test('Long與Short三根內收回OR且未達1R診斷為False Breakout', () => {
  const long = diagnoseFalseBreakout({ direction: 'LONG', entryPrice: 110, initialStopPrice: 100, orHigh: 108, orLow: 100, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [110, 112, 108]), observationBar('2026-01-02T01:05:00.000Z', [108]), observationBar('2026-01-02T01:10:00.000Z', [109])] });
  const short = diagnoseFalseBreakout({ direction: 'SHORT', entryPrice: 100, initialStopPrice: 110, orHigh: 110, orLow: 102, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [100, 98, 102]), observationBar('2026-01-02T01:05:00.000Z', [101]), observationBar('2026-01-02T01:10:00.000Z', [100])] });
  assert.equal(long.falseBreakoutReason, 'RETURNED_BELOW_OR_HIGH_BEFORE_1R');
  assert.equal(short.falseBreakoutReason, 'RETURNED_ABOVE_OR_LOW_BEFORE_1R');
});

test('先達1R再收回OR不得標成False Breakout', () => {
  const result = diagnoseFalseBreakout({ direction: 'LONG', entryPrice: 110, initialStopPrice: 100, orHigh: 108, orLow: 100, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [110, 120, 108]), observationBar('2026-01-02T01:05:00.000Z', [107]), observationBar('2026-01-02T01:10:00.000Z', [106])] });
  assert.equal(result.falseBreakout, false);
  assert.equal(result.falseBreakoutReason, 'FAVORABLE_1R_REACHED_BEFORE_OR_RETURN');
});

test('第四根才收回OR不屬於三根False Breakout窗口', () => {
  const result = diagnoseFalseBreakout({ direction: 'LONG', entryPrice: 110, initialStopPrice: 100, orHigh: 108, orLow: 100, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [110, 112]), observationBar('2026-01-02T01:05:00.000Z', [112, 111]), observationBar('2026-01-02T01:10:00.000Z', [111, 109]), observationBar('2026-01-02T01:15:00.000Z', [108])] });
  assert.equal(result.falseBreakout, false);
  assert.equal(result.falseBreakoutReason, 'NO_OR_RETURN_WITHIN_THREE_BARS');
});

test('三根內停損且未先達1R標記指定原因', () => {
  const result = diagnoseFalseBreakout({ direction: 'LONG', entryPrice: 110, initialStopPrice: 100, orHigh: 108, orLow: 100, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [110, 105, 100]), observationBar('2026-01-02T01:05:00.000Z', [101]), observationBar('2026-01-02T01:10:00.000Z', [102])] });
  assert.equal(result.falseBreakoutReason, 'STOPPED_WITHIN_FALSE_BREAKOUT_WINDOW');
});

test('三根完整Price Path不足時診斷UNAVAILABLE且不改動交易資料', () => {
  const trade = { entryPrice: 110, exitPrice: 105, netPnl: -1000 };
  const snapshot = structuredClone(trade);
  const result = diagnoseFalseBreakout({ direction: 'LONG', entryPrice: trade.entryPrice, initialStopPrice: 100, orHigh: 108, orLow: 100, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [110]), observationBar('2026-01-02T01:05:00.000Z', [109])] });
  assert.equal(result.falseBreakout, 'UNAVAILABLE');
  assert.equal(result.falseBreakoutQualityState, 'UNAVAILABLE');
  assert.deepEqual(trade, snapshot);
});

test('False Breakout相同輸入可重現且Long／Short規則對稱', () => {
  const input = { direction: 'SHORT', entryPrice: 100, initialStopPrice: 110, orHigh: 110, orLow: 102, observationBars: [observationBar('2026-01-02T01:00:00.000Z', [100, 99]), observationBar('2026-01-02T01:05:00.000Z', [99, 102]), observationBar('2026-01-02T01:10:00.000Z', [101])] };
  assert.deepEqual(diagnoseFalseBreakout(input), diagnoseFalseBreakout(input));
  assert.equal(diagnoseFalseBreakout(input).falseBreakoutDirection, 'SHORT');
});

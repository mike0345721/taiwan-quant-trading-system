import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { calculateTradeCost, classifySettlementSession, resolveGapThroughStopReference, SETTLEMENT_CLASSES, taxPerSide, validateDayReplay } from '../src/t0-data-replay-gate.mjs';

const costPolicy = JSON.parse(fs.readFileSync(path.resolve('research/t0-v1/cost-policy.json'), 'utf8'));
const contracts = [
  { product: 'TX', contractCode: '202608', expiryDate: '2026-08-19', finalTradingTimestamp: '2026-08-19T13:30:00+08:00' },
  { product: 'TX', contractCode: '202609', expiryDate: '2026-09-16', finalTradingTimestamp: '2026-09-16T13:30:00+08:00' },
];

test('Owner費率、Base 2 ticks與每邊交易稅分開計算', () => {
  assert.equal(costPolicy.instruments.TX.commissionPerSideTwd, 30);
  assert.equal(costPolicy.instruments.MTX.commissionPerSideTwd, 17);
  assert.equal(costPolicy.instruments.TMF.commissionPerSideTwd, 12);
  assert.equal(costPolicy.instruments.TXO.commissionPerSideTwd, 14);
  assert.equal(taxPerSide(20_000, 'TX', costPolicy), 80);
  assert.equal(costPolicy.baseTicksPerSide, 2);
  assert.deepEqual(costPolicy.costViews.map((row) => row.slippageTicksPerSide), [0, 1, 2, 3, 5]);
  assert.equal(costPolicy.costViews.find((row) => row.primaryH0View).viewId, 'BASE_2_TICKS_PER_SIDE');
  const trade = calculateTradeCost({ instrument: 'TX', entryIndex: 20_000, exitIndex: 20_010, direction: 'LONG', slippageTicksPerSide: 2 }, costPolicy);
  assert.deepEqual(trade, { grossPnl: 2000, actualEntryFillIndex: 20002, actualExitFillIndex: 20008, entryCommission: 30, exitCommission: 30, entryTax: 80, exitTax: 80, entrySlippage: 400, exitSlippage: 400, totalCost: 1020, netPnl: 980 });
});

test('Gap穿越Stop先取第一個合法不利價，再套用情境滑價', () => {
  const gap = resolveGapThroughStopReference({ direction: 'LONG', stopIndex: 19_990, firstLegalAdverseFillIndex: 19_985 });
  assert.equal(gap.referenceExitIndex, 19_985);
  assert.equal(gap.gapPointsBeyondStop, 5);
  const trade = calculateTradeCost({ instrument: 'TX', entryIndex: 20_000, exitIndex: gap.referenceExitIndex, direction: 'LONG', slippageTicksPerSide: 2 }, costPolicy);
  assert.equal(trade.actualExitFillIndex, 19_983);
  assert.notEqual(trade.actualExitFillIndex, 19_988);
  assert.throws(() => resolveGapThroughStopReference({ direction: 'SHORT', stopIndex: 20_010, firstLegalAdverseFillIndex: 20_005 }), /NOT_ADVERSE/);
});

test('一般日分類', () => {
  assert.equal(classifySettlementSession({ tradeDate: '2026-08-18', contractCode: '202608', contractMasterRows: contracts }), SETTLEMENT_CLASSES.NORMAL);
});

test('結算日且使用到期契約', () => {
  assert.equal(classifySettlementSession({ tradeDate: '2026-08-19', contractCode: '202608', contractMasterRows: contracts }), SETTLEMENT_CLASSES.FINAL);
});

test('結算日但使用非到期契約', () => {
  assert.equal(classifySettlementSession({ tradeDate: '2026-08-19', contractCode: '202609', contractMasterRows: contracts }), SETTLEMENT_CLASSES.NON_FINAL);
});

test('結算日契約語意未知時不得成為樣本', () => {
  assert.equal(classifySettlementSession({ tradeDate: '2026-08-19', contractCode: null, contractMasterRows: contracts }), SETTLEMENT_CLASSES.UNAVAILABLE);
  assert.equal(classifySettlementSession({ tradeDate: '2026-08-19', contractCode: 'UNKNOWN', contractMasterRows: contracts }), SETTLEMENT_CLASSES.UNAVAILABLE);
});

test('完整60根日盤5分K通過重播品質', () => {
  const start = Date.parse('2026-08-18T00:45:00.000Z');
  const bars = Array.from({ length: 60 }, (_, index) => ({ timestamp: new Date(start + index * 300_000).toISOString(), open: 100, high: 102, low: 99, close: 101, volume: 1, complete: true }));
  assert.equal(validateDayReplay({ product: 'TX', session: 'day', timeframe: '5m', tradeDate: '2026-08-18', contract: '202608', bars }).pass, true);
});

test('缺K或錯誤OHLC不得通過重播品質', () => {
  const start = Date.parse('2026-08-18T00:45:00.000Z');
  const bars = Array.from({ length: 59 }, (_, index) => ({ timestamp: new Date(start + index * 300_000).toISOString(), open: 100, high: 98, low: 99, close: 101, volume: 1, complete: true }));
  assert.equal(validateDayReplay({ product: 'TX', session: 'day', timeframe: '5m', tradeDate: '2026-08-18', contract: '202608', bars }).pass, false);
});

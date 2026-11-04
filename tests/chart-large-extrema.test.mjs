import test from 'node:test';
import assert from 'node:assert/strict';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { buildTxDecisionChart } from '../src/dashboard-tx-chart.mjs';
const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
function tick(timestamp,price) {
  return { kind:'futures_tick',product:'TXFH6',receivedAt:timestamp,exchangeTimestamp:timestamp,eventId:timestamp,
    duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,
    payload:{code:'TXFH6',datetime:timestamp,close:price,volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFH6'} };
}
test('daily and opening-range extrema accept 150k synthetic observations below the 200k source cap',()=>{
  // Repeated object references isolate the aggregation argument-count failure;
  // this is a capacity fixture, not evidence of a unique real-world feed.
  const night=tick('2026-08-11T15:00:01+08:00',100), day=tick('2026-08-12T08:46:01+08:00',102);
  const chart=buildTxDecisionChart([night,...Array(150000).fill(day)],{calendar,timeframe:'1D',mode:'REPLAY',tradeDate:'2026-08-12',asOf:'2026-08-12T13:45:00+08:00'});
  assert.equal(chart.bars.length,1); assert.equal(chart.bars[0].high,102); assert.equal(chart.bars[0].low,100);
  assert.equal(chart.bars[0].volume,150001); assert.equal(chart.openingRange.high,102); assert.equal(chart.openingRange.low,102);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {freezeOutcomeCandidate} from '../src/microstructure-outcome-research-v1.mjs';
import {observePostEventPricePath} from '../src/outcome-observed-path-research-v1.mjs';

const calendar=loadGovernedTradingCalendar(fileURLToPath(
  new URL('../config/taifex-official-calendar-2026.json',import.meta.url)));
const event=()=>freezeOutcomeCandidate({
 eventId:'EVENT:TXFK6:PATH1',observationKind:'FLOW_RESPONSE',
 actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
 eventExchangeTimestamp:'2026-10-22T02:00:00Z',
 asOfAvailableAt:'2026-10-22T02:00:01Z',
 lastSourceAvailableAt:'2026-10-22T02:00:00.200Z',
 referencePrice:100,frozenRuleHash:'a'.repeat(64),calendar,
});
const tick=(seconds,price)=>({
 kind:'futures_tick',actualContract:'TXFK6',
 exchangeTimestamp:new Date(Date.parse('2026-10-22T02:00:01Z')+seconds*1000).toISOString(),
 availableAt:new Date(Date.parse('2026-10-22T02:00:01Z')+seconds*1000+200).toISOString(),
 price,simtrade:false,duplicate:false,sequenceGap:0,
 executionAuthorized:false,orderRoutesEnabled:false,
});
test('observed future path computes only lower bounds and leaves EV/net/cause unknown',()=>{
 const e=event(),before=JSON.stringify(e);
 const x=observePostEventPricePath({event:e,calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,
  ticks:[tick(60,103),tick(120,98),tick(180,105)]});
 assert.equal(x.state,'OBSERVED_PATH_BOUNDS_ONLY');
 assert.equal(x.mfeLowerBoundPoints,5);assert.equal(x.maeLowerBoundPoints,2);
 assert.equal(x.timeToObservedMfeMs,180000);
 assert.equal(x.timeToObservedMaeMs,120000);
 assert.equal(x.observedTicks,3);assert.equal(x.sourceTimeEndLessThanHorizon,true);
 assert.equal(x.futureLabelCertified,false);assert.equal(x.pathCoverage,'UNVERIFIED');
 assert.equal(x.netPoints,null);assert.equal(x.netR,null);assert.equal(x.ev,null);
 assert.equal(x.tradeFailureCause,null);assert.equal(x.executionAuthorized,false);
 assert.equal(JSON.stringify(e),before);
});
test('selling hypothesis reverses signed excursion semantics without implying a fill',()=>{
 const x=observePostEventPricePath({event:event(),calendar,
  direction:'SELL_HYPOTHESIS',horizonMinutes:5,
  ticks:[tick(60,103),tick(120,98),tick(180,105)]});
 assert.equal(x.mfeLowerBoundPoints,2);assert.equal(x.maeLowerBoundPoints,5);
 assert.equal(x.timeToObservedMfeMs,120000);
 assert.equal(x.timeToObservedMaeMs,180000);
 assert.equal(x.netPoints,null);
});
test('future records cannot leak before as-of or cross contracts/calendar/session',()=>{
 const invalid=[
  [tick(-2,101)],[tick(60,101),tick(30,102)],
  [{...tick(60,101),actualContract:'TXFM6'}],
  [{...tick(60,101),availableAt:'2026-10-22T02:00:00Z'}],
  [{...tick(60,101),exchangeTimestamp:'2026-02-30T02:01:01Z'}],
  [{...tick(60,101),sequenceGap:3}],
  [{...tick(60,101),duplicate:true}],
  [{...tick(60,101),simtrade:true}],
  [{...tick(60,101),price:true}],
  [tick(360,101)],
 ];
 for(const ticks of invalid){
  const x=observePostEventPricePath({event:event(),calendar,
   direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks});
  assert.equal(x.state,'UNAVAILABLE',JSON.stringify(ticks));
  assert.equal(x.mfeLowerBoundPoints,null);
 }
});
test('no valid horizon, invalid event, unknown direction, empty or giant path does not claim EV',()=>{
 for(const props of [
  {direction:'BUY'}, {horizonMinutes:2}, {event:{}},{calendar:null},
  {ticks:[]},{ticks:Array(10001).fill(tick(60,101))},
 ]){
  const x=observePostEventPricePath({event:event(),calendar,
   direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[tick(60,101)],...props});
  assert.equal(x.state,'UNAVAILABLE');
  assert.equal(x.ev,null);assert.equal(x.tradeFailureCause,null);
 }
});

test('sub-millisecond distinct trades and same-millisecond unique ticks are retained',()=>{
 const a={...tick(1,101),exchangeTimestamp:'2026-10-22T02:00:02.000100Z',
  availableAt:'2026-10-22T02:00:02.200000Z',recordHash:'a'.repeat(64)};
 const b={...tick(1,102),exchangeTimestamp:'2026-10-22T02:00:02.000200Z',
  availableAt:'2026-10-22T02:00:02.200100Z',recordHash:'b'.repeat(64)};
 const c={...tick(1,103),exchangeTimestamp:'2026-10-22T02:00:02.000200Z',
  availableAt:'2026-10-22T02:00:02.200200Z',recordHash:'c'.repeat(64)};
 const result=observePostEventPricePath({event:event(),calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[a,b,c]});
 assert.equal(result.state,'OBSERVED_PATH_BOUNDS_ONLY');
 assert.equal(result.observedTicks,3);
 assert.equal(result.mfeLowerBoundPoints,3);
 assert.equal(result.futureLabelCertified,false);
 const duplicate={...c,recordHash:b.recordHash};
 assert.equal(observePostEventPricePath({event:event(),calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[a,b,duplicate]}).state,'UNAVAILABLE');
 const ambiguous={...c,recordHash:undefined,eventId:undefined};
 assert.equal(observePostEventPricePath({event:event(),calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[a,b,ambiguous]}).state,'UNAVAILABLE');
});
test('path timestamps from future exchange clock before receipt reject negative transport delay',()=>{
 const row={...tick(60,103),exchangeTimestamp:'2026-10-22T02:03:01Z'};
 assert.equal(observePostEventPricePath({event:event(),calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[row]}).state,'UNAVAILABLE');
});

test('sub-ms source cannot arrive before its precise receipt or as-of time',()=>{
 const earlierReceipt={...tick(1,101),
  exchangeTimestamp:'2026-10-22T02:00:02.000900Z',
  availableAt:'2026-10-22T02:00:02.000100Z',
  recordHash:'d'.repeat(64)};
 const bad=observePostEventPricePath({event:event(),calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[earlierReceipt]});
 assert.equal(bad.state,'UNAVAILABLE');
 const lawful={...earlierReceipt,
  exchangeTimestamp:'2026-10-22T02:00:02.000100Z',
  availableAt:'2026-10-22T02:00:02.000900Z'};
 const good=observePostEventPricePath({event:event(),calendar,
  direction:'BUY_HYPOTHESIS',horizonMinutes:5,ticks:[lawful]});
 assert.equal(good.state,'OBSERVED_PATH_BOUNDS_ONLY');
 assert.equal(good.observedThroughExchangeTime,lawful.exchangeTimestamp);
 assert.ok(Math.abs(good.timeToObservedMfeMs-1000.1)<1e-7);
 assert.equal(good.netPoints,null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {projectGovernedL5,freezeOutcomeCandidate} from '../src/microstructure-outcome-research-v1.mjs';
const base=()=>({
 kind:'futures_bidask',executionAuthorized:false,orderRoutesEnabled:false,
 exchangeTimestamp:'2026-10-22T02:00:00.000Z',
 receivedAt:'2026-10-22T02:00:00.200Z',
 clockSkewMs:200,duplicate:false,sequenceGap:false,sequence:13,eventId:'E-13',recordHash:'a'.repeat(64),
 payload:{productFamily:'TX',actualContract:'TXFK6',simtrade:false,
 bid_price:[100,99,98,97,96],ask_price:[101,102,103,104,105],
 bid_volume:[50,40,30,20,10],ask_volume:[20,20,20,20,20]},
});
const args=()=>({asOfAvailableAt:'2026-10-22T02:00:01.000Z',
 actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',tickSize:1});
test('L5 projection is a purely observational liquidity feature with exact four-sided level checks',()=>{
 const raw=base(),before=JSON.stringify(raw),v=projectGovernedL5(raw,args());
 assert.equal(v.state,'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED');
 assert.equal(v.spreadTicks,1);assert.equal(v.bidDepth1,50);assert.equal(v.askDepth1,20);
 assert.equal(v.bidDepth5,150);assert.equal(v.askDepth5,100);
 assert.equal(v.imbalance5,0.2);assert.equal(v.sourceTime,raw.exchangeTimestamp);
 assert.equal(v.availableAt,raw.receivedAt);assert.equal(v.executionAuthorized,false);
 assert.equal(v.orderRoutesEnabled,false);assert.equal(v.recommendation,false);
 assert.equal('direction' in v,false);assert.equal(JSON.stringify(raw),before);
});
test('L5 cannot borrow missing levels or fill unknowns with zero',()=>{
 for(const field of ['bid_price','ask_price','bid_volume','ask_volume']){
  const raw=base();raw.payload[field]=raw.payload[field].slice(0,4);
  const v=projectGovernedL5(raw,args());
  assert.equal(v.state,'UNAVAILABLE');assert.equal(v.imbalance5,null);
 }
});
test('L5 rejects crossed, repeated, unsorted and off-tick books',()=>{
 for(const fn of [
  v=>v.payload.ask_price[0]=99,
  v=>v.payload.bid_price[1]=100,
  v=>v.payload.ask_price[1]=100,
  v=>v.payload.ask_price[0]=100.4,
 ]){
  const x=base();fn(x);assert.equal(projectGovernedL5(x,args()).state,'UNAVAILABLE');
 }
});
test('L5 rejects out-of-contract, clock drift, replay, duplicate, sequence gap and future as-of',()=>{
 const mutants=[
  [x=>x.payload.actualContract='OTHER',args()],
  [x=>x.clockSkewMs=10000,args()],
  [x=>x.clockSkewMs=null,args()],
  [x=>x.payload.simtrade=true,args()],
  [x=>x.duplicate=true,args()],
  [x=>x.sequenceGap=true,args()],
  [x=>x.receivedAt='2026-10-22T02:00:05.000Z',args()],
  [x=>x.exchangeTimestamp='2026-10-22T02:00:05.000Z',args()],
  [x=>{}, {...args(),tradeDate:''}],
  [x=>{}, {...args(),session:'UNKNOWN'}],
 ];
 for(const [modify,a] of mutants){const raw=base();modify(raw);assert.equal(projectGovernedL5(raw,a).state,'UNAVAILABLE');}
});
test('L5 zero denominator remains unknown, never 0 imbalance',()=>{
 const x=base();x.payload.bid_volume=[0,0,0,0,0];x.payload.ask_volume=[0,0,0,0,0];
 const v=projectGovernedL5(x,args());assert.equal(v.state,'UNAVAILABLE');assert.equal(v.imbalance5,null);
});
const event=()=>({eventId:'EVENT:TXFK6:001',observationKind:'FLOW_RESPONSE',
 actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',
 asOfAvailableAt:'2026-10-22T02:00:01.000Z',
 lastSourceAvailableAt:'2026-10-22T02:00:00.200Z',referencePrice:46767,frozenRuleHash:'a'.repeat(64)});
test('frozen outcome event contains as-of features only; future labels cannot leak',()=>{
 const e=freezeOutcomeCandidate(event());assert.equal(e.outcomeStatus,'PENDING');
 assert.equal(e.referencePrice,46767);assert.equal(e.mfe,null);assert.equal(e.mae,null);
 assert.equal(e.timeToMfe,null);assert.equal(e.timeToMae,null);
 assert.equal(e.netPoints,null);assert.equal(e.ev,null);
 assert.equal(e.executionAuthorized,false);assert.equal(Object.isFrozen(e),true);
});
test('outcome candidate rejects sources from after decision as-of',()=>{
 for(const diff of [
  {lastSourceAvailableAt:'2026-10-22T02:00:01.200Z'},
  {frozenRuleHash:null},{referencePrice:null},{session:'LATE'},
  {tradeDate:'2026-02-30'},{eventId:'x'},
 ]){
  const e=freezeOutcomeCandidate({...event(),...diff});
  assert.equal(e.state,'UNAVAILABLE',JSON.stringify(diff));
 }
});

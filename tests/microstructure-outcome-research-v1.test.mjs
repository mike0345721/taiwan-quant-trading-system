import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {numericScalar,evidenceTimestampMs} from '../src/research-evidence-contract-v1.mjs';
import {projectGovernedL5,freezeOutcomeCandidate} from '../src/microstructure-outcome-research-v1.mjs';

const calendar=loadGovernedTradingCalendar(fileURLToPath(
  new URL('../config/taifex-official-calendar-2026.json',import.meta.url)));
const raw=()=>({
 kind:'futures_bidask',executionAuthorized:false,orderRoutesEnabled:false,
 exchangeTimestamp:'2026-10-22T02:00:00.000Z',
 receivedAt:'2026-10-22T02:00:00.200Z',
 clockSkewMs:200,duplicate:false,sequenceGap:0,sequence:null,
 eventId:'E-13',recordHash:'a'.repeat(64),
 payload:{productFamily:'TX',actualContract:'TXFK6',simtrade:false,
  bid_price:[100,99,98,97,96],ask_price:[101,102,103,104,105],
  bid_volume:[50,40,30,20,10],ask_volume:[20,20,20,20,20]},
});
const ctx=()=>({calendar,asOfAvailableAt:'2026-10-22T02:00:01.000Z',
 actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',tickSize:1});
const status=(x,c=ctx())=>projectGovernedL5(x,c).state;
const pending=()=>({eventId:'EVENT:TXFK6:001',observationKind:'FLOW_RESPONSE',
 actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',calendar,
 eventExchangeTimestamp:'2026-10-22T02:00:00.000Z',
 asOfAvailableAt:'2026-10-22T02:00:01.000Z',
 lastSourceAvailableAt:'2026-10-22T02:00:00.200Z',
 referencePrice:46767,frozenRuleHash:'a'.repeat(64)});
test('real governed L5 projection is observational and retains unchanged record',()=>{
 const r=raw(),before=JSON.stringify(r),v=projectGovernedL5(r,ctx());
 assert.equal(v.state,'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED');
 assert.equal(v.spreadTicks,1);assert.equal(v.bidDepth1,50);assert.equal(v.askDepth1,20);
 assert.equal(v.bidDepth5,150);assert.equal(v.askDepth5,100);assert.equal(v.imbalance5,.2);
 assert.equal(v.sessionId,'2026-10-22-DAY');
 assert.equal(v.governedCalendarHash,calendar.fileHash);
 assert.equal(v.executionAuthorized,false);assert.equal(v.orderRoutesEnabled,false);
 assert.equal(v.recommendation,false);assert.equal('direction' in v,false);
 assert.equal(JSON.stringify(r),before);
});
test('both visible sides require exactly 5 lawful price and volume levels',()=>{
 for(const field of ['bid_price','ask_price','bid_volume','ask_volume']){
  const x=raw();x.payload[field].pop();
  const v=projectGovernedL5(x,ctx());
  assert.equal(v.state,'UNAVAILABLE');assert.equal(v.imbalance5,null);
 }
});
test('crossed, nonmonotonic, off-grid, missing prices and all-zero depth fail closed',()=>{
 for(const modify of [
  x=>{x.payload.ask_price[0]=99},x=>{x.payload.bid_price[1]=100},
  x=>{x.payload.ask_price[1]=100},x=>{x.payload.ask_price[0]=100.4},
  x=>{x.payload.bid_price[0]=100.4},x=>{x.payload.ask_price[3]=null},
  x=>{x.payload.bid_volume=[0,0,0,0,0];x.payload.ask_volume=[0,0,0,0,0]},
 ]){
  const x=raw();modify(x);assert.equal(status(x),'UNAVAILABLE');
 }
});
test('numeric scalar contract rejects boolean/blank/array/coerced/fractional depths',()=>{
 for(const bad of [true,false,' ',[],[3],{},'Infinity','1e10',-1,.5,NaN]){
  const x=raw();x.payload.bid_volume[0]=bad;
  assert.equal(status(x),'UNAVAILABLE',String(bad));
 }
 assert.equal(numericScalar(true),null);
 assert.equal(numericScalar(' '),null);
 assert.equal(numericScalar([]),null);
 assert.equal(numericScalar('12.5',{integer:true}),null);
 assert.equal(numericScalar('12',{integer:true}),12);
});
test('real count-shaped sequenceGap positive rejects; 0 is the only eligible value',()=>{
 for(const bad of [1,3,false,true,null,'0',-1,.5]){
  const x=raw();x.sequenceGap=bad;assert.equal(status(x),'UNAVAILABLE',String(bad));
 }
 assert.equal(status(raw()),'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED');
});
test('Taipei timezone-less exchange timestamp parses independently of process timezone',()=>{
 const x=raw();x.exchangeTimestamp='2026-10-22T10:00:00';
 assert.equal(status(x),'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED');
 assert.equal(evidenceTimestampMs(x.exchangeTimestamp,{taipeiNaive:true}),
   Date.parse('2026-10-22T02:00:00.000Z'));
 assert.equal(evidenceTimestampMs(x.exchangeTimestamp),null);
});
test('invalid timestamp calendars, clocks, offset and future-as-of refuse',()=>{
 for(const t of ['2026-02-30T02:00:00Z','2026-13-10T02:00:00Z',
  '2026-10-22T25:00:00Z','2026-10-22T02:62:00Z',
  '2026-10-22T02:00:00+15:00','2026-10-22T02:00:00+14:30']){
  assert.equal(evidenceTimestampMs(t),null,t);
 }
 const bad=[x=>{x.exchangeTimestamp='2026-02-30T02:00:00Z'},
   x=>{x.receivedAt='2026-02-30T02:00:00Z'},
   x=>{x.receivedAt='2026-10-22T02:00:09Z'},
   x=>{x.clockSkewMs=10000},x=>{x.clockSkewMs=null},
   x=>{x.payload.simtrade=true},x=>{x.duplicate=true},
   x=>{x.sequenceGap=3},x=>{x.executionAuthorized=true}];
 for(const modify of bad){const x=raw();modify(x);assert.equal(status(x),'UNAVAILABLE');}
});
test('official calendar, session and trading date must agree with source event',()=>{
 for(const props of [
   {tradeDate:'2030-01-01'},{session:'NIGHT'},{calendar:null},
   {tradeDate:'2026-02-30'},{calendar:{}},
 ]){
   assert.equal(status(raw(),{...ctx(),...props}),'UNAVAILABLE',JSON.stringify(Object.keys(props)));
 }
 const night=raw();night.exchangeTimestamp='2026-10-21T15:30:00+08:00';
 night.receivedAt='2026-10-21T07:30:00.200Z';
 const nightContext={...ctx(),session:'NIGHT',asOfAvailableAt:'2026-10-21T07:30:01.000Z'};
 const v=projectGovernedL5(night,nightContext);
 assert.equal(v.state,'FIELD_SAMPLE_VALID_NOT_CORPUS_CERTIFIED');
 assert.equal(v.sessionId,'2026-10-21-NIGHT');
});
test('L5 rejects wrong contract, reference drift, missing clock, duplicate, replay',()=>{
 const c=ctx();
 const variants=[
  [x=>{x.payload.actualContract='TXFM6'},c],
  [x=>{x.payload.simtrade=true},c],
  [x=>{x.duplicate=true},c],
  [x=>{x.clockSkewMs=null},c],
  [x=>{}, {...c,actualContract:{code:'TXFK6'}}],
 ];
 for(const [modify,args] of variants){const x=raw();modify(x);
  assert.equal(status(x,args),'UNAVAILABLE');}
});
test('immutable outcome only freezes scalar as-of event; all future fields remain null',()=>{
 const v=freezeOutcomeCandidate(pending());
 assert.equal(v.outcomeStatus,'PENDING');
 assert.equal(v.referencePrice,46767);assert.equal(v.sessionId,'2026-10-22-DAY');
 assert.equal(v.mfe,null);assert.equal(v.mae,null);assert.equal(v.timeToMfe,null);
 assert.equal(v.timeToMae,null);assert.equal(v.netPoints,null);assert.equal(v.ev,null);
 assert.equal(v.executionAuthorized,false);assert.equal(Object.isFrozen(v),true);
});
test('outcome events reject future knowledge, wrong calendar labels, illegal identities',()=>{
 for(const x of [
  {lastSourceAvailableAt:'2026-10-22T02:00:01.200Z'},
  {eventExchangeTimestamp:'2026-02-30T02:00:00Z'},
  {lastSourceAvailableAt:'2026-02-30T02:00:00Z'},
  {asOfAvailableAt:'2026-02-30T02:00:00Z'},
  {tradeDate:'2030-01-01'},{session:'NIGHT'}, {calendar:null},
  {frozenRuleHash:null},{referencePrice:true},{referencePrice:[]},
  {eventId:{toString:()=>('EVENT:TXFK6:001')}},
  {frozenRuleHash:{toString:()=>('a'.repeat(64))}},
  {eventId:'x'},
 ]){
   assert.equal(freezeOutcomeCandidate({...pending(),...x}).state,
     'UNAVAILABLE',Object.keys(x).join(','));
 }
 const identity={code:'TXFK6'};
 const rejected=freezeOutcomeCandidate({...pending(),actualContract:identity});
 assert.equal(rejected.state,'UNAVAILABLE');identity.code='CHANGED';
 assert.equal(rejected.actualContract,undefined);
});

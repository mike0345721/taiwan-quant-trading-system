import test from 'node:test';
import assert from 'node:assert/strict';
import {createBestQuoteLookup,evaluateBestQuoteEligibility} from '../src/tx-intraday-pressure-path-efficiency.mjs';
const base={actualContract:'TXFK6',tradeDate:'2026-10-27',session:'DAY',continuityEpoch:'TX:1',sourceLedgerIdentity:'source-A',identityStatus:'USABLE',availabilityLineageStatus:'USABLE',joinedContinuityStatus:'USABLE',recordHash:'hash'};
const q=(ordinal,time,extra={})=>({...base,kind:'futures_bidask',ledgerOrdinal:ordinal,eventMs:time,availableMs:time,payload:{bid_price:[99],ask_price:[100]},...extra});
const t=(ordinal,time,extra={})=>({...base,kind:'futures_tick',ledgerOrdinal:ordinal,eventMs:time,availableMs:time,payload:{price:100,volume:1,tick_type:1},...extra});
function legacy(events,tick,maxQuoteAgeMs=2000,beforeIndex=events.length){
 for(let i=beforeIndex-1;i>=0;i--){const quote=events[i];if(quote.kind!=='futures_bidask'||quote.ledgerOrdinal>=tick.ledgerOrdinal)continue;const eligibility=evaluateBestQuoteEligibility(quote,tick,{maxQuoteAgeMs});if(eligibility.eligible)return {quote,eligibility};}
 return {quote:null,eligibility:null};
}
for(const [name,alter] of [
 ['future event',x=>({...x,eventMs:5000})],['future receipt',x=>({...x,availableMs:5000})],
 ['wrong contract',x=>({...x,actualContract:'OTHER'})],['wrong day',x=>({...x,tradeDate:'2026-10-26'})],
 ['wrong session',x=>({...x,session:'NIGHT'})],['wrong epoch',x=>({...x,continuityEpoch:'TX:2'})],
 ['wrong source',x=>({...x,sourceLedgerIdentity:'source-B'})],['invalid lineage',x=>({...x,availabilityLineageStatus:'INVALID'})],
 ['missing hash',x=>({...x,recordHash:null})],['not physically prior',x=>({...x,ledgerOrdinal:20})],
 ['stale quote',x=>({...x,eventMs:-10000})],
])test('indexed quote lookup preserves '+name+' rejection',()=>{
 const a=q(1,1000),b=alter(q(3,1900)),tick=t(5,2000),events=[a,b,tick];
 assert.deepEqual(createBestQuoteLookup(events)(tick),legacy(events,tick));
 assert.equal(createBestQuoteLookup(events)(tick).quote,a);
});
test('latest means last eligible array entry, not greatest timestamp or reordered ordinal',()=>{
 const a=q(8,2000),b=q(2,1000),tick=t(10,2200);const events=[a,b,tick];
 assert.equal(createBestQuoteLookup(events)(tick).quote,b);
 assert.equal(createBestQuoteLookup(events)(tick,1).quote,a);
});
test('equal quote/tick times are retained; equal ordinal is rejected',()=>{
 const a=q(1,1000),b=q(3,1000),tick=t(3,1000),events=[a,b,tick];
 assert.equal(createBestQuoteLookup(events)(tick).quote,a);
});
test('atypical numeric representation retains reference predicate behavior',()=>{
 for(const eventTime of [null,NaN,'1000']){const events=[q(1,eventTime),t(3,1500)];
 assert.deepEqual(createBestQuoteLookup(events)(events[1]),legacy(events,events[1]));}
});
test('seeded mixed-order corpus matches exhaustive reference for every tick and prefix',()=>{
 let seed=179;const rand=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
 for(let round=0;round<12;round++){
  const events=Array.from({length:350},(_,i)=>{
   const tm=Math.floor(rand()*12000),extra={availableMs:Math.floor(rand()*14000),continuityEpoch:rand()<.2?'TX:2':'TX:1',actualContract:rand()<.1?'OTHER':'TXFK6',sourceLedgerIdentity:rand()<.08?'source-B':'source-A',identityStatus:rand()<.04?'INCOMPLETE':'USABLE',availabilityLineageStatus:rand()<.04?'INVALID':'USABLE'};
   return rand()<.65?q(i+1,tm,extra):t(i+1,tm,extra);
  });
  const find=createBestQuoteLookup(events);
  events.forEach((event,i)=>{if(event.kind==='futures_tick'){
   assert.deepEqual(find(event),legacy(events,event),'full '+round+':'+i);
   assert.deepEqual(find(event,i),legacy(events,event,2000,i),'prefix '+round+':'+i);
  }});
 }
});
test('large stale quote suffix stays unavailable; index cannot renew old timestamps',()=>{
 const events=Array.from({length:20000},(_,i)=>q(i+1,i));const find=createBestQuoteLookup(events);
 for(let i=0;i<500;i++)assert.equal(find(t(30000+i,1000000+i)).quote,null);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { createBestQuoteLookup, evaluateBestQuoteEligibility } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { cru34LiveHash } from '../src/cru34-live-checkpoint.mjs';

// Execute the actual private pure helper without invoking file projection,
// checkpoint publication or the Producer runner.
const source=fs.readFileSync(new URL('../src/cru34-live-projection-worker.mjs',import.meta.url),'utf8');
const begin=source.indexOf('function retainPressureRelevantEvents('),end=source.indexOf('\nexport function pruneRolling(',begin);
assert.ok(begin>=0&&end>begin,'retention helper source boundary must exist');
const context={createBestQuoteLookup,evaluateBestQuoteEligibility};
vm.runInNewContext(source.slice(begin,end)+';globalThis.retain=retainPressureRelevantEvents;',context);
const retain=context.retain;
const base={actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',continuityEpoch:'TX:3',sourceLedgerIdentity:'synthetic-source',
  identityStatus:'USABLE',availabilityLineageStatus:'USABLE',joinedContinuityStatus:'USABLE',recordHash:'synthetic-hash',
  formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false};
const quote=(ordinal,time,extra={})=>({...base,kind:'futures_bidask',ledgerOrdinal:ordinal,eventMs:time,availableMs:time,payload:{bid_price:[99],ask_price:[100]},...extra});
const tick=(ordinal,time,extra={})=>({...base,kind:'futures_tick',ledgerOrdinal:ordinal,eventMs:time,availableMs:time,payload:{price:100,volume:1,tick_type:1},...extra});

// Exhaustive frozen reference: only a physical prefix may supply a quote;
// qualifying ordinals and the original recent-quote retention rule are exact.
function reference(events,cutoff) {
  const ordinals=new Set();
  for(let index=0;index<events.length;index++) {
    const event=events[index];if(event.kind!=='futures_tick')continue;
    for(let prior=index-1;prior>=0;prior--) {
      const candidate=events[prior];
      if(candidate.kind==='futures_bidask'&&candidate.ledgerOrdinal<event.ledgerOrdinal
          &&evaluateBestQuoteEligibility(candidate,event,{maxQuoteAgeMs:2000}).eligible) {
        ordinals.add(candidate.ledgerOrdinal);break;
      }
    }
  }
  return events.filter(event=>event.kind==='futures_tick'||(event.kind==='futures_bidask'
    &&(ordinals.has(event.ledgerOrdinal)||(Number.isFinite(event.eventMs)&&event.eventMs>=cutoff.eventMs-2000))));
}
function equivalent(events,cutoff) {
  const expected=reference(events,cutoff),actual=retain(events,cutoff);
  assert.equal(actual.length,expected.length);
  for(let index=0;index<expected.length;index++)assert.equal(actual[index],expected[index],'same original object and physical order');
  assert.equal(JSON.stringify(actual),JSON.stringify(expected),'serialized retained events unchanged');
  assert.equal(cru34LiveHash(actual),cru34LiveHash(expected),'checkpoint canonical hash unchanged');
  return actual;
}

test('retention preserves mixed eligibility, identity, lineage and numeric-edge decisions',()=>{
  const variants=[{}, {availabilityLineageStatus:'INVALID'}, {identityStatus:'INCOMPLETE'}, {sourceLedgerIdentity:'other'},
    {actualContract:'TXFJ6'}, {tradeDate:'2026-11-03'}, {session:'NIGHT'}, {continuityEpoch:'TX:2'}, {recordHash:null},
    {eventMs:5000}, {availableMs:5000}, {eventMs:-10000}, {eventMs:null}, {eventMs:NaN}, {eventMs:'1000'},
    {ledgerOrdinal:90}, {payload:{bid_price:[101],ask_price:[100]}}];
  for(const variant of variants) {
    const events=[quote(1,1000),quote(3,1900,variant),tick(5,2000),tick(7,7000)];
    equivalent(events,events.at(-1));
  }
});
test('physical prefix excludes a later quote even when its timestamp and ordinal look earlier',()=>{
  const laterQuote=quote(1,1000),events=[tick(10,1000),laterQuote,tick(20,10000)];
  const actual=equivalent(events,events.at(-1));assert.equal(actual.includes(laterQuote),false);
});
test('unusable recent quotes keep the original future-lookup retention rule without gaining eligibility',()=>{
  const recent=quote(2,9500,{availabilityLineageStatus:'INVALID'}),events=[tick(1,9000),recent,tick(3,10000)];
  assert.equal(equivalent(events,events.at(-1)).includes(recent),true);
  assert.equal(evaluateBestQuoteEligibility(recent,events.at(-1)).eligible,false);
});
test('seeded mixed-order and epoch corpus preserves each retained object, order and canonical hash',()=>{
  let seed=351;const random=()=>((seed=Math.imul(seed,1664525)+1013904223>>>0)/2**32);
  for(let round=0;round<12;round++) {
    const events=Array.from({length:350},(_,index)=>{
      const time=Math.floor(random()*12000),extra={availableMs:Math.floor(random()*14000),
        actualContract:random()<.1?'OTHER':'TXFK6',sourceLedgerIdentity:random()<.1?'other':'synthetic-source',
        continuityEpoch:random()<.2?'TX:2':'TX:3',availabilityLineageStatus:random()<.2?'INVALID':'USABLE',
        joinedContinuityStatus:random()<.1?'INVALID':'USABLE'};
      return random()<.65?quote(index+1,time,extra):tick(index+1,time,extra);
    });
    const cutoff=events.findLast(event=>event.kind==='futures_tick');equivalent(events,cutoff);
  }
});
test('6000 synthetic events with no eligible quote preserve exact retained checkpoint content',()=>{
  const events=Array.from({length:6000},(_,index)=>index%2?tick(index+1,index*100):quote(index+1,index*100,{availabilityLineageStatus:'INVALID'}));
  const result=equivalent(events,events.at(-1));assert.equal(result.length,3010);
});
test('no-eligible-quote physical array visits scale linearly rather than scanning every tick prefix',()=>{
  const counts=[];
  for(const count of [200,400]) {
    const events=Array.from({length:count},(_,index)=>index%2?tick(index+1,index*100):quote(index+1,index*100,{availabilityLineageStatus:'INVALID'}));
    let visits=0;const proxy=new Proxy(events,{get(array,key,receiver){if(typeof key==='string'&&/^\d+$/.test(key))visits++;return Reflect.get(array,key,receiver);}});
    retain(proxy,events.at(-1));counts.push(visits);
    assert.ok(visits<=count*4,`${count} events visited ${visits} array entries; repeated prefix scans remain`);
  }
  assert.ok(counts[1]<=counts[0]*2.2);
});

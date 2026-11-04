import test from 'node:test';
import assert from 'node:assert/strict';
import {createVolumeProfileState,appendVolumeProfileTrades,volumeProfileSnapshot,selectPreviousCompleteProfile} from '../src/volume-profile-core.mjs';

const identity={actualContract:'TXFK6',tradeDate:'2026-11-04',session:'NIGHT',continuityEpoch:0,sourceLedgerIdentity:'sha256:'+'a'.repeat(64)};
const start=Date.parse('2026-11-03T15:59:00Z'), iso=n=>new Date(start+n*1000).toISOString();
const tick=(n,price=100,volume=1,extra={})=>({...identity,kind:'futures_tick',identityStatus:'USABLE',availabilityLineageStatus:'USABLE',
  eventTime:iso(n),availableAt:iso(n+0.001),ledgerOrdinal:n,recordHash:n.toString(16).padStart(64,'0'),payload:{close:price,volume,tick_type:0},...extra});
const state=(ticks,options={})=>appendVolumeProfileTrades(createVolumeProfileState({identity,...options}),ticks);

test('volume conserves UNKNOWN executions; POC ties lower; adjacent value area uses deterministic lower tie',()=>{
  const result=volumeProfileSnapshot(state([tick(1,100,2),tick(2,101,5),tick(3,102,5),tick(4,103,2)]));
  assert.equal(result.totalVolume,14); assert.equal(result.bins.reduce((n,b)=>n+b.volume,0),14);
  assert.equal(result.poc,101); assert.equal(result.val,101); assert.equal(result.vah,103);
  assert.equal(result.valueAreaVolume,10); assert.deepEqual(result.hvn,[101,102]);
  assert.equal(result.partial,true);assert.equal(result.scope,'OBSERVED_FRAGMENT');
  const tied=volumeProfileSnapshot(state([tick(1,100,2),tick(2,101,5),tick(3,102,2)],{valueAreaFraction:.7}));
  assert.equal(tied.val,100);assert.equal(tied.vah,102);
});

test('empty profile numbers are unknown; observed empty bins are legal zero',()=>{
  const empty=volumeProfileSnapshot(createVolumeProfileState({identity}));
  assert.equal(empty.totalVolume,null);assert.equal(empty.poc,null);assert.equal(empty.state,'UNAVAILABLE');
  const result=volumeProfileSnapshot(state([tick(1,100,2),tick(2,102,2)]));
  assert.equal(result.bins[1].volume,0);assert.deepEqual(result.lvn,[101]);
});

test('decimal bins use exact decimal quotient and source event regression does not reorder observations',()=>{
  const result=volumeProfileSnapshot(state([tick(1,100.3,2),tick(2,100.4,3),tick(3,100.2,4,{eventTime:iso(.5)})],{binSize:.1}));
  assert.deepEqual(result.bins.map(b=>b.index),[1002,1003,1004]);
  assert.deepEqual(result.bins.map(b=>b.price),[100.2,100.3,100.4]);
  assert.equal(result.observedStart,iso(.5));assert.equal(result.observedEnd,iso(2));
  assert.equal(result.cutoffLedgerOrdinal,3);assert.equal(result.totalVolume,9);
});

test('all-at-once, incremental, JSON restart and cross-midnight do not reset or recount',()=>{
  const ticks=Array.from({length:100},(_,i)=>tick(i+1,100+i%4,i%3+1));
  const full=state(ticks);let resumed=createVolumeProfileState({identity});
  for(let i=0;i<ticks.length;i+=17)resumed=appendVolumeProfileTrades(JSON.parse(JSON.stringify(resumed)),ticks.slice(i,i+17));
  assert.deepEqual(resumed,full);assert.equal(volumeProfileSnapshot(full).tradeCount,100);
  assert.equal(resumed.identity.tradeDate,'2026-11-04');
});

test('future values do not revise earlier profile; independently recorded prefix remains identical',()=>{
  const ticks=Array.from({length:30},(_,i)=>tick(i+1,i<12?100+i%3:200+i,1+i));
  const full=state(ticks);
  for(let n=1;n<=ticks.length;n++)assert.deepEqual(volumeProfileSnapshot(full,{cutoff:ticks[n-1].availableAt}),
    volumeProfileSnapshot(state(ticks.slice(0,n)),{cutoff:ticks[n-1].availableAt}));
});

test('duplicate suffix, mismatched session/contract/epoch/source, future and malformed inputs fail transactionally',()=>{
  const original=state([tick(1)]), bytes=JSON.stringify(original);
  assert.throws(()=>appendVolumeProfileTrades(original,[tick(1)]),/ORDINAL/);
  for(const patch of [{actualContract:'TXFL6'},{tradeDate:'2026-11-05'},{session:'DAY'},{continuityEpoch:1},{sourceLedgerIdentity:'sha256:'+'b'.repeat(64)}])
    assert.throws(()=>appendVolumeProfileTrades(original,[tick(2,100,1,patch)]),/IDENTITY/);
  for(const patch of [{identityStatus:'UNKNOWN'},{availabilityLineageStatus:'INVALID_RECEIVED_AT'},{recordHash:null},{eventTime:null},
    {payload:{close:null,volume:2}},{payload:{close:100,volume:null}},{payload:{close:100,volume:0}},{payload:{close:100,volume:2,simtrade:true}}])
    assert.throws(()=>appendVolumeProfileTrades(original,[tick(2,100,1,patch)]),/INELIGIBLE/);
  assert.throws(()=>appendVolumeProfileTrades(original,[tick(2)],{cutoff:iso(1.5)}),/INELIGIBLE/);
  assert.throws(()=>appendVolumeProfileTrades(original,[tick(2,100,1,{availableAt:iso(.5),eventTime:iso(.4)})]),/REGRESSION/);
  assert.equal(JSON.stringify(original),bytes);
});

test('resource limits reject before exposing partial accumulation',()=>{
  const original=createVolumeProfileState({identity,maxTrades:2,maxBins:2});
  assert.throws(()=>appendVolumeProfileTrades(original,[tick(1),tick(2),tick(3)]),/BUDGET/);
  assert.throws(()=>appendVolumeProfileTrades(original,[tick(1,100),tick(2,103)]),/SPAN_BUDGET/);
  assert.equal(original.totalVolume,0);assert.equal(original.trades.length,0);
});

test('a previous complete session needs matching coverage evidence known at cutoff',()=>{
  const current=state([tick(1,100,2),tick(2,101,4)]);
  const evidence={state:'COMPLETE',sessionStartProven:true,captureCompleteness:'PROVEN',identity,artifactHash:'c'.repeat(64),
    availableAt:iso(10),sessionEnd:iso(9),firstOrdinal:1,lastOrdinal:2,totalVolume:6};
  const earlier=volumeProfileSnapshot(current,{cutoff:iso(3),completeSessionEvidence:evidence});assert.equal(earlier.partial,true);
  const complete=volumeProfileSnapshot(current,{cutoff:iso(11),completeSessionEvidence:evidence});assert.equal(complete.partial,false);
  for(const patch of [{totalVolume:7},{firstOrdinal:0},{lastOrdinal:3},{captureCompleteness:'UNPROVEN'},{artifactHash:null}])
    assert.equal(volumeProfileSnapshot(current,{cutoff:iso(11),completeSessionEvidence:{...evidence,...patch}}).partial,true);
  assert.equal(selectPreviousCompleteProfile([earlier,complete],{...identity,session:'DAY'},iso(12)),complete);
  assert.equal(selectPreviousCompleteProfile([complete],{...identity,actualContract:'TXFL6'},iso(12)),null);
  assert.equal(selectPreviousCompleteProfile([complete],{...identity,session:'DAY'},iso(4)),null);
});

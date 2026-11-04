import test from 'node:test';
import assert from 'node:assert/strict';
import {createMarketStructureState,appendMarketStructureBars,marketStructureSnapshot} from '../src/market-structure-core.mjs';
const identity={actualContract:'TXFK6',tradeDate:'2026-11-04',session:'NIGHT',continuityEpoch:0,sourceLedgerIdentity:'sha256:'+'a'.repeat(64)};
const start=Date.parse('2026-11-03T15:55:00Z'),iso=n=>new Date(start+n*60000).toISOString();
const bar=(n,open,high,low,close,extra={})=>({identity,time:iso(n),endTime:iso(n+1),availableAt:iso(n+1),open,high,low,close,closed:true,...extra});
const bars=[bar(0,100,102,99,101),bar(1,101,104,100,103),bar(2,103,110,102,108),bar(3,108,109,101,102),
  bar(4,102,106,98,100),bar(5,100,111,99,109),bar(6,109,113,105,112),bar(7,112,114,108,109),
  bar(8,109,110,100,101),bar(9,101,105,96,97),bar(10,97,100,95,96),bar(11,96,101,96,100)];
const state=(list=bars,options={})=>appendMarketStructureBars(createMarketStructureState({identity,...options}),list);

test('pivot anchor remains historical but event only exists after two right closed bars',()=>{
  assert.equal(marketStructureSnapshot(state(bars.slice(0,4))).events.filter(e=>e.type==='SWING_HIGH').length,0);
  const pivot=marketStructureSnapshot(state(bars.slice(0,5))).events.find(e=>e.type==='SWING_HIGH');
  assert.equal(pivot.anchorTime,iso(2));assert.equal(pivot.confirmedTime,iso(5));assert.equal(pivot.availableAt,iso(5));
  assert.equal(pivot.level,110);assert.equal(pivot.confirmationBars,2);
});

test('sweep reclaims with close; first strict close break is BOS and opposite break CHOCH',()=>{
  const result=marketStructureSnapshot(state());
  const sweep=result.events.find(e=>e.type==='SWEEP_HIGH');assert.equal(sweep.confirmedTime,iso(6));assert.equal(sweep.level,110);
  const bos=result.events.find(e=>e.type==='BOS');assert.equal(bos.direction,'UP');assert.equal(bos.confirmedTime,iso(7));
  const change=result.events.find(e=>e.type==='CHOCH');assert.equal(change.direction,'DOWN');assert.equal(change.confirmedTime,iso(10));
  assert.equal(result.structure,'DOWN');
  const failure=result.events.find(e=>e.type==='BREAK_FAILED'&&e.breakId===bos.id);assert.ok(failure);
  assert.equal(failure.availableAt,iso(8));
});

test('Order Block is last opposing candle within lookback; close invalidation has its own availability',()=>{
  const result=marketStructureSnapshot(state());
  const zone=result.zones.find(z=>z.type==='ORDER_BLOCK'&&z.direction==='UP');
  assert.equal(zone.anchorTime,iso(4));assert.equal(zone.lower,98);assert.equal(zone.upper,106);
  assert.equal(zone.availableAt,iso(7));assert.equal(zone.status,'INVALIDATED');assert.equal(zone.invalidatedAt,iso(10));
  const earlier=marketStructureSnapshot(state(),{cutoff:iso(7)}).zones.find(z=>z.id===zone.id);
  assert.equal(earlier.status,'ACTIVE');assert.equal(earlier.invalidatedAt,null);
});

test('FVG uses three closed bars and distinguishes wick fill from close invalidation',()=>{
  const list=[bar(0,100,102,99,101),bar(1,102,107,101,106),bar(2,107,110,105,109),bar(3,109,110,102,108),bar(4,108,109,97,98)];
  const result=marketStructureSnapshot(state(list));
  const first=result.zones.find(z=>z.type==='FVG'&&z.anchorTime===iso(0));
  assert.equal(first.lower,102);assert.equal(first.upper,105);assert.equal(first.confirmedTime,iso(3));
  assert.equal(first.status,'FILLED');assert.equal(first.filledAt,iso(4));
  const invalid=marketStructureSnapshot(state([list[0],list[1],list[2],bar(3,109,110,97,98)])).zones[0];
  assert.equal(invalid.status,'INVALIDATED');assert.equal(invalid.invalidatedAt,iso(4));
});

test('full, incremental and JSON-restart states and all historical prefix snapshots agree',()=>{
  const full=state();let incremental=createMarketStructureState({identity});
  for(const b of bars)incremental=appendMarketStructureBars(JSON.parse(JSON.stringify(incremental)),[b]);
  assert.deepEqual(incremental,full);
  for(let n=1;n<=bars.length;n++)assert.deepEqual(marketStructureSnapshot(full,{cutoff:bars[n-1].availableAt}),marketStructureSnapshot(state(bars.slice(0,n))));
});

test('forming/future bars, identity changes, null/coercible OHLC and ordering failures are rejected atomically',()=>{
  const original=state(bars.slice(0,3)),before=JSON.stringify(original);
  for(const patch of [{closed:false},{high:null},{low:'101'},{close:120},{availableAt:iso(3.5)},
    {identity:{...identity,continuityEpoch:1}},{identity:{...identity,session:'DAY'}},{identity:{...identity,actualContract:'TXFL6'}}])
    assert.throws(()=>appendMarketStructureBars(original,[{...bars[3],...patch}]),/SMC_/);
  assert.throws(()=>appendMarketStructureBars(original,[bars[3]],{cutoff:iso(3)}),/INELIGIBLE/);
  assert.throws(()=>appendMarketStructureBars(original,[bars[2]]),/ORDER/);
  assert.equal(JSON.stringify(original),before);
});

test('known gaps reset structure and zones without bridging or silently resetting old event history',()=>{
  const before=state(bars.slice(0,7));const after=appendMarketStructureBars(before,[bar(20,110,113,108,112)]);
  const result=marketStructureSnapshot(after);assert.equal(result.structure,'UNDETERMINED');
  assert.equal(result.events.filter(e=>e.type==='STRUCTURE_RESET').length,1);
  assert.ok(result.zones.filter(z=>z.availableAt<=iso(7)).every(z=>z.status!=='ACTIVE'));
  assert.deepEqual(marketStructureSnapshot(after,{cutoff:iso(7)}),marketStructureSnapshot(before));
});

test('strict pivot tie produces no pivot and too few bars stays undetermined',()=>{
  const list=Array.from({length:7},(_,n)=>bar(n,100,101,99,100));
  const result=marketStructureSnapshot(state(list));assert.equal(result.events.length,0);assert.equal(result.structure,'UNDETERMINED');
  assert.equal(marketStructureSnapshot(createMarketStructureState({identity})).state,'UNAVAILABLE');
  assert.throws(()=>state(list,{maxBars:6}),/BUDGET/);
});

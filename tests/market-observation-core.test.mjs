import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY,digest,stableJson} from '../src/cvd-observation-core.mjs';
import {createMarketObservationState,appendMarketObservationRecords,appendMarketObservationCanonical,marketObservationSnapshot,describeObservationScenario} from '../src/market-observation-core.mjs';
import {buildCru34LiveCheckpoint} from '../src/cru34-live-checkpoint.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {updateCanonicalCvdFragment} from '../src/cvd-canonical-fragment.mjs';

export function observationFixture(prices=[100,102,105,103,101,104,107,106,103,99,97,100,103,108,109,104,99,96,98,101]){
  let previousHash='GENESIS';
  return prices.map((price,i)=>{const time=new Date(Date.UTC(2026,10,4,1,i)).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',receivedAt:time,...SAFETY,
      payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:time,close:price,volume:2,tick_type:i%3===0?2:1}},previousHash);
    previousHash=row.recordHash;return row;});
}
const source='sha256:'+'a'.repeat(64),resolverIdentity='fixture-v1';
export function runObservation(records,chunk=2000){let state=createMarketObservationState(source,resolverIdentity);
  for(let i=0;i<records.length;i+=chunk)state=appendMarketObservationRecords(state,records.slice(i,i+chunk),{sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:i});return state;}
test('integration reuses CVD full/chunk/JSON restart, preserves volume and timeframe origin',()=>{
  const rows=observationFixture(),full=runObservation(rows),chunk=runObservation(rows,3);
  assert.deepEqual(chunk,full);
  const a=runObservation(rows.slice(0,10));
  const b=appendMarketObservationRecords(JSON.parse(JSON.stringify(a)),rows.slice(10),{sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:10});
  assert.deepEqual(b,full);
  const cutoff=rows.at(-1).receivedAt;
  const one=marketObservationSnapshot(full,{cutoff}),five=marketObservationSnapshot(full,{cutoff,timeframe:'5m'});
  assert.equal(one.profile.totalVolume,40);assert.equal(one.profile.bins.reduce((n,b)=>n+b.volume,0),40);
  assert.equal(one.cvd.value,five.cvd.value);assert.equal(one.cvd.observedStart,five.cvd.observedStart);
  assert.ok(one.structure.events.length>0);assert.ok(one.events.length>0);
  assert.equal(one.executionAuthorized,false);assert.equal(one.profile.partial,true);
});
test('future suffix cannot change historical cutoff API/summary/events/profile',()=>{
  const rows=observationFixture(),cutoff=rows[10].receivedAt;
  assert.deepEqual(marketObservationSnapshot(runObservation(rows),{cutoff}),marketObservationSnapshot(runObservation(rows.slice(0,11)),{cutoff}));
});
test('null/all UNKNOWN retain lawful profile, stale explicit, incomplete source stays insufficient',()=>{
  const raw=observationFixture();let h='GENESIS';const rows=raw.map(row=>{const {recordHash,previousHash,...body}=row;
    const v=buildLiveEventRecord({...body,payload:{...body.payload,tick_type:0}},h);h=v.recordHash;return v;});
  const data=marketObservationSnapshot(runObservation(rows),{cutoff:rows.at(-1).receivedAt,mode:'LIVE',now:'2026-11-04T02:00:00Z',sourceComplete:false});
  assert.equal(data.cvd.value,null);assert.equal(data.cvd.unknownVolume,40);assert.equal(data.profile.totalVolume,40);
  assert.ok(data.reasonCodes.includes('STALE'));assert.ok(data.reasonCodes.includes('SOURCE_CATCHUP_PENDING'));
  assert.equal(data.events.some(e=>e.deltaCvd!==null),false);
});
test('prefix before late future bad trade remains stable; no evidence before bar close/confirmation',()=>{
  const rows=observationFixture();const earlier=marketObservationSnapshot(runObservation(rows.slice(0,5)),{cutoff:rows[4].receivedAt});
  const bad=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',receivedAt:'2026-11-04T01:30:00Z',...SAFETY,payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:'2026-11-04T01:31:00Z',close:100,volume:2,tick_type:1}},rows.at(-1).recordHash);
  assert.deepEqual(marketObservationSnapshot(runObservation([...rows,bad]),{cutoff:rows[4].receivedAt}),earlier);
  for(const e of earlier.structure.events)assert.ok(Date.parse(e.availableAt)<=Date.parse(earlier.cutoff));
});
test('four candidate narratives require explicit evidence rather than three votes',()=>{
 const base={direction:'UP',test:{deltaCvd:10,priceDisplacement:3},after:{priceDisplacement:2},location:{price:110,val:95,vah:110},heldRetest:true,valueMigrated:true};
 assert.equal(describeObservationScenario(base).code,'BREAKOUT_RETEST_VALUE_MIGRATION');
 assert.equal(describeObservationScenario({...base,test:{deltaCvd:10,priceDisplacement:0},after:{priceDisplacement:-2}}).code,'BUY_EFFORT_NO_EXTENSION');
 assert.equal(describeObservationScenario({...base,test:{deltaCvd:-10,priceDisplacement:0}}).code,'SELL_EFFORT_RECLAIM');
 assert.equal(describeObservationScenario({...base,location:{price:100,val:95,vah:110},alternating:true}).code,'VALUE_AREA_ROTATION');
 assert.equal(describeObservationScenario({...base,heldRetest:false}).code,'UNRESOLVED_STRUCTURE_TEST');
});
test('existing decimal-string/local-time wire normalizes without coercing missing values',()=>{
 let h='GENESIS';const rows=observationFixture().map(row=>{const {recordHash,previousHash,...body}=row;
   const eventTime=body.payload.eventTime.replace('Z','+00:00');const next=buildLiveEventRecord({...body,payload:{...body.payload,price:String(body.payload.close),close:String(body.payload.close),eventTime}},h);h=next.recordHash;return next;});
 const s=marketObservationSnapshot(runObservation(rows),{cutoff:rows.at(-1).receivedAt});
 assert.equal(s.profile.totalVolume,40);assert.ok(s.events.length>0);assert.equal(s.price.last,101);
});
test('event test window includes triggering bar opening trade, excludes next-bar close witness',()=>{
 const rows=observationFixture(),data=marketObservationSnapshot(runObservation(rows),{cutoff:rows.at(-1).receivedAt});
 const event=data.events.find(e=>e.type==='BOS'&&e.barIndex===6);
 assert.equal(event.windows.test.deltaCvd,-2);assert.equal(event.windows.test.sellProxyVolume,2);assert.equal(event.windows.test.buyProxyVolume,0);
 assert.equal(event.windows.test.start,rows[6].receivedAt);assert.equal(event.windows.test.end,rows[7].receivedAt);
 assert.ok(event.confirmedAt>=event.nominalCloseTime);
});
test('terminal physical-lineage regression cannot re-expose earlier CVD as current',()=>{
 const rows=observationFixture(),last=buildLiveEventRecord({kind:'stock_tick',code:'2330',receivedAt:rows[0].receivedAt,...SAFETY,payload:{}},rows.at(-1).recordHash);
 const data=marketObservationSnapshot(runObservation([...rows,last]),{cutoff:rows.at(-1).receivedAt});
 assert.equal(data.cvd.value,null);assert.equal(data.cvd.state,'UNAVAILABLE');assert.ok(data.reasonCodes.includes('CONTINUITY_OR_LINEAGE_AWAITING_VALID_SEGMENT'));
 const cutoff=rows[4].receivedAt;
 assert.deepEqual(marketObservationSnapshot(runObservation([...rows,last]),{cutoff}),marketObservationSnapshot(runObservation(rows.slice(0,5)),{cutoff}));
});
test('governed session mismatch cannot leak legal-looking price/profile/SMC through unavailable CVD',()=>{
 const row=observationFixture([100])[0];const {recordHash,previousHash,...body}=row;
 const bad=buildLiveEventRecord({...body,payload:{...body.payload,session:'NIGHT'}},'GENESIS');
 const state=appendMarketObservationRecords(createMarketObservationState(source,resolverIdentity),[bad],{
 sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:0,resolveSessionTradeDate:()=>({session:'DAY',tradeDate:'2026-11-04'})});
 const data=marketObservationSnapshot(state,{cutoff:bad.receivedAt});
 assert.equal(data.cvd.value,null);assert.equal(data.profile.totalVolume,null);assert.equal(data.price.last,null);
 assert.ok(data.reasonCodes.includes('GOVERNED_SESSION_BOUNDARY_INVALID'));
});

const lineageTime=minute=>new Date(Date.parse('2026-11-04T01:00:00Z')+minute*60000).toISOString();
function lineageRows(spec){
 let hash='GENESIS';return spec.map(([minute,kind='futures_tick'])=>{
  const at=minute===null?null:lineageTime(minute);
  const body={kind,code:kind==='stock_tick'?'2330':'TXFK6',receivedAt:at,...SAFETY,
   payload:{product:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:at,close:100,volume:2,tick_type:1},previousHash:hash};
  // Deliberately malformed clock fixture: preserve hash-chain validity so the
  // consumer's unavailable-time behavior, rather than writer validation, runs.
  const record=at===null?{...body,recordHash:digest(`${hash}\n${stableJson(body)}`)}:buildLiveEventRecord(body,hash);
  hash=record.recordHash;return record;
 });
}
function canonicalPrefix(records,previous=null){
 const canonical=materializeTxCanonicalObservations(records,{sourceLedgerIdentity:source});
 const producer=buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:records.length,
  lastVerifiedRecordHash:records.at(-1).recordHash,lastVerifiedStartByteOffset:records.length*100,lastVerifiedEndByteOffset:records.length*100+99,
  canonicalState:canonical.terminalState,rollingCanonicalEvents:canonical.events,lastVerifiedAvailableAt:records.at(-1).receivedAt});
 const fragment=updateCanonicalCvdFragment(previous?.fragment??null,producer,{resolverIdentity});
 return {fragment:fragment.checkpoint,state:appendMarketObservationCanonical(previous?.state??null,fragment)};
}

test('recovered raw lineage keeps closed invalid intervals and isolates a second invalid episode',()=>{
 const records=lineageRows([[0],[1],[0,'stock_tick'],[2,'quote_type_resubscribe'],[3],[4],[10,'stock_tick'],[9,'stock_tick']]);
 const full=runObservation(records),prefix=runObservation(records.slice(0,6));
 for(const chunk of [1,2,3,5])assert.deepEqual(runObservation(records,chunk),full);
 const restarted=appendMarketObservationRecords(JSON.parse(JSON.stringify(prefix)),records.slice(6),{
  sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:6});assert.deepEqual(restarted,full);
 const at=minute=>marketObservationSnapshot(full,{cutoff:lineageTime(minute)});
 assert.equal(at(2).cvd.value,null);assert.equal(at(2).cvd.state,'UNAVAILABLE');
 assert.deepEqual(at(2),marketObservationSnapshot(runObservation(records.slice(0,4)),{cutoff:lineageTime(2)}));
 assert.equal(at(4).cvd.value,4);assert.deepEqual(at(4),marketObservationSnapshot(prefix,{cutoff:lineageTime(4)}));
 assert.equal(at(10).cvd.value,null);assert.equal(full.lineageTimeline.intervals.length,1);
 assert.equal(full.lineageTimeline.open.startMs,Date.parse(lineageTime(10)));
});

test('missing physical timestamp and reconnect preserve historical unknown through recovery',()=>{
 const records=lineageRows([[0],[1],[null,'stock_tick'],[2,'quote_type_resubscribe'],[3],[4]]);
 const full=runObservation(records),chunked=runObservation(records,1);assert.deepEqual(full,chunked);
 const during=marketObservationSnapshot(full,{cutoff:lineageTime(2)});
 assert.equal(during.cvd.value,null);assert.equal(during.cvd.state,'UNAVAILABLE');
 assert.equal(marketObservationSnapshot(full,{cutoff:lineageTime(4)}).cvd.value,4);
 assert.deepEqual(marketObservationSnapshot(full,{cutoff:lineageTime(0)}),marketObservationSnapshot(runObservation(records.slice(0,1)),{cutoff:lineageTime(0)}));
});

test('warm canonical invalid episodes survive restart and do not contaminate a recovered prefix',()=>{
 const records=lineageRows([[0],[1],[0,'stock_tick'],[2,'quote_type_resubscribe'],[3],[4],[10,'stock_tick'],[9,'stock_tick']]);
 let current=null;let recovered;
 for(let count=1;count<=records.length;count++){
  current=canonicalPrefix(records.slice(0,count),current?JSON.parse(JSON.stringify(current)):null);
  if(count===6)recovered=structuredClone(current.state);
 }
 const at=minute=>marketObservationSnapshot(current.state,{cutoff:lineageTime(minute)});
 assert.equal(at(2).cvd.value,null);assert.equal(at(2).cvd.state,'UNAVAILABLE');
 assert.equal(at(4).cvd.value,4);assert.deepEqual(at(4),marketObservationSnapshot(recovered,{cutoff:lineageTime(4)}));
 assert.equal(at(10).cvd.value,null);
 assert.ok(at(4).reasonCodes.includes('PRODUCER_NONCANONICAL_HISTORY_NOT_RETAINED'));
});

test('cold canonical epoch gap is qualified unavailable because physical break timing is not retained',()=>{
 const records=lineageRows([[0],[1],[2,'stock_tick'],[3,'quote_type_resubscribe'],[4],[5]]);
 const cold=canonicalPrefix(records).state;
 const gap=marketObservationSnapshot(cold,{cutoff:lineageTime(2)});
 assert.equal(gap.cvd.value,null);assert.ok(gap.reasonCodes.includes('PRODUCER_NONCANONICAL_INTERVAL_UNPROVEN'));
 // The raw prefix proves this timestamp was valid; the cold producer cannot.
 assert.equal(marketObservationSnapshot(runObservation(records),{cutoff:lineageTime(2)}).cvd.value,4);
 assert.equal(marketObservationSnapshot(cold,{cutoff:lineageTime(5)}).cvd.value,4);
 const older=marketObservationSnapshot(cold,{cutoff:lineageTime(1)});
 assert.deepEqual(older,marketObservationSnapshot(canonicalPrefix(records.slice(0,2)).state,{cutoff:lineageTime(1)}));
});

test('canonical future noncanonical invalid tail cannot rewrite earlier witnessed prefix',()=>{
 const records=lineageRows([[0],[1],[10,'stock_tick'],[9,'stock_tick']]);
 const earlier=canonicalPrefix(records.slice(0,2)),later=canonicalPrefix(records,earlier);
 assert.deepEqual(marketObservationSnapshot(later.state,{cutoff:lineageTime(1)}),marketObservationSnapshot(earlier.state,{cutoff:lineageTime(1)}));
 assert.equal(marketObservationSnapshot(later.state,{cutoff:lineageTime(10)}).cvd.value,null);
});

test('backdated reconnect epoch is quarantined from all modules until a fresh proved epoch',()=>{
 const records=lineageRows([[0],[10],[11,'quote_type_resubscribe'],[1],[2],[12],[13,'quote_type_resubscribe'],[14],[15]]);
 const prefix=runObservation(records.slice(0,2)),invalid=runObservation(records.slice(0,6)),full=runObservation(records);
 assert.deepEqual(runObservation(records,1),full);assert.deepEqual(runObservation(records,3),full);
 for(const minute of [0,1,2,10]){
  const expected=marketObservationSnapshot(prefix,{cutoff:lineageTime(minute)});
  assert.deepEqual(marketObservationSnapshot(invalid,{cutoff:lineageTime(minute)}),expected);
  assert.deepEqual(marketObservationSnapshot(full,{cutoff:lineageTime(minute)}),expected);
 }
 assert.equal(marketObservationSnapshot(invalid,{cutoff:lineageTime(12)}).cvd.value,null);
 assert.equal(marketObservationSnapshot(full,{cutoff:lineageTime(12)}).cvd.value,null);
 assert.equal(full.segments.some(segment=>segment.identity.continuityEpoch==='TX:2'),false);
 const recovered=marketObservationSnapshot(full,{cutoff:lineageTime(15)});
 assert.equal(recovered.identity.continuityEpoch,'TX:3');assert.equal(recovered.cvd.value,4);assert.equal(recovered.profile.totalVolume,4);
 const cold=canonicalPrefix(records).state;
 for(const minute of [0,1,2,10])assert.deepEqual(marketObservationSnapshot(cold,{cutoff:lineageTime(minute)}),
  marketObservationSnapshot(canonicalPrefix(records.slice(0,2)).state,{cutoff:lineageTime(minute)}));
 assert.equal(marketObservationSnapshot(cold,{cutoff:lineageTime(12)}).cvd.value,null);
 assert.equal(marketObservationSnapshot(cold,{cutoff:lineageTime(15)}).cvd.value,4);
});

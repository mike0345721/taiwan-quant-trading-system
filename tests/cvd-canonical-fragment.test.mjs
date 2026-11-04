import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {buildCru34LiveCheckpoint} from '../src/cru34-live-checkpoint.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {createCvdCheckpoint,appendCvdRecords,cvdSemanticResult,SAFETY,digest,stableJson} from '../src/cvd-observation-core.mjs';
import {updateCanonicalCvdFragment,validateCanonicalCvdFragment} from '../src/cvd-canonical-fragment.mjs';
const source='sha256:'+'a'.repeat(64),resolverIdentity='fragment-fixture-v1';
const iso=n=>new Date(Date.parse('2026-11-04T01:00:00Z')+n*1000).toISOString();
const row=(n,kind='futures_tick',payload={},more={})=>({kind,code:'TXFK6',receivedAt:iso(n),...SAFETY,...more,
  payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:iso(n),close:100+n%3,
    volume:n%3+1,tick_type:n%3,...payload}});
function chain(rows){let hash='GENESIS';return rows.map(row=>{const record=buildLiveEventRecord(row,hash);hash=record.recordHash;return record;});}
const rows=[row(0,'futures_bidask',{bid_price:[99],ask_price:[101]}),row(1),row(2),row(3),row(4,'futures_bidask',{bid_price:[100],ask_price:[101]}),row(5),row(6)];
function producer(records,{sourceIdentity=source,eventSlice=0,more={}}={}){
  const canonical=materializeTxCanonicalObservations(records,{sourceLedgerIdentity:sourceIdentity});
  const events=canonical.events.slice(eventSlice).map(event=>{const {eventTime,rawRecord,...compact}=event;return compact;});
  return buildCru34LiveCheckpoint({sourceLedgerIdentity:sourceIdentity,lastVerifiedLedgerOrdinal:records.length,
    lastVerifiedRecordHash:records.at(-1).recordHash,lastVerifiedStartByteOffset:records.length*100,lastVerifiedEndByteOffset:records.length*100+99,
    canonicalState:canonical.terminalState,rollingCanonicalEvents:events,lastVerifiedAvailableAt:records.at(-1).receivedAt,...more});
}
const update=(prior,p,options={})=>updateCanonicalCvdFragment(prior,p,{resolverIdentity,...options});

test('producer fragment and original raw CVD share exact classification, segment and series semantics',()=>{
  const records=chain(rows),fragment=update(null,producer(records));
  const raw=appendCvdRecords(createCvdCheckpoint(source,resolverIdentity),records,{sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:0});
  const expected=cvdSemanticResult(raw).semantic;
  assert.equal(fragment.cvdSemantic.value,expected.value);
  assert.deepEqual(fragment.cvdSemantic.series,expected.series);assert.deepEqual(fragment.cvdSemantic.segments,expected.segments);
  assert.equal(fragment.resetReason,'INITIAL_OBSERVED_FRAGMENT');assert.equal(fragment.cvdSemantic.captureCompleteness,'UNPROVEN');
});

test('overlapping refresh, full run, incremental and JSON restart agree without resetting anchor',()=>{
  const records=chain(rows),full=update(null,producer(records));let current=null;
  for(let n=1;n<=records.length;n++)current=update(current?JSON.parse(JSON.stringify(current.checkpoint)):null,producer(records.slice(0,n)));
  assert.deepEqual(current.checkpoint,full.checkpoint);assert.deepEqual(current.cvdSemantic,full.cvdSemantic);
  const repeated=update(current.checkpoint,producer(records));assert.deepEqual(repeated.checkpoint,current.checkpoint);
  assert.equal(repeated.canonicalEvents.length,0);assert.equal(repeated.resetReason,null);
});

test('initial partial slice is explicit and rolling overlap loss creates a new observation fragment',()=>{
  const records=chain(rows),initial=update(null,producer(records.slice(0,4)),{initialEventLimit:2});
  assert.equal(initial.cvdSemantic.originOrdinal,3);assert.equal(initial.canonicalEvents.length,2);
  const next=update(initial.checkpoint,producer(records,{eventSlice:4}),{initialEventLimit:2});
  assert.equal(next.resetReason,'ROLLING_OVERLAP_UNAVAILABLE');assert.equal(next.cvdSemantic.originOrdinal,6);
  assert.equal(next.cvdSemantic.segments[0].scope,'OBSERVED_FRAGMENT');
});

test('terminal reconnect invalidates current value; next valid canonical epoch creates segment',()=>{
  const records=chain([...rows,row(7,'quote_type_resubscribe',{product:'TX'}),row(8)]);
  const first=update(null,producer(records.slice(0,7))),broken=update(first.checkpoint,producer(records.slice(0,8)));
  assert.equal(broken.cvdSemantic.value,null);assert.deepEqual(broken.cvdSemantic.series,first.cvdSemantic.series);
  const recovered=update(broken.checkpoint,producer(records));assert.equal(recovered.cvdSemantic.segments.length,2);
  assert.equal(recovered.cvdSemantic.value,-3);assert.equal(recovered.cvdSemantic.activeIdentity[3],'TX:2');
});

test('noncanonical physical lineage regression nulls current availability without rewriting earlier values',()=>{
  const records=chain([...rows,row(2,'stock_tick')]);
  const earlier=update(null,producer(records.slice(0,7))),broken=update(earlier.checkpoint,producer(records));
  assert.equal(broken.cvdSemantic.availableAt,null);assert.equal(broken.cvdSemantic.value,null);
  assert.deepEqual(broken.cvdSemantic.series,earlier.cvdSemantic.series);
});

test('source rollback, overlap conflicts, malformed canonical timestamps and unsafe checkpoints reject',()=>{
  const records=chain(rows),full=update(null,producer(records)),prefix=producer(records.slice(0,3));
  assert.throws(()=>update(full.checkpoint,prefix),/ROLLBACK/);
  const p=producer(records),event=p.rollingCanonicalEvents.at(-1);
  const conflict=producer(records,{more:{rollingCanonicalEvents:p.rollingCanonicalEvents.map(e=>e===event?{...e,recordHash:'b'.repeat(64)}:e)}});
  assert.throws(()=>update(full.checkpoint,conflict),/OVERLAP_HASH/);
  const bad=producer(records,{more:{rollingCanonicalEvents:[{...event,eventTime:iso(999)}]}});
  assert.throws(()=>update(null,bad),/TIME_WITNESS/);
  assert.throws(()=>update(null,{...p,orderRoutesEnabled:true}),/HASH/);
  const corrupted=structuredClone(full.checkpoint);corrupted.state.cvd.series[0].value=999;
  assert.throws(()=>update(corrupted,p),/CHECKPOINT_INVALID/);
});

test('source switch resets explicitly; all UNKNOWN remains null, and huge physical ordinal is not a full-ledger read',()=>{
  const records=chain([row(1,'futures_tick',{tick_type:0})]),first=update(null,producer(records));
  assert.equal(first.cvdSemantic.value,null);assert.equal(first.cvdSemantic.segments[0].unknownVolume,2);
  const next=update(first.checkpoint,producer(records,{sourceIdentity:'sha256:'+'b'.repeat(64)}));assert.equal(next.resetReason,'SOURCE_IDENTITY_CHANGED');
  const p=producer(records),shift=1000000;
  const high=producer(records,{more:{lastVerifiedLedgerOrdinal:shift+1,rollingCanonicalEvents:p.rollingCanonicalEvents.map(e=>({...e,ledgerOrdinal:e.ledgerOrdinal+shift}))}});
  assert.equal(update(null,high).cvdSemantic.cutoffLedgerOrdinal,shift+1);
});

test('batched lookup preserves late-tick selection and identity-return clearing against original raw continuation',()=>{
  const cases=[
    [row(1,'futures_bidask',{bid_price:[99],ask_price:[100],eventTime:iso(0)}),row(2,'futures_bidask',{bid_price:[199],ask_price:[200]}),
      row(3,'futures_tick',{eventTime:iso(1),close:100,tick_type:1})],
    [row(1,'futures_bidask',{bid_price:[99],ask_price:[100]}),row(1,'futures_tick',{close:100}),
      row(2,'futures_bidask',{actualContract:'TXFL6',bid_price:[99],ask_price:[100]}),row(2,'futures_tick',{close:100})],
  ];
  for(const rows of cases){
    const records=chain(rows),fragment=update(null,producer(records));
    const raw=appendCvdRecords(createCvdCheckpoint(source,resolverIdentity),records,{sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:0});
    assert.deepEqual(fragment.cvdSemantic.series,cvdSemanticResult(raw).semantic.series);
    assert.deepEqual(fragment.cvdSemantic.segments,cvdSemanticResult(raw).semantic.segments);
  }
});

test('quote-only refresh followed by legal unused-quote pruning retains the tick anchor and cumulative origin',()=>{
  const records=chain([row(0,'futures_bidask',{bid_price:[99],ask_price:[101]}),row(1),
    row(2,'futures_bidask',{bid_price:[99],ask_price:[101]}),row(5)]);
  const first=update(null,producer(records.slice(0,2)));
  const quoteOnly=update(first.checkpoint,producer(records.slice(0,3)));
  assert.equal(quoteOnly.checkpoint.state.lastCanonicalOrdinal,3);assert.equal(quoteOnly.checkpoint.state.lastTickOrdinal,2);
  const full=producer(records),pruned=producer(records,{more:{rollingCanonicalEvents:full.rollingCanonicalEvents.filter(event=>event.ledgerOrdinal!==3)}});
  const result=update(quoteOnly.checkpoint,pruned);
  assert.equal(result.resetReason,null);assert.equal(result.cvdSemantic.originOrdinal,first.cvdSemantic.originOrdinal);
  assert.equal(result.cvdSemantic.series.length,2);assert.equal(result.canonicalEvents.length,1);
  assert.equal(result.cvdSemantic.value,first.cvdSemantic.value-3);
  const missingTick=producer(records,{more:{rollingCanonicalEvents:full.rollingCanonicalEvents.filter(event=>event.ledgerOrdinal>2)}});
  assert.equal(update(quoteOnly.checkpoint,missingTick).resetReason,'ROLLING_OVERLAP_UNAVAILABLE');
});

test('rolling removal of old ticks and unused quotes preserves earlier cumulative volume and legacy private-cache anchors',()=>{
  const buy=n=>row(n,'futures_tick',{volume:2,tick_type:1});
  const records=chain([buy(0),buy(1),buy(14400),row(14401,'futures_bidask',{bid_price:[99],ask_price:[100]}),
    row(14403,'futures_bidask',{bid_price:[99],ask_price:[100]}),buy(14404)]);
  const before=update(null,producer(records.slice(0,4)));assert.equal(before.cvdSemantic.value,6);
  const full=producer(records),next=producer(records,{more:{rollingCanonicalEvents:full.rollingCanonicalEvents.filter(event=>![1,4].includes(event.ledgerOrdinal))}});
  for(const checkpoint of [before.checkpoint,(()=>{const state=structuredClone(before.checkpoint.state);delete state.lastTickOrdinal;delete state.lastTickHash;
    return {state,stateHash:digest(stableJson(state))};})()]){
    const result=update(checkpoint,next);assert.equal(result.resetReason,null);assert.equal(result.cvdSemantic.value,8);
    assert.equal(result.cvdSemantic.originOrdinal,1);assert.equal(result.cvdSemantic.series.length,4);
  }
  const prunedQuoteOnly=producer(records.slice(0,4),{more:{rollingCanonicalEvents:producer(records.slice(0,4)).rollingCanonicalEvents.filter(event=>event.ledgerOrdinal!==4)}});
  assert.equal(update(before.checkpoint,prunedQuoteOnly).checkpoint.state.lastCanonicalOrdinal,4);
});

test('sustained rolling refreshes explicitly stop at the retained quote budget without pruning or publishing partial advance',()=>{
  const origin=Date.parse('2026-11-04T01:00:00Z');
  function rolling(end){
    const events=Array.from({length:Math.min(end,20000)},(_,offset)=>{
      const i=Math.max(0,end-20000)+offset,at=origin+i;
      return {kind:i%2?'futures_tick':'futures_bidask',sourceLedgerIdentity:source,ledgerOrdinal:1000000+i+1,
        recordHash:i.toString(16).padStart(64,'0'),actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',continuityEpoch:'TX:1',
        identityStatus:'USABLE',availabilityLineageStatus:'USABLE',joinedContinuityStatus:'USABLE',eventMs:at,availableMs:at,availableAt:new Date(at).toISOString(),
        payload:i%2?{close:100,volume:1,tick_type:1}:{bid_price:[99],ask_price:[100]},...SAFETY};
    });
    return buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:1000000+end,lastVerifiedRecordHash:events.at(-1).recordHash,
      lastVerifiedStartByteOffset:end*100,lastVerifiedEndByteOffset:end*100+99,canonicalState:{epoch:1,breakPending:false,epochLineageInvalid:false},
      rollingCanonicalEvents:events,lastVerifiedAvailableAt:events.at(-1).availableAt});
  }
  let current=null;
  for(const count of [20000,30000,40000,50000])current=update(current?.checkpoint??null,rolling(count));
  assert.equal(current.checkpoint.state.cvd.quotes.length,25000);assert.equal(current.cvdSemantic.value,25000);
  const oldHash=current.checkpoint.stateHash,oldOrdinal=current.checkpoint.state.sourceOrdinal;
  assert.throws(()=>update(current.checkpoint,rolling(50002)),/CVD_QUOTE_STATE_BUDGET/);
  assert.equal(current.checkpoint.stateHash,oldHash);assert.equal(current.checkpoint.state.sourceOrdinal,oldOrdinal);
  assert.equal(validateCanonicalCvdFragment(current.checkpoint).cvd.series.at(-1).value,25000);
});

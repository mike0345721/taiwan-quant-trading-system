import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {MarketObservationStore,INPUT_STAGE_LIMITS} from '../src/market-observation-store.mjs';
import {digest,stableJson,SAFETY} from '../src/cvd-observation-core.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {buildCru34LiveCheckpoint,cru34LiveCanonicalJson} from '../src/cru34-live-checkpoint.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {readMarketObservationProducer,clearMarketObservationProducerCache} from '../src/market-observation-producer.mjs';
import {marketObservationSnapshot} from '../src/market-observation-core.mjs';

function source(count=4500,padding=0,label='one'){
  const body={label,rollingCanonicalEvents:Array.from({length:count},(_,i)=>({ledgerOrdinal:i+1,recordHash:digest(String(i)),padding:'x'.repeat(padding)}))};
  const checkpoint={...body,checkpointHash:digest(stableJson(body))};
  return {checkpoint,signature:label,sourceProof:{originalPhysicalSha256:digest(label+checkpoint.checkpointHash),reducedCheckpointHash:checkpoint.checkpointHash}};
}
function storeFixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'observation-input-')),file=path.join(root,'private.observation.sqlite');
  const binding={sourcePath:path.join(root,'source.json'),resolverIdentity:'test-calendar'};
  let store=new MarketObservationStore(file,binding);
  t.after(()=>{store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {get store(){return store;},restart(){store.close();store=new MarketObservationStore(file,binding);return store;}};
}
function finishInput(store,input){let result;
  for(let i=0;i<100;i++){result=store.transaction(()=>store.stageSourceStep(input));if(result.complete)return result;}
  assert.fail('input persistence did not finish');
}

test('input persistence is bounded by chunks and bytes and cannot expose a partial checkpoint',t=>{
  const {store}=storeFixture(t),input=source(4500);let result;
  for(let i=0;i<3;i++){
    result=store.transaction(()=>store.stageSourceStep(input));
    assert.ok(result.writtenChunks<=2);assert.ok(result.writtenBytes<=2*1024*1024);
    assert.equal(result.persistedEvents,Math.min((i+1)*2000,4500));
    assert.equal(store.getMeta('checkpoint'),null);assert.equal(store.getMeta('pending-derivation'),null);
    if(i<2){assert.equal(store.pendingSource(),null);assert.equal(store.inputStage().state,'STAGING');}
  }
  assert.equal(result.complete,true);assert.equal(store.inputStage(),null);
  assert.deepEqual(store.pendingSource(),input);
});

test('large legal events form at most 1 MiB chunks without exceeding the 2 MiB request budget',t=>{
  const {store}=storeFixture(t),input=source(30,120*1024);
  const result=store.transaction(()=>store.stageSourceStep(input));
  assert.ok(result.persistedEvents<30);assert.equal(result.writtenChunks,2);
  assert.ok(result.writtenBytes<=INPUT_STAGE_LIMITS.bytes);
  for(const chunk of store.inputStage().chunks){assert.ok(chunk.bytes<=INPUT_STAGE_LIMITS.chunkBytes);assert.ok(chunk.count<=1000);}
  finishInput(store,input);assert.deepEqual(store.pendingSource(),input);
});

test('partial progress survives restart and rollback cannot advance its cursor or chunks',t=>{
  const fixture=storeFixture(t),input=source(4500);let store=fixture.store;
  store.transaction(()=>store.stageSourceStep(input));const before=store.inputStage();
  const exec=store.db.exec;store.db.exec=function(sql){if(sql==='COMMIT')throw Error('SYNTHETIC_INPUT_COMMIT_INTERRUPTION');return exec.call(this,sql);};
  try{assert.throws(()=>store.transaction(()=>store.stageSourceStep(input)),/SYNTHETIC_INPUT_COMMIT_INTERRUPTION/);}finally{store.db.exec=exec;}
  assert.deepEqual(store.inputStage(),before);
  assert.equal(store.statement("SELECT count(*) n FROM meta WHERE key LIKE 'pending-input-%'").get().n,2);
  store=fixture.restart();assert.equal(store.inputStage().nextEvent,2000);finishInput(store,input);
  assert.deepEqual(store.pendingSource(),input);
});

for(const corruption of ['missing','swapped','checkpoint-hash','physical-proof'])test(`READY rejects ${corruption} durable input`,t=>{
  const {store}=storeFixture(t),input=source(4500);finishInput(store,input);const header=store.getMeta('pending-source');
  if(corruption==='missing')store.deleteMeta(`pending-input-${header.generation}-1`);
  else if(corruption==='swapped')store.setMeta(`pending-input-${header.generation}-0`,store.getMeta(`pending-input-${header.generation}-1`));
  else{if(corruption==='physical-proof')header.source.sourceProof.originalPhysicalSha256='0'.repeat(64);
    else header.source.checkpoint.checkpointHash='0'.repeat(64);store.setMeta('pending-source',header);}
  assert.throws(()=>store.pendingSource(),/OBSERVATION_INPUT_/);
});

test('cleanup is durable, bounded, and separate from publishing the completed input',t=>{
  const fixture=storeFixture(t),input=source(4500);let store=fixture.store;finishInput(store,input);
  store.transaction(()=>store.clearPending());assert.equal(store.pendingSource(),null);
  assert.ok(store.getMeta('pending-source-cleanup'));let cleanup=store.transaction(()=>store.cleanupSourceStep());
  assert.ok(cleanup.deletedChunks<=2);assert.ok(cleanup.deletedBytes<=2*1024*1024);
  store=fixture.restart();
  while(store.getMeta('pending-source-cleanup')){cleanup=store.transaction(()=>store.cleanupSourceStep());
    assert.ok(cleanup.deletedChunks<=2);assert.ok(cleanup.deletedBytes<=2*1024*1024);}
  assert.equal(store.statement("SELECT count(*) n FROM meta WHERE key LIKE 'pending-input-%'").get().n,0);
});

test('replacement keeps the abandoned proof and durable replacement identity across cleanup restart',t=>{
  const fixture=storeFixture(t),old=source(4500),next=source(5000,0,'two');let store=fixture.store;
  store.transaction(()=>store.stageSourceStep(old));const abandoned=store.inputStage();
  store.transaction(()=>store.abandonInput(next));store=fixture.restart();
  assert.equal(store.inputStage().generation,store.inputGeneration(next));assert.equal(store.inputStage().nextEvent,0);
  assert.equal(store.getMeta(`input-abandoned-${abandoned.generation}`).state,'ABANDONED');
  while(store.getMeta('pending-source-cleanup'))store.transaction(()=>store.cleanupSourceStep());
  finishInput(store,next);assert.deepEqual(store.pendingSource(),next);
});

test('legacy all-at-once input API remains readable and clearable',t=>{
  const {store}=storeFixture(t),input=source(2500);store.transaction(()=>store.stageSource(input));
  assert.deepEqual(store.pendingSource(),input);store.transaction(()=>store.clearPending());assert.equal(store.pendingSource(),null);
  assert.ok(store.getMeta('pending-source-cleanup').legacy);
  while(store.getMeta('pending-source-cleanup'))store.transaction(()=>store.cleanupSourceStep());
  assert.equal(store.getMeta('pending-source-0'),null);
});

test('a legal oversized legacy chunk is retained with a receipt instead of blocking cleanup forever',t=>{
  const {store}=storeFixture(t),input=source(1000,2500);store.transaction(()=>store.stageSource(input));
  store.transaction(()=>store.clearPending());const cleanup=store.transaction(()=>store.cleanupSourceStep());
  assert.equal(cleanup.complete,true);assert.equal(cleanup.retainedChunks,1);assert.equal(cleanup.deletedBytes,0);
  assert.ok(store.getMeta('pending-source-0'));
  const row=store.statement("SELECT key FROM meta WHERE key LIKE 'input-cleanup-retained-%'").get();
  assert.equal(store.getMeta(row.key).state,'DEFERRED_RETAINED');
  finishInput(store,source(20,0,'replacement'));assert.equal(store.pendingSource().checkpoint.rollingCanonicalEvents.length,20);
});

const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const ledger='sha256:'+'a'.repeat(64),base=Date.parse('2026-11-04T01:00:00Z');
function records(count,firstQuote=false){let hash='GENESIS';return Array.from({length:count},(_,i)=>{
  const at=new Date(base+i*1000).toISOString();
  const row=buildLiveEventRecord({kind:firstQuote&&i===0?'futures_bidask':'futures_tick',code:'TXFK6',receivedAt:at,...SAFETY,
    payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:at,close:100+i%5,volume:2,tick_type:i%3,
      ...(firstQuote&&i===0?{bid_price:[99],ask_price:[101]}:{})}},hash);
  hash=row.recordHash;return row;});}
function publication(rows,retain=rows.length){
  const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:ledger});
  return buildCru34LiveCheckpoint({sourceLedgerIdentity:ledger,lastVerifiedLedgerOrdinal:rows.length,lastVerifiedRecordHash:rows.at(-1).recordHash,
    lastVerifiedStartByteOffset:rows.length*100,lastVerifiedEndByteOffset:rows.length*100+99,lastVerifiedAvailableAt:rows.at(-1).receivedAt,
    canonicalState:canonical.terminalState,rollingCanonicalEvents:canonical.events.map(event=>{const {eventTime,rawRecord,...rest}=event;return rest;}).slice(-retain)});
}
function producerFixture(t,initial){
  clearMarketObservationProducerCache();const root=fs.mkdtempSync(path.join(os.tmpdir(),'producer-input-'));
  const checkpointPath=path.join(root,'source.json'),cacheRoot=path.join(root,'cache');
  const options={checkpointPath,cacheRoot,calendar,persistentHistory:true,staged:true};
  const publish=value=>fs.writeFileSync(checkpointPath,cru34LiveCanonicalJson(value)+'\n');publish(initial);
  t.after(()=>{clearMarketObservationProducerCache();fs.rmSync(root,{recursive:true,force:true});});
  return {options,publish,read:()=>readMarketObservationProducer(options)};
}
function completeProducer(f){let result;for(let i=0;i<100;i++){result=f.read();if(result.complete&&result.state)return result;}assert.fail('producer did not complete');}

test('producer resumes an incomplete durable source after restart without deriving partial input',t=>{
  const rows=records(3500),f=producerFixture(t,publication(rows));f.read();const first=f.read();
  assert.equal(first.sourceProgress.stage,'SOURCE_PERSISTING');assert.equal(first.state,null);
  clearMarketObservationProducerCache();const result=completeProducer(f);
  const expected=readMarketObservationProducer({...f.options,staged:false,persistentHistory:false,cacheRoot:null});
  assert.deepEqual(marketObservationSnapshot(result.state,{cutoff:rows.at(-1).receivedAt,history:result.history}),
    marketObservationSnapshot(expected.state,{cutoff:rows.at(-1).receivedAt}));
});

test('partial restart can switch to a verified superset publication without changing the cumulative origin',t=>{
  const rows=records(3700),f=producerFixture(t,publication(rows.slice(0,3500)));f.read();assert.equal(f.read().sourceProgress.stage,'SOURCE_PERSISTING');
  f.publish(publication(rows));clearMarketObservationProducerCache();const result=completeProducer(f);
  assert.equal(result.history.getMeta('checkpoint').fragment.state.originOrdinal,1);
  assert.equal(result.history.getMeta('checkpoint').fragment.state.sourceOrdinal,3700);
  assert.equal(result.history.statement("SELECT count(*) n FROM meta WHERE key LIKE 'input-abandoned-%'").get().n,1);
});

test('partial restart refuses a newer publication that has already lost the required unpublished prefix',t=>{
  const rows=records(3700),f=producerFixture(t,publication(rows.slice(0,3500)));f.read();f.read();
  f.publish(publication(rows,1000));clearMarketObservationProducerCache();
  let caught=false;for(let i=0;i<20;i++){try{f.read();}catch(error){assert.match(error.message,/OBSERVATION_INPUT_REACQUISITION_GAP/);caught=true;break;}}
  assert.equal(caught,true);
});

for(const change of ['rewrite','delete'])test(`reacquisition rejects a resealed publication with ${change} in the unpersisted middle`,t=>{
  const rows=records(3700),f=producerFixture(t,publication(rows.slice(0,3500)));f.read();f.read();
  const next=publication(rows),events=next.rollingCanonicalEvents.map(event=>({...event}));
  if(change==='delete')events.splice(3000,1);else events[3000].volume=999;
  f.publish(buildCru34LiveCheckpoint({...next,rollingCanonicalEvents:events}));clearMarketObservationProducerCache();
  let caught=false;for(let i=0;i<20;i++){try{f.read();}catch(error){assert.match(error.message,/OBSERVATION_INPUT_REACQUISITION_GAP/);caught=true;break;}}
  assert.equal(caught,true);
});

test('quote-only published origin can anchor partial restart and a newer superset publication',t=>{
  const rows=records(3700,true),f=producerFixture(t,publication(rows.slice(0,1))),published=completeProducer(f);
  assert.equal(published.history.getMeta('checkpoint').fragment.state.lastTickOrdinal,null);
  f.publish(publication(rows.slice(0,3500)));let partial;
  for(let i=0;i<20;i++){partial=f.read();if(partial.sourceProgress?.stage==='SOURCE_PERSISTING')break;}
  assert.equal(partial.sourceProgress.stage,'SOURCE_PERSISTING');f.publish(publication(rows));clearMarketObservationProducerCache();
  const result=completeProducer(f);assert.equal(result.history.getMeta('checkpoint').fragment.state.originOrdinal,1);
  assert.equal(result.history.getMeta('checkpoint').fragment.state.sourceOrdinal,3700);
});

for(const newer of [false,true])test(`non-staged API can resume partial persistence${newer?' with a newer superset':''}`,t=>{
  const rows=records(3700),f=producerFixture(t,publication(rows.slice(0,3500)));f.read();f.read();
  if(newer)f.publish(publication(rows));clearMarketObservationProducerCache();let result;
  for(let i=0;i<100;i++){result=readMarketObservationProducer({...f.options,staged:false});if(result.state&&result.complete)break;}
  assert.ok(result.state&&result.complete);assert.equal(result.history.getMeta('checkpoint').fragment.state.sourceOrdinal,newer?3700:3500);
});

for(const alteration of ['deleted','physical-proof-changed'])test(`resident input cannot bypass a ${alteration} durable READY header during partial derivation`,t=>{
  const f=producerFixture(t,publication(records(3500)));let partial;
  for(let i=0;i<30;i++){partial=f.read();if(partial.reason==='DERIVATION_CATCHUP_PENDING')break;}
  assert.equal(partial.reason,'DERIVATION_CATCHUP_PENDING');
  assert.ok(partial.history.getMeta('pending-source'));assert.ok(partial.history.getMeta('pending-derivation'));
  const external=new DatabaseSync(partial.history.file);
  try{if(alteration==='deleted')external.exec("DELETE FROM meta WHERE key='pending-source'");
    else{const header=partial.history.getMeta('pending-source');header.source.sourceProof.originalPhysicalSha256='0'.repeat(64);
      const json=JSON.stringify(header);external.prepare("UPDATE meta SET json=?,hash=? WHERE key='pending-source'").run(json,digest(json));}
  }finally{external.close();}
  let rejected=false;for(let i=0;i<20;i++){
    try{const result=f.read();assert.ok(result.state===null,'missing durable input must never publish from resident data');}
    catch(error){assert.match(error.message,alteration==='deleted'?/OBSERVATION_PENDING_SOURCE_MISSING/:/OBSERVATION_INPUT_GENERATION_BINDING/);rejected=true;break;}
  }
  assert.equal(rejected,true);
});

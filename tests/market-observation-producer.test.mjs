import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {buildCru34LiveCheckpoint,cru34LiveCanonicalJson,cru34LiveHash,validateCru34LiveCheckpoint} from '../src/cru34-live-checkpoint.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {SAFETY,digest} from '../src/cvd-observation-core.mjs';
import {marketObservationSnapshot} from '../src/market-observation-core.mjs';
import {parseCanonicalProducerTail,readMarketObservationProducer,clearMarketObservationProducerCache} from '../src/market-observation-producer.mjs';
const source='sha256:'+'a'.repeat(64),base=Date.parse('2026-11-04T01:00:00Z'),iso=n=>new Date(base+n*60000).toISOString();
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
function records(count=12){let hash='GENESIS';return Array.from({length:count},(_,i)=>{
  const record=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',receivedAt:iso(i),...SAFETY,payload:{productFamily:'TX',actualContract:'TXFK6',
    tradeDate:'2026-11-04',session:'DAY',eventTime:iso(i),close:100+i%5,volume:2,tick_type:i%3}},hash);
  hash=record.recordHash;return record;});}
function producer(rows=records()){
  const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source});
  return buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:rows.length,lastVerifiedRecordHash:rows.at(-1).recordHash,
    lastVerifiedStartByteOffset:rows.length*100,lastVerifiedEndByteOffset:rows.length*100+99,canonicalState:canonical.terminalState,
    lastVerifiedAvailableAt:rows.at(-1).receivedAt,rollingCanonicalEvents:canonical.events.map(event=>{const {eventTime,rawRecord,...rest}=event;return rest;})});
}
const wire=p=>Buffer.from(cru34LiveCanonicalJson(p)+'\n');
function fixture(p=producer()){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru61-producer-')),checkpointPath=path.join(root,'source.checkpoint.json'),cacheRoot=path.join(root,'private');
  fs.writeFileSync(checkpointPath,wire(p));return {root,checkpointPath,cacheRoot,calendar};
}
test.afterEach(()=>clearMarketObservationProducerCache());

test('wire verification retains only tail and keeps original and reduced hashes distinct',()=>{
  const p=producer(),bytes=wire(p),result=parseCanonicalProducerTail(bytes,{tailLimit:3});
  assert.equal(result.sourceProof.originalCheckpointHash,p.checkpointHash);assert.equal(result.sourceProof.originalPhysicalSha256,digest(bytes));
  assert.notEqual(result.sourceProof.reducedCheckpointHash,p.checkpointHash);assert.equal(result.checkpoint.rollingCanonicalEvents.length,3);
  assert.equal(result.sourceProof.sourceEventCount,12);assert.equal(result.sourceProof.firstRetainedOrdinal,10);
  validateCru34LiveCheckpoint(result.checkpoint);assert.equal(result.checkpoint.sourceLedgerIdentity,source);
  assert.equal(result.checkpoint.lastVerifiedRecordHash,p.lastVerifiedRecordHash);
});

test('noncanonical syntax, duplicates, unsafe hash mutation and oversized nested structure reject',()=>{
  const p=producer(),bytes=wire(p);
  assert.throws(()=>parseCanonicalProducerTail(Buffer.from(JSON.stringify(p))),/NONCANONICAL/);
  assert.throws(()=>parseCanonicalProducerTail(Buffer.from(bytes.toString().replace('"close":100','"close":999'))),/HASH_INVALID/);
  assert.throws(()=>parseCanonicalProducerTail(Buffer.from(bytes.toString().replace('"formalWeight":0','"formalWeight":0,"formalWeight":0'))),/NONCANONICAL/);
  assert.throws(()=>parseCanonicalProducerTail(Buffer.from('{"a":'+ '['.repeat(34)+'0'+']'.repeat(34)+'}')),/STRUCTURE_BUDGET/);
  assert.throws(()=>parseCanonicalProducerTail(Buffer.from('{"a":"'+'x'.repeat(128*1024)+'"}')),/SCALAR_BUDGET/);
  assert.throws(()=>parseCanonicalProducerTail(Buffer.from(bytes.toString().replace('"volume":2','"volume":2.0'))),/NONCANONICAL/);
  const {checkpointHash,...body}=p,unsafe={...body,executionAuthorized:true};
  assert.throws(()=>parseCanonicalProducerTail(wire({...unsafe,checkpointHash:cru34LiveHash(unsafe)})),/SAFETY_INVALID/);
});

test('reader reuses unchanged metadata, increments overlap once, and JSON disk restart preserves exact origin',()=>{
  const rows=records(15),f=fixture(producer(rows.slice(0,10))),original=fs.readFileSync(f.checkpointPath);
  const first=readMarketObservationProducer({...f,asOf:iso(20)});
  const again=readMarketObservationProducer({...f,asOf:iso(20)});
  assert.equal(again.sourceProgress.readBytes,0);assert.equal(again.sourceProgress.processedRecords,0);assert.deepEqual(again.state,first.state);
  assert.deepEqual(fs.readFileSync(f.checkpointPath),original);
  fs.writeFileSync(f.checkpointPath,wire(producer(rows)));const advanced=readMarketObservationProducer({...f,asOf:iso(20)});
  assert.equal(advanced.sourceProgress.processedRecords,5);assert.equal(advanced.state.segments[0].trades.length,15);
  clearMarketObservationProducerCache();const resumed=readMarketObservationProducer({...f,asOf:iso(20)});
  assert.deepEqual(resumed.state,advanced.state);assert.equal(resumed.sourceProgress.processedRecords,0);assert.ok(resumed.sourceProgress.readBytes>0);
  const snapshot=marketObservationSnapshot(resumed.state,{cutoff:iso(14),mode:'REPLAY'});
  assert.equal(snapshot.profile.totalVolume,30);assert.equal(snapshot.profile.partial,true);assert.equal(snapshot.cvd.value,0);
});

test('cached source never hides missing source, future cutoff or corrupted persisted state',()=>{
  const f=fixture();readMarketObservationProducer({...f,asOf:iso(20)});
  assert.throws(()=>readMarketObservationProducer({...f,asOf:iso(3)}),/CUTOFF_AFTER_REQUEST/);
  clearMarketObservationProducerCache();const privateFile=fs.readdirSync(path.join(f.cacheRoot,'market-observation')).find(name=>name.endsWith('.producer-fragment'));
  const target=path.join(f.cacheRoot,'market-observation',privateFile),bytes=fs.readFileSync(target);bytes[bytes.length-2]^=1;fs.writeFileSync(target,bytes);
  assert.throws(()=>readMarketObservationProducer({...f,asOf:iso(20)}),/CACHE_HASH/);
  fs.unlinkSync(f.checkpointPath);assert.throws(()=>readMarketObservationProducer({...f,asOf:iso(20)}),/ENOENT/);
});

test('staged source verifies without deriving or writing, then matches direct state on the next call',()=>{
  const f=fixture(),original=fs.readFileSync(f.checkpointPath);
  const first=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(first.state,null);assert.equal(first.complete,false);assert.equal(first.reason,'VERIFIED_SOURCE_PENDING_DERIVATION');
  assert.ok(first.sourceProgress.readBytes>0);assert.equal(first.sourceProgress.processedRecords,0);
  assert.equal(fs.existsSync(f.cacheRoot),false);assert.ok(first.sourceProgress.verificationElapsedMs>=0);
  const second=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(second.complete,true);assert.equal(second.sourceProgress.readBytes,0);assert.equal(second.sourceProgress.processedRecords,12);
  assert.equal(second.sourceProgress.stage,'DERIVED_FROM_VERIFIED_SOURCE');assert.ok(second.sourceProgress.derivationElapsedMs>=0);
  assert.deepEqual(fs.readFileSync(f.checkpointPath),original);
  clearMarketObservationProducerCache();const direct=readMarketObservationProducer({...f,cacheRoot:null,asOf:iso(20)});
  assert.deepEqual(second.state,direct.state);
});

test('a changed publication between stages derives known evidence explicitly behind, then catches up without starvation',()=>{
  const f=fixture(producer(records(10)));
  const first=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  fs.writeFileSync(f.checkpointPath,wire(producer(records(15))));
  const changed=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(changed.state.segments[0].trades.length,10);assert.equal(changed.complete,false);assert.equal(changed.sourceProgress.readBytes,0);
  assert.equal(changed.sourceProgress.newerPublicationPending,true);
  assert.equal(changed.sourceProgress.originalCheckpointHash,first.sourceProgress.originalCheckpointHash);
  assert.equal(changed.reason,'PRODUCER_VERIFIED_FRAGMENT_BEHIND_PUBLICATION');
  const verified=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(verified.state,null);assert.notEqual(verified.sourceProgress.originalCheckpointHash,first.sourceProgress.originalCheckpointHash);
  const final=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(final.state.segments[0].trades.length,15);assert.equal(final.sourceProgress.processedRecords,5);
  fs.writeFileSync(f.checkpointPath,wire(producer(records(16))));
  const next=readMarketObservationProducer({...f,asOf:iso(20),staged:true});assert.equal(next.state,null);
  const advanced=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(advanced.state.segments[0].trades.length,16);assert.equal(advanced.sourceProgress.processedRecords,1);
});

test('clearing the worker cache clears pending verification and requires a new bounded first stage',()=>{
  const f=fixture();readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  clearMarketObservationProducerCache();
  const result=readMarketObservationProducer({...f,asOf:iso(20),staged:true});
  assert.equal(result.state,null);assert.equal(result.sourceProgress.stage,'VERIFIED_PENDING_DERIVATION');
  assert.equal(fs.existsSync(f.cacheRoot),false);
  assert.throws(()=>readMarketObservationProducer({...f,asOf:iso(3),staged:true}),/CUTOFF_AFTER_REQUEST/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MarketObservationStore } from '../src/market-observation-store.mjs';
import { SAFETY,stableJson,digest } from '../src/cvd-observation-core.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { buildCru34LiveCheckpoint } from '../src/cru34-live-checkpoint.mjs';
import { updateCanonicalCvdFragment } from '../src/cvd-canonical-fragment.mjs';
import { appendMarketObservationCanonical,marketObservationSnapshot } from '../src/market-observation-core.mjs';

const source='sha256:'+'a'.repeat(64),resolverIdentity='capacity-test',base=Date.parse('2026-11-04T01:00:00Z');
const prices=[100,102,105,103,101,104,107,106,103,99,97,100,103,108,109,104,99,96,98,101];
function fixture(count=prices.length,{step=60000}={}){let hash='GENESIS';const rows=[];
  for(let i=0;i<count;i++)for(const kind of ['futures_bidask','futures_tick']){
    const time=new Date(base+i*step).toISOString(),price=prices[i%prices.length];
    const row=buildLiveEventRecord({kind,code:'TXFK6',receivedAt:time,...SAFETY,payload:{productFamily:'TX',actualContract:'TXFK6',
      tradeDate:'2026-11-04',session:'DAY',eventTime:time,close:price,volume:2,tick_type:i%3,bid_price:[price-1],ask_price:[price]}},hash);
    hash=row.recordHash;rows.push(row);
  }return rows;}
function checkpoint(rows){const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source});
  return buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:rows.length,lastVerifiedRecordHash:rows.at(-1).recordHash,
    lastVerifiedStartByteOffset:rows.length*100,lastVerifiedEndByteOffset:rows.length*100+99,canonicalState:canonical.terminalState,
    lastVerifiedAvailableAt:rows.at(-1).receivedAt,rollingCanonicalEvents:canonical.events});}
function open(){const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru61-store-')),file=path.join(root,'private.observation.sqlite');
  return {file,store:new MarketObservationStore(file,{source,resolverIdentity})};}
function verify(store){let result;do{result=store.verifyStep();}while(!result.complete);}
function append(previous,producer,store=null){const run=()=>{
  const fragment=updateCanonicalCvdFragment(previous?.fragment??null,producer,{resolverIdentity,storage:store});
  const state=appendMarketObservationCanonical(previous?.state??null,fragment,{history:store});
  const result={fragment:fragment.checkpoint,state};if(store)store.checkpoint(result);return result;
};return store?store.transaction(run):run();}
function snap(current,cutoff,store=null,timeframe='1m'){return marketObservationSnapshot(current.state,{cutoff,history:store,timeframe});}

test('repeated initialization failures close the SQLite handle and preserve the original reason',()=>{
  const f=open();f.store.db.exec("UPDATE meta SET hash='corrupted' WHERE key='binding'");f.store.close();
  const close=DatabaseSync.prototype.close,exec=DatabaseSync.prototype.exec;let closed=0;
  DatabaseSync.prototype.close=function(){closed++;return close.call(this);};
  try{
    for(let i=0;i<3;i++)assert.throws(()=>new MarketObservationStore(f.file,{source,resolverIdentity}),/OBSERVATION_STORE_METADATA_HASH/);
    assert.equal(closed,3);
    DatabaseSync.prototype.exec=function(sql){if(sql.startsWith('PRAGMA'))throw Error('INJECTED_PRAGMA_FAILURE');return exec.call(this,sql);};
    assert.throws(()=>new MarketObservationStore(f.file,{source,resolverIdentity}),/INJECTED_PRAGMA_FAILURE/);
    assert.equal(closed,4);
  }finally{DatabaseSync.prototype.close=close;DatabaseSync.prototype.exec=exec;}
});

test('persistent full/chunk/restart preserve every snapshot value and historical event against reference core',()=>{
  const rows=fixture(),full=append(null,checkpoint(rows)),f=open();let stored=null;
  try{
    for(let n=2;n<=rows.length;n+=2)stored=append(stored,checkpoint(rows.slice(0,n)),f.store);
    for(const n of [10,20,rows.length])for(const timeframe of ['1m','5m'])
      assert.deepEqual(snap(stored,rows[n-1].receivedAt,f.store,timeframe),snap(full,rows[n-1].receivedAt,null,timeframe));
    const before=snap(stored,rows.at(-1).receivedAt,f.store);
    f.store.close();f.store=new MarketObservationStore(f.file,{source,resolverIdentity});
    assert.equal(f.store.verified,false);verify(f.store);
    stored=f.store.getMeta('checkpoint');
    assert.deepEqual(snap(stored,rows.at(-1).receivedAt,f.store),before);
    assert.equal(stored.fragment.state.cvd.quotes.length,0);assert.equal(stored.fragment.state.cvd.series.length,1);
    assert.equal(stored.state.segments[0].trades.length,0);assert.equal(stored.state.segments[0].profile.trades.length,0);
    assert.equal(before.profile.tradeCount,prices.length);
  }finally{f.store.close();}
});

test('transaction failure cannot commit quotes, points, source progress or a new CVD origin',()=>{
  const f=open();try{
    const first=append(null,checkpoint(fixture(3)),f.store),before=f.store.getMeta('checkpoint');
    assert.throws(()=>f.store.transaction(()=>{f.store.beginOrigin('different',99);f.store.checkpoint({bad:true});throw Error('INJECTED');}),/INJECTED/);
    assert.deepEqual(f.store.getMeta('checkpoint'),before);
    assert.equal(f.store.origin,before.origin);
    assert.deepEqual(snap(first,fixture(3).at(-1).receivedAt,f.store).profile.totalVolume,6);
  }finally{f.store.close();}
});

test('cutoff ordinal memo observes transaction writes and cannot survive rollback',()=>{
  const f=open();try{
    const rows=fixture(3),stored=append(null,checkpoint(rows),f.store),segment=stored.state.segments[0],cutoff=rows.at(-1).receivedAt;
    const point=f.store.lastPoint(segment,cutoff),ordinal=point.ledgerOrdinal;
    assert.equal(f.store.ordinalAt('points',segment,cutoff),ordinal);
    assert.throws(()=>f.store.transaction(()=>{
      f.store.appendPoint({...point,ledgerOrdinal:ordinal+1});
      assert.equal(f.store.ordinalAt('points',segment,cutoff),ordinal+1);
      f.store.appendPoint({...point,ledgerOrdinal:ordinal+2});
      assert.equal(f.store.ordinalAt('points',segment,cutoff),ordinal+2);
      throw Error('INJECTED_ROLLBACK');
    }),/INJECTED_ROLLBACK/);
    assert.equal(f.store.ordinalAt('points',segment,cutoff),ordinal);
    assert.deepEqual(f.store.lastPoint(segment,cutoff),point);
  }finally{f.store.close();}
});

test('latest physical ordinal avoids a full availability scan and preserves backdated and future cutoffs',()=>{
  const f=open();try{
    const rows=fixture(3),stored=append(null,checkpoint(rows),f.store),segment=stored.state.segments[0];
    const point=f.store.lastPoint(segment,rows.at(-1).receivedAt);
    const trade=f.store.tradeEndpoints(segment,rows.at(-1).receivedAt).at(-1);
    // Cold reopening removes the exact-cutoff memo. A latest snapshot must not
    // need a scan of every older availability entry just to find its endpoint.
    f.store.close();f.store=new MarketObservationStore(f.file,{source,resolverIdentity});verify(f.store);
    const statement=f.store.statement.bind(f.store);let allowPrefix=false,prefixReads=0;
    f.store.statement=sql=>{
      if(sql.startsWith('SELECT MAX(ordinal) AS ordinal')){
        prefixReads++;assert.ok(allowPrefix,'LATEST_ENDPOINT_REQUIRES_FULL_AVAILABILITY_SCAN');
      }
      return statement(sql);
    };
    for(const table of ['points','trades'])assert.equal(f.store.ordinalAt(table,segment,rows.at(-1).receivedAt),6);
    assert.equal(prefixReads,0);
    const at=minute=>new Date(base+minute*60000).toISOString();
    f.store.transaction(()=>{
      f.store.appendPoint({...point,ledgerOrdinal:7,availableAt:at(0)});
      f.store.appendTrade(segment,{...trade,ledgerOrdinal:7,availableAt:at(0),eventTime:at(0)});
      for(const table of ['points','trades'])assert.equal(f.store.ordinalAt(table,segment,at(1)),7);
    });
    f.store.transaction(()=>{
      f.store.appendPoint({...point,ledgerOrdinal:8,availableAt:at(3)});
      f.store.appendTrade(segment,{...trade,ledgerOrdinal:8,availableAt:at(3),eventTime:at(3)});
    });
    // The physical tail is now later than this historical cutoff. The answer
    // remains ordinal 7, not the record with the closest earlier timestamp.
    allowPrefix=true;
    for(const table of ['points','trades']){
      assert.equal(f.store.ordinalAt(table,segment,at(1)),7);
      assert.equal(f.store.ordinalAt(table,segment,at(-1)),0);
    }
    assert.ok(prefixReads>0);
    f.store.transaction(()=>f.store.appendPoint({...point,ledgerOrdinal:9,availableAt:null}));
    assert.equal(f.store.ordinalAt('points',segment,at(4)),8);
    f.store.close();f.store=new MarketObservationStore(f.file,{source,resolverIdentity});verify(f.store);
    for(const table of ['points','trades'])assert.equal(f.store.ordinalAt(table,segment,at(1)),7);
    assert.equal(f.store.ordinalAt('points',segment,at(4)),8);
  }finally{f.store.close();}
});

test('indexed quote selection retains physically older eligible quote for a late tick and identity-return boundary',()=>{
  const rows=fixture(4,{step:1000}),canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source}).events,f=open();
  try{f.store.transaction(()=>{f.store.beginOrigin(source,1);for(const event of canonical)if(event.kind==='futures_bidask')f.store.appendQuote(event);});
    const tick={...canonical.at(-1),eventMs:base+500,ledgerOrdinal:99,availableMs:base+4000};
    assert.equal(f.store.quoteFor(tick).ledgerOrdinal,1);
    assert.equal(f.store.quoteFor({...tick,continuityEpoch:'TX:2'}),null);
    assert.equal(f.store.quoteFor({...tick,availableMs:base-1}),null);
    assert.equal(f.store.quoteFor({...tick,eventMs:base+99999}),null);
  }finally{f.store.close();}
});

test('persistent snapshot state stays bounded beyond the old 25000 quote lifecycle stop',()=>{
  const f=open();let current=null;const count=26000,rows=fixture(count,{step:10});
  // One materialization retains raw physical semantics; snapshots contain only
  // the rolling suffix and the existing last-tick overlap witness.
  const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:source});
  try{
    for(let n=2000;n<=rows.length;n+=2000){
      const producer=buildCru34LiveCheckpoint({sourceLedgerIdentity:source,lastVerifiedLedgerOrdinal:n,lastVerifiedRecordHash:rows[n-1].recordHash,
        lastVerifiedStartByteOffset:n*100,lastVerifiedEndByteOffset:n*100+99,canonicalState:canonical.terminalState,
        lastVerifiedAvailableAt:rows[n-1].receivedAt,rollingCanonicalEvents:canonical.events.slice(Math.max(0,n-4000),n)});
      current=append(current,producer,f.store);
    }
    assert.equal(current.fragment.state.cvd.segments[0].tickCount,count);
    assert.equal(current.fragment.state.originOrdinal,1);assert.equal(current.state.segments[0].profile.tradeCount,count);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM quotes').get().n,count);
    assert.equal(f.store.db.prepare('SELECT COUNT(*) AS n FROM trades').get().n,count);
    assert.ok(Buffer.byteLength(stableJson(current))<200000);
    const result=snap(current,rows.at(-1).receivedAt,f.store);assert.equal(result.profile.totalVolume,count*2);
    assert.equal(result.cvd.unknownVolume,Math.ceil(count/3)*2);assert.ok(result.cvd.series.length<10);
    const expected=digest(stableJson(result));f.store.close();f.store=new MarketObservationStore(f.file,{source,resolverIdentity});verify(f.store);
    assert.equal(digest(stableJson(snap(f.store.getMeta('checkpoint'),rows.at(-1).receivedAt,f.store))),expected);
  }finally{f.store.close();}
});

test('derived historical mutation and deletion are rejected by append chunk receipts on restart',()=>{
  for(const sql of ['UPDATE trades SET volume=volume+1 WHERE ordinal=2','DELETE FROM points WHERE ordinal=2','DELETE FROM minutes','DELETE FROM profiles']){
    const f=open();try{append(null,checkpoint(fixture(4)),f.store);f.store.db.exec(sql);
      assert.throws(()=>verify(f.store),/(HISTORY|INDEX)_HASH/);
    }finally{f.store.close();}
  }
});

test('deleting an integrity root cannot turn an existing corrupted store into a fresh trusted database',()=>{
  for(const root of ['integrity','indexes','binding']){
    const f=open();append(null,checkpoint(fixture(4)),f.store);
    assert.ok(f.store.getMeta('integrity').length>0);
    f.store.db.prepare('DELETE FROM meta WHERE key=?').run(root);
    f.store.db.exec('UPDATE trades SET volume=volume+1 WHERE ordinal=2');f.store.close();
    assert.throws(()=>new MarketObservationStore(f.file,{source,resolverIdentity}),/INTEGRITY_ROOT_MISSING/);
  }
});

test('receivedAt regression, invalid continuation and reconnect preserve physical CVD order and prefix truth',()=>{
  const sourceRows=fixture(5),rows=[];let hash='GENESIS';
  const push=body=>{const record=buildLiveEventRecord(body,hash);hash=record.recordHash;rows.push(record);};
  for(const raw of sourceRows){const {recordHash,previousHash,...body}=raw;push(body);}
  for(const minute of [0,1]){const {recordHash,previousHash,...body}=sourceRows.at(-1);push({...body,receivedAt:new Date(base+minute*60000).toISOString()});}
  push({kind:'quote_type_resubscribe',code:'TXFK6',receivedAt:new Date(base+6*60000).toISOString(),...SAFETY,payload:{product:'TX'}});
  for(const raw of fixture(2).map(row=>({...row,receivedAt:new Date(base+7*60000).toISOString(),payload:{...row.payload,eventTime:new Date(base+7*60000).toISOString()}}))){
    const {recordHash,previousHash,...body}=raw;push(body);
  }
  const full=append(null,checkpoint(rows)),f=open();let current=null;
  try{for(let n=1;n<=rows.length;n++)current=append(current,checkpoint(rows.slice(0,n)),f.store);
    for(const minute of [0,2,4,7])assert.deepEqual(snap(current,new Date(base+minute*60000).toISOString(),f.store),snap(full,new Date(base+minute*60000).toISOString()));
  }finally{f.store.close();}
});

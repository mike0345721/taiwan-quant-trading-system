import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import crypto from 'node:crypto';
import { digest, stableJson,stableJsonDigest } from './cvd-observation-core.mjs';
import { evaluateBestQuoteEligibility } from './tx-intraday-pressure-path-efficiency.mjs';
import { createMarketStructureState,appendMarketStructureBars,marketStructureSnapshot } from './market-structure-core.mjs';

// Private, reproducible derivatives only. Never open the official research DB.
// SQLite keeps its page cache at 8 MiB; history lives on disk, not in V8 arrays.
export const OBSERVATION_STORE_VERSION='cru61-observation-store-v1';
const identity=e=>stableJson([e.sourceLedgerIdentity,e.actualContract,e.tradeDate,e.session,e.continuityEpoch]);
const parse=row=>row?JSON.parse(row.json):null;
const iso=ms=>new Date(ms).toISOString();
const columns={quotes:'origin,ordinal,identity,event_ms,at,json',points:'origin,ordinal,segment,at,minute,buy,sell,unknown,total,valid,json',
  trades:'origin,ordinal,segment,event_ms,at,price,volume,bin,json',reasons:'origin,ordinal,segment,at,code'};
const fileStamp=file=>{const s=fs.statSync(file,{bigint:true});return `${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;};
// Logical input JSON payload limits, not SQLite page/journal I/O or the small
// integrity/index metadata written by the enclosing transaction.
export const INPUT_STAGE_LIMITS=Object.freeze({chunks:2,bytes:2*1024*1024,chunkBytes:1024*1024,chunkEvents:1000});
const inputKey=(generation,index)=>`pending-input-${generation}-${index}`;
const inputAnchor=event=>event?{ordinal:event.ledgerOrdinal,hash:event.recordHash}:null;
export class MarketObservationStore {
  constructor(file,binding){
    if(!path.isAbsolute(file)||!file.endsWith('.observation.sqlite'))throw Error('OBSERVATION_STORE_PATH_INVALID');
    let DatabaseSync;
    try{({DatabaseSync}=createRequire(import.meta.url)('node:sqlite'));}
    catch{throw Error('OBSERVATION_STORE_REQUIRES_NODE_22_13_OR_NEWER');}
    fs.mkdirSync(path.dirname(file),{recursive:true});
    if(fs.existsSync(file)&&(!fs.lstatSync(file).isFile()||fs.lstatSync(file).isSymbolicLink()))throw Error('OBSERVATION_STORE_PATH_INVALID');
    this.db=new DatabaseSync(file);this.file=file;this.statements=new Map();this.origin=null;
    try {
    this.db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192;
      PRAGMA temp_store=FILE; PRAGMA mmap_size=0; PRAGMA busy_timeout=1000; PRAGMA max_page_count=4194304;`);
    try{this.db.exec(`BEGIN IMMEDIATE;
      CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY,json TEXT NOT NULL,hash TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS quotes(origin TEXT,ordinal INTEGER,identity TEXT,event_ms INTEGER,at INTEGER,json TEXT,
        PRIMARY KEY(origin,ordinal));
      CREATE INDEX IF NOT EXISTS quote_time ON quotes(origin,identity,event_ms,ordinal);
      CREATE TABLE IF NOT EXISTS points(origin TEXT,ordinal INTEGER,segment INTEGER,at INTEGER,minute INTEGER,
        buy REAL,sell REAL,unknown REAL,total REAL,valid INTEGER,json TEXT,PRIMARY KEY(origin,ordinal));
      CREATE INDEX IF NOT EXISTS point_time ON points(origin,segment,at,ordinal);
      CREATE INDEX IF NOT EXISTS point_ordinal ON points(origin,segment,ordinal);
      CREATE TABLE IF NOT EXISTS minutes(origin TEXT,segment INTEGER,minute INTEGER,ordinal INTEGER,first_ordinal INTEGER,json TEXT,hash TEXT,
        PRIMARY KEY(origin,segment,minute));
      CREATE TABLE IF NOT EXISTS trades(origin TEXT,ordinal INTEGER,segment INTEGER,event_ms INTEGER,at INTEGER,
        price REAL,volume REAL,bin INTEGER,json TEXT,PRIMARY KEY(origin,ordinal));
      CREATE INDEX IF NOT EXISTS trade_time ON trades(origin,segment,event_ms,at,ordinal);
      CREATE INDEX IF NOT EXISTS trade_available ON trades(origin,segment,at,ordinal);
      CREATE INDEX IF NOT EXISTS trade_ordinal ON trades(origin,segment,ordinal);
      CREATE TABLE IF NOT EXISTS profiles(origin TEXT,segment INTEGER,at INTEGER,ordinal INTEGER,json TEXT,hash TEXT,
        PRIMARY KEY(origin,segment,at));
      CREATE TABLE IF NOT EXISTS reasons(origin TEXT,ordinal INTEGER,segment INTEGER,at INTEGER,code TEXT,PRIMARY KEY(origin,ordinal,code)); COMMIT;`);
    }catch(error){try{this.db.exec('ROLLBACK');}catch{}throw error;}
    const expected={version:OBSERVATION_STORE_VERSION,...binding},old=this.getMeta('binding'),checkpoint=this.getMeta('checkpoint');
    const integrity=this.getMeta('integrity'),indexes=this.getMeta('indexes');
    if((checkpoint&&(!old||!integrity||!indexes))||(!integrity&&Object.keys(columns).some(table=>
      this.statement(`SELECT 1 FROM ${table} LIMIT 1`).get())))throw Error('OBSERVATION_STORE_INTEGRITY_ROOT_MISSING');
    if(old&&stableJson(old)!==stableJson(expected))throw Error('OBSERVATION_STORE_BINDING_MISMATCH');
    if(!old)this.setMeta('binding',expected);
    this.origin=this.getMeta('pending-derivation')?.origin??this.getMeta('legacy-migration')?.origin??checkpoint?.origin??null;
    this.receipts=integrity??[];this.verifyCursor=0;this.verified=!checkpoint&&this.receipts.length===0;
    this.indexes=indexes??{minutes:{hash:'0'.repeat(64),count:0},profiles:{hash:'0'.repeat(64),count:0}};
    this.indexVerification=null;
    this.knownStamp=fileStamp(this.file);
    this.knownDataVersion=this.dataVersion();
    } catch(error) {try{this.db.close();}catch{}throw error;}
  }
  statement(sql){if(!this.statements.has(sql))this.statements.set(sql,this.db.prepare(sql));return this.statements.get(sql);}
  dataVersion(){return this.statement('PRAGMA data_version').get().data_version;}
  getMeta(key){const row=this.statement('SELECT json,hash FROM meta WHERE key=?').get(key);
    if(!row)return null;if(digest(row.json)!==row.hash)throw Error('OBSERVATION_STORE_METADATA_HASH');return JSON.parse(row.json);}
  setMeta(key,value){const json=JSON.stringify(value);if(Buffer.byteLength(json)>16*1024*1024)throw Error('OBSERVATION_STORE_METADATA_BUDGET');
    this.statement('INSERT OR REPLACE INTO meta VALUES(?,?,?)').run(key,json,digest(json));}
  deleteMeta(key){this.statement('DELETE FROM meta WHERE key=?').run(key);}
  stageSource(source){
    const {rollingCanonicalEvents,...checkpoint}=source.checkpoint;
    const chunks=Math.ceil(rollingCanonicalEvents.length/1000);
    for(let n=0;n<chunks;n++)this.setMeta(`pending-source-${n}`,rollingCanonicalEvents.slice(n*1000,(n+1)*1000));
    this.setMeta('pending-source',{...source,checkpoint,chunks});
  }
  inputStage(){const header=this.getMeta('pending-input');
    if(header&&header.generation!==this.inputGeneration(header.source))throw Error('OBSERVATION_INPUT_GENERATION_BINDING');
    return header;}
  inputGeneration(source){return digest(stableJson({binding:this.getMeta('binding'),
    physicalHash:source.sourceProof.originalPhysicalSha256,checkpointHash:source.checkpoint.checkpointHash}));}
  inputHeader(source){const {rollingCanonicalEvents:events,...checkpoint}=source.checkpoint;
    return {format:'bounded-input-v1',state:'STAGING',generation:this.inputGeneration(source),source:{...source,checkpoint},
      totalEvents:events.length,nextEvent:0,chunks:[],firstEvent:inputAnchor(events[0]),lastEvent:inputAnchor(events.at(-1))};}
  stageSourceStep(source){
    if(!this.pendingIntegrity)throw Error('OBSERVATION_STORE_TRANSACTION_REQUIRED');
    const generation=this.inputGeneration(source),events=source.checkpoint.rollingCanonicalEvents;
    let header=this.inputStage();
    if(header&&header.generation!==generation)throw Error('OBSERVATION_INPUT_STAGE_SOURCE_CHANGED');
    if(!header)header=this.inputHeader(source);
    if(header.state!=='STAGING'||header.totalEvents!==events.length||header.nextEvent>events.length)throw Error('OBSERVATION_INPUT_STAGE_INVALID');
    let written=0,count=0;
    // Reserve the final header and two new descriptors before spending bytes on
    // rows. The header itself is part of this request's persistence budget.
    const reserve=Buffer.byteLength(JSON.stringify(header))+2048;
    if(reserve>INPUT_STAGE_LIMITS.bytes)throw Error('OBSERVATION_INPUT_HEADER_BUDGET');
    while(header.nextEvent<events.length&&count<INPUT_STAGE_LIMITS.chunks){
      const chunk={generation,index:header.chunks.length,start:header.nextEvent,events:[]};
      let bytes=Buffer.byteLength(JSON.stringify(chunk));
      const limit=Math.min(INPUT_STAGE_LIMITS.chunkBytes,INPUT_STAGE_LIMITS.bytes-reserve-written);
      while(header.nextEvent+chunk.events.length<events.length&&chunk.events.length<INPUT_STAGE_LIMITS.chunkEvents){
        const event=events[header.nextEvent+chunk.events.length],size=Buffer.byteLength(JSON.stringify(event))+(chunk.events.length?1:0);
        if(bytes+size>limit)break;chunk.events.push(event);bytes+=size;
      }
      if(!chunk.events.length){if(!count)throw Error('OBSERVATION_INPUT_EVENT_BUDGET');break;}
      const json=JSON.stringify(chunk);if(Buffer.byteLength(json)!==bytes)throw Error('OBSERVATION_INPUT_BYTE_ACCOUNTING');
      this.setMeta(inputKey(generation,chunk.index),chunk);
      header.chunks.push({index:chunk.index,start:chunk.start,count:chunk.events.length,bytes,hash:digest(json)});
      header.nextEvent+=chunk.events.length;written+=bytes;count++;
    }
    const complete=header.nextEvent===header.totalEvents;
    if(complete){header.state='READY';this.setMeta('pending-source',header);this.deleteMeta('pending-input');}
    else this.setMeta('pending-input',header);
    written+=Buffer.byteLength(JSON.stringify(header));
    if(written>INPUT_STAGE_LIMITS.bytes)throw Error('OBSERVATION_INPUT_WRITE_BUDGET');
    return {complete,generation,persistedEvents:header.nextEvent,totalEvents:header.totalEvents,
      persistedChunks:header.chunks.length,writtenChunks:count,writtenBytes:written,
      writeMeasurement:'LOGICAL_INPUT_JSON_BYTES_EXCLUDES_SQLITE_IO_AND_INTEGRITY_METADATA'};
  }
  inputChunk(header,part){
    const chunk=this.getMeta(inputKey(header.generation,part.index));
    if(!chunk||chunk.generation!==header.generation||chunk.index!==part.index||chunk.start!==part.start
      ||!Array.isArray(chunk.events)||chunk.events.length!==part.count
      ||digest(JSON.stringify(chunk))!==part.hash)throw Error('OBSERVATION_INPUT_CHUNK_INVALID');
    return chunk.events;
  }
  abandonInput(replacementSource){
    const header=this.inputStage();if(!header)return;
    if(this.getMeta('pending-derivation')||this.getMeta('pending-source'))throw Error('OBSERVATION_INPUT_ALREADY_DERIVING');
    const replacement=this.inputHeader(replacementSource),replacementGeneration=replacement.generation;
    this.setMeta(`input-abandoned-${header.generation}`,{...header,state:'ABANDONED',replacementGeneration});
    this.queueInputCleanup(header);this.setMeta('pending-input',replacement);
  }
  queueInputCleanup(header){
    if(this.getMeta('pending-source-cleanup'))throw Error('OBSERVATION_INPUT_CLEANUP_BUSY');
    const legacy=header.format!=='bounded-input-v1';
    const chunks=legacy?Array.from({length:header.chunks},(_,index)=>{const key=`pending-source-${index}`;
      return {key,bytes:this.statement('SELECT length(CAST(json AS BLOB)) bytes FROM meta WHERE key=?').get(key)?.bytes??0};}):
      header.chunks.map(part=>({key:inputKey(header.generation,part.index),bytes:part.bytes}));
    this.setMeta('pending-source-cleanup',{generation:header.generation??digest(stableJson(header)),legacy,next:0,chunks});
  }
  cleanupSourceStep(){
    const cleanup=this.getMeta('pending-source-cleanup');if(!cleanup)return {complete:true,deletedChunks:0,deletedBytes:0};
    let count=0,bytes=0,retainedChunks=0,retainedBytes=0;const reserve=Buffer.byteLength(JSON.stringify(cleanup))+2048;
    while(cleanup.next<cleanup.chunks.length&&count<INPUT_STAGE_LIMITS.chunks){
      const part=cleanup.chunks[cleanup.next],row=this.statement('SELECT length(CAST(json AS BLOB)) bytes FROM meta WHERE key=?').get(part.key);
      if(row&&row.bytes!==part.bytes)throw Error('OBSERVATION_INPUT_CLEANUP_SIZE');
      if(cleanup.legacy&&part.bytes+reserve>INPUT_STAGE_LIMITS.bytes){
        // Existing caches allowed 16 MiB per row. Retain that derivative with
        // a receipt rather than exceeding the new budget or blocking forever.
        this.setMeta(`input-cleanup-retained-${cleanup.generation}-${cleanup.next}`,
          {state:'DEFERRED_RETAINED',generation:cleanup.generation,key:part.key,bytes:part.bytes,reason:'LEGACY_CHUNK_EXCEEDS_CLEANUP_BUDGET'});
        cleanup.next++;count++;retainedChunks++;retainedBytes+=part.bytes;continue;
      }
      if(bytes+part.bytes+reserve>INPUT_STAGE_LIMITS.bytes)break;
      this.deleteMeta(part.key);cleanup.next++;count++;bytes+=part.bytes;
    }
    const complete=cleanup.next===cleanup.chunks.length;
    if(complete)this.deleteMeta('pending-source-cleanup');else this.setMeta('pending-source-cleanup',cleanup);
    return {complete,deletedChunks:count-retainedChunks,deletedBytes:bytes,retainedChunks,retainedBytes};
  }
  pendingSource(){const header=this.getMeta('pending-source');if(!header)return null;
    if(header.format==='bounded-input-v1'){
      if(header.generation!==this.inputGeneration(header.source))throw Error('OBSERVATION_INPUT_GENERATION_BINDING');
      if(header.state!=='READY'||header.nextEvent!==header.totalEvents)throw Error('OBSERVATION_INPUT_NOT_READY');
      const events=[];for(const [index,part] of header.chunks.entries()){
        if(part.index!==index||part.start!==events.length)throw Error('OBSERVATION_INPUT_CHUNK_ORDER');
        events.push(...this.inputChunk(header,part));}
      if(events.length!==header.totalEvents)throw Error('OBSERVATION_INPUT_EVENT_COUNT');
      const checkpoint={...header.source.checkpoint,rollingCanonicalEvents:events},{checkpointHash,...body}=checkpoint;
      if(stableJsonDigest(body)!==checkpointHash)throw Error('OBSERVATION_INPUT_CHECKPOINT_HASH');
      return {...header.source,checkpoint};
    }
    const events=[];for(let n=0;n<header.chunks;n++){const rows=this.getMeta(`pending-source-${n}`);if(!rows)throw Error('OBSERVATION_PENDING_SOURCE_MISSING');events.push(...rows);}
    const {chunks,...source}=header;return {...source,checkpoint:{...header.checkpoint,rollingCanonicalEvents:events}};}
  clearPending(){const header=this.getMeta('pending-source');
    if(header)this.queueInputCleanup(header);
    this.deleteMeta('pending-source');this.deleteMeta('pending-derivation');}
  transaction(fn){this.assertVerified();this.db.exec('BEGIN IMMEDIATE');
    // The write lock closes the gap after verifyStep. Another connection's
    // commit must not be absorbed into our own post-COMMIT file stamp, thereby
    // reviving a resident input proof. Leave the old baseline for revalidation.
    try{if(this.dataVersion()!==this.knownDataVersion)throw Error('OBSERVATION_STORE_CHANGED_BEFORE_TRANSACTION');}
    catch(error){this.db.exec('ROLLBACK');throw error;}
    const origin=this.origin;
    this.pendingIntegrity={};this.pendingIndexes=structuredClone(this.indexes);
    try{const value=fn(),next=[...this.receipts];
      for(const [table,items] of Object.entries(this.pendingIntegrity))for(const item of items)next.push({table,origin:item.origin,start:item.start,end:item.end,count:item.count,hash:item.hash.digest('hex')});
      if(next.length!==this.receipts.length||!this.getMeta('integrity'))this.setMeta('integrity',next);
      this.setMeta('indexes',this.pendingIndexes);
      this.db.exec('COMMIT');this.ordinalCache?.clear();this.receipts=next;this.indexes=this.pendingIndexes;this.verifyCursor=next.length;this.knownStamp=fileStamp(this.file);return value;
    }catch(error){this.db.exec('ROLLBACK');this.origin=origin;this.knownStamp=fileStamp(this.file);throw error;}
    finally{this.ordinalCache?.clear();this.pendingIntegrity=null;this.pendingIndexes=null;}}
  track(table,values){
    if(!this.pendingIntegrity)throw Error('OBSERVATION_STORE_TRANSACTION_REQUIRED');
    const items=(this.pendingIntegrity[table] ??= []),line=JSON.stringify(values)+'\n',bytes=Buffer.byteLength(line);
    let item=items.at(-1);
    if(!item||item.count>=2000||item.bytes+bytes>2*1024*1024){item={origin:values[0],start:values[1],end:values[1],count:0,bytes:0,hash:crypto.createHash('sha256')};items.push(item);}
    if(item.origin!==values[0]||values[1]<item.end)throw Error('OBSERVATION_STORE_APPEND_ORDER');
    item.end=values[1];item.count++;item.bytes+=bytes;item.hash.update(line);return values;
  }
  updateIndex(table,row,old){if(!this.pendingIndexes)throw Error('OBSERVATION_STORE_TRANSACTION_REQUIRED');
    const index=this.pendingIndexes[table],hash=digest(stableJson(row));
    index.hash=(BigInt('0x'+index.hash)^BigInt('0x'+hash)^BigInt('0x'+(old?.hash??'0'))).toString(16).padStart(64,'0');
    if(!old)index.count++;return hash;}
  assertVerified(){if(!this.verified)throw Error('OBSERVATION_DERIVED_HISTORY_VERIFYING');}
  verifyStep(){
    const stamp=fileStamp(this.file),dataVersion=this.dataVersion();
    if(stamp!==this.knownStamp||dataVersion!==this.knownDataVersion){this.ordinalCache?.clear();this.receipts=this.getMeta('integrity')??[];this.indexes=this.getMeta('indexes');this.verifyCursor=0;this.indexVerification=null;this.verified=false;this.knownStamp=stamp;this.knownDataVersion=dataVersion;}
    if(this.verified)return {complete:true,verifiedChunks:this.verifyCursor,totalChunks:this.receipts.length};
    const deadline=performance.now()+750;let verifiedRows=0;
    do{
    const receipt=this.receipts[this.verifyCursor];
    if(receipt){
      if(!Object.hasOwn(columns,receipt.table))throw Error('OBSERVATION_STORE_INTEGRITY_SCHEMA');
      const hash=crypto.createHash('sha256');let count=0;
      for(const row of this.statement(`SELECT ${columns[receipt.table]} FROM ${receipt.table} WHERE origin=? AND ordinal BETWEEN ? AND ? ORDER BY ordinal`).iterate(receipt.origin,receipt.start,receipt.end)){
        hash.update(JSON.stringify(Object.values(row))+'\n');count++;
      }
      if(count!==receipt.count||hash.digest('hex')!==receipt.hash)throw Error('OBSERVATION_STORE_HISTORY_HASH');
      this.verifyCursor++;verifiedRows+=count;
    }
    if(this.verifyCursor===this.receipts.length){
      this.indexVerification??={table:0,rowid:0,count:0,hash:0n};
      const current=this.indexVerification,tables=['minutes','profiles'];
      if(current.table<tables.length){
        const table=tables[current.table],rows=this.statement(`SELECT rowid AS verification_rowid,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 16`).all(current.rowid);
        for(const raw of rows){const {verification_rowid,...row}=raw;this.checked(row);current.hash^=BigInt('0x'+row.hash);current.count++;current.rowid=verification_rowid;}
        verifiedRows+=rows.length;
        if(rows.length<16){const expected=this.indexes[table];
          if(current.count!==expected.count||current.hash.toString(16).padStart(64,'0')!==expected.hash)throw Error('OBSERVATION_STORE_INDEX_HASH');
          current.table++;current.rowid=0;current.count=0;current.hash=0n;
        }
      }
      if(current.table===tables.length){
        for(const table of Object.keys(columns)){
          const expected=this.receipts.filter(r=>r.table===table).reduce((sum,r)=>sum+r.count,0);
          if(this.statement(`SELECT COUNT(*) AS count FROM ${table}`).get().count!==expected)throw Error('OBSERVATION_STORE_HISTORY_COUNT');
        }
        this.verified=true;
      }
    }
    }while(!this.verified&&verifiedRows<20000&&performance.now()<deadline);
    return {complete:this.verified,verifiedChunks:this.verifyCursor,totalChunks:this.receipts.length,verifiedRows};
  }
  checked(row){if(row&&digest(stableJson(Object.fromEntries(Object.entries(row).filter(([k])=>k!=='hash'))))!==row.hash)throw Error('OBSERVATION_STORE_INDEX_HASH');return row;}
  beginOrigin(source,ordinal){this.origin=digest(stableJson({source,ordinal}));}
  appendQuote(event){
    if(event.identityStatus!=='USABLE'||event.availabilityLineageStatus!=='USABLE'||!event.recordHash
      ||![event.eventMs,event.availableMs,event.ledgerOrdinal].every(Number.isFinite))return;
    const {rawRecord,...stored}=event;
    this.statement('INSERT INTO quotes VALUES(?,?,?,?,?,?)').run(...this.track('quotes',[this.origin,event.ledgerOrdinal,identity(event),event.eventMs,event.availableMs,JSON.stringify(stored)]));
  }
  quoteFor(tick){
    this.assertVerified();
    if(tick.identityStatus!=='USABLE'||tick.availabilityLineageStatus!=='USABLE'||tick.joinedContinuityStatus!=='USABLE'
      ||![tick.eventMs,tick.availableMs,tick.ledgerOrdinal].every(Number.isFinite))return null;
    const row=this.statement(`SELECT json FROM quotes WHERE origin=? AND identity=? AND event_ms BETWEEN ? AND ?
      AND at<=? AND ordinal<? ORDER BY ordinal DESC LIMIT 1`).get(this.origin,identity(tick),tick.eventMs-2000,tick.eventMs,tick.availableMs,tick.ledgerOrdinal);
    const quote=parse(row);return quote&&evaluateBestQuoteEligibility(quote,tick).eligible?quote:null;
  }
  appendPoint(point){
    const prior=parse(this.statement('SELECT json FROM points WHERE origin=? AND segment=? ORDER BY ordinal DESC LIMIT 1').get(this.origin,point.segment));
    const at=Date.parse(point.availableAt),minute=Math.floor(at/60000),json=JSON.stringify(point);
    // Invalid timestamp points are retained with a sentinel time and never enter
    // an as-of query. Their cumulative UNKNOWN/quality still travels in the core.
    const knownAt=Number.isFinite(at)?at:Number.MAX_SAFE_INTEGER;
    this.statement('INSERT INTO points VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(...this.track('points',[this.origin,point.ledgerOrdinal,point.segment,knownAt,
      Number.isFinite(minute)?minute:Number.MAX_SAFE_INTEGER,
      point.buyProxyVolume-(prior?.buyProxyVolume??0),point.sellProxyVolume-(prior?.sellProxyVolume??0),
      point.unknownVolume-(prior?.unknownVolume??0),point.totalExecutedVolume-(prior?.totalExecutedVolume??0),point.value===null?0:1,json]));
    if(Number.isFinite(at)){
      const old=this.checked(this.statement('SELECT * FROM minutes WHERE origin=? AND segment=? AND minute=?').get(this.origin,point.segment,minute));
      const row={origin:this.origin,segment:point.segment,minute,ordinal:point.ledgerOrdinal,first_ordinal:old?.first_ordinal??point.ledgerOrdinal,json};
      this.statement('INSERT OR REPLACE INTO minutes VALUES(?,?,?,?,?,?,?)').run(...Object.values(row),this.updateIndex('minutes',row,old));
    }
  }
  pointFor(ordinal){return parse(this.statement('SELECT json FROM points WHERE origin=? AND ordinal=?').get(this.origin,ordinal));}
  ordinalAt(table,segment,cutoff){
    this.assertVerified();if(!['trades','points'].includes(table))throw Error('OBSERVATION_ORDINAL_TABLE_INVALID');
    const at=Date.parse(cutoff),key=stableJson([table,this.origin,segment.cvdSegment,at]);this.ordinalCache??=new Map();
    const cacheable=!this.pendingIntegrity;
    if(cacheable&&this.ordinalCache.has(key))return this.ordinalCache.get(key);
    // If the physical last row is already available, it is also the maximum
    // eligible ordinal. This indexed endpoint lookup avoids scanning the entire
    // availability prefix for the current snapshot, even after a cold restart.
    // Future/invalid tails and historical cutoffs retain the exact prefix query;
    // receivedAt order must never be assumed to equal physical order.
    const ordinalIndex=table==='trades'?'trade_ordinal':'point_ordinal';
    const last=this.statement(`SELECT ordinal,at FROM ${table} INDEXED BY ${ordinalIndex} WHERE origin=? AND segment=? ORDER BY ordinal DESC LIMIT 1`)
      .get(this.origin,segment.cvdSegment);
    const index=table==='trades'?'trade_available':'point_time';
    const ordinal=Number.isSafeInteger(last?.ordinal)&&Number.isSafeInteger(last?.at)&&last.at<=at?last.ordinal:
      this.statement(`SELECT MAX(ordinal) AS ordinal FROM ${table} INDEXED BY ${index} WHERE origin=? AND segment=? AND at<=?`)
      .get(this.origin,segment.cvdSegment,at).ordinal??0;
    if(cacheable){this.ordinalCache.set(key,ordinal);while(this.ordinalCache.size>256)this.ordinalCache.delete(this.ordinalCache.keys().next().value);}
    return ordinal;
  }
  segmentFirstOrdinal(segment){
    this.assertVerified();return this.statement('SELECT ordinal FROM points INDEXED BY point_ordinal WHERE origin=? AND segment=? ORDER BY ordinal LIMIT 1')
      .get(this.origin,segment.cvdSegment)?.ordinal??null;
  }
  segmentLastOrdinal(segment,ceiling=Number.MAX_SAFE_INTEGER,origin=this.origin){
    this.assertVerified();return this.statement('SELECT ordinal FROM points INDEXED BY point_ordinal WHERE origin=? AND segment=? AND ordinal<=? ORDER BY ordinal DESC LIMIT 1')
      .get(origin,segment.cvdSegment,ceiling)?.ordinal??null;
  }
  pointKnowledgeOrdinalAt(segment,cutoff,physicalBound=Number.MAX_SAFE_INTEGER){
    this.assertVerified();if(!Number.isSafeInteger(physicalBound)||physicalBound<0)throw Error('OBSERVATION_KNOWLEDGE_BOUND_INVALID');
    const at=Date.parse(cutoff),key=stableJson(['point-knowledge',this.origin,segment.cvdSegment,at,physicalBound]);
    this.ordinalCache??=new Map();const cacheable=!this.pendingIntegrity;
    if(cacheable&&this.ordinalCache.has(key))return this.ordinalCache.get(key);
    // A cumulative point after the first physically later-than-cutoff trade
    // cannot become historical evidence merely because its own clock regressed.
    const future=this.statement('SELECT MIN(ordinal) AS ordinal FROM points INDEXED BY point_time WHERE origin=? AND segment=? AND at>?')
      .get(this.origin,segment.cvdSegment,at).ordinal;
    const bound=Math.min(physicalBound,this.ordinalAt('points',segment,cutoff),future==null?Number.MAX_SAFE_INTEGER:future-1);
    const ordinal=this.statement('SELECT ordinal FROM points INDEXED BY point_ordinal WHERE origin=? AND segment=? AND ordinal<=? AND at<=? ORDER BY ordinal DESC LIMIT 1')
      .get(this.origin,segment.cvdSegment,bound,at)?.ordinal??0;
    if(cacheable){this.ordinalCache.set(key,ordinal);while(this.ordinalCache.size>256)this.ordinalCache.delete(this.ordinalCache.keys().next().value);}
    return ordinal;
  }
  lastPoint(segment,cutoff,physicalBound){return this.pointFor(this.pointKnowledgeOrdinalAt(segment,cutoff,physicalBound));}
  reasonCodesAt(segment,cutoff,physicalBound){
    this.assertVerified();const at=Date.parse(cutoff),bound=this.pointKnowledgeOrdinalAt(segment,cutoff,physicalBound);
    const rows=this.statement('SELECT code,MIN(ordinal) AS ordinal FROM reasons WHERE origin=? AND segment=? AND ordinal<=? AND at<=? GROUP BY code ORDER BY ordinal')
      .all(this.origin,segment.cvdSegment,bound,at);
    // Fragments migrated by older versions retained their reason evidence only
    // in compact metadata. Read that evidence too, without reindexing or
    // changing the original fragment or existing integrity receipts.
    for(const reason of segment.legacyReasons??segment.reasons??[]){
      const ordinal=reason.ledgerOrdinal,knownOrdinal=Number.isSafeInteger(ordinal)&&ordinal>0;
      if(knownOrdinal&&this.statement('SELECT 1 FROM reasons WHERE origin=? AND ordinal=? AND segment=? AND code=?')
        .get(this.origin,ordinal,segment.cvdSegment,reason.reason))continue;
      const availableAt=Date.parse(reason.availableAt);
      if(Number.isFinite(availableAt)&&availableAt>at)continue;
      if(knownOrdinal){
        if(ordinal>bound)continue;
        const point=this.pointFor(ordinal);
        if(point?.segment===segment.cvdSegment&&Date.parse(point.availableAt)===availableAt){
          rows.push({code:reason.reason,ordinal});continue;
        }
      }
      // A missing ordinal cannot locate this warning inside a historical
      // prefix. Surface uncertainty, and only expose its specific code once
      // the whole retained legacy prefix is within the physical knowledge bound.
      rows.push({code:'LEGACY_QUALITY_REASON_PREFIX_UNPROVEN',ordinal:Number.MAX_SAFE_INTEGER});
      const ceiling=segment.legacyReasonOrdinalCeiling;
      if(Number.isSafeInteger(ceiling)&&ceiling>0&&ceiling<=bound&&Number.isFinite(availableAt))
        rows.push({code:reason.reason,ordinal:Number.MAX_SAFE_INTEGER});
    }
    return [...new Set(rows.sort((a,b)=>a.ordinal-b.ordinal).map(row=>row.code))];
  }
  structureSnapshot(segment,bars,timeframe,cutoff,maxBars){
    this.assertVerified();
    const cacheKey=`structure:${this.origin}:${segment.cvdSegment}:${timeframe}`;
    let state=this.getMeta(cacheKey)??createMarketStructureState({identity:segment.identity,timeframe,maxBars});
    if(bars.length>state.bars.length){
      if(state.bars.length&&state.bars.at(-1).time!==bars[state.bars.length-1]?.time)throw Error('OBSERVATION_STRUCTURE_PREFIX_CHANGED');
      state=appendMarketStructureBars(state,bars.slice(state.bars.length),{cutoff});
      this.transaction(()=>this.setMeta(cacheKey,state));
    }
    return marketStructureSnapshot(state,{cutoff});
  }
  appendTrade(segment,trade){const {rawRecord,...stored}=trade;
    this.statement('INSERT INTO trades VALUES(?,?,?,?,?,?,?,?,?)').run(...this.track('trades',[this.origin,trade.ledgerOrdinal,segment.cvdSegment,
      Date.parse(trade.eventTime),Date.parse(trade.availableAt),trade.payload.close,trade.payload.volume,Math.floor(trade.payload.close),JSON.stringify(stored)]));}
  appendReason(segment,event,code){this.statement('INSERT INTO reasons VALUES(?,?,?,?,?)').run(...this.track('reasons',
    [this.origin,event.ledgerOrdinal,segment.cvdSegment,Number.isFinite(Date.parse(event.availableAt))?Date.parse(event.availableAt):Number.MAX_SAFE_INTEGER,code]));}
  saveProfile(segment,availableAt){const profile=segment.profile;
    const row={origin:this.origin,segment:segment.cvdSegment,at:Date.parse(availableAt),ordinal:profile.lastOrdinal,json:JSON.stringify({
      bins:profile.bins,totalVolume:profile.totalVolume,tradeCount:profile.tradeCount,firstTrade:profile.firstTrade,lastTrade:profile.lastTrade,
      observedStart:profile.observedStart,observedEnd:profile.observedEnd})};
    const old=this.checked(this.statement('SELECT * FROM profiles WHERE origin=? AND segment=? AND at=?').get(row.origin,row.segment,row.at));
    this.statement('INSERT OR REPLACE INTO profiles VALUES(?,?,?,?,?,?)').run(...Object.values(row),this.updateIndex('profiles',row,old));}
  tradeEndpoints(segment,cutoff){const args=[this.origin,segment.cvdSegment,this.ordinalAt('trades',segment,cutoff),Date.parse(cutoff),Date.parse(cutoff)];
    const first=parse(this.statement('SELECT json FROM trades INDEXED BY trade_ordinal WHERE origin=? AND segment=? AND ordinal<=? AND at<=? AND event_ms<=? ORDER BY ordinal LIMIT 1').get(...args));
    const last=parse(this.statement('SELECT json FROM trades INDEXED BY trade_ordinal WHERE origin=? AND segment=? AND ordinal<=? AND at<=? AND event_ms<=? ORDER BY ordinal DESC LIMIT 1').get(...args));
    return first?[first,...(last.ledgerOrdinal===first.ledgerOrdinal?[]:[last])]:[];}
  minuteSeries(segment,cutoff,physicalBound){const at=Date.parse(cutoff),minute=Math.floor(at/60000);
    this.assertVerified();const bound=this.pointKnowledgeOrdinalAt(segment,cutoff,physicalBound);
    const rows=this.statement('SELECT * FROM minutes WHERE origin=? AND segment=? AND minute<? AND first_ordinal<=? ORDER BY first_ordinal DESC LIMIT 2000')
      .all(this.origin,segment.cvdSegment,minute,bound).map(row=>this.checked(row)).map(row=>{
        if(row.ordinal<=bound)return row;
        // A later backdated point may have replaced this minute's index entry.
        // Recover the last point from the lawful physical prefix, not its totals.
        const prior=this.statement('SELECT json,ordinal FROM points INDEXED BY point_time WHERE origin=? AND segment=? AND at>=? AND at<? AND ordinal<=? ORDER BY ordinal DESC LIMIT 1')
          .get(this.origin,segment.cvdSegment,row.minute*60000,(row.minute+1)*60000,bound);
        return prior?{...prior,first_ordinal:row.first_ordinal}:null;
      }).filter(Boolean);
    const last=this.statement('SELECT json,ordinal FROM points INDEXED BY point_time WHERE origin=? AND segment=? AND at>=? AND at<=? AND ordinal<=? ORDER BY ordinal DESC LIMIT 1')
      .get(this.origin,segment.cvdSegment,minute*60000,at,bound);
    if(last){const first=this.statement('SELECT MIN(ordinal) AS ordinal FROM points INDEXED BY point_time WHERE origin=? AND segment=? AND at>=? AND at<=? AND ordinal<=?')
      .get(this.origin,segment.cvdSegment,minute*60000,at,bound);
      rows.push({...last,first_ordinal:first.ordinal});}
    return rows.sort((a,b)=>a.first_ordinal-b.first_ordinal).slice(-2000).map(parse);}
  profileAt(segment,cutoff){const at=Date.parse(cutoff);
    this.assertVerified();
    const row=this.checked(this.statement('SELECT * FROM profiles WHERE origin=? AND segment=? AND at<=? ORDER BY at DESC LIMIT 1').get(this.origin,segment.cvdSegment,at));
    const result=parse(row)??{bins:{},totalVolume:0,tradeCount:0,firstTrade:null,lastTrade:null,observedStart:null,observedEnd:null};
    // Exact suffix after a saved prefix; late event times are not dropped. The
    // availableAt bound makes earlier profile snapshots immutable to later data.
    const rows=this.statement(`SELECT bin,SUM(volume) AS volume,COUNT(*) AS count,MIN(event_ms) AS lo,MAX(event_ms) AS hi
      FROM trades INDEXED BY trade_ordinal WHERE origin=? AND segment=? AND ordinal>? AND ordinal<=? AND at<=? AND event_ms<=? GROUP BY bin`).all(this.origin,segment.cvdSegment,row?.ordinal??0,this.ordinalAt('trades',segment,cutoff),at,at);
    for(const item of rows){result.bins[item.bin]=(result.bins[item.bin]??0)+item.volume;result.totalVolume+=item.volume;result.tradeCount+=item.count;
      if(result.observedStart===null||item.lo<Date.parse(result.observedStart))result.observedStart=iso(item.lo);
      if(result.observedEnd===null||item.hi>Date.parse(result.observedEnd))result.observedEnd=iso(item.hi);}
    const endpoints=this.tradeEndpoints(segment,cutoff);
    const entry=t=>t?{bin:Math.floor(t.payload.close),volume:t.payload.volume,eventTime:t.eventTime,availableAt:t.availableAt,ledgerOrdinal:t.ledgerOrdinal,recordHash:t.recordHash}:null;
    result.firstTrade=entry(endpoints[0]);result.lastTrade=entry(endpoints.at(-1));return result;}
  windowEvidence(segment,start,end,knownAt){const args=[this.origin,segment.cvdSegment,start,end,knownAt];
    this.assertVerified();
    const where='t.origin=? AND t.segment=? AND t.event_ms>=? AND t.event_ms<? AND t.at<=?';
    const sum=this.statement(`SELECT COUNT(*) AS n,SUM(p.buy) AS buy,SUM(p.sell) AS sell,SUM(p.unknown) AS unknown,SUM(p.total) AS total,MIN(p.valid) AS valid
      FROM trades t JOIN points p ON p.origin=t.origin AND p.ordinal=t.ordinal WHERE ${where}`).get(...args);
    const base={deltaCvd:null,priceDisplacement:null,coverage:null,unknownVolume:null,start:iso(start),end:iso(end),knownAt:iso(knownAt)};
    if(!sum.n)return base;
    const first=this.statement(`SELECT t.price FROM trades t WHERE ${where} ORDER BY t.ordinal LIMIT 1`).get(...args);
    const last=this.statement(`SELECT t.price FROM trades t WHERE ${where} ORDER BY t.ordinal DESC LIMIT 1`).get(...args);
    return {...base,deltaCvd:sum.buy+sum.sell>0&&sum.valid?sum.buy-sum.sell:null,priceDisplacement:last.price-first.price,
      buyProxyVolume:sum.buy,sellProxyVolume:sum.sell,unknownVolume:sum.unknown,coverage:sum.total>0?(sum.buy+sum.sell)/sum.total:null,
      interval:'EVENT_TIME_START_INCLUSIVE_END_EXCLUSIVE_AVAILABLE_BY_KNOWN_AT'};}
  checkpoint(body){this.setMeta('checkpoint',{...body,origin:this.origin});}
  close(){this.db.close();this.statements.clear();}
}

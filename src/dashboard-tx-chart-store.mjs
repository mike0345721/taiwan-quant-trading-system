// Reproducible private chart history, never an official database or a collector.
// New source reads retain the original byte/record budgets. History is streamed
// from disk rather than counting every prior tick against the next ingest batch.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {compareTxChartTicks} from './dashboard-tx-chart.mjs';

const stores=new Map(),version='tx-chart-history-v2';
const proofChunkBytes=64*1024,proofFormat='original-bytes-v1';
const proofDigest=(entry,start,end)=>crypto.createHash('sha256').update(JSON.stringify([entry.id,entry.identity,start,end])+':');
// Logical serialized proof overhead, conservatively reserved before admitting input.
const proofWriteReserve=bytes=>256*(1+Math.ceil(bytes/proofChunkBytes));
const hash=value=>crypto.createHash('sha256').update(value).digest('hex');
const identity=s=>`${s.dev}:${s.ino}:${s.birthtimeMs}`;
const statStamp=s=>`${s.dev}:${s.ino}:${s.size}:${s.mtimeNs}:${s.ctimeNs}`;
const stamp=file=>statStamp(fs.statSync(file,{bigint:true}));
const fileName=root=>`${hash(path.resolve(root))}-tx-history-v2.sqlite`;
export const txChartHistoryPath=(dataRoot,cacheRoot)=>path.join(cacheRoot,fileName(dataRoot));
function ordinary(file,optional=false){
  try{const s=fs.lstatSync(file);if(!s.isFile()||s.isSymbolicLink()||s.nlink!==1)throw Error('TX_CHART_HISTORY_PATH_ALIAS');}
  catch(e){if(optional&&e.code==='ENOENT')return;throw e;}
}
function openStore(dataRoot,cacheRoot){
  const file=txChartHistoryPath(dataRoot,cacheRoot);
  if(stores.has(file)){const store=stores.get(file);ordinary(file);
    if(identity(fs.statSync(file))!==store.fileIdentity){store.db.close();stores.delete(file);return openStore(dataRoot,cacheRoot);}
    const current=stamp(file),dataVersion=store.q('PRAGMA data_version').get().data_version;
    if(current!==store.knownStamp||dataVersion!==store.dataVersion){store.externalRevision++;store.verified.clear();store.pending.clear();store.sourceChecks.clear();store.knownStamp=current;store.dataVersion=dataVersion;}return store;}
  fs.mkdirSync(cacheRoot,{recursive:true});
  for(let current=path.resolve(cacheRoot);;){const s=fs.lstatSync(current);
    if(!s.isDirectory()||s.isSymbolicLink())throw Error('TX_CHART_HISTORY_PATH_ALIAS');
    const parent=path.dirname(current);if(parent===current)break;current=parent;}
  ordinary(file,true);ordinary(file+'-journal',true);
  const {DatabaseSync}=createRequire(import.meta.url)('node:sqlite');
  const db=new DatabaseSync(file),statements=new Map();
  const q=sql=>{if(!statements.has(sql))statements.set(sql,db.prepare(sql));return statements.get(sql);};
  try{
    db.exec(`PRAGMA journal_mode=DELETE; PRAGMA synchronous=FULL; PRAGMA cache_size=-8192;
      PRAGMA mmap_size=0; PRAGMA temp_store=FILE; PRAGMA max_page_count=4194304;
      BEGIN; CREATE TABLE IF NOT EXISTS binding(version TEXT,root TEXT);
      CREATE TABLE IF NOT EXISTS sources(id INTEGER PRIMARY KEY,path TEXT,identity TEXT,offset INTEGER,
        observed INTEGER,mtime REAL,headSize INTEGER,headHash TEXT,tailSize INTEGER,tailHash TEXT,count INTEGER);
      CREATE TABLE IF NOT EXISTS active(path TEXT PRIMARY KEY,id INTEGER);
      CREATE TABLE IF NOT EXISTS checkpoint_debt(source INTEGER PRIMARY KEY,offset INTEGER,
        headSize INTEGER,headHash TEXT,tailSize INTEGER,tailHash TEXT);
      CREATE TABLE IF NOT EXISTS source_provenance(source INTEGER PRIMARY KEY,identity TEXT,offset INTEGER,count INTEGER);
      CREATE TABLE IF NOT EXISTS source_chunks(source INTEGER,start INTEGER,end INTEGER,digest TEXT,PRIMARY KEY(source,start));
      CREATE TABLE IF NOT EXISTS events(source INTEGER,offset INTEGER,json TEXT,key TEXT,
        event REAL,available REAL,violation TEXT,rawHash TEXT,keyHash TEXT,violationHash TEXT,PRIMARY KEY(source,offset));
      CREATE INDEX IF NOT EXISTS event_order ON events(event,available,source,offset);
      CREATE INDEX IF NOT EXISTS source_event_order ON events(source,event,available,offset); COMMIT;`);
    // A generation's format is independent of its removable proof rows, even
    // when its frozen range is empty. NULL is the pre-marker schema, not proof.
    if(!q('PRAGMA table_info(sources)').all().some(column=>column.name==='proofFormat'))
      db.exec('ALTER TABLE sources ADD COLUMN proofFormat TEXT');
    const binding=q('SELECT * FROM binding').get();
    if(binding&&(binding.version!==version||binding.root!==path.resolve(dataRoot)))throw Error('TX_CHART_HISTORY_BINDING_MISMATCH');
    if(!binding)q('INSERT INTO binding VALUES(?,?)').run(version,path.resolve(dataRoot));
    const store={file,db,q,verified:new Map(),pending:new Map(),sourceChecks:new Map(),ownWriteRevision:0,externalRevision:0,knownStamp:stamp(file),fileIdentity:identity(fs.statSync(file)),
      dataVersion:q('PRAGMA data_version').get().data_version};stores.set(file,store);
    while(stores.size>4){const first=stores.keys().next().value;stores.get(first).db.close();stores.delete(first);}
    return store;
  }catch(e){try{db.close();}catch{}throw e;}
}
function readBytes(fd,size,offset,budget){
  if(size>budget.remainingSourceBytes)return null;
  const buffer=Buffer.allocUnsafe(size),n=fs.readSync(fd,buffer,0,size,offset);
  budget.remainingSourceBytes-=n;budget.sourceBytesRead+=n;
  if(n!==size)throw Error('TX_CHART_SOURCE_SHORT_READ');return buffer;
}
// A proof concerns the frozen byte range. The source contract allows suffix
// appends even during a read, but not replacement, shrink or same-size rewrites.
// fd/path checks are race detection, not a lock against a hostile concurrent writer.
function sourceSamplesIntact(before,after){
  return before.isFile()&&after.isFile()&&before.nlink===1n&&after.nlink===1n
    &&before.dev===after.dev&&before.ino===after.ino&&before.birthtimeNs===after.birthtimeNs
    &&after.size>=before.size&&(after.size>before.size||statStamp(after)===statStamp(before));
}
function sourceSliceIntact(file,fd,before){
  ordinary(file);
  // These samples are ordered, not atomic. Growth between fd and path stats
  // is legal too; equal sizes still require unchanged nanosecond stamps.
  const descriptor=fs.fstatSync(fd,{bigint:true}),current=fs.statSync(file,{bigint:true});
  return sourceSamplesIntact(before,descriptor)&&sourceSamplesIntact(descriptor,current);
}
function source(store,file,budget,decode,normalize,normalizationIdentity){
  const {db,q}=store;
  if(!fs.existsSync(file))return {id:null,progress:{sourceDate:path.basename(file),state:'MISSING',complete:false,reasonCodes:['TX_CHART_SOURCE_MISSING']}};
  ordinary(file);const stat=fs.statSync(file),fd=fs.openSync(file,'r'),reasons=[];
  try{
    const readSample=fs.statSync(file,{bigint:true}),opened=fs.fstatSync(fd,{bigint:true});
    if(!sourceSamplesIntact(readSample,opened)||identity(fs.fstatSync(fd))!==identity(stat))throw Error('TX_CHART_SOURCE_CHANGED_DURING_READ');
    let s=q('SELECT sources.* FROM sources JOIN active ON sources.id=active.id WHERE active.path=?').get(file);
    const provenance=s?q('SELECT * FROM source_provenance WHERE source=?').get(s.id):null;
    // Chunks also identify the earlier proof format that predates the marker.
    // Missing witnesses in a known proof generation must never mint new trust.
    if(s?.proofFormat!=null&&s.proofFormat!==proofFormat)throw Error('TX_CHART_HISTORY_PROVENANCE_MISMATCH');
    if(s&&!provenance&&(s.proofFormat!=null||q('SELECT 1 FROM source_chunks WHERE source=? LIMIT 1').get(s.id)))
      throw Error('TX_CHART_HISTORY_PROOF_UNAVAILABLE');
    // Only an unmarked generation with neither provenance nor chunks is legacy.
    // Reconstruct a DISTINCT current generation; never certify historical rows.
    let reset=!s||s.identity!==identity(stat)+':'+normalizationIdentity||stat.size<s.offset||!provenance;
    if(!reset&&provenance.count!==s.count)throw Error('TX_CHART_HISTORY_ROW_COUNT_MISMATCH');
    if(!reset&&(provenance.identity!==s.identity||provenance.offset!==s.offset))
      throw Error('TX_CHART_HISTORY_PROVENANCE_MISMATCH');
    if(!reset&&s.proofFormat==null){
      // Seal one existing pre-marker proof generation, without rereading raw or
      // altering its original identity/digests. This is bounded metadata work.
      assertUnchanged(store);db.exec('BEGIN IMMEDIATE');
      try{q('UPDATE sources SET proofFormat=? WHERE id=?').run(proofFormat,s.id);db.exec('COMMIT');acceptOwnWrite(store);}
      catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
      s={...s,proofFormat};
    }
    const debt=s&&!reset?q('SELECT * FROM checkpoint_debt WHERE source=?').get(s.id):null;
    if(debt){
      const debtStamp=`debt:${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${debt.offset}`;
      let check=store.sourceChecks.get(s.id);
      if(check?.stamp!==debtStamp)check={stamp:debtStamp,head:Buffer.alloc(0),tail:Buffer.alloc(0)};
      for(const [field,size,start] of [['head',debt.headSize,0],['tail',debt.tailSize,debt.offset-debt.tailSize]]){
        const amount=Math.min(size-check[field].length,budget.remainingSourceBytes);
        if(amount>0)check[field]=Buffer.concat([check[field],readBytes(fd,amount,start+check[field].length,budget)]);
      }
      store.sourceChecks.set(s.id,check);
      if(check.head.length!==debt.headSize||check.tail.length!==debt.tailSize)return {id:s.id,readBlocked:true,
        progress:{sourceDate:path.basename(file),state:'CATCHUP_PENDING',complete:false,sourceOffset:s.offset,observedSize:stat.size,
          reasonCodes:['TX_CHART_PRIOR_CHECKPOINT_VALIDATION_PENDING']}};
      reset=hash(check.head)!==debt.headHash||hash(check.tail)!==debt.tailHash;
      if(!reset){
        assertUnchanged(store);db.exec('BEGIN IMMEDIATE');
        try{q('DELETE FROM checkpoint_debt WHERE source=?').run(s.id);db.exec('COMMIT');acceptOwnWrite(store);}
        catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
        store.sourceChecks.delete(s.id);
        return {id:s.id,readBlocked:true,progress:{sourceDate:path.basename(file),state:'CATCHUP_PENDING',complete:false,
          sourceOffset:s.offset,observedSize:stat.size,reasonCodes:['TX_CHART_CURRENT_CHECKPOINT_VALIDATION_PENDING']}};
      }
    }
    const staged=s&&store.pending.get(s.id);
    // A near-budget line needs its own read phase: checkpoint bytes must not
    // permanently consume the space needed to re-read that entire line.
    // Read and commit fresh bytes in the SAME phase; never publish a complete
    // line retained across polls. The prior guard supplies committed-prefix
    // checkpoints, and the new cursor must pass another guard before publishing.
    const freshRead=!reset&&staged?.freshRead&&staged.offset===s.offset&&staged.identity===identity(stat)
      &&s.identity===identity(stat)+':'+normalizationIdentity&&stat.size>=staged.observedSize
      &&(stat.size>staged.observedSize||(stat.mtimeMs===staged.mtime&&stat.ctimeMs===staged.ctime))
      &&staged.head?.length===s.headSize&&staged.tail?.length===s.tailSize
      &&hash(staged.head)===s.headHash&&hash(staged.tail)===s.tailHash;
    let head=freshRead?staged.head:Buffer.alloc(0),tail=freshRead?staged.tail:Buffer.alloc(0);
    if(s&&!reset&&s.offset&&!freshRead){
      const sourceStamp=`${identity(stat)}:${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}:${s.offset}`;
      let check=store.sourceChecks.get(s.id);
      if(check?.stamp!==sourceStamp)check={stamp:sourceStamp,head:Buffer.alloc(0),tail:Buffer.alloc(0)};
      for(const [field,size,start] of [['head',s.headSize,0],['tail',s.tailSize,s.offset-s.tailSize]]){
        const amount=Math.min(size-check[field].length,budget.remainingSourceBytes);
        if(amount>0)check[field]=Buffer.concat([check[field],readBytes(fd,amount,start+check[field].length,budget)]);
      }
      store.sourceChecks.set(s.id,check);head=check.head;tail=check.tail;
      if(head.length!==s.headSize||tail.length!==s.tailSize)return {id:s.id,progress:{sourceDate:path.basename(file),state:'CATCHUP_PENDING',complete:false,sourceOffset:s.offset,observedSize:stat.size,reasonCodes:['TX_CHART_SOURCE_IDENTITY_VALIDATION_PENDING']}};
      reset=hash(head)!==s.headHash||hash(tail)!==s.tailHash||(stat.size===s.observed&&stat.mtimeMs!==s.mtime);
    }
    if(reset){
      if(s){store.verified.delete(s.id);store.pending.delete(s.id);store.sourceChecks.delete(s.id);}
      assertUnchanged(store);
      db.exec('BEGIN IMMEDIATE');
      try{const inserted=q('INSERT INTO sources(path,identity,offset,observed,mtime,headSize,headHash,tailSize,tailHash,count,proofFormat) VALUES(?,?,0,?,?,0,?,0,?,0,?)').run(file,identity(stat)+':'+normalizationIdentity,stat.size,stat.mtimeMs,hash(''),hash(''),proofFormat);
        const id=Number(inserted.lastInsertRowid);
        // INTEGER PRIMARY KEY may reuse an id after external source deletion.
        // Prove the new generation is empty before granting resident trust;
        // a bounded index seek also detects orphan events left under that id.
        if(q('SELECT 1 FROM events WHERE source=? LIMIT 1').get(id)||q('SELECT 1 FROM source_chunks WHERE source=? LIMIT 1').get(id))throw Error('TX_CHART_HISTORY_ROW_COUNT_MISMATCH');
        q('INSERT INTO source_provenance VALUES(?,?,0,0)').run(id,identity(stat)+':'+normalizationIdentity);
        q('INSERT OR REPLACE INTO active VALUES(?,?)').run(file,id);db.exec('COMMIT');
      }catch(e){try{db.exec('ROLLBACK');}catch{}throw e;}
      s=q('SELECT sources.* FROM sources JOIN active ON sources.id=active.id WHERE active.path=?').get(file);
      if(s.offset)throw Error('TX_CHART_HISTORY_RESET_INVALID');
      store.verified.set(s.id,{count:0,offset:-1,complete:true});acceptOwnWrite(store);head=Buffer.alloc(0);tail=Buffer.alloc(0);
    }
    // Count integrity is checked when the bounded verification cursor reaches
    // EOF. A separate count(*) here scans the whole cold index before yielding.
    const pending=store.pending.get(s.id);
    const carryValid=pending?.offset===s.offset&&pending.identity===identity(stat)
      &&stat.size>=pending.observedSize&&stat.size>=s.offset+pending.bytes.length
      &&(stat.size>pending.observedSize||(stat.mtimeMs===pending.mtime&&stat.ctimeMs===pending.ctime));
    let carry=carryValid&&!freshRead?pending.bytes:Buffer.alloc(0);
    if(!carryValid)store.pending.delete(s.id);
    // A growing file can also have had its uncommitted suffix rewritten. Check
    // the carried bytes themselves before joining them to a new suffix.
    if(carry.length&&(stat.size!==pending.observedSize||stat.mtimeMs!==pending.mtime||stat.ctimeMs!==pending.ctime)){
      const current=readBytes(fd,carry.length,s.offset,budget);
      if(!current){store.pending.set(s.id,{...pending,freshRead:true,head,tail});
        return {id:s.id,progress:{sourceDate:path.basename(file),state:'CATCHUP_PENDING',complete:false,
          sourceOffset:s.offset,observedSize:stat.size,reasonCodes:['TX_CHART_PARTIAL_LINE_VALIDATION_PENDING']}};}
      if(!current.equals(carry)){carry=Buffer.alloc(0);store.pending.delete(s.id);}
      else store.pending.set(s.id,{...pending,observedSize:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs});
      if(carry.length&&!budget.remainingSourceBytes&&stat.size>s.offset+carry.length){
        store.pending.set(s.id,{...pending,freshRead:true,head,tail});
        return {id:s.id,progress:{sourceDate:path.basename(file),state:'CATCHUP_PENDING',complete:false,
          sourceOffset:s.offset,observedSize:stat.size,reasonCodes:['TX_CHART_PARTIAL_LINE_VALIDATION_PENDING']}};
      }
    }
    const maxRead=Math.min(budget.maxSourceBytes-carry.length,stat.size-s.offset-carry.length,budget.remainingSourceBytes);
    let freshReadCommitted=false;
    if(maxRead>0&&budget.remainingRecords>0){
      const next=readBytes(fd,maxRead,s.offset+carry.length,budget),
        bytes=carry.length?Buffer.concat([carry,next]):next,end=bytes.lastIndexOf(10);
      if(end>=0){
        let position=0,committed=0,added=0,written=0;
        const ingestUntil=performance.now()+750;
        const priorVerified=store.verified.has(s.id)?{...store.verified.get(s.id)}:null;
        assertUnchanged(store);db.exec('BEGIN IMMEDIATE');
        try{
          while(position<=end&&performance.now()<ingestUntil){
            const newline=bytes.indexOf(10,position),line=bytes.subarray(position,newline).toString('utf8');
            if(written+proofWriteReserve(newline+1)>budget.remainingCacheWriteBytes)break;
            const record=decode(line);
            if(record){
              if(added>=budget.remainingRecords)break;
              const json=JSON.stringify(record),n=normalize(record),key=n.key?JSON.stringify(n.key):null,
                violation=n.violation?JSON.stringify(n.violation):null;
              const values=[json,key,n.key?.exchangeMs??null,n.key?.availableMs??null,violation];
              const size=Buffer.byteLength(JSON.stringify(values));if(written+size+proofWriteReserve(newline+1)>budget.remainingCacheWriteBytes)break;
              const offset=s.offset+position,prefix=`${s.id}:${offset}:`,rawHash=hash(prefix+json);
              q('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(s.id,offset,...values,rawHash,
                hash(prefix+JSON.stringify([key,values[2],values[3],rawHash])),hash(prefix+(violation??'')));
              added++;written+=size;
            }
            committed=newline+1;position=committed;
          }
          if(committed){
            const offset=s.offset+committed;
            // Hash the exact bytes decoded above, including ignored records and
            // newlines. Proof, derived rows and cursor commit or roll back together.
            for(let start=0;start<committed;start+=proofChunkBytes){
              const end=Math.min(committed,start+proofChunkBytes),from=s.offset+start,to=s.offset+end;
              const digest=proofDigest(s,from,to).update(bytes.subarray(start,end)).digest('hex');
              q('INSERT INTO source_chunks VALUES(?,?,?,?)').run(s.id,from,to,digest);
              written+=Buffer.byteLength(JSON.stringify([s.id,from,to,digest]));
            }
            q('UPDATE source_provenance SET offset=?,count=? WHERE source=?').run(offset,s.count+added,s.id);
            written+=Buffer.byteLength(JSON.stringify([s.id,s.identity,offset,s.count+added]));
            const headSize=Math.min(512,offset),tailSize=Math.min(512,offset);
            const nextHead=s.offset>=512?head:Buffer.concat([head,bytes.subarray(0,committed)]).subarray(0,headSize);
            const nextTail=Buffer.concat([tail,bytes.subarray(Math.max(0,committed-512),committed)]).subarray(-tailSize);
            // Persist the overwritten checkpoint in the cursor transaction.
            // A restart must not forget the guard skipped by this read phase.
            if(freshRead)q('INSERT INTO checkpoint_debt VALUES(?,?,?,?,?,?)')
              .run(s.id,s.offset,s.headSize,s.headHash,s.tailSize,s.tailHash);
            q('UPDATE sources SET offset=?,observed=?,mtime=?,headSize=?,headHash=?,tailSize=?,tailHash=?,count=count+? WHERE id=?')
              .run(offset,stat.size,stat.mtimeMs,headSize,hash(nextHead),tailSize,hash(nextTail),added,s.id);
            const verified=store.verified.get(s.id);
            if(verified?.complete&&verified.count===s.count)store.verified.set(s.id,{count:s.count+added,offset:offset-1,complete:true});
            s={...s,offset,count:s.count+added};
            freshReadCommitted=!!freshRead;
          }
          // Only the bytes actually decoded are witnessed, in this transaction.
          // A concurrent suffix append does not extend this frozen input range.
          if(!sourceSliceIntact(file,fd,opened))throw Error('TX_CHART_SOURCE_CHANGED_DURING_READ');
          db.exec('COMMIT');acceptOwnWrite(store);store.pending.delete(s.id);store.sourceChecks.delete(s.id);
          budget.remainingRecords-=added;budget.remainingCacheWriteBytes-=written;budget.cacheBytesWritten+=written;
        }catch(e){try{db.exec('ROLLBACK');}catch{}if(priorVerified)store.verified.set(s.id,priorVerified);else store.verified.delete(s.id);throw e;}
      }else{store.pending.set(s.id,{offset:s.offset,bytes,identity:identity(stat),observedSize:stat.size,mtime:stat.mtimeMs,ctime:stat.ctimeMs,
        ...(freshRead?{freshRead:true,head,tail}:{})});reasons.push('TX_CHART_COMPLETE_LINE_PENDING');}
    }
    if(maxRead===0&&carry.length===budget.maxSourceBytes)reasons.push(stat.size>s.offset+carry.length?'TX_CHART_RECORD_BYTES_BUDGET_EXCEEDED':'TX_CHART_COMPLETE_LINE_PENDING');
    // The fresh-read phase used prior prefix checkpoints. Recheck the resulting
    // cursor before publishing any chart; fresh bytes were committed immediately.
    if(freshReadCommitted)reasons.push('TX_CHART_SNAPSHOT_RECHECK_PENDING');
    const complete=!freshReadCommitted&&s.offset===stat.size;
    if(!complete&&!reasons.length)reasons.push(budget.remainingRecords===0?'TX_CHART_RECORD_BATCH_PENDING':'TX_CHART_SOURCE_CATCHUP_PENDING');
    return {id:s.id,readBlocked:freshReadCommitted,progress:{sourceDate:path.basename(file),state:complete?'COMPLETE':'CATCHUP_PENDING',complete,
      sourceOffset:s.offset,observedSize:stat.size,reasonCodes:reasons}};
  }finally{fs.closeSync(fd);}
}
function checked(row,kind){const prefix=`${row.source}:${row.offset}:`;
  const content=kind==='raw'?row.json:kind==='key'?JSON.stringify([row.key,row.event,row.available,row.rawHash]):row.violation??'';
  const expected=kind==='raw'?row.rawHash:kind==='key'?row.keyHash:row.violationHash;
  if(hash(prefix+content)!==expected)throw Error('TX_CHART_HISTORY_ROW_HASH_MISMATCH');return row;}
function assertUnchanged(store){if(stamp(store.file)!==store.knownStamp||store.q('PRAGMA data_version').get().data_version!==store.dataVersion)
  throw Error('TX_CHART_HISTORY_CHANGED_DURING_READ');}
function acceptOwnWrite(store){if(store.q('PRAGMA data_version').get().data_version!==store.dataVersion){store.verified.clear();throw Error('TX_CHART_HISTORY_CHANGED_DURING_WRITE');}store.knownStamp=stamp(store.file);store.ownWriteRevision++;}
function rawReadLease(store,ids){
  // Freeze the already verified baseline, never grant trust to a newly read
  // stamp/version between validation and acquiring the lease.
  const expectedStamp=store.knownStamp,expectedVersion=store.dataVersion;
  const ownWriteRevision=store.ownWriteRevision,externalRevision=store.externalRevision;
  const assertStore=()=>{
    if(stores.get(store.file)!==store||stamp(store.file)!==expectedStamp
      ||store.q('PRAGMA data_version').get().data_version!==expectedVersion)throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
  };
  assertStore();
  const entries=ids.map(id=>store.q('SELECT * FROM sources WHERE id=?').get(id)),checks=new Map();
  assertStore();
  let sourceIndex=0,offset=-1,sourceCount=0,processedRecords=0;
  const totalRecords=entries.reduce((sum,entry)=>sum+entry.count,0);
  let proofComplete=false,proofFailure=null;
  const checkSources=(budget,validateStore=assertStore)=>{
    if(proofFailure)throw proofFailure;
    try{return advanceProof(budget,validateStore);}
    catch(error){proofFailure=error;throw error;}
  };
  const advanceProof=(budget,validateStore)=>{
    validateStore();
    const renewing=proofComplete;proofComplete=false;
    const until=performance.now()+750;let chunks=0;
    for(const entry of entries){ordinary(entry.path);const current=fs.statSync(entry.path);
      if(!entry.identity.startsWith(identity(current)+':')||current.size<entry.offset
        ||(current.size===entry.observed&&current.mtimeMs!==entry.mtime))
        throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
      const currentSample=fs.statSync(entry.path,{bigint:true}),currentStamp=statStamp(currentSample);
      let check=checks.get(entry.id);
      if(check&&currentStamp!==check.stamp){
        // A completed check must be renewed after any change. An unfinished
        // fixed prefix can continue across legal append; never chase the suffix.
        if(check.complete&&renewing)check=null;
        else if(current.size<=check.size)throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
      }
      if(!check){
        const provenance=store.q('SELECT * FROM source_provenance WHERE source=?').get(entry.id);
        if(!provenance||provenance.identity!==entry.identity||provenance.offset<entry.offset||provenance.count<entry.count)
          throw Error('TX_CHART_HISTORY_PROOF_UNAVAILABLE');
        check={offset:0,complete:false,chunk:null};
      }
      check.stamp=currentStamp;check.size=current.size;checks.set(entry.id,check);
      if(check.complete)continue;
      const fd=fs.openSync(entry.path,'r');
      try{
        const opened=fs.fstatSync(fd,{bigint:true});
        if(!sourceSamplesIntact(currentSample,opened))throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
        while(check.offset<entry.offset&&performance.now()<until){
          if(!check.chunk){
            if(chunks>=2000||budget.remainingRecords<=0)break;
            const row=store.q('SELECT source,start,end,substr(digest,1,65) AS digest FROM source_chunks WHERE source=? AND start=?').get(entry.id,check.offset);
            if(!row||!Number.isSafeInteger(row.end)||row.end<=check.offset||row.end>entry.offset
                ||row.end-check.offset>proofChunkBytes||!/^[a-f0-9]{64}$/.test(row.digest))
              throw Error('TX_CHART_HISTORY_PROOF_UNAVAILABLE');
            const size=Buffer.byteLength(JSON.stringify(row));
            if(size>budget.remainingCacheBytes)break;
            budget.remainingCacheBytes-=size;budget.cacheBytesRead+=size;budget.remainingRecords--;chunks++;
            check.chunk={...row,hash:proofDigest(entry,row.start,row.end)};
          }
          const amount=Math.min(check.chunk.end-check.offset,budget.remainingSourceBytes);
          if(amount<=0)break;
          check.chunk.hash.update(readBytes(fd,amount,check.offset,budget));check.offset+=amount;
          if(check.offset===check.chunk.end){
            if(check.chunk.hash.digest('hex')!==check.chunk.digest)throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
            check.chunk=null;
          }
        }
        // All prefix bytes must match their original witnesses; legal suffix
        // growth is outside this snapshot. Detect ordinary OS/path races too.
        if(!sourceSliceIntact(entry.path,fd,opened))
          throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
      }finally{fs.closeSync(fd);}
      check.complete=check.offset===entry.offset&&!check.chunk;
      validateStore();if(!check.complete)return false;
    }
    validateStore();proofComplete=true;return true;
  };
  return {get sourceProofProgress(){return {state:proofFailure?'INVALID':proofComplete?'VERIFIED':'PENDING',
      scannedBytes:[...checks.values()].reduce((sum,check)=>sum+check.offset,0),
      verifiedBytes:[...checks.values()].reduce((sum,check)=>sum+(check.chunk?.start??check.offset),0),
      totalBytes:entries.reduce((sum,entry)=>sum+entry.offset,0)};},get processedRecords(){return processedRecords;},totalRecords,
    supersededByOwnWrite(budget){
      if(proofFailure)throw proofFailure;
      if(store.ownWriteRevision===ownWriteRevision)return 'UNCHANGED';
      // Retire, never rebase, a frozen lease. Only this resident store's accepted
      // writes qualify; an observed external change cannot be laundered by them.
      const validateStore=()=>{
        if(stores.get(store.file)!==store||store.externalRevision!==externalRevision
            ||store.q('PRAGMA data_version').get().data_version!==expectedVersion
            ||stamp(store.file)!==store.knownStamp)throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
        for(const entry of entries){
          const current=store.q('SELECT sources.* FROM sources JOIN active ON sources.id=active.id WHERE active.path=?').get(entry.path);
          if(!current||current.id!==entry.id||current.identity!==entry.identity||current.offset<entry.offset||current.count<entry.count)
            throw Error('TX_CHART_HISTORY_READ_LEASE_INVALID');
        }
      };
      return checkSources(budget,validateStore)?'SUPERSEDED':'PENDING';
    },
    step(append,budget){
      if(!checkSources(budget))return false;
      const until=performance.now()+750;let remainingRows=Math.min(20000,budget.remainingRecords);
      while(sourceIndex<entries.length&&remainingRows>0&&performance.now()<until){
        const entry=entries[sourceIndex];
        const rows=store.q('SELECT offset,json FROM events WHERE source=? AND offset>? AND offset<? ORDER BY offset')
          .iterate(entry.id,offset,entry.offset);
        try{while(remainingRows>0&&performance.now()<until){
          const next=rows.next();
          if(next.done){
            if(sourceCount!==entry.count)throw Error('TX_CHART_HISTORY_ROW_COUNT_MISMATCH');
            sourceIndex++;offset=-1;sourceCount=0;break;
          }
          const row=next.value,bytes=Buffer.byteLength(row.json);
          if(bytes>budget.remainingCacheBytes){assertStore();return false;}
          append(JSON.parse(row.json));offset=row.offset;sourceCount++;processedRecords++;
          remainingRows--;budget.remainingRecords--;budget.remainingCacheBytes-=bytes;budget.cacheBytesRead+=bytes;
        }}finally{rows.return();}
      }
      return checkSources(budget)&&sourceIndex===entries.length;
    }};
}
function verifySource(store,id,budget,slice){
  const s=store.q('SELECT * FROM sources WHERE id=?').get(id),v=store.verified.get(id)??{offset:-1,count:0,complete:false};
  if(v.complete&&v.count===s.count)return true;
  if(v.count===0){
    // The cursor starts at -1. Check the first index entry explicitly because
    // NULL and negative offsets can otherwise be omitted from the range scan.
    const first=store.q('SELECT offset FROM events WHERE source=? ORDER BY offset LIMIT 1').get(id);
    if(first&&(first.offset===null||first.offset<0))throw Error('TX_CHART_HISTORY_ROW_COUNT_MISMATCH');
  }
  const rows=store.q('SELECT * FROM events WHERE source=? AND offset>? ORDER BY offset').iterate(id,v.offset);
  try{
    // Check before fetching the next SQLite row. Finish all three hashes for an
    // admitted row even if it crosses the cooperative time slice; a large legal
    // row must remain admissible under the original cache-byte budget.
    while(slice.remainingRows>0&&budget.remainingRecords>0&&performance.now()<slice.until){
      const next=rows.next();
      if(next.done){
        if(v.count!==s.count)throw Error('TX_CHART_HISTORY_ROW_COUNT_MISMATCH');
        v.complete=true;break;
      }
      const row=next.value;
      const bytes=Buffer.byteLength(row.json)+Buffer.byteLength(row.key??'')+Buffer.byteLength(row.violation??'');
      if(bytes>budget.remainingCacheBytes)break;
      checked(row,'raw');checked(row,'key');checked(row,'violation');
      slice.remainingRows--;budget.remainingRecords--;budget.remainingCacheBytes-=bytes;budget.cacheBytesRead+=bytes;
      v.offset=row.offset;v.count++;
      if(v.count>s.count)throw Error('TX_CHART_HISTORY_ROW_COUNT_MISMATCH');
    }
  }finally{rows.return();}
  store.verified.set(id,v);return v.complete&&v.count===s.count;
}
export function readTxChartHistory({dataRoot,cacheRoot,files,budget,decode,normalize,calendar}){
  // Pre-debt caches may contain a skipped old-tail check with no durable debt.
  // Re-derive those sources as new generations; preserve their original rows.
  const normalizationIdentity=hash(JSON.stringify([version,'checkpoint-debt-v1',calendar],(_key,value)=>value instanceof Map?[...value]:value instanceof Set?[...value]:value));
  const store=openStore(dataRoot,cacheRoot),sources=files.map(file=>source(store,file,budget,decode,normalize,normalizationIdentity));
  const ids=sources.map(s=>s.id).filter(id=>id!=null),where=ids.length?`source IN (${ids.map(()=>'?').join(',')})`:'0';
  for(const map of [store.pending,store.sourceChecks,store.verified])for(const id of map.keys())if(!ids.includes(id))map.delete(id);
  const validationBytesBefore=budget.cacheBytesRead;
  // One shared validation unit for the entire request, not one per source.
  // This is cooperative scheduling inside the existing worker/byte limits.
  const verificationSlice={remainingRows:2000,until:performance.now()+750};
  let verified=!sources.some(source=>source.readBlocked);
  for(const source of sources)if(source.id!=null&&!verifySource(store,source.id,budget,verificationSlice)){
    verified=false;source.progress={...source.progress,complete:false,state:'CACHE_VALIDATION_PENDING',reasonCodes:[...source.progress.reasonCodes,'TX_CHART_CACHE_VALIDATION_PENDING']};}
  for(const source of sources)if(source.id!=null){
    const count=store.q('SELECT count FROM sources WHERE id=?').get(source.id).count;
    source.progress={...source.progress,cacheVerifiedRecords:store.verified.get(source.id)?.count??0,cacheRecordCount:count};
  }
  // Verification and a full render are separate bounded units of work. A cold
  // request never pays both complete history validation and the render budget.
  if(budget.cacheBytesRead>validationBytesBefore){verified=false;
    for(const source of sources)if(source.progress.complete)source.progress={...source.progress,complete:false,
      state:'CACHE_VALIDATED_AWAITING_RENDER',reasonCodes:[...source.progress.reasonCodes,'TX_CHART_CACHE_VALIDATED_AWAITING_RENDER']};}
  const unchanged=()=>assertUnchanged(store);
  unchanged();
  const raw={*[Symbol.iterator](){if(!verified)return;unchanged();for(const id of ids)for(const row of store.q('SELECT json FROM events WHERE source=? ORDER BY offset').iterate(id))yield JSON.parse(row.json);unchanged();}};
  const ordered={*[Symbol.iterator](){
    if(!verified)return;unchanged();
    function* fromSource(id){let ties=[],at=null;
      function* flush(){ties.sort(compareTxChartTicks);yield* ties;ties=[];}
      const statement=store.db.prepare('SELECT key,event,available FROM events WHERE source=? AND key IS NOT NULL ORDER BY event,available,offset');
      for(const row of statement.iterate(id)){const group=`${row.event}:${row.available}`;
        if(at!==null&&at!==group)yield* flush();at=group;
        if(ties.length>=budget.maxRecords)throw Error('TX_CHART_TIED_RECORD_BUDGET');ties.push(JSON.parse(row.key));
      }yield* flush();
    }
    const iterators=ids.map(id=>fromSource(id));
    try{const heads=iterators.map(iterator=>iterator.next());
      for(;;){let chosen=-1;
        for(let i=0;i<heads.length;i++)if(!heads[i].done&&(chosen<0||compareTxChartTicks(heads[i].value,heads[chosen].value)<0))chosen=i;
        if(chosen<0)break;yield heads[chosen].value;heads[chosen]=iterators[chosen].next();
      }
    }finally{for(const iterator of iterators)iterator.return();}unchanged();
  }};
  const violations=[];
  if(verified)for(const row of store.q(`SELECT violation FROM events WHERE ${where} AND violation IS NOT NULL ORDER BY source,offset`).iterate(...ids)){
    if(violations.length>=budget.maxRecords)throw Error('TX_CHART_TIMESTAMP_EVIDENCE_BUDGET');violations.push(JSON.parse(row.violation));
  }
  unchanged();
  return {raw,ordered,violations,sources,historyFile:store.file,
    createRawReadLease(){if(!verified||sources.some(source=>!source.progress.complete))throw Error('TX_CHART_HISTORY_NOT_VERIFIED');unchanged();return rawReadLease(store,ids);}};
}
export function clearTxChartHistoryCache(){for(const store of stores.values())try{store.db.close();}catch{}stores.clear();}

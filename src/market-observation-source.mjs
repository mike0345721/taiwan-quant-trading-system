import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { stableJson,digest } from './cvd-observation-core.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { resolveDefaultChartSelection } from './dashboard-tx-chart-source.mjs';
import { createMarketObservationState,appendMarketObservationRecords,marketObservationSnapshot,unavailableObservation } from './market-observation-core.mjs';
import { readMarketObservationProducer,clearMarketObservationProducerCache } from './market-observation-producer.mjs';

const resident=new Map();
const MAX_BYTES=4*1024*1024,MAX_ROWS=2000,MAX_CACHE=64*1024*1024;
const stamp=stat=>({dev:stat.dev,ino:stat.ino,birthtimeMs:stat.birthtimeMs});
function bytesAt(fd,length,offset){const b=Buffer.alloc(length);const n=fs.readSync(fd,b,0,length,offset);return b.subarray(0,n);}
function cacheFile(cacheRoot,sourcePath){return cacheRoot?path.join(cacheRoot,'market-observation',`${digest(sourcePath)}.json`):null;}
function sealedWrite(file,body){
  if(!file)return;
  const bytes=stableJson({body,hash:digest(stableJson(body))});
  if(Buffer.byteLength(bytes)>MAX_CACHE)throw Error('OBSERVATION_CACHE_BUDGET');
  fs.mkdirSync(path.dirname(file),{recursive:true});
  const temp=`${file}.${process.pid}.tmp`;
  try {fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,file);} finally {if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

// Bounded derivation inside the existing chart worker. No collector, listener or source writes.
export function readMarketObservationBatch({sourcePath,cacheRoot=null,calendar,asOf,maxRows=MAX_ROWS,maxBytes=MAX_BYTES}={}){
  if(!Number.isInteger(maxRows)||maxRows<1||maxRows>MAX_ROWS||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>MAX_BYTES)throw Error('OBSERVATION_READ_BUDGET');
  const absolute=path.resolve(sourcePath),file=cacheFile(cacheRoot,absolute),resolverIdentity=digest(stableJson(calendar));
  const fd=fs.openSync(absolute,'r');
  try {
    const stat=fs.fstatSync(fd);if(!stat.isFile())throw Error('OBSERVATION_SOURCE_INVALID');
    const binding=stamp(stat);
    let cached=resident.get(absolute);
    if(!cached&&file&&fs.existsSync(file)){
      const statCache=fs.lstatSync(file);if(!statCache.isFile()||statCache.isSymbolicLink()||statCache.size>MAX_CACHE)throw Error('OBSERVATION_CACHE_INVALID');
      const stored=JSON.parse(fs.readFileSync(file,'utf8'));
      if(stored.hash!==digest(stableJson(stored.body)))throw Error('OBSERVATION_CACHE_HASH');
      cached={...stored.body,verificationOffset:0,verificationHash:crypto.createHash('sha256')};
    }
    if(!cached)cached={binding,offset:0,state:null,resolverIdentity,prefixHash:null,hash:crypto.createHash('sha256')};
    if(stableJson(cached.binding)!==stableJson(binding)||cached.resolverIdentity!==resolverIdentity||stat.size<cached.offset)throw Error('OBSERVATION_SOURCE_CHANGED');
    if(cached.verificationHash){
      const bytes=bytesAt(fd,Math.min(maxBytes,cached.offset-cached.verificationOffset),cached.verificationOffset);
      cached.verificationHash.update(bytes);cached.verificationOffset+=bytes.length;
      resident.set(absolute,cached);
      if(cached.verificationOffset<cached.offset)return {state:null,complete:false,reason:'CHECKPOINT_PREFIX_VERIFYING',readBytes:bytes.length};
      if(cached.verificationHash.copy().digest('hex')!==cached.prefixHash)throw Error('OBSERVATION_PREFIX_CHANGED');
      cached.hash=cached.verificationHash;delete cached.verificationHash;delete cached.verificationOffset;
      // Verification and append have distinct bounded requests.
      return {state:cached.state,complete:cached.offset===stat.size,reason:'CHECKPOINT_VERIFIED',readBytes:bytes.length};
    }
    const bytes=bytesAt(fd,Math.min(maxBytes,stat.size-cached.offset),cached.offset);
    let cursor=0;const records=[];
    while(records.length<maxRows){
      const end=bytes.indexOf(10,cursor);if(end<0)break;
      const row=JSON.parse(bytes.subarray(cursor,end).toString('utf8'));
      if(asOf&&Date.parse(row.receivedAt)>Date.parse(asOf))break;
      records.push(row);cursor=end+1;
    }
    if(records.length){
      if(!cached.state&&records[0].previousHash!=='GENESIS')throw Error('OBSERVATION_GENESIS_REQUIRED');
      const sourceLedgerIdentity=cached.state?.cvd.state.sourceLedgerIdentity??`sha256:${digest(stableJson({schemaVersion:'cru34-live-ledger-generation-v1',firstRecordHash:records[0].recordHash,firstReceivedAt:records[0].receivedAt}))}`;
      const initial=cached.state??createMarketObservationState(sourceLedgerIdentity,resolverIdentity);
      const next=appendMarketObservationRecords(initial,records,{sourceLedgerIdentity,resolverIdentity,ledgerOrdinalOffset:initial.cvd.state.ordinal,
        resolveSessionTradeDate:time=>{try {const s=classifyTxChartSession(time,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};}catch{return null;}},
        deadline:Date.now()+6000});
      const hash=cached.hash.copy().update(bytes.subarray(0,cursor));
      const body={binding,offset:cached.offset+cursor,state:next,resolverIdentity,prefixHash:hash.copy().digest('hex')};
      sealedWrite(file,body);cached={...body,hash};
    }
    resident.delete(absolute);resident.set(absolute,cached);
    while(resident.size>2)resident.delete(resident.keys().next().value);
    const cutoffReached=asOf&&records.length<maxRows&&cursor<bytes.length&&bytes.indexOf(10,cursor)>=0;
    return {state:cached.state,complete:cached.offset===stat.size||Boolean(cutoffReached),readBytes:bytes.length,processedRecords:records.length,
      reason:cached.offset===stat.size?'SOURCE_PREFIX_CAUGHT_UP':cutoffReached?'ASOF_PREFIX_REACHED':'SOURCE_CATCHUP_PENDING'};
  }finally{fs.closeSync(fd);}
}

export function loadMarketObservation({dataRoot,cacheRoot,producerRoot=null,calendar,timeframe='1m',mode='LIVE',asOf=null,tradeDate=null,session=null,actualContract=null,now=new Date()}={}){
  const cutoff=asOf||now.toISOString(),selection={timeframe,mode,cutoff};
  try{
    const defaults=resolveDefaultChartSelection(calendar,new Date(cutoff));
    const selectedDate=tradeDate||defaults.tradeDate,selectedSession=session||defaults.session;
    // A calendar-file boundary is a disclosed independent fragment, never a guessed join.
    const date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(cutoff));
    const result=mode==='LIVE'
      ? producerRoot?readMarketObservationProducer({checkpointPath:path.join(producerRoot,`${date}.checkpoint.json`),cacheRoot,calendar,asOf:cutoff,staged:true})
        : {state:null,complete:false,reason:'GOVERNED_PRODUCER_ROOT_REQUIRED'}
      : readMarketObservationBatch({sourcePath:path.join(dataRoot,'live-events',`${date}.ndjson`),cacheRoot,calendar,asOf:cutoff});
    if(!result.state)return {...unavailableObservation(result.reason,selection),sourceProgress:result.sourceProgress??null};
    const snapshot=marketObservationSnapshot(result.state,{...selection,now:now.toISOString(),sourceComplete:result.complete,
      tradeDate:selectedDate,session:selectedSession,actualContract});
    if(snapshot.identity&&(snapshot.identity.tradeDate!==selectedDate||snapshot.identity.session!==selectedSession||(actualContract&&snapshot.identity.actualContract!==actualContract)))
      return unavailableObservation('SELECTED_IDENTITY_NOT_AVAILABLE_IN_PREFIX',selection);
    return {...snapshot,servedAt:now.toISOString(),sourceProgress:{...result.sourceProgress,state:result.reason,readBytes:result.sourceProgress?.readBytes??result.readBytes,processedRecords:result.sourceProgress?.processedRecords??result.processedRecords??0},
      sourceBoundary:'CALENDAR_FILE_FRAGMENT; CROSS_FILE_CONTINUITY_NOT_PROVEN'};
  }catch(error){return unavailableObservation(/^OBSERVATION_|^CVD_/.test(error.message)?error.message:'OBSERVATION_SOURCE_UNAVAILABLE',selection);}
}
export function clearMarketObservationCache(){resident.clear();clearMarketObservationProducerCache();}

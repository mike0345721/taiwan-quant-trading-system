import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildCru34LiveCheckpoint } from './cru34-live-checkpoint.mjs';
import { updateCanonicalCvdFragment } from './cvd-canonical-fragment.mjs';
import { appendMarketObservationCanonical } from './market-observation-core.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { stableJson, digest, SAFETY } from './cvd-observation-core.mjs';

const MAX_SOURCE=96*1024*1024,MAX_CACHE=64*1024*1024,TAIL=20000,MAX_EVENT_BYTES=128*1024;
const resident=new Map();
const pending=new Map();
const fail=reason=>{throw new Error(reason);};
const signature=s=>[s.dev,s.ino,s.birthtimeNs,s.mtimeNs,s.size].map(String).join(':');

/** Validate canonical JSON in place, retaining only spans, not a 96MiB object.
 * Canonical scalar spelling and sorted unique object keys are checked recursively.
 * The source checksum remains the original checksum; a reduced tail is separately
 * sealed and never presented as the original producer checkpoint. */
export function parseCanonicalProducerTail(bytes,{tailLimit=TAIL}={}){
  if(!Buffer.isBuffer(bytes)||bytes.length>MAX_SOURCE||!Number.isSafeInteger(tailLimit)||tailLimit<1||tailLimit>TAIL)fail('OBSERVATION_PRODUCER_BYTE_BUDGET');
  let end=bytes.length;
  if(end&&bytes[end-1]===10){end--;if(end&&bytes[end-1]===13)end--;}
  let cursor=0,tokens=0,eventCount=0;
  const members=[],spans=new Array(tailLimit),stringCache=new Map();
  function scalarString(){
    const start=cursor++;let escaped=false;
    while(cursor<end){const byte=bytes[cursor++];if(escaped){escaped=false;continue;}if(byte===92){escaped=true;continue;}if(byte===34)break;}
    if(bytes[cursor-1]!==34)fail('OBSERVATION_PRODUCER_JSON_INVALID');
    if(cursor-start>MAX_EVENT_BYTES)fail('OBSERVATION_PRODUCER_SCALAR_BUDGET');
    const raw=bytes.subarray(start,cursor),wire=raw.toString('utf8');
    let decoded=stringCache.get(wire);
    if(decoded===undefined){try{decoded=JSON.parse(wire);}catch{fail('OBSERVATION_PRODUCER_JSON_INVALID');}
      if(!Buffer.from(JSON.stringify(decoded)).equals(raw))fail('OBSERVATION_PRODUCER_NONCANONICAL');
      if(wire.length<80&&stringCache.size<512)stringCache.set(wire,decoded);
    }
    return decoded;
  }
  function value(depth=0,rootKey=null){
    if(depth>32||++tokens>12000000)fail('OBSERVATION_PRODUCER_STRUCTURE_BUDGET');
    const first=bytes[cursor];
    if(first===34){scalarString();return;}
    if(first===123){
      cursor++;let previous=null;
      if(bytes[cursor]===125){cursor++;return;}
      while(cursor<end){
        const pairStart=cursor;if(bytes[cursor]!==34)fail('OBSERVATION_PRODUCER_JSON_INVALID');
        const key=scalarString();if(previous!==null&&key<=previous)fail('OBSERVATION_PRODUCER_NONCANONICAL');previous=key;
        if(bytes[cursor++]!==58)fail('OBSERVATION_PRODUCER_JSON_INVALID');
        const valueStart=cursor;value(depth+1,depth===0?key:null);const pairEnd=cursor;
        if(depth===0)members.push({key,pairStart,pairEnd,valueStart,valueEnd:cursor});
        if(bytes[cursor]===125){cursor++;return;}if(bytes[cursor++]!==44)fail('OBSERVATION_PRODUCER_JSON_INVALID');
      }
      fail('OBSERVATION_PRODUCER_JSON_INVALID');
    }
    if(first===91){
      cursor++;if(bytes[cursor]===93){cursor++;return;}
      while(cursor<end){
        const start=cursor;value(depth+1);
        if(rootKey==='rollingCanonicalEvents'){
          if(cursor-start>MAX_EVENT_BYTES||eventCount>=250000)fail('OBSERVATION_PRODUCER_EVENT_BUDGET');
          spans[eventCount%tailLimit]=[start,cursor];eventCount++;
        }
        if(bytes[cursor]===93){cursor++;return;}if(bytes[cursor++]!==44)fail('OBSERVATION_PRODUCER_JSON_INVALID');
      }
      fail('OBSERVATION_PRODUCER_JSON_INVALID');
    }
    const start=cursor;
    while(cursor<end&&![44,93,125].includes(bytes[cursor]))cursor++;
    if(cursor-start>64||cursor===start)fail('OBSERVATION_PRODUCER_JSON_INVALID');
    const wire=bytes.subarray(start,cursor).toString('utf8');let parsed;
    try{parsed=JSON.parse(wire);}catch{fail('OBSERVATION_PRODUCER_JSON_INVALID');}
    if(JSON.stringify(parsed)!==wire)fail('OBSERVATION_PRODUCER_NONCANONICAL');
  }
  if(bytes[0]!==123)fail('OBSERVATION_PRODUCER_JSON_INVALID');value();
  if(cursor!==end)fail('OBSERVATION_PRODUCER_JSON_INVALID');
  const hashMember=members.find(member=>member.key==='checkpointHash');
  const rolling=members.find(member=>member.key==='rollingCanonicalEvents');
  if(!hashMember||!rolling||bytes[rolling.valueStart]!==91)fail('OBSERVATION_PRODUCER_REQUIRED_FIELDS');
  const originalHash=JSON.parse(bytes.subarray(hashMember.valueStart,hashMember.valueEnd).toString('utf8'));
  if(!/^[a-f0-9]{64}$/.test(originalHash))fail('OBSERVATION_PRODUCER_HASH_INVALID');
  const first=members[0]===hashMember;
  const before=first?hashMember.pairStart:hashMember.pairStart-1;
  const after=first?hashMember.pairEnd+1:hashMember.pairEnd;
  const computed=crypto.createHash('sha256').update(bytes.subarray(0,before)).update(bytes.subarray(after,end)).digest('hex');
  if(computed!==originalHash)fail('OBSERVATION_PRODUCER_HASH_INVALID');
  const metadata={};
  for(const member of members){
    if(['checkpointHash','rollingCanonicalEvents'].includes(member.key))continue;
    if(member.valueEnd-member.valueStart>1024*1024)fail('OBSERVATION_PRODUCER_METADATA_BUDGET');
    Object.defineProperty(metadata,member.key,{value:JSON.parse(bytes.subarray(member.valueStart,member.valueEnd).toString('utf8')),enumerable:true});
  }
  if(metadata.schemaVersion!=='cru34-live-checkpoint-v1')fail('OBSERVATION_PRODUCER_SCHEMA_INVALID');
  // The builder enforces safe output defaults; check the original first so it
  // cannot sanitize an unsafe source into a seemingly acceptable reduced copy.
  if(Object.entries(SAFETY).some(([key,value])=>metadata[key]!==value))fail('OBSERVATION_PRODUCER_SAFETY_INVALID');
  const events=[];
  for(let i=Math.max(0,eventCount-tailLimit);i<eventCount;i++){
    const [start,until]=spans[i%tailLimit];events.push(JSON.parse(bytes.subarray(start,until).toString('utf8')));
  }
  const reduced=buildCru34LiveCheckpoint({...metadata,rollingCanonicalEvents:events});
  return {checkpoint:reduced,sourceProof:{schemaVersion:'cru61-producer-tail-proof-v1',originalCheckpointHash:originalHash,
    originalPhysicalSha256:crypto.createHash('sha256').update(bytes).digest('hex'),reducedCheckpointHash:reduced.checkpointHash,
    sourceEventCount:eventCount,retainedEventCount:events.length,firstRetainedOrdinal:events[0]?.ledgerOrdinal??null,
    lastRetainedOrdinal:events.at(-1)?.ledgerOrdinal??null,readBytes:bytes.length,
    scope:'VALIDATED_CANONICAL_PRODUCER_TAIL_NOT_RAW_LEDGER_OR_COMPLETE_SESSION'}};
}

function readSource(file){
  const stat=fs.lstatSync(file,{bigint:true});
  if(!stat.isFile()||stat.isSymbolicLink()||stat.size>BigInt(MAX_SOURCE))fail('OBSERVATION_PRODUCER_SOURCE_INVALID');
  const fd=fs.openSync(file,'r');
  try{
    const opened=fs.fstatSync(fd,{bigint:true});if(signature(opened)!==signature(stat))fail('OBSERVATION_PRODUCER_SOURCE_CHANGED');
    const bytes=Buffer.allocUnsafe(Number(stat.size));let offset=0;
    while(offset<bytes.length){const read=fs.readSync(fd,bytes,offset,Math.min(1024*1024,bytes.length-offset),offset);if(!read)fail('OBSERVATION_PRODUCER_SOURCE_CHANGED');offset+=read;}
    if(signature(fs.fstatSync(fd,{bigint:true}))!==signature(opened))fail('OBSERVATION_PRODUCER_SOURCE_CHANGED');
    return {...parseCanonicalProducerTail(bytes),signature:signature(opened)};
  }finally{fs.closeSync(fd);}
}
function readCache(file){
  if(!file||!fs.existsSync(file))return null;
  const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_CACHE)fail('OBSERVATION_PRODUCER_CACHE_INVALID');
  const bytes=fs.readFileSync(file),separator=bytes.indexOf(10);
  if(separator!==64||digest(bytes.subarray(65))!==bytes.subarray(0,64).toString('ascii'))fail('OBSERVATION_PRODUCER_CACHE_HASH');
  const body=JSON.parse(bytes.subarray(65).toString('utf8'));
  if(body.schemaVersion!=='cru61-producer-observation-cache-v1')fail('OBSERVATION_PRODUCER_CACHE_INVALID');
  return body;
}
function writeCache(file,body){
  if(!file)return;
  const json=JSON.stringify(body),bytes=Buffer.from(`${digest(json)}\n${json}`);
  if(bytes.length>MAX_CACHE)fail('OBSERVATION_PRODUCER_CACHE_BUDGET');
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try{fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

export function readMarketObservationProducer({checkpointPath,cacheRoot=null,calendar,asOf,staged=false}={}){
  if(typeof checkpointPath!=='string'||!path.isAbsolute(checkpointPath))fail('OBSERVATION_PRODUCER_PATH_REQUIRED');
  if(typeof staged!=='boolean')fail('OBSERVATION_PRODUCER_STAGING_INVALID');
  if(asOf&&!Number.isFinite(Date.parse(asOf)))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
  const file=path.resolve(checkpointPath),resolverIdentity=digest(stableJson(calendar));
  const cacheFile=cacheRoot?path.join(cacheRoot,'market-observation',`${digest(file+'|'+resolverIdentity)}.producer-fragment`):null;
  const stat=fs.lstatSync(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.size>BigInt(MAX_SOURCE))fail('OBSERVATION_PRODUCER_SOURCE_INVALID');
  let cached=resident.get(file);
  if(cached&&asOf&&Date.parse(cached.fragment?.state?.cvd?.cutoffReceivedAt)>Date.parse(asOf))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
  if(cached&&cached.signature===signature(stat)&&cached.resolverIdentity===resolverIdentity)return {state:cached.state,complete:true,
    reason:'PRODUCER_FRAGMENT_CAUGHT_UP',sourceProgress:{...cached.sourceProof,readBytes:0,processedRecords:0,cached:true}};
  let source,fromPending=false,newerPublicationPending=false;
  const previousPending=pending.get(file);
  if(staged&&previousPending&&previousPending.resolverIdentity===resolverIdentity
      &&previousPending.cacheFile===cacheFile){
    source=previousPending.source;fromPending=true;
    // A verified immutable observation remains valid evidence while a newer
    // publication arrives. Derive it with an explicit catch-up state rather
    // than starving forever when publications outpace UI polling.
    newerPublicationPending=source.signature!==signature(stat);
  }else{
    pending.delete(file);
    const started=performance.now();source=readSource(file);
    if(asOf&&Date.parse(source.checkpoint.lastVerifiedAvailableAt)>Date.parse(asOf))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
    if(staged){
      pending.set(file,{source,resolverIdentity,cacheFile});while(pending.size>2)pending.delete(pending.keys().next().value);
      return {state:null,complete:false,reason:'VERIFIED_SOURCE_PENDING_DERIVATION',sourceProgress:{...source.sourceProof,
        processedRecords:0,cached:false,stage:'VERIFIED_PENDING_DERIVATION',verificationElapsedMs:performance.now()-started}};
    }
  }
  const deriveStarted=performance.now();
  if(!cached)cached=readCache(cacheFile);
  if(cached&&(cached.sourcePath!==file||cached.resolverIdentity!==resolverIdentity))fail('OBSERVATION_PRODUCER_CACHE_BINDING');
  if(asOf&&(!Number.isFinite(Date.parse(asOf))||Date.parse(source.checkpoint.lastVerifiedAvailableAt)>Date.parse(asOf)))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
  const fragment=updateCanonicalCvdFragment(cached?.fragment??null,source.checkpoint,{resolverIdentity,
    resolveSessionTradeDate:eventTime=>{try{const s=classifyTxChartSession(eventTime,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};}catch{return null;}}});
  const state=appendMarketObservationCanonical(cached?.state??null,fragment,{resolveSessionTradeDate:eventTime=>{
    try{const s=classifyTxChartSession(eventTime,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};}catch{return null;}
  }});
  const body={schemaVersion:'cru61-producer-observation-cache-v1',sourcePath:file,resolverIdentity,signature:source.signature,
    sourceProof:source.sourceProof,fragment:fragment.checkpoint,state};
  writeCache(cacheFile,body);resident.delete(file);resident.set(file,body);while(resident.size>2)resident.delete(resident.keys().next().value);
  pending.delete(file);
  return {state,complete:!newerPublicationPending,
    reason:newerPublicationPending?'PRODUCER_VERIFIED_FRAGMENT_BEHIND_PUBLICATION':'PRODUCER_FRAGMENT_CAUGHT_UP',sourceProgress:{...source.sourceProof,
    readBytes:fromPending?0:source.sourceProof.readBytes,verifiedReadBytes:source.sourceProof.readBytes,
    processedRecords:fragment.canonicalEvents.length,resetReason:fragment.resetReason,cached:false,newerPublicationPending,
    stage:fromPending?'DERIVED_FROM_VERIFIED_SOURCE':'VERIFIED_AND_DERIVED',derivationElapsedMs:performance.now()-deriveStarted}};
}
export function clearMarketObservationProducerCache(){resident.clear();pending.clear();}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { buildCru34LiveCheckpoint } from './cru34-live-checkpoint.mjs';
import { updateCanonicalCvdFragment,validateCanonicalCvdFragment } from './cvd-canonical-fragment.mjs';
import { appendMarketObservationCanonical } from './market-observation-core.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { stableJson,stableJsonDigest, digest, SAFETY } from './cvd-observation-core.mjs';
import { MarketObservationStore } from './market-observation-store.mjs';

const MAX_SOURCE=96*1024*1024,MAX_CACHE=64*1024*1024,TAIL=20000,MAX_EVENT_BYTES=128*1024;
// Durable derivation includes classification, history writes and atomic commit.
// A 2,000-event step exceeded the existing 8s request gate at 644k events.
// This is a per-request work budget; the pending cursor retains every suffix.
const DERIVATION_EVENTS_PER_REQUEST=500;
const resident=new Map();
const pending=new Map();
const stores=new Map();
const migrations=new Map();
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
    sourcePosition:{ledgerOrdinal:metadata.lastVerifiedLedgerOrdinal,startByteOffset:metadata.lastVerifiedStartByteOffset,endByteOffset:metadata.lastVerifiedEndByteOffset},
    sourceAvailableAt:metadata.lastVerifiedAvailableAt??null,lastCanonicalEventTime:events.at(-1)?.eventMs??null,
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
  Object.defineProperty(body,'verifiedCacheBytesHash',{value:bytes.subarray(0,64).toString('ascii')});
  return body;
}
function writeCache(file,body){
  if(!file)return;
  const json=JSON.stringify(body),bytes=Buffer.from(`${digest(json)}\n${json}`);
  if(bytes.length>MAX_CACHE)fail('OBSERVATION_PRODUCER_CACHE_BUDGET');
  fs.mkdirSync(path.dirname(file),{recursive:true});const temp=`${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  try{fs.writeFileSync(temp,bytes,{flag:'wx'});fs.renameSync(temp,file);}finally{if(fs.existsSync(temp))fs.unlinkSync(temp);}
}

function migrateLegacyCache(history,legacy){
  const fragment=legacy.fragment.state,cvd=fragment.cvd;
  const cursor=history.getMeta('legacy-migration')??{hash:legacy.verifiedCacheBytesHash,phase:0,index:0,segment:0};
  if(cursor.hash!==legacy.verifiedCacheBytesHash)fail('OBSERVATION_LEGACY_MIGRATION_SOURCE_CHANGED');
  history.beginOrigin(cvd.sourceLedgerIdentity,fragment.originOrdinal);cursor.origin=history.origin;
  let processed=0;
  while(cursor.phase<4&&processed<2000){
    const segment=legacy.state.segments[cursor.segment];
    const rows=cursor.phase===0?cvd.quotes:cursor.phase===1?cvd.series:
      (cursor.phase===2?segment?.trades:segment?.reasons)??[];
    while(cursor.index<rows.length&&processed<2000){
      const row=rows[cursor.index++];
      if(cursor.phase===0)history.appendQuote(row);else if(cursor.phase===1)history.appendPoint(row);
      else if(cursor.phase===2)history.appendTrade(segment,row);
      // Older fragments have no physical ordinal for some reasons. Keep that
      // evidence in compact state; never fabricate an ordinal to index it.
      else if(Number.isSafeInteger(row.ledgerOrdinal)&&row.ledgerOrdinal>0)history.appendReason(segment,row,row.reason);
      processed++;
    }
    if(cursor.index===rows.length){cursor.index=0;
      if(cursor.phase>=2&&cursor.segment+1<legacy.state.segments.length)cursor.segment++;
      else{cursor.phase++;cursor.segment=0;}}
  }
  if(cursor.phase<4){history.setMeta('legacy-migration',cursor);return null;}
  // Copy only compact state at final publication, not all retained arrays twice.
  const {segments,...stateRest}=legacy.state,{quotes,series,...cvdRest}=cvd;
  const body={...legacy,state:{...structuredClone(stateRest),segments:segments.map(segment=>{
    const {trades,profile,...rest}=segment;
    return {...structuredClone(rest),
      legacyReasons:structuredClone(segment.reasons.filter(row=>!Number.isSafeInteger(row.ledgerOrdinal)||row.ledgerOrdinal<=0)),
      legacyReasonOrdinalCeiling:history.segmentLastOrdinal(segment),
      trades:[],profile:profile?{...structuredClone(Object.fromEntries(Object.entries(profile).filter(([key])=>key!=='trades'))),trades:[]}:null};
  })},fragment:{state:{...fragment,cvd:{...structuredClone(cvdRest),quotes:[],series:structuredClone(series.slice(-1))}}}};
  for(let index=0;index<body.state.segments.length;index++){
    const segment=body.state.segments[index],profile=segment.profile,oldProfile=segments[index].profile;
    if(profile){
      profile.retainTrades=false;profile.tradeCount=oldProfile.trades.length;
      profile.firstTrade=oldProfile.trades[0]??null;profile.lastTrade=oldProfile.trades.at(-1)??null;
      profile.observedStart=null;profile.observedEnd=null;
      for(const trade of oldProfile.trades){
        if(profile.observedStart===null||Date.parse(trade.eventTime)<Date.parse(profile.observedStart))profile.observedStart=trade.eventTime;
        if(profile.observedEnd===null||Date.parse(trade.eventTime)>Date.parse(profile.observedEnd))profile.observedEnd=trade.eventTime;
      }
      profile.trades=[];history.saveProfile(segment,profile.lastAvailableAt);
    }
  }
  body.fragment.state.cvd.quoteFloor=cvd.quotes[0]?.ledgerOrdinal??fragment.lastCanonicalOrdinal??0;
  body.fragment.stateHash=digest(stableJson(body.fragment.state));
  body.state.fragmentSemantic.series=body.state.fragmentSemantic.series.slice(-1);
  body.migratedFromLegacyBytesHash=legacy.verifiedCacheBytesHash;history.checkpoint(body);history.deleteMeta('legacy-migration');return body;
}

function canReplacePartialInput(history,header,source,cached){
  const old=header.source.checkpoint,next=source.checkpoint,before=cached?.fragment?.state;
  if(next.sourceLedgerIdentity!==old.sourceLedgerIdentity||next.lastVerifiedLedgerOrdinal<old.lastVerifiedLedgerOrdinal
    ||(before&&before.cvd.sourceLedgerIdentity!==next.sourceLedgerIdentity))return false;
  const byOrdinal=new Map(next.rollingCanonicalEvents.map(event=>[event.ledgerOrdinal,event]));
  const tick=before?.cvd?.series?.at(-1),anchor=before?
    {ordinal:before.lastTickOrdinal??tick?.ledgerOrdinal??before.lastCanonicalOrdinal,
      hash:before.lastTickHash??tick?.recordHash??before.lastCanonicalHash}:header.firstEvent;
  for(const expected of [anchor,header.lastEvent]){
    if(!expected||byOrdinal.get(expected.ordinal)?.recordHash!==expected.hash)return false;
  }
  // Check the persisted prefix and reconstruct the entire original vector,
  // including its not-yet-persisted middle, against the old sealed checkpoint.
  const original=[];
  for(const [index,part] of header.chunks.entries()){
    if(part.index!==index||part.start!==original.length)return false;
    original.push(...history.inputChunk(header,part));
  }
  for(const event of original){
    if(before&&event.ledgerOrdinal<=before.lastCanonicalOrdinal)continue;
    const replacement=byOrdinal.get(event.ledgerOrdinal);
    if(!replacement||stableJson(replacement)!==stableJson(event))return false;
  }
  const from=original.at(-1)?.ledgerOrdinal??((header.firstEvent?.ordinal??0)-1);
  original.push(...next.rollingCanonicalEvents.filter(event=>event.ledgerOrdinal>from&&event.ledgerOrdinal<=header.lastEvent.ordinal));
  if(original.length!==header.totalEvents)return false;
  const {checkpointHash,...body}=old;
  return stableJsonDigest({...body,rollingCanonicalEvents:original})===checkpointHash;
}

function preserveLegacyReasonEvidence(body,history,published=null){
  if(!body)return;
  const fragment=body.fragment.state,priorFragment=published?.fragment.state;
  const sameOrigin=priorFragment&&priorFragment.originOrdinal===fragment.originOrdinal
    &&priorFragment.cvd.sourceLedgerIdentity===fragment.cvd.sourceLedgerIdentity;
  // Pending derivation may already have switched the store's active origin.
  // Query this checkpoint's own origin, and never carry evidence across resets.
  const origin=digest(stableJson({source:fragment.cvd.sourceLedgerIdentity,ordinal:fragment.originOrdinal}));
  for(const segment of body.state.segments){
    if(Array.isArray(segment.legacyReasons))continue;
    const prior=sameOrigin?published.state.segments.find(s=>s.key===segment.key&&s.cvdSegment===segment.cvdSegment):null;
    segment.legacyReasons=structuredClone(prior?.legacyReasons??segment.reasons??[]);
    segment.legacyReasonOrdinalCeiling=prior?.legacyReasonOrdinalCeiling
      ??history.segmentLastOrdinal(segment,fragment.lastCanonicalOrdinal,origin);
  }
}

export function readMarketObservationProducer({checkpointPath,cacheRoot=null,calendar,asOf,staged=false,persistentHistory=false}={}){
  if(typeof checkpointPath!=='string'||!path.isAbsolute(checkpointPath))fail('OBSERVATION_PRODUCER_PATH_REQUIRED');
  if(typeof staged!=='boolean')fail('OBSERVATION_PRODUCER_STAGING_INVALID');
  if(typeof persistentHistory!=='boolean'||(persistentHistory&&!cacheRoot))fail('OBSERVATION_PERSISTENCE_ROOT_REQUIRED');
  if(asOf&&!Number.isFinite(Date.parse(asOf)))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
  const file=path.resolve(checkpointPath),resolverIdentity=digest(stableJson(calendar));
  const cacheFile=cacheRoot?path.join(cacheRoot,'market-observation',`${digest(file+'|'+resolverIdentity)}.producer-fragment`):null;
  const residentKey=file+(persistentHistory?'|persistent-v1':'|memory-v1');
  const storeFile=persistentHistory?cacheFile+'.observation.sqlite':null;
  let history=storeFile?stores.get(storeFile)??null:null;
  const openHistory=()=>{
    if(storeFile&&!history){history=new MarketObservationStore(storeFile,{sourcePath:file,resolverIdentity});stores.set(storeFile,history);
      while(stores.size>2){const oldest=stores.keys().next().value;stores.get(oldest).close();stores.delete(oldest);}}
  };
  if(storeFile&&fs.existsSync(storeFile))openHistory();
  if(history){const wasVerified=history.verified,previousStamp=history.knownStamp,previousDataVersion=history.knownDataVersion,verification=history.verifyStep();
    if(previousStamp!==history.knownStamp||previousDataVersion!==history.knownDataVersion){const input=pending.get(residentKey);if(input){delete input.readyGeneration;delete input.stagingGeneration;}}
    if(!wasVerified||!verification.complete)return {state:null,complete:false,reason:'DERIVED_HISTORY_VERIFYING',sourceProgress:verification};}
  while(history?.getMeta('pending-source-cleanup')){
    const cleanup=history.transaction(()=>history.cleanupSourceStep());
    if(staged)return {state:null,complete:false,reason:'VERIFIED_SOURCE_PENDING_DERIVATION',
      sourceProgress:{stage:'SOURCE_INPUT_CLEANUP_PENDING',processedRecords:0,...cleanup}};
  }
  const stat=fs.lstatSync(file,{bigint:true});if(!stat.isFile()||stat.isSymbolicLink()||stat.size>BigInt(MAX_SOURCE))fail('OBSERVATION_PRODUCER_SOURCE_INVALID');
  let cached=resident.get(residentKey);
  if(cached&&asOf&&Date.parse(cached.fragment?.state?.cvd?.cutoffReceivedAt)>Date.parse(asOf))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
  const stagedBody=history?.getMeta('pending-derivation')??null;
  const inputStage=history?.inputStage(),readyInput=history?.getMeta('pending-source');
  if(stagedBody&&!readyInput)fail('OBSERVATION_PENDING_SOURCE_MISSING');
  if(readyInput?.format==='bounded-input-v1'&&readyInput.generation!==history.inputGeneration(readyInput.source))fail('OBSERVATION_INPUT_GENERATION_BINDING');
  if(!stagedBody&&!inputStage&&!readyInput&&cached&&(!persistentHistory||history)&&cached.signature===signature(stat)&&cached.resolverIdentity===resolverIdentity)return {state:cached.state,complete:true,
    reason:'PRODUCER_FRAGMENT_CAUGHT_UP',history,sourceProgress:{...cached.sourceProof,readBytes:0,processedRecords:0,cached:true}};
  let source,fromPending=false,newerPublicationPending=false;
  const previousPending=pending.get(residentKey);
  if(stagedBody||readyInput){
    const residentMatches=previousPending&&(!readyInput?.generation||
      (previousPending.readyGeneration===readyInput.generation&&history.inputGeneration(previousPending.source)===readyInput.generation));
    source=residentMatches?previousPending.source:history.pendingSource();if(!source)fail('OBSERVATION_PENDING_SOURCE_MISSING');
    fromPending=true;newerPublicationPending=source.signature!==signature(stat);
  }else if(staged&&previousPending&&previousPending.resolverIdentity===resolverIdentity
      &&previousPending.cacheFile===cacheFile){
    source=previousPending.source;fromPending=true;
    // A verified immutable observation remains valid evidence while a newer
    // publication arrives. Derive it with an explicit catch-up state rather
    // than starving forever when publications outpace UI polling.
    newerPublicationPending=source.signature!==signature(stat);
  }else{
    pending.delete(residentKey);
    const started=performance.now();source=readSource(file);
    if(asOf&&Date.parse(source.checkpoint.lastVerifiedAvailableAt)>Date.parse(asOf))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
    if(staged){
      pending.set(residentKey,{source,resolverIdentity,cacheFile});while(pending.size>2)pending.delete(pending.keys().next().value);
      return {state:null,complete:false,reason:'VERIFIED_SOURCE_PENDING_DERIVATION',sourceProgress:{...source.sourceProof,
        processedRecords:0,cached:false,stage:'VERIFIED_PENDING_DERIVATION',verificationElapsedMs:performance.now()-started}};
    }
  }
  const deriveStarted=performance.now();
  openHistory();
  const historyOpenElapsedMs=performance.now()-deriveStarted;
  if(history&&!history.verified){const verification=history.verifyStep();
    return {state:null,complete:false,reason:'DERIVED_HISTORY_VERIFYING',sourceProgress:verification};}
  const restored = !cached && history ? history.getMeta('checkpoint') : null;
  if(!cached)cached=history?restored:readCache(cacheFile);
  // A legacy cache is evidence with an established cumulative origin. Migration
  // is explicit and atomic; never discard it to obtain a smaller fresh origin.
  if(!cached&&history&&fs.existsSync(cacheFile)){
    const stamp=signature(fs.lstatSync(cacheFile,{bigint:true}));
    let migration=migrations.get(cacheFile);
    if(migration&&migration.stamp!==stamp)fail('OBSERVATION_LEGACY_MIGRATION_SOURCE_CHANGED');
    if(!migration){const legacy=readCache(cacheFile);migration={legacy,stamp,validated:false};migrations.clear();migrations.set(cacheFile,migration);
      return {state:null,complete:false,reason:'LEGACY_CACHE_VALIDATION_PENDING',sourceProgress:{stage:'LEGACY_BYTES_VERIFIED'}};}
    const legacy=migration.legacy;
    if(legacy.sourcePath!==file||legacy.resolverIdentity!==resolverIdentity)fail('OBSERVATION_PRODUCER_CACHE_BINDING');
    if(!migration.validated){validateCanonicalCvdFragment(legacy.fragment);migration.validated=true;
      return {state:null,complete:false,reason:'LEGACY_CACHE_MIGRATION_PENDING',sourceProgress:{stage:'LEGACY_FRAGMENT_VERIFIED'}};}
    cached=history.transaction(()=>migrateLegacyCache(history,legacy));
    if(!cached)return {state:null,complete:false,reason:'LEGACY_CACHE_MIGRATION_PENDING',sourceProgress:history.getMeta('legacy-migration')};
    migrations.delete(cacheFile);
  }
  if(cached&&(cached.sourcePath!==file||cached.resolverIdentity!==resolverIdentity))fail('OBSERVATION_PRODUCER_CACHE_BINDING');
  // Old SQLite checkpoints may predate reason migration. Freeze their retained
  // metadata before appending a new source: a later tick must not move a legacy
  // reason's time or the boundary needed to interpret its unknown ordinal.
  if(history){
    preserveLegacyReasonEvidence(cached,history);
    preserveLegacyReasonEvidence(stagedBody,history,cached);
  }
  if(asOf&&(!Number.isFinite(Date.parse(asOf))||Date.parse(source.checkpoint.lastVerifiedAvailableAt)>Date.parse(asOf)))fail('OBSERVATION_PRODUCER_CUTOFF_AFTER_REQUEST');
  // The same already-published input needs no second durable copy after a
  // restart. Both the history and the current physical publication have been
  // verified above. In-flight input always takes the normal recovery path.
  if(staged&&restored&&restored===cached&&!stagedBody&&!inputStage&&!readyInput
    &&restored.signature===source.signature&&source.signature===signature(stat)
    &&stableJson(restored.sourceProof)===stableJson(source.sourceProof)){
    const fragment=validateCanonicalCvdFragment(restored.fragment);
    if(fragment.resolverIdentity!==resolverIdentity||fragment.sourceCheckpointHash!==source.checkpoint.checkpointHash
      ||fragment.sourceOrdinal!==source.checkpoint.lastVerifiedLedgerOrdinal
      ||fragment.sourceRecordHash!==source.checkpoint.lastVerifiedRecordHash
      ||fragment.cvd.cutoffReceivedAt!==(source.checkpoint.lastVerifiedAvailableAt??null)
      ||fragment.cvd.sourceLedgerIdentity!==source.checkpoint.sourceLedgerIdentity
      ||restored.origin!==history.origin)fail('OBSERVATION_PRODUCER_CACHE_BINDING');
    resident.set(residentKey,restored);while(resident.size>2)resident.delete(resident.keys().next().value);
    pending.delete(residentKey);
    return {state:restored.state,history,complete:true,reason:'PRODUCER_FRAGMENT_CAUGHT_UP',
      sourceProgress:{...source.sourceProof,readBytes:0,verifiedReadBytes:source.sourceProof.readBytes,
        processedRecords:0,cached:true,stage:'RESTORED_VERIFIED_PUBLICATION'}};
  }
  // Persist the verified input in its own request. Combining a durable input
  // commit with the first derivation chunk exceeded the original worker budget
  // under simultaneous daily-writer load. No source checkpoint is promoted here.
  if(history&&!stagedBody&&!history.getMeta('pending-source')&&(staged||history.inputStage())){
    const partial=history.inputStage();
    if(partial&&partial.generation!==history.inputGeneration(source)){
      if(!canReplacePartialInput(history,partial,source,cached))fail('OBSERVATION_INPUT_REACQUISITION_GAP');
      history.transaction(()=>history.abandonInput(source));
      pending.set(residentKey,{source,resolverIdentity,cacheFile});
      if(staged)return {state:null,complete:false,reason:'VERIFIED_SOURCE_PENDING_DERIVATION',
        sourceProgress:{...source.sourceProof,processedRecords:0,stage:'SOURCE_REACQUISITION_CLEANUP_PENDING'}};
      while(history.getMeta('pending-source-cleanup'))history.transaction(()=>history.cleanupSourceStep());
    }
    let persisted;
    const stage=history.inputStage();
    const trustedStaging=!stage||previousPending?.stagingGeneration===stage.generation;
    do{persisted=history.transaction(()=>history.stageSourceStep(source));}while(!staged&&!persisted.complete);
    // Reuse requires every staging commit to belong to this uninterrupted
    // resident generation. A partial restart or external store change loses
    // that proof and must reload all durable chunks, even after READY commits.
    pending.set(residentKey,{source,resolverIdentity,cacheFile,
      ...(trustedStaging?{stagingGeneration:persisted.generation,
        ...(persisted.complete?{readyGeneration:persisted.generation}:{})}:{})});
    if(staged)return {state:null,complete:false,reason:persisted.complete?'VERIFIED_SOURCE_PERSISTED_PENDING_DERIVATION':'VERIFIED_SOURCE_PENDING_DERIVATION',sourceProgress:{...source.sourceProof,
      processedRecords:0,stage:persisted.complete?'SOURCE_PERSISTED_NOT_DERIVED':'SOURCE_PERSISTING',...persisted,
      historyOpenElapsedMs,persistenceElapsedMs:performance.now()-deriveStarted-historyOpenElapsedMs}};
  }
  const derive=()=>{
  const previous=stagedBody??cached;
  const fragment=updateCanonicalCvdFragment(previous?.fragment??null,source.checkpoint,{resolverIdentity,storage:history,
    maxEvents:history?DERIVATION_EVENTS_PER_REQUEST:20000,continuation:Boolean(stagedBody),
    resolveSessionTradeDate:eventTime=>{try{const s=classifyTxChartSession(eventTime,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};}catch{return null;}}});
  const state=appendMarketObservationCanonical(previous?.state??null,fragment,{history,resolveSessionTradeDate:eventTime=>{
    try{const s=classifyTxChartSession(eventTime,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};}catch{return null;}
  }});
  const body={schemaVersion:'cru61-producer-observation-cache-v1',sourcePath:file,resolverIdentity,signature:source.signature,
    sourceProof:source.sourceProof,fragment:fragment.checkpoint,state};
  if(history){
    if(fragment.complete){history.checkpoint(body);history.clearPending();}
    else{if(!history.getMeta('pending-source'))history.stageSource(source);history.setMeta('pending-derivation',{...body,origin:history.origin});}
  }else writeCache(cacheFile,body);
  return {body,fragment,state};
  };
  const {body,fragment,state}=history?history.transaction(derive):derive();
  if(!fragment.complete){
    pending.set(residentKey,{source,resolverIdentity,cacheFile,readyGeneration:readyInput?.generation});
    return {state:null,history,complete:false,reason:'DERIVATION_CATCHUP_PENDING',sourceProgress:{...source.sourceProof,
      processedRecords:fragment.canonicalEvents.length,derivedThroughOrdinal:fragment.checkpoint.state.lastCanonicalOrdinal,
      publishedThroughOrdinal:cached?.fragment?.state.sourceOrdinal??null,readBytes:fromPending?0:source.sourceProof.readBytes,
      stage:'PRIVATE_DERIVATION_NOT_PUBLISHED',derivationElapsedMs:performance.now()-deriveStarted}};
  }
  resident.delete(residentKey);resident.set(residentKey,body);while(resident.size>2)resident.delete(resident.keys().next().value);
  pending.delete(residentKey);
  return {state,history,complete:!newerPublicationPending,
    reason:newerPublicationPending?'PRODUCER_VERIFIED_FRAGMENT_BEHIND_PUBLICATION':'PRODUCER_FRAGMENT_CAUGHT_UP',sourceProgress:{...source.sourceProof,
    readBytes:fromPending?0:source.sourceProof.readBytes,verifiedReadBytes:source.sourceProof.readBytes,
    processedRecords:fragment.canonicalEvents.length,resetReason:fragment.resetReason,cached:false,newerPublicationPending,
    publishedThroughAvailableAt:source.checkpoint.lastVerifiedAvailableAt,publishedThroughOrdinal:source.checkpoint.lastVerifiedLedgerOrdinal,
    stage:fromPending?'DERIVED_FROM_VERIFIED_SOURCE':'VERIFIED_AND_DERIVED',derivationElapsedMs:performance.now()-deriveStarted}};
}
export function clearMarketObservationProducerCache(){resident.clear();pending.clear();migrations.clear();for(const store of stores.values())store.close();stores.clear();}

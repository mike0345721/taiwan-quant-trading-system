import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { createStreamStore, STREAM_STORE_LIMITS } from './cru55-stream-store.mjs';
import { createProjectionJob, beginProjectionBatch, finishProjectionJob, projectionPrimitives, PROJECTION_LIMITS } from './cru55-stream-projection.mjs';
import { beginRangeAppend, createRangeReader, validateIndexLayout, INDEX_PACK_LIMITS } from './cru55-projection-range-index.mjs';
import { startIndexedProjection, advanceIndexedProjectionQueries } from './cru55-indexed-projection.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { materializeTxCanonicalObservations } from './tx-intraday-pressure-path-efficiency.mjs';
import { readPriorArtifact,beginPriorVerification,advancePriorVerification,priorStillVerified } from './cru55-stream-prior-verifier.mjs';
import { acquireManagedLock } from './cru55-managed-owner.mjs';
import { protectPrefix,assertPrefixProtected,releasePrefixGuards } from './cru55-prefix-guard.mjs';
import { replaceDurableFileSync } from './cru55-atomic-replace.mjs';
import {assertManagedContinuity} from './cru55-guarded-continuity.mjs';
import {CONTINUITY_POLICY,FULL_PREFIX_POLICY,CONTINUITY_RESEARCH} from './cru55-continuity-policy.mjs';
import { validatePublicationSchedule } from './cru55-publication-schedule.mjs';

const REPO = fileURLToPath(new URL('../', import.meta.url));
const CODE_FILES=['cru55-guarded-continuity.mjs','cru55-continuity-policy.mjs','cru55-publication-schedule.mjs','cru55-atomic-replace.mjs','cru55-stream-core.mjs','cru55-stream-store.mjs','cru55-stream-projection.mjs','cru55-stream-pipeline.mjs','cru55-projection-range-index.mjs','cru55-indexed-projection.mjs',
  'cvd-observation-core.mjs','dashboard-tx-chart.mjs','tx-intraday-pressure-path-efficiency.mjs','cvd-relationship-projection.mjs',
  'cvd-session-context-projection.mjs','cvd-handoff-projection.mjs','market-state-forward-shadow-calendar.mjs','cru55-stream-prior-verifier.mjs','cru55-managed-owner.mjs','cru55-prefix-guard.mjs'];
const codeIdentity=()=>digest(stableJson([...CODE_FILES.map(f=>digest(fs.readFileSync(path.join(REPO,'src',f)))),digest(fs.readFileSync(path.join(REPO,'package-lock.json')))]));
export const PIPELINE_LIMITS = Object.freeze({ pages: 32, rawRanges: 128, bytes: 8 * 1024 * 1024, jobBytes: 16 * 1024 * 1024, artifactBytes: 32 * 1024 * 1024 });
const same = (a,b) => stableJson(a) === stableJson(b);
const fail = code => { throw Error(code); };
const inside = (parent,child) => { const p=path.relative(parent,child); return !p || (!p.startsWith('..'+path.sep) && p!=='..' && !path.isAbsolute(p)); };
const stamp = st => ({size:Number(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs)});
const identity = (file,st) => ({path:file,dev:String(st.dev),ino:String(st.ino),birthtimeNs:String(st.birthtimeNs)});
function exact(fd, offset, length) {
  const b=Buffer.alloc(length); let n=0;
  while(n<length){const count=fs.readSync(fd,b,n,length-n,offset+n);if(!count)fail('STREAM_RAW_TRUNCATED');n+=count;}
  return b;
}
function fileMetadata(file,cap=PIPELINE_LIMITS.jobBytes){
  assertPlainPath(file);const st=fs.statSync(file);
  if(!st.isFile()||st.nlink!==1||st.size>cap)fail('STREAM_PIPELINE_FILE_INVALID');
  return st;
}
function json(file,cap=PIPELINE_LIMITS.jobBytes){
  fileMetadata(file,cap);
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function atomic(file,value,cap=PIPELINE_LIMITS.jobBytes,beforeReplace){
  assertPlainPath(file);const bytes=stableJson(value);if(Buffer.byteLength(bytes)>cap)fail('STREAM_PIPELINE_STATE_BUDGET');
  const tmp=assertPlainPath(path.join(path.dirname(file),crypto.randomUUID()+'.tmp')),fd=fs.openSync(tmp,'wx');
  try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{return replaceDurableFileSync(tmp,file,{beforeReplace});}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function immutable(file,value,cap=PIPELINE_LIMITS.jobBytes,beforeRead){
  assertPlainPath(file);const bytes=stableJson(value);if(Buffer.byteLength(bytes)>cap)fail('STREAM_PIPELINE_ARTIFACT_BUDGET');
  const existing=()=>{const st=fileMetadata(file,cap);beforeRead?.(st.size);return json(file,cap);};
  if(fs.existsSync(file)){if(!same(existing(),value))fail('STREAM_PIPELINE_IMMUTABLE_COLLISION');return;}
  const tmp=path.join(path.dirname(file),crypto.randomUUID()+'.tmp');atomic(tmp,value,cap);
  try{try{fs.linkSync(tmp,file);}catch(e){if(e.code!=='EEXIST'||!same(existing(),value))throw e;}}finally{fs.unlinkSync(tmp);}
}
const sealed = value => ({value,hash:digest(stableJson(value))});
// Only the opt-in derived pack owns this deterministic staging name. A crash
// after link must not relax the single-link rule for arbitrary output files.
function immutablePack(file,value,beforeRead){
  const cap=INDEX_PACK_LIMITS.pageBytes,bytes=stableJson(value);
  if(Buffer.byteLength(bytes)>cap)fail('STREAM_PIPELINE_ARTIFACT_BUDGET');
  const pending=assertPlainPath(file+'.pack-pending');assertPlainPath(file);
  const meta=p=>{assertPlainPath(p);const s=fs.statSync(p,{bigint:true});if(!s.isFile()||s.size>BigInt(cap))fail('STREAM_PIPELINE_FILE_INVALID');return s;};
  const sameFile=(a,b)=>a.dev===b.dev&&a.ino===b.ino&&a.birthtimeNs===b.birthtimeNs&&a.size===b.size&&a.mtimeNs===b.mtimeNs;
  const verify=(p,s)=>{beforeRead(Number(s.size));const actual=fs.readFileSync(p,'utf8');if(actual!==bytes)fail('STREAM_PIPELINE_IMMUTABLE_COLLISION');const after=meta(p);if(!sameFile(s,after)||s.nlink!==after.nlink)fail('STREAM_PIPELINE_FILE_CHANGED');};
  if(fs.existsSync(file)){
    const target=meta(file);
    if(target.nlink===1n){if(fs.existsSync(pending))fail('STREAM_PIPELINE_FILE_INVALID');verify(file,target);return;}
    if(target.nlink!==2n||!fs.existsSync(pending))fail('STREAM_PIPELINE_FILE_INVALID');
    const staged=meta(pending);
    if(staged.nlink!==2n||!sameFile(target,staged))fail('STREAM_PIPELINE_FILE_INVALID');
    verify(file,target);
    if(!sameFile(staged,meta(pending))||meta(pending).nlink!==2n||!sameFile(target,meta(file))||meta(file).nlink!==2n)fail('STREAM_PIPELINE_FILE_CHANGED');
    fs.unlinkSync(pending);fileMetadata(file,cap);return;
  }
  if(fs.existsSync(pending)){
    const staged=meta(pending);if(staged.nlink!==1n)fail('STREAM_PIPELINE_FILE_INVALID');verify(pending,staged);
    const fd=fs.openSync(pending,'r+');try{const opened=fs.fstatSync(fd,{bigint:true});if(!sameFile(staged,opened)||opened.nlink!==1n)fail('STREAM_PIPELINE_FILE_CHANGED');fs.fsyncSync(fd);if(!sameFile(staged,meta(pending))||meta(pending).nlink!==1n)fail('STREAM_PIPELINE_FILE_CHANGED');}finally{fs.closeSync(fd);}
  }else atomic(pending,value,cap);
  try{fs.linkSync(pending,file);}finally{if(fs.existsSync(pending))fs.unlinkSync(pending);}
}
function unseal(file){const s=json(file);if(digest(stableJson(s.value))!==s.hash)fail('STREAM_PIPELINE_STATE_CHANGED');return s.value;}
function resolve(calendarPath,currentCode){
  calendarPath=calendarPath??path.join(REPO,'config/taifex-official-calendar-2026.json');assertPlainPath(calendarPath);
  const resolverIdentity=digest(stableJson([digest(fs.readFileSync(calendarPath)),currentCode]));
  const calendar=loadGovernedTradingCalendar(calendarPath);
  return {resolverIdentity,calendar,resolveSessionTradeDate:t=>{const s=classifyTxChartSession(t,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};}};
}
const loadedCode = codeIdentity();

// New candidate pipeline. Raw is read-only; every publication requires a full
// original-byte prefix pass. Windows protects the captured prefix through
// publication; other platforms retain conservative whole-file stamp validation.
export function runStreamCycle({sourcePath,runRoot,sourceKind='GOVERNED_FRAGMENT',calendarPath,priorPublication=null,priorPublications=null,ownerContext=null,stopOrdinal=null,publishAtSessionBoundary=false,maxPages=8,maxVerifyRanges=PIPELINE_LIMITS.rawRanges,maxBytes=PIPELINE_LIMITS.bytes,prefixProtection=process.platform==='win32'?'WINDOWS_PREFIX':'STAMP',projectionMode='INDEXED',publicationSchedule=null,indexLayout=null,sourceVerification=FULL_PREFIX_POLICY,continuity=null}={}){
  const started=performance.now(),continuityChunksBefore=continuity?.metrics?.metadataChunks??0;
  publicationSchedule=validatePublicationSchedule(publicationSchedule);
  indexLayout=validateIndexLayout(indexLayout);
  if(indexLayout&&projectionMode!=='INDEXED')fail('STREAM_INDEX_LAYOUT_REQUIRES_INDEXED');
  if(!['INDEXED','FULL_SCAN'].includes(projectionMode))fail('STREAM_PROJECTION_MODE_INVALID');
  if(!['WINDOWS_PREFIX','STAMP'].includes(prefixProtection))fail('STREAM_PREFIX_MODE_INVALID');
  const protectedMode=prefixProtection==='WINDOWS_PREFIX';
  const guarded=sourceVerification===CONTINUITY_POLICY;
  if(![FULL_PREFIX_POLICY,CONTINUITY_POLICY].includes(sourceVerification))fail('STREAM_VERIFICATION_POLICY_INVALID');
  if(guarded){if(!protectedMode)fail('STREAM_CONTINUITY_WINDOWS_REQUIRED');assertManagedContinuity(continuity,ownerContext);}
  if(!Number.isInteger(maxVerifyRanges)||maxVerifyRanges<1||maxVerifyRanges>PIPELINE_LIMITS.rawRanges)fail('STREAM_VERIFY_RANGE_BUDGET');
  if(!Number.isInteger(maxPages)||maxPages<2||maxPages>PIPELINE_LIMITS.pages||!Number.isInteger(maxBytes)||maxBytes<2*STREAM_STORE_LIMITS.pageBytes+2*STREAM_STORE_LIMITS.inputBytes||maxBytes>PIPELINE_LIMITS.bytes)fail('STREAM_PIPELINE_BUDGET');
  if(!['GOVERNED_FRAGMENT','SYNTHETIC_FIXTURE'].includes(sourceKind))fail('STREAM_SOURCE_KIND_INVALID');
  if((stopOrdinal!==null&&(!Number.isSafeInteger(stopOrdinal)||stopOrdinal<1))||typeof publishAtSessionBoundary!=='boolean')fail('STREAM_CUTOFF_OPTION_INVALID');
  if(!path.isAbsolute(sourcePath??'')||!path.isAbsolute(runRoot??''))fail('STREAM_PIPELINE_ABSOLUTE_PATH_REQUIRED');
  sourcePath=assertPlainPath(sourcePath);runRoot=assertPlainPath(runRoot);
  if(inside(runRoot,sourcePath)||inside(sourcePath,runRoot))fail('STREAM_PIPELINE_WRITE_SOURCE_OVERLAP');
  const currentCode=codeIdentity();
  if(currentCode!==loadedCode)fail('STREAM_LOADED_CODE_CHANGED');
  const resolved=resolve(calendarPath,currentCode);fs.mkdirSync(runRoot,{recursive:true});
  const name=f=>assertPlainPath(path.join(runRoot,f)),lock=name('pipeline.lock'),token=crypto.randomUUID();
  const releaseManaged=ownerContext?acquireManagedLock(lock,{ownerContext}):null;
  if(!ownerContext)try{fs.mkdirSync(lock);}catch(e){if(e.code==='EEXIST')fail('STREAM_PIPELINE_BUSY');throw e;}
  let fd,owned=false,savePending=null;
  const work={pages:0,rawRanges:0,bytes:0,canTake(n,page=true){return (!page||this.pages<maxPages)&&this.bytes+n<=maxBytes;},take(n,page=true){if(!this.canTake(n,page))fail('STREAM_WORK_BUDGET_PENDING');if(page)this.pages++;else this.rawRanges++;this.bytes+=n;}};
  try{
    if(!ownerContext){fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify({token}),{flag:'wx'});owned=true;}
    fd=fs.openSync(sourcePath,'r');const initialStat=fs.fstatSync(fd,{bigint:true});
    if(!initialStat.isFile()||initialStat.nlink!==1n)fail('STREAM_RAW_FILE_INVALID');
    const sourceBinding=identity(sourcePath,initialStat),size=Number(initialStat.size);
    const ingestFile=name('ingest.json'),jobFile=name('job.json'),pendingFile=name('pending.json');
    let ingest=fs.existsSync(ingestFile)?unseal(ingestFile):null;
    if(ingest&&(!same(ingest.sourceBinding,sourceBinding)||ingest.resolverIdentity!==resolved.resolverIdentity||ingest.sourceKind!==sourceKind))fail('STREAM_SOURCE_OR_RESOLVER_CHANGED');
    if(ingest&&size<ingest.endByteOffset)fail('STREAM_RAW_TRUNCATED');
    if(!ingest){
      const probeSize=Math.min(size,STREAM_STORE_LIMITS.inputBytes);work.take(probeSize,false);
      const b=exact(fd,0,probeSize),end=b.indexOf(10);
      if(end<0){if(size>=STREAM_STORE_LIMITS.inputBytes)fail('STREAM_RAW_RECORD_BUDGET');return {state:'WAITING_FOR_COMPLETE_RECORD',phase:'INGEST',metrics:{cycleMs:performance.now()-started,backlogBytes:size}};}
      const first=JSON.parse(b.subarray(0,end).toString('utf8'));if(first.previousHash!=='GENESIS')fail('STREAM_RAW_GENESIS_REQUIRED');
      const sourceLedgerIdentity='sha256:'+digest(stableJson({schemaVersion:'cru34-live-ledger-generation-v1',firstRecordHash:first.recordHash,firstReceivedAt:first.receivedAt}));
      ingest={schemaVersion:'cru55-stream-ingest-v2',sourceBinding,sourceLedgerIdentity,resolverIdentity:resolved.resolverIdentity,sourceKind,index:0,lastOrdinal:0,endByteOffset:0,lastChunkHash:null,headPageHash:null};
      atomic(ingestFile,sealed(ingest));
    }
    const store=createStreamStore({root:name('pages'),sourceLedgerIdentity:ingest.sourceLedgerIdentity,resolverIdentity:resolved.resolverIdentity,ioBudget:work,ownerContext});
    fs.mkdirSync(name('chunks'),{recursive:true});
    const chunkPath=i=>name('chunks/'+String(i).padStart(12,'0')+'.json');
    const jobBinding={...(guarded?{sourceVerification,ownerBinding:ownerContext.bindingHash}:{}),sourceBinding,resolverIdentity:resolved.resolverIdentity,sourceKind,stopOrdinal,publishAtSessionBoundary,prefixProtection,projectionMode,...(publicationSchedule?{publicationSchedule}:{}),...(indexLayout?{indexLayout}:{})};
    let job=fs.existsSync(jobFile)?unseal(jobFile):{schemaVersion:'cru55-stream-job-v2',binding:jobBinding,priorPublication,priorPublications,phase:'INGEST',targetSize:size,...(publicationSchedule?{capturedSize:size,startOrdinal:ingest.lastOrdinal}:{}),roundSession:null,startedAt:new Date().toISOString(),verifyRestarts:0};
    if(!same(job.binding,jobBinding))fail('STREAM_JOB_BINDING_CHANGED');
    if(stopOrdinal!==null&&ingest.lastOrdinal>stopOrdinal)fail('STREAM_CUTOFF_REGRESSION');
    if(size<(job.capturedSize??job.targetSize))fail('STREAM_RAW_TRUNCATED');
    if(publicationSchedule&&(!Number.isSafeInteger(job.startOrdinal)||job.startOrdinal<0||job.startOrdinal>ingest.lastOrdinal||!Number.isSafeInteger(job.capturedSize)||job.capturedSize<job.targetSize))fail('STREAM_SCHEDULE_CHECKPOINT_INVALID');
    let pages=0,bytes=0;
    const result=(state,extra={})=>{const sizeNow=Number(fs.fstatSync(fd).size),visible=fs.existsSync(name('stream-public.json'))?json(name('stream-public.json'),65536).endByteOffset:0;return {state,phase:job.phase,sourceLedgerIdentity:ingest.sourceLedgerIdentity,endByteOffset:ingest.endByteOffset,ingestedOrdinal:ingest.lastOrdinal,
      metrics:{...(guarded?{continuityMetadataChunks:continuity.metrics.metadataChunks-continuityChunksBefore,continuity:{...continuity.metrics}}:{}),cycleMs:performance.now()-started,pages:work.pages,rawRanges:work.rawRanges,bytes:work.bytes,budgetScope:'bytes=original raw ranges+archive/index pages; pages=all archive/index reads; ingest batches<=maxPages; verification ranges<=128; bounded metadata/code reads separate',backlogBytes:Math.max(0,sizeNow-ingest.endByteOffset),publicationBacklogBytes:Math.max(0,sizeNow-visible),verificationRestarts:job.verifyRestarts,jobStartedAt:job.startedAt,projectionWork:job.projectionWork??null},...extra};};
    let projectionBatch=null;
    const flushProjection=()=>{if(projectionBatch){job.projection=projectionBatch.finish();projectionBatch=null;}if(job.phase==='QUERY'&&job.projection)job.projection=projectionPrimitives.seal(job.projection);};
    savePending=()=>{flushProjection();atomic(jobFile,sealed(job));atomic(name('lifecycle-status.json'),{state:'PENDING',phase:job.phase,...SAFETY});return result('PENDING',{reason:'WORK_BUDGET'});};
    let savedJob = stableJson(sealed(job));
    if(!fs.existsSync(jobFile))atomic(jobFile,sealed(job)); // Establish the captured cutoff before any append can commit.
    const saveChangedJob=()=>{const next=stableJson(sealed(job));if(next!==savedJob){atomic(jobFile,sealed(job));savedJob=next;}};
    while(job.phase==='INGEST'&&pages<maxPages&&bytes<maxBytes){
      let plan=fs.existsSync(pendingFile)?unseal(pendingFile):null;
      if(!plan){
        if(publicationSchedule&&ingest.lastOrdinal-job.startOrdinal>=publicationSchedule.maxRecords){job.targetSize=ingest.endByteOffset;break;}
        if(stopOrdinal!==null&&ingest.lastOrdinal===stopOrdinal){job.targetSize=ingest.endByteOffset;break;}
        if(ingest.endByteOffset>=job.targetSize)break;
        const size=Math.min(STREAM_STORE_LIMITS.inputBytes,job.targetSize-ingest.endByteOffset);work.take(size,false);
        const b=exact(fd,ingest.endByteOffset,size);
        let end=0,count=0;
        const recordLimit=Math.min(ingest.batchRecords??STREAM_STORE_LIMITS.records,stopOrdinal===null?Infinity:stopOrdinal-ingest.lastOrdinal,publicationSchedule?job.startOrdinal+publicationSchedule.maxRecords-ingest.lastOrdinal:Infinity);
        while(count<recordLimit){
          const n=b.indexOf(10,end);if(n<0)break;
          if(publishAtSessionBoundary){
            const row=JSON.parse(b.subarray(end,n).toString('utf8'));
            const event=materializeTxCanonicalObservations([row],{sourceLedgerIdentity:ingest.sourceLedgerIdentity,ledgerOrdinalOffset:ingest.lastOrdinal+count,resolveSessionTradeDate:resolved.resolveSessionTradeDate}).events[0];
            if(event){
              if(['DAY','NIGHT'].includes(event.session)&&event.tradeDate){
                const key=event.tradeDate+'|'+event.session;
                if(job.roundSession&&job.roundSession!==key){job.targetSize=ingest.endByteOffset+end;break;}
                job.roundSession??=key;
              }
            }
          }
          end=n+1;count++;
        }
        if(!end&&job.targetSize===ingest.endByteOffset)break;
        if(!end){if(b.length>=STREAM_STORE_LIMITS.inputBytes)fail('STREAM_RAW_RECORD_BUDGET');job.targetSize=ingest.endByteOffset;break;}
        plan={index:ingest.index+1,offset:ingest.endByteOffset,length:end,rawHash:digest(b.subarray(0,end)),previousChunkHash:ingest.lastChunkHash,previousPageHash:ingest.headPageHash};
        saveChangedJob(); // Persist changed boundary/round session before append; identical bytes need no second flush.
        atomic(pendingFile,sealed(plan));
      }
      // Recover an append committed before ingest pointer; never replay/count twice.
      if(plan.index===ingest.index){const prior=json(chunkPath(plan.index));if(prior.rawHash!==plan.rawHash||prior.offset!==plan.offset)fail('STREAM_PENDING_CONFLICT');fs.unlinkSync(pendingFile);continue;}
      if(plan.index!==ingest.index+1||plan.offset!==ingest.endByteOffset||plan.previousChunkHash!==ingest.lastChunkHash||plan.previousPageHash!==ingest.headPageHash)fail('STREAM_PENDING_BINDING_INVALID');
      work.take(plan.length,false);const raw=exact(fd,plan.offset,plan.length);if(digest(raw)!==plan.rawHash)fail('STREAM_RAW_PREFIX_CHANGED');
      const records=raw.toString('utf8').trimEnd().split('\n').map(JSON.parse);let appended;
      try{appended=store.append(records,{resolveSessionTradeDate:resolved.resolveSessionTradeDate,quoteCursor:plan.quoteCursor??null,pendingFirstBatchHash:ingest.index===0&&plan.index===1?digest(stableJson(records)):null,maxQueryPages:Math.min(maxPages,STREAM_STORE_LIMITS.queryPages),maxQueryBytes:maxBytes});}
      catch(e){
        if(e.message==='STREAM_QUOTE_QUERY_PENDING'){plan.quoteCursor=e.cursor;atomic(pendingFile,sealed(plan));atomic(jobFile,sealed(job));return result('PENDING',{reason:'QUOTE_QUERY'});}
        if(e.message==='STREAM_STORE_ARTIFACT_BUDGET'&&records.length>1){
          // No page has been published on this failure. Canonical facts can be
          // larger than raw bytes; split the still-uncommitted physical range.
          let end=0;for(let i=0;i<Math.floor(records.length/2);i++)end=raw.indexOf(10,end)+1;
          const {quoteCursor,...base}=plan;plan={...base,length:end,rawHash:digest(raw.subarray(0,end))};
          ingest={...ingest,batchRecords:Math.floor(records.length/2)};atomic(ingestFile,sealed(ingest));
          atomic(pendingFile,sealed(plan));return savePending();
        }
        throw e;
      }
      const {quoteCursor,...plainPlan}=plan;
      const chunk={schemaVersion:'cru55-stream-raw-chunk-v2',...plainPlan,pageHash:appended.headPageHash,sourceLedgerIdentity:ingest.sourceLedgerIdentity,resolverIdentity:resolved.resolverIdentity};
      const chunkHash=digest(stableJson(chunk));immutable(chunkPath(plan.index),{...chunk,chunkHash});
      ingest={...ingest,index:plan.index,lastOrdinal:appended.checkpoint.state.ordinal,endByteOffset:plan.offset+plan.length,lastChunkHash:chunkHash,headPageHash:appended.headPageHash};
      atomic(ingestFile,sealed(ingest));fs.unlinkSync(pendingFile);pages++;bytes+=plan.length;
      // Only a committed complete record may close this publication round.
      if(publicationSchedule&&ingest.lastOrdinal-job.startOrdinal>=publicationSchedule.maxRecords){job.targetSize=ingest.endByteOffset;break;}
    }
    if(job.phase==='INGEST'&&ingest.endByteOffset>=job.targetSize){
      if(!ingest.index){if(fs.existsSync(jobFile))fs.unlinkSync(jobFile);return result('WAITING_FOR_COMPLETE_RECORD');}
      const checkpoint=store.read().checkpoint;
      if(!checkpoint.state.lastPoint){if(fs.existsSync(jobFile))fs.unlinkSync(jobFile);return result('WAITING_FOR_ELIGIBLE_TRADE');}
      const generationHash=digest(stableJson({sourceLedgerIdentity:ingest.sourceLedgerIdentity,resolverIdentity:resolved.resolverIdentity,rawChunkHash:ingest.lastChunkHash,checkpointHash:checkpoint.stateHash}));
      job={...job,activeIdentity:checkpoint.state.activeIdentity,phase:'PROJECT',cutoff:{index:ingest.index,endByteOffset:ingest.endByteOffset,lastChunkHash:ingest.lastChunkHash,headPageHash:ingest.headPageHash},generationHash,nextIndex:1,previousChunkHash:null,previousPageHash:null,projection:createProjectionJob({checkpoint,sourceKind,generationHash,calendar:resolved.calendar})};
      job.projectionWork={mode:projectionMode,rebuildReason:projectionMode==='FULL_SCAN'?'ORACLE_FULL_SCAN':'INITIAL_BUILD',processedRecords:0,newRecords:0,historicalReplayRecords:0,indexedPoints:0,rangeQueries:0,rangeNodes:0,aggregateNodes:0,orderedLeaves:0,rawVerificationBytes:0};
      job.indexBaseOrdinal=fs.existsSync(name('stream-public.json'))?json(name('stream-public.json'),65536).cutoff.ledgerOrdinal:0;
      if(projectionMode==='INDEXED'){
        fs.mkdirSync(name('projection-index'),{recursive:true});
        let previous=null;
        if(fs.existsSync(name('projection-index.json'))){
          previous=unseal(name('projection-index.json'));
          if(!same(previous.binding,jobBinding)||previous.projectionRef!==digest(stableJson(previous.projection))||previous.projection.nextOrdinal!==previous.projection.checkpoint.state.ordinal+1||previous.projection.terminalHash!==previous.projection.checkpoint.state.terminalHash||previous.projection.pageHash!==previous.cutoff.headPageHash)fail('STREAM_INDEX_CHECKPOINT_BINDING');
        }
        const indexed=startIndexedProjection({checkpoint,sourceKind,generationHash,calendar:resolved.calendar,indexLayout},previous);
        job.projection=indexed.projection;job.rangeIndex=indexed.index;job.projectionWork.rebuildReason=indexed.reason;
        job.indexBaseOrdinal=previous?.projection.checkpoint.state.ordinal??0;
        if(indexed.resumed){job.nextIndex=previous.cutoff.index+1;job.previousChunkHash=previous.cutoff.lastChunkHash;job.previousPageHash=previous.cutoff.headPageHash;}
      }
      // Reuse only an exactly matching, content-verified published projection.
      // This skips a redundant derived-history reduction, NEVER the full raw
      // prefix pass or prior verification required before visibility.
      const pointerFile=name('stream-public.json');
      if(fs.existsSync(pointerFile)){
        const pointer=json(pointerFile,65536);
        if(pointer.generationHash===generationHash&&/^[a-f0-9]{64}$/.test(pointer.artifactHash??'')){
          const artifact=json(name(pointer.artifactHash+'.stream-view.json'),PIPELINE_LIMITS.artifactBytes),{artifactHash,...body}=artifact;
          if(artifactHash!==pointer.artifactHash||digest(stableJson(body))!==artifactHash)fail('STREAM_PRIOR_ARTIFACT_INVALID');
          const session=checkpoint.state.activeIdentity?.[2],reference=job.priorPublications?job.priorPublications[session==='DAY'?'night':'day']:job.priorPublication;
          if(artifact.generationHash===generationHash&&(artifact.adjacentArtifactHash??null)===(reference?.artifactHash??null)){
            job.phase='VERIFY';job.activeSession=session;delete job.projection;job.previousPageHash=ingest.headPageHash;job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyStamp=stamp(fs.fstatSync(fd,{bigint:true}));job.reusedArtifactHash=artifactHash;
          }
        }
      }
    }
    while(job.phase==='PROJECT'&&pages<maxPages){
      if(job.nextIndex>job.cutoff.index){
        flushProjection();
        if(projectionMode==='INDEXED'){
          job.projection.display={};job.indexQuery={cursor:null,historicalOrdinal:job.indexBaseOrdinal??0};job.phase='QUERY';job.projection=projectionPrimitives.seal(job.projection);break;
        }
        // Projection no longer changes during verification. Persist it once,
        // content-addressed, instead of serializing/fsyncing its full windows
        // and chart buffers into every raw-verification cursor checkpoint.
        job.projectionRef=digest(stableJson(job.projection));
        immutable(name(job.projectionRef+'.projection.json'),job.projection);
        job.activeSession=job.projection.checkpoint.state.activeIdentity?.[2];delete job.projection;
        job.phase='VERIFY';job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyStamp=stamp(fs.fstatSync(fd,{bigint:true}));break;
      }
      if(indexLayout){
        // One private group per cycle. Reserve one full index-page collision
        // read BEFORE archive reads; replaying an orphan cannot starve progress.
        const append=beginRangeAppend(job.rangeIndex.roots,(hash,node)=>immutablePack(name('projection-index/'+hash+'.json'),node,size=>work.take(size,true)));
        let projection=job.projection,nextIndex=job.nextIndex,previousChunkHash=job.previousChunkHash,previousPageHash=job.previousPageHash;
        let groupPages=0,groupRecords=0,historicalRecords=0,indexedPoints=0;
        let futurePriceExcluded=job.rangeIndex.futurePriceExcluded,maxPointAvailable=job.rangeIndex.maxPointAvailable;
        while(nextIndex<=job.cutoff.index&&groupPages<INDEX_PACK_LIMITS.archivePages&&pages+groupPages<maxPages){
          if(work.pages+2>maxPages)break;
          const chunk=json(chunkPath(nextIndex)),{chunkHash,...body}=chunk;
          if(digest(stableJson(body))!==chunkHash||chunk.previousChunkHash!==previousChunkHash||chunk.previousPageHash!==previousPageHash||chunk.sourceLedgerIdentity!==ingest.sourceLedgerIdentity||chunk.resolverIdentity!==resolved.resolverIdentity)fail('STREAM_CHUNK_CHAIN_INVALID');
          if(!/^[a-f0-9]{64}$/.test(chunk.pageHash??''))fail('STREAM_PAGE_HASH_INVALID');
          const meta=fileMetadata(name('pages/'+chunk.pageHash+'.page.json'),STREAM_STORE_LIMITS.pageBytes);
          if(work.bytes+meta.size+INDEX_PACK_LIMITS.pageBytes>maxBytes)break;
          const page=store.readPage(chunk.pageHash);if(page.previousPageHash!==previousPageHash)fail('STREAM_PAGE_CHAIN_INVALID');
          const mark=append.mark();let addedPoints=0,nextFuture=futurePriceExcluded,nextAvailable=maxPointAvailable;
          const batch=beginProjectionBatch(projection,{onPrice:p=>{nextFuture ||= p.futureExcluded>0;},onPoint:(e,p,prior,pressure)=>{append.append(e,p,prior,pressure);addedPoints++;nextAvailable=Math.max(nextAvailable??-Infinity,e.availableMs);}});
          batch.consume(page);const nextProjection=batch.finish();
          if(append.byteLength()>INDEX_PACK_LIMITS.pageBytes){
            append.rollback(mark);
            if(!groupPages)fail('STREAM_INDEX_PACK_SINGLE_PAGE_BUDGET');
            break; // The already-read rejected page remains charged to work.
          }
          projection=nextProjection;futurePriceExcluded=nextFuture;maxPointAvailable=nextAvailable;indexedPoints+=addedPoints;
          groupPages++;groupRecords+=page.records.length;
          historicalRecords+=Math.max(0,Math.min(page.endOrdinal,job.indexBaseOrdinal??0)-page.startOrdinal+1);
          previousChunkHash=chunkHash;previousPageHash=chunk.pageHash;nextIndex++;
        }
        if(!groupPages)return savePending();
        const indexBytes=append.byteLength(),roots=append.finish(); // durable first
        job.projection=projection;job.rangeIndex={roots,futurePriceExcluded,maxPointAvailable};
        job.nextIndex=nextIndex;job.previousChunkHash=previousChunkHash;job.previousPageHash=previousPageHash;
        job.projectionWork.indexedPoints+=indexedPoints;job.projectionWork.processedRecords+=groupRecords;
        job.projectionWork.historicalReplayRecords+=historicalRecords;
        job.projectionWork.newRecords=job.projectionWork.processedRecords-job.projectionWork.historicalReplayRecords;
        const packs=job.projectionWork.packs??={groups:0,archivePages:0,indexPages:0,indexBytes:0,maxArchivePages:0};
        packs.groups++;packs.archivePages+=groupPages;packs.indexPages+=Number(indexBytes>0);packs.indexBytes+=indexBytes;packs.maxArchivePages=Math.max(packs.maxArchivePages,groupPages);
        // Persist this sole group before any subsequent cycle. Crashes before
        // job replacement replay at most this group's <=896 committed facts.
        return savePending();
      }
      const chunk=json(chunkPath(job.nextIndex)),{chunkHash,...body}=chunk;
      if(digest(stableJson(body))!==chunkHash||chunk.previousChunkHash!==job.previousChunkHash||chunk.previousPageHash!==job.previousPageHash||chunk.sourceLedgerIdentity!==ingest.sourceLedgerIdentity||chunk.resolverIdentity!==ingest.resolverIdentity)fail('STREAM_CHUNK_CHAIN_INVALID');
      const page=store.readPage(chunk.pageHash);if(page.previousPageHash!==job.previousPageHash)fail('STREAM_PAGE_CHAIN_INVALID');
      if(projectionMode==='INDEXED'){
        // Each page is an atomic reducer step. Immutable index nodes become
        // durable before their forest roots can enter the resumable job.
        const append=beginRangeAppend(job.rangeIndex.roots,(hash,node)=>immutable(name('projection-index/'+hash+'.json'),node,PROJECTION_LIMITS.pageBytes,size=>work.take(size,true)));
        let indexedPoints=0,futurePriceExcluded=job.rangeIndex.futurePriceExcluded,maxPointAvailable=job.rangeIndex.maxPointAvailable;
        const batch=beginProjectionBatch(job.projection,{onPrice:p=>{futurePriceExcluded ||= p.futureExcluded>0;},onPoint:(e,p,prior,pressure)=>{append.append(e,p,prior,pressure);indexedPoints++;maxPointAvailable=Math.max(maxPointAvailable??-Infinity,e.availableMs);}});
        batch.consume(page);const projection=batch.finish(),roots=append.finish();
        // Publish the reducer cursor only after collision reads and all index
        // writes succeed. A budget throw leaves the previous page atomic.
        job.projection=projection;job.rangeIndex={roots,futurePriceExcluded,maxPointAvailable};job.projectionWork.indexedPoints+=indexedPoints;
      }else{projectionBatch??=beginProjectionBatch(job.projection);projectionBatch.consume(page);}
      job.projectionWork.processedRecords+=page.records.length;
      job.projectionWork.historicalReplayRecords+=Math.max(0,Math.min(page.endOrdinal,job.indexBaseOrdinal??0)-page.startOrdinal+1);
      job.projectionWork.newRecords=job.projectionWork.processedRecords-job.projectionWork.historicalReplayRecords;
      job.previousChunkHash=chunkHash;job.previousPageHash=chunk.pageHash;job.nextIndex++;pages++;
    }
    flushProjection();
    if(job.phase==='QUERY'){
      const readNode=createRangeReader(hash=>{const file=name('projection-index/'+hash+'.json'),st=fileMetadata(file,PROJECTION_LIMITS.pageBytes);work.take(st.size,true);return json(file,PROJECTION_LIMITS.pageBytes);});
      job.projection=advanceIndexedProjectionQueries(job.projection,job.rangeIndex,job.indexQuery,readNode,job.projectionWork);
      job.projectionRef=digest(stableJson(job.projection));immutable(name(job.projectionRef+'.projection.json'),job.projection);
      atomic(name('projection-index.json'),sealed({schemaVersion:'cru55-indexed-projection-v1',...(indexLayout?{indexLayout}:{}),binding:jobBinding,cutoff:job.cutoff,projectionRef:job.projectionRef,projection:job.projection,index:job.rangeIndex,evidenceScope:'DERIVED_INDEX_ONLY_NOT_RAW_PREFIX_PROOF'}));
      job.activeSession=job.projection.checkpoint.state.activeIdentity?.[2];delete job.projection;delete job.rangeIndex;delete job.indexQuery;
      job.phase='VERIFY';job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyStamp=stamp(fs.fstatSync(fd,{bigint:true}));
    }
    if(job.phase==='VERIFY'){
      if(protectedMode&&!guarded){
        const lease=protectPrefix(runRoot,'current',sourceBinding,job.cutoff.endByteOffset);
        if(job.verifyLease!==lease){
          if(job.verifyIndex>1)job.verifyRestarts++;
          job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyLease=lease;
          // Prior verification can only be reused with its still-live lease.
        }
      }
      const now=stamp(fs.fstatSync(fd,{bigint:true}));
      if(!protectedMode&&!same(now,job.verifyStamp)){job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyStamp=now;job.verifyRestarts++;}
      const currentContext=guarded?{runRoot,role:'current',sessionEpoch:stableJson(job.activeIdentity),sourceBinding,sourceLedgerIdentity:ingest.sourceLedgerIdentity,resolverIdentity:resolved.resolverIdentity}:null;
      if(guarded){
        const v=continuity.verify(runRoot+'|current',currentContext,{endByteOffset:job.cutoff.endByteOffset,lastChunkHash:job.cutoff.lastChunkHash,chunkCount:job.cutoff.index,chunkPath,fd,budget:work,maxRanges:Math.max(0,maxVerifyRanges-work.rawRanges),round:job.startedAt+'|'+job.generationHash});
        if(job.projectionWork)job.projectionWork.rawVerificationBytes=v.metrics.fullReadBytes+v.metrics.suffixReadBytes;
        if(!v.complete){atomic(jobFile,sealed(job));return result('PENDING',{phase:'VERIFY',reason:'CONTINUITY_PREFIX_PENDING'});}
        job.verifyIndex=job.cutoff.index+1;job.verifyOffset=job.cutoff.endByteOffset;job.verifyPreviousHash=job.cutoff.lastChunkHash;
      }
      while(!guarded&&job.verifyIndex<=job.cutoff.index&&work.rawRanges<maxVerifyRanges&&bytes<maxBytes){
        const chunk=json(chunkPath(job.verifyIndex)),{chunkHash,...body}=chunk;
        if(digest(stableJson(body))!==chunkHash||chunk.previousChunkHash!==job.verifyPreviousHash||chunk.offset!==job.verifyOffset||chunk.length<1||chunk.length>STREAM_STORE_LIMITS.inputBytes)fail('STREAM_CHUNK_CHAIN_INVALID');
        work.take(chunk.length,false);if(digest(exact(fd,chunk.offset,chunk.length))!==chunk.rawHash)fail('STREAM_RAW_PREFIX_CHANGED');
        if(job.projectionWork)job.projectionWork.rawVerificationBytes+=chunk.length;
        job.verifyOffset+=chunk.length;job.verifyPreviousHash=chunkHash;job.verifyIndex++;pages++;bytes+=chunk.length;
      }
      if(protectedMode&&!guarded)assertPrefixProtected(runRoot,'current',job.verifyLease);
      if(!protectedMode&&!same(stamp(fs.fstatSync(fd,{bigint:true})),job.verifyStamp)){job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyStamp=stamp(fs.fstatSync(fd,{bigint:true}));job.verifyRestarts++;}
      else if(job.verifyIndex>job.cutoff.index){
        if(job.verifyOffset!==job.cutoff.endByteOffset||job.verifyPreviousHash!==job.cutoff.lastChunkHash||job.previousPageHash!==job.cutoff.headPageHash)fail('STREAM_VERIFIED_CUTOFF_MISMATCH');
        const oldPointer=fs.existsSync(name('stream-public.json'))?json(name('stream-public.json'),65536):null;
        let priorArtifact=null;
        if(oldPointer){
          if(!/^[a-f0-9]{64}$/.test(oldPointer.artifactHash??''))fail('STREAM_PRIOR_POINTER_INVALID');
          priorArtifact=json(name(oldPointer.artifactHash+'.stream-view.json'),PIPELINE_LIMITS.artifactBytes);
          const {artifactHash,...priorBody}=priorArtifact;if(artifactHash!==oldPointer.artifactHash||digest(stableJson(priorBody))!==artifactHash)fail('STREAM_PRIOR_ARTIFACT_INVALID');
        }
        let adjacent=null,revalidatedPrior=null;
        const actualSession=job.activeSession;
        const reference=job.priorPublications?job.priorPublications[actualSession==='DAY'?'night':'day']:job.priorPublication;
        if(reference){
          const artifact=readPriorArtifact(reference,{allowContinuity:guarded});adjacent=artifact.view;
          job.priorVerification??=beginPriorVerification(reference,{allowContinuity:guarded});
          if(job.priorVerification.reference.artifactHash!==reference.artifactHash)fail('STREAM_PRIOR_JOB_REFERENCE_CHANGED');
          const verification=advancePriorVerification(job.priorVerification,{budget:work,maxRanges:Math.max(0,maxVerifyRanges-work.rawRanges),protectionGroup:protectedMode&&!guarded?runRoot:null,continuity:guarded?continuity:null,runRoot,verificationRound:job.startedAt+'|'+job.generationHash});
          job.priorVerification=verification.state;pages+=verification.ranges;
          if(!verification.complete){atomic(jobFile,sealed(job));return result('PENDING',{phase:'VERIFY_PRIOR',reason:'PRIOR_RAW_PREFIX_PENDING'});}
          if(guarded){
            // Prior may be from the same physical file or a dead writer epoch.
            // Re-attest its unchanged view only after this owner's independent
            // prior proof. Do not relabel old availability as newly observed data.
            const {artifactHash:originalHash,...originalBody}=artifact;
            const currentProducer=continuity.publication().producer;
            const sameEpoch=same(artifact.integrity.producer,currentProducer);
            const priorBody=sameEpoch?originalBody:{...originalBody,
              revalidatedFromArtifactHash:originalHash,
              integrity:{...artifact.integrity,producer:currentProducer}};
            const newHash=digest(stableJson(priorBody)),newArtifact={...priorBody,artifactHash:newHash};
            const priorRoot=path.dirname(reference.artifactPath),relative=path.relative(ownerContext.outputRoot,priorRoot).split(path.sep).join('/');
            if(!/^sources\/[a-f0-9]{64}$/.test(relative))fail('STREAM_PRIOR_OUTPUT_ESCAPE');
            immutable(path.join(priorRoot,newHash+'.stream-view.json'),newArtifact,PIPELINE_LIMITS.artifactBytes);
            const c=artifact.view.charts['1m'];
            revalidatedPrior={schemaVersion:'cru55-stream-public-v3',relativeRunPath:relative,sourceKey:path.basename(priorRoot),
              artifactHash:newHash,producerEpoch:currentProducer.epoch,publishedAt:new Date().toISOString(),
              originalPublishedAt:reference.publishedAt??null,session:c.session,tradeDate:c.tradeDate,availableAt:c.availableAt,cutoff:c.cutoff};
            if(!continuity.publish(priorRoot,c.session,newHash,[job.priorVerification.continuityRequirement],revalidatedPrior.publishedAt,{availableAt:c.availableAt,cutoff:c.cutoff}))revalidatedPrior=null;
          }
        }
        const adjacentArtifactHash=reference?.artifactHash??null;
        const reusable=priorArtifact?.generationHash===job.generationHash&&(priorArtifact.adjacentArtifactHash??null)===adjacentArtifactHash;
        if(job.reusedArtifactHash&&(!reusable||priorArtifact.artifactHash!==job.reusedArtifactHash))fail('STREAM_REUSED_PROJECTION_CHANGED');
        let projection=null;
        if(!reusable){
          if(!/^[a-f0-9]{64}$/.test(job.projectionRef??''))fail('STREAM_PROJECTION_REFERENCE_INVALID');
          projection=json(name(job.projectionRef+'.projection.json'));
          if(digest(stableJson(projection))!==job.projectionRef||projection.generationHash!==job.generationHash||projection.checkpoint.state.activeIdentity?.[2]!==actualSession||projection.checkpoint.state.sourceLedgerIdentity!==ingest.sourceLedgerIdentity||projection.checkpoint.state.resolverIdentity!==resolved.resolverIdentity)fail('STREAM_PROJECTION_REFERENCE_CHANGED');
        }
        const finished=reusable?priorArtifact.view:finishProjectionJob(projection,{prior:adjacent??priorArtifact?.view??null,previousPublication:priorArtifact?.view??null}),view=finished.view??finished;
        const body={schemaVersion:guarded?'cru55-stream-view-v3':'cru55-stream-view-v2',generationHash:job.generationHash,sourceLedgerIdentity:ingest.sourceLedgerIdentity,adjacentArtifactHash,
          ...(guarded?{researchEligibility:CONTINUITY_RESEARCH}:{}),
          integrity:{...(guarded?continuity.publication():{policy:FULL_PREFIX_POLICY}),originalRawPrefixVerified:!guarded,...(guarded?{guardedPrefixVerified:true,chunkCount:job.cutoff.index}:{}),adjacentRawPrefixVerified:reference?!guarded:null,...(guarded?{adjacentGuardedPrefixVerified:reference?true:null}:{}),endByteOffset:job.cutoff.endByteOffset,rawChunkHash:job.cutoff.lastChunkHash,stableVerificationRequired:true,protection:protectedMode?'WINDOWS_SHARED_RANGE_READONLY_SECTION':'WHOLE_FILE_STAMP'},view,...SAFETY};
        const artifactHash=digest(stableJson(body)),artifact={...body,artifactHash};
        immutable(name(artifactHash+'.stream-view.json'),artifact,PIPELINE_LIMITS.artifactBytes);
        // Recheck after serialization and every replacement wait. A legitimate
        // changing stamp/prior returns to verification without exposing a pointer.
        let changedReason=null;
        const currentTarget={endByteOffset:job.cutoff.endByteOffset,lastChunkHash:job.cutoff.lastChunkHash,chunkCount:job.cutoff.index};
        const beforePublish=()=>{
          if(guarded)continuity.assertReady(runRoot+'|current',currentContext,currentTarget);
          assertPlainPath(sourcePath);
          if(!same(identity(sourcePath,fs.statSync(sourcePath,{bigint:true})),sourceBinding))fail('STREAM_SOURCE_REPLACED');
          if(reference&&!priorStillVerified(job.priorVerification,{protectionGroup:protectedMode&&!guarded?runRoot:null,continuity:guarded?continuity:null,runRoot,verificationRound:job.startedAt+'|'+job.generationHash})){changedReason='PRIOR_SOURCE_CHANGED_DURING_VERIFY';return false;}
          if(protectedMode&&!guarded)assertPrefixProtected(runRoot,'current',job.verifyLease);
          if(!protectedMode&&!same(stamp(fs.fstatSync(fd,{bigint:true})),job.verifyStamp)){job.verifyIndex=1;job.verifyOffset=0;job.verifyPreviousHash=null;job.verifyRestarts++;changedReason='SOURCE_CHANGED_DURING_VERIFY';return false;}
          return true;
        };
        const c=view.charts['1m'],pointer={schemaVersion:guarded?'cru55-stream-public-v3':'cru55-stream-public-v2',...(guarded?{producerEpoch:continuity.publication().producer.epoch,publishedAt:new Date().toISOString()}: {}),artifactHash,generationHash:job.generationHash,session:c.session,tradeDate:c.tradeDate,cutoff:c.cutoff,availableAt:c.availableAt,sourceLedgerIdentity:ingest.sourceLedgerIdentity,endByteOffset:job.cutoff.endByteOffset};
        const old=fs.existsSync(name('stream-public.json'))?json(name('stream-public.json'),65536):null;
        if(!atomic(name('stream-public.json'),pointer,65536,beforePublish)){atomic(jobFile,sealed(job));return result('PENDING',{...(changedReason==='PRIOR_SOURCE_CHANGED_DURING_VERIFY'?{phase:'VERIFY_PRIOR'}:{}),reason:changedReason});}
        if(fs.existsSync(jobFile))fs.unlinkSync(jobFile);
        atomic(name('lifecycle-status.json'),{state:'PUBLISHED',artifactHash,verifiedAt:new Date().toISOString(),...SAFETY});
        if(guarded){
          const requirements=[{key:runRoot+'|current',context:currentContext,target:currentTarget}];
          if(job.priorVerification?.continuityRequirement)requirements.push(job.priorVerification.continuityRequirement);
          continuity.publish(runRoot,pointer.session,artifactHash,requirements,pointer.publishedAt,{availableAt:pointer.availableAt,cutoff:pointer.cutoff});
        }else releasePrefixGuards(runRoot);
        return result(old?.artifactHash===artifactHash?'UNCHANGED':'PUBLISHED',{...pointer,...(revalidatedPrior?{revalidatedPrior}:{})});
      }
    }
    atomic(jobFile,sealed(job));atomic(name('lifecycle-status.json'),{state:'PENDING',phase:job.phase,verifyRestarts:job.verifyRestarts,...SAFETY});
    return result('PENDING');
  }catch(e){if(e.message==='STREAM_WORK_BUDGET_PENDING'&&savePending)return savePending();if(guarded)continuity.invalidate(e.message);releasePrefixGuards(runRoot);atomic(name('lifecycle-status.json'),{state:'BLOCKED',error:e.message,...SAFETY});throw e;}
  finally{if(fd!==undefined)fs.closeSync(fd);if(releaseManaged)releaseManaged();if(owned&&json(path.join(lock,'owner.json')).token===token){fs.unlinkSync(path.join(lock,'owner.json'));fs.rmdirSync(lock);}}
}

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {digest,stableJson} from './cvd-observation-core.mjs';
import {assertPlainPath} from './cvd-observation-isolation.mjs';
import {replaceDurableFileSync} from './cru55-atomic-replace.mjs';
import {protectPrefix,assertPrefixProtected,releasePrefixGuards} from './cru55-prefix-guard.mjs';
import {nativeManagedProcess,probeManagedProcess} from './cru55-managed-owner.mjs';
import {CONTINUITY_POLICY,CONTINUITY_RESEARCH} from './cru55-continuity-policy.mjs';

const equal=(a,b)=>stableJson(a)===stableJson(b),hash=x=>/^[a-f0-9]{64}$/.test(x??'');
const fail=message=>{throw Error('CRU55_CONTINUITY_'+message);};
const instances=new WeakSet();
const within=(root,file)=>{const p=path.relative(root,file);return p!==''&&!p.startsWith('..'+path.sep)&&p!=='..'&&!path.isAbsolute(p);};
function read(file,cap=65536){assertPlainPath(file);const s=fs.statSync(file);if(!s.isFile()||s.nlink!==1||s.size>cap)fail('FILE_INVALID');return JSON.parse(fs.readFileSync(file,'utf8'));}
function write(file,value){
  assertPlainPath(file);const tmp=assertPlainPath(file+'.'+crypto.randomUUID()+'.tmp'),fd=fs.openSync(tmp,'wx');
  try{fs.writeFileSync(fd,stableJson(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  try{replaceDurableFileSync(tmp,file);}finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
}
function source(binding,end){
  const s=fs.statSync(assertPlainPath(binding.path),{bigint:true});
  if(!s.isFile()||s.nlink!==1n||String(s.dev)!==binding.dev||String(s.ino)!==binding.ino||String(s.birthtimeNs)!==binding.birthtimeNs||s.size<BigInt(end))fail('SOURCE_CHANGED');
}

// The only reusable raw proof lives here, in one real managed owner's memory.
// Durable job cursors, public status and artifact metadata never restore proof.
export class ManagedContinuity {
  #owner; #producer; #status; #roles=new Map(); #publications={}; #closed=false;
  metrics={fullReadBytes:0,suffixReadBytes:0,metadataChunks:0,verifications:0};
  constructor(owner){
    if(owner?.pid!==process.pid||!hash(owner.bindingHash)||!hash(digest(stableJson(owner)))||!owner.nonce)fail('OWNER_INVALID');
    const actual=probeManagedProcess(owner.pid);
    if(actual.state!=='PRESENT'||actual.startTime!==owner.startTime||actual.commandLine!==owner.commandLine)fail('OWNER_MISMATCH');
    this.#owner=structuredClone(owner);
    this.#producer={epoch:crypto.randomUUID(),owner:structuredClone(owner),creationTime:nativeManagedProcess(owner.pid)};
    this.#status=assertPlainPath(path.join(owner.outputRoot,'stream-continuity-status.json'));
    instances.add(this);this.#save('INVALID','START_OR_RESTART_REQUIRES_FULL_VERIFY');
  }
  #save(state,reason=null){write(this.#status,{schemaVersion:'cru55-continuity-status-v1',policy:CONTINUITY_POLICY,state,reason,
    producer:this.#producer,publications:this.#publications,at:new Date().toISOString(),researchEligibility:CONTINUITY_RESEARCH});}
  assertOwner(owner){
    if(this.#closed||!equal(owner,this.#owner))fail('OWNER_CHANGED');
    nativeManagedProcess(owner.pid,this.#producer.creationTime);
    const disk=read(path.join(owner.outputRoot,'managed-owner.lock','owner.json'));
    if(disk.schemaVersion!=='cru55-managed-owner-v1'||Object.keys(owner).some(k=>!equal(disk[k],owner[k])))fail('OWNER_RECORD_CHANGED');
  }
  invalidate(reason='STOPPED'){
    // If durable invalidation fails, retain ALL guards. Caller must stop the
    // writer; the reader's native process check then invalidates it on death.
    this.#publications={};this.#save('INVALID',reason);
    const errors=[];
    for(const s of this.#roles.values())try{releasePrefixGuards(s.group,{checked:true});}catch(e){errors.push(e);}
    this.#roles.clear();
    if(errors.length)throw new AggregateError(errors,'CRU55_CONTINUITY_CLEANUP_FAILED');
  }
  close(){if(this.#closed)return;this.invalidate('STOPPED');this.#closed=true;}
  #live(s){source(s.context.sourceBinding,s.end);assertPrefixProtected(s.group,'prefix',s.lease);}
  #get(key,context,end){
    this.assertOwner(this.#owner);
    if(!within(this.#owner.outputRoot,context.runRoot)||!['current','prior'].includes(context.role)||!context.sessionEpoch||!context.sourceLedgerIdentity||!context.resolverIdentity)fail('CONTEXT_INVALID');
    if(!Number.isSafeInteger(end)||end<1)fail('CUTOFF_INVALID');
    source(context.sourceBinding,end);
    let s=this.#roles.get(key);
    if(s&&!equal(s.context,context)){
      this.#publications={};this.#save('INVALID','ROLE_CONTEXT_CHANGED');
      releasePrefixGuards(s.group,{checked:true});this.#roles.delete(key);s=null;
    }
    if(s){try{this.#live(s);}catch(e){if(e.message!=='STREAM_PREFIX_LEASE_LOST')throw e;this.invalidate('GUARD_LOST_REQUIRES_FULL_VERIFY');s=null;}}
    if(s&&end<s.end)fail('CUTOFF_REGRESSION');
    if(!s||end>s.end){
      const next={context:structuredClone(context),end,group:'managed-continuity:'+crypto.randomUUID(),lease:null,receipt:s?.receipt??null,pending:null};
      next.lease=protectPrefix(next.group,'prefix',context.sourceBinding,end);
      // Register the new guard before any fallible operation, so failure cleanup
      // includes it. The old guard stays live until overlap is proven.
      this.#roles.set(key,next);
      try{this.#live(next);if(s)this.#live(s);}catch(e){if(s) this.#roles.set(key+':retiring',s);throw e;}
      if(s)releasePrefixGuards(s.group,{checked:true});
      s=next;
    }
    return s;
  }
  verify(key,context,{endByteOffset,lastChunkHash,chunkCount,chunkPath,fd,budget,maxRanges=128,round}){
    try{
      const s=this.#get(key,context,endByteOffset);
      if(!hash(lastChunkHash)||!Number.isSafeInteger(chunkCount)||chunkCount<1)fail('TARGET_INVALID');
      if(typeof round!=='string'||!round)fail('ROUND_REQUIRED');
      const target={endByteOffset,lastChunkHash,chunkCount};
      if(s.verifiedRound===round&&equal(s.receipt,target)){this.#live(s);return {complete:true,ranges:0,metrics:s.lastMetrics};}
      if(s.pending&&(!equal(s.pending.target,target)||s.pending.round!==round))fail('PENDING_TARGET_CHANGED');
      const p=s.pending??={target,round,index:1,offset:0,previous:null,anchorSeen:!s.receipt,fullReadBytes:0,suffixReadBytes:0};
      let ranges=0;
      while(p.index<=chunkCount&&ranges<maxRanges){
        const {chunkHash,...c}=read(chunkPath(p.index));
        if(!hash(chunkHash)||digest(stableJson(c))!==chunkHash||c.previousChunkHash!==p.previous||c.offset!==p.offset||!Number.isSafeInteger(c.length)||c.length<1||c.length>512*1024||c.offset+c.length>endByteOffset||c.sourceLedgerIdentity!==context.sourceLedgerIdentity||c.resolverIdentity!==context.resolverIdentity||!hash(c.rawHash))fail('CHUNK_CHAIN_INVALID');
        const reuse=s.receipt&&p.index<=s.receipt.chunkCount;
        if(!reuse){
          if(!budget.canTake(c.length,false))break;
          budget.take(c.length,false);const bytes=Buffer.alloc(c.length);let n=0;
          while(n<c.length){const count=fs.readSync(fd,bytes,n,c.length-n,c.offset+n);if(!count)fail('RAW_TRUNCATED');n+=count;}
          if(digest(bytes)!==c.rawHash)fail('RAW_CHANGED');
          const kind=s.receipt?'suffixReadBytes':'fullReadBytes';p[kind]+=n;this.metrics[kind]+=n;
        }
        p.offset+=c.length;p.previous=chunkHash;this.metrics.metadataChunks++;ranges++;
        if(s.receipt&&p.index===s.receipt.chunkCount){if(p.offset!==s.receipt.endByteOffset||p.previous!==s.receipt.lastChunkHash)fail('RECEIPT_CHAIN_CHANGED');p.anchorSeen=true;}
        p.index++;
      }
      this.#live(s);
      if(p.index<=chunkCount)return {complete:false,ranges,metrics:{fullReadBytes:p.fullReadBytes,suffixReadBytes:p.suffixReadBytes}};
      if(p.offset!==endByteOffset||p.previous!==lastChunkHash||!p.anchorSeen)fail('CUTOFF_CHAIN_MISMATCH');
      s.receipt=Object.freeze({...target});s.pending=null;s.verifiedRound=round;s.lastMetrics={fullReadBytes:p.fullReadBytes,suffixReadBytes:p.suffixReadBytes};this.metrics.verifications++;
      return {complete:true,ranges,metrics:{fullReadBytes:p.fullReadBytes,suffixReadBytes:p.suffixReadBytes}};
    }catch(e){this.invalidate(e.message);throw e;}
  }
  assertReady(key,context,target){
    this.assertOwner(this.#owner);const s=this.#roles.get(key);
    if(!s||!equal(s.context,context)||!equal(s.receipt,target))fail('RECEIPT_NOT_LIVE');
    this.#live(s);return true;
  }
  publication(){return {policy:CONTINUITY_POLICY,producer:structuredClone(this.#producer),researchEligibility:CONTINUITY_RESEARCH};}
  publish(runRoot,session,artifactHash,requirements,publishedAt){
    for(const r of requirements)this.assertReady(r.key,r.context,r.target);
    this.#publications[runRoot+'|'+session]={artifactHash,publishedAt};this.#save('VALID');
  }
}
export function assertManagedContinuity(instance,owner){if(!instances.has(instance))fail('MANAGED_INSTANCE_REQUIRED');instance.assertOwner(owner);}

export function assertContinuityPublication(root,artifact,pointer,bindingHash){
  const p=artifact.integrity?.producer;
  if(!bindingHash||p?.owner?.bindingHash!==bindingHash||p.owner.outputRoot!==root||pointer.producerEpoch!==p.epoch||artifact.researchEligibility?.eligible!==false)fail('READER_BINDING');
  const status=read(path.join(root,'stream-continuity-status.json'),128*1024);
  if(status.state!=='VALID'||!equal(status.producer,p)||!Object.values(status.publications??{}).some(x=>x.artifactHash===artifact.artifactHash&&x.publishedAt===pointer.publishedAt))fail('PUBLICATION_INVALID');
  const owner=read(path.join(root,'managed-owner.lock','owner.json'));
  if(owner.schemaVersion!=='cru55-managed-owner-v1'||Object.keys(p.owner).some(k=>!equal(owner[k],p.owner[k])))fail('OWNER_RECORD_CHANGED');
  nativeManagedProcess(p.owner.pid,p.creationTime);
}

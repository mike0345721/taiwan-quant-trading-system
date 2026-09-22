import fs from 'node:fs';
import path from 'node:path';
import {assertPlainPath} from './cvd-observation-isolation.mjs';
import {digest,stableJson,SAFETY} from './cvd-observation-core.mjs';
const equal=(a,b)=>stableJson(a)===stableJson(b),hash=x=>/^[a-f0-9]{64}$/.test(x??'');
const identity=(file,st)=>({path:file,dev:String(st.dev),ino:String(st.ino),birthtimeNs:String(st.birthtimeNs)});
const stamp=st=>({size:Number(st.size),mtimeNs:String(st.mtimeNs),ctimeNs:String(st.ctimeNs)});
function json(file,cap){assertPlainPath(file);const s=fs.statSync(file);if(!s.isFile()||s.nlink!==1||s.size>cap)throw Error('STREAM_PRIOR_FILE_INVALID');return JSON.parse(fs.readFileSync(file,'utf8'));}
export function readPriorArtifact(reference){
  if(!reference||!hash(reference.artifactHash)||!path.isAbsolute(reference.artifactPath??'')||path.basename(reference.artifactPath)!==reference.artifactHash+'.stream-view.json')throw Error('STREAM_ADJACENT_REFERENCE_INVALID');
  const a=json(reference.artifactPath,32*1024*1024),{artifactHash,...body}=a;
  if(artifactHash!==reference.artifactHash||digest(stableJson(body))!==artifactHash||a.schemaVersion!=='cru55-stream-view-v2'||a.integrity?.originalRawPrefixVerified!==true||a.integrity?.policy!=='FULL_PREFIX_BEFORE_PUBLICATION'||Object.entries(SAFETY).some(([k,v])=>a[k]!==v))throw Error('STREAM_ADJACENT_ARTIFACT_INVALID');
  return a;
}
export function beginPriorVerification(reference){
  const artifact=readPriorArtifact(reference),root=path.dirname(reference.artifactPath),sealed=json(path.join(root,'ingest.json'),65536),ingest=sealed.value;
  if(digest(stableJson(ingest))!==sealed.hash||ingest.sourceLedgerIdentity!==artifact.sourceLedgerIdentity||!path.isAbsolute(ingest.sourceBinding?.path??'')||!hash(artifact.integrity.rawChunkHash)||!Number.isSafeInteger(artifact.integrity.endByteOffset)||artifact.integrity.endByteOffset<1)throw Error('STREAM_PRIOR_INGEST_BINDING_INVALID');
  return {schemaVersion:'cru55-stream-prior-verification-v1',reference,root,sourceBinding:ingest.sourceBinding,sourceLedgerIdentity:ingest.sourceLedgerIdentity,resolverIdentity:ingest.resolverIdentity,
    targetOffset:artifact.integrity.endByteOffset,targetChunkHash:artifact.integrity.rawChunkHash,index:1,offset:0,previousHash:null,stamp:null,restarts:0,complete:false};
}
export function advancePriorVerification(input,{budget,maxRanges=8}={}){
  const s=structuredClone(input),file=assertPlainPath(s.sourceBinding.path),fd=fs.openSync(file,'r');let ranges=0;
  try{
    const st=fs.fstatSync(fd,{bigint:true});if(!st.isFile()||st.nlink!==1n||!equal(identity(file,st),s.sourceBinding)||Number(st.size)<s.targetOffset)throw Error('STREAM_PRIOR_SOURCE_CHANGED');
    const now=stamp(st);
    if(!equal(now,s.stamp)){if(s.stamp)s.restarts++;s.index=1;s.offset=0;s.previousHash=null;s.complete=false;s.stamp=now;}
    while(s.offset<s.targetOffset&&ranges<maxRanges){
      const chunk=json(path.join(s.root,'chunks',String(s.index).padStart(12,'0')+'.json'),65536),{chunkHash,...body}=chunk;
      if(digest(stableJson(body))!==chunkHash||chunk.previousChunkHash!==s.previousHash||chunk.offset!==s.offset||chunk.sourceLedgerIdentity!==s.sourceLedgerIdentity||chunk.resolverIdentity!==s.resolverIdentity||!Number.isInteger(chunk.length)||chunk.length<1||chunk.length>512*1024||s.offset+chunk.length>s.targetOffset)throw Error('STREAM_PRIOR_CHUNK_CHAIN_INVALID');
      if(!budget.canTake(chunk.length,false))break;budget.take(chunk.length,false);
      const bytes=Buffer.alloc(chunk.length);let n=0;while(n<bytes.length){const count=fs.readSync(fd,bytes,n,bytes.length-n,s.offset+n);if(!count)throw Error('STREAM_PRIOR_SOURCE_TRUNCATED');n+=count;}
      if(digest(bytes)!==chunk.rawHash)throw Error('STREAM_PRIOR_RAW_PREFIX_CHANGED');
      s.offset+=chunk.length;s.previousHash=chunkHash;s.index++;ranges++;
    }
    if(!equal(identity(file,fs.statSync(file,{bigint:true})),s.sourceBinding))throw Error('STREAM_PRIOR_SOURCE_REPLACED');
    if(!equal(stamp(fs.fstatSync(fd,{bigint:true})),s.stamp)){s.stamp=null;s.complete=false;return {state:s,ranges,complete:false};}
    s.complete=s.offset===s.targetOffset&&s.previousHash===s.targetChunkHash;
    if(s.offset===s.targetOffset&&!s.complete)throw Error('STREAM_PRIOR_PREFIX_CUTOFF_MISMATCH');
    return {state:s,ranges,complete:s.complete};
  }finally{fs.closeSync(fd);}
}
export function priorStillVerified(state){
  if(!state?.complete)return false;const file=assertPlainPath(state.sourceBinding.path),s=fs.statSync(file,{bigint:true});
  if(!equal(identity(file,s),state.sourceBinding))throw Error('STREAM_PRIOR_SOURCE_REPLACED');
  return equal(stamp(s),state.stamp);
}

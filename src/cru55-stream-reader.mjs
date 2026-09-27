import fs from 'node:fs';
import path from 'node:path';
import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';
import { FRAMES,withFreshness } from './cvd-chart-projection.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import {assertContinuityPublication} from './cru55-guarded-continuity.mjs';
import {CONTINUITY_PRODUCER,CONTINUITY_POLICY} from './cru55-continuity-policy.mjs';
import { buildActiveSegmentObservation } from './cru55-active-segment-observation.mjs';

const hash=x=>/^[a-f0-9]{64}$/.test(x??'');
function read(file,cap){assertPlainPath(file);const st=fs.statSync(file);if(!st.isFile()||st.nlink!==1||st.size>cap)throw Error('CRU55_STREAM_ARTIFACT_BUDGET');return JSON.parse(fs.readFileSync(file,'utf8'));}
export function createStreamReader(root,{bindingHash=null,producer='STREAM_PAGED_V2'}={}){
  let cachedKey,cached;
  const guarded=producer===CONTINUITY_PRODUCER;
  return ({view='day',timeframe='1m'}={})=>{
    if(!['day','night'].includes(view)||!FRAMES.includes(timeframe))throw Error('CRU55_QUERY_INVALID');
    const managedStatus=path.join(root,'stream-managed-status.json');
    if(fs.existsSync(managedStatus)&&read(managedStatus,65536).state==='BLOCKED')throw Error('CRU55_PRODUCER_BLOCKED');
    let dir,pointer;
    const selectionFile=path.join(root,'stream-selection.json');
    if(fs.existsSync(selectionFile)){
      const selection=read(selectionFile,128*1024),entry=selection.views?.[view];
      if(bindingHash&&selection.bindingHash!==bindingHash)throw Error('CRU55_STREAM_SELECTION_BINDING_CHANGED');
      if(selection.schemaVersion!=='cru55-stream-selection-v1'||Object.entries(SAFETY).some(([k,v])=>selection[k]!==v)||!entry||!hash(entry.artifactHash)||!/^sources\/[a-f0-9]{64}$/.test(entry.relativeRunPath??''))throw Error('CRU55_STREAM_SELECTION_INVALID');
      if(guarded&&entry.schemaVersion!=='cru55-stream-public-v3')throw Error('CRU55_STREAM_POINTER_POLICY');
      if(!guarded&&entry.schemaVersion==='cru55-stream-public-v3')throw Error('CRU55_STREAM_POINTER_POLICY');
      if(entry.relativeRunPath!=='sources/'+entry.sourceKey||entry.session?.toLowerCase()!==view)throw Error('CRU55_STREAM_SELECTION_IDENTITY');
      dir=assertPlainPath(path.join(root,...entry.relativeRunPath.split('/')));pointer=entry;
    }else{
      if(bindingHash)throw Error('CRU55_STREAM_BOUND_SELECTION_REQUIRED');
      dir=assertPlainPath(path.join(root,view));pointer=read(path.join(dir,'stream-public.json'),65536);
      if(pointer.schemaVersion!==(guarded?'cru55-stream-public-v3':'cru55-stream-public-v2'))throw Error('CRU55_STREAM_POINTER_INVALID');
    }
    const statusPath=path.join(dir,'lifecycle-status.json');
    const status=fs.existsSync(statusPath)?read(statusPath,65536):{state:'UNKNOWN'};
    if(status.state==='BLOCKED')throw Error('CRU55_PRODUCER_BLOCKED');
    if(!hash(pointer.artifactHash))throw Error('CRU55_STREAM_POINTER_INVALID');
    const key=dir+'|'+pointer.artifactHash;
    if(key!==cachedKey){
      const a=read(path.join(dir,pointer.artifactHash+'.stream-view.json'),32*1024*1024),{artifactHash,...body}=a;
      if(artifactHash!==pointer.artifactHash||digest(stableJson(body))!==artifactHash||a.schemaVersion!==(guarded?'cru55-stream-view-v3':'cru55-stream-view-v2')||(guarded?a.integrity?.guardedPrefixVerified!==true||a.integrity?.policy!==CONTINUITY_POLICY:a.integrity?.originalRawPrefixVerified!==true||a.integrity?.policy!=='FULL_PREFIX_BEFORE_PUBLICATION')||Object.entries(SAFETY).some(([k,v])=>a[k]!==v))throw Error('CRU55_STREAM_ARTIFACT_INVALID');
      const projected=a.view;
      if(!hash(projected.projectionHash)||!['GOVERNED_FRAGMENT','SYNTHETIC_FIXTURE'].includes(projected.kind))throw Error('CRU55_STREAM_PROJECTION_INVALID');
      for(const frame of FRAMES){
        const c=projected.charts[frame],r=projected.relationships[frame],s=projected.sessionContext,h=projected.handoffs[frame];
        for(const x of [c,r,s,h])if(x.generationHash!==a.generationHash||x.projectionHash!==projected.projectionHash||x.evidenceKind!==projected.kind||Object.entries(SAFETY).some(([k,v])=>x[k]!==v))throw Error('CRU55_STREAM_BINDING_INVALID');
        if(c.session?.toLowerCase()!==view||c.cutoff.sourceLedgerIdentity!==a.sourceLedgerIdentity||[r,s,h].some(x=>stableJson(x.sourceCutoff)!==stableJson(c.cutoff)))throw Error('CRU55_STREAM_CUTOFF_INVALID');
      }
      cached=a;cachedKey=key;
    }
    if(guarded)assertContinuityPublication(root,cached,pointer,bindingHash);
    const p=cached.view,c=p.charts[timeframe];
    if(pointer.cutoff&&stableJson(pointer.cutoff)!==stableJson(c.cutoff))throw Error('CRU55_STREAM_POINTER_CUTOFF_INVALID');
    const chart=withFreshness(c);
    return {view,kind:p.kind,artifactHash:cached.artifactHash,producerMode:producer,rawReadsPerRequest:0,
      integrity:cached.integrity,...(guarded?{researchEligibility:cached.researchEligibility}:{}),publication:{state:status.state,phase:status.phase??null,scope:guarded?'GUARDED_HISTORICAL_CUTOFF':'VERIFIED_HISTORICAL_CUTOFF',...(guarded?{publishedAt:pointer.publishedAt}: {})},...SAFETY,
      chart,relationship:p.relationships[timeframe],context:{...p.sessionContext,freshness:chart.freshness},handoff:p.handoffs[timeframe],
      activeSegmentObservation:buildActiveSegmentObservation({artifactHash:cached.artifactHash,chart:c,relationship:p.relationships[timeframe]}),
      scan:Object.fromEntries(FRAMES.map(f=>[f,{timeframe:f,windowMs:p.relationships[f].windowMs,current:p.relationships[f].current}]))};
  };
}

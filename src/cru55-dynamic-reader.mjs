import fs from 'node:fs';
import path from 'node:path';
import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';
import { FRAMES,withFreshness } from './cvd-chart-projection.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { createStreamReader } from './cru55-stream-reader.mjs';
// Cache only a verified public artifact; no raw source path or checkpoint reaches HTTP.
export function createDynamicReader(root,options={}){
  let cachedHash,cached,cachedKey;
  const stream=root?createStreamReader(root,options):null;
  const json=(file,cap)=>{assertPlainPath(file);const stat=fs.statSync(file);if(!stat.isFile()||stat.nlink!==1||stat.size>cap)throw Error('CRU55_ARTIFACT_BUDGET');return JSON.parse(fs.readFileSync(file,'utf8'));};
  return ({view='day',timeframe='1m'}={})=>{
    if(!root)throw Error('CRU55_DYNAMIC_SOURCE_NOT_CONFIGURED');
    if(!['day','night'].includes(view)||!FRAMES.includes(timeframe))throw Error('CRU55_QUERY_INVALID');
    if(options.producer==='STREAM_PAGED_V2'||fs.existsSync(path.join(root,'stream-selection.json'))||fs.existsSync(path.join(root,view,'stream-public.json')))return stream({view,timeframe});
    const dir=assertPlainPath(path.join(root,view));
    const statusFile=path.join(dir,'lifecycle-status.json');
    if(fs.existsSync(statusFile)&&json(statusFile,16384).state==='BLOCKED')throw Error('CRU55_PRODUCER_BLOCKED');
    const pointer=json(path.join(dir,'view-latest.json'),4096),generation=json(path.join(dir,'latest.json'),4096);
    if(!/^[a-f0-9]{64}$/.test(pointer.artifactHash||'')||pointer.generationHash!==generation.generationHash)throw Error('CRU55_PROJECTION_BEHIND_PRODUCER');
    const key=[view,pointer.artifactHash,pointer.generationHash].join('|');
    if(key!==cachedKey){
      const a=json(path.join(dir,pointer.artifactHash+'.view.json'),32*1024*1024),{artifactHash,...body}=a;
      if(digest(stableJson(body))!==artifactHash||artifactHash!==pointer.artifactHash||a.generationHash!==pointer.generationHash||a.schemaVersion!=='cru55-dynamic-view-v1'||Object.entries(SAFETY).some(([k,v])=>a[k]!==v))throw Error('CRU55_ARTIFACT_INVALID');
      for(const f of FRAMES){const c=a.view.charts[f],r=a.view.relationships[f],h=a.view.handoffs[f],s=a.view.sessionContext;
        for(const x of [c,r,h,s])if(x.generationHash!==a.generationHash||Object.entries(SAFETY).some(([k,v])=>x[k]!==v))throw Error('CRU55_ARTIFACT_BINDING_INVALID');
        if(c.session?.toLowerCase()!==view||r.sourceCutoff.recordHash!==c.cutoff.recordHash||h.sourceCutoff.recordHash!==c.cutoff.recordHash||s.sourceCutoff.recordHash!==c.cutoff.recordHash)throw Error('CRU55_ARTIFACT_SESSION_OR_CUTOFF_INVALID');
      }
      if(!['GOVERNED_FRAGMENT','SYNTHETIC_FIXTURE'].includes(a.view.kind)||a.view.sessionContext.evidenceKind!==a.view.kind||FRAMES.some(f=>a.view.relationships[f].evidenceKind!==a.view.kind))throw Error('CRU55_SOURCE_KIND_INVALID');
      cached=a.view;cachedHash=pointer.artifactHash;cachedKey=key;
    }
    const chart=withFreshness(cached.charts[timeframe]);
    return {view,kind:cached.kind,artifactHash:cachedHash,producerMode:'BOUNDED_LEDGER_SUFFIX',rawReadsPerRequest:0,...SAFETY,
      chart,relationship:cached.relationships[timeframe],context:{...cached.sessionContext,freshness:chart.freshness},handoff:cached.handoffs[timeframe],
      scan:Object.fromEntries(FRAMES.map(f=>[f,{timeframe:f,windowMs:cached.relationships[f].windowMs,current:cached.relationships[f].current}]))};
  };
}

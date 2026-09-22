import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {createDynamicReader} from '../src/cru55-dynamic-reader.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY,digest,stableJson} from '../src/cvd-observation-core.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url));
const [name='cross',action='run',budget='10000']=process.argv.slice(2);
if(!/^(cross|day|night)(-[a-z0-9]+)?$/.test(name)||!['run','append','generate'].includes(action)||!/^[0-9]+$/.test(budget))throw Error('VERIFY_ARGUMENT');
const scenario=name.split('-')[0],isDay=scenario==='day',view=isDay?'day':'night';
const root=path.join(repo,'data/cru55-stream-chain',name),sourcePath=path.join(root,'source.ndjson'),runRoot=path.join(root,'output',view),metaFile=path.join(root,'fixture.json'),receiptFile=path.join(root,'receipt.json');
fs.mkdirSync(root,{recursive:true});
const initial=scenario==='cross'?1100:isDay?27001:30001,padding=scenario==='cross'?0:2600;
const duration=isDay?5*60*60*1000:14*60*60*1000;
const step=scenario==='cross'?20000:Math.floor((duration-1000)/(initial-1));
const origin=Date.parse(isDay?'2026-09-14T08:45:00+08:00':'2026-09-14T15:00:00+08:00');
let meta=fs.existsSync(metaFile)?JSON.parse(fs.readFileSync(metaFile,'utf8')):{schemaVersion:'cru55-synthetic-chain-fixture-v1',count:0,previousHash:'GENESIS',expectedCvd:0};
const n=action==='append'?200:meta.count?0:initial;
if(n){
  if(scenario!=='cross'&&meta.count)throw Error('WHOLE_SESSION_FIXTURE_APPEND_UNSUPPORTED');
  const fd=fs.openSync(sourcePath,'a');
  try{for(let i=meta.count;i<meta.count+n;i++){
    const time=origin+i*step,stamp=new Date(time).toISOString(),volume=1+i%3,side=i%11===0?2:1;
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(time+1).toISOString(),...SAFETY,
      payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',session:isDay?'DAY':'NIGHT',tradeDate:isDay?'2026-09-14':'2026-09-15',eventTime:stamp,datetime:stamp,close:20000+i%31,volume,tick_type:side,...(padding?{fixturePadding:'x'.repeat(padding)}:{})}},meta.previousHash);
    fs.writeSync(fd,JSON.stringify(row)+'\n');meta.previousHash=row.recordHash;meta.expectedCvd+=side===1?volume:-volume;
  }}finally{fs.closeSync(fd);}meta.count+=n;meta.bytes=fs.statSync(sourcePath).size;meta.firstEventAt=new Date(origin).toISOString();meta.lastEventAt=new Date(origin+(meta.count-1)*step).toISOString();fs.writeFileSync(metaFile,JSON.stringify(meta));
}
if(action==='generate'){console.log(JSON.stringify({scenario,count:meta.count,bytes:meta.bytes}));process.exit(0);}
const prior=fs.existsSync(receiptFile)?JSON.parse(fs.readFileSync(receiptFile,'utf8')):null;
let samples=[],result,start=performance.now(),maxRss=process.memoryUsage().rss;
for(let i=0;i<Number(budget);i++){
  result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE'});maxRss=Math.max(maxRss,process.memoryUsage().rss);
  if(result.metrics.pages>8||result.metrics.bytes>8*1024*1024)throw Error('CYCLE_SHARED_BUDGET_EXCEEDED');
  samples.push({phase:result.phase,ms:result.metrics.cycleMs,backlogBytes:result.metrics.backlogBytes});
  if(['PUBLISHED','UNCHANGED'].includes(result.state))break;
}
let publicResult=null;
if(['PUBLISHED','UNCHANGED'].includes(result.state)){
  const read=createDynamicReader(path.join(root,'output'));const a=read({view});
  if(a.chart.currentCvd!==meta.expectedCvd||a.chart.cutoff.recordHash!==meta.previousHash||a.chart.display.inputPoints!==meta.count)throw Error('CHAIN_NUMERIC_OR_CUTOFF_MISMATCH');
  publicResult={artifactHash:a.artifactHash,generationHash:a.chart.generationHash,projectionHash:a.chart.projectionHash,sourceLedgerIdentity:a.chart.cutoff.sourceLedgerIdentity,
    cutoff:a.chart.cutoff,cvd:a.chart.currentCvd,inputPoints:a.chart.display.inputPoints,displayPoints:a.chart.display.outputPoints,bars:a.chart.bars.length,vwapPoints:a.chart.vwap.length,
    integrity:a.integrity,frames:Object.fromEntries(['1m','5m','15m','30m','1h','4h'].map(timeframe=>{const x=read({view,timeframe});return [timeframe,{delta:x.relationship.current.current?.deltaCvd??null,complete:x.relationship.current.current?.complete??false,sourceHash:x.chart.cutoff.recordHash}];}))};
}
const sorted=samples.map(s=>s.ms).sort((a,b)=>a-b),elapsedMs=performance.now()-start;
const receipt={schemaVersion:'cru55-stream-chain-receipt-v1',scenario,evidenceKind:'SYNTHETIC_FIXTURE',sourceRecords:meta.count,sourceBytes:meta.bytes,sourceSpan:{start:meta.firstEventAt,end:meta.lastEventAt},
  state:result.state,phase:result.phase,cycles:samples.length,elapsedMs,cycleP50Ms:sorted[Math.floor(sorted.length*.5)],cycleP95Ms:sorted[Math.min(sorted.length-1,Math.floor(sorted.length*.95))],cycleMaxMs:sorted.at(-1),peakObservedRssBytes:maxRss,
  backlogBytes:result.metrics.backlogBytes,publicationBacklogBytes:result.metrics.publicationBacklogBytes,verificationRestarts:result.metrics.verificationRestarts,processResume:prior?{previousState:prior.state,previousPhase:prior.phase,previousArtifactHash:prior.publication?.artifactHash??null}:null,
  publication:publicResult,fullDayOperationalAcceptance:false,naturalLiveAcceptance:false,...SAFETY};
fs.writeFileSync(receiptFile,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

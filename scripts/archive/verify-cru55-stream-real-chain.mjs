import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {createDynamicReader} from '../src/cru55-dynamic-reader.mjs';
import {assertInputPath} from '../src/cru55-dynamic-isolation.mjs';
import {SAFETY,digest} from '../src/cvd-observation-core.mjs';
const [input,ordinal,name='candidate',view='night',action='run']=process.argv.slice(2),repo=fileURLToPath(new URL('../',import.meta.url));
if(!input||!/^[0-9]+$/.test(ordinal)||!/^[a-z0-9-]{1,50}$/.test(name)||!['day','night'].includes(view)||!['run','read'].includes(action))throw Error('REAL_CHAIN_ARGUMENT');
const sourcePath=assertInputPath(path.resolve(input)),root=path.join(repo,'data/cru55-stream-real-chain',name),runRoot=path.join(root,'output',view);
fs.mkdirSync(root,{recursive:true});const start=performance.now(),samples=[];let result,peakRss=0;
for(let i=0;action==='run'&&i<100000;i++){
  result=runStreamCycle({sourcePath,runRoot,sourceKind:'GOVERNED_FRAGMENT',stopOrdinal:Number(ordinal)});
  if(result.metrics.pages>8||result.metrics.bytes>8*1024*1024)throw Error('REAL_CHAIN_WORK_BUDGET');
  samples.push(result.metrics.cycleMs);peakRss=Math.max(peakRss,process.memoryUsage().rss);
  if(['PUBLISHED','UNCHANGED'].includes(result.state))break;
}
if(action==='read')result={...JSON.parse(fs.readFileSync(path.join(runRoot,'stream-public.json'),'utf8')),state:'ALREADY_PUBLISHED_RECEIPT_READ'};
else if(!['PUBLISHED','UNCHANGED'].includes(result.state))throw Error('REAL_CHAIN_NOT_FINISHED');
const reader=createDynamicReader(path.join(root,'output')),data=reader({view});samples.sort((a,b)=>a-b);
const receipt={schemaVersion:'cru55-stream-real-chain-receipt-v1',evidenceKind:'GOVERNED_FRAGMENT',scope:'BOUNDED_ORIGINAL_RAW_PREFIX_NOT_WHOLE_SESSION',state:result.state,
  sourceIdentity:data.chart.cutoff.sourceLedgerIdentity,cutoff:data.chart.cutoff,sourcePrefixBytes:result.endByteOffset,artifactHash:data.artifactHash,generationHash:data.chart.generationHash,projectionHash:data.chart.projectionHash,
  cvd:data.chart.currentCvd,snapshots:data.chart.display.inputPoints,displayPoints:data.chart.display.outputPoints,priceBars:data.chart.bars.length,vwap:data.chart.vwap.at(-1)??null,integrity:data.integrity,
  windows:Object.fromEntries(['1m','5m','15m','30m','1h','4h'].map(timeframe=>{const d=reader({view,timeframe});return [timeframe,{delta:d.relationship.current.current?.deltaCvd??null,complete:d.relationship.current.current?.complete??false,cutoffHash:d.chart.cutoff.recordHash}];})),
  cycles:samples.length,elapsedMs:action==='read'?null:performance.now()-start,cycleP95Ms:samples[Math.floor(samples.length*.95)]??null,cycleMaxMs:samples.at(-1)??null,peakObservedRssBytes:action==='read'?null:peakRss,
  naturalLiveAcceptance:false,fullDayOperationalAcceptance:false,...SAFETY};
const file=path.join(root,`receipt-${ordinal}-${Date.now()}.json`);fs.writeFileSync(file,JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

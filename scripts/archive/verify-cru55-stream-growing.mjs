import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { runStreamCycle } from '../src/cru55-stream-pipeline.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY } from '../src/cvd-observation-core.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),name=process.argv[2];
if(!/^growing-[a-z0-9-]+$/.test(name??''))throw Error('PRIVATE_RUN_NAME_REQUIRED');
const root=path.join(repo,'data/cru55-stream-chain',name);
if(fs.existsSync(root))throw Error('NEW_EVIDENCE_ROOT_REQUIRED');
fs.mkdirSync(root,{recursive:true});
const sourcePath=path.join(root,'source.ndjson'),runRoot=path.join(root,'output/night');
let previous='GENESIS',count=0;
function append(n){
  const fd=fs.openSync(sourcePath,'a');
  try{for(let i=0;i<n;i++){
    const at=new Date(Date.parse('2026-09-14T15:00:00+08:00')+count*20000).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:at,...SAFETY,payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',session:'NIGHT',tradeDate:'2026-09-15',eventTime:at,datetime:at,close:20000,volume:1,tick_type:1}},previous);
    fs.writeSync(fd,JSON.stringify(row)+'\n');previous=row.recordHash;count++;
  }}finally{fs.closeSync(fd);}
}
append(1100);const start=performance.now(),observations=[];let result;
for(let i=0;i<100;i++){result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE'});if(result.phase==='VERIFY'&&result.state==='PENDING')break;}
if(result?.phase!=='VERIFY'||result.state!=='PENDING')throw Error('VERIFY_PENDING_REQUIRED');
for(let i=0;i<6;i++){
  append(1);result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE'});
  if(result.state!=='PENDING'||fs.existsSync(path.join(runRoot,'stream-public.json')))throw Error('MOVING_SOURCE_MUST_NOT_PROMOTE');
  observations.push({state:result.state,phase:result.phase,...result.metrics});
}
const stableStart=performance.now();let stableCycles=0;
for(;stableCycles<100;stableCycles++){result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE'});if(result.state==='PUBLISHED')break;}
if(result.state!=='PUBLISHED'||result.cutoff.ledgerOrdinal!==1100)throw Error('CAPTURED_CUTOFF_REQUIRED');
const first={artifactHash:result.artifactHash,cutoff:result.cutoff,stableDrainMs:performance.now()-stableStart,stableCycles:stableCycles+1,...result.metrics};
for(let i=0;i<100;i++){result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE'});if(result.state==='PUBLISHED')break;}
if(result.state!=='PUBLISHED'||result.cutoff.ledgerOrdinal!==1106||result.metrics.publicationBacklogBytes!==0)throw Error('APPENDED_SUFFIX_MUST_DRAIN');
const receipt={schemaVersion:'cru55-moving-source-receipt-v1',evidenceKind:'SYNTHETIC_FIXTURE',continuousAppendCycles:observations,stablePublication:first,finalPublication:{artifactHash:result.artifactHash,cutoff:result.cutoff,...result.metrics},elapsedMs:performance.now()-start,conclusion:'Continuously changed original prefix stays pending; publication requires a stable full verification interval. This benchmark does not prove LIVE capacity.',fullDayOperationalAcceptance:false,naturalLiveAcceptance:false,...SAFETY};
fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));

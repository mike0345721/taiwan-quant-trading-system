// Existing chart service/worker against an immutable local copy. No server or collector.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {Worker} from 'node:worker_threads';
import {createTxChartService} from '../src/dashboard-tx-chart-service.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
const [sourcePath,outputRoot,selectedSession='DAY']=process.argv.slice(2);
assert.ok(['DAY','NIGHT'].includes(selectedSession));
if(!path.isAbsolute(sourcePath??'')||!path.isAbsolute(outputRoot??''))throw Error('ABSOLUTE_PATHS_REQUIRED');
fs.mkdirSync(outputRoot,{recursive:true});const receipt=path.join(outputRoot,'receipt.json');
if(fs.existsSync(receipt))throw Error('FRESH_OUTPUT_REQUIRED');
const sourceRoot=path.join(outputRoot,'source');fs.mkdirSync(sourceRoot,{recursive:true});
const name=path.basename(sourcePath),copy=path.join(sourceRoot,name);
assert.match(name,/^2026-11-\d{2}\.checkpoint\.json$/);
const before=fs.statSync(sourcePath,{bigint:true});fs.copyFileSync(sourcePath,copy);const after=fs.statSync(sourcePath,{bigint:true});
assert.equal(String(before.mtimeNs)+String(before.size),String(after.mtimeNs)+String(after.size),'source changed during capture');
const sha256=crypto.createHash('sha256').update(fs.readFileSync(copy)).digest('hex');
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const date=name.slice(0,10),selection={observation:true,mode:'LIVE',timeframe:'1m',asOf:date+'T14:00:00.000Z',
  tradeDate:selectedSession==='NIGHT'?new Date(Date.parse(date)+86400000).toISOString().slice(0,10):date,session:selectedSession,actualContract:'TXFK6'};
let service,worker,exitPromise,peakRss=0;const calls=[],startedAt=new Date().toISOString(),start=performance.now();
const sample=setInterval(()=>{peakRss=Math.max(peakRss,process.memoryUsage().rss);},50);
const create=()=>{service=createTxChartService({dataRoot:outputRoot,cacheRoot:path.join(outputRoot,'private'),producerRoot:sourceRoot,
  calendar,cacheTtlMs:0,workerFactory:(url,options)=>{worker=new Worker(url,options);exitPromise=new Promise(resolve=>worker.once('exit',resolve));return worker;}});};
let status='FAIL',failure=null,result=null;
try{let expected=null;
  for(const phase of ['cold','restart']){create();let ready=false;
    for(let n=0;n<2000;n++){
      const at=performance.now();result=await service.load(selection);const elapsedMs=performance.now()-at;
      calls.push({phase,n,elapsedMs,status:result.status,reason:result.reason??result.reasonCodes,progress:result.sourceProgress,
        identity:result.identity,snapshotId:result.snapshotId,cutoff:result.cutoff});
      assert.ok(!/TIMEOUT|WORKER_UNAVAILABLE/.test(result.reason??''),result.reason);
      if(result.snapshotId){ready=true;break;}
      assert.ok(result.reasonCodes?.some(code=>/PENDING|VERIFYING/.test(code)),JSON.stringify(result.reasonCodes));
    }
    assert.ok(ready,'source never caught up');
    if(expected)assert.equal(result.snapshotId,expected);else expected=result.snapshotId;
    service.close();await exitPromise;service=null;
  }
  status='PASS';
}catch(error){failure=String(error.stack);process.exitCode=1;}
finally{clearInterval(sample);if(service){service.close();await exitPromise;}
  fs.writeFileSync(receipt,JSON.stringify({status,failure,startedAt,endedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-start)/1000,
    evidenceType:'CAPTURED_CHECKPOINT_THROUGH_ORIGINAL_WORKER_NOT_FRESH_LIVE',source:{sourcePath,sha256,bytes:Number(before.size),modifiedAt:new Date(Number(before.mtimeMs)).toISOString()},
    originalLimits:{requestMs:8000,maxOldGenerationSizeMb:256,maxYoungGenerationSizeMb:32},peakRss,calls,
    result:result?.snapshotId?result:null},null,2));process.stdout.write(JSON.stringify({status,failure,calls:calls.length,peakRss})+'\n');}

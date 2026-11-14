// Offline continuation of a captured synthetic load, on a private DB copy.
import fs from 'node:fs';import path from 'node:path';import crypto from 'node:crypto';import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';import {performance} from 'node:perf_hooks';
import {MarketObservationStore} from '../src/market-observation-store.mjs';
import {marketObservationSnapshot} from '../src/market-observation-core.mjs';
import {digest,stableJson,SAFETY} from '../src/cvd-observation-core.mjs';
const [input,out,baselinePath,loadPath]=process.argv.slice(2);
if(![input,out,baselinePath,loadPath].every(p=>p&&path.isAbsolute(p)))throw Error('ABSOLUTE_ISOLATED_PATHS_REQUIRED');
if(fs.existsSync(out))throw Error('FRESH_OUTPUT_REQUIRED');fs.mkdirSync(out,{recursive:true});
const startedAt=new Date().toISOString(),wall=performance.now(),calls=[],snapshots=[];let store,maxRss=0,maxHeap=0;
function fileHash(file){const hash=crypto.createHash('sha256'),fd=fs.openSync(file,'r'),buffer=Buffer.alloc(1024*1024);try{let n;while((n=fs.readSync(fd,buffer,0,buffer.length,null)))hash.update(buffer.subarray(0,n));return hash.digest('hex');}finally{fs.closeSync(fd);}}
const originalHash=fileHash(input),copy=path.join(out,'private','market-observation',path.basename(input));fs.mkdirSync(path.dirname(copy),{recursive:true});
const copyAt=performance.now();fs.copyFileSync(input,copy);const copyMs=performance.now()-copyAt;
const probe=new DatabaseSync(copy,{readOnly:true});const binding=JSON.parse(probe.prepare("SELECT json FROM meta WHERE key='binding'").get().json);probe.close();
const baseline=JSON.parse(fs.readFileSync(baselinePath,'utf8')),load=JSON.parse(fs.readFileSync(loadPath,'utf8'));
function measured(label,fn){const start=performance.now(),result=fn(),elapsedMs=performance.now()-start,m=process.memoryUsage();
  maxRss=Math.max(maxRss,m.rss);maxHeap=Math.max(maxHeap,m.heapUsed);calls.push({label,elapsedMs});
  assert.ok(elapsedMs<8000,`${label} exceeded 8 seconds: ${elapsedMs}`);return result;}
let failure=null;
try{
  store=measured('open',()=>new MarketObservationStore(copy,binding));
  for(let i=0;;i++){const result=measured('verify',()=>store.verifyStep());if(result.complete)break;if(i>2000)throw Error('HISTORY_VERIFICATION_DID_NOT_FINISH');}
  const state=store.getMeta('checkpoint').state;
  for(const expected of baseline.snapshots.filter(s=>s.kind==='historical-prefix')){
    const cutoff=expected.snapshot.cutoff;
    const snapshot=measured('historical-prefix',()=>marketObservationSnapshot(state,{history:store,cutoff,timeframe:'1m'}));
    const hash=digest(stableJson(snapshot));assert.equal(hash,expected.hash);
    snapshots.push({ordinal:expected.ordinal,cutoff,hash});
    if(expected.ordinal===load.scope.totalEvents){
      const bins=Object.fromEntries(snapshot.profile.bins.map(bin=>[bin.price,bin.volume]));
      assert.deepEqual(bins,load.oracle.bins);assert.equal(snapshot.profile.totalVolume,load.oracle.total);
    }
  }
  assert.equal(fileHash(input),originalHash,'original failed load evidence must remain unchanged');
}catch(error){failure=String(error.stack);process.exitCode=1;}
finally{store?.close();const receipt={status:failure?'FAIL':'PASS',failure,evidenceType:'ISOLATED_COMPLETE_HISTORY_VERIFICATION_NOT_LIVE',startedAt,
  endedAt:new Date().toISOString(),elapsedSeconds:(performance.now()-wall)/1000,input,originalHash,privateCopy:copy,copyMs,
  sourceLoadStatus:load.status,sourceLoadEvents:load.scope.physicalOrdinal,sourceLoadBegun:load.began,
  limits:{requestMs:8000,nodeOldSpaceMiB:256},maxRss,maxHeap,calls,snapshots,...SAFETY};
 fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify(receipt,null,2));process.stdout.write(JSON.stringify({...receipt,calls:calls.length,snapshots:snapshots.length}));}

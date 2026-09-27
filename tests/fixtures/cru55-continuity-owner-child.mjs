import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {createRequire} from 'node:module';
import {ManagedContinuity} from '../../src/cru55-guarded-continuity.mjs';
import {probeManagedProcess} from '../../src/cru55-managed-owner.mjs';
import {runStreamCycle} from '../../src/cru55-stream-pipeline.mjs';
import {buildLiveEventRecord} from '../../src/live-event-ledger.mjs';
import {SAFETY} from '../../src/cvd-observation-core.mjs';
const root=path.resolve(process.argv[2]),base=path.resolve('data/test-tmp');
if(!root.startsWith(base+path.sep)||!path.basename(root).startsWith('continuity-process-'))throw Error('PRIVATE_FIXTURE_REQUIRED');
const outputRoot=path.join(root,'output'),sourcePath=path.join(root,'source.ndjson'),key='a'.repeat(64),runRoot=path.join(outputRoot,'sources',key);
fs.mkdirSync(path.join(outputRoot,'managed-owner.lock'),{recursive:true});
if(!fs.existsSync(sourcePath)){
  let previous='GENESIS',text='';
  for(let i=0;i<12;i++){
    const time=new Date(Date.parse('2026-09-14T15:00:00+08:00')+i*1000).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:time,...SAFETY,payload:{_product_family:'TX',_target_code:'TXFI6',datetime:time,close:20000+i,volume:1,tick_type:1}},previous);
    previous=row.recordHash;text+=JSON.stringify(row)+'\n';
  }fs.writeFileSync(sourcePath,text,{flag:'wx'});
}
const p=probeManagedProcess(process.pid),owner={pid:process.pid,nonce:crypto.randomUUID(),startTime:p.startTime,commandLine:p.commandLine,bindingHash:'b'.repeat(64),runtimeCommit:'a'.repeat(40),configPath:path.join(root,'config.json'),outputRoot};
fs.writeFileSync(path.join(outputRoot,'managed-owner.lock','owner.json'),JSON.stringify({schemaVersion:'cru55-managed-owner-v1',...owner}));
let failCleanup=false;
const koffi=createRequire(import.meta.url)('koffi'),load=koffi.load;
koffi.load=(...args)=>{const library=load(...args);return {func:(...signature)=>{const fn=library.func(...signature);return signature[1]==='UnlockFileEx'? (...values)=>{const result=fn(...values);return failCleanup?0:result;}:fn;}};};
const continuity=new ManagedContinuity(owner);
let result;
for(let i=0;i<100;i++){result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',ownerContext:owner,continuity,sourceVerification:'GUARDED_PREFIX_CONTINUITY_V1'});if(['PUBLISHED','UNCHANGED'].includes(result.state))break;}
if(!result.artifactHash)throw Error('FIXTURE_NOT_PUBLISHED');
fs.writeFileSync(path.join(outputRoot,'stream-selection.json'),JSON.stringify({schemaVersion:'cru55-stream-selection-v1',bindingHash:owner.bindingHash,views:{night:{...result,sourceKey:key,relativeRunPath:'sources/'+key}},...SAFETY}));
process.send({result,metrics:continuity.metrics,bytes:fs.statSync(sourcePath).size});
process.on('message',message=>{if(message==='cleanup-failure'){failCleanup=true;let error=null;try{continuity.close();}catch(e){error=e.message;}process.send({cleanupError:error,state:JSON.parse(fs.readFileSync(path.join(outputRoot,'stream-continuity-status.json'))).state});process.exit(error?0:1);}if(message==='close'){continuity.close();process.exit(0);}if(message==='crash')process.exit(0);});

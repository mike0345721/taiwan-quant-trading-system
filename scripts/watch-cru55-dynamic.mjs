import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { isolatedRunRoot,assertInputPath,assertPlainPath,REPO } from '../src/cru55-dynamic-isolation.mjs';
const [source,runId,priorRunId,cycles]=process.argv.slice(2);
const maxCycles=cycles===undefined?Infinity:Number(cycles);
if(maxCycles!==Infinity&&(!Number.isSafeInteger(maxCycles)||maxCycles<1||maxCycles>100))throw Error('CRU55_CYCLE_LIMIT_INVALID');
assertInputPath(source);const root=isolatedRunRoot(runId);fs.mkdirSync(root,{recursive:true});
const lock=assertPlainPath(path.join(root,'lifecycle.lock'));fs.mkdirSync(lock); // never reclaim an unknown owner
let stopped=false;process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
try{
  for(let cycle=0;!stopped&&cycle<maxCycles;cycle++){
    const result=spawnSync(process.execPath,['scripts/run-cru55-dynamic.mjs',source,runId,'',...(priorRunId?[priorRunId]:[])],{cwd:REPO,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:1024*1024});
    const status={state:result.status===0?'READY':'BLOCKED',at:new Date().toISOString(),reason:result.error?.code??null,
      detail:(result.status===0?result.stdout:result.stderr).trim()};
    const temp=assertPlainPath(path.join(root,crypto.randomUUID()+'.status.tmp'));
    const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,JSON.stringify(status));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,assertPlainPath(path.join(root,'lifecycle-status.json')));
    console.log(JSON.stringify(status));
    if(status.state==='BLOCKED')break; // preserved checkpoint; no reset or resource-limit increase
    if(cycle+1<maxCycles)await new Promise(resolve=>setTimeout(resolve,5000));
  }
}finally{fs.rmdirSync(lock);}

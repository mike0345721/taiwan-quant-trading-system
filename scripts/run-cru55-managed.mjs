import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { readManagedConfig,runManagedCycle,publishManagedJson,managedDelayMs } from '../src/cru55-managed-plan.mjs';
import { assertBoundWriteRoot } from '../src/cru55-runtime-binding.mjs';
const [configPath,...flags]=process.argv.slice(2),runtimeRoot=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
if(flags.some(f=>!['--candidate','--inspect'].includes(f)&&!/^--cycles=\d+$/.test(f)))throw Error('CRU55_MANAGED_ARGUMENT');
const candidate=flags.includes('--candidate'),plan=readManagedConfig(configPath,{runtimeRoot,candidate});
if(flags.includes('--inspect')){console.log(JSON.stringify(plan));}
else{
  if(process.platform!=='win32')throw Error('CRU55_MANAGED_WINDOWS_REQUIRED');
  const count=flags.find(f=>f.startsWith('--cycles=')),cycles=count?Number(count.split('=')[1]):Infinity;
  if(count&&(!candidate||!Number.isSafeInteger(cycles)||cycles<1||cycles>100))throw Error('CRU55_MANAGED_CYCLE_BUDGET');
  fs.mkdirSync(assertBoundWriteRoot(plan,plan.outputRoot),{recursive:true});
  const lock=assertBoundWriteRoot(plan,path.join(plan.outputRoot,'managed-owner.lock'));fs.mkdirSync(lock);
  const ownerPath=path.join(lock,'owner.json'),nonce=crypto.randomUUID();let stopped=false,owned=false;
  process.on('SIGINT',()=>{stopped=true;});process.on('SIGTERM',()=>{stopped=true;});
  try{
    const processInfo=JSON.parse(execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
      '$ErrorActionPreference="Stop"; $p=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$env:CRU55_OWNER_PID); if(-not $p){throw "PROCESS_MISSING"}; [pscustomobject]@{pid=$p.ProcessId;startTime=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine}|ConvertTo-Json -Compress'],
      {encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,CRU55_OWNER_PID:String(process.pid)},stdio:['ignore','pipe','pipe']}));
    const ownerContext={nonce,...processInfo,bindingHash:plan.bindingHash,runtimeCommit:plan.runtimeCommit,configPath:plan.configPath,outputRoot:plan.outputRoot};
    fs.writeFileSync(ownerPath,JSON.stringify({schemaVersion:'cru55-managed-owner-v1',...ownerContext}),{flag:'wx'});owned=true;
    const {runStreamCycle}=await import('../src/cru55-stream-pipeline.mjs');
    for(let cycle=0;!stopped&&cycle<cycles;cycle++){
      const cycleStart=performance.now(),cpuStart=process.cpuUsage();
      const current=readManagedConfig(configPath,{runtimeRoot,candidate});if(current.bindingHash!==plan.bindingHash)throw Error('CRU55_MANAGED_CONFIG_CHANGED');
      const configMs=performance.now()-cycleStart;let pipelineMs=0;
      const result=await runManagedCycle(plan,{runStreamCycle:args=>{const start=performance.now();try{return runStreamCycle(args);}finally{pipelineMs+=performance.now()-start;}},ownerContext});
      const elapsed=performance.now()-cycleStart;
      result.timing={configMs,pipelineMs,managerMs:elapsed-configMs-pipelineMs,workMs:elapsed,cpuUs:process.cpuUsage(cpuStart),rssBytes:process.memoryUsage().rss,scheduledDelayMs:managedDelayMs(result)};
      publishManagedJson(plan,'stream-managed-status.json',{...result,at:new Date().toISOString(),bindingHash:plan.bindingHash,runtimeCommit:plan.runtimeCommit,ownerNonce:nonce,ownerPid:process.pid});
      console.log(JSON.stringify(result));
      if(cycle+1<cycles)await new Promise(resolve=>setTimeout(resolve,managedDelayMs(result)));
    }
  }catch(error){
    publishManagedJson(plan,'stream-managed-status.json',{state:'BLOCKED',at:new Date().toISOString(),bindingHash:plan.bindingHash,runtimeCommit:plan.runtimeCommit,ownerNonce:nonce,ownerPid:process.pid,reason:error.message,fullDayReady:false});throw error;
  }finally{
    if(owned){const owner=JSON.parse(fs.readFileSync(ownerPath,'utf8'));if(owner.nonce===nonce&&owner.pid===process.pid){fs.unlinkSync(ownerPath);fs.rmdirSync(lock);}}
  }
}

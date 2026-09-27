import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { stableJson } from './cvd-observation-core.mjs';
import { createRequire } from 'node:module';

let processApi;
// No CIM on reader requests. The creation FILETIME and signaled state are
// checked on the same OS handle, preventing PID reuse from reviving a receipt.
export function nativeManagedProcess(pid, expectedCreation = null) {
  if (process.platform !== 'win32' || !Number.isSafeInteger(pid) || pid < 1) throw Error('CRU55_NATIVE_PROCESS_REQUIRED');
  if (!processApi) {
    const k = createRequire(import.meta.url)('koffi').load('kernel32.dll');
    const call = (n,r,a) => k.func('__stdcall',n,r,a);
    processApi = {open:call('OpenProcess','intptr_t',['uint32','int','uint32']),
      times:call('GetProcessTimes','int',['intptr_t','void *','void *','void *','void *']),
      wait:call('WaitForSingleObject','uint32',['intptr_t','uint32']),close:call('CloseHandle','int',['intptr_t'])};
  }
  const a=processApi,h=a.open(0x100000|0x1000,0,pid);
  if (!h) throw Error('CRU55_PRODUCER_DEAD_OR_UNKNOWN');
  try {
    const creation=Buffer.alloc(8),exit=Buffer.alloc(8),kernel=Buffer.alloc(8),user=Buffer.alloc(8);
    if (!a.times(h,creation,exit,kernel,user) || a.wait(h,0)!==258) throw Error('CRU55_PRODUCER_DEAD_OR_UNKNOWN');
    const value=creation.readBigUInt64LE().toString();
    if (expectedCreation!==null && value!==expectedCreation) throw Error('CRU55_PRODUCER_CREATION_CHANGED');
    return value;
  } finally { if(!a.close(h)) throw Error('CRU55_PROCESS_HANDLE_CLEANUP_FAILED'); }
}

const fail=code=>{throw Error(code);};
const inside=(root,file)=>{const relative=path.relative(root,file);return relative!==''&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative);};
const identity=file=>{const s=fs.statSync(assertPlainPath(file),{bigint:true});return [String(s.dev),String(s.ino),String(s.birthtimeNs)].join(':');};
let verifiedSelf=null;
function readOwner(lock){
  const file=assertPlainPath(path.join(lock,'owner.json')),stat=fs.statSync(file);
  if(!stat.isFile()||stat.nlink!==1||stat.size>16384)fail('CRU55_NESTED_LOCK_UNKNOWN');
  return JSON.parse(fs.readFileSync(file,'utf8'));
}
function valid(owner){return owner&&Number.isSafeInteger(owner.pid)&&owner.pid>0&&typeof owner.nonce==='string'&&owner.nonce.length>0
  &&typeof owner.startTime==='string'&&Number.isFinite(Date.parse(owner.startTime))&&typeof owner.commandLine==='string'&&owner.commandLine.length>0
  &&/^[a-f0-9]{64}$/.test(owner.bindingHash||'')&&/^[a-f0-9]{40}$/.test(owner.runtimeCommit||'')
  &&path.isAbsolute(owner.configPath||'')&&path.isAbsolute(owner.outputRoot||'');}
export function probeManagedProcess(pid){
  if(process.platform!=='win32'||!Number.isSafeInteger(pid)||pid<1)fail('CRU55_NESTED_PROCESS_PROBE_UNAVAILABLE');
  const result=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '$ErrorActionPreference="Stop"; $p=Get-CimInstance Win32_Process -Filter ("ProcessId = "+$env:CRU55_PROBE_PID) -OperationTimeoutSec 5; if($p){[pscustomobject]@{state="PRESENT";pid=$p.ProcessId;startTime=$p.CreationDate.ToUniversalTime().ToString("o");commandLine=$p.CommandLine}|ConvertTo-Json -Compress}else{\'{"state":"ABSENT"}\'}'],
    {encoding:'utf8',windowsHide:true,timeout:10000,env:{...process.env,CRU55_PROBE_PID:String(pid)},stdio:['ignore','pipe','pipe']});
  return JSON.parse(result);
}
// Call only for managed writers. Unmanaged token-only locks retain their old
// fail-closed behavior in their caller. No process is terminated here.
export function acquireManagedLock(lockPath,{ownerContext,probeProcess=probeManagedProcess}={}){
  if(!valid(ownerContext)||ownerContext.pid!==process.pid)fail('CRU55_NESTED_OWNER_INVALID');
  const root=assertPlainPath(ownerContext.outputRoot),lock=assertPlainPath(lockPath);
  if(!inside(root,lock))fail('CRU55_NESTED_LOCK_ESCAPE');
  // A running process cannot change its own PID/start identity. Cache only
  // the production self probe; stale owners are always freshly probed.
  const self=probeProcess===probeManagedProcess&&verifiedSelf?verifiedSelf:probeProcess(ownerContext.pid);
  if(self?.state!=='PRESENT'||self.pid!==ownerContext.pid||self.startTime!==ownerContext.startTime||self.commandLine!==ownerContext.commandLine)fail('CRU55_NESTED_OWNER_PROCESS_MISMATCH');
  if(probeProcess===probeManagedProcess)verifiedSelf=self;
  try{fs.mkdirSync(lock);}catch(error){
    if(error.code!=='EEXIST')throw error;
    const before=identity(lock),old=readOwner(lock),previous=old.ownerContext;
    if(old.schemaVersion!=='cru55-managed-nested-lock-v1'||typeof old.token!=='string'||!valid(previous))fail('CRU55_NESTED_LOCK_UNKNOWN');
    for(const key of ['bindingHash','runtimeCommit','configPath','outputRoot'])if(previous[key]!==ownerContext[key])fail('CRU55_NESTED_LOCK_BINDING_MISMATCH');
    if(probeProcess(previous.pid)?.state!=='ABSENT')fail('CRU55_NESTED_LOCK_BUSY');
    // Preserve stale evidence outside the archive; only a proven dead owner
    // can reach this path. A changed directory or record is never retired.
    const retiredRoot=assertPlainPath(path.join(root,'managed-retired-locks'));fs.mkdirSync(retiredRoot,{recursive:true});
    if(identity(lock)!==before||stableJson(readOwner(lock))!==stableJson(old))fail('CRU55_NESTED_LOCK_CHANGED');
    const retired=assertPlainPath(path.join(retiredRoot,crypto.randomUUID()+'.'+path.basename(lock)));
    fs.renameSync(lock,retired);fs.mkdirSync(lock);
  }
  const token=crypto.randomUUID(),stamp=identity(lock),file=assertPlainPath(path.join(lock,'owner.json'));
  const fd=fs.openSync(file,'wx');try{fs.writeFileSync(fd,JSON.stringify({schemaVersion:'cru55-managed-nested-lock-v1',token,ownerContext}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  return ()=>{
    if(identity(lock)!==stamp||readOwner(lock).token!==token)fail('CRU55_NESTED_LOCK_OWNER_CHANGED');
    fs.unlinkSync(file);fs.rmdirSync(lock);
  };
}

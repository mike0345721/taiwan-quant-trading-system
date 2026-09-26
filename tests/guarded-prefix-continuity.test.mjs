import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {performance} from 'node:perf_hooks';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {GuardedPrefixContinuity, physicalBinding} from '../experiments/guarded-prefix-continuity.mjs';
import {digest, stableJson} from '../src/cvd-observation-core.mjs';

const windows = {skip: process.platform !== 'win32', timeout: 30000};
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const evidence = [];
const measurements=[];
let instance=0;
function prototype(context,options) {
  const p=new GuardedPrefixContinuity(context,options),id=++instance,verify=p.verify.bind(p);
  p.verify=(ctx,target)=>{
    try {const r=verify(ctx,target);measurements.push({instance:id,role:ctx.role,success:true,...r.metrics});return r;}
    catch(error){measurements.push({instance:id,role:ctx.role,success:false,error:error.message,...error.metrics});throw error;}
  };
  return p;
}
function fixture(role = 'current') {
  const base = path.join(repo, 'data/test-tmp/guarded-continuity'); fs.mkdirSync(base, {recursive: true});
  const root = fs.mkdtempSync(path.join(base, 'synthetic-')), file = path.join(root, 'source.bin');
  fs.writeFileSync(file, Buffer.alloc(128 * 1024, 65));
  const context = {sourceBinding: physicalBinding(file), role, ownerEpoch: 'test-owner',
    sourceLedgerIdentity: 'test-ledger', resolverIdentity: 'test-resolver', sessionEpoch: 'test-DAY'};
  const chunks = [];
  const add = bytes => {
    const offset = chunks.reduce((n, c) => n + c.length, 0);
    const body = {offset, length: bytes.length, rawHash: digest(bytes), previousChunkHash: chunks.at(-1)?.chunkHash ?? null,
      sourceLedgerIdentity: context.sourceLedgerIdentity, resolverIdentity: context.resolverIdentity};
    chunks.push({...body, chunkHash: digest(stableJson(body))});
  };
  add(Buffer.alloc(128 * 1024, 65));
  return {root, file, context, chunks, add, target() {
    return {chunks, endByteOffset: chunks.reduce((n,c) => n + c.length, 0), lastChunkHash: chunks.at(-1).chunkHash};
  }, append(size, value) { const bytes = Buffer.alloc(size, value); fs.appendFileSync(file, bytes); add(bytes); }};
}
function denied(file, offset) {
  const fd = fs.openSync(file, 'r+');
  try { assert.throws(() => fs.writeSync(fd, Buffer.from('!'), 0, 1, offset), /EBUSY|EPERM|EACCES|UNKNOWN/); }
  finally { fs.closeSync(fd); }
}
function fullCompare(f, result, label) {
  const started = performance.now(), fd = fs.openSync(f.file, 'r');
  const bytes = Buffer.alloc(result.receipt.endByteOffset); let n = 0;
  try { while (n < bytes.length) { const count = fs.readSync(fd, bytes, n, bytes.length-n, n); assert.ok(count); n += count; } }
  finally { fs.closeSync(fd); }
  for (const c of f.chunks) assert.equal(digest(bytes.subarray(c.offset, c.offset+c.length)), c.rawHash);
  assert.equal(digest(bytes), result.receipt.rawPrefixHash);
  evidence.push({case: label, ...result.metrics, oracleFullReadBytes: n, oracleRange: [0,n], oracleElapsedMs: performance.now()-started, hashEqual: true});
}
function native() {
  const k = createRequire(import.meta.url)('koffi').load('kernel32.dll');
  return {
    open: k.func('__stdcall', 'CreateFileW', 'intptr_t', ['str16','uint32','uint32','void *','uint32','uint32','intptr_t']),
    lock: k.func('__stdcall', 'LockFileEx', 'int', ['intptr_t','uint32','uint32','uint32','uint32','void *']),
    close: k.func('__stdcall', 'CloseHandle', 'int', ['intptr_t']),
    count: k.func('__stdcall','GetProcessHandleCount','int',['intptr_t','void *']),
  };
}

test('experiment has no current runtime imports and no artifact output', () => {
  for (const dir of ['src', 'scripts']) {
    for (const f of fs.readdirSync(path.join(repo, dir), {withFileTypes:true})) {
      if (f.isFile() && f.name.endsWith('.mjs')) assert.doesNotMatch(fs.readFileSync(path.join(repo,dir,f.name),'utf8'), /experiments\/guarded-prefix-continuity/);
    }
  }
});

test('full then two natural appends, overlap has no write window and guards stay bounded', windows, () => {
  const f = fixture(); f.append(128*1024, 66); f.append(128*1024, 67); f.append(128*1024, 68);
  const stages = [];
  const a=native(),handleCounts=[];
  const count=()=>{const out=Buffer.alloc(4);assert.equal(a.count(-1,out),1);return out.readUInt32LE(0);};
  const p = prototype(f.context, {onStage(stage, range) {
    stages.push({stage, ...range,processHandleCount:count()});
    if (stage !== 'beforeAcquire') { denied(f.file,0); denied(f.file,range.endByteOffset-1); }
    else if (range.start) denied(f.file,range.start-1);
  }});
  try {
    let r = p.verify(f.context, f.target()); fullCompare(f,r,'initial-full');
    handleCounts.push(count());
    const epoch = r.receipt.epoch;
    for (const [size, value] of [[128*1024,69],[256*1024,70]]) {
      f.append(size,value); r = p.verify(f.context,f.target());
      assert.equal(r.receipt.epoch,epoch); assert.equal(r.metrics.fullReadBytes,0); assert.equal(r.metrics.suffixReadBytes,size);
      fullCompare(f,r,'append-'+value);
      handleCounts.push(count());
    }
    const zero = p.verify(f.context, f.target()); assert.equal(zero.metrics.fullReadBytes+zero.metrics.suffixReadBytes,0);
    assert.equal(p.assertReady(zero.receipt,f.context,f.target().endByteOffset),true);
    assert.equal(zero.metrics.peakGuardCount,2); assert.deepEqual(handleCounts,[handleCounts[0],handleCounts[0],handleCounts[0]]);
    evidence.push({case:'overlap-write-probes',stages,steadyGuards:1,peakGuards:2,steadyProcessHandleCounts:handleCounts});
    assert.throws(()=>fs.renameSync(f.file,f.file+'.moved'));
    const fd=fs.openSync(f.file,'r+'); try { assert.throws(()=>fs.ftruncateSync(fd,1)); } finally {fs.closeSync(fd);}
    evidence.push({case:'rename-and-truncate',rejected:true});
  } finally { p.close(); }
});

test('CPython O_APPEND remains compatible under a held guard',windows,()=>{
  const f=fixture(), p=prototype(f.context);
  try {
    p.verify(f.context,f.target());
    const child=spawnSync('python',['-c',"import os,sys; f=os.open(sys.argv[1],os.O_APPEND|os.O_CREAT|os.O_WRONLY|os.O_BINARY); os.write(f,b'B'*4096); os.close(f)",f.file],{encoding:'utf8',timeout:5000,windowsHide:true});
    assert.equal(child.status,0,child.stderr);f.add(Buffer.alloc(4096,66));
    fullCompare(f,p.verify(f.context,f.target()),'CPython-append');
  } finally {p.close();}
});

test('native acquisition conflict and failure after overlap/handoff never retain a receipt',windows,()=>{
  for(const fault of ['native-conflict','overlap','afterHandoff']) {
    const f=fixture();let armed=false;
    const p=prototype(f.context,{onStage(stage){if(armed&&stage===fault){denied(f.file,0);throw Error('TEST_HANDOFF_FAULT');}}});
    let handle; const a=native();
    try {
      const old=p.verify(f.context,f.target()).receipt;f.append(4096,66);armed=true;
      if(fault==='native-conflict'){
        handle=a.open(f.file,0x80000000,3,null,3,0,0); assert.notEqual(handle,-1n);
        const overlap=Buffer.alloc(32);overlap.writeUInt32LE(old.endByteOffset,16);
        assert.equal(a.lock(handle,3,0,4096,0,overlap),1);denied(f.file,0);
      }
      assert.throws(()=>p.verify(f.context,f.target()), /STREAM_PREFIX_LOCK|TEST_HANDOFF_FAULT/);
      assert.equal(p.trace(),null);assert.throws(()=>p.assertReady(old,f.context,old.endByteOffset));
      evidence.push({case:fault,receiptInvalidated:true});
    } finally {if(handle!==undefined)a.close(handle);p.close();}
  }
});

test('lease loss requires full read; forged disk receipt, owner changes and same-file prior are refused',windows,()=>{
  const f=fixture(), p=prototype(f.context);
  try {
    const old=p.verify(f.context,f.target()).receipt;
    assert.throws(()=>prototype({...f.context,role:'prior'}),/SOURCE_ALREADY_CLAIMED/);
    p.dropProtectionForTest(); const recovered=p.verify(f.context,f.target());
    assert.notEqual(recovered.receipt.epoch,old.epoch);assert.equal(recovered.metrics.fullReadBytes,f.target().endByteOffset);
    fullCompare(f,recovered,'lease-loss-full-recovery');
    const disk=JSON.parse(JSON.stringify(recovered.receipt));assert.throws(()=>p.assertReady(disk,f.context,disk.endByteOffset),/RECEIPT_NOT_LIVE/);
    p.verify(f.context,f.target());assert.throws(()=>p.verify({...f.context,ownerEpoch:'other'},f.target()),/CONTEXT_CHANGED/);
    assert.equal(p.trace(),null);
    evidence.push({case:'disk-owner-same-file-prior',rejected:true});
  } finally {p.close();}
});

test('source replacement, bad suffix bytes, chain mismatch and cutoff regression fail closed',windows,()=>{
  for(const fault of ['replace','raw','chain','regression','resolver','session']){
    const f=fixture(),p=prototype(f.context);
    try {
      p.verify(f.context,f.target());
      let ctx=f.context,target;
      if(fault==='replace'){p.dropProtectionForTest();fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,Buffer.alloc(128*1024,65));}
      if(fault==='raw'){f.append(4096,66);const fd=fs.openSync(f.file,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,128*1024);}finally{fs.closeSync(fd);}}
      if(fault==='chain'){f.append(4096,66);f.chunks.at(-1).previousChunkHash='0'.repeat(64);}
      if(fault==='resolver')ctx={...ctx,resolverIdentity:'other'};
      if(fault==='session')ctx={...ctx,sessionEpoch:'test-NIGHT'};
      target=f.target();if(fault==='regression')target.endByteOffset--;
      let error;try{p.verify(ctx,target);}catch(e){error=e;}
      assert.ok(error);assert.equal(p.trace(),null);evidence.push({case:fault,error:error.message,metrics:error.metrics});
    }finally{p.close();}
  }
});

test('fixed prior has its own epoch, identity and coverage, zero raw rereads',windows,()=>{
  const current=fixture(),prior=fixture('prior'),c=prototype(current.context),p=prototype(prior.context);
  try{
    const cr=c.verify(current.context,current.target()),pr=p.verify(prior.context,prior.target());
    assert.notEqual(cr.receipt.epoch,pr.receipt.epoch);
    fullCompare(prior,pr,'prior-initial');const reuse=p.verify(prior.context,prior.target());fullCompare(prior,reuse,'prior-reuse');
    assert.equal(reuse.metrics.fullReadBytes+reuse.metrics.suffixReadBytes,0);
    assert.throws(()=>c.assertReady(pr.receipt,current.context,cr.receipt.endByteOffset),/RECEIPT_NOT_LIVE/);
  }finally{c.close();p.close();}
});

test('real process exit releases protection; receipt cannot survive, recovery rereads from byte zero',windows,()=>{
  const f=fixture(), input=path.join(f.root,'child-input.json');fs.writeFileSync(input,JSON.stringify({context:f.context,target:f.target()}));
  const child=spawnSync(process.execPath,[path.join(repo,'experiments/guarded-prefix-exit-child.mjs'),input],{encoding:'utf8',timeout:10000,windowsHide:true});
  assert.equal(child.status,0,child.stderr);const childResult=JSON.parse(child.stdout),disk=childResult.receipt; measurements.push({instance: 'exited-child',role: 'current',success:true,...childResult.metrics});
  let p=prototype(f.context);
  try{
    assert.throws(()=>p.assertReady(disk,f.context,disk.endByteOffset),/NO_LIVE_GUARD/);
    const r=p.verify(f.context,f.target());assert.notEqual(r.receipt.epoch,disk.epoch);fullCompare(f,r,'process-exit-full-recovery');
  }finally{p.close();}
  const fd=fs.openSync(f.file,'r+');try{assert.equal(fs.writeSync(fd,Buffer.from('X'),0,1,0),1);}finally{fs.closeSync(fd);}
  p=prototype(f.context);
  try{assert.throws(()=>p.verify(f.context,f.target()),/RAW_CHANGED/);evidence.push({case:'post-exit-old-byte-change',rejectedByFullRead:true});}finally{p.close();}
});

test('explicit limitation: mapped write bypasses byte lock and reused receipt does not detect it',windows,()=>{
  const f=fixture(),p=prototype(f.context);
  try{
    const original=p.verify(f.context,f.target());
    const child=spawnSync('python',['-c',"import mmap,sys; f=open(sys.argv[1],'r+b'); m=mmap.mmap(f.fileno(),0); m[0:1]=b'Z'; m.flush(); m.close(); f.close()",f.file],{encoding:'utf8',timeout:5000,windowsHide:true});
    assert.equal(child.status,0,child.stderr);
    const reuse=p.verify(f.context,f.target());assert.equal(reuse.receipt.rawPrefixHash,original.receipt.rawPrefixHash);
    assert.notEqual(digest(fs.readFileSync(f.file)),reuse.receipt.rawPrefixHash);
    evidence.push({case:'mapped-write-excluded-counterexample',writeSucceeded:true,reuseDetected:false,fullReadDetected:true,limitation:true});
  }finally{p.close();}
});

test.after(()=>{
  if(process.env.CONTINUITY_EVIDENCE_PATH){
    const out=path.resolve(process.env.CONTINUITY_EVIDENCE_PATH),base=path.join(repo,'data/test-tmp/guarded-continuity');
    assert.ok(out.startsWith(base+path.sep));fs.writeFileSync(out,JSON.stringify({platform:process.platform,node:process.version,measurements,cases:evidence},null,2));
  }
});

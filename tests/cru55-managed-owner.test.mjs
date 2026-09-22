import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {acquireManagedLock} from '../src/cru55-managed-owner.mjs';
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-owner-')),lock=path.join(root,'pipeline.lock');
  const owner={nonce:'new-owner',pid:process.pid,startTime:'2026-09-22T00:00:00.000Z',commandLine:'fixture-process',bindingHash:'a'.repeat(64),runtimeCommit:'b'.repeat(40),configPath:path.join(root,'config.json'),outputRoot:root};
  const old={...owner,nonce:'old-owner',pid:process.pid+100000};
  const record={schemaVersion:'cru55-managed-nested-lock-v1',token:'old-token',ownerContext:old};
  function write(value=record){fs.mkdirSync(lock);fs.writeFileSync(path.join(lock,'owner.json'),JSON.stringify(value));}
  const probe=pid=>pid===process.pid?{state:'PRESENT',...owner}:{state:'ABSENT'};
  return {root,lock,owner,old,record,write,probe,close(){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-owner-'));fs.rmSync(root,{recursive:true,force:true});}};
}
test('managed recovery preserves proven-dead exact binding locks and releases only new ownership',()=>{
  const f=fixture();try{
    f.write();const release=acquireManagedLock(f.lock,{ownerContext:f.owner,probeProcess:f.probe});
    const retired=fs.readdirSync(path.join(f.root,'managed-retired-locks'));assert.equal(retired.length,1);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.root,'managed-retired-locks',retired[0],'owner.json'))),f.record);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.lock,'owner.json'))).ownerContext.nonce,'new-owner');
    release();assert.equal(fs.existsSync(f.lock),false);
  }finally{f.close();}
});
test('unknown, foreign binding, present or uncertain old PID never authorizes recovery',()=>{
  for(const scenario of ['unknown','binding','live','uncertain']){
    const f=fixture();try{
      const old=scenario==='unknown'?{token:'legacy'}:scenario==='binding'?{...f.record,ownerContext:{...f.old,bindingHash:'c'.repeat(64)}}:f.record;f.write(old);
      const probe=pid=>pid===process.pid?f.probe(pid):{state:scenario==='live'?'PRESENT':scenario==='uncertain'?'UNKNOWN':'ABSENT'};
      assert.throws(()=>acquireManagedLock(f.lock,{ownerContext:f.owner,probeProcess:probe}),/NESTED_LOCK_(UNKNOWN|BINDING_MISMATCH|BUSY)/);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(f.lock,'owner.json'))),old);assert.equal(fs.existsSync(path.join(f.root,'managed-retired-locks')),false);
    }finally{f.close();}
  }
});
test('managed lock rejects forged self identity, write escape and changed release token',()=>{
  const f=fixture();try{
    assert.throws(()=>acquireManagedLock(f.lock,{ownerContext:{...f.owner,pid:f.old.pid},probeProcess:f.probe}),/OWNER_INVALID/);
    assert.throws(()=>acquireManagedLock(f.lock,{ownerContext:f.owner,probeProcess:()=>({state:'ABSENT'})}),/PROCESS_MISMATCH/);
    assert.throws(()=>acquireManagedLock(path.join(path.dirname(f.root),'outside.lock'),{ownerContext:f.owner,probeProcess:f.probe}),/LOCK_ESCAPE/);
    const release=acquireManagedLock(f.lock,{ownerContext:f.owner,probeProcess:f.probe});const file=path.join(f.lock,'owner.json');fs.writeFileSync(file,JSON.stringify({...JSON.parse(fs.readFileSync(file)),token:'foreign'}));
    assert.throws(release,/OWNER_CHANGED/);assert.equal(fs.existsSync(file),true);
  }finally{f.close();}
});

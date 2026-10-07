import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import test from 'node:test';
import {validateProducerHeartbeat} from '../src/dashboard-runtime-readiness.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-alias-'));
  const target=path.join(root,'primary'),alias=path.join(root,'approved');
  fs.mkdirSync(path.join(target,'runtime'),{recursive:true});
  fs.writeFileSync(path.join(target,'runtime','latest.json'),'{}');fs.writeFileSync(path.join(target,'runtime','status.json'),'{}');
  fs.symlinkSync(target,alias,process.platform==='win32'?'junction':'dir');
  // Unlink the alias first, so cleanup can never traverse the directory link.
  t.after(()=>{if(fs.existsSync(alias))fs.unlinkSync(alias);fs.rmSync(root,{recursive:true,force:true});});
  const now=new Date();const paths={dataRoot:target,projectionRoot:path.join(target,'runtime'),snapshotPath:path.join(target,'runtime','latest.json'),statusPath:path.join(target,'runtime','status.json'),now,isProcessAlive:()=>true};
  const status={schemaVersion:'cru34-live-worker-status-v1',status:'AVAILABLE',pid:42,workerInstanceId:crypto.randomUUID(),observedAt:now.toISOString(),dataRoot:alias,projectionRoot:path.join(alias,'runtime'),snapshotPath:path.join(alias,'runtime','latest.json'),statusPath:path.join(alias,'runtime','status.json')};
  const lock={pid:42,workerInstanceId:status.workerInstanceId,dataRoot:status.dataRoot,projectionRoot:status.projectionRoot};
  return{root,target,alias,paths,status,lock};
}
test('existing Windows junction aliases of the same governed paths pass heartbeat validation',t=>{
  const f=fixture(t);assert.equal(validateProducerHeartbeat(f.status,f.lock,f.paths).ready,true);
});
test('different existing roots and different artifact files still fail closed',t=>{
  const f=fixture(t);const other=path.join(f.root,'other');fs.mkdirSync(other);
  assert.ok(validateProducerHeartbeat({...f.status,dataRoot:other},f.lock,f.paths).reasons.includes('LIVE_PRODUCER_PATH_MISMATCH'));
  assert.ok(validateProducerHeartbeat(f.status,{...f.lock,projectionRoot:other},f.paths).reasons.includes('LIVE_PRODUCER_INSTANCE_MISMATCH'));
  assert.ok(validateProducerHeartbeat({...f.status,snapshotPath:f.paths.statusPath},f.lock,f.paths).reasons.includes('LIVE_PRODUCER_PATH_MISMATCH'));
});
test('unresolvable aliases and missing path declarations are not treated as equivalent',t=>{
  const f=fixture(t);fs.unlinkSync(f.alias);
  assert.ok(validateProducerHeartbeat(f.status,f.lock,f.paths).reasons.includes('LIVE_PRODUCER_PATH_MISMATCH'));
  assert.ok(validateProducerHeartbeat({...f.status,dataRoot:null},f.lock,f.paths).reasons.includes('LIVE_PRODUCER_PATH_MISMATCH'));
});
test('equivalent paths never excuse a wrong instance, dead process, stale or future heartbeat',t=>{
  const f=fixture(t);
  assert.ok(validateProducerHeartbeat(f.status,{...f.lock,workerInstanceId:crypto.randomUUID()},f.paths).reasons.includes('LIVE_PRODUCER_INSTANCE_MISMATCH'));
  assert.ok(validateProducerHeartbeat(f.status,f.lock,{...f.paths,isProcessAlive:()=>false}).reasons.includes('LIVE_PRODUCER_PROCESS_MISSING'));
  for(const offset of [-16_000,6_000])assert.ok(validateProducerHeartbeat({...f.status,observedAt:new Date(f.paths.now.getTime()+offset).toISOString()},f.lock,f.paths).reasons.includes('LIVE_PRODUCER_HEARTBEAT_STALE'));
});

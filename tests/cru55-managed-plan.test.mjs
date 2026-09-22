import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SAFETY,digest } from '../src/cvd-observation-core.mjs';
import { sourceDirectoryIdentity,validateRuntimeBinding,verifyBoundSourceRoot,resolveBoundSourceFile,assertBoundWriteRoot } from '../src/cru55-runtime-binding.mjs';
import { runManagedCycle,selectManagedSources,managedDelayMs } from '../src/cru55-managed-plan.mjs';
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-managed-test-')),sourceRoot=path.join(root,'data','live-events'),outputRoot=path.join(root,'data','runtime','cru55-overview');fs.mkdirSync(sourceRoot,{recursive:true});
  const binding={schemaVersion:'cru55-runtime-binding-v1',state:'PROPOSED',runtimeRoot:root,runtimeCommit:'a'.repeat(40),dataRoot:path.join(root,'data'),sourceRoot,outputRoot,readerRoot:outputRoot,
    sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)},sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:'2026-09-18'},
    producer:'STREAM_PAGED_V2',sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',sourceKind:'SYNTHETIC_FIXTURE',bindingHash:digest(root),...SAFETY};
  const write=(date,value=date)=>fs.writeFileSync(path.join(sourceRoot,date+'.ndjson'),JSON.stringify({previousHash:'GENESIS',recordHash:digest(value),receivedAt:date+'T00:00:00+08:00'})+'\n');
  return {root,binding,write,dispose(){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-managed-test-'));fs.rmSync(root,{recursive:true,force:true});}};
}
test('stream proposal pins plain target identity and refuses source/write escape without changing frozen policy',()=>{
  const f=fixture();try{
    const b=f.binding;f.write('2026-09-18');const plan=validateRuntimeBinding(b,{runtimeRoot:f.root,head:b.runtimeCommit});
    assert.equal(plan.producer,'STREAM_PAGED_V2');assert.equal(plan.activationReady,false);
    assert.equal(verifyBoundSourceRoot(b),b.sourceRoot);
    assert.equal(resolveBoundSourceFile(b,path.join(b.sourceRoot,'2026-09-18.ndjson')),path.join(b.sourceRoot,'2026-09-18.ndjson'));
    assert.throws(()=>verifyBoundSourceRoot({...b,sourceAlias:{...b.sourceAlias,targetIdentity:{...b.sourceAlias.targetIdentity,ino:'0'}}}),/TARGET_IDENTITY/);
    assert.throws(()=>resolveBoundSourceFile(b,path.join(f.root,'outside.ndjson')),/OUTSIDE_BINDING/);
    assert.throws(()=>assertBoundWriteRoot(b,path.join(f.root,'outside')),/WRITE_ROOT_ESCAPE/);
    assert.throws(()=>validateRuntimeBinding({...b,sourceAlias:null},{runtimeRoot:f.root,head:b.runtimeCommit}),/SOURCE_ALIAS/);
  }finally{f.dispose();}
});
test('managed publication pins day/night separately and discovers midnight file without merging source identities',async()=>{
  const f=fixture();try{
    f.write('2026-09-18');const b=f.binding,now=Date.parse('2026-09-19T01:00:00+08:00'),calls=[];
    let publication={state:'PUBLISHED',artifactHash:digest('day'),session:'DAY',tradeDate:'2026-09-18',availableAt:'2026-09-18T13:40:00+08:00',cutoff:{ledgerOrdinal:20}};
    const runner=async args=>{calls.push(args);return publication;};
    const first=await runManagedCycle(b,{runStreamCycle:runner,now});assert.deepEqual(first.missingViews,['night']);
    publication={...publication,artifactHash:digest('night'),session:'NIGHT',tradeDate:'2026-09-21',availableAt:'2026-09-18T23:59:00+08:00'};
    await runManagedCycle(b,{runStreamCycle:runner,now});
    let manifest=JSON.parse(fs.readFileSync(path.join(b.outputRoot,'stream-selection.json')));
    assert.equal(manifest.views.day.artifactHash,digest('day'));assert.equal(manifest.views.night.artifactHash,digest('night'));
    assert.equal(manifest.views.day.relativeRunPath,manifest.views.night.relativeRunPath);
    f.write('2026-09-19');f.write('2026-09-20');assert.deepEqual(selectManagedSources(b,{now}),['2026-09-18.ndjson','2026-09-19.ndjson']);
    publication={...publication,state:'UNCHANGED'};await runManagedCycle(b,{runStreamCycle:runner,now});
    publication={state:'PUBLISHED',artifactHash:digest('after-midnight'),session:'NIGHT',tradeDate:'2026-09-21',availableAt:'2026-09-19T00:01:00+08:00',cutoff:{ledgerOrdinal:1}};
    await runManagedCycle(b,{runStreamCycle:runner,now});
    manifest=JSON.parse(fs.readFileSync(path.join(b.outputRoot,'stream-selection.json')));
    assert.notEqual(manifest.views.day.sourceKey,manifest.views.night.sourceKey);
    assert.equal(manifest.views.night.artifactHash,digest('after-midnight'));
    assert.ok(calls.every(c=>c.sourceKind==='SYNTHETIC_FIXTURE'&&c.publishAtSessionBoundary===true&&c.maxPages===8&&c.maxBytes===8388608));
    assert.notEqual(calls.at(-1).runRoot,calls[0].runRoot);
  }finally{f.dispose();}
});
test('empty source advances cursor and UNCHANGED recovers routing after publication crash',async()=>{
  const f=fixture();try{
    fs.writeFileSync(path.join(f.binding.sourceRoot,'2026-09-18.ndjson'),'');f.write('2026-09-19');
    const options={now:Date.parse('2026-09-19T12:00:00+08:00'),runStreamCycle:async()=>({state:'UNCHANGED',artifactHash:digest('recovered'),session:'DAY',tradeDate:'2026-09-19',availableAt:'2026-09-19T09:00:00+08:00',cutoff:{ledgerOrdinal:1}})};
    assert.equal((await runManagedCycle(f.binding,options)).state,'WAITING_FOR_COMPLETE_RECORD');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.binding.outputRoot,'stream-managed-state.json'))).cursor,1);
    assert.equal((await runManagedCycle(f.binding,options)).state,'UNCHANGED');
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.binding.outputRoot,'stream-selection.json'))).views.day.artifactHash,digest('recovered'));
  }finally{f.dispose();}
});
test('managed prior uses only an existing immutable other-view artifact inside own output',async()=>{
  const f=fixture();try{
    f.write('2026-09-18');const b=f.binding,now=Date.parse('2026-09-18T23:00:00+08:00');
    const day={state:'PUBLISHED',artifactHash:digest('prior-day'),session:'DAY',tradeDate:'2026-09-18',availableAt:'2026-09-18T13:30:00+08:00',cutoff:{ledgerOrdinal:1}};
    const first=await runManagedCycle(b,{now,runStreamCycle:async()=>day});
    const artifactPath=path.join(b.outputRoot,first.relativeRunPath,day.artifactHash+'.stream-view.json');fs.mkdirSync(path.dirname(artifactPath),{recursive:true});fs.writeFileSync(artifactPath,'{}');
    fs.appendFileSync(path.join(b.sourceRoot,'2026-09-18.ndjson'),JSON.stringify({payload:{session:'NIGHT'}})+'\n');
    let called;await runManagedCycle(b,{now,runStreamCycle:async args=>{called=args;return {state:'PENDING'};}});
    assert.deepEqual(called.priorPublications,{day:{artifactPath,artifactHash:day.artifactHash},night:null});
    fs.unlinkSync(artifactPath);await runManagedCycle(b,{now,runStreamCycle:async args=>{called=args;return {state:'PENDING'};}});assert.deepEqual(called.priorPublications,{day:null,night:null});
  }finally{f.dispose();}
});
test('catch-up waits briefly only after measured progress',()=>{
  assert.equal(managedDelayMs({state:'PENDING',metrics:{pages:1}}),250);
  assert.equal(managedDelayMs({state:'PENDING',metrics:{bytes:4}}),250);
  for(const result of [{state:'PENDING'},{state:'PENDING',metrics:{bytes:0,pages:0}},{state:'UNCHANGED',metrics:{pages:1}},{state:'WAITING_FOR_COMPLETE_RECORD'}])assert.equal(managedDelayMs(result),5000);
});
test('changed source genesis and changed manager configuration cannot silently reset the run',async()=>{
  const f=fixture();try{
    f.write('2026-09-18');const options={now:Date.parse('2026-09-18T12:00:00+08:00'),runStreamCycle:async()=>({state:'PENDING'})};
    await runManagedCycle(f.binding,options);f.write('2026-09-18','changed-genesis');
    await assert.rejects(()=>runManagedCycle(f.binding,options),/SOURCE_REPLACED/);
    await assert.rejects(()=>runManagedCycle({...f.binding,bindingHash:digest('different')},options),/CONFIG_CHANGED/);
  }finally{f.dispose();}
});

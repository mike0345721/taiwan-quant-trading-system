import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync,fork} from 'node:child_process';
import {ManagedContinuity} from '../src/cru55-guarded-continuity.mjs';
import {probeManagedProcess,nativeManagedProcess} from '../src/cru55-managed-owner.mjs';
import {CONTINUITY_POLICY,CONTINUITY_PRODUCER,validateContinuityConfig} from '../src/cru55-continuity-policy.mjs';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {createStreamReader} from '../src/cru55-stream-reader.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY,digest,stableJson} from '../src/cvd-observation-core.mjs';
import {readManagedConfig,managedDelayMs,runManagedCycle} from '../src/cru55-managed-plan.mjs';
import {sourceDirectoryIdentity,validateRuntimeBinding} from '../src/cru55-runtime-binding.mjs';

const native=process.platform==='win32';
const json=file=>JSON.parse(fs.readFileSync(file,'utf8'));
function fixture(){
  const base=path.resolve('data/test-tmp');fs.mkdirSync(base,{recursive:true});
  const root=fs.mkdtempSync(path.join(base,'continuity-product-')),outputRoot=path.join(root,'output');
  fs.mkdirSync(path.join(outputRoot,'managed-owner.lock'),{recursive:true});
  const actual=probeManagedProcess(process.pid),owner={nonce:crypto.randomUUID(),pid:process.pid,startTime:actual.startTime,commandLine:actual.commandLine,
    bindingHash:'b'.repeat(64),runtimeCommit:'a'.repeat(40),configPath:path.join(root,'config.json'),outputRoot};
  fs.writeFileSync(path.join(outputRoot,'managed-owner.lock','owner.json'),JSON.stringify({schemaVersion:'cru55-managed-owner-v1',...owner}));
  fs.mkdirSync(path.join(root,'input'));
  const sourcePath=path.join(root,'input','2026-09-15.ndjson'),runRoot=path.join(outputRoot,'sources','a'.repeat(64));
  const continuity=new ManagedContinuity(owner);
  let previous='GENESIS',ordinal=0;
  const append=(count,{time='2026-09-14T15:00:00+08:00',volume=1,kind='futures_tick',step=20000}={})=>{
    let text='';
    for(let i=0;i<count;i++,ordinal++){
      const clock=Date.parse(time)+ordinal*step,event=new Date(clock).toISOString();
      const row=buildLiveEventRecord({kind,code:'TXFI6',receivedAt:new Date(clock+1).toISOString(),...SAFETY,
        payload:{_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',eventTime:event,datetime:event,close:20000+ordinal%11,volume,tick_type:ordinal%3,bid_price:[19999],ask_price:[20001]}},previous);
      previous=row.recordHash;text+=JSON.stringify(row)+'\n';
    }
    fs.appendFileSync(sourcePath,text);return Buffer.byteLength(text);
  };
  const options={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',ownerContext:owner,sourceVerification:CONTINUITY_POLICY,continuity,maxPages:8,maxVerifyRanges:2};
  const finish=(extra={})=>{for(let i=0;i<500;i++){const r=runStreamCycle({...options,...extra});if(['PUBLISHED','UNCHANGED'].includes(r.state))return r;}throw Error('DID_NOT_SETTLE');};
  const publish=r=>{const selectionFile=path.join(outputRoot,'stream-selection.json'),previous=fs.existsSync(selectionFile)?json(selectionFile).views:{};fs.writeFileSync(path.join(outputRoot,'stream-selection.json'),JSON.stringify({schemaVersion:'cru55-stream-selection-v1',bindingHash:owner.bindingHash,...SAFETY,
    views:{...previous,...(r.revalidatedPrior?{[r.revalidatedPrior.session.toLowerCase()]:r.revalidatedPrior}:{}),[r.session.toLowerCase()]:{...r,sourceKey:'a'.repeat(64),relativeRunPath:'sources/'+'a'.repeat(64)}}}));};
  return {root,outputRoot,sourcePath,runRoot,owner,continuity,append,finish,publish,options,
    close(){continuity.close();const resolved=fs.realpathSync(root);assert.ok(resolved.startsWith(base+path.sep));fs.rmSync(resolved,{recursive:true,force:true});}};
}

test('v3 exact products, bounded full/suffix verification, actual owner, per-request reader and research quarantine',{skip:!native},t=>{
  const f=fixture();
  try{
    let total=0,last=0;
    for(const [count,volume,kind] of [[140,1,'futures_tick'],[19,0.25,'futures_tick'],[4,2,'futures_tick'],[1,1,'futures_bidask']]){
      t.diagnostic(JSON.stringify({count,volume,kind}));
      const bytes=f.append(count,{volume,kind});total+=bytes;
      const before={...f.continuity.metrics},r=f.finish();f.publish(r);
      const oracle=f.finish({runRoot:path.join(f.root,'oracle'),sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',continuity:null,ownerContext:null,projectionMode:'FULL_SCAN'});
      const a=json(path.join(f.runRoot,r.artifactHash+'.stream-view.json')),b=json(path.join(f.root,'oracle',oracle.artifactHash+'.stream-view.json'));
      // Compare the complete numerical/time/quality/null products, including
      // all six frames, charts and history; only policy envelopes differ.
      assert.deepEqual(a.view,b.view);
      assert.equal(f.continuity.metrics.fullReadBytes-before.fullReadBytes,last?0:total);
      assert.equal(f.continuity.metrics.suffixReadBytes-before.suffixReadBytes,last?bytes:0);
      assert.equal(a.integrity.originalRawPrefixVerified,false);assert.equal(a.researchEligibility.eligible,false);
      const reader=createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash,producer:CONTINUITY_PRODUCER});
      const value=reader({view:'night'});assert.equal(value.chart.cutoff.ledgerOrdinal,r.cutoff.ledgerOrdinal);assert.equal(value.researchEligibility.eligible,false);
      assert.equal(value.publication.publishedAt,r.publishedAt);assert.ok(Date.parse(r.publishedAt)>Date.parse(value.chart.availableAt));
      assert.throws(()=>createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash})({view:'night'}),/POLICY/);
      assert.throws(()=>createStreamReader(f.outputRoot,{bindingHash:'c'.repeat(64),producer:CONTINUITY_PRODUCER})({view:'night'}),/BINDING/);
      last=r.cutoff.ledgerOrdinal;
    }
    const reader=createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash,producer:CONTINUITY_PRODUCER});reader({view:'night'});
    const status=path.join(f.outputRoot,'stream-continuity-status.json'),old=json(status);
    fs.writeFileSync(status,JSON.stringify({...old,state:'INVALID'}));assert.throws(()=>reader({view:'night'}),/PUBLICATION_INVALID/);
    fs.writeFileSync(status,JSON.stringify(old));
    const ownerFile=path.join(f.outputRoot,'managed-owner.lock','owner.json'),owner=json(ownerFile);
    fs.writeFileSync(ownerFile,JSON.stringify({...owner,nonce:'changed'}));assert.throws(()=>reader({view:'night'}),/OWNER_RECORD_CHANGED/);
    fs.writeFileSync(ownerFile,JSON.stringify(owner));
    assert.throws(()=>nativeManagedProcess(process.pid,'0'),/CREATION_CHANGED/);
    // Invalidation is durably visible while all guards are still held. A
    // failed invalidation keeps guards; it must never free a still-visible value.
    const rename=fs.renameSync;let invalidationObserved=false;
    fs.renameSync=(from,to)=>{if(to===status){assert.throws(()=>{const fd=fs.openSync(f.sourcePath,'r+');try{fs.writeSync(fd,Buffer.from('x'),0,1,0);}finally{fs.closeSync(fd);}});invalidationObserved=true;}return rename(from,to);};
    try{f.continuity.close();}finally{fs.renameSync=rename;}
    assert.equal(invalidationObserved,true);assert.throws(()=>reader({view:'night'}),/PUBLICATION_INVALID/);
    t.diagnostic(JSON.stringify({totalRawBytes:total,metrics:f.continuity.metrics,exactProducts:true,researchEligible:false}));
  }finally{f.close();}
});

test('same-file prior gets independent full proof; append/reopen, date rotation, shutdown and restart full verification',{skip:!native},t=>{
  const f=fixture();let restarted;
  try{
    f.append(8);const night=f.finish();f.publish(night);const prior={artifactHash:night.artifactHash,artifactPath:path.join(f.runRoot,night.artifactHash+'.stream-view.json')};
    const nightBytes=fs.statSync(f.sourcePath).size;
    f.append(8,{time:'2026-09-15T08:45:00+08:00'});
    const before={...f.continuity.metrics},day=f.finish({priorPublication:prior});f.publish(day);
    assert.equal(day.session,'DAY');
    const reader=createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash,producer:CONTINUITY_PRODUCER});
    assert.equal(reader({view:'night'}).chart.cutoff.ledgerOrdinal,night.cutoff.ledgerOrdinal);assert.equal(reader({view:'day'}).chart.cutoff.ledgerOrdinal,day.cutoff.ledgerOrdinal);
    const total=fs.statSync(f.sourcePath).size;
    assert.equal(f.continuity.metrics.fullReadBytes-before.fullReadBytes,total+nightBytes,'new current session and separate same-file prior both full verify');
    const a=json(path.join(f.runRoot,day.artifactHash+'.stream-view.json'));assert.equal(a.integrity.adjacentRawPrefixVerified,false);assert.equal(a.integrity.adjacentGuardedPrefixVerified,true);
    // Collector's open-append-close pattern, including CPython and a new dated
    // file, works while old prefix is pinned; destructive rotation waits for close.
    execFileSync('python',['-c','import sys\nwith open(sys.argv[1], "ab") as f: f.write(b"\\n")',f.sourcePath],{windowsHide:true});
    fs.writeFileSync(path.join(f.root,'next-date.ndjson'),'');
    assert.throws(()=>fs.renameSync(f.sourcePath,f.sourcePath+'.rotated'));
    // Remove only the deliberate incomplete tail after normal guard cleanup.
    f.continuity.close();assert.throws(()=>reader({view:'night'}));assert.throws(()=>reader({view:'day'}));fs.truncateSync(f.sourcePath,total);
    restarted=new ManagedContinuity(f.owner);
    const recovered=f.finish({continuity:restarted,priorPublication:prior});f.publish(recovered);
    assert.equal(restarted.metrics.fullReadBytes,total+nightBytes);assert.equal(restarted.metrics.suffixReadBytes,0);
    assert.deepEqual(reader({view:'night'}).chart.cutoff,night.cutoff);assert.deepEqual(reader({view:'day'}).chart.cutoff,day.cutoff);
    assert.deepEqual(json(path.join(f.runRoot,recovered.revalidatedPrior.artifactHash+'.stream-view.json')).view,json(prior.artifactPath).view);
    assert.deepEqual(json(path.join(f.runRoot,recovered.artifactHash+'.stream-view.json')).view,a.view);
    restarted.close();fs.renameSync(f.sourcePath,f.sourcePath+'.rotated');fs.renameSync(f.sourcePath+'.rotated',f.sourcePath);
    t.diagnostic(JSON.stringify({sameFile:true,nightBytes,total,restartFullBytes:restarted.metrics.fullReadBytes}));
  }finally{restarted?.close();f.close();}
});

test('policy is explicit and no legacy or incomplete binding can opt in',()=>{
  assert.equal(validateContinuityConfig({producer:'STREAM_PAGED_V2',sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION'}),false);
  const b={producer:CONTINUITY_PRODUCER,sourceVerification:CONTINUITY_POLICY,outputVersion:'stream-continuity-v1',ownerDecisionUrl:'https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5847637358'};
  assert.equal(validateContinuityConfig(b),true);
  for(const key of Object.keys(b)){const bad={...b};delete bad[key];assert.throws(()=>validateContinuityConfig(bad),/BINDING_INVALID/);}
  assert.throws(()=>runStreamCycle({sourceVerification:CONTINUITY_POLICY,prefixProtection:'STAMP'}),/WINDOWS_REQUIRED/);
});


test('fractional and unsafe numeric inputs keep the full-scan result or exact existing rejection',{skip:!native},t=>{
  for(const volume of [0.1,Number.MAX_SAFE_INTEGER]){
    const f=fixture();
    try{
      f.append(140);f.finish();f.finish({runRoot:path.join(f.root,'oracle'),sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',continuity:null,ownerContext:null,projectionMode:'FULL_SCAN'});
      f.append(19,{volume});
      let result,oracle,error,oracleError;
      try{result=f.finish();}catch(e){error=e.message;}
      try{oracle=f.finish({runRoot:path.join(f.root,'oracle'),sourceVerification:'FULL_PREFIX_BEFORE_PUBLICATION',continuity:null,ownerContext:null,projectionMode:'FULL_SCAN'});}catch(e){oracleError=e.message;}
      assert.equal(error,oracleError);
      if(!error)assert.deepEqual(json(path.join(f.runRoot,result.artifactHash+'.stream-view.json')).view,json(path.join(f.root,'oracle',oracle.artifactHash+'.stream-view.json')).view);
      else {assert.equal(error,'STREAM_WINDOW_PARITY_MISMATCH');assert.equal(json(path.join(f.outputRoot,'stream-continuity-status.json')).state,'INVALID');}
      t.diagnostic(JSON.stringify({volume,result:error??'EXACT_PRODUCTS',oracle:oracleError??'EXACT_PRODUCTS'}));
    }finally{f.close();}
  }
});

test('guard loss forces full verification and corrupt metadata revokes cached reader eligibility',{skip:!native},t=>{
  const f=fixture();
  try{
    f.append(8);let r=f.finish();f.publish(r);
    const before={...f.continuity.metrics},stat=fs.statSync;let injected=false;
    fs.statSync=(file,...args)=>{if(file===f.sourcePath&&args[0]?.bigint&&!injected){injected=true;throw Error('STREAM_PREFIX_LEASE_LOST');}return stat(file,...args);};
    try{assert.throws(()=>f.finish(),/LEASE_LOST/);}finally{fs.statSync=stat;}
    assert.equal(json(path.join(f.outputRoot,'stream-continuity-status.json')).state,'INVALID');
    r=f.finish();f.publish(r);
    assert.equal(f.continuity.metrics.fullReadBytes-before.fullReadBytes,fs.statSync(f.sourcePath).size);
    const reader=createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash,producer:CONTINUITY_PRODUCER});reader({view:'night'});
    const chunk=path.join(f.runRoot,'chunks','000000000001.json'),old=json(chunk);fs.writeFileSync(chunk,JSON.stringify({...old,rawHash:'0'.repeat(64)}));
    assert.throws(()=>f.finish(),/CHUNK_CHAIN_INVALID/);assert.throws(()=>reader({view:'night'}),/PRODUCER_BLOCKED|PUBLICATION_INVALID/);
    t.diagnostic(JSON.stringify({guardLossFullBytes:fs.statSync(f.sourcePath).size,metadataTamperBlocked:true}));
  }finally{f.close();}
});


test('true process exit invalidates disk receipt; new native owner must full verify before reader acceptance',{skip:!native,timeout:60000},async t=>{
  const base=path.resolve('data/test-tmp'),root=fs.mkdtempSync(path.join(base,'continuity-process-')),outputRoot=path.join(root,'output');
  const children=[];
  const start=()=>new Promise((resolve,reject)=>{
    const child=fork(path.resolve('tests/fixtures/cru55-continuity-owner-child.mjs'),[root],{windowsHide:true,stdio:['ignore','ignore','pipe','ipc']});children.push(child);
    let stderr='';child.stderr.on('data',x=>{stderr+=x;});child.once('error',reject);child.once('exit',code=>{if(code)reject(Error(stderr));});child.once('message',result=>resolve({child,...result}));
  });
  const stop=(child,mode)=>new Promise(resolve=>{child.once('exit',resolve);child.send(mode);});
  try{
    const a=await start(),reader=createStreamReader(outputRoot,{bindingHash:'b'.repeat(64),producer:CONTINUITY_PRODUCER});reader({view:'night'});
    await stop(a.child,'crash');assert.equal(json(path.join(outputRoot,'stream-continuity-status.json')).state,'VALID');
    assert.throws(()=>reader({view:'night'}),/DEAD_OR_UNKNOWN/);
    const b=await start();assert.equal(b.metrics.fullReadBytes,b.bytes);assert.equal(b.metrics.suffixReadBytes,0);assert.notEqual(b.result.producerEpoch,a.result.producerEpoch);reader({view:'night'});
    await stop(b.child,'close');assert.throws(()=>reader({view:'night'}),/PUBLICATION_INVALID/);
    const c=await start();reader({view:'night'});
    const cleanup=new Promise(resolve=>c.child.once('message',resolve)),exit=new Promise(resolve=>c.child.once('exit',resolve));c.child.send('cleanup-failure');
    const failure=await cleanup;await exit;assert.equal(failure.cleanupError,'CRU55_CONTINUITY_CLEANUP_FAILED');assert.equal(failure.state,'INVALID');assert.throws(()=>reader({view:'night'}),/PUBLICATION_INVALID/);
    t.diagnostic(JSON.stringify({trueExit:true,newEpoch:true,restartFullBytes:b.bytes,nativeCleanupFailureInvalidated:true}));
  }finally{for(const child of children)if(child.exitCode===null)child.kill();assert.ok(fs.realpathSync(root).startsWith(base+path.sep));fs.rmSync(root,{recursive:true,force:true});}
});


test('v3 candidate config creates an isolated output contract and formal activation stays blocked',()=>{
  const base=path.resolve('data/test-tmp');fs.mkdirSync(base,{recursive:true});
  const dir=fs.mkdtempSync(path.join(base,'continuity-binding-')),root=path.join(dir,'candidate'),sourceRoot=path.join(root,'data/cru55-dynamic/fixtures');fs.mkdirSync(sourceRoot,{recursive:true});
  // A hermetic candidate gitfile checkout, independent of the caller's branch
  // and whether CI checked out a normal repository or a managed worktree.
  const git=args=>execFileSync('git',args,{cwd:root,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']}).trim();
  git(['init','--quiet','--initial-branch=codex/cru55-cvd-performance-v1','--separate-git-dir='+path.join(dir,'metadata')]);
  git(['-c','user.name=Fixture','-c','user.email=fixture@example.invalid','-c','commit.gpgsign=false','commit','--quiet','--allow-empty','-m','fixture']);
  const head=git(['rev-parse','HEAD']);
  const b={schemaVersion:'cru55-managed-candidate-v1',runtimeCommit:head,runId:'candidate-continuity-contract-test',producer:CONTINUITY_PRODUCER,sourceVerification:CONTINUITY_POLICY,outputVersion:'stream-continuity-v1',ownerDecisionUrl:'https://github.com/mike0345721/taiwan-quant-trading-system/pull/73#issuecomment-5847637358',sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:'2026-09-24'},sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)},...SAFETY};
  const file=path.join(dir,'config.json');
  try{
    fs.writeFileSync(file,JSON.stringify(b));const plan=readManagedConfig(file,{runtimeRoot:root,candidate:true});assert.equal(plan.outputRoot,path.join(root,'data/cru55-dynamic/managed',b.runId,b.outputVersion));assert.equal(plan.activationReady,false);
    assert.equal(managedDelayMs({state:'PENDING',metrics:{continuityMetadataChunks:128,bytes:0,pages:0}}),0);
    const formal={...b,schemaVersion:'cru55-runtime-binding-v1',state:'OWNER_APPROVED',runtimeRoot:root,dataRoot:path.join(root,'data'),sourceRoot:path.join(root,'data/live-events'),outputRoot:path.join(root,'data/cru55-runtime/output',b.outputVersion)};formal.readerRoot=formal.outputRoot;
    assert.throws(()=>validateRuntimeBinding(formal,{runtimeRoot:root,head,approvedMain:head,activation:true}),/CANDIDATE_ONLY/);
    fs.writeFileSync(file,JSON.stringify({...b,outputVersion:undefined}));assert.throws(()=>readManagedConfig(file,{runtimeRoot:root,candidate:true}),/BINDING_INVALID/);
  }finally{assert.ok(fs.realpathSync(dir).startsWith(base+path.sep));fs.rmSync(dir,{recursive:true,force:true});}
});


test('interleaved prior completion never regresses managed selection or a newer live publication',{skip:!native},async t=>{
  const f=fixture();
  try{
    f.append(8);const old=f.finish();f.publish(old);
    f.append(8);const next=f.finish();f.publish(next);
    assert.equal(f.continuity.publish(f.runRoot,old.session,old.artifactHash,[],old.publishedAt,{availableAt:old.availableAt,cutoff:old.cutoff}),false);
    // Even an equal/later availableAt must not roll a same-source cutoff back.
    assert.equal(f.continuity.publish(f.runRoot,old.session,old.artifactHash,[],old.publishedAt,{availableAt:next.availableAt,cutoff:old.cutoff}),false);
    const reader=createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash,producer:CONTINUITY_PRODUCER});assert.equal(reader({view:'night'}).chart.cutoff.ledgerOrdinal,next.cutoff.ledgerOrdinal);
    const selectionFile=path.join(f.outputRoot,'stream-selection.json');fs.unlinkSync(selectionFile);
    const sourceRoot=path.dirname(f.sourcePath);fs.writeFileSync(path.join(sourceRoot,'2026-09-16.ndjson'),fs.readFileSync(f.sourcePath));
    const binding={sourceRoot,outputRoot:f.outputRoot,sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)},sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:'2026-09-15'},sourceKind:'SYNTHETIC_FIXTURE',bindingHash:f.owner.bindingHash,sourceVerification:CONTINUITY_POLICY,producer:CONTINUITY_PRODUCER};
    const cycle=result=>runManagedCycle(binding,{runStreamCycle:async()=>result,ownerContext:f.owner,continuity:f.continuity,now:Date.parse('2026-09-16T12:00:00+08:00')});
    await cycle(old);const stale=json(selectionFile).views.night;
    await cycle(next);const current=json(selectionFile).views.night;
    assert.notEqual(stale.sourceKey,current.sourceKey);
    await cycle({...next,session:'DAY',revalidatedPrior:stale});
    assert.deepEqual(json(selectionFile).views.night,current);
    await cycle({...next,session:'DAY',revalidatedPrior:{...current,availableAt:current.availableAt,cutoff:old.cutoff,artifactHash:old.artifactHash}});
    assert.deepEqual(json(selectionFile).views.night,current);
    t.diagnostic(JSON.stringify({interleavedSources:2,selectionMonotonic:true,registryMonotonic:true,newerReaderValid:true}));
  }finally{f.close();}
});

test('real managed routing restores both same-file selections after a new owner epoch',{skip:!native},async t=>{
  const f=fixture();let restarted;
  try{
    const sourceRoot=path.dirname(f.sourcePath),binding={sourceRoot,outputRoot:f.outputRoot,sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)},sourceSelection:{kind:'DATED_CALENDAR_LEDGER',startDate:'2026-09-15'},sourceKind:'SYNTHETIC_FIXTURE',bindingHash:f.owner.bindingHash,sourceVerification:CONTINUITY_POLICY,producer:CONTINUITY_PRODUCER};
    const finish=async continuity=>{for(let i=0;i<100;i++){const r=await runManagedCycle(binding,{runStreamCycle,ownerContext:f.owner,continuity,now:Date.parse('2026-09-15T12:00:00+08:00')});if(['PUBLISHED','UNCHANGED'].includes(r.state))return r;}throw Error('MANAGED_NOT_SETTLED');};
    f.append(8);await finish(f.continuity);const reader=createStreamReader(f.outputRoot,{bindingHash:f.owner.bindingHash,producer:CONTINUITY_PRODUCER}),night=reader({view:'night'});
    f.append(8,{time:'2026-09-15T08:45:00+08:00'});await finish(f.continuity);const day=reader({view:'day'});const {freshness:nowFresh,...nowChart}=reader({view:'night'}).chart,{freshness:oldFresh,...oldChart}=night.chart;assert.deepEqual(nowChart,oldChart);assert.equal(nowFresh.state,oldFresh.state);assert.equal(nowFresh.reason,oldFresh.reason);
    f.continuity.close();assert.throws(()=>reader({view:'night'}));assert.throws(()=>reader({view:'day'}));
    f.owner.nonce=crypto.randomUUID();fs.writeFileSync(path.join(f.outputRoot,'managed-owner.lock','owner.json'),JSON.stringify({schemaVersion:'cru55-managed-owner-v1',...f.owner}));
    restarted=new ManagedContinuity(f.owner);await finish(restarted);
    assert.deepEqual(reader({view:'night'}).chart.cutoff,night.chart.cutoff);assert.deepEqual(reader({view:'day'}).chart.cutoff,day.chart.cutoff);
    assert.notEqual(reader({view:'night'}).integrity.producer.epoch,night.integrity.producer.epoch);
    assert.equal(reader({view:'night'}).researchEligibility.eligible,false);
    t.diagnostic(JSON.stringify({managedBothViews:true,restartFullBytes:restarted.metrics.fullReadBytes}));
  }finally{restarted?.close();f.close();}
});

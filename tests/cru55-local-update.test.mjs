import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {validateUpdatePlan,runLocalUpdate,writeJson,readJson,sha256} from '../src/cru55-local-update.mjs';
import {publicationMatches,assertOwnedProcesses,assertRetainedConfig} from '../src/cru55-local-update-windows.mjs';
function fixture(){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-update-'));
  const p=validateUpdatePlan({schemaVersion:'cru55-local-update-v1',mode:'ISOLATED_CANDIDATE',targetSha:'a'.repeat(40),approvedMainSha:'b'.repeat(40),decisionUrl:'https://github.com/mike0345721/taiwan-quant-trading-system/pull/71#issuecomment-5778367063',lane:'test',port:3061,timeoutSeconds:30,seedRoot:path.join(root,'data/cru55-update/inputs/seed'),seedManifestHash:'c'.repeat(64),expected:{view:'night',ordinal:1800,recordHash:'d'.repeat(64),cvd:-14},uiFiles:[{path:'public/index.html',sha256:'e'.repeat(64)}]},root);
  const calls=[],old={head:'b'.repeat(40),root:'old',expected:p.expected,uiFiles:p.uiFiles};
  const driver={planHash:()=>p.targetSha,preflight:async()=>calls.push('preflight'),preserve:async()=>calls.push('preserve'),prepare:async()=>{calls.push('prepare');return {head:p.targetSha,root:'new'};},start:async(_p,r)=>{calls.push('start:'+r.root);return {...r,planHash:p.targetSha};},stop:async()=>calls.push('stop'),verify:async(_p,r)=>{calls.push('verify:'+r.root);return {publication:r.head};},cleanupAttempt:async()=>calls.push('cleanup')};
  fs.mkdirSync(p.stateRoot,{recursive:true});writeJson(path.join(p.stateRoot,'active.json'),old);
  return {root,p,driver,calls,old,route:()=>readJson(path.join(p.stateRoot,'active.json')),cleanup(){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-update-'));fs.rmSync(root,{recursive:true,force:true});}};
}
test('one exact confirmation drives preserved side-by-side preparation before stop and genuine verify before route',async()=>{const f=fixture();try{const r=await runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha});assert.equal(r.result,'UPDATED_ISOLATED_VERIFIED');assert.deepEqual(f.calls,['preflight','preserve','prepare','preflight','stop','start:new','verify:new']);assert.equal(f.route().head,f.p.targetSha);assert.equal(r.productReady,false);}finally{f.cleanup();}});
test('confirmation and formal path/port/mode fail closed before runtime operations',async()=>{const f=fixture();try{await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:'yes'}),/EXACT_SHA/);for(const change of [{mode:'FORMAL'},{port:8787},{port:8790},{seedRoot:f.root},{lane:'../escape'},{targetSha:'main'}])assert.throws(()=>validateUpdatePlan({...f.p,...change},f.root));assert.deepEqual(f.calls,[]);}finally{f.cleanup();}});
test('repeat click and unfinished journal cannot enter another update',async()=>{const f=fixture();try{fs.mkdirSync(path.join(f.p.stateRoot,'update.lock'));await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),/ALREADY_RUNNING/);fs.rmdirSync(path.join(f.p.stateRoot,'update.lock'));writeJson(path.join(f.p.stateRoot,'transaction-interrupted.json'),{targetSha:f.p.targetSha});await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),/INTERRUPTED/);assert.deepEqual(f.calls,[]);}finally{f.cleanup();}});
test('Git/package failure leaves running old version intact, preserving failed preparation',async()=>{const f=fixture();try{f.driver.prepare=async()=>{throw Error('PACKAGE_DOWNLOAD_FAILED');};await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),/FAILED_BEFORE_SWITCH/);assert.equal(f.route().root,'old');assert.ok(!f.calls.includes('stop'));}finally{f.cleanup();}});
test('route drift during preparation refuses switching without overwriting unexpected route',async()=>{const f=fixture();try{f.driver.prepare=async()=>{writeJson(path.join(f.p.stateRoot,'active.json'),{head:'unexpected'});return {root:'new'};};await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),/ROUTE_DRIFT/);assert.equal(f.route().head,'unexpected');assert.ok(!f.calls.includes('stop'));}finally{f.cleanup();}});
test('failed publication triggers complete old start and real old verification before rollback success',async()=>{const f=fixture();try{f.driver.verify=async(_p,r)=>{f.calls.push('verify:'+r.root);if(r.root==='new')throw Error('BAD_PUBLICATION');return {restored:true};};await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),e=>e.receipt.result==='ROLLED_BACK_VERIFIED');assert.equal(f.route().root,'old');assert.ok(f.calls.indexOf('cleanup')<f.calls.indexOf('start:old'));assert.equal(f.calls.at(-1),'verify:old');}finally{f.cleanup();}});
test('partial stop also attempts recovery; unknown PID cleanup retains recovery lock',async()=>{const f=fixture();try{f.driver.stop=async()=>{throw Error('PARTIAL_STOP');};f.driver.cleanupAttempt=async()=>{throw Error('UNKNOWN_PID');};await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),e=>e.receipt.result==='RECOVERY_REQUIRED');assert.ok(fs.existsSync(path.join(f.p.stateRoot,'update.lock')));assert.equal(f.route().root,'old');}finally{f.cleanup();}});
test('same version repeat verifies runtime rather than relying on Git',async()=>{const f=fixture();try{writeJson(path.join(f.p.stateRoot,'active.json'),{...f.old,head:f.p.targetSha,planHash:f.p.targetSha});const r=await runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha});assert.equal(r.result,'UNCHANGED_VERIFIED');assert.deepEqual(f.calls,['preflight','verify:old']);}finally{f.cleanup();}});
test('result display failure after first verified route never stops its live runtime',async()=>{const f=fixture();try{fs.unlinkSync(path.join(f.p.stateRoot,'active.json'));const r=await runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha,onStage:s=>{if(s.name==='結果')throw Error('DISPLAY_FAILED');}});assert.equal(r.result,'UPDATED_ISOLATED_VERIFIED');assert.equal(r.displayWarning,true);assert.equal(f.route().root,'new');assert.ok(!f.calls.includes('cleanup'));}finally{f.cleanup();}});
test('publication rejects wrong ordinal and failed HTTP even with matching hash/CVD',()=>{const expected={ordinal:1800,recordHash:'x',cvd:-14},body={head:'h',chart:{cutoff:{ledgerOrdinal:1800,recordHash:'x'},currentCvd:-14},integrity:{originalRawPrefixVerified:true}};assert.equal(publicationMatches(200,body,'h',expected),true);assert.equal(publicationMatches(503,body,'h',expected),false);assert.equal(publicationMatches(200,body,'h',{...expected,ordinal:1801}),false);assert.equal(publicationMatches(200,body,'other',expected),false);});
test('persistent journal failure after new start cannot prevent verified old rollback',async()=>{
  const f=fixture(),rename=fs.renameSync;let fail=false;
  try{const start=f.driver.start;f.driver.start=async(p,r)=>{const value=await start(p,r);if(r.root==='new')fail=true;return value;};
    fs.renameSync=(from,to)=>{if(fail&&path.basename(to).startsWith('transaction-'))throw Error('JOURNAL_DISK_ERROR');return rename(from,to);};
    await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),e=>e.message==='UPDATE_RECEIPT_RECOVERY_REQUIRED'&&e.receipt.result==='ROLLED_BACK_VERIFIED'&&e.receipt.error==='JOURNAL_DISK_ERROR');
    assert.equal(f.route().root,'old');assert.ok(f.calls.includes('cleanup'));assert.equal(f.calls.at(-1),'verify:old');assert.ok(fs.existsSync(path.join(f.p.stateRoot,'update.lock')));
  }finally{fs.renameSync=rename;f.cleanup();}
});
test('journal failure after route commit keeps verified new runtime and recovery lock',async()=>{
  const f=fixture(),rename=fs.renameSync;let committed=false;
  try{fs.renameSync=(from,to)=>{if(committed&&path.basename(to).startsWith('transaction-'))throw Error('JOURNAL_DISK_ERROR');const v=rename(from,to);if(path.basename(to)==='active.json')committed=true;return v;};
    await assert.rejects(runLocalUpdate(f.p,{driver:f.driver,confirm:f.p.targetSha}),e=>e.receipt.result==='UPDATED_RECEIPT_RECOVERY_REQUIRED');
    assert.equal(f.route().root,'new');assert.ok(!f.calls.includes('cleanup'));assert.ok(fs.existsSync(path.join(f.p.stateRoot,'update.lock')));
  }finally{fs.renameSync=rename;f.cleanup();}
});
test('retained private config bytes must match before stopping or restarting old version',()=>{
  const f=fixture();try{const configFile=path.join(f.root,'config.json');fs.writeFileSync(configFile,'original');const r={configFile,configHash:sha256('original')};assertRetainedConfig(r);fs.writeFileSync(configFile,'changed');assert.throws(()=>assertRetainedConfig(r),/CONFIG_DRIFT/);assert.throws(()=>assertRetainedConfig({configFile}),/CONFIG_DRIFT/);}finally{f.cleanup();}
});
test('ownership binds processes to launch receipt, candidate config, session and listener; exited PID permits cleanup only',()=>{
  const root=path.resolve('data/test-release'),node=process.execPath,runId='candidate-update-123456abcdef',configFile=path.join(root,'data/cru55-dynamic/update-config.json');
  const server={pid:111,startTime:'2026-09-23T00:00:00.000Z',commandLine:`"${node}" server.mjs`},managed={pid:222,startTime:server.startTime,commandLine:`"${node}" "${path.join(root,'scripts/run-cru55-managed.mjs')}" "${configFile}" --candidate `};
  const r={root,head:'a'.repeat(40),runId,configFile,configHash:'b'.repeat(64),bindingHash:'c'.repeat(64),url:'http://127.0.0.1:3061',sessionFile:path.join(root,'session.json'),server,managed};
  const session={head:r.head,bindingHash:r.bindingHash,serverPid:111,url:r.url},owner={...managed,runtimeCommit:r.head,bindingHash:r.bindingHash,configPath:configFile,outputRoot:path.join(root,'data/cru55-dynamic/managed',runId)};
  const v={proof:r,session,owner,server,managed,listeners:[111]};assertOwnedProcesses(r,v);
  assert.throws(()=>assertOwnedProcesses({...r,managed:{...managed,pid:333}},v),/LAUNCH_RECEIPT/);
  const unrelated={...r,managed:{...managed,commandLine:'collector.exe --production'}};assert.throws(()=>assertOwnedProcesses(unrelated,{...v,proof:unrelated,managed:unrelated.managed}),/NOT_CANDIDATE/);
  assert.throws(()=>assertOwnedProcesses(r,{...v,owner:{...owner,configPath:'other'}}),/MANAGED_OWNERSHIP/);
  assert.throws(()=>assertOwnedProcesses(r,{...v,listeners:[999]}),/LISTENER_OWNERSHIP/);
  assert.throws(()=>assertOwnedProcesses(r,{...v,managed:{...managed,startTime:'2026-09-24T00:00:00Z'},allowAbsent:true}),/UNKNOWN_PID/);
  assertOwnedProcesses(r,{...v,server:null,listeners:[],allowAbsent:true});assertOwnedProcesses(r,{...v,managed:null,owner:null,allowAbsent:true});
  assert.throws(()=>assertOwnedProcesses(r,{...v,managed:null}),/UNKNOWN_PID/);
});

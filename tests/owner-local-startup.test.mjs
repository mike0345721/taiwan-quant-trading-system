import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { assertInteractiveOwnerParent, verifyOwnerBinding, prepareOwnerRoots, ownerEnvironment } from '../src/owner-local-startup.mjs';
import { validateOwnerIdentity, attachOwnerStop, stopOwner } from '../src/owner-local-acceptance.mjs';

const head='1'.repeat(40),tree='2'.repeat(40),base='3'.repeat(40),branch='codex/cru61-smc-cvd-profile-v1';
test('source pins reject dirty, wrong branch/head/tree/base and development worktrees',()=>{
  const identity={expectedHead:head,expectedTree:tree,expectedBaseMain:base,actualHead:head,actualTree:tree,
    actualBaseMain:base,actualBranch:branch,sourceClean:true};
  assert.equal(validateOwnerIdentity(identity).ready,true);
  for(const patch of [{actualHead:base},{actualTree:head},{actualBaseMain:head},{actualBranch:'main'},{sourceClean:false}])
    assert.equal(validateOwnerIdentity({...identity,...patch}).ready,false);
  const appRoot=path.resolve('/synthetic/runtime');
  const binding={schema:'owner-local-acceptance-binding-v1',machineName:'MSI-FIXTURE',sourceRoot:appRoot,
    readDataRoot:path.resolve('/synthetic/read'),producerDataRoot:path.resolve('/synthetic/producer'),branch,
    expectedHead:head,expectedTree:tree,expectedBaseMain:base};
  let calls=0;
  const options={inspect(){},machineName:'MSI-FIXTURE',git(args){calls++;
    return args[0]==='status'?'':args[0]==='branch'?branch:args[1]==='HEAD'?head:args[1]==='HEAD^{tree}'?tree:base;}};
  assert.equal(verifyOwnerBinding(binding,appRoot,options),binding);assert.equal(calls,5);
  for(const patch of [{machineName:'OTHER'},{sourceRoot:path.resolve('/synthetic/other')},{branch:'main'}])
    assert.throws(()=>verifyOwnerBinding({...binding,...patch},appRoot,options));
  assert.throws(()=>verifyOwnerBinding({...binding,sourceRoot:path.resolve('/synthetic/worktrees/dev')},
    path.resolve('/synthetic/worktrees/dev'),options));
});

test('unattended/noninteractive parent cannot submit a consent frame as the dialog',()=>{
  const options={scriptPath:'D:\\runtime\\scripts\\start-owner-local-acceptance.ps1',bindingPath:'D:\\binding.json',
    shellPath:'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe'};
  const observed={interactive:true,sessionId:2,parentSessionId:2,executablePath:options.shellPath,
    commandLine:`powershell.exe -NoProfile -STA -File "${options.scriptPath}" -BindingPath "${options.bindingPath}"`};
  assert.doesNotThrow(()=>assertInteractiveOwnerParent(observed,options));
  for(const patch of [{interactive:false},{sessionId:0},{parentSessionId:3},{executablePath:'node.exe'},
    {commandLine:observed.commandLine.replace('-STA','-NonInteractive')},{commandLine:observed.commandLine+' -Accept'}])
    assert.throws(()=>assertInteractiveOwnerParent({...observed,...patch},options),/OWNER_INTERACTIVE_PARENT_REQUIRED/);
});

test('fresh private namespaces isolate prior sessions and exclude inherited secrets/settings',t=>{
  const root=path.resolve('data');fs.mkdirSync(root,{recursive:true});
  const home=fs.mkdtempSync(path.join(root,'owner-startup-fixture-'));
  t.after(()=>{assert.ok(home.startsWith(root+path.sep));fs.rmSync(home,{recursive:true,force:true});});
  const binding={sourceRoot:path.join(home,'runtime'),readDataRoot:path.join(home,'read'),producerDataRoot:path.join(home,'producer'),
    branch,expectedHead:head,expectedTree:tree,expectedBaseMain:base};
  for(const dir of [binding.sourceRoot,binding.readDataRoot,binding.producerDataRoot])fs.mkdirSync(dir);
  const id='12345678-1234-1234-1234-123456789abc';
  const roots=prepareOwnerRoots(binding,id);
  assert.throws(()=>prepareOwnerRoots(binding,id),/EEXIST/);
  assert.deepEqual(fs.readdirSync(roots.privateDataRoot).sort(),['dashboard-chart-cache','decision-workspace']);
  const env=ownerEnvironment(binding,roots,{PATH:'synthetic-path',DASHBOARD_PASSWORD_HASH:'synthetic-old',GIT_DIR:'foreign',
    NODE_OPTIONS:'hook',CRU55_RUNTIME_BINDING:'foreign',DASHBOARD_TLS_BUNDLE:'foreign'});
  for(const key of ['DASHBOARD_PASSWORD_HASH','GIT_DIR','NODE_OPTIONS','CRU55_RUNTIME_BINDING','DASHBOARD_TLS_BUNDLE'])assert.equal(env[key],undefined);
  assert.equal(env.PORT,'18723');assert.equal(env.HOST,'127.0.0.1');assert.equal(env.COOKIE_SECURE,'1');
  const before=fs.readdirSync(binding.sourceRoot);
  assert.throws(()=>prepareOwnerRoots({...binding,readDataRoot:roots.privateDataRoot},'22345678-1234-1234-1234-123456789abc'));
  assert.deepEqual(fs.readdirSync(binding.sourceRoot),before);
});

test('launcher empty/cancelled/short-password input exits without a listener or receipt',()=>{
  const entry=path.resolve('scripts/start-owner-local-acceptance.mjs');
  for(const frame of ['',JSON.stringify({accepted:false,password:'Fixture-Only-Password-2026'}),
    JSON.stringify({accepted:true,riskVersion:'owner-local-http-risk-v1',password:'short',bindingPath:'SHOULD_NOT_BE_READ'})]) {
    const result=spawnSync(process.execPath,[entry],{input:frame?frame+'\n':'',encoding:'utf8',timeout:5000,
      windowsHide:true,env:ownerEnvironment({}, {readDataRoot:path.resolve('data'),producerDataRoot:path.resolve('data'),chartCacheRoot:path.resolve('data')})});
    assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/LISTENING|scrypt-v1|Password/);
  }
});

test('Owner stop is idempotent and delivered when shutdown attaches during startup',()=>{
  let stops=0;stopOwner();stopOwner();attachOwnerStop(()=>{stops++;});assert.equal(stops,1);stopOwner();assert.equal(stops,1);
});

// Native serialization may omit redundant quotes; argument order and values stay exact.
test('interactive parent admits optional quotes only for whitespace-free paths',()=>{
 const options={scriptPath:'D:/runtime/start.ps1',bindingPath:'D:/binding.json',shellPath:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'};
 const base={interactive:true,sessionId:1,parentSessionId:1,executablePath:options.shellPath};
 for(const line of ['powershell.exe -NoProfile -STA -File D:/runtime/start.ps1 -BindingPath D:/binding.json','powershell.exe -NoProfile -STA -File "D:/runtime/start.ps1" -BindingPath D:/binding.json'])
  assert.doesNotThrow(()=>assertInteractiveOwnerParent({...base,commandLine:line},options));
 for(const line of ['powershell.exe -NoProfile -STA -File D:/runtime/start.ps1 -BindingPath D:/binding.json -Accept','powershell.exe -NoProfile -STA -File D:/runtime/start.ps1 -BindingPath D:/binding.json.exe','powershell.exe -NoProfile -STA -File D:/runtime/start.ps1 -ExecutionPolicy Bypass -BindingPath D:/binding.json'])
  assert.throws(()=>assertInteractiveOwnerParent({...base,commandLine:line},options),/OWNER_INTERACTIVE_PARENT_REQUIRED/);
 const spaced={...options,scriptPath:'D:/Taiwan stock/start.ps1',bindingPath:'D:/Taiwan stock/binding.json'};
 assert.doesNotThrow(()=>assertInteractiveOwnerParent({...base,commandLine:'powershell.exe -NoProfile -STA -File "D:/Taiwan stock/start.ps1" -BindingPath "D:/Taiwan stock/binding.json"'},spaced));
 assert.throws(()=>assertInteractiveOwnerParent({...base,commandLine:'powershell.exe -NoProfile -STA -File D:/Taiwan stock/start.ps1 -BindingPath "D:/Taiwan stock/binding.json"'},spaced),/OWNER_INTERACTIVE_PARENT_REQUIRED/);
});
test('parent query explicitly emits UTF8 without changing machine console settings',()=>{
 const source=fs.readFileSync(new URL('../src/owner-local-startup.mjs',import.meta.url),'utf8');
 assert.ok(source.includes('[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false);'));
});

// Reproduces the real MSI Start-Process command line's final separator, not an extra argument.
test('interactive parent accepts trailing ASCII separators without changing path arguments',()=>{
 const options={scriptPath:'D:/Taiwan stock/runtime/scripts/start-owner-local-acceptance.ps1',bindingPath:'D:/Taiwan stock/evidence/binding.json',shellPath:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'};
 const base={interactive:true,sessionId:1,parentSessionId:1,executablePath:options.shellPath};
 const command='"'+options.shellPath+'" -NoProfile -STA -File "'+options.scriptPath+'" -BindingPath "'+options.bindingPath+'"';
 for(const suffix of [' ','\t',' \t  ']) assert.doesNotThrow(()=>assertInteractiveOwnerParent({...base,commandLine:command+suffix.replaceAll('\\t','\t')},options));
 for(const line of [command+' -Accept ',command+' -ExecutionPolicy Bypass ',command.replace('binding.json"','binding.json "')+' ',command.replace('binding.json','other.json')+' '])
  assert.throws(()=>assertInteractiveOwnerParent({...base,commandLine:line},options),/OWNER_INTERACTIVE_PARENT_REQUIRED/);
 for(const patch of [{interactive:false},{sessionId:0},{parentSessionId:2},{executablePath:'node.exe'}])
  assert.throws(()=>assertInteractiveOwnerParent({...base,...patch,commandLine:command+' '},options),/OWNER_INTERACTIVE_PARENT_REQUIRED/);
});
test('interactive parent rejects newline and NUL even outside its arguments',()=>{
 const options={scriptPath:'D:/runtime/start.ps1',bindingPath:'D:/binding.json',shellPath:'C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe'};
 const base={interactive:true,sessionId:1,parentSessionId:1,executablePath:options.shellPath};
 const command='powershell.exe -NoProfile -STA -File D:/runtime/start.ps1 -BindingPath D:/binding.json';
 for(const suffix of ['\n','\r','\r\n','\0',' \n'])
  assert.throws(()=>assertInteractiveOwnerParent({...base,commandLine:command+suffix},options),/OWNER_INTERACTIVE_PARENT_REQUIRED/);
});

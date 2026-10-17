import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn,execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { approvedGuestPaths,GUEST_BRANCH } from '../src/cru21-guest-guard.mjs';
import { hashPassword } from '../src/security.mjs';
import { createGuestReader } from '../src/cru21-guest-reader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hashTree=dir=>{const rows=[];function walk(p){for(const name of fs.readdirSync(p).sort()){const file=path.join(p,name),st=fs.lstatSync(file);if(st.isDirectory())walk(file);else rows.push([path.relative(dir,file),st.size,st.mtimeMs,fs.readFileSync(file).toString('base64')]);}}walk(dir);return rows;};
function connectPipeCdp(child) {
  const input = child.stdio[3];
  const output = child.stdio[4];
  assert.ok(input && output, 'Chrome DevTools pipe was not created');
  let sequence = 0;
  let buffer = Buffer.alloc(0);
  const pending = new Map();
  const listeners = new Map();
  const listenerKey = (sessionId, method) => `${sessionId || ''}:${method}`;

  output.on('data', (chunk) => {
    buffer = Buffer.concat([buffer, chunk]);
    let boundary = buffer.indexOf(0);
    while (boundary >= 0) {
      const packet = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      boundary = buffer.indexOf(0);
      if (!packet) continue;
      const message = JSON.parse(packet);
      if (message.id != null) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) handler?.reject(new Error(message.error.message));
        else handler?.resolve(message.result);
        continue;
      }
      for (const listener of listeners.get(listenerKey(message.sessionId, message.method)) || []) {
        listener(message.params);
      }
    }
  });
  child.once('exit', (code) => {
    for (const handler of pending.values()) handler.reject(new Error(`BROWSER_PIPE_CLOSED:${code}`));
    pending.clear();
  });

  return {
    command(method, params = {}, sessionId = null) {
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`);
      });
    },
    on(method, listener, sessionId = null) {
      const key = listenerKey(sessionId, method);
      const current = listeners.get(key) || [];
      current.push(listener);
      listeners.set(key, current);
    },
    close() { input.end(); },
  };
}

function sessionClient(pipe, sessionId) {
  return {
    command(method, params = {}) { return pipe.command(method, params, sessionId); },
    on(method, listener) { pipe.on(method, listener, sessionId); },
  };
}


function dataRoots(temp){const source=path.join(temp,'source');fs.mkdirSync(path.join(source,'runtime','cru34-live'),{recursive:true});fs.mkdirSync(path.join(source,'live-events'));fs.mkdirSync(path.join(source,'intraday','archive'),{recursive:true});fs.writeFileSync(path.join(source,'latest.json'),JSON.stringify({dataMode:'live',generatedAt:'2026-10-17T05:00:00Z',privateCanary:'DO_NOT_EXPOSE'}));return {source,env:{ASK_GPT_CANDIDATE_READ_ROOT:source,TX_CHART_DATA_ROOT:source,CRU34_LIVE_DATA_ROOT:source,CRU34_LIVE_SNAPSHOT_PATH:path.join(source,'runtime','cru34-live','latest.json'),CRU34_LIVE_STATUS_PATH:path.join(source,'runtime','cru34-live','status.json')}};}
test('real reader uses actual approved products and never writes any app data or returns private snapshot fields',async()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guest-data-'));
 try{
  const {source,env}=dataRoots(temp),app=path.join(temp,'app');fs.mkdirSync(app);
  const records=[['08:45:01',100],['08:49:59',101],['08:59:30',102]].map(([time,price])=>({kind:'futures_tick',product:'TXFH6',receivedAt:'2026-08-12T'+time+'.000+08:00',exchangeTimestamp:'2026-08-12T'+time+'.000',eventId:time,duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,payload:{datetime:'2026-08-12T'+time+'.000',close:String(price),volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFH6'}}));
  fs.writeFileSync(path.join(source,'live-events','2026-08-12.ndjson'),records.map(r=>JSON.stringify(r)).join('\n')+'\n');
  const paths=approvedGuestPaths(env,app);const before=hashTree(source);const bridge=[];
  const read=createGuestReader({paths,appRoot:root,head:'a'.repeat(40),base:'b'.repeat(40),deadline:{remaining:()=>10000},now:()=>new Date('2026-08-12T01:00:00Z'),bridgeGet:async route=>{bridge.push(route);return {mode:'market_data_only',formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false};}});
  for(const route of ['/api/v1/dashboard','/api/v1/tx-chart','/api/v1/decision-level-watch','/api/v1/observed-flow','/api/v1/market-pulse','/api/v1/index-leadership']){
   const result=await read(route);assert.equal(result.ok,true);assert.doesNotMatch(JSON.stringify(result),/DO_NOT_EXPOSE|sourceRoot|credential|vault/);
   if(route==='/api/v1/tx-chart')assert.equal(result.data.lastPrice,102);
   if(route==='/api/v1/dashboard')assert.equal(result.decisionWorkspace.runtimeVersion.runtimeCommit,'a'.repeat(40));
  }
  assert.deepEqual(hashTree(source),before);assert.ok(bridge.every(p=>['/health','/latest','/leadership'].includes(p)));
  assert.throws(()=>approvedGuestPaths({...env,ASK_GPT_CANDIDATE_READ_ROOT:path.parse(source).root},app),/OVERLAP/);
  fs.mkdirSync(path.join(app,'data'));fs.rmdirSync(path.join(app,'data'));fs.symlinkSync(source,path.join(app,'data'),'junction');assert.throws(()=>approvedGuestPaths(env,app),/OVERLAP/);
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
});

test('actual server guest startup does not read session/credentials or persist; disabled mode retains auth', {timeout:30000},async(t)=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'guest-process-')),app=path.join(temp,'app');fs.mkdirSync(app);
 let child;
 try{
  for(const name of ['src','config','public'])fs.cpSync(path.join(root,name),path.join(app,name),{recursive:true});
  fs.cpSync(path.join(root,'v2','src'),path.join(app,'v2','src'),{recursive:true});
  fs.copyFileSync(path.join(root,'server.mjs'),path.join(app,'server.mjs'));fs.copyFileSync(path.join(root,'package.json'),path.join(app,'package.json'));
  const vendor=path.join(app,'node_modules/lightweight-charts/dist');fs.mkdirSync(vendor,{recursive:true});fs.copyFileSync(path.join(root,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js'),path.join(vendor,'lightweight-charts.standalone.production.js'));
  const git=(...args)=>execFileSync('git',args,{cwd:app,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
  git('init','--initial-branch=main');git('config','user.email','synthetic@example.invalid');git('config','user.name','Synthetic Guest Test');git('add','.');git('commit','-m','synthetic base');const base=git('rev-parse','HEAD');
  git('checkout','-b',GUEST_BRANCH);fs.writeFileSync(path.join(app,'synthetic-version.txt'),'candidate\n');git('add','.');git('commit','-m','synthetic candidate');const head=git('rev-parse','HEAD');
  const {source,env:bindings}=dataRoots(temp),before=hashTree(source);
  const probe=path.join(temp,'probe.mjs');fs.writeFileSync(probe,`
import fs from 'node:fs'; import fsp from 'node:fs/promises';
const trip=code=>{process.stderr.write(code+'\\n');throw Error(code);};
for(const k of ['writeFileSync','appendFileSync','mkdirSync','renameSync','unlinkSync','rmSync','truncateSync','chmodSync'])fs[k]=()=>{trip('GUEST_WRITE_ATTEMPT:'+k);};
for(const k of ['writeFile','appendFile','mkdir','rename','unlink','rm','truncate','chmod'])fsp[k]=async()=>{trip('GUEST_WRITE_ATTEMPT:'+k);};
for(const k of ['write','writeSync','createWriteStream','ftruncate','ftruncateSync'])fs[k]=()=>trip('GUEST_WRITE_ATTEMPT:'+k);
const syncOpen=fs.openSync;fs.openSync=function(p,flags,...args){if(!['r','rs',0].includes(flags))trip('GUEST_WRITE_ATTEMPT:openSync');return syncOpen.call(this,p,flags,...args);};
const asyncOpen=fs.open;fs.open=function(p,flags,...args){if(!['r','rs',0].includes(flags))trip('GUEST_WRITE_ATTEMPT:open');return asyncOpen.call(this,p,flags,...args);};
const promiseOpen=fsp.open;fsp.open=async function(p,flags,...args){if(!['r','rs',0].includes(flags))trip('GUEST_WRITE_ATTEMPT:openPromise');return promiseOpen.call(this,p,flags,...args);};
const read=fs.readFileSync;fs.readFileSync=function(p,...args){if(/sessions\\.json|credentials|oauth|vault|siwc-v1|ChatGPTPlan|\\.dpapi/i.test(String(p)))trip('GUEST_SECRET_READ');return read.call(this,p,...args);};
globalThis.fetch=async(url,opt)=>{if(!/^http:\\/\\/127\\.0\\.0\\.1:8790\\/(health|latest|leadership)$/.test(String(url))||opt.redirect!=='error'||opt.credentials!=='omit')trip('GUEST_EXTERNAL_NETWORK');return new Response(JSON.stringify({mode:'market_data_only',formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false}));};
`);
  const self=spawn(process.execPath,['--import',probe,'-e',"import('node:fs').then(({default:fs})=>{try{fs.openSync('/must-never-create','w')}catch{};try{fs.readFileSync('/sessions.json')}catch{};return fetch('https://must-never-connect.invalid').catch(()=>{})})"],{cwd:app,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let selfLog='';self.stderr.on('data',b=>selfLog+=b);await new Promise(r=>self.once('exit',r));assert.match(selfLog,/GUEST_WRITE_ATTEMPT/);assert.match(selfLog,/GUEST_SECRET_READ/);assert.match(selfLog,/GUEST_EXTERNAL_NETWORK/);
  const baseEnv={PATH:process.env.PATH,NODE_NO_WARNINGS:'1',HOME:temp,TMPDIR:temp,NODE_ENV:'production',DASHBOARD_PASSWORD_HASH:hashPassword('Synthetic guest test passphrase'),HOST:'127.0.0.1',PORT:'18722',MOCK_DATA:'0',ASK_GPT_INLINE_ENABLED:'0',DASHBOARD_PREVIEW_TYPE:'CRU21_OWNER_PREVIEW',DASHBOARD_PREVIEW_DATA_MODE:'LIVE',DASHBOARD_PREVIEW_BRANCH:GUEST_BRANCH,DASHBOARD_PREVIEW_EXPECTED_HEAD:head,DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN:base,...bindings};
  let out='';child=spawn(process.execPath,['--import',probe,'server.mjs'],{cwd:app,env:{...baseEnv,CRU21_GUEST_ENABLED:'1',CRU21_GUEST_EXPIRES_AT:new Date(Date.now()+20000).toISOString()},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
  const start=Date.now();while(!out.includes('CRU21_GUEST_READ_ONLY')&&child.exitCode===null&&Date.now()-start<7000)await sleep(25);
  assert.match(out,/CRU21_GUEST_READ_ONLY/,out);
  const headers={'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'};
  const session=await fetch('http://127.0.0.1:18722/api/session',{headers});assert.equal((await session.json()).authenticated,false);
  const response=await fetch('http://127.0.0.1:18722/api/v1/dashboard',{headers});assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(hashTree(source),before);assert.equal(fs.existsSync(path.join(app,'data')),false);
  await t.test('real Chromium loads actual production workspace through guest HTTP without login or write/AI calls',{skip:!fs.existsSync('/usr/bin/chromium'),timeout:12000},async()=>{
   const browser=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+path.join(temp,'browser-profile'),'about:blank'],{stdio:['ignore','ignore','ignore','pipe','pipe']});
   const pipe=connectPipeCdp(browser);
   try{
    const{targetId}=await pipe.command('Target.createTarget',{url:'about:blank'});
    const{sessionId}=await pipe.command('Target.attachToTarget',{targetId,flatten:true});const cdp=sessionClient(pipe,sessionId);
    const errors=[],requests=[];cdp.on('Runtime.exceptionThrown',p=>errors.push(p.exceptionDetails.text+':'+p.exceptionDetails.exception?.description));
    cdp.on('Network.requestWillBeSent',p=>requests.push({url:p.request.url,method:p.request.method}));
    await cdp.command('Runtime.enable');await cdp.command('Network.enable');await cdp.command('Page.enable');
    await cdp.command('Page.addScriptToEvaluateOnNewDocument',{source:"window.__guestStorageCalls=[];for(const method of ['getItem','setItem','removeItem','clear']){const prior=Storage.prototype[method];Storage.prototype[method]=function(...args){window.__guestStorageCalls.push(method);return prior.apply(this,args);};}"});
    await cdp.command('Fetch.enable',{patterns:[{urlPattern:'*'}]});
    cdp.on('Fetch.requestPaused',p=>{void cdp.command(p.request.url.startsWith('http://127.0.0.1:18722/')?'Fetch.continueRequest':'Fetch.failRequest',p.request.url.startsWith('http://127.0.0.1:18722/')?{requestId:p.requestId}:{requestId:p.requestId,errorReason:'BlockedByClient'});});
    await cdp.command('Page.navigate',{url:'http://127.0.0.1:18722/'});
    let page={};const until=Date.now()+6000;
    while(Date.now()<until){const result=await cdp.command('Runtime.evaluate',{expression:`({banner:document.getElementById('guest-read-only-banner')?.textContent,load:document.getElementById('decision-workspace')?.dataset.dashboardLoadState,loginHidden:document.getElementById('login-view')?.classList.contains('hidden'),dashboardHidden:document.getElementById('dashboard-view')?.classList.contains('hidden'),canvases:document.querySelectorAll('#dw-chart-canvas canvas').length})`,returnByValue:true});page=result.result.value||{};if(page.load==='READY')break;await sleep(50);}
    if(page.load!=='READY'){const debug=await cdp.command('Runtime.evaluate',{expression:`fetch('/api/session').then(async r=>({status:r.status,body:await r.text(),marker:document.documentElement.dataset.guestReadOnly}))`,returnByValue:true,awaitPromise:true});page.debug=debug.result.value;}
    assert.equal(page.load,'READY',JSON.stringify({page,errors,requests}));assert.equal(page.loginHidden,true);assert.equal(page.dashboardHidden,false);assert.match(page.banner,/臨時唯讀訪客/);assert.ok(page.canvases>0,JSON.stringify(page));assert.deepEqual(errors,[]);
    const storage=await cdp.command('Runtime.evaluate',{expression:`(() => {document.getElementById('side-nav-toggle')?.click();const select=document.getElementById('market-palette-select');if(select){select.value='green-up';select.dispatchEvent(new Event('change',{bubbles:true}));}return window.__guestStorageCalls;})()`,returnByValue:true});assert.deepEqual(storage.result.value,[],'guest UI preferences must be memory-only');

    const api=requests.filter(p=>new URL(p.url).pathname.startsWith('/api/'));assert.ok(api.some(p=>p.url.endsWith('/api/v1/dashboard')));assert.ok(api.every(p=>p.method==='GET'&&!/ask-gpt|history|backtest|journal|browser-runtime-proof/.test(p.url)),JSON.stringify(api));
   }finally{pipe.close();if(browser.exitCode===null){browser.kill();await new Promise(r=>browser.once('exit',r));}}
  });

  child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));assert.doesNotMatch(out,/GUEST_WRITE_ATTEMPT|GUEST_SECRET_READ|GUEST_EXTERNAL_NETWORK/);
  out='';child=spawn(process.execPath,['--import',probe,'server.mjs'],{cwd:app,env:{...baseEnv,CRU21_GUEST_ENABLED:'1',CRU21_GUEST_EXPIRES_AT:new Date(Date.now()+1500).toISOString()},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
  await new Promise(r=>child.once('exit',r));assert.match(out,/CRU21_GUEST_READ_ONLY/);assert.equal(child.exitCode,0);assert.doesNotMatch(out,/GUEST_WRITE_ATTEMPT|GUEST_SECRET_READ|GUEST_EXTERNAL_NETWORK/);
  await assert.rejects(fetch('http://127.0.0.1:18722/api/session',{headers}),/fetch failed/);

  // A malformed incompatible setting rejects before attempting to open its managed file.
  const incompatible=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...baseEnv,CRU21_GUEST_ENABLED:'1',CRU55_ACCEPTANCE_CONFIG:'0'},stdio:['ignore','pipe','pipe']});let error='';incompatible.stderr.on('data',b=>error+=b);await new Promise(r=>incompatible.once('exit',r));assert.match(error,/GUEST_INCOMPATIBLE_MODE/);assert.doesNotMatch(error,/ENOENT/);
  // Normal mode still reaches the existing protected handlers. Use an isolated non-formal test port.
  out='';child=spawn(process.execPath,['server.mjs'],{cwd:app,env:{...baseEnv,PORT:'18724',CRU21_GUEST_ENABLED:'0',DASHBOARD_PREVIEW_TYPE:'',ASK_GPT_CANDIDATE_READ_ROOT:'',REFRESH_INTERVAL_SECONDS:'0',MOCK_DATA:'1'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
  const normalStart=Date.now();while(!out.includes('18724')&&child.exitCode===null&&Date.now()-normalStart<7000)await sleep(25);
  assert.match(out,/18724/,out);
  assert.equal((await fetch('http://127.0.0.1:18724/api/v1/dashboard')).status,401);
  assert.equal((await fetch('http://127.0.0.1:18724/api/session')).status,200);
  assert.equal((await fetch('http://127.0.0.1:18724/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'wrong-synthetic'})})).status,401);
  const login=await fetch('http://127.0.0.1:18724/api/auth/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password:'Synthetic guest test passphrase'})});assert.equal(login.status,200);
  const normalCookie=login.headers.get('set-cookie').split(';')[0],normalSession=await login.json();assert.ok(normalSession.csrfToken);
  assert.equal((await fetch('http://127.0.0.1:18724/api/session',{headers:{cookie:normalCookie}}).then(r=>r.json())).authenticated,true);
  assert.equal((await fetch('http://127.0.0.1:18724/api/auth/logout',{method:'POST',headers:{cookie:normalCookie}})).status,403);
  assert.equal((await fetch('http://127.0.0.1:18724/api/auth/logout',{method:'POST',headers:{cookie:normalCookie,'x-csrf-token':normalSession.csrfToken}})).status,200);

 }finally{if(child&&child.exitCode===null){child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));}fs.rmSync(temp,{recursive:true,force:true});}
});

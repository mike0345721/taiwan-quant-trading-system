import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn,spawnSync,execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { ownedBrowserWaitState, sanitizedBrowserStderr } from './browser-startup-diagnostics.mjs';
import { approvedGuestPaths,GUEST_BRANCH } from '../src/cru21-guest-guard.mjs';
import { hashPassword } from '../src/security.mjs';
import { createGuestReader } from '../src/cru21-guest-reader.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const hashTree=dir=>{const rows=[];function walk(p){for(const name of fs.readdirSync(p).sort()){const file=path.join(p,name),st=fs.lstatSync(file);if(st.isDirectory())walk(file);else rows.push([path.relative(dir,file),st.size,st.mtimeMs,fs.readFileSync(file).toString('base64')]);}}walk(dir);return rows;};
function connectPipeCdp(child, { signal, diagnostics = true } = {}) {
  const input = child.stdio[3];
  const output = child.stdio[4];
  assert.ok(input && output, 'Chrome DevTools pipe was not created');
  let sequence = 0;
  let buffer = Buffer.alloc(0);
  let closedError = null;
  const pending = new Map();
  const listeners = new Map();
  const listenerKey = (sessionId, method) => `${sessionId || ''}:${method}`;
  // Test-harness diagnostics only: never log command parameters, page data or env.
  const began = performance.now();
  let replies = 0;
  const trace = (stage, method = null) => {
    if (!diagnostics) return;
    process.stderr.write(`GUEST_CDP ${JSON.stringify({
      stage, method, elapsedMs: Math.round(performance.now() - began),
      availableParallelism: os.availableParallelism(), load1m: os.loadavg()[0],
      pending: [...pending.values()].map((p) => ({ method: p.method, ageMs: Math.round(performance.now() - p.sentAt) })),
      replies, exitCode: child.exitCode, signalCode: child.signalCode,
    })}\n`);
  };
  trace('spawned');
  const diagnosticTimer = setInterval(() => trace('waiting'), 1000);
  diagnosticTimer.unref();
  const fail = (error) => {
    if (closedError) return;
    closedError = error;
    trace('closed', error.message);
    clearInterval(diagnosticTimer);
    signal?.removeEventListener('abort', onAbort);
    for (const handler of pending.values()) handler.reject(error);
    pending.clear();
    listeners.clear();
    buffer = Buffer.alloc(0);
  };
  const onAbort = () => fail(new Error('BROWSER_TEST_ABORTED'));
  // A test timeout does not cancel an arbitrary Promise: explicitly release CDP.
  signal?.addEventListener('abort', onAbort, { once: true });
  child.once('error', () => fail(new Error('BROWSER_PROCESS_ERROR')));
  child.once('exit', () => fail(new Error('BROWSER_PIPE_CLOSED')));
  input.on('error', () => fail(new Error('BROWSER_PIPE_WRITE_ERROR')));
  output.on('error', () => fail(new Error('BROWSER_PIPE_READ_ERROR')));
  output.once('end', () => fail(new Error('BROWSER_PIPE_CLOSED')));
  output.once('close', () => fail(new Error('BROWSER_PIPE_CLOSED')));

  output.on('data', (chunk) => {
    if (closedError) return;
    buffer = Buffer.concat([buffer, chunk]);
    let boundary = buffer.indexOf(0);
    while (boundary >= 0 && !closedError) {
      const packet = buffer.subarray(0, boundary).toString('utf8');
      buffer = buffer.subarray(boundary + 1);
      boundary = buffer.indexOf(0);
      if (!packet) continue;
      let message;
      try { message = JSON.parse(packet); }
      catch { fail(new Error('BROWSER_PIPE_INVALID_JSON')); return; }
      if (!message || typeof message !== 'object') {
        fail(new Error('BROWSER_PIPE_INVALID_MESSAGE')); return;
      }
      if (message.id != null) {
        const handler = pending.get(message.id);
        pending.delete(message.id);
        replies += 1;
        if (handler && (handler.method !== 'Runtime.evaluate' || performance.now() - handler.sentAt > 500)) trace('reply', handler.method);
        if (message.error) handler?.reject(new Error(message.error.message));
        else handler?.resolve(message.result);
        continue;
      }
      if (['Fetch.requestPaused', 'Network.requestWillBeSent', 'Network.loadingFailed', 'Page.frameStartedLoading', 'Page.frameNavigated', 'Page.frameStoppedLoading'].includes(message.method)) trace('event', message.method);
      for (const listener of listeners.get(listenerKey(message.sessionId, message.method)) || []) {
        listener(message.params);
      }
    }
  });
  if (signal?.aborted) onAbort();
  else if (child.exitCode != null || child.signalCode != null || input.destroyed || output.destroyed || output.readableEnded) {
    fail(new Error('BROWSER_PIPE_CLOSED'));
  }

  return {
    command(method, params = {}, sessionId = null) {
      if (closedError) return Promise.reject(closedError);
      const id = ++sequence;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject, method, sentAt: performance.now() });
        if (method !== 'Runtime.evaluate') trace('send', method);
        try {
          input.write(`${JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) })}\0`,
            (error) => { if (error) fail(new Error('BROWSER_PIPE_WRITE_ERROR')); });
        } catch { fail(new Error('BROWSER_PIPE_WRITE_ERROR')); }
      });
    },
    on(method, listener, sessionId = null) {
      if (closedError) return;
      const key = listenerKey(sessionId, method);
      const current = listeners.get(key) || [];
      current.push(listener);
      listeners.set(key, current);
    },
    close() {
      fail(new Error('BROWSER_PIPE_CLOSED'));
      if (!input.destroyed && !input.writableEnded) input.end();
    },
  };
}

function stopOwnedBrowser(child, { graceMs = 1000, killWaitMs = 1000 } = {}) {
  // Inspect both terminal fields; signal exits leave exitCode null.
  if (child.exitCode != null || child.signalCode != null || !child.pid) return Promise.resolve();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(forceTimer);
      clearTimeout(deadlineTimer);
      child.removeListener('exit', onExit);
      child.removeListener('error', onError);
      if (error) reject(error); else resolve();
    };
    const onExit = () => finish();
    const onError = () => finish(new Error('BROWSER_CLEANUP_FAILED'));
    const forceTimer = setTimeout(() => {
      if (child.exitCode == null && child.signalCode == null) {
        try { child.kill('SIGKILL'); } catch { onError(); }
      }
    }, graceMs);
    const deadlineTimer = setTimeout(() => finish(new Error('BROWSER_CLEANUP_TIMEOUT')), graceMs + killWaitMs);
    // Register before kill, otherwise an already-observed exit can be missed.
    child.once('exit', onExit);
    child.once('error', onError);
    try { child.kill('SIGTERM'); } catch { onError(); }
  });
}

function sessionClient(pipe, sessionId) {
  return {
    command(method, params = {}) { return pipe.command(method, params, sessionId); },
    on(method, listener) { pipe.on(method, listener, sessionId); },
  };
}


async function enableGuestInterception(cdp, errors) {
  // Register first: a pipe read may contain both the enable reply and a pause.
  // Await continuations run later; enabling before listening can lose that pause.
  cdp.on('Fetch.requestPaused', (event) => {
    const allowed = typeof event.request?.url === 'string'
      && event.request.url.startsWith('http://127.0.0.1:18722/');
    void cdp.command(allowed ? 'Fetch.continueRequest' : 'Fetch.failRequest', allowed
      ? { requestId: event.requestId }
      : { requestId: event.requestId, errorReason: 'BlockedByClient' })
      .catch((error) => errors.push('CDP_REQUEST_FAILED:' + error.message));
  });
  await cdp.command('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
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
  fs.mkdirSync(path.join(app,'data'));
  const projection=path.join(source,'runtime','cru34-live');fs.rmdirSync(projection);fs.symlinkSync(path.join(app,'data'),projection,'junction');
  assert.throws(()=>approvedGuestPaths(env,app),/OVERLAP/);fs.unlinkSync(projection);fs.mkdirSync(projection);
  fs.rmdirSync(path.join(app,'data'));fs.symlinkSync(source,path.join(app,'data'),'junction');assert.throws(()=>approvedGuestPaths(env,app),/OVERLAP/);
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
  const self=spawn(process.execPath,['--import',pathToFileURL(probe).href,'-e',"import('node:fs').then(({default:fs})=>{try{fs.openSync('/must-never-create','w')}catch{};try{fs.readFileSync('/sessions.json')}catch{};return fetch('https://must-never-connect.invalid').catch(()=>{})})"],{cwd:app,env:{PATH:process.env.PATH},stdio:['ignore','pipe','pipe']});let selfLog='';self.stderr.on('data',b=>selfLog+=b);await new Promise(r=>self.once('exit',r));assert.match(selfLog,/GUEST_WRITE_ATTEMPT/);assert.match(selfLog,/GUEST_SECRET_READ/);assert.match(selfLog,/GUEST_EXTERNAL_NETWORK/);
  const baseEnv={PATH:process.env.PATH,NODE_NO_WARNINGS:'1',HOME:temp,TMPDIR:temp,NODE_ENV:'production',DASHBOARD_PASSWORD_HASH:hashPassword('Synthetic guest test passphrase'),HOST:'127.0.0.1',PORT:'18722',MOCK_DATA:'0',ASK_GPT_INLINE_ENABLED:'0',DASHBOARD_PREVIEW_TYPE:'CRU21_OWNER_PREVIEW',DASHBOARD_PREVIEW_DATA_MODE:'LIVE',DASHBOARD_PREVIEW_BRANCH:GUEST_BRANCH,DASHBOARD_PREVIEW_EXPECTED_HEAD:head,DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN:base,...bindings};
  let out='';child=spawn(process.execPath,['--import',pathToFileURL(probe).href,'server.mjs'],{cwd:app,env:{...baseEnv,CRU21_GUEST_ENABLED:'1',CRU21_GUEST_EXPIRES_AT:new Date(Date.now()+20000).toISOString()},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
  const start=Date.now();while(!out.includes('CRU21_GUEST_READ_ONLY')&&child.exitCode===null&&Date.now()-start<7000)await sleep(25);
  assert.match(out,/CRU21_GUEST_READ_ONLY/,out);
  const headers={'Sec-Fetch-Site':'same-origin','Sec-Fetch-Mode':'cors','Sec-Fetch-Dest':'empty'};
  const session=await fetch('http://127.0.0.1:18722/api/session',{headers});assert.equal((await session.json()).authenticated,false);
  const response=await fetch('http://127.0.0.1:18722/api/v1/dashboard',{headers});assert.equal(response.status,200,await response.clone().text());
  assert.deepEqual(hashTree(source),before);assert.equal(fs.existsSync(path.join(app,'data')),false);
  await t.test('real Chromium loads actual production workspace through guest HTTP without login or write/AI calls',{skip:!fs.existsSync('/usr/bin/chromium'),timeout:12000},async(browserTest)=>{
   const browser=spawn('/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-extensions','--disable-background-networking','--no-first-run','--no-default-browser-check','--remote-debugging-pipe','--user-data-dir='+path.join(temp,'browser-profile'),'about:blank'],{stdio:['ignore','ignore','pipe','pipe','pipe']});
   // Only classify stderr; never print browser output, URLs, profiles or environment.
   const stderrClasses=new Set();let stderrBytes=0,stderrTail='';
   browser.stderr.on('data',chunk=>{stderrBytes+=chunk.length;const text=chunk.toString('utf8');stderrTail=(stderrTail+text).slice(-8000);for(const category of ['dbus','gpu','network','sandbox','zygote','crash','error'])if(text.toLowerCase().includes(category))stderrClasses.add(category);});
   const pipe=connectPipeCdp(browser,{signal:browserTest.signal});
   let cleanup,diagnosticTimer;
   const startupProbe=setTimeout(()=>process.stderr.write('GUEST_OWNED_WAIT '+JSON.stringify(ownedBrowserWaitState(browser))+'\n'),2000);startupProbe.unref();
   const report=(stage,fields)=>process.stderr.write('GUEST_BROWSER '+JSON.stringify({stage,...fields})+'\n');
   const close=()=>cleanup||=(async()=>{clearTimeout(diagnosticTimer);clearTimeout(startupProbe);report('pre-close-owned',ownedBrowserWaitState(browser));pipe.close();await stopOwnedBrowser(browser);report('stderr-summary',{bytes:stderrBytes,categories:[...stderrClasses].sort(),sanitizedTail:sanitizedBrowserStderr(stderrTail,temp)});})();
   browserTest.after(close);
   try{
    const version=await pipe.command('Browser.getVersion');report('version',{product:version.product,protocolVersion:version.protocolVersion});
    const{targetId}=await pipe.command('Target.createTarget',{url:'about:blank'});
    const{sessionId}=await pipe.command('Target.attachToTarget',{targetId,flatten:true});const cdp=sessionClient(pipe,sessionId);
    const errors=[],requests=[];cdp.on('Runtime.exceptionThrown',p=>errors.push(p.exceptionDetails.text+':'+p.exceptionDetails.exception?.description));
    cdp.on('Network.requestWillBeSent',p=>requests.push({url:p.request.url,method:p.request.method}));
    await cdp.command('Runtime.enable');await cdp.command('Network.enable');await cdp.command('Page.enable');
    await cdp.command('Page.addScriptToEvaluateOnNewDocument',{source:"window.__guestStorageCalls=[];for(const method of ['getItem','setItem','removeItem','clear']){const prior=Storage.prototype[method];Storage.prototype[method]=function(...args){window.__guestStorageCalls.push(method);return prior.apply(this,args);};}"});
    await enableGuestInterception(cdp,errors);
    // One bounded observation while navigation is pending; no retries or prewarming.
    diagnosticTimer=setTimeout(()=>{
     void pipe.command('SystemInfo.getProcessInfo').then(r=>report('processes',{types:(r.processInfo||[]).map(p=>p.type)}),()=>report('processes-unavailable',{}));
     void cdp.command('Page.getFrameTree').then(r=>report('frame',{hasFrame:!!r.frameTree?.frame,isBlank:r.frameTree?.frame?.url==='about:blank',isLoopback:!!r.frameTree?.frame?.url?.startsWith('http://127.0.0.1:18722/')}),()=>report('frame-unavailable',{}));
    },2000);diagnosticTimer.unref();
    const navigation=await cdp.command('Page.navigate',{url:'http://127.0.0.1:18722/'});
    clearTimeout(diagnosticTimer);
    assert.equal(navigation.errorText,undefined,'BROWSER_NAVIGATION_FAILED:'+navigation.errorText);
    let page={};const until=Date.now()+6000;
    while(Date.now()<until){const result=await cdp.command('Runtime.evaluate',{expression:`({banner:document.getElementById('guest-read-only-banner')?.textContent,load:document.getElementById('decision-workspace')?.dataset.dashboardLoadState,loginHidden:document.getElementById('login-view')?.classList.contains('hidden'),dashboardHidden:document.getElementById('dashboard-view')?.classList.contains('hidden'),canvases:document.querySelectorAll('#dw-chart-canvas canvas').length})`,returnByValue:true});page=result.result.value||{};if(page.load==='READY')break;await sleep(50);}
    if(page.load!=='READY'){const debug=await cdp.command('Runtime.evaluate',{expression:`fetch('/api/session').then(async r=>({status:r.status,body:await r.text(),marker:document.documentElement.dataset.guestReadOnly}))`,returnByValue:true,awaitPromise:true});page.debug=debug.result.value;}
    assert.equal(page.load,'READY',JSON.stringify({page,errors,requests}));assert.equal(page.loginHidden,true);assert.equal(page.dashboardHidden,false);assert.match(page.banner,/臨時唯讀訪客/);assert.ok(page.canvases>0,JSON.stringify(page));assert.deepEqual(errors,[]);
    const storage=await cdp.command('Runtime.evaluate',{expression:`(() => {document.getElementById('side-nav-toggle')?.click();const select=document.getElementById('market-palette-select');if(select){select.value='green-up';select.dispatchEvent(new Event('change',{bubbles:true}));}return window.__guestStorageCalls;})()`,returnByValue:true});assert.deepEqual(storage.result.value,[],'guest UI preferences must be memory-only');

    const api=requests.filter(p=>new URL(p.url).pathname.startsWith('/api/'));assert.ok(api.some(p=>p.url.endsWith('/api/v1/dashboard')));assert.ok(api.every(p=>p.method==='GET'&&!/ask-gpt|history|backtest|journal|browser-runtime-proof/.test(p.url)),JSON.stringify(api));
   }finally{await close();}
  });

  child.kill('SIGTERM');await new Promise(r=>child.once('exit',r));assert.doesNotMatch(out,/GUEST_WRITE_ATTEMPT|GUEST_SECRET_READ|GUEST_EXTERNAL_NETWORK/);
  out='';child=spawn(process.execPath,['--import',pathToFileURL(probe).href,'server.mjs'],{cwd:app,env:{...baseEnv,CRU21_GUEST_ENABLED:'1',CRU21_GUEST_EXPIRES_AT:new Date(Date.now()+1500).toISOString()},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>out+=b);child.stderr.on('data',b=>out+=b);
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

function syntheticPipeChild() {
  const child = new EventEmitter();
  child.exitCode = null;
  child.signalCode = null;
  child.stdio = [null, null, null, new PassThrough(), new PassThrough()];
  return child;
}

test('CDP pipe preserves fragmented replies, session events and protocol failures', async () => {
  const child = syntheticPipeChild();
  const pipe = connectPipeCdp(child, { diagnostics: false });
  try {
    const seen = [];
    pipe.on('Runtime.fixture', (value) => seen.push(value), 'synthetic-session');
    const result = pipe.command('Runtime.evaluate', {}, 'synthetic-session');
    const packet = Buffer.from(JSON.stringify({ id: 1, result: { text: '中文' } }) + '\0');
    const split = packet.indexOf(Buffer.from('中')) + 1;
    child.stdio[4].write(packet.subarray(0, split));
    child.stdio[4].write(packet.subarray(split));
    assert.deepEqual(await result, { text: '中文' });
    child.stdio[4].write(JSON.stringify({ method: 'Runtime.fixture', sessionId: 'synthetic-session', params: { ok: true } }) + '\0');
    assert.deepEqual(seen, [{ ok: true }]);
    const failure = assert.rejects(pipe.command('Synthetic.invalid'), /synthetic rejection/);
    child.stdio[4].write(JSON.stringify({ id: 2, error: { message: 'synthetic rejection' } }) + '\0');
    await failure;
  } finally { pipe.close(); }
});

test('CDP abort rejects every pending command and forbids subsequent writes', async () => {
  const child = syntheticPipeChild(), controller = new AbortController();
  const pipe = connectPipeCdp(child, { signal: controller.signal, diagnostics: false });
  let writes = 0;
  child.stdio[3].on('data', () => writes++);
  const a = assert.rejects(pipe.command('Target.createTarget'), /BROWSER_TEST_ABORTED/);
  const b = assert.rejects(pipe.command('Runtime.enable'), /BROWSER_TEST_ABORTED/);
  controller.abort();
  await Promise.all([a, b]);
  await assert.rejects(pipe.command('Page.navigate'), /BROWSER_TEST_ABORTED/);
  assert.equal(writes, 2);
  pipe.close(); pipe.close();
  const next = syntheticPipeChild();
  const alreadyAborted = connectPipeCdp(next, { signal: controller.signal, diagnostics: false });
  await assert.rejects(alreadyAborted.command('Target.createTarget'), /BROWSER_TEST_ABORTED/);
  assert.equal(next.stdio[3].readableLength, 0);
  alreadyAborted.close();
});

test('CDP process and pipe termination reject pending and future commands without hanging', async () => {
  for (const [target, event, reason] of [
    ['child', 'exit', 'BROWSER_PIPE_CLOSED'], ['child', 'error', 'BROWSER_PROCESS_ERROR'],
    ['input', 'error', 'BROWSER_PIPE_WRITE_ERROR'], ['output', 'error', 'BROWSER_PIPE_READ_ERROR'],
    ['output', 'end', 'BROWSER_PIPE_CLOSED'], ['output', 'close', 'BROWSER_PIPE_CLOSED'],
  ]) {
    const child = syntheticPipeChild(), pipe = connectPipeCdp(child, { diagnostics: false });
    const check = assert.rejects(pipe.command('Target.createTarget'), new RegExp(reason));
    const emitter = target === 'child' ? child : child.stdio[target === 'input' ? 3 : 4];
    emitter.emit(event, event === 'error' ? new Error('synthetic') : 0);
    await check;
    await assert.rejects(pipe.command('Page.navigate'), new RegExp(reason));
    pipe.close();
  }
});

test('CDP rejects an already exited browser and malformed messages instead of waiting forever', async () => {
  for (const field of ['exitCode', 'signalCode']) {
    const child = syntheticPipeChild(); child[field] = field === 'exitCode' ? 0 : 'SIGTERM';
    const pipe = connectPipeCdp(child, { diagnostics: false });
    await assert.rejects(pipe.command('Target.createTarget'), /BROWSER_PIPE_CLOSED/);
    assert.equal(child.stdio[3].readableLength, 0); pipe.close();
  }
  for (const packet of ['{\0', 'null\0']) {
    const child = syntheticPipeChild(), pipe = connectPipeCdp(child, { diagnostics: false });
    const check = assert.rejects(pipe.command('Target.createTarget'), /BROWSER_PIPE_INVALID_/);
    child.stdio[4].write(packet); await check; pipe.close();
  }
});

test('browser cleanup handles signal exits, escalation and bounded failure for only its own child', async () => {
  const exited = syntheticPipeChild(); exited.pid = 1; exited.signalCode = 'SIGTERM';
  exited.kill = () => assert.fail('must not signal an already reaped process');
  await stopOwnedBrowser(exited);
  const child = syntheticPipeChild(); child.pid = 1;
  const signals = [];
  child.kill = (signal) => { signals.push(signal); if (signal === 'SIGKILL') { child.signalCode = signal; child.emit('exit', null, signal); } return true; };
  await stopOwnedBrowser(child, { graceMs: 5, killWaitMs: 50 });
  assert.deepEqual(signals, ['SIGTERM', 'SIGKILL']);
  assert.equal(child.listenerCount('exit'), 0);
  const stuck = syntheticPipeChild(); stuck.pid = 1; stuck.kill = () => false;
  await assert.rejects(stopOwnedBrowser(stuck, { graceMs: 5, killWaitMs: 10 }), /BROWSER_CLEANUP_TIMEOUT/);
  assert.equal(stuck.listenerCount('exit'), 0);
});

test('a real test deadline reaps an unresponsive synthetic browser and remains a failed test', { timeout: 7000 }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'guest-cdp-deadline-'));
  try {
    const probe = path.join(temp, 'deadline.test.mjs');
    fs.writeFileSync(probe, `import test from 'node:test';\nimport assert from 'node:assert/strict';\nimport os from 'node:os';\nimport {spawn} from 'node:child_process';\n${connectPipeCdp.toString()}\n${stopOwnedBrowser.toString()}\n
      test('intentional synthetic CDP timeout', {timeout:100}, async (t) => {
        const child = spawn(process.execPath, ['-e', 'setTimeout(()=>process.exit(23),1800)'], {stdio:['ignore','ignore','ignore','pipe','pipe']});
        const pipe = connectPipeCdp(child, {signal:t.signal, diagnostics:false});
        let cleanup;
        const close = () => cleanup ||= (async () => {
          pipe.close(); await stopOwnedBrowser(child);
          assert.notEqual(child.exitCode,23,'must reap on timeout, not wait for synthetic self-expiry');
          console.log('SYNTHETIC_CHILD_REAPED');
        })();
        t.after(close);
        try { await pipe.command('Target.createTarget'); } finally { await close(); }
      });\n`);
    // This is an independent runner, not a recursively inherited node:test worker.
    const env = { ...process.env }; delete env.NODE_TEST_CONTEXT;
    const result = spawnSync(process.execPath, ['--test', probe], { encoding: 'utf8', timeout: 5000, env });
    assert.equal(result.error, undefined, 'deadline must not leave the runner stuck');
    assert.equal(result.status, 1, 'an actual test timeout must remain a failure');
    assert.equal(result.signal, null);
    assert.match(result.stdout, /test timed out after 100ms/);
    assert.match(result.stdout, /SYNTHETIC_CHILD_REAPED/);
    assert.equal((result.stdout.match(/SYNTHETIC_CHILD_REAPED/g) || []).length, 1);
  } finally { fs.rmSync(temp, { recursive: true, force: true }); }
});

test('Fetch interception handles a pause coalesced with its enable reply before await resumes', async () => {
  const child = syntheticPipeChild();
  const pipe = connectPipeCdp(child, { diagnostics: false });
  const cdp = sessionClient(pipe, 'synthetic-session');
  const sent = [], errors = [];
  child.stdio[3].on('data', (packet) => sent.push(JSON.parse(packet.toString().replace(/\0$/, ''))));
  try {
    const enabled = enableGuestInterception(cdp, errors);
    assert.equal(sent[0].method, 'Fetch.enable');
    assert.deepEqual(sent[0].params, { patterns: [{ urlPattern: '*' }] });
    const pause = (requestId, url) => ({ method: 'Fetch.requestPaused', sessionId: 'synthetic-session', params: { requestId, request: { url } } });
    // Same physical read; registering a listener after await loses every event.
    child.stdio[4].write([
      { id: sent[0].id, result: {} },
      pause('local', 'http://127.0.0.1:18722/'),
      pause('external', 'https://synthetic.invalid/'),
      pause('other-port', 'http://127.0.0.1:18723/'),
      pause('lookalike', 'http://127.0.0.1:18722.evil.invalid/'),
      pause('redirect', 'https://redirect.synthetic.invalid/'),
    ].map(packet => JSON.stringify(packet) + '\0').join(''));
    await enabled;
    assert.deepEqual(sent.slice(1).map(({ method, params, sessionId }) => ({ method, params, sessionId })), [
      { method: 'Fetch.continueRequest', params: { requestId: 'local' }, sessionId: 'synthetic-session' },
      ...['external', 'other-port', 'lookalike', 'redirect'].map(requestId => ({ method: 'Fetch.failRequest', params: { requestId, errorReason: 'BlockedByClient' }, sessionId: 'synthetic-session' })),
    ]);
    for (const command of sent.slice(1)) child.stdio[4].write(JSON.stringify({ id: command.id, result: {} }) + '\0');
    await Promise.resolve();
    assert.deepEqual(errors, []);
  } finally { pipe.close(); }
});

test('Fetch interception receives pauses before enable acknowledgement and records command rejection', async () => {
  const child = syntheticPipeChild();
  const pipe = connectPipeCdp(child, { diagnostics: false });
  const cdp = sessionClient(pipe, 'synthetic-session');
  const sent = [], errors = [];
  child.stdio[3].on('data', (packet) => sent.push(JSON.parse(packet.toString().replace(/\0$/, ''))));
  try {
    const enabled = enableGuestInterception(cdp, errors);
    child.stdio[4].write(JSON.stringify({ method: 'Fetch.requestPaused', sessionId: 'synthetic-session', params: { requestId: 'early', request: { url: 'http://127.0.0.1:18722/api/session' } } }) + '\0');
    assert.equal(sent[1].method, 'Fetch.continueRequest');
    child.stdio[4].write(JSON.stringify({ id: sent[1].id, error: { message: 'synthetic protocol rejection' } }) + '\0');
    child.stdio[4].write(JSON.stringify({ id: sent[0].id, result: {} }) + '\0');
    await enabled;
    assert.deepEqual(errors, ['CDP_REQUEST_FAILED:synthetic protocol rejection']);
    child.stdio[4].write(JSON.stringify({ method: 'Fetch.requestPaused', sessionId: 'other-session', params: { requestId: 'foreign', request: { url: 'http://127.0.0.1:18722/' } } }) + '\0');
    assert.equal(sent.length, 2, 'must not act on another target session');
  } finally { pipe.close(); }
});

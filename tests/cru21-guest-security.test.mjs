import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { guestRequested,guestDeadline,validateGuestIdentity,authorizeGuest,approvedGuestPaths,GUEST_BRANCH } from '../src/cru21-guest-guard.mjs';
import { guestBridgeGet,guardGuestReadTree } from '../src/cru21-guest-reader.mjs';
import { createGuestServer } from '../src/cru21-guest-server.mjs';
import {projectGuest,watchSchema,chartSchema,flowSchema} from '../src/cru21-guest-projection.mjs';
const head='a'.repeat(40),base='b'.repeat(40);
const env={CRU21_GUEST_ENABLED:'1',HOST:'127.0.0.1',PORT:'18722',MOCK_DATA:'0',DASHBOARD_PREVIEW_TYPE:'CRU21_OWNER_PREVIEW',DASHBOARD_PREVIEW_DATA_MODE:'LIVE',ASK_GPT_INLINE_ENABLED:'0',DASHBOARD_PREVIEW_BRANCH:GUEST_BRANCH,DASHBOARD_PREVIEW_EXPECTED_HEAD:head,DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN:base};
const input={env,head,base,branch:GUEST_BRANCH,clean:true};
const req={method:'GET',socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:18722','sec-fetch-site':'same-origin','sec-fetch-mode':'cors','sec-fetch-dest':'empty'}};
const deadline={expiresAt:'2099-01-01T00:00:00.000Z',remaining:()=>10000};
test('guest is default-off, exact candidate only, unchanged formal and inline modes cannot activate it',()=>{
 assert.equal(guestRequested({}),false);assert.equal(guestRequested({CRU21_GUEST_ENABLED:'0'}),false);
 assert.throws(()=>guestRequested({CRU21_GUEST_ENABLED:'true'}));
 assert.doesNotThrow(()=>validateGuestIdentity(input));
 for(const change of [{clean:false},{head:base},{base:head},{branch:'main'},{branch:GUEST_BRANCH+'-other'}])assert.throws(()=>validateGuestIdentity({...input,...change}));
 for(const change of [{HOST:'0.0.0.0'},{PORT:'8787'},{PORT:'18723'},{MOCK_DATA:'1'},{ASK_GPT_INLINE_ENABLED:'1'},
 {DASHBOARD_PREVIEW_TYPE:''},{DASHBOARD_PREVIEW_EXPECTED_HEAD:''},{DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN:head},
 {CRU55_ACCEPTANCE_CONFIG:'/must-not-read'},{DASHBOARD_FORMAL_READ_ROOT:'/must-not-read'},{CRU55_RUNTIME_BINDING:'/must-not-read'},{FORWARD_SHADOW_RUNTIME_ROOT:'/must-not-read'}])assert.throws(()=>validateGuestIdentity({...input,env:{...env,...change}}));
});
test('fixed expiry is <=15min, never sliding and cannot survive clock rollback',()=>{
 let wall=Date.parse('2026-10-17T05:00:00Z'),mono=100;
 const d=guestDeadline('2026-10-17T05:15:00Z',{now:()=>wall,mono:()=>mono});
 assert.equal(d.remaining(),900000);mono+=500;assert.equal(d.remaining(),899500);
 wall-=60000;mono+=900000;assert.equal(d.remaining(),0);
 for(const value of [null,'','tomorrow','2026-10-17T06:00:00Z','2026-10-17T05:00:00Z'])assert.throws(()=>guestDeadline(value,{now:()=>Date.parse('2026-10-17T05:00:00Z')}));
});
test('peer/host/origin/fetch/proxy/method and exact path/query allowlist fail closed; cookies grant nothing',()=>{
 const url=p=>new URL(p,'http://127.0.0.1:18722');
 assert.equal(authorizeGuest(req,url('/api/session'),deadline),null);
 for(const headers of [{host:'localhost:18722'},{host:'127.0.0.1:8787'},{origin:'null'},{origin:'https://evil.invalid'},
 {'sec-fetch-site':'cross-site'},{'sec-fetch-site':'same-site'},{'sec-fetch-site':'none'},{'sec-fetch-mode':'no-cors'},{'sec-fetch-dest':'image'},{'sec-fetch-site':undefined},{forwarded:''},{'x-forwarded-for':'127.0.0.1'},{'x-forwarded-port':'18722'},{authorization:'Bearer anything'}])assert.ok(authorizeGuest({...req,headers:{...req.headers,...headers}},url('/api/session'),deadline));
 assert.ok(authorizeGuest({...req,socket:{remoteAddress:'::ffff:127.0.0.1'}},url('/api/session'),deadline));
 for(const method of ['POST','PUT','PATCH','DELETE','OPTIONS','CONNECT'])assert.ok(authorizeGuest({...req,method},url('/api/v1/dashboard'),deadline));
 for(const route of ['/api/auth/login','/api/v1/ask-gpt/status','/api/v1/ask-gpt/requests/x','/api/v1/ask-gpt-context','/api/v1/decision-journal','/api/v1/data-operations','/api/v1/history','/api/v2/research','/.env','/api/v1/security-status','/api/v1/dashboard?x=1','/api/v1/tx-chart?mode=REPLAY','/api/v1/tx-chart?asOf=x','/api/v1/tx-chart?timeframe=5m&timeframe=1m']) {
  assert.ok(authorizeGuest({...req,headers:{...req.headers,cookie:'twchip_session=old-owner'}},url(route),deadline),route);
 }
 assert.equal(authorizeGuest(req,url('/api/v1/tx-chart?timeframe=5m&mode=LIVE'),deadline),null);
 assert.equal(authorizeGuest(req,url('/api/v1/dashboard'),{remaining:()=>0}),'GUEST_EXPIRED');
});
test('nested typed projections exclude private fields and free text; missing numerical gaps stay null',()=>{
 const canary='CANARY_PRIVATE_credential/path';
 const v={state:'READY',currentPrice:100,why:canary,token:canary,levels:[{id:'VWAP',price:100,label:canary,credential:canary}],scenarioWatch:{long:{rr:{state:'AVAILABLE',ratio:2,applicability:{state:'NEAR_REFERENCE_UNCONFIRMED',currentPrice:100,confirmationReferencePrice:98,gapFromConfirmationPoints:null,token:canary}}}}};
 const p=projectGuest(v,watchSchema);assert.doesNotMatch(JSON.stringify(p),/CANARY_PRIVATE/);assert.equal(p.scenarioWatch.long.rr.applicability.gapFromConfirmationPoints,null);
 for(const value of [undefined,null,'0',false,NaN,Infinity])assert.equal(projectGuest({lastPrice:value},chartSchema).lastPrice,null);
 const flow=projectGuest({delivery:{workerInstanceId:canary,runtimeCommit:head},lineage:{sourceLedgerIdentity:canary},operational:{vault:canary}},flowSchema);
 assert.doesNotMatch(JSON.stringify(flow),/CANARY_PRIVATE/);assert.equal(flow.delivery.runtimeCommit,head);
});
test('fixed bridge GET has no credentials/redirects/arbitrary routes and enforces byte/expiry limits',async()=>{
 let calls=0;const fetchImpl=async(url,opt)=>{calls++;assert.equal(url,'http://127.0.0.1:8790/health');assert.equal(opt.redirect,'error');assert.equal(opt.credentials,'omit');assert.deepEqual(opt.headers,{accept:'application/json'});return new Response('{"ok":true}');};
 assert.deepEqual(await guestBridgeGet('/health',{remaining:()=>1000,fetchImpl}),{ok:true});assert.equal(calls,1);
 await assert.rejects(guestBridgeGet('http://evil.invalid',{remaining:()=>1000,fetchImpl}));
 await assert.rejects(guestBridgeGet('/health',{remaining:()=>1000,fetchImpl:async()=>new Response('x'.repeat(524289))}),/OVERSIZE/);
 await assert.rejects(guestBridgeGet('/health',{remaining:()=>0,fetchImpl}));
});
test('file scans reject links/oversize inputs instead of writing or following them',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-read-'));try{
  fs.writeFileSync(path.join(root,'a.json'),'{}');guardGuestReadTree(root,['a.json']);
  // Windows junctions exercise reparse-point rejection without Developer Mode.
  if(process.platform !== 'win32'){
    fs.symlinkSync(path.join(root,'a.json'),path.join(root,'link.json'));assert.throws(()=>guardGuestReadTree(root,['link.json']),/REDIRECTION/);
  }
  fs.mkdirSync(path.join(root,'dir'));fs.symlinkSync(path.join(root,'dir'),path.join(root,'alias'),'junction');assert.throws(()=>guardGuestReadTree(root,['alias/missing.json']),/REDIRECTION/);
  fs.linkSync(path.join(root,'a.json'),path.join(root,'hard.json'));assert.throws(()=>guardGuestReadTree(root,['hard.json']),/REDIRECTION/);
 }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('actual HTTP dispatcher cannot fall through to auth/AI/writes even with owner cookie; expiry checked after read',async()=>{
 let remaining=10000,calls=0;
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-http-'));fs.writeFileSync(path.join(root,'index.html'),'<html><body>real asset</body></html>');
 const d={expiresAt:deadline.expiresAt,remaining:()=>remaining};
 const server=createGuestServer({deadline:d,publicDir:root,vendorPath:'/not-used',head,read:async()=>{calls++;if(calls===2)remaining=0;return {ok:true,data:{value:12}};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const port=server.address().port;
 const get=(pathname,extra={})=>new Promise((resolve,reject)=>{const request=http.request({host:'127.0.0.1',port,path:pathname,method:extra.method||'GET',headers:{host:'127.0.0.1:18722','sec-fetch-site':'same-origin','sec-fetch-mode':'cors','sec-fetch-dest':'empty',cookie:'twchip_session=owner',...extra.headers}},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,body}));});request.on('error',reject);request.end();});
 try{
  const session=await get('/api/session');assert.equal(JSON.parse(session.body).authenticated,false);assert.equal(session.headers['set-cookie'],undefined);
  for(const route of ['/api/auth/login','/api/v1/ask-gpt/status','/.env','/api/v2/daily-update'])assert.equal((await get(route)).status,403);
  assert.equal((await get('/api/v1/dashboard',{method:'POST'})).status,403);assert.equal(calls,0);
  assert.equal((await get('/api/v1/dashboard')).status,200);
  assert.equal((await get('/api/v1/decision-level-watch')).status,410);
  assert.equal((await get('/',{headers:{'sec-fetch-site':'none','sec-fetch-mode':'navigate','sec-fetch-dest':'document'}})).status,410);
 }finally{await new Promise(r=>server.close(r));server.closeAllConnections();fs.rmSync(root,{recursive:true,force:true});}
});

test('source identity change during awaited real request rejects success without returning its data',async()=>{
 let valid=true;const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-race-'));
 const server=createGuestServer({deadline,publicDir:root,vendorPath:'/unused',head,verifyIdentity:()=>valid,read:async()=>{valid=false;return {ok:true,data:'MUST_NOT_RETURN'};}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{
  const result=await new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:'/api/v1/dashboard',headers:req.headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject);});
  assert.equal(result.status,503);assert.doesNotMatch(result.body,/MUST_NOT_RETURN/);assert.match(result.body,/GUEST_IDENTITY_CHANGED/);
 }finally{await new Promise(r=>server.close(r));server.closeAllConnections();fs.rmSync(root,{recursive:true,force:true});}
});

test('expiry and identity are checked after body serialization before any successful headers',async()=>{
 let remaining=10000,valid=true,calls=0;const root=fs.mkdtempSync(path.join(os.tmpdir(),'guest-encode-'));
 const server=createGuestServer({deadline:{...deadline,remaining:()=>remaining},publicDir:root,vendorPath:'/unused',head,verifyIdentity:()=>valid,read:async()=>({toJSON(){if(++calls===1)remaining=0;else valid=false;return {data:'MUST_NOT_SEND_ENCODED_DATA'};}})});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const get=()=>new Promise((resolve,reject)=>{http.get({host:'127.0.0.1',port:server.address().port,path:'/api/v1/dashboard',headers:req.headers},res=>{let body='';res.on('data',b=>body+=b);res.on('end',()=>resolve({status:res.statusCode,body}));}).on('error',reject);});
 try{const expired=await get();assert.equal(expired.status,410);assert.doesNotMatch(expired.body,/MUST_NOT_SEND/);remaining=10000;
  const changed=await get();assert.equal(changed.status,503);assert.doesNotMatch(changed.body,/MUST_NOT_SEND/);
 }finally{await new Promise(r=>server.close(r));server.closeAllConnections();fs.rmSync(root,{recursive:true,force:true});}
});

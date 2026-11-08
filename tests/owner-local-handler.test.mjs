// Actual product request handler, auth, HTTP serialization, static serving and Journal.
// Synthetic filesystem only; captured responses, no listener/Chrome/market source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import * as security from '../src/security.mjs';
import * as httpUtils from '../src/http-utils.mjs';
import * as journal from '../src/decision-journal.mjs';
import { createDecisionSnapshot } from '../src/dashboard-decision-workspace.mjs';
import { OWNER_COOKIE, OWNER_NOTICE, ownerRequestAllowed } from '../src/owner-local-acceptance.mjs';
import { assertMarketCandidateFilesystemRoots, marketCandidateRouteAllowed, marketCandidateQueryAllowed } from '../src/cru21-market-candidate.mjs';

const fixturePassword = 'Fixture-Only-Password-2026';
const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
function fixture(t) {
  const base=path.resolve('data');fs.mkdirSync(base,{recursive:true});
  const home=fs.mkdtempSync(path.join(base,'owner-http-fixture-'));
  t.after(()=>{assert.ok(home.startsWith(base+path.sep));fs.rmSync(home,{recursive:true,force:true});});
  const roots={sourceRoot:path.join(home,'runtime'),readDataRoot:path.join(home,'read'),producerDataRoot:path.join(home,'producer')};
  roots.privateDataRoot=path.join(roots.sourceRoot,'data/owner-local-acceptance/synthetic');
  roots.chartCacheRoot=path.join(roots.privateDataRoot,'dashboard-chart-cache');
  for(const dir of [...Object.values(roots),path.join(roots.privateDataRoot,'decision-workspace')]) fs.mkdirSync(dir,{recursive:true});
  const marker=path.join(roots.readDataRoot,'do-not-write.txt');fs.writeFileSync(marker,'SYNTHETIC READ-ONLY INPUT');
  const sessionPath=path.join(roots.privateDataRoot,'sessions.json');
  const decisionJournalPath=path.join(roots.privateDataRoot,'decision-workspace/journal.ndjson');
  const decisionOutcomesPath=path.join(roots.privateDataRoot,'decision-workspace/journal-outcomes.ndjson');
  const context={...security,...httpUtils,...journal,OWNER_COOKIE,OWNER_NOTICE,ownerRequestAllowed,
    assertMarketCandidateFilesystemRoots,marketCandidateRouteAllowed,marketCandidateQueryAllowed,
    marketCandidateStartup:{roots},ownerLocal:true,marketCandidate:true,cru55:null,formalEntry:null,
    sessions:new security.SessionStore(60000,{filePath:sessionPath}),loginLimiter:new security.LoginRateLimiter(),
    config:{passwordHash:security.hashPassword(fixturePassword),nodeEnv:'production',cookieSecure:true,trustProxy:false,
      sessionTtlMs:60000,rememberedSessionTtlMs:60000,publicDir:path.resolve('public')},
    decisionJournalPath,decisionOutcomesPath,inlineHandler:async()=>false,
    crypto,URL,console,setTimeout:fn=>{queueMicrotask(fn);return {unref(){}};}};
  const auth=source.slice(source.indexOf('function getSession(req)'),source.indexOf('const inlineEnabled ='));
  const handler=source.slice(source.indexOf('const requestHandler ='),source.indexOf('const server ='));
  vm.runInNewContext(`${auth}\n${handler}\nglobalThis.handle=requestHandler;`,context);
  async function request(method,url,{body,headers={}}={}) {
    const req=Readable.from(body===undefined?[]:[Buffer.from(JSON.stringify(body))]);
    Object.assign(req,{method,url,socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost:18723',origin:'http://localhost:18723',
      'sec-fetch-site':'same-origin','content-type':'application/json',...headers}});
    const result={headers:{},status:null,raw:null};
    const res={setHeader(k,v){result.headers[k.toLowerCase()]=v;},writeHead(status,values){result.status=status;
      for(const [k,v]of Object.entries(values||{}))this.setHeader(k,v);},end(bytes){result.raw=Buffer.from(bytes).toString('utf8');}};
    await context.handle(req,res);result.json=()=>JSON.parse(result.raw);return result;
  }
  return {request,roots,marker,sessionPath,decisionJournalPath,decisionOutcomesPath};
}

test('original HTML/assets, password, Session, CSRF and real Journal/Outcome writes stay private',async t=>{
  const f=fixture(t),r=f.request;
  const page=await r('GET','/');assert.equal(page.status,200);assert.ok(page.raw.includes(OWNER_NOTICE));
  assert.ok(page.raw.includes('/app.js'));assert.equal((await r('GET','/app.js')).status,200);
  assert.equal((await r('GET','/api/v1/decision-journal')).status,401);
  assert.equal((await r('POST','/api/auth/login',{body:{password:'wrong'}})).status,401);
  const login=await r('POST','/api/auth/login',{body:{password:fixturePassword}});assert.equal(login.status,200);
  const cookie=login.headers['set-cookie'].split(';')[0],csrf=login.json().csrfToken;
  assert.match(cookie,/^twchip_owner_local_http_v1=/);
  for(const attr of ['Secure','HttpOnly','SameSite=Strict'])assert.ok(login.headers['set-cookie'].includes(attr));
  const headers={cookie,'x-csrf-token':csrf};
  assert.equal((await r('GET','/api/session',{headers})).json().authenticated,true);
  const now=new Date('2026-11-08T00:00:00Z');
  const snapshot=createDecisionSnapshot({snapshot:{dataMode:'live',asOfDate:'2026-11-08',generatedAt:now.toISOString(),
    futuresMarket:{ok:false},marketBreadth:{ok:false},options:{ok:false},marketOverview:{ok:false}},
    dataHealth:{schemaVersion:'dashboard-data-health-v1',generatedAt:now.toISOString(),overall:'UNAVAILABLE',staleCount:0,
      unavailableCount:1,counts:{},items:[],formalWeight:0,researchOnly:true,executionAuthorized:false},snapshotTime:now.toISOString()});
  const body={intent:'NO_TRADE',reason:'Synthetic missing evidence',snapshot};
  assert.equal((await r('POST','/api/v1/decision-journal',{headers:{cookie},body})).status,403);
  assert.equal(fs.existsSync(f.decisionJournalPath),false);
  const saved=await r('POST','/api/v1/decision-journal',{headers,body});assert.equal(saved.status,201,saved.raw);
  assert.equal(journal.readDecisionJournal(f.decisionJournalPath).length,1);
  const outcome=await r('POST','/api/v1/decision-journal/outcomes',{headers,body:{decisionRecordHash:saved.json().data.recordHash,
    executionStatus:'NOT_EXECUTED',thesisStatus:'NOT_APPLICABLE',outcomeNote:'Synthetic fixture only'}});
  assert.equal(outcome.status,201,outcome.raw);assert.equal(fs.existsSync(f.decisionOutcomesPath),true);
  assert.equal(fs.readFileSync(f.marker,'utf8'),'SYNTHETIC READ-ONLY INPUT');
  assert.deepEqual(fs.readdirSync(f.roots.readDataRoot),['do-not-write.txt']);
  assert.deepEqual(fs.readdirSync(f.roots.producerDataRoot),[]);
  assert.ok(!fs.readFileSync(f.sessionPath,'utf8').includes(fixturePassword));
  assert.equal((await r('POST','/api/auth/logout',{headers,body:{}})).status,200);
  assert.equal((await r('GET','/api/session',{headers})).json().authenticated,false);
});

test('normal login rate limiter remains enforced in Owner handler',async t=>{
  const f=fixture(t);
  for(let i=0;i<5;i++)assert.equal((await f.request('POST','/api/auth/login',{body:{password:'wrong'}})).status,401);
  const limited=await f.request('POST','/api/auth/login',{body:{password:fixturePassword}});
  assert.equal(limited.status,429);assert.ok(limited.headers['retry-after']);assert.equal(fs.existsSync(f.sessionPath),false);
});

// Ephemeral test-only credentials; no Owner or live credential is used.
import { randomBytes as randomFixtureBytes } from 'node:crypto';
// Actual product request handler, auth, HTTP serialization, static serving and Journal.
// Synthetic filesystem only; captured responses, no listener/Chrome/market source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { V2ResearchService } from '../src/v2-research.mjs';
import { ownerEnvironment } from '../src/owner-local-startup.mjs';
import * as security from '../src/security.mjs';
import * as httpUtils from '../src/http-utils.mjs';
import * as journal from '../src/decision-journal.mjs';
import { createDecisionSnapshot } from '../src/dashboard-decision-workspace.mjs';
import { OWNER_COOKIE, OWNER_NOTICE, ownerRequestAllowed } from '../src/owner-local-acceptance.mjs';
import { assertMarketCandidateFilesystemRoots, marketCandidateRouteAllowed, marketCandidateQueryAllowed } from '../src/cru21-market-candidate.mjs';

const fixturePassword = randomFixtureBytes(24).toString('base64url');
const source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
function fixture(t) {
  const base=path.resolve('data');fs.mkdirSync(base,{recursive:true});
  const home=fs.mkdtempSync(path.join(base,'owner-http-fixture-'));
  t.after(()=>{assert.ok(home.startsWith(base+path.sep));fs.rmSync(home,{recursive:true,force:true});});
  const roots={sourceRoot:path.join(home,'runtime'),readDataRoot:path.join(home,'standalone/data'),producerDataRoot:path.join(home,'producer')};
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
  return {request,roots,marker,sessionPath,decisionJournalPath,decisionOutcomesPath,context};
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

test('Owner V2 handler reads bound sibling SQLite/report only, keeps auth and blocks writer without input leakage or mutation', async t => {
  const f = fixture(t), researchRoot = path.join(path.dirname(f.roots.readDataRoot), 'v2');
  fs.mkdirSync(path.join(researchRoot, 'data'), { recursive: true });
  fs.mkdirSync(path.join(researchRoot, 'reports'));
  const database = path.join(researchRoot, 'data/research-v2.sqlite');
  const report = path.join(researchRoot, 'reports/latest-backtest.json');
  const db = new DatabaseSync(database);
  db.exec(`
    CREATE TABLE market_daily(trade_date TEXT, twii_close REAL, tx_close REAL, tx_open_interest INTEGER, basis REAL);
    CREATE TABLE futures_positions_daily(trade_date TEXT, foreign_net INTEGER, market_open_interest INTEGER);
    CREATE TABLE futures_contract_daily(trade_date TEXT, product TEXT, contract TEXT, session TEXT, open REAL, high REAL, low REAL, close REAL, is_active INTEGER);
    CREATE TABLE options_contract_daily(trade_date TEXT, contract TEXT, contract_type TEXT, expiry_date TEXT, days_to_expiry INTEGER, is_active INTEGER, call_volume INTEGER, put_volume INTEGER, volume_pc_ratio REAL, call_oi INTEGER, put_oi INTEGER, oi_pc_ratio REAL, call_wall_strike REAL, call_wall_oi INTEGER, put_wall_strike REAL, put_wall_oi INTEGER, max_pain REAL);
    CREATE TABLE options_strike_daily(trade_date TEXT, contract TEXT, strike REAL, call_oi INTEGER, put_oi INTEGER, call_volume INTEGER, put_volume INTEGER);
    CREATE TABLE option_oi_changes(trade_date TEXT, contract TEXT, strike REAL, call_oi_delta_1d INTEGER, put_oi_delta_1d INTEGER);
    CREATE TABLE quality_issues(severity TEXT);
    INSERT INTO market_daily VALUES ('2026-07-09', 100, 102, 900, 2);
    INSERT INTO futures_positions_daily VALUES ('2026-07-09', -50, NULL);
  `);
  db.close();
  fs.writeFileSync(report, '{"fixture":"bound-sibling-report","researchOnly":true,"formalWeight":0}');
  fs.writeFileSync(path.join(researchRoot, 'reports/v3-daily-update-status.json'), '{"state":"synthetic-only"}');
  const env = ownerEnvironment({ researchRoot }, f.roots, {});
  f.context.v2Research = new V2ResearchService(env.V2_RESEARCH_DATABASE_PATH, env.V2_BACKTEST_REPORT_PATH);
  f.context.config.candidateReadOnly = true;
  f.context.dailyUpdateProcess = null;
  f.context.console = { error() {} };
  let spawns = 0;
  f.context.spawn = () => { spawns++; throw Error('WRITER_MUST_NOT_START'); };
  const snapshot = root => fs.readdirSync(root).sort().flatMap(name => {
    const file = path.join(root, name);
    return fs.statSync(file).isDirectory() ? [file, ...snapshot(file)]
      : [[file, crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')]];
  });
  const inputs = [f.roots.readDataRoot, f.roots.producerDataRoot, researchRoot];
  const before = inputs.map(snapshot);
  for (const route of ['/api/v2/research', '/api/v2/backtests', '/api/v2/daily-update'])
    assert.equal((await f.request('GET', route)).status, 401);
  const login = await f.request('POST', '/api/auth/login', { body: { password: fixturePassword } });
  assert.equal(login.status, 200);
  const headers = { cookie: login.headers['set-cookie'].split(';')[0], 'x-csrf-token': login.json().csrfToken };
  const result = await f.request('GET', '/api/v2/research?databasePath=' + encodeURIComponent(f.marker)
    + '&sql=DELETE%20FROM%20market_daily', { headers });
  assert.equal(result.status, 200, result.raw);
  assert.equal(result.json().data.futures[0].txClose, 102);
  assert.deepEqual(result.json().data.service, { readOnly: true, brokerConnected: false, rawSqlAccepted: false });
  const backtest = await f.request('GET', '/api/v2/backtests?reportPath=' + encodeURIComponent(f.marker), { headers });
  assert.equal(backtest.status, 200); assert.equal(backtest.json().data.fixture, 'bound-sibling-report');
  const daily = await f.request('GET', '/api/v2/daily-update', { headers });
  assert.equal(daily.status, 200); assert.equal(daily.json().data.state, 'synthetic-only');
  assert.equal(daily.json().manualRun.allowed, false);
  assert.equal((await f.request('POST', '/api/v2/daily-update', { headers, body: {} })).status, 403);
  for (const response of [result, backtest, daily]) {
    assert.ok(!response.raw.includes(researchRoot));
    assert.ok(!response.raw.includes('SYNTHETIC READ-ONLY INPUT'));
    assert.ok(!response.raw.includes(fixturePassword));
  }
  assert.equal(spawns, 0);
  assert.deepEqual(inputs.map(snapshot), before, 'all input bytes and directory entries, including SQLite sidecars, unchanged');
  fs.unlinkSync(report);
  const absent = await f.request('GET', '/api/v2/backtests', { headers });
  assert.equal(absent.status, 503); assert.equal(absent.json().error, 'V2_BACKTEST_NOT_READY');
  fs.unlinkSync(database);
  const missing = await f.request('GET', '/api/v2/research', { headers });
  assert.equal(missing.status, 503); assert.equal(missing.json().error, 'V2_DATABASE_NOT_READY');
  assert.equal(fs.existsSync(path.join(f.roots.readDataRoot, 'v2')), false);
});

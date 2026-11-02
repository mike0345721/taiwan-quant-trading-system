// Pure metadata/EventEmitter mocks and C# source assertions; no app or socket is started.
import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import https from 'node:https';
const entry = await import(process.env.CRU21_NORMAL_ENTRY_TEST_MODULE || new URL('../scripts/cru21-normal-candidate/application-normal-entry.mjs',import.meta.url));
// Metadata only: resolve native absolute paths without creating these fixtures.
const syntheticPath = (...parts) => path.resolve('synthetic', ...parts);
const certificateRaw = Buffer.from('PURE_SYNTHETIC_TLS_CERTIFICATE_BYTES');
const certificatePin = crypto.createHash('sha256').update(certificateRaw).digest('hex');
const candidate = () => ({scope:'MARKET_RESEARCH_AI_DISABLED_CANDIDATE', previewType:'CRU21_MARKET_RESEARCH_CANDIDATE',
  host:'127.0.0.1', port:18723, transport:'https', aiEnabled:false, cookieSecure:true,
  certificate:{bundlePath:syntheticPath('private','tls.protected'),bundleSHA256:'b'.repeat(64),certificatePinSHA256:certificatePin}});
const ticket = () => ({productHead:(entry.AI_DISABLED_PRODUCT || entry.NORMAL_PRODUCT).head,productTree:(entry.AI_DISABLED_PRODUCT || entry.NORMAL_PRODUCT).tree,
  windowId:'00000000-0000-4000-8000-000000000001',nonce:'a'.repeat(64),intentHash:'d'.repeat(64),helperSHA256:'e'.repeat(64),
  git:{path:syntheticPath('git')},node:{path:syntheticPath('node')},candidate:candidate(),
  roots:{chartReadRoot:syntheticPath('chart'),chartCacheRoot:syntheticPath('cache'),producerDataRoot:syntheticPath('producer'),
    snapshotPath:syntheticPath('producer','latest.json'),statusPath:syntheticPath('producer','status.json'),localAppDataRoot:syntheticPath('local')}});
const native = fs.readFileSync(new URL('../scripts/cru21-normal-candidate/windows-candidate/CandidateHost.cs',import.meta.url),'utf8');
test('AI-off fixed candidate validates pure metadata and retains live HOLD',()=>{
  assert.equal(entry.normalCandidateContract(ticket()).port,18723);
  assert.equal(entry.normalLiveEligibility().allowed,false);
});
for(const [name,edit] of [
  ['scope', c=>c.scope='MARKET_RESEARCH_AI_DISABLED'],['preview', c=>c.previewType='CRU21_OWNER_PREVIEW'],
  ['host', c=>c.host='0.0.0.0'],['port',c=>c.port=8787],['transport',c=>c.transport='http'],
  ['AI enabled',c=>c.aiEnabled=true],['cookie',c=>c.cookieSecure=false],
  ['pin',c=>c.certificate.certificatePinSHA256='0'],['bundle hash',c=>c.certificate.bundleSHA256='0'],
  ['foreign path',c=>c.certificate.bundlePath='//remote/share/tls'],['extra flag',c=>c.approved=true],
])test('AI-off contract rejects '+name,()=>{
  const t=ticket();edit(t.candidate);assert.throws(()=>entry.normalCandidateContract(t),/NORMAL_CANDIDATE_/);
});
test('AI-off environment stays HTTPS AI disabled secure normal auth and independent roots',()=>{
  const t=ticket(),env=entry.normalEnvironmentPlan(t);
  assert.equal(env.PORT,'18723');assert.equal(env.ASK_GPT_INLINE_ENABLED,'0');assert.equal(env.COOKIE_SECURE,'1');
  assert.equal(env.DASHBOARD_RELEASE_SCOPE,t.candidate.scope);assert.equal(env.DASHBOARD_PREVIEW_TYPE,t.candidate.previewType);
  assert.equal(env.DASHBOARD_TLS_BUNDLE,t.candidate.certificate.bundlePath);
  assert.equal(env.DASHBOARD_TLS_BUNDLE_SHA256,t.candidate.certificate.bundleSHA256);
  assert.equal(env.DASHBOARD_TLS_CERT_SHA256,t.candidate.certificate.certificatePinSHA256);
  assert.equal(env.CRU21_GUEST_ENABLED,'0');assert.equal('NODE_TLS_REJECT_UNAUTHORIZED' in env,false);
  assert.equal(env.DASHBOARD_CANDIDATE_READ_ROOT,t.roots.chartReadRoot);
  assert.equal('ASK_GPT_CANDIDATE_READ_ROOT' in env,false);
  assert.equal(env.V2_RESEARCH_DATABASE_PATH,path.join(t.roots.chartReadRoot,'v2','data','research-v2.sqlite'));
  assert.equal(env.V2_BACKTEST_REPORT_PATH,path.join(t.roots.chartReadRoot,'v2','reports','latest-backtest.json'));
  assert.equal(env.DATA_OPERATIONS_OUTPUT_ROOT,path.join(t.roots.chartReadRoot,'quality','daily-data-operations'));
});
test('legacy environment remains original AI-on 18722 without TLS scope',()=>{
  const t=ticket();delete t.candidate;const env=entry.normalEnvironmentPlan(t);
  assert.equal(env.PORT,'18722');assert.equal(env.ASK_GPT_INLINE_ENABLED,'1');
  assert.equal(env.DASHBOARD_PREVIEW_TYPE,'CRU21_OWNER_PREVIEW');assert.equal('DASHBOARD_RELEASE_SCOPE' in env,false);
});
function mockFacade({pinRaw=certificateRaw,authorized=true,altname='IP Address:127.0.0.1',status=401,noResponse=false}={}) {
  const server=Object.assign(new EventEmitter(),{address:()=>({address:'127.0.0.1',port:18723})});
  const seen=[],requests=[];
  const facade={createServer(...args){seen.push(args);return server;},request(options){
    const request=Object.assign(new EventEmitter(),{destroy(){},end(){queueMicrotask(()=>{
      const cert={raw:pinRaw,subjectaltname:altname};
      const socket=Object.assign(new EventEmitter(),{encrypted:true,authorized,getPeerCertificate:()=>cert});
      request.emit('socket',socket);socket.emit('secureConnect');
      if (!noResponse) request.emit('response',{statusCode:status,destroy(){}});
    });}});requests.push({options,request});return request;
  }};
  return {facade,server,seen,requests};
}
test('HTTPS observer preserves options and original handler, observes trusted peer through a synthetic HTTPS request',async()=>{
  const t=ticket(),f=mockFacade(),options={},handler=()=>{},old=f.facade.createServer;
  const observer=entry.attachNormalListeningObserver(f.facade,t.candidate);
  assert.equal(f.facade.createServer(options,handler),f.server);assert.equal(f.seen[0][0],options);assert.equal(f.seen[0][1],handler);
  f.server.emit('listening');const listener=await observer.listening;
  assert.equal(listener.transport,'https');assert.equal(listener.certificatePinSHA256,certificatePin);
  const frame=entry.normalListeningHandshake(t,listener);
  assert.equal(frame.candidateSHA256,entry.normalCanonicalSHA256(t.candidate));assert.equal('ownerLoggedIn' in frame,false);
  assert.equal(f.requests.length,1);const q=f.requests[0].options;
  assert.deepEqual([q.hostname,q.port,q.path,q.method,q.rejectUnauthorized,q.agent],['127.0.0.1',18723,'/api/session','GET',true,false]);
  for (const k of ['ca','headers','auth','pfx','cert','key']) assert.equal(k in q,false);
  assert.ok(q.checkServerIdentity('localhost',{raw:certificateRaw,subjectaltname:'DNS:localhost'}) instanceof Error);
  observer.restore();assert.equal(f.facade.createServer,old);
});
for(const [name,options] of [['wrong actual pin',{pinRaw:Buffer.from('OTHER_SYNTHETIC_TLS_BYTES')}],
  ['untrusted peer',{authorized:false}],['hostname mismatch',{altname:'DNS:other.invalid'}],['redirect',{status:302}]
])test('HTTPS observer rejects '+name+' with exactly one request',async()=>{
  const f=mockFacade(options),observer=entry.attachNormalListeningObserver(f.facade,candidate());
  f.facade.createServer({},()=>{});f.server.emit('listening');
  await assert.rejects(observer.listening,/NORMAL_TLS_PEER_/);assert.equal(f.requests.length,1);observer.restore();
});
test('trusted-peer observation has one absolute bounded timeout without retry',async()=>{
  const f=mockFacade({noResponse:true}),started=Date.now(),observer=entry.attachNormalListeningObserver(f.facade,candidate());
  f.facade.createServer({},()=>{});f.server.emit('listening');
  await assert.rejects(observer.listening,/NORMAL_TLS_PEER_TIMEOUT/);
  assert.ok(Date.now()-started<3000);assert.equal(f.requests.length,1);observer.restore();
});
test('candidate handshake cannot reuse legacy HTTP observations',()=>{
  assert.throws(()=>entry.normalListeningHandshake(ticket(),{address:'127.0.0.1',port:18722,originalHandlerForwarded:true}),/NORMAL_LISTENING_OBSERVATION_REJECTED/);
});
test('native fixed candidate binding is source-connected while approval remains HOLD',()=>{
  assert.match(native,/MARKET_RESEARCH_AI_DISABLED_CANDIDATE/);assert.match(native,/CRU21_MARKET_RESEARCH_CANDIDATE/);
  assert.match(native,/candidateSHA256/);assert.match(native,/NormalListenerPort\(\)/);
  assert.match(native,/static bool NormalGateAllows\(\) \{ return false; \}/);
  assert.match(native,/ExpectedNormalOwnerApprovalSHA256 = "NOT_APPROVED"/);
});

test('strict candidate cannot qualify an unfrozen or legacy product source ticket',()=>{
  const t=ticket();Object.assign(t,{schema:'cru21-normal-entry-ticket-v1',mode:'NORMAL_CANDIDATE',runtimeAllowed:false,
    sourceManifestSHA256:entry.NORMAL_SOURCE_MANIFEST_SHA256,durationMs:900000,normalAuth:{}});
  t.productHead=entry.NORMAL_PRODUCT.head;t.productTree=entry.NORMAL_PRODUCT.tree;
  assert.throws(()=>entry.verifyNormalEntryTicket(t),/NORMAL_TICKET_IDENTITY_REJECTED/);
});
test('native candidate source keeps exact per-variant pins and scope while old map remains frozen',()=>{
  assert.match(native,/const string AiDisabledProductHead = "(?:UNFROZEN|[a-f0-9]{40})"/);
  assert.match(native,/CanonicalHash\(candidate\) == CanonicalHash\(NormalCandidateMetadata\)/);
  assert.match(native,/String\(operation, \"candidateSHA256\"\) == CanonicalHash\(NormalCandidateMetadata\)/);
  assert.equal(entry.NORMAL_PRODUCT.head,'4ae16de9a5af0166744626d44a49cb5bcebed675');
  assert.equal(Object.keys(entry.normalSourceClosure().files).length,356);
});

test('server error during pending trusted peer observation cannot resolve a listening handshake',async()=>{
  const f=mockFacade({noResponse:true}),observer=entry.attachNormalListeningObserver(f.facade,candidate());
  f.facade.createServer({},()=>{});f.server.emit('listening');
  await new Promise(resolve=>queueMicrotask(resolve));
  f.server.emit('error',Error('SYNTHETIC_SERVER_ERROR_DURING_TLS_PROBE'));
  f.requests[0].request.emit('response',{statusCode:401,destroy(){}});
  await assert.rejects(observer.listening,/SYNTHETIC_SERVER_ERROR_DURING_TLS_PROBE/);
  assert.equal(f.requests.length,1);observer.restore();
});

const productContractModule = process.env.CRU21_CANDIDATE_PRODUCT_CONTRACT_MODULE;
test('actual normal environment crosses product mode and synthetic filesystem root contracts', {skip:!productContractModule?'NOT_RUN: exact product guard module not selected':false}, async()=>{
  const product=await import(productContractModule),t=ticket();
  Object.assign(t.roots,{sourceRoot:syntheticPath('source'),privateDataRoot:syntheticPath('source','data'),
    chartCacheRoot:syntheticPath('source','data','dashboard-chart-cache'),localAppDataRoot:syntheticPath('source','data','candidate-local-appdata'),
    snapshotPath:syntheticPath('producer','runtime','cru34-live','latest.json'),statusPath:syntheticPath('producer','runtime','cru34-live','status.json')});
  const env=entry.normalEnvironmentPlan(t),config={appRoot:t.roots.sourceRoot,dataDir:t.roots.privateDataRoot,
    host:'127.0.0.1',port:18723,nodeEnv:'production',cookieSecure:true,mockData:false,trustProxy:false,cru55Candidate:false,cru55Acceptance:null};
  if (entry.AI_DISABLED_PRODUCT.head === 'UNFROZEN') assert.throws(()=>product.assertMarketCandidateMode(env,config),/MARKET_CANDIDATE_MODE_REJECTED/);
  else assert.equal(product.assertMarketCandidateMode(env,config),true);
  const roots=product.assertMarketCandidateEnvironmentRoots(env,config),inspected=[];
  assert.equal(roots.readDataRoot,t.roots.chartReadRoot);
  const io={lstatSync(file){inspected.push(file);if(path.basename(file)==='sessions.json')throw Object.assign(Error('SYNTHETIC_ABSENT_SESSION'),{code:'ENOENT'});
    return {isSymbolicLink:()=>false,isDirectory:()=>true,isFile:()=>false};},realpathSync:file=>file,readdirSync:()=>[]};
  assert.equal(product.assertMarketCandidateFilesystemRoots(roots,io),true);
  assert.ok(inspected.includes(syntheticPath('source','data','decision-workspace')));
});

test('public observer cannot arm the actual Node HTTPS facade while live eligibility is HOLD',()=>{
  const original=https.createServer;assert.throws(()=>entry.attachNormalListeningObserver(https,candidate()),/NORMAL_TLS_LIVE_GATE_HOLD/);
  assert.equal(https.createServer,original);
});

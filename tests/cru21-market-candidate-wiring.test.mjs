// Pure contracts, own temporary fixtures and captured TLS factories only.
// No socket, application startup, certificate enrollment or private store access.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import vm from 'node:vm';
import { readLocalProtectedBytes } from '../src/dashboard-local-tls.mjs';
import { resolveDashboardReadDataRoot } from '../src/dashboard-source-binding.mjs';
import { selectDashboardProductSurface } from '../src/dashboard-integration-contract.mjs';
import { assertMarketCandidateMode, assertMarketCandidateEnvironmentRoots, assertMarketCandidateFilesystemRoots,
  marketCandidateQueryAllowed, marketCandidateBrowserBindingMatches, MARKET_CANDIDATE_SCOPE,
  MARKET_CANDIDATE_PREVIEW, MARKET_CANDIDATE_BRANCH } from '../src/cru21-market-candidate.mjs';

const hash = b => crypto.createHash('sha256').update(b).digest('hex');
const head='1'.repeat(40), tree='2'.repeat(40), base='3'.repeat(40);
function fixture(t) {
  const home=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-market-source-'));
  t.after(()=>fs.rmSync(home,{recursive:true,force:true}));
  const sourceRoot=path.join(home,'candidate'),privateDataRoot=path.join(sourceRoot,'data');
  const roots={sourceRoot,privateDataRoot,readDataRoot:path.join(home,'read'),producerDataRoot:path.join(home,'producer'),
    chartCacheRoot:path.join(privateDataRoot,'dashboard-chart-cache')};
  for(const dir of [roots.sourceRoot,roots.privateDataRoot,roots.readDataRoot,roots.producerDataRoot,
    roots.chartCacheRoot,path.join(privateDataRoot,'decision-workspace')]) fs.mkdirSync(dir,{recursive:true});
  const env={DASHBOARD_RELEASE_SCOPE:MARKET_CANDIDATE_SCOPE,DASHBOARD_PREVIEW_TYPE:MARKET_CANDIDATE_PREVIEW,
    DASHBOARD_PREVIEW_BRANCH:MARKET_CANDIDATE_BRANCH,DASHBOARD_PREVIEW_EXPECTED_HEAD:head,DASHBOARD_PREVIEW_EXPECTED_TREE:tree,
    DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN:base,ASK_GPT_INLINE_ENABLED:'0',DASHBOARD_TLS_BUNDLE:path.join(home,'tls.dpapi'),
    DASHBOARD_TLS_BUNDLE_SHA256:'a'.repeat(64),DASHBOARD_TLS_CERT_SHA256:'b'.repeat(64),
    DASHBOARD_CANDIDATE_READ_ROOT:roots.readDataRoot,TX_CHART_DATA_ROOT:roots.readDataRoot,TX_CHART_CACHE_ROOT:roots.chartCacheRoot,
    CRU34_LIVE_DATA_ROOT:roots.producerDataRoot,CRU34_LIVE_SNAPSHOT_PATH:path.join(roots.producerDataRoot,'runtime/cru34-live/latest.json'),
    CRU34_LIVE_STATUS_PATH:path.join(roots.producerDataRoot,'runtime/cru34-live/status.json'),
    V2_RESEARCH_DATABASE_PATH:path.join(roots.readDataRoot,'v2/data/research-v2.sqlite'),
    V2_BACKTEST_REPORT_PATH:path.join(roots.readDataRoot,'v2/reports/latest-backtest.json'),
    DATA_OPERATIONS_OUTPUT_ROOT:path.join(roots.readDataRoot,'quality/daily-data-operations')};
  const config={appRoot:sourceRoot,dataDir:privateDataRoot,host:'127.0.0.1',port:18723,nodeEnv:'production',
    mockData:false,cookieSecure:true,trustProxy:false};
  return {home,roots,env,config};
}

test('candidate read routing keeps private writes and all bound source inputs separate',t=>{
  const {roots,env,config}=fixture(t);
  assert.deepEqual(assertMarketCandidateEnvironmentRoots(env,config),roots);
  const options={dataDir:config.dataDir,host:config.host,port:config.port,actualDataMode:'LIVE',inlineEnabled:false,
    previewType:MARKET_CANDIDATE_PREVIEW,marketCandidateScope:MARKET_CANDIDATE_SCOPE,
    marketCandidateReadRoot:roots.readDataRoot,sourceRoot:roots.sourceRoot,producerDataRoot:roots.producerDataRoot,chartCacheRoot:roots.chartCacheRoot};
  assert.equal(resolveDashboardReadDataRoot(options),roots.readDataRoot);
  for(const patch of [{port:8787},{port:18722},{inlineEnabled:true},{formalReadRoot:roots.readDataRoot},
    {candidateReadRoot:roots.readDataRoot},{marketCandidateScope:null},{previewType:'CRU21_OWNER_PREVIEW'},
    {actualDataMode:'MOCK'},{isolatedMode:true}]) assert.throws(()=>resolveDashboardReadDataRoot({...options,...patch}));
  for(const key of ['TX_CHART_DATA_ROOT','CRU34_LIVE_SNAPSHOT_PATH','CRU34_LIVE_STATUS_PATH',
    'V2_RESEARCH_DATABASE_PATH','V2_BACKTEST_REPORT_PATH','DATA_OPERATIONS_OUTPUT_ROOT'])
    assert.throws(()=>assertMarketCandidateEnvironmentRoots({...env,[key]:path.join(roots.sourceRoot,'foreign')},config));
  assert.deepEqual(fs.readdirSync(roots.privateDataRoot).sort(),['dashboard-chart-cache','decision-workspace']);
});

test('private namespace must be pre-provisioned and alias-free without creating missing folders',t=>{
  const {roots}=fixture(t);assert.equal(assertMarketCandidateFilesystemRoots(roots),true);
  fs.rmdirSync(roots.chartCacheRoot);
  assert.throws(()=>assertMarketCandidateFilesystemRoots(roots),/PATH_UNAVAILABLE/);
  assert.equal(fs.existsSync(roots.chartCacheRoot),false);
  fs.symlinkSync(roots.readDataRoot,roots.chartCacheRoot,'dir');
  assert.throws(()=>assertMarketCandidateFilesystemRoots(roots),/PATH_ALIAS/);
});
test('private sessions and derived-cache leaves reject links instead of writing foreign bytes',t=>{
  const {home,roots}=fixture(t);const foreign=path.join(home,'foreign');fs.writeFileSync(foreign,'UNCHANGED');
  const sessions=path.join(roots.privateDataRoot,'sessions.json');fs.symlinkSync(foreign,sessions);
  assert.throws(()=>assertMarketCandidateFilesystemRoots(roots),/PATH_ALIAS/);fs.unlinkSync(sessions);
  fs.linkSync(foreign,sessions);assert.throws(()=>assertMarketCandidateFilesystemRoots(roots),/PATH_ALIAS/);fs.unlinkSync(sessions);
  fs.symlinkSync(foreign,path.join(roots.chartCacheRoot,'cache.ndjson'));
  assert.throws(()=>assertMarketCandidateFilesystemRoots(roots),/PATH_ALIAS/);
  assert.equal(fs.readFileSync(foreign,'utf8'),'UNCHANGED');
});
test('candidate rejects inherited Git identity/config overrides',t=>{
  const {env,config}=fixture(t);
  for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_CONFIG_COUNT','git_config_global'])
    assert.throws(()=>assertMarketCandidateMode({...env,[key]:'synthetic-override'},config));
});
test('candidate query dates cannot escape approved ledger root',()=>{
  for(const suffix of ['tradeDate=../../outside','tradeDate=2026-02-31','tradeDate=2026-01-01&tradeDate=2026-01-02',
    'timeframe=../../outside','mode=MOCK','actualContract=../outside','asOf=../outside'])
    assert.equal(marketCandidateQueryAllowed(new URL('https://127.0.0.1:18723/api/v1/tx-chart?'+suffix)),false);
  assert.equal(marketCandidateQueryAllowed(new URL('https://127.0.0.1:18723/api/v1/tx-chart?tradeDate=2026-11-02&timeframe=5m&mode=LIVE&session=DAY&actualContract=TXFK6')),true);
});

test('candidate verifies encrypted TLS bytes before invoking a synthetic decoder',t=>{
  const {home}=fixture(t),file=path.join(home,'only-synthetic.dpapi');const bytes=Buffer.from('SYNTHETIC_CIPHERTEXT');fs.writeFileSync(file,bytes);
  let calls=0;const decode=b=>{calls++;return Buffer.from(b);};
  assert.throws(()=>readLocalProtectedBytes(file,decode,{expectedSha256:'a'.repeat(64)}),/LOCAL_TLS_BUNDLE_HASH_REJECTED/);
  assert.equal(calls,0);
  assert.deepEqual(readLocalProtectedBytes(file,decode,{expectedSha256:hash(bytes)}),bytes);assert.equal(calls,1);
});

test('candidate selects HTTPS factory and original handler with synthetic TLS APIs only',async t=>{
  const {env,config}=fixture(t);let reads=0,httpsCalls=0,httpCalls=0,childCalls=0;
  const raw=Buffer.from('PUBLIC_SYNTHETIC_CERTIFICATE');env.DASHBOARD_TLS_CERT_SHA256=hash(raw);
  class Certificate { constructor(){Object.assign(this,{raw,ca:false,validFrom:'2020-01-01',validTo:'2099-01-01',keyUsage:['1.3.6.1.5.5.7.3.1']});}checkIP(){return true;}checkHost(){return true;} }
  const certificate=new Certificate();class Socket {destroy(){}}class TLSSocket extends Socket{getX509Certificate(){return certificate;}}
  const context=vm.createContext({Buffer,process:{platform:'win32',env:{}},Date});
  const mocks={'node:fs':{default:{}},'node:path':{default:path},'node:http':{default:{createServer(){httpCalls++;throw Error('HTTP_FORBIDDEN');}}},
    'node:https':{default:{createServer(options,handler){httpsCalls++;return {options,handler,synthetic:true};}}},
    'node:net':{Socket},'node:tls':{createSecureContext:()=>({}),TLSSocket},'node:crypto':{X509Certificate:Certificate,createHash:crypto.createHash},
    'node:child_process':{execFileSync(){childCalls++;throw Error('CHILD_FORBIDDEN');}},
    './cru21-market-candidate.mjs':{assertMarketCandidateMode}};
  const source=fs.readFileSync(new URL('../src/dashboard-local-tls.mjs',import.meta.url),'utf8');
  const module=new vm.SourceTextModule(source,{context});
  await module.link(spec=>{const exports=mocks[spec];assert.ok(exports,spec);return new vm.SyntheticModule(Object.keys(exports),function(){for(const [k,v]of Object.entries(exports))this.setExport(k,v);},{context});});
  await module.evaluate();const handler=()=>{};
  const plain=Buffer.from(JSON.stringify({schema:'cru21-local-tls-bundle-v1',pfx:'QQ==',passphrase:'x'.repeat(40),certificatePem:'SYNTHETIC_PUBLIC'}));
  const server=module.namespace.createDashboardServer(handler,env,config,{readProtected(file,decoder,options){reads++;assert.equal(options.expectedSha256,env.DASHBOARD_TLS_BUNDLE_SHA256);return plain;}});
  assert.equal(server.handler,handler);assert.equal(server.options.minVersion,'TLSv1.2');assert.equal(server.synthetic,true);
  assert.deepEqual({reads,httpsCalls,httpCalls,childCalls},{reads:1,httpsCalls:1,httpCalls:0,childCalls:0});
  assert.ok(plain.every(b=>b===0));
});

test('browser candidate binding needs its own HTTPS/version frame before normalization',()=>{
  const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const declaration=source.slice(source.indexOf('function marketCandidateBrowserBinding('),source.indexOf('\nasync function reportCru46BrowserRuntimeProof('));
  assert.ok(declaration.startsWith('function marketCandidateBrowserBinding('));
  const binding=vm.runInNewContext('('+declaration+')');
  const version={previewType:MARKET_CANDIDATE_PREVIEW,releaseScope:MARKET_CANDIDATE_SCOPE,branch:MARKET_CANDIDATE_BRANCH,
    aiEnabled:false,complete:false,deliveryAccepted:false,exactHead:head,runtimeCommit:head,buildCommit:head,
    exactTree:tree,runtimeTree:tree,buildTree:tree,runtimeStartedAt:'2026-11-02T00:00:00.000Z'};
  const location={origin:'https://127.0.0.1:18723'};const frame=binding(version,location);
  assert.ok(frame);assert.equal(marketCandidateBrowserBindingMatches(frame,{exactHead:head,exactTree:tree,runtimeStartedAt:version.runtimeStartedAt}),true);
  for(const patch of [{previewType:'CRU21_OWNER_PREVIEW'},{releaseScope:'MARKET_RESEARCH_AI_DISABLED'},{branch:'main'},
    {runtimeCommit:base},{runtimeTree:base},{aiEnabled:true},{complete:true},{runtimeStartedAt:'invalid'}]) assert.equal(binding({...version,...patch},location),null);
  for(const origin of ['http://127.0.0.1:18723','https://127.0.0.1:8787','https://localhost:18723']) assert.equal(binding(version,{origin}),null);
  for(const patch of [{exactHead:base},{exactTree:base},{runtimeStartedAt:'old'},{origin:'https://127.0.0.1:8787'},{candidateScope:'OTHER'}])
    assert.equal(marketCandidateBrowserBindingMatches({...frame,...patch},{exactHead:head,exactTree:tree,runtimeStartedAt:version.runtimeStartedAt}),false);
});
test('new candidate surface is explicit and never claims acceptance',()=>{
  const surface=selectDashboardProductSurface({marketCandidate:true,previewType:MARKET_CANDIDATE_PREVIEW});
  assert.equal(surface.deliveryAccepted,false);assert.equal(surface.dataQualificationDeclared,false);
  assert.deepEqual(surface.observedFlow.governed,['1m','5m','15m','30m','1h','4h']);
  assert.notEqual(selectDashboardProductSurface({marketCandidate:'true',previewType:MARKET_CANDIDATE_PREVIEW}),surface);
});

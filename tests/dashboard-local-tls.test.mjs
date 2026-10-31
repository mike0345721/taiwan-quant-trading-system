import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { assertLocalMarketMode, loadLocalTls, readLocalProtectedBytes, createDashboardServer } from '../src/dashboard-local-tls.mjs';
import { InlineAssistant } from '../src/ask-gpt-inline-service.mjs';
import { selectDashboardProductSurface, CRU46_PRODUCT_SURFACE_CONTRACT } from '../src/dashboard-integration-contract.mjs';

const env=()=>({DASHBOARD_RELEASE_SCOPE:'MARKET_RESEARCH_AI_DISABLED',ASK_GPT_INLINE_ENABLED:'0',
  DASHBOARD_TLS_BUNDLE:path.resolve('fixture-tls.dpapi'),DASHBOARD_TLS_CERT_SHA256:'a'.repeat(64)});
const config=()=>({host:'127.0.0.1',port:8787,nodeEnv:'production',cookieSecure:true,mockData:false,trustProxy:false});

test('local market scope is opt-in and legacy mode performs no TLS read',()=>{
  assert.equal(assertLocalMarketMode({},config()),false);
  assert.equal(loadLocalTls({},config(),{readProtected(){throw Error('unexpected read');}}),null);
  const server=createDashboardServer(()=>{}, {}, config());
  assert.ok(server instanceof http.Server); server.close();
});
test('local market scope accepts only explicit disabled AI and loopback',()=>assert.equal(assertLocalMarketMode(env(),config()),true));
for(const [name,patch] of Object.entries({publicHost:{host:'0.0.0.0'},foreignPort:{port:8790},development:{nodeEnv:'development'},
  insecureCookie:{cookieSecure:false},mock:{mockData:true},proxy:{trustProxy:true},candidate:{cru55Candidate:true},acceptance:{cru55Acceptance:{}}}))
  test('local market scope rejects '+name,()=>assert.throws(()=>assertLocalMarketMode(env(),{...config(),...patch})));
for(const [name,patch] of Object.entries({unknownScope:{DASHBOARD_RELEASE_SCOPE:'OTHER'},enabledAI:{ASK_GPT_INLINE_ENABLED:'1'},
  absentAI:{ASK_GPT_INLINE_ENABLED:undefined},preview:{DASHBOARD_PREVIEW_TYPE:'CRU21_OWNER_PREVIEW'},guest:{CRU21_GUEST_ENABLED:'1'},
  disabledTls:{NODE_TLS_REJECT_UNAUTHORIZED:'0'},nodePreload:{NODE_OPTIONS:'--require=unexpected'},
  relativeKey:{DASHBOARD_TLS_BUNDLE:'relative.dpapi'},absentPin:{DASHBOARD_TLS_CERT_SHA256:undefined},badPin:{DASHBOARD_TLS_CERT_SHA256:'short'}}))
  test('local market scope rejects '+name,()=>assert.throws(()=>assertLocalMarketMode({...env(),...patch},config())));
for(const extra of [{DASHBOARD_TLS_BUNDLE:'somewhere'},{DASHBOARD_TLS_CERT_SHA256:'a'.repeat(64)}])
  test('TLS setting without explicit scope is rejected',()=>assert.throws(()=>assertLocalMarketMode(extra,config())));

test('invalid/missing encrypted material fails closed with no plaintext in errors',()=>{
  const secretSentinel='SYNTHETIC_PRIVATE_MATERIAL_DO_NOT_ECHO';
  for(const readProtected of [()=>Buffer.from(secretSentinel),()=>{throw Error(secretSentinel);},()=>Buffer.from(JSON.stringify({schema:'unknown'}))]){
    assert.throws(()=>loadLocalTls(env(),config(),{readProtected}),e=>e.message==='LOCAL_TLS_CONFIGURATION_REJECTED'&&!String(e).includes(secretSentinel));
  }
});
test('decrypted buffer is zeroed even after rejected parsing',()=>{
  const plain=Buffer.from('not-json');
  assert.throws(()=>loadLocalTls(env(),config(),{readProtected:()=>plain}));
  assert.ok(plain.every(b=>b===0));
});
test('protected file reader binds a bounded file and closes it; injected decoder is synthetic only',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-tls-file-'));const file=path.join(root,'dummy.dpapi');
  try{
    fs.writeFileSync(file,'synthetic-encrypted-bytes');let calls=0;
    assert.equal(readLocalProtectedBytes(file,b=>{calls++;return Buffer.from(b);}).toString(),'synthetic-encrypted-bytes');
    assert.equal(calls,1);fs.writeFileSync(file,Buffer.alloc(128*1024+1));
    assert.throws(()=>readLocalProtectedBytes(file,()=>{throw Error('decoder must not run');}),/LOCAL_TLS_FILE_REJECTED/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('disabled assistant status touches no account/store/transport and rejects operations',async()=>{
  let calls=0;const forbidden=()=>{calls++;throw Error('ACCOUNT_ACCESS_FORBIDDEN');};
  const assistant=new InlineAssistant({enabled:false,root:path.resolve('nonexistent-test-only-root'),runtimeCommit:'b'.repeat(40),
    snapshotProvider:forbidden,storeFactory:forbidden,initializeStoreFactory:forbidden,inspectStore:forbidden,setupStarter:forbidden,configureTransport:forbidden});
  const status=assistant.connection();
  assert.equal(status.enabled,false);assert.equal(status.storeState,'DISABLED');assert.equal(status.credentialsLoaded,false);
  assert.throws(()=>assistant.loadAccounts(),/INLINE_ASSISTANT_NOT_ACTIVATED/);
  assert.throws(()=>assistant.ensure(),/INLINE_ASSISTANT_NOT_ACTIVATED/);
  await assistant.close();assert.equal(calls,0);
});
test('local scope reports six windows but does not grant market or delivery acceptance',()=>{
  const surface=selectDashboardProductSurface({localMarketOnly:true});
  assert.deepEqual(surface.observedFlow.governed,['1m','5m','15m','30m','1h','4h']);
  assert.equal(surface.deliveryAccepted,false);assert.equal(surface.dataQualificationDeclared,false);
  assert.equal(surface.safety.executionAuthorized,false);assert.equal(surface.safety.orderRoutesEnabled,false);
  assert.equal(selectDashboardProductSurface({localMarketOnly:'true'}),CRU46_PRODUCT_SURFACE_CONTRACT);
  assert.equal(selectDashboardProductSurface({localMarketOnly:true,previewType:'UNKNOWN'}),CRU46_PRODUCT_SURFACE_CONTRACT);
});

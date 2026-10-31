import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { assertLocalMarketMode, loadLocalTls, readLocalProtectedBytes, createDashboardServer, assertLocalPfxIdentity } from '../src/dashboard-local-tls.mjs';
import { InlineAssistant } from '../src/ask-gpt-inline-service.mjs';
import { selectDashboardProductSurface, CRU46_PRODUCT_SURFACE_CONTRACT } from '../src/dashboard-integration-contract.mjs';

const env=()=>({DASHBOARD_RELEASE_SCOPE:'MARKET_RESEARCH_AI_DISABLED',ASK_GPT_INLINE_ENABLED:'0',
  DASHBOARD_TLS_BUNDLE:path.resolve('fixture-tls.dpapi'),DASHBOARD_TLS_CERT_SHA256:'a'.repeat(64)});
const config=()=>({host:'127.0.0.1',port:8787,nodeEnv:'production',cookieSecure:true,mockData:false,trustProxy:false});

/*
Static public test credentials from Node.js v24.18.0 (never use for deployment):
https://github.com/nodejs/node/tree/v24.18.0/test/fixtures/keys
agent1.pfx, agent1-cert.pem and agent2-cert.pem are copied unchanged. These
tests neither create nor enroll a certificate and never modify system trust.
They prove PFX/PEM binding only, not the production SAN/EKU/trust/login gates.

Copyright Node.js contributors. All rights reserved.

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to
deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or
sell copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING
FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS
IN THE SOFTWARE.
*/
const publicTestPfx=Buffer.from('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','base64');
const publicTestCertificate=new X509Certificate("-----BEGIN CERTIFICATE-----\nMIID6DCCAtCgAwIBAgIUFH02wcL3Qgben6tfIibXitsApCYwDQYJKoZIhvcNAQEL\nBQAwejELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMQswCQYDVQQHDAJTRjEPMA0G\nA1UECgwGSm95ZW50MRAwDgYDVQQLDAdOb2RlLmpzMQwwCgYDVQQDDANjYTExIDAe\nBgkqhkiG9w0BCQEWEXJ5QHRpbnljbG91ZHMub3JnMCAXDTIyMDkwMzIxNDAzN1oY\nDzIyOTYwNjE3MjE0MDM3WjB9MQswCQYDVQQGEwJVUzELMAkGA1UECAwCQ0ExCzAJ\nBgNVBAcMAlNGMQ8wDQYDVQQKDAZKb3llbnQxEDAOBgNVBAsMB05vZGUuanMxDzAN\nBgNVBAMMBmFnZW50MTEgMB4GCSqGSIb3DQEJARYRcnlAdGlueWNsb3Vkcy5vcmcw\nggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQDUVjIK+yDTgnCT3CxChO0E\n37q9VuHdrlKeKLeQzUJW2yczSfNzX/0zfHpjY+zKWie39z3HCJqWxtiG2wxiOI8c\n3WqWOvzVmdWADlh6EfkIlg+E7VC6JaKDA+zabmhPvnuu3JzogBMnsWl68lCXzuPx\ndeQAmEwNtqjrh74DtM+Ud0ulb//Ixjxo1q3rYKu+aaexSramuee6qJta2rjrB4l8\nB/bU+j1mDf9XQQfSjo9jRnp4hiTFdBl2k+lZzqE2L/rhu6EMjA2IhAq/7xA2MbLo\n9cObVUin6lfoo5+JKRgT9Fp2xEgDOit+2EA/S6oUfPNeLSVUqmXOSWlXlwlb9Nxr\nAgMBAAGjYTBfMF0GCCsGAQUFBwEBBFEwTzAjBggrBgEFBQcwAYYXaHR0cDovL29j\nc3Aubm9kZWpzLm9yZy8wKAYIKwYBBQUHMAKGHGh0dHA6Ly9jYS5ub2RlanMub3Jn\nL2NhLmNlcnQwDQYJKoZIhvcNAQELBQADggEBAMM0mBBjLMt9pYXePtUeNO0VTw9y\nFWCM8nAcAO2kRNwkJwcsispNpkcsHZ5o8Xf5mpCotdvziEWG1hyxwU6nAWyNOLcN\nG0a0KUfbMO3B6ZYe1GwPDjXaQnv75SkAdxgX5zOzca3xnhITcjUUGjQ0fbDfwFV5\nix8mnzvfXjDONdEznVa7PFcN6QliFUMwR/h8pCRHtE5+a10OSPeJSrGG+FtrGnRW\nG1IJUv6oiGF/MvWCr84REVgc1j78xomGANJIu2hN7bnD1nEMON6em8IfnDOUtynV\n9wfWTqiQYD5Zifj6WcGa0aAHMuetyFG4lIfMAHmd3gaKpks7j9l26LwRPvI=\n-----END CERTIFICATE-----\n");
const otherPublicTestCertificate=new X509Certificate("-----BEGIN CERTIFICATE-----\nMIIDgzCCAmsCFF3cqhUsBYLNh3bCVatENxZcoY7rMA0GCSqGSIb3DQEBCwUAMH0x\nCzAJBgNVBAYTAlVTMQswCQYDVQQIDAJDQTELMAkGA1UEBwwCU0YxDzANBgNVBAoM\nBkpveWVudDEQMA4GA1UECwwHTm9kZS5qczEPMA0GA1UEAwwGYWdlbnQyMSAwHgYJ\nKoZIhvcNAQkBFhFyeUB0aW55Y2xvdWRzLm9yZzAgFw0yMjA5MDMxNDQ2NTFaGA8y\nMjk2MDYxNzE0NDY1MVowfTELMAkGA1UEBhMCVVMxCzAJBgNVBAgMAkNBMQswCQYD\nVQQHDAJTRjEPMA0GA1UECgwGSm95ZW50MRAwDgYDVQQLDAdOb2RlLmpzMQ8wDQYD\nVQQDDAZhZ2VudDIxIDAeBgkqhkiG9w0BCQEWEXJ5QHRpbnljbG91ZHMub3JnMIIB\nIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAvqt/4KDehQLLDH+I2KXOxg4G\nWfNBISWmKlExPBfz9i1LY/rwoRwryv3Lpr40M05Dx+Rt4LMC+If7NGvrV8hdNSOz\njW7P7R6upVdNXpeZDmHvhq+G/xv+x/Hdv3+Sdm/JC8TD2HRYcHSSWsirRbfA9eJe\nL0ADh1mJGNpWS+9FNXtbR3LRWsRwNjP1Lb39tXIsfHiWrJ/F6yAhWOU+ZZvvjazp\nbZX7Kes0lxVtyWCzLFpnzYa/gajGLdGJwTrfKXsSz2wk6szKlbO0mzX0aHviPRPT\nftUVs91qORJ8tkAU4u78bpV0eCM8tVJh/N/oSm7ysLUjxhJrfNxHmmkGyaRL/QID\nAQABMA0GCSqGSIb3DQEBCwUAA4IBAQA+94z0pI0JEU1dX4bHGkhP6hwmv5tu7KlA\nR0hK33pF+boiagbySHrXW/y119VLp+o1FjuOlS4ETgAjcIjN2dDmJc0JEj6jnXyc\n4IYhRMDg4INAnmXX9bdCmpYuvhw/73cuxkdkMxH8p4O7v5HSqfpwjTEX8tWtpeMI\nIZ4+H/ddOKyvF3SO8lfrYJ7TXyypWfxzEiBuJnhZgpMG7zpZMGIzTkcN9VFTCv8d\nDCW0Lr2Ix/GY7nf/R9zDFnEZTW6IIkRp9UsUdOrgqgfSxp/C48foFv7gqMO/9PD8\nE8uE8986AFd5cK67imYPspHXv5UycySifwsSixi0hI9lDZqUIoWH\n-----END CERTIFICATE-----\n");

test('PFX identity accepts the actual static fixture leaf without a connection',()=>{
  const options=assertLocalPfxIdentity(publicTestPfx,'sample',publicTestCertificate);
  assert.equal(options.pfx,publicTestPfx);
  assert.equal(options.minVersion,'TLSv1.2');
});
test('PFX identity rejects an independently valid but different declared certificate',()=>{
  assert.throws(()=>assertLocalPfxIdentity(publicTestPfx,'sample',otherPublicTestCertificate),
    {message:'LOCAL_TLS_PFX_IDENTITY_REJECTED'});
});
test('PFX parser failures stay sanitized',()=>{
  for(const [pfx,passphrase] of [[Buffer.from('NOT_A_PFX'),'SYNTHETIC_SECRET'],[publicTestPfx,'WRONG_SECRET']]){
    assert.throws(()=>assertLocalPfxIdentity(pfx,passphrase,publicTestCertificate),
      {message:'LOCAL_TLS_PFX_IDENTITY_REJECTED'});
  }
});

test('local market scope is opt-in and legacy mode performs no TLS read',()=>{
  assert.equal(assertLocalMarketMode({},config()),false);
  assert.equal(loadLocalTls({},config(),{readProtected(){throw Error('unexpected read');}}),null);
  const server=createDashboardServer(()=>{}, {}, config());
  assert.ok(server instanceof http.Server); server.close();
});
test('local market scope accepts only explicit disabled AI and loopback',()=>assert.equal(assertLocalMarketMode(env(),config()),true));
test('local scope rejects managed configuration before any managed file read',()=>{
  const child={...process.env,NODE_OPTIONS:'',DASHBOARD_RELEASE_SCOPE:'MARKET_RESEARCH_AI_DISABLED',
    CRU55_ACCEPTANCE_CONFIG:path.resolve('nonexistent-must-not-be-opened.json')};
  const result=spawnSync(process.execPath,['--input-type=module','-e',
    `await import(${JSON.stringify(new URL('../src/config.mjs',import.meta.url).href)})`],
    {env:child,encoding:'utf8',windowsHide:true,timeout:10000});
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/LOCAL_MARKET_MODE_REJECTED/);
  assert.doesNotMatch(result.stderr,/ENOENT/);
});
for(const [name,patch] of Object.entries({publicHost:{host:'0.0.0.0'},foreignPort:{port:8790},development:{nodeEnv:'development'},
  insecureCookie:{cookieSecure:false},mock:{mockData:true},proxy:{trustProxy:true},candidate:{cru55Candidate:true},acceptance:{cru55Acceptance:{}}}))
  test('local market scope rejects '+name,()=>assert.throws(()=>assertLocalMarketMode(env(),{...config(),...patch})));
for(const [name,patch] of Object.entries({unknownScope:{DASHBOARD_RELEASE_SCOPE:'OTHER'},enabledAI:{ASK_GPT_INLINE_ENABLED:'1'},
  absentAI:{ASK_GPT_INLINE_ENABLED:undefined},preview:{DASHBOARD_PREVIEW_TYPE:'CRU21_OWNER_PREVIEW'},guest:{CRU21_GUEST_ENABLED:'1'},
  disabledTls:{NODE_TLS_REJECT_UNAUTHORIZED:'0'},nodePreload:{NODE_OPTIONS:'--require=unexpected'},
  boundRuntime:{CRU55_RUNTIME_BINDING:'unexpected'},dynamicRoot:{CRU55_DYNAMIC_ROOT:'unexpected'},
  lowerCaseDynamicRoot:{cru55_dynamic_root:'unexpected'},lowerCaseForwardRoot:{forward_shadow_runtime_root:'unexpected'},
  forwardRoot:{FORWARD_SHADOW_RUNTIME_ROOT:'unexpected'},uncBundle:{DASHBOARD_TLS_BUNDLE:'//server/share/tls.dpapi'},
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

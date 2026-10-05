import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {configurePlanTransport} from '../src/chatgpt-plan-transport.mjs';
import {publicError} from '../src/chatgpt-plan-auth.mjs';

test('Windows transport adds only OS-trusted CAs to existing defaults in the setup process',()=>{
  const calls=[];
  const tlsApi={getCACertificates:type=>{calls.push(type);return type==='default'?['bundled-ca','shared-ca']:['system-ca','shared-ca'];},setDefaultCACertificates:certs=>calls.push(certs)};
  const result=configurePlanTransport({platform:'win32',env:{},tlsApi});
  assert.deepEqual(calls,['default','system',['bundled-ca','shared-ca','system-ca']]);
  assert.equal(result.verificationRequired,true);
  assert.equal(result.policy,'WINDOWS_SYSTEM_AND_NODE_DEFAULT_CA');
});
test('transport refuses disabled TLS and never changes the operating system or caller environment',()=>{
  const env={NODE_TLS_REJECT_UNAUTHORIZED:'0'};
  assert.throws(()=>configurePlanTransport({platform:'win32',env,tlsApi:{}}),/TLS_VERIFICATION_DISABLED/);
  assert.deepEqual(env,{NODE_TLS_REJECT_UNAUTHORIZED:'0'});
  assert.throws(()=>configurePlanTransport({platform:'win32',env:{},tlsApi:{}}),/SYSTEM_CA_RUNTIME_UNSUPPORTED/);
});
test('other platforms preserve Node default trust without Windows changes',()=>{
  let touched=false;
  const result=configurePlanTransport({platform:'linux',env:{},tlsApi:{setDefaultCACertificates:()=>{touched=true;}}});
  assert.equal(result.policy,'NODE_DEFAULT_CA');assert.equal(touched,false);
});
test('network error codes are actionable but raw upstream diagnostics never escape',()=>{
  const privateDetail='do-not-publish-upstream-detail';
  assert.equal(publicError(new TypeError(privateDetail,{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN',message:privateDetail}})),'UPSTREAM_TLS_UNTRUSTED');
  assert.equal(publicError(new TypeError(privateDetail,{cause:{code:'ENOTFOUND',message:privateDetail}})),'UPSTREAM_CONNECTION_FAILED');
  assert.equal(publicError(new Error(privateDetail)),'REQUEST_FAILED');
});
test('setup launcher configures trust before the listener and notice is adjacent to sign-in',()=>{
  const launcher=fs.readFileSync(new URL('../scripts/start-chatgpt-plan-preflight.mjs',import.meta.url),'utf8');
  assert.ok(launcher.indexOf('configurePlanTransport();')<launcher.indexOf('app=await startPlanSetup('));
  const html=fs.readFileSync(new URL('../tools/chatgpt-plan-setup/index.html',import.meta.url),'utf8');
  assert.equal((html.match(/id="notice"/g)||[]).length,1);
  assert.ok(html.indexOf('id="notice"')>html.indexOf('id="connect"'));
  assert.ok(html.indexOf('id="notice"')<html.indexOf('id="active"'));
});

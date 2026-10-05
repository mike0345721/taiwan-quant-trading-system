// Synthetic callback lifecycle only. Never submits a real authorization code.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { startPlanSetup } from '../src/chatgpt-plan-setup.mjs';
import { DIRECT_SCOPE, PlanError } from '../src/chatgpt-plan-auth.mjs';
async function fixture(t, exchange) {
  const rows=new Map(), receipts=[]; let exchanged=0, cookie='', csrf='';
  const store={hostId:'urn:uuid:'+randomUUID(),list:()=>[...rows].map(([key])=>({key,label:'Synthetic account'})),get:key=>rows.get(key)||null,save:r=>{rows.set('a'.repeat(64),r);return 'a'.repeat(64);}};
  const app=await startPlanSetup({store,port:0,lifetimeMs:60000,onReceipt:r=>receipts.push(r),operations:{discovery:async()=>{},exchangeAuthorization:async tx=>{exchanged++;if(exchange)return exchange(tx);return{issuer:'https://auth.openai.com',client_id:tx.clientId,subject:'fixture',access_token:randomUUID(),scopes:[DIRECT_SCOPE,'resource.invoke'],expiresAt:Date.now()+3600000};},listPlanModels:async()=>{throw Error('UNEXPECTED_MODEL_REQUEST');},probePlanInference:async()=>{throw Error('UNEXPECTED_INFERENCE');}}});
  t.after(()=>app.close());
  async function req(route,body){return fetch(app.origin+route,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{Cookie:cookie,...(body===undefined?{}:{Origin:app.origin,'Content-Type':'application/json','X-CSRF-Token':csrf})},body:body===undefined?undefined:JSON.stringify(body)});}
  const boot=await req('/api/bootstrap',{capability:new URL(app.launchUrl).hash.slice(1)});
  cookie=boot.headers.get('set-cookie').split(';')[0];csrf=(await (await req('/api/status')).json()).csrf;
  const status=async()=> (await req('/api/status')).json();
  async function begin(){const r=await (await req('/api/authorize',{})).json();assert.equal(r.ok,true);const auth=new URL(r.authorizationUrl);const callback=new URL('/auth/callback',app.origin);callback.search=new URLSearchParams({state:auth.searchParams.get('state'),code:'synthetic-code-'+randomUUID(),client_id:'oaiapp_fixture1'}).toString();return callback.pathname+callback.search;}
  return{app,req,status,begin,receipts,count:()=>exchanged};
}
async function redirected(response){assert.equal(response.status,303);assert.equal(response.headers.get('location'),'/');assert.equal(response.headers.get('cache-control'),'no-store');assert.equal(response.headers.get('referrer-policy'),'no-referrer');assert.equal(await response.text(),'');}
test('cancelled callback returns to clean setup, never exchanges, and permits a new explicit attempt',async t=>{
  const s=await fixture(t),cb=await s.begin();let state=await s.status();
  const cancel=await s.req('/api/cancel',{confirmed:true,attemptId:state.pendingAttemptId});assert.equal(cancel.status,200);
  await redirected(await s.req(cb));state=await s.status();assert.equal(state.phase,'AUTHORIZATION_CANCELLED');assert.equal(state.callbackNotice,'AUTHORIZATION_CANCELLED');assert.equal(state.directPermission,false);assert.equal(s.count(),0);
  const fresh=await s.begin();assert.notEqual(fresh,cb);await redirected(await s.req(fresh));assert.equal((await s.status()).directPermission,true);assert.equal(s.count(),1);
  const evidence=JSON.stringify(s.receipts);assert.equal(evidence.includes(new URL(s.app.origin+cb).searchParams.get('code')),false);
});
test('cancel requires explicit confirmation and exact local attempt identity, not a stale tab',async t=>{
  const s=await fixture(t),cb=await s.begin();const current=await s.status();assert.ok(current.pendingAttemptId);
  assert.equal((await s.req('/api/cancel',{})).status,400);
  assert.equal((await s.req('/api/cancel',{confirmed:true,attemptId:'stale-tab'})).status,400);
  assert.equal((await s.status()).phase,'WAITING_FOR_OWNER_SIGN_IN');await redirected(await s.req(cb));assert.equal(s.count(),1);
});
test('a second sign-in cannot silently replace a pending attempt',async t=>{
  const s=await fixture(t),cb=await s.begin();const second=await s.req('/api/authorize',{});assert.equal(second.status,400);assert.equal((await second.json()).error,'AUTH_ATTEMPT_IN_PROGRESS');assert.equal((await s.status()).phase,'WAITING_FOR_OWNER_SIGN_IN');await redirected(await s.req(cb));assert.equal(s.count(),1);
});
test('duplicate successful callback never re-exchanges or invalidates the verified account',async t=>{
  const s=await fixture(t),cb=await s.begin();await redirected(await s.req(cb));await redirected(await s.req(cb));const state=await s.status();assert.equal(s.count(),1);assert.equal(state.directPermission,true);assert.equal(state.phase,'AUTHORIZED_MODEL_NOT_TESTED');assert.equal(state.callbackNotice,'AUTH_RETURN_ALREADY_HANDLED');
});
test('callback with missing attempt recovers without provider or model calls',async t=>{
  const s=await fixture(t);await redirected(await s.req('/auth/callback?state=unused&code=synthetic'));const state=await s.status();assert.equal(state.callbackNotice,'AUTH_ATTEMPT_MISSING_OR_USED');assert.equal(state.directPermission,false);assert.equal(s.count(),0);
});
test('mismatched state does not clear the correct pending attempt',async t=>{
  const s=await fixture(t),cb=await s.begin();const wrong=new URL(s.app.origin+cb);wrong.searchParams.set('state','mismatch');await redirected(await s.req(wrong.pathname+wrong.search));let state=await s.status();assert.equal(state.callbackNotice,'AUTH_STATE_MISMATCH');assert.equal(state.phase,'WAITING_FOR_OWNER_SIGN_IN');assert.equal(s.count(),0);await redirected(await s.req(cb));assert.equal(s.count(),1);assert.equal((await s.status()).callbackNotice,null);
});
test('first callback validation failure is retained; refreshing cannot exchange a consumed code',async t=>{
  const s=await fixture(t),cb=await s.begin();const missing=new URL(s.app.origin+cb);missing.searchParams.delete('client_id');await redirected(await s.req(missing.pathname+missing.search));let state=await s.status();assert.equal(state.phase,'AUTHORIZATION_FAILED');assert.equal(state.reason,'ISSUED_CLIENT_ID_MISSING');assert.equal(s.count(),0);await redirected(await s.req(cb));state=await s.status();assert.equal(state.reason,'ISSUED_CLIENT_ID_MISSING');assert.equal(s.count(),0);
});
test('failed exchange stays failed and duplicate callback does not retry upstream',async t=>{
  const s=await fixture(t,async()=>{throw new PlanError('AUTHENTICATION_REJECTED');}),cb=await s.begin();await redirected(await s.req(cb));await redirected(await s.req(cb));const state=await s.status();assert.equal(state.phase,'AUTHORIZATION_FAILED');assert.equal(state.reason,'AUTHENTICATION_REJECTED');assert.equal(s.count(),1);assert.equal(state.directPermission,false);
});
test('callback without setup session removes code from displayed URL but grants nothing',async t=>{
  const s=await fixture(t),cb=await s.begin();await redirected(await fetch(s.app.origin+cb,{redirect:'manual'}));assert.equal((await s.status()).phase,'WAITING_FOR_OWNER_SIGN_IN');assert.equal(s.count(),0);
});
test('concurrent duplicate callback cannot interrupt an in-flight exchange',async t=>{
  let release;const wait=new Promise(r=>{release=r;});
  const s=await fixture(t,async tx=>{await wait;return{issuer:'https://auth.openai.com',client_id:tx.clientId,subject:'fixture',access_token:randomUUID(),scopes:[DIRECT_SCOPE,'resource.invoke'],expiresAt:Date.now()+3600000};});
  const cb=await s.begin(),first=s.req(cb);try{for(let i=0;i<40&&s.count()===0;i++)await new Promise(r=>setTimeout(r,5));assert.equal(s.count(),1);await redirected(await s.req(cb));assert.equal((await s.status()).phase,'VALIDATING_AUTHORIZATION');}finally{release();await redirected(await first);}assert.equal(s.count(),1);assert.equal((await s.status()).directPermission,true);
});

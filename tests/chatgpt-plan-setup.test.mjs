import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {startPlanSetup} from '../src/chatgpt-plan-setup.mjs';
import {DIRECT_SCOPE} from '../src/chatgpt-plan-auth.mjs';
const accountKey='a'.repeat(64);
const syntheticBearer=randomUUID();
function memoryStore(){const rows=new Map();return{hostId:'urn:uuid:'+randomUUID(),get:key=>rows.get(key)||null,list:()=>[...rows].map(([key,r])=>({key,label:'Fixture account',expiresAt:r.expiresAt})),save:r=>{rows.set(accountKey,r);return accountKey;}};}
async function setup(t,overrides={}){
 const calls={inference:0,models:0,discovery:0},receipts=[];
 const app=await startPlanSetup({store:memoryStore(),port:0,lifetimeMs:60000,onReceipt:r=>receipts.push(r),operations:{discovery:async()=>{calls.discovery++;},exchangeAuthorization:async tx=>({issuer:'https://auth.openai.com',subject:'fixture-user',client_id:tx.clientId,access_token:syntheticBearer,scopes:[DIRECT_SCOPE,'resource.invoke'],expiresAt:Date.now()+3600000}),listPlanModels:async()=>{calls.models++;return[{slug:'fixture-model',display_name:'Fixture'}];},probePlanInference:async()=>{calls.inference++;return{text:'測試完成',model:'fixture-model',terminal:'response.completed',requestId:'fixture-request',usage:{input_tokens:5,output_tokens:3}};},...overrides}});
 t.after(()=>app.close());let cookie='',csrf='';
 async function request(path,body,headers={}){const res=await fetch(app.origin+path,{redirect:'manual',method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body!==undefined?{Origin:app.origin,'Content-Type':'application/json','X-CSRF-Token':csrf}:{}),...headers},body:body===undefined?undefined:JSON.stringify(body)});return res;}
 async function bootstrap(){const res=await request('/api/bootstrap',{capability:new URL(app.launchUrl).hash.slice(1)});assert.equal(res.status,200);cookie=res.headers.get('set-cookie').split(';')[0];const data=await (await request('/api/status')).json();csrf=data.csrf;return data;}
 async function authorize(){const body=await (await request('/api/authorize',{})).json();assert.ok(body.ok);const auth=new URL(body.authorizationUrl);const callback=new URL('/auth/callback',app.origin);for(const[k,v]of Object.entries({state:auth.searchParams.get('state'),code:'fixture-code',client_id:'oaiapp_fixture1'}))callback.searchParams.set(k,v);const res=await request(callback.pathname+callback.search);assert.equal(res.status,303);assert.equal(res.headers.get('location'),'/');}
 return{app,calls,receipts,request,bootstrap,authorize};
}
test('opening setup does not call models or inference; bootstrap/session are mandatory',async t=>{
 const s=await setup(t);const root=await s.request('/');assert.equal(root.status,200);assert.match(root.headers.get('content-security-policy'),/frame-ancestors 'none'/);assert.equal((await s.request('/api/status')).status,401);const state=await s.bootstrap();assert.equal(state.phase,'AUTHORIZATION_REQUIRED');assert.deepEqual(s.calls,{inference:0,models:0,discovery:0});
 const replay=await s.request('/api/bootstrap',{capability:new URL(s.app.launchUrl).hash.slice(1)});assert.equal(replay.status,400);
});
test('cross-origin, wrong Host and missing CSRF cannot initiate authorization or model calls',async t=>{
 const s=await setup(t);await s.bootstrap();assert.equal((await s.request('/api/authorize',{}, {Origin:'https://example.invalid'})).status,400);assert.equal((await s.request('/api/authorize',{}, {'X-CSRF-Token':'wrong'})).status,400);const wrongHostStatus=await new Promise((resolve,reject)=>{http.get(s.app.origin+'/api/status',{headers:{Host:'example.invalid'}},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));}).on('error',reject);});assert.equal(wrongHostStatus,400);assert.equal(s.calls.discovery,0);assert.equal(s.calls.inference,0);
});
test('official authorization flow stores identity but does not automatically infer',async t=>{
 const s=await setup(t);await s.bootstrap();await s.authorize();const state=await (await s.request('/api/status')).json();assert.equal(state.phase,'AUTHORIZED_MODEL_NOT_TESTED');assert.equal(state.directPermission,true);assert.equal(s.calls.inference,0);const serialized=JSON.stringify(state);assert.equal(serialized.includes(syntheticBearer),false);assert.equal(serialized.includes('access_token'),false);assert.equal(JSON.stringify(s.receipts).includes(syntheticBearer),false);
});
test('setup permission flag requires both direct and resource scopes',async t=>{
 const s=await setup(t,{exchangeAuthorization:async tx=>({issuer:'https://auth.openai.com',subject:'fixture-user',client_id:tx.clientId,access_token:syntheticBearer,scopes:[DIRECT_SCOPE],expiresAt:Date.now()+3600000})});
 await s.bootstrap();await s.authorize();const state=await (await s.request('/api/status')).json();assert.equal(state.phase,'IDENTITY_ONLY_PLAN_NOT_GRANTED');assert.equal(state.directPermission,false);assert.equal(s.calls.models,0);assert.equal(s.calls.inference,0);
});
test('a request with valid cookie but no permission cannot list models or test',async t=>{
 const s=await setup(t);await s.bootstrap();assert.equal((await s.request('/api/models',{})).status,400);assert.equal((await s.request('/api/probe',{model:'fixture-model',creditsDisabledConfirmed:true})).status,400);assert.equal(s.calls.models,0);assert.equal(s.calls.inference,0);
});
test('manual credits confirmation and live catalog selection are required; only one probe per session',async t=>{
 const s=await setup(t);await s.bootstrap();await s.authorize();await s.request('/api/models',{});
 const denied=await s.request('/api/probe',{model:'fixture-model'});assert.equal((await denied.json()).error,'CREDITS_SETTING_CONFIRMATION_REQUIRED');assert.equal(s.calls.inference,0);
 const wrong=await s.request('/api/probe',{model:'invented-model',creditsDisabledConfirmed:true});assert.equal((await wrong.json()).error,'MODEL_NOT_IN_ACCOUNT_CATALOG');
 assert.equal((await s.request('/api/probe',{model:'fixture-model',creditsDisabledConfirmed:true})).status,200);const state=await (await s.request('/api/status')).json();assert.equal(state.result.text,'測試完成');assert.equal(state.phase,'CONNECTIVITY_PROBE_COMPLETED');assert.equal(s.calls.inference,1);
 const repeat=await s.request('/api/probe',{model:'fixture-model',creditsDisabledConfirmed:true});assert.equal((await repeat.json()).error,'PROBE_ALREADY_USED');assert.equal(s.calls.inference,1);
});
test('model failure is explicit and never retried or routed to a paid backend',async t=>{
 const s=await setup(t,{probePlanInference:async()=>{throw new Error('fixture upstream secret must stay private');}});await s.bootstrap();await s.authorize();await s.request('/api/models',{});await s.request('/api/probe',{model:'fixture-model',creditsDisabledConfirmed:true});const state=await (await s.request('/api/status')).json();assert.equal(state.phase,'REQUEST_FAILED');assert.equal(state.reason,'REQUEST_FAILED');assert.equal(state.probeAttempted,true);assert.equal(state.result,null);assert.equal(JSON.stringify(state).includes('upstream secret'),false);
});
test('setup refuses production service ports',async()=>{for(const port of [8787,8790,8791])await assert.rejects(startPlanSetup({store:memoryStore(),port}),/SETUP_PORT_REJECTED/);});

test('an occupied setup port fails before protected-store initialization',async t=>{
 const existing=await setup(t);let initialized=0;
 await assert.rejects(startPlanSetup({port:existing.app.server.address().port,initializeStore:()=>{initialized++;return memoryStore();}}),error=>error.code==='EADDRINUSE');assert.equal(initialized,0);
});
test('an unrelated unauthenticated request cannot overwrite the pending authorization phase',async t=>{
 const s=await setup(t);await s.bootstrap();await s.request('/api/authorize',{});await fetch(s.app.origin+'/unrelated-route');const state=await (await s.request('/api/status')).json();assert.equal(state.phase,'WAITING_FOR_OWNER_SIGN_IN');
});

test('anonymous discovery TLS failure is persisted before sign-in with no model request',async t=>{
 const s=await setup(t,{discovery:async()=>{throw new TypeError('private diagnostic',{cause:{code:'SELF_SIGNED_CERT_IN_CHAIN'}});}});
 await s.bootstrap();const res=await s.request('/api/authorize',{});assert.equal(res.status,400);
 const state=await (await s.request('/api/status')).json();
 assert.equal(state.phase,'AUTHORIZATION_FAILED');assert.equal(state.reason,'UPSTREAM_TLS_UNTRUSTED');
 assert.equal(s.calls.models,0);assert.equal(s.calls.inference,0);
 assert.equal(JSON.stringify(s.receipts).includes('private diagnostic'),false);
});
test('discovery preparing state is observable while the bounded request is pending',async t=>{
 let release;const waiting=new Promise(resolve=>{release=resolve;});
 const s=await setup(t,{discovery:()=>waiting});await s.bootstrap();
 const pending=s.request('/api/authorize',{});
 try {let state;for(let i=0;i<40;i++){state=await (await s.request('/api/status')).json();if(state.busy)break;await new Promise(r=>setTimeout(r,5));}
 assert.equal(state.phase,'PREPARING_AUTHORIZATION');assert.equal(state.busy,true);
 }finally{release();await pending;}
});

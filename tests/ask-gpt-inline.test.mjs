// All providers and credentials here are synthetic; no network or formal data.
import test from 'node:test';import assert from 'node:assert/strict';
import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import http from 'node:http';
import {randomUUID,generateKeyPairSync,sign} from 'node:crypto';
import {createProtectedPlanStore,registrationKey} from '../src/chatgpt-plan-store.mjs';
import {ISSUER,RESOURCE,DIRECT_SCOPE,PlanError,validateIdToken} from '../src/chatgpt-plan-auth.mjs';
import {freshPlanRecord,planCatalog,readAnalysisStream,analysePlan} from '../src/chatgpt-plan-inference.mjs';
import {createDecisionSnapshot,decisionDigest} from '../src/dashboard-decision-workspace.mjs';
import {buildInlineContext} from '../src/ask-gpt-inline-context.mjs';
import {InlineAssistant} from '../src/ask-gpt-inline-service.mjs';import{createInlineHandler}from'../src/ask-gpt-inline-http.mjs';
const temp=t=>{const p=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-inline-test-'));t.after(()=>fs.rmSync(p,{recursive:true,force:true}));return p;};
const scopes=[DIRECT_SCOPE,'resource.invoke'];
const account=()=>({issuer:ISSUER,client_id:'oaiapp_synthetic1',subject:'synthetic-user',email:'test@example.invalid',access_token:randomUUID(),refresh_token:randomUUID(),id_token:'header.'+Buffer.from(JSON.stringify({nonce:'synthetic-nonce'})).toString('base64url')+'.signature',scopes,expiresAt:Date.now()+3600000});
const storeAt=dir=>createProtectedPlanStore({dir,encrypt:s=>Buffer.from(s).toString('base64'),decrypt:s=>Buffer.from(s,'base64').toString('utf8')});
const response=(body,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});
function snap(){return createDecisionSnapshot({dataHealth:{items:[],overall:'PARTIAL',unavailableCount:0,staleCount:0},chart:{lastPrice:100,source:'TEST_ONLY',availableAt:new Date(Date.now()-1000).toISOString(),tradeDate:'2026-10-05',actualContract:'TXFJ6',session:'DAY',bars:[]}});}
function createJwt(payload){const{publicKey,privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const a=Buffer.from(JSON.stringify({alg:'RS256',kid:'test'})).toString('base64url'),b=Buffer.from(JSON.stringify(payload)).toString('base64url');return{jwt:a+'.'+b+'.'+sign('RSA-SHA256',Buffer.from(a+'.'+b),privateKey).toString('base64url'),jwks:{keys:[{...publicKey.export({format:'jwk'}),kid:'test',alg:'RS256'}]}};}
const events=rows=>new Response(rows.map(e=>'data: '+JSON.stringify(e)+'\n\n').join('')).body;
const done={type:'response.completed',response:{id:'resp_synthetic',status:'completed',model:'test-model',usage:{input_tokens:4,output_tokens:3,total_tokens:7,output_tokens_details:{reasoning_tokens:0}}}};
const delta=text=>({type:'response.output_text.delta',delta:text});

test('protected store merges separate writers and serializes rotating refresh across instances',async t=>{
 const p=temp(t),a=storeAt(p),b=storeAt(p),r=account(),key=a.save(r);b.save({...account(),subject:'second'});a.reload();assert.equal(a.list().length,2);
 let release;const wait=new Promise(r=>release=r),first=a.updateExclusive(key,async old=>{await wait;return{record:{...old,access_token:'rotated'},result:'ok'};});
 await assert.rejects(b.updateExclusive(key,async()=>({result:'bad'})),/CREDENTIAL_STORE_BUSY/);release();assert.equal(await first,'ok');b.reload();assert.equal(b.get(key).access_token,'rotated');
 assert.equal(fs.existsSync(path.join(p,'siwc-v1.writer-lock')),false);
});
test('protected store preserves unrelated account and rejects wrong identity replacement',async t=>{
 const s=storeAt(temp(t)),r=account(),k=s.save(r);await assert.rejects(s.updateExclusive(k,async old=>({record:{...old,subject:'wrong'}})),/REFRESH_ACCOUNT_MISMATCH/);assert.equal(s.get(k).subject,r.subject);
});
test('token refresh uses issued client and atomically rotates tokens without scope expansion',async t=>{
 const s=storeAt(temp(t)),r=account();r.expiresAt=Date.now()-1000;const key=s.save(r);let calls=0;
 const order=[];const result=await freshPlanRecord(s,key,{fetcher:async(url,opts={})=>{calls++;order.push(url);if(url.endsWith('/.well-known/jwks.json'))return response({keys:[]});assert.equal(url,ISSUER+'/api/accounts/oauth/token');assert.equal(opts.body.get('client_id'),r.client_id);assert.equal(opts.body.get('grant_type'),'refresh_token');assert.equal(opts.body.get('resource'),RESOURCE);assert.equal(opts.body.has('scope'),false);return response({token_type:'Bearer',access_token:'new-access',refresh_token:'new-refresh',expires_in:3600});}});
 assert.deepEqual(order,[ISSUER+'/.well-known/jwks.json',ISSUER+'/api/accounts/oauth/token']);assert.equal(calls,2);assert.equal(result.access_token,'new-access');s.reload();assert.equal(s.get(key).refresh_token,'new-refresh');assert.deepEqual(s.get(key).scopes,scopes);
});

test('refresh cancellation before rotating token endpoint preserves old refresh token and never consumes it',async t=>{
 const s=storeAt(temp(t)),r=account();r.expiresAt=0;const k=s.save(r),controller=new AbortController();let tokenCalls=0;
 await assert.rejects(freshPlanRecord(s,k,{signal:controller.signal,fetcher:async url=>{if(url.endsWith('/.well-known/jwks.json')){controller.abort();throw Object.assign(new Error('cancel'),{name:'AbortError'});}tokenCalls++;return response({});}}));
 assert.equal(tokenCalls,0);s.reload();assert.equal(s.get(k).refresh_token,r.refresh_token);
});
test('cancellation after a rotating token response cannot lose the replacement refresh token',async t=>{
 const s=storeAt(temp(t)),r=account();r.expiresAt=0;r.originalNonce='synthetic-nonce';const k=s.save(r),controller=new AbortController(),now=Date.now();
 const {jwt,jwks}=createJwt({iss:ISSUER,aud:r.client_id,sub:r.subject,iat:Math.floor(now/1000)-1,exp:Math.floor(now/1000)+3600});
 let calls=0;const result=await freshPlanRecord(s,k,{now,signal:controller.signal,fetcher:async url=>{calls++;if(url.endsWith('/.well-known/jwks.json'))return response(jwks);controller.abort('owner-cancel');return response({token_type:'Bearer',access_token:'new-access',refresh_token:'new-refresh',id_token:jwt,expires_in:3600});}});
 assert.equal(calls,2);assert.equal(controller.signal.aborted,true);assert.equal(result.refresh_token,'new-refresh');s.reload();assert.equal(s.get(k).refresh_token,'new-refresh');assert.equal(s.get(k).access_token,'new-access');
});
test('stream completion without a verified actual model is rejected',async()=>{
 const missing={type:'response.completed',response:{id:'resp_missing',status:'completed',usage:{input_tokens:1,output_tokens:1,total_tokens:2}}};
 await assert.rejects(readAnalysisStream(events([delta('text'),missing])),/MODEL_TERMINAL_INVALID/);
});
test('fresh token does not cause an unnecessary refresh or model call',async t=>{
 const s=storeAt(temp(t)),r=account(),key=s.save(r);const result=await freshPlanRecord(s,key,{fetcher:()=>{throw Error('UNEXPECTED_NETWORK');}});assert.equal(result.access_token,r.access_token);
});
test('terminal refresh rejection clears unusable credentials but retains client/account mapping',async t=>{
 const s=storeAt(temp(t)),r=account();r.expiresAt=0;const k=s.save(r);
 let call=0;await assert.rejects(freshPlanRecord(s,k,{fetcher:async()=>{call++;return call===1?response({keys:[]}):response({error:'invalid_grant'},400);}}),/REAUTHORIZE_REQUIRED/);assert.equal(call,2);s.reload();assert.equal(s.get(k).refresh_token,null);assert.equal(s.get(k).client_id,r.client_id);
});
test('transient refresh failure preserves saved credentials without retries',async t=>{
 const s=storeAt(temp(t)),r=account();r.expiresAt=0;const k=s.save(r);let calls=0;
 await assert.rejects(freshPlanRecord(s,k,{fetcher:async()=>{calls++;throw new TypeError('network');}}));assert.equal(calls,1);s.reload();assert.equal(s.get(k).refresh_token,r.refresh_token);
});
test('earliest refresh boundary prevents an early request',async t=>{
 const s=storeAt(temp(t)),r=account();r.expiresAt=Date.now()+60000;r.earliestRefreshAt=Date.now()+30000;const k=s.save(r);await assert.rejects(freshPlanRecord(s,k,{fetcher:()=>{throw Error('NETWORK');}}),/REFRESH_NOT_YET_ALLOWED/);
});
test('refresh ID token permits omitted nonce only with bound validated subject; sign-in remains strict',()=>{
 const n=Date.now(),payload={iss:ISSUER,aud:'oaiapp_synthetic1',sub:'synthetic-user',iat:Math.floor(n/1000)-1,exp:Math.floor(n/1000)+3600};const{jwt,jwks}=createJwt(payload);
 assert.equal(validateIdToken(jwt,jwks,{clientId:payload.aud,expectedSubject:payload.sub,oidcNonce:'old',refresh:true,now:n}).subject,payload.sub);
 assert.throws(()=>validateIdToken(jwt,jwks,{clientId:payload.aud,oidcNonce:'old',now:n}),/NONCE_OR_ACCOUNT/);
 assert.throws(()=>validateIdToken(jwt,jwks,{clientId:payload.aud,expectedSubject:'other',refresh:true,now:n}),/NONCE_OR_ACCOUNT/);
});
test('catalog only lists account-visible models, never invents aliases',async()=>{
 const models=await planCatalog(account(),{fetcher:async(url)=>{assert.equal(url,RESOURCE+'/models');return response({models:[{slug:'valid',display_name:'Visible',visibility:'list'},{slug:'hidden',display_name:'Hidden',visibility:'hide'}]});}});assert.deepEqual(models,[{slug:'valid',display_name:'Visible'}]);
});
test('stream needs complete terminal and preserves multibyte fragmented text',async()=>{
 const bytes=Buffer.from([delta('中文回覆'),done].map(e=>'data: '+JSON.stringify(e)+'\r\n\r\n').join(''));
 const stream=new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=1)c.enqueue(bytes.subarray(i,i+1));c.close();}});const r=await readAnalysisStream(stream);assert.equal(r.text,'中文回覆');assert.equal(r.terminal,'response.completed');assert.equal(r.usage.total_tokens,7);
 await assert.rejects(readAnalysisStream(events([delta('unfinished')])) ,/STREAM_INTERRUPTED/);
});
test('midstream quota, incomplete, refusal and tool-call events cannot be successful',async()=>{
 await assert.rejects(readAnalysisStream(events([delta('partial'),{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/PLAN_USAGE_LIMIT_REACHED/);
 for(const e of [{type:'response.incomplete'},{type:'response.refusal.delta'},{type:'response.output_item.added',item:{type:'function_call'}}])await assert.rejects(readAnalysisStream(events([e,done])));
});
test('analysis requests use only supported public subscription fields and no automatic fallback',async()=>{
 let calls=0;const r=await analysePlan(account(),'test-model',{price:null},'what?',{fetcher:async(url,o)=>{calls++;assert.equal(url,RESOURCE+'/responses');const b=JSON.parse(o.body);assert.deepEqual(Object.keys(b).sort(),['input','instructions','model','store','stream']);assert.equal(b.store,false);assert.equal(b.stream,true);assert.ok(Array.isArray(b.input));return new Response(events([delta('analysis'),done]));}});assert.equal(calls,1);assert.equal(r.text,'analysis');
});
test('HTTP model rejection keeps safe provider code and never returns secret message',async()=>{
 await assert.rejects(analysePlan(account(),'test-model',{},'q',{fetcher:async()=>response({error:{code:'subscription_sharing_usage_limit_exceeded',message:'secret-diagnostic'}},429)}),e=>e.code==='PLAN_USAGE_LIMIT_REACHED'&&!e.message.includes('secret'));
});
test('bounded context retains missing as null, safe identity and canonical hash',()=>{
 const s=snap(),r=buildInlineContext(s);assert.equal(r.context.price.value,100);assert.equal(r.context.VWAP.value,null);assert.equal(r.context.recommendation,false);assert.equal(r.snapshotHash,s.snapshotHash);assert.ok(r.inputBytes<40000);assert.equal(JSON.stringify(r).includes('access_token'),false);
});

test('bounded AI context carries only the deterministic top level watch and decision reasons',()=>{
 const now=new Date().toISOString();
 const level={id:'VWAP',family:'VWAP',label:'DAY VWAP',price:100,state:'TESTING',side:'ABOVE',distancePoints:2,absoluteDistancePoints:2,movingToward:true,zonePoints:8,sourceId:'SESSION_VWAP',availableAt:now,qualityStatus:'PASS',why:'成交均價參考',watchFor:'觀察價格反應',expectedResponse:'應站穩',confirm:'價格離開',invalidate:'跌回'};
 const levelWatch={schemaVersion:'decision-level-watch-v1',state:'READY',reason:null,currentPrice:102,zonePoints:8,zoneMethod:'TEST',levels:[level],nextWatch:level,observedFlow:{sourceState:'LIVE',quality:'PASS',pressure60:.6,response60:5,availableAt:now,formalDirection:'NOT_PROMOTED'},formalWeight:0,researchOnly:true,recommendation:false,systemDirectionalSignal:false,executionAuthorized:false,orderRoutesEnabled:false};
 const s=createDecisionSnapshot({dataHealth:{items:[],overall:'PARTIAL',unavailableCount:0,staleCount:0},chart:{lastPrice:102,source:'TEST_ONLY',availableAt:now,tradeDate:'2026-10-05',actualContract:'TXFJ6',session:'DAY',bars:[]},levelWatch,snapshotTime:now});
 const c=buildInlineContext(s,{now:Date.parse(now)+1000}).context;
 assert.equal(c.levelWatch.nextWatch.price,100);assert.equal(c.levelWatch.nextWatch.why,'成交均價參考');assert.equal(c.levelWatch.levels.length,1);
 assert.equal(c.levelWatch.formalWeight,undefined);assert.equal(JSON.stringify(c.levelWatch).includes('access_token'),false);
});
test('invalid snapshot hash, future dispatch and client secret-shaped fields fail before inference',()=>{
 const s=snap();assert.throws(()=>buildInlineContext({...s,snapshotHash:'0'.repeat(64)}),/HASH_MISMATCH/);
 assert.throws(()=>buildInlineContext(s,{now:Date.parse(s.snapshotTime)-1}),/SNAPSHOT_DISPATCH_TIME_INVALID/);
 const {snapshotHash,...body}=s;body.price={...body.price,value:{access_token:'forbidden'}};assert.throws(()=>buildInlineContext({...body,snapshotHash:decisionDigest(body)}),/CONTEXT_SECRET/);
});
async function fixture(t,ops={},settings={}){
 const root=temp(t),r=account(),key=registrationKey(r);const counters={analyse:0,refresh:0,catalog:0};const store={get:k=>k===key?r:null,list:()=>[{key,label:'Test account',expiresAt:r.expiresAt}],reload:()=>{}};
 const assistant=new InlineAssistant({enabled:true,root,runtimeCommit:'a'.repeat(40),snapshotProvider:async()=>({snapshot:snap()}),storeFactory:()=>store,configureTransport:()=>{},minIntervalMs:0,operations:{freshPlanRecord:async()=>{counters.refresh++;return r;},planCatalog:async()=>{counters.catalog++;return[{slug:'test-model',display_name:'Test'}];},analysePlan:async(a,m,c,q,{onText})=>{counters.analyse++;onText('partial');return{text:'已知事實：測試',terminal:'response.completed',model:m,requestId:'resp_test',usage:{input_tokens:5,output_tokens:3,total_tokens:8}};},...ops},...settings});
 t.after(()=>assistant.close());return{assistant,root,key,counters,configuration:{storeFactory:()=>store,configureTransport:()=>{},snapshotProvider:async()=>({snapshot:snap()}),operations:assistant.ops},body:()=>({requestId:randomUUID(),account:key,model:'test-model',question:'目前盤況？',creditsDisabledConfirmed:true})};
}
test('disabled assistant never opens credential store, changes TLS or calls models',()=>{
 const a=new InlineAssistant({enabled:false,storeFactory:()=>{throw Error('STORE');},configureTransport:()=>{throw Error('TLS');}});assert.equal(a.connection().enabled,false);assert.equal(a.connection().remainingPlanQuota,null);
});
test('connection status does not invoke provider and complete receipt can be read after restart',async t=>{
 const s=await fixture(t);s.assistant.connection();assert.deepEqual(s.counters,{analyse:0,refresh:0,catalog:0});const b=s.body(),r=await s.assistant.run(b,'owner');assert.equal(r.phase,'COMPLETED');assert.equal(r.paidApiFallback,false);assert.equal(s.counters.analyse,1);assert.equal(s.assistant.read(b.requestId,'owner').text,r.text);assert.throws(()=>s.assistant.read(b.requestId,'other'),/REQUEST_NOT_FOUND/);
 const restarted=new InlineAssistant({enabled:true,root:s.root,runtimeCommit:'a'.repeat(40),...s.configuration});assert.equal(restarted.read(b.requestId,'owner').phase,'COMPLETED');
 const disk=fs.readFileSync(s.assistant.file(b.requestId),'utf8');assert.equal(disk.includes('access_token'),false);assert.equal(disk.includes('refresh_token'),false);
});
test('same request id is idempotent and repeated click never issues a second model call',async t=>{
 const s=await fixture(t),b=s.body();await s.assistant.run(b,'owner');await s.assistant.run(b,'owner');assert.equal(s.counters.analyse,1);
});
test('no credits confirmation, forged model, or client snapshot can trigger inference',async t=>{
 const s=await fixture(t);await assert.rejects(s.assistant.run({...s.body(),creditsDisabledConfirmed:false},'owner'),/CREDITS/);await assert.rejects(s.assistant.run({...s.body(),snapshot:{}},'owner'),/INVALID/);const r=await s.assistant.run({...s.body(),model:'invented'},'owner');assert.equal(r.phase,'FAILED');assert.equal(s.counters.analyse,0);
});
test('provider failure leaves partial text labelled FAILED, with no retry',async t=>{
 let calls=0;const s=await fixture(t,{analysePlan:async(a,m,c,q,{onText})=>{calls++;onText('partial');throw new PlanError('PLAN_USAGE_LIMIT_REACHED');}});const r=await s.assistant.run(s.body(),'owner');assert.equal(r.phase,'FAILED');assert.equal(r.error.code,'PLAN_USAGE_LIMIT_REACHED');assert.equal(r.text,'partial');assert.equal(calls,1);
});
test('cancelled and timed out requests persist terminal status and release single-flight lock',async t=>{
 const waits=async(a,m,c,q,{signal})=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(new Error('cancel')),{once:true});});
 const s=await fixture(t,{analysePlan:waits},{timeoutMs:40});const r=await s.assistant.run(s.body(),'owner');assert.equal(r.phase,'TIMED_OUT');assert.equal(fs.existsSync(path.join(s.root,'active-request.lock')),false);
 const v=await fixture(t,{analysePlan:waits});const b=v.body(),pending=v.assistant.run(b,'owner');for(let i=0;i<30&&v.assistant.active?.record.phase!=='ANALYSING';i++)await new Promise(r=>setTimeout(r,5));assert.equal(v.assistant.cancel(b.requestId,'owner').requested,true);assert.equal((await pending).phase,'CANCELLED');
});
test('persisted unfinished receipt is marked interrupted, not replayed, without model request',async t=>{
 const s=await fixture(t),b=s.body();await s.assistant.run(b,'owner');const file=s.assistant.file(b.requestId),r=JSON.parse(fs.readFileSync(file,'utf8'));r.phase='ANALYSING';fs.writeFileSync(file,JSON.stringify(r));assert.equal(s.assistant.read(b.requestId,'owner').phase,'INTERRUPTED');assert.equal(s.counters.analyse,1);
});
test('daily local request guard survives new service instance and is not labelled provider quota',async t=>{
 const s=await fixture(t,{}, {dailyLimit:1});const one=await s.assistant.run(s.body(),'owner');assert.equal(one.localUsage.meaning,'LOCAL_REQUEST_GUARD_NOT_OPENAI_QUOTA');const restarted=new InlineAssistant({enabled:true,root:s.root,runtimeCommit:'a'.repeat(40),dailyLimit:1,minIntervalMs:0,...s.configuration});const two=await restarted.run(s.body(),'owner');assert.equal(two.error.code,'APP_DAILY_REQUEST_LIMIT');assert.equal(s.counters.analyse,1);
});
test('HTTP routes preserve auth, exact origin, CSRF, and reject client prompt fields',async t=>{
 const s=await fixture(t);let handler;const server=http.createServer(async(req,res)=>{const session=req.headers.cookie==='synthetic-session'?{id:'owner',csrf:'csrf-test'}:null;if(!session){res.writeHead(401);res.end();return;}await handler(req,res,new URL(req.url,'http://localhost'),session);});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>{server.closeAllConnections();server.close();});const port=server.address().port,origin='http://127.0.0.1:'+port;
 handler=createInlineHandler({assistant:s.assistant,port,requireCsrf:(req,res)=>{if(req.headers['x-csrf-token']==='csrf-test')return true;res.writeHead(403);res.end();return false;}});
 const call=(route,body,headers={})=>fetch(origin+'/api/v1/ask-gpt/'+route,{method:body?'POST':'GET',headers:{Cookie:'synthetic-session',Origin:origin,'Content-Type':'application/json','X-CSRF-Token':'csrf-test',...headers},body:body?JSON.stringify(body):undefined});
 assert.equal((await fetch(origin+'/api/v1/ask-gpt/status')).status,401);assert.equal((await call('models',{account:s.key},{Origin:'https://evil.invalid'})).status,403);assert.equal((await call('models',{account:s.key},{'X-CSRF-Token':'wrong'})).status,403);
 const status=await(await call('status')).json();assert.equal(status.data.enabled,true);assert.equal(s.counters.analyse,0);
 const result=await(await call('ask',s.body())).text();assert.ok(result.includes('COMPLETED'));assert.equal(s.counters.analyse,1);
});


test('same request id cannot switch ChatGPT account even with same question and model',async t=>{
 const s=await fixture(t),b=s.body();await s.assistant.run(b,'owner');const other='b'.repeat(64);
 await assert.rejects(s.assistant.run({...b,account:other},'owner'),/REQUEST_ID_PAYLOAD_MISMATCH/);assert.equal(s.counters.analyse,1);
 const exposed=s.assistant.read(b.requestId,'owner');assert.equal(Object.hasOwn(exposed,'accountFingerprint'),false);
});
test('component timeout is persisted as TIMED_OUT rather than FAILED',async t=>{
 const timeout=Object.assign(new Error('component timeout'),{name:'TimeoutError'});
 const s=await fixture(t,{analysePlan:async()=>{throw timeout;}});
 const r=await s.assistant.run(s.body(),'owner');assert.equal(r.phase,'TIMED_OUT');assert.equal(r.error.code,'REQUEST_TIMED_OUT');
});
test('same request id cannot silently accept a different question',async t=>{const s=await fixture(t),b=s.body();await s.assistant.run(b,'owner');await assert.rejects(s.assistant.run({...b,question:'different'},'owner'),/REQUEST_ID_PAYLOAD_MISMATCH/);assert.equal(s.counters.analyse,1);});
test('live or unknown request lease is preserved and blocks another model request',async t=>{const s=await fixture(t),file=path.join(s.root,'active-request.lock');fs.writeFileSync(file,JSON.stringify({schema:'ask-gpt-active-lease-v1',root:fs.realpathSync(s.root),pid:process.pid,instance:randomUUID(),requestId:randomUUID()}));const before=fs.readFileSync(file,'utf8');await assert.rejects(s.assistant.run(s.body(),'owner'),/ANALYSIS_ALREADY_RUNNING_OR_INTERRUPTED_LOCK/);assert.equal(fs.readFileSync(file,'utf8'),before);assert.equal(s.counters.analyse,0);});

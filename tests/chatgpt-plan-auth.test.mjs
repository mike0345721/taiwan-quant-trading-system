import test from 'node:test';
import assert from 'node:assert/strict';
import {generateKeyPairSync,sign,randomUUID,createHash} from 'node:crypto';
import {ISSUER,RESOURCE,DIRECT_SCOPE,prepareAuthorization,consumeCallback,validateIdToken,requirePlanPermission,listPlanModels,probePlanInference,consumeResponseStream,exchangeAuthorization,publicError,PlanError} from '../src/chatgpt-plan-auth.mjs';
const hostId='urn:uuid:'+randomUUID(),redirectUri='http://127.0.0.1:18721/auth/callback',browserSession='fixture-session';
const make=(extra={})=>prepareAuthorization({hostId,redirectUri,browserSession,...extra});
const callback=(pending,extra={})=>{const url=new URL(redirectUri);for(const[k,v]of Object.entries({state:pending.state,code:'fixture-code',client_id:'oaiapp_fixture1',...extra}))url.searchParams.set(k,v);return url.href;};
const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});
const jwks={keys:[{...publicKey.export({format:'jwk'}),kid:'fixture-key',use:'sig',alg:'RS256'}]};
const seconds=Math.floor(Date.now()/1000);
const claims={iss:ISSUER,sub:'fixture-subject',aud:'oaiapp_fixture1',nonce:'fixture-nonce',iat:seconds,exp:seconds+3600};
function jwt(payload=claims,header={alg:'RS256',kid:'fixture-key'}){const input=[header,payload].map(v=>Buffer.from(JSON.stringify(v)).toString('base64url')).join('.');return input+'.'+sign('RSA-SHA256',Buffer.from(input),privateKey).toString('base64url');}
const validate=(payload,options={})=>validateIdToken(jwt(payload),jwks,{clientId:'oaiapp_fixture1',oidcNonce:'fixture-nonce',...options});
const record={client_id:'oaiapp_fixture1',subject:'fixture-subject',access_token:randomUUID(),scopes:[DIRECT_SCOPE,'resource.invoke'],expiresAt:Date.now()+3600000};
const event=e=>'data: '+JSON.stringify(e)+'\r\n\r\n';
const completed={type:'response.completed',response:{status:'completed',id:'fixture-response',model:'fixture-model',usage:{input_tokens:5,output_tokens:3}}};
function stream(events){const bytes=new TextEncoder().encode(events.map(event).join(''));return new ReadableStream({start(controller){for(let n=0;n<bytes.length;n+=7)controller.enqueue(bytes.slice(n,n+7));controller.close();}});}
test('first registration uses official dynamic client, resource, stable host and fresh S256/state/nonce',()=>{
 const a=make(),b=make(),url=new URL(a.url);assert.equal(url.origin,ISSUER);assert.equal(url.searchParams.get('client_id'),'dynamic_agent_client');assert.equal(url.searchParams.get('resource'),RESOURCE);assert.equal(url.searchParams.get('ext_agent_host_id'),hostId);assert.notEqual(a.pending.state,b.pending.state);assert.notEqual(a.pending.oidcNonce,b.pending.oidcNonce);assert.equal(url.searchParams.get('code_challenge'),createHash('sha256').update(a.pending.verifier).digest('base64url'));assert.ok(url.searchParams.get('scope').includes(DIRECT_SCOPE));
});
test('returning account uses issued client and excludes initial app-name hint',()=>{const p=make({saved:{client_id:'oaiapp_fixture1',subject:'fixture-subject'}});const u=new URL(p.url);assert.equal(u.searchParams.get('client_id'),'oaiapp_fixture1');assert.equal(u.searchParams.has('agent_name_hint'),false);});
test('unapproved callbacks and dynamic saved client fail closed',()=>{for(const uri of ['http://localhost:18721/auth/callback','https://127.0.0.1:18721/auth/callback','http://127.0.0.1:18721/callback','http://127.0.0.1:18721/auth/callback?q=1'])assert.throws(()=>make({redirectUri:uri}));assert.throws(()=>make({saved:{client_id:'dynamic_agent_client'}}));});
test('callback is bound to state, browser session, expiry and is single-use',()=>{
 const {pending}=make();assert.throws(()=>consumeCallback(pending,callback(pending,{state:'wrong'}),browserSession),/AUTH_STATE_MISMATCH/);assert.throws(()=>consumeCallback(pending,callback(pending),'other'),/AUTH_STATE_MISMATCH/);const tx=consumeCallback(pending,callback(pending),browserSession);assert.equal(tx.clientId,'oaiapp_fixture1');assert.throws(()=>consumeCallback(pending,callback(pending),browserSession),/USED/);const expired=make({now:1}).pending;assert.throws(()=>consumeCallback(expired,callback(expired),browserSession),/EXPIRED/);
});
test('declined, duplicate or wrong-client callbacks cannot replace a saved registration',()=>{
 const denied=make().pending;assert.throws(()=>consumeCallback(denied,callback(denied,{error:'access_denied'}),browserSession),/DECLINED/);const duplicate=make().pending;assert.throws(()=>consumeCallback(duplicate,callback(duplicate)+'&code=second',browserSession),/DUPLICATE/);const saved=make({saved:{client_id:'oaiapp_fixture1',subject:'fixture-subject'}}).pending;assert.throws(()=>consumeCallback(saved,callback(saved,{client_id:'oaiapp_another'}),browserSession),/CLIENT_ID_MISMATCH/);
});
test('valid ID-token signature and identity pass; email is not the account key',()=>{assert.deepEqual(validate(claims),{issuer:ISSUER,subject:'fixture-subject',email:null});});
test('issuer/audience/nonce/expiration/subject mismatch and unsigned algorithms are rejected',()=>{
 for(const patch of [{iss:'https://example.invalid'},{aud:'oaiapp_another'},{nonce:'wrong'},{exp:seconds-1},{iat:seconds+1000},{sub:''},{aud:['oaiapp_fixture1','other'],azp:'other'}])assert.throws(()=>validate({...claims,...patch}));assert.throws(()=>validate(claims,{expectedSubject:'different'}),/ACCOUNT_MISMATCH/);assert.throws(()=>validateIdToken(jwt(claims,{alg:'none',kid:'fixture-key'}),jwks,{clientId:claims.aud,oidcNonce:claims.nonce}),/ALGORITHM/);
});
test('a corrupted signature and unknown key never validate',()=>{const good=jwt();const parts=good.split('.');parts[2]=(parts[2][0]==='A'?'B':'A')+parts[2].slice(1);assert.throws(()=>validateIdToken(parts.join('.'),jwks,{clientId:claims.aud,oidcNonce:claims.nonce}),/SIGNATURE/);assert.throws(()=>validateIdToken(good,{keys:[]},{clientId:claims.aud,oidcNonce:claims.nonce}),/KEY_NOT_FOUND/);});
test('identity alone or expired tokens do not grant inference permission',()=>{assert.throws(()=>requirePlanPermission({...record,scopes:['openid']}),/PLAN_PERMISSION/);assert.throws(()=>requirePlanPermission({...record,expiresAt:1}),/REAUTHORIZE/);assert.doesNotThrow(()=>requirePlanPermission(record));});
test('model picker uses account catalog visibility and does not invent an available model',async()=>{const models=await listPlanModels(record,async(url,opt)=>{assert.equal(url,RESOURCE+'/models');assert.equal(opt.headers.Authorization,'Bearer '+record.access_token);return Response.json({models:[{slug:'hidden',display_name:'H',visibility:'hide'},{slug:'fixture-model',display_name:'Visible',visibility:'list'}]});});assert.deepEqual(models,[{slug:'fixture-model',display_name:'Visible'}]);await assert.rejects(listPlanModels(record,async()=>Response.json({data:[]})),/CATALOG_UNSUPPORTED/);});
test('stream handles fragmented UTF-8 and only succeeds with explicit completed terminal',async()=>{const result=await consumeResponseStream(stream([{type:'response.output_text.delta',delta:'繁體中文'},completed]));assert.equal(result.text,'繁體中文');assert.equal(result.terminal,'response.completed');});
test('partial output, incomplete and midstream quota failure are never success',async()=>{
 await assert.rejects(consumeResponseStream(stream([{type:'response.output_text.delta',delta:'partial'}])),/INTERRUPTED/);
 await assert.rejects(consumeResponseStream(stream([{type:'response.incomplete'}])),/INCOMPLETE/);
 await assert.rejects(consumeResponseStream(stream([{type:'response.output_text.delta',delta:'partial'},{type:'response.failed',response:{error:{code:'subscription_sharing_usage_limit_exceeded'}}}])),/PLAN_USAGE_LIMIT_REACHED/);
});
test('credits setting confirmation is mandatory and no request is made without it',async()=>{let calls=0;await assert.rejects(probePlanInference(record,'fixture-model',{fetcher:async()=>{calls++;}}),/CREDITS_SETTING/);assert.equal(calls,0);});
test('probe calls only public OAuth models/Responses, no fallback or unsupported fields',async()=>{
 const paths=[];const fetcher=async(url,opt)=>{paths.push(url);assert.equal(opt.headers.Authorization,'Bearer '+record.access_token);if(url.endsWith('/models'))return Response.json({models:[{slug:'fixture-model',display_name:'Fixture',visibility:'list'}]});const body=JSON.parse(opt.body);assert.equal(body.store,false);assert.equal(body.stream,true);assert.ok(Array.isArray(body.input));for(const key of ['max_output_tokens','temperature','background','previous_response_id'])assert.equal(key in body,false);return new Response(stream([{type:'response.output_text.delta',delta:'測試'},completed]));};
 const result=await probePlanInference(record,'fixture-model',{creditsDisabledConfirmed:true,fetcher});assert.equal(result.text,'測試');assert.deepEqual(paths,[RESOURCE+'/models',RESOURCE+'/responses']);
});
test('authorization exchange validates JWT and uses returned scopes, not requested scopes',async()=>{
 const {pending}=make();const tx=consumeCallback(pending,callback(pending),browserSession);const fetcher=async(url,opt)=>{
  if(url.endsWith('openid-configuration'))return Response.json({issuer:ISSUER,authorization_endpoint:ISSUER+'/api/accounts/authorize',token_endpoint:ISSUER+'/api/accounts/oauth/token',jwks_uri:ISSUER+'/.well-known/jwks.json',id_token_signing_alg_values_supported:['RS256']});
  if(url.endsWith('jwks.json'))return Response.json(jwks);
  assert.equal(url,ISSUER+'/api/accounts/oauth/token');assert.equal(opt.body.get('client_id'),'oaiapp_fixture1');assert.equal(opt.body.get('code_verifier'),pending.verifier);assert.equal(opt.body.get('redirect_uri'),redirectUri);assert.equal(opt.body.has('client_secret'),false);
  return Response.json({token_type:'Bearer',access_token:'fixture-only',id_token:jwt({...claims,nonce:tx.oidcNonce}),expires_in:3600,scope:'openid profile email'});
 };const result=await exchangeAuthorization(tx,{fetcher});assert.deepEqual(result.scopes,['openid','profile','email']);assert.throws(()=>requirePlanPermission(result),/PLAN_PERMISSION/);
});
test('unexpected error details are never exposed as credential-bearing diagnostics',()=>{assert.equal(publicError(new Error('sensitive fixture response')),'REQUEST_FAILED');assert.equal(publicError(new PlanError('SAFE_CODE')),'SAFE_CODE');});

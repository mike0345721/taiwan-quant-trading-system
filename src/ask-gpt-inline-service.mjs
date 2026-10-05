import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { PlanError, publicError } from './chatgpt-plan-auth.mjs';
import { createWindowsPlanStore } from './chatgpt-plan-store.mjs';
import { configurePlanTransport } from './chatgpt-plan-transport.mjs';
import { startPlanSetup } from './chatgpt-plan-setup.mjs';
import { freshPlanRecord, planCatalog, analysePlan, analysisError } from './chatgpt-plan-inference.mjs';
import { buildInlineContext } from './ask-gpt-inline-context.mjs';
const terminal=new Set(['COMPLETED','FAILED','TIMED_OUT','CANCELLED','INTERRUPTED']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ownerHash=s=>createHash('sha256').update(s).digest('hex');
const reject=code=>{throw new PlanError(code);};
function validateBody(body){
 if(!body||Array.isArray(body)||Object.keys(body).some(k=>!['requestId','account','model','question','creditsDisabledConfirmed'].includes(k)))reject('ANALYSIS_REQUEST_INVALID');
 if(!uuid.test(body.requestId||'')||!/^[a-f0-9]{64}$/.test(body.account||'')||!/^[A-Za-z0-9._-]{1,100}$/.test(body.model||''))reject('ANALYSIS_REQUEST_INVALID');
 if(typeof body.question!=='string'||!body.question.trim()||body.question.length>1000)reject('QUESTION_INVALID');
 if(body.creditsDisabledConfirmed!==true)reject('CREDITS_SETTING_CONFIRMATION_REQUIRED');
}
export class InlineAssistant {
 constructor({enabled=false,root,runtimeCommit,snapshotProvider,storeFactory=createWindowsPlanStore,operations={},now=Date.now,timeoutMs=120000,dailyLimit=60,minIntervalMs=10000,configureTransport=configurePlanTransport}){
  this.enabled=enabled;this.root=root;this.runtimeCommit=runtimeCommit;this.snapshotProvider=snapshotProvider;this.storeFactory=storeFactory;this.now=now;this.timeoutMs=timeoutMs;this.dailyLimit=dailyLimit;this.minIntervalMs=minIntervalMs;this.instance=randomUUID();this.active=null;this.store=null;this.setup=null;
  this.ops={freshPlanRecord,planCatalog,analysePlan,...operations};this.configureTransport=configureTransport;
  if(enabled){fs.mkdirSync(root,{recursive:true});if(fs.lstatSync(root).isSymbolicLink())reject('ANALYSIS_STORAGE_PATH_REJECTED');}
 }
 ensure(){if(!this.enabled)reject('INLINE_ASSISTANT_NOT_ACTIVATED');if(!this.store){this.configureTransport();this.store=this.storeFactory();}return this.store;}
 connection(){
  const base={enabled:this.enabled,usageRoute:'CHATGPT_SUBSCRIPTION',paidApiFallback:false,remainingPlanQuota:null,automaticModelRouting:false,runtimeCommit:this.runtimeCommit};
  if(!this.enabled)return{...base,accounts:[],reason:'INLINE_ASSISTANT_NOT_ACTIVATED'};
  try{const store=this.ensure();store.reload?.();return{...base,accounts:store.list().map(a=>{const r=store.get(a.key);return{...a,planPermission:Boolean(r?.scopes?.includes('chatgpt.tokens.use.direct')),accessReady:r?.expiresAt>this.now()+90000,renewable:Boolean(r?.refresh_token)};}),reason:null};}
  catch(e){return{...base,accounts:[],reason:publicError(e)};}
 }
 async models(account){
  if(!/^[a-f0-9]{64}$/.test(account||''))reject('ACCOUNT_SELECTION_REQUIRED');if(this.active)reject('ANALYSIS_ALREADY_RUNNING');
  const record=await this.ops.freshPlanRecord(this.ensure(),account);const models=await this.ops.planCatalog(record);return{models,account,checkedAt:new Date(this.now()).toISOString()};
 }
 file(id){if(!uuid.test(id||''))reject('REQUEST_NOT_FOUND');return path.join(this.root,id+'.json');}
 clearDeadLease(){
  const file=path.join(this.root,'active-request.lock');if(!fs.existsSync(file))return false;
  if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>4096)return true;
  let raw,lease;try{raw=fs.readFileSync(file,'utf8');lease=JSON.parse(raw);}catch{return true;}
  if(lease.schema!=='ask-gpt-active-lease-v1'||lease.root!==fs.realpathSync(this.root)||!Number.isInteger(lease.pid)||lease.pid<=0||!uuid.test(lease.instance||'')||!uuid.test(lease.requestId||''))return true;
  try{process.kill(lease.pid,0);return true;}catch(e){if(e.code!=='ESRCH')return true;}
  // Only a valid application lease with a proven absent PID is archived, never an unknown/live lock.
  if(fs.readFileSync(file,'utf8')!==raw)return true;
  fs.renameSync(file,path.join(this.root,'interrupted-lease-'+randomUUID()+'.json'));return false;
 }
 read(id,owner){
  this.ensure();const file=this.file(id);if(!fs.existsSync(file))reject('REQUEST_NOT_FOUND');
  if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>262144)reject('ANALYSIS_RECEIPT_INVALID');
  let r;try{r=JSON.parse(fs.readFileSync(file,'utf8'));}catch{reject('ANALYSIS_RECEIPT_INVALID');}
  if(r.ownerHash!==ownerHash(owner))reject('REQUEST_NOT_FOUND');
  if(!terminal.has(r.phase)&&(!this.active||this.active.record.requestId!==id)&&!this.clearDeadLease()){
   r.phase='INTERRUPTED';r.error={code:'PREVIOUS_REQUEST_INTERRUPTED'};r.updatedAt=new Date(this.now()).toISOString();this.persist(r);
  }
  if(!terminal.has(r.phase)&&r.instance!==this.instance)return this.public({...r,phase:'INTERRUPTED',error:{code:'PREVIOUS_REQUEST_STATE_UNVERIFIED'}});
  return this.public(r);
 }
 public(r){const{ownerHash:ignored,instance:ignoredInstance,account:ignoredAccount,...out}=r;return structuredClone({...out,finished:terminal.has(r.phase)});}
 persist(r){
  r.updatedAt=new Date(this.now()).toISOString();const file=this.file(r.requestId),tmp=file+'.'+randomUUID()+'.tmp';
  try{const json=JSON.stringify(r);if(Buffer.byteLength(json)>262144)reject('ANALYSIS_RECEIPT_LIMIT');fs.writeFileSync(tmp,json,{flag:'wx',mode:0o600});fs.renameSync(tmp,file);}
  finally{if(fs.existsSync(tmp))fs.unlinkSync(tmp);}
 }
 reserveAttempt(id){
  const day=new Date(this.now()).toISOString().slice(0,10),file=path.join(this.root,'usage-'+day+'.ndjson');
  let rows=[];if(fs.existsSync(file)){if(fs.lstatSync(file).isSymbolicLink()||fs.statSync(file).size>65536)reject('APP_USAGE_RECEIPT_INVALID');rows=fs.readFileSync(file,'utf8').trim().split('\n').filter(Boolean).map(l=>JSON.parse(l));}
  if(rows.length>=this.dailyLimit)reject('APP_DAILY_REQUEST_LIMIT');
  if(rows.length&&this.now()-rows.at(-1).at<this.minIntervalMs)reject('APP_REQUEST_COOLDOWN');
  fs.appendFileSync(file,JSON.stringify({id,at:this.now()})+'\n',{mode:0o600});return{attempt:rows.length+1,dailyLimit:this.dailyLimit,day,meaning:'LOCAL_REQUEST_GUARD_NOT_OPENAI_QUOTA'};
 }
 async run(body,owner,{signal,onEvent=()=>{}}={}){
  validateBody(body);this.ensure();
  if(fs.existsSync(this.file(body.requestId))){const prior=this.read(body.requestId,owner);if(prior.question!==body.question.trim()||prior.requestedModel!==body.model)reject('REQUEST_ID_PAYLOAD_MISMATCH');onEvent({type:'receipt',data:prior});return prior;}
  if(this.active)reject('ANALYSIS_ALREADY_RUNNING');
  this.clearDeadLease();
  const lockPath=path.join(this.root,'active-request.lock');let lockFd;
  try{lockFd=fs.openSync(lockPath,'wx',0o600);}catch{reject('ANALYSIS_ALREADY_RUNNING_OR_INTERRUPTED_LOCK');}
  const lockStamp=JSON.stringify({schema:'ask-gpt-active-lease-v1',root:fs.realpathSync(this.root),instance:this.instance,pid:process.pid,requestId:body.requestId});
  try{fs.writeFileSync(lockFd,lockStamp);}catch(e){fs.closeSync(lockFd);fs.unlinkSync(lockPath);throw e;}
  const releaseLock=()=>{fs.closeSync(lockFd);if(fs.readFileSync(lockPath,'utf8')!==lockStamp)reject('ANALYSIS_LOCK_IDENTITY_CHANGED');fs.unlinkSync(lockPath);};
  const controller=new AbortController(),abort=()=>controller.abort(signal.reason||'CANCELLED');
  if(signal?.aborted){releaseLock();reject('REQUEST_CANCELLED');}signal?.addEventListener('abort',abort,{once:true});
  const r={schema:'ask-gpt-inline-receipt-v1',requestId:body.requestId,instance:this.instance,ownerHash:ownerHash(owner),account:body.account,question:body.question.trim(),requestedModel:body.model,actualModel:null,runtimeCommit:this.runtimeCommit,phase:'PREPARING_SNAPSHOT',createdAt:new Date(this.now()).toISOString(),updatedAt:new Date(this.now()).toISOString(),snapshotHash:null,snapshotTime:null,contextHash:null,context:null,text:'',error:null,usageRoute:'CHATGPT_SUBSCRIPTION',paidApiFallback:false,creditsConfirmation:'EXPLICIT_REQUEST_CONFIRMED_NOT_BILLING_API_AUDIT',researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false};
  const job={record:r,controller};this.active=job;let lastTextEvent=0,ownsReceipt=false;
  const notify=event=>{try{onEvent(event);}catch{controller.abort('CONNECTION_CLOSED');}};
  const emit=()=>notify({type:'receipt',data:this.public(r)});
  const update=phase=>{r.phase=phase;this.persist(r);emit();};
  const check=()=>{if(controller.signal.aborted)throw new PlanError(controller.signal.reason==='TIMED_OUT'?'REQUEST_TIMED_OUT':'REQUEST_CANCELLED');};
  const timer=setTimeout(()=>controller.abort('TIMED_OUT'),this.timeoutMs);
  try{
   fs.writeFileSync(this.file(r.requestId),JSON.stringify(r),{flag:'wx',mode:0o600});ownsReceipt=true;emit();
   const workspace=await this.snapshotProvider();check();const prepared=buildInlineContext(workspace?.snapshot||workspace,{now:this.now()});
   Object.assign(r,prepared);update('CHECKING_SUBSCRIPTION');
   const record=await this.ops.freshPlanRecord(this.store,body.account,{signal:controller.signal});check();
   const models=await this.ops.planCatalog(record,{signal:controller.signal});check();
   if(!models.some(m=>m.slug===body.model))reject('MODEL_NOT_IN_ACCOUNT_CATALOG');
   r.localUsage=this.reserveAttempt(r.requestId);update('ANALYSING');
   const result=await this.ops.analysePlan(record,body.model,r.context,r.question,{signal:controller.signal,onText:text=>{check();r.text=text;if(this.now()-lastTextEvent>200){lastTextEvent=this.now();notify({type:'text',requestId:r.requestId,text});}}});
   check();if(result.terminal!=='response.completed'||!result.text?.trim())reject('STREAM_INTERRUPTED');
   r.text=result.text;r.actualModel=result.model;r.providerRequestId=result.requestId;r.usage=result.usage;r.terminal=result.terminal;update('COMPLETED');
  }catch(e){
   if(!ownsReceipt)throw new PlanError('REQUEST_ID_COLLISION');
   const timed=controller.signal.reason==='TIMED_OUT';const cancelled=controller.signal.aborted&&!timed;
   r.phase=timed?'TIMED_OUT':cancelled?'CANCELLED':'FAILED';r.error=timed?{code:'REQUEST_TIMED_OUT'}:cancelled?{code:'REQUEST_CANCELLED'}:analysisError(e);
   controller.abort(r.phase);
   try{this.persist(r);}catch{r.error={code:'ANALYSIS_RECEIPT_WRITE_FAILED'};}
   emit();
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);if(this.active===job)this.active=null;releaseLock();}
  return this.public(r);
 }
 cancel(id,owner){
  this.ensure();if(this.active?.record.requestId===id&&this.active.record.ownerHash===ownerHash(owner)){this.active.controller.abort('CANCELLED');return{requested:true};}
  return{requested:false,receipt:this.read(id,owner)};
 }
 async openSetup(){
  this.ensure();if(this.active)reject('ANALYSIS_ALREADY_RUNNING');
  if(this.setup?.server.listening)reject('SETUP_ALREADY_OPEN');
  // User-activated, bounded account setup only; never generates a model request.
  this.setup=await startPlanSetup({store:this.store,port:18721});
  return{url:this.setup.launchUrl,expiresAt:this.setup.expiresAt};
 }
 async close(){this.active?.controller.abort('CANCELLED');if(this.setup?.server.listening)await this.setup.close();}
}

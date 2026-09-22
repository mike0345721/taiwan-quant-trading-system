import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { readRuntimeBinding,verifyBoundSourceRoot,resolveBoundSourceFile,assertBoundWriteRoot } from './cru55-runtime-binding.mjs';
import { readRuntimeIdentity } from './runtime-identity.mjs';
export function managedDelayMs(result){return result.state==='PENDING'&&(result.metrics?.pages>0||result.metrics?.bytes>0)?250:5000;}

const readJson=(file,limit=65536)=>{assertPlainPath(file);const s=fs.statSync(file);if(!s.isFile()||s.nlink!==1||s.size>limit)throw Error('CRU55_MANAGED_FILE_INVALID');return JSON.parse(fs.readFileSync(file,'utf8'));};
function checkedPlan(plan){
  for(const name of ['managed-logs','managed-owner.lock','managed-owner.lock/owner.json','stream-managed-state.json','stream-managed-status.json','stream-selection.json'])assertBoundWriteRoot(plan,path.join(plan.outputRoot,...name.split('/')));
  return plan;
}
export function readManagedConfig(file,{runtimeRoot,candidate=false}={}){
  const configPath=assertPlainPath(file);
  if(!candidate){const b=readRuntimeBinding(configPath,{runtimeRoot,activation:true});if(b.producer!=='STREAM_PAGED_V2')throw Error('CRU55_MANAGED_STREAM_REQUIRED');return checkedPlan({...b,configPath,sourceKind:'GOVERNED_FRAGMENT'});}
  const b=readJson(configPath,16384),root=assertPlainPath(runtimeRoot),privateRoot=path.join(root,'data','cru55-dynamic');
  const head=readRuntimeIdentity(root).commit;
  if(!fs.lstatSync(path.join(root,'.git')).isFile()||!['codex/cru55-formal-entry-recovery-v1','codex/cru55-growing-prefix-v1'].includes(execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8',windowsHide:true,timeout:10000}).trim()))throw Error('CRU55_CANDIDATE_WORKTREE_REQUIRED');
  if(b.schemaVersion!=='cru55-managed-candidate-v1'||b.runtimeCommit!==head||!head||!/^candidate-[a-z0-9-]{1,50}$/.test(b.runId||'')
    ||Object.entries(SAFETY).some(([k,v])=>b[k]!==v)||b.producer!=='STREAM_PAGED_V2'||b.sourceVerification!=='FULL_PREFIX_BEFORE_PUBLICATION'
    ||b.sourceSelection?.kind!=='DATED_CALENDAR_LEDGER'||!/^\d{4}-\d{2}-\d{2}$/.test(b.sourceSelection?.startDate||''))throw Error('CRU55_MANAGED_CANDIDATE_CONFIG');
  const sourceRoot=path.join(privateRoot,'fixtures'),outputRoot=path.join(privateRoot,'managed',b.runId);
  if(b.sourceAlias?.kind!=='PLAIN'||path.resolve(b.sourceAlias.physicalRoot)!==sourceRoot)throw Error('CRU55_CANDIDATE_FIXTURE_ONLY');
  const plan={...b,runtimeRoot:root,sourceRoot,outputRoot,readerRoot:outputRoot,bindingHash:digest(stableJson(b)),configPath,sourceKind:'SYNTHETIC_FIXTURE',activationReady:false,fullDayReady:false};
  verifyBoundSourceRoot(plan);assertBoundWriteRoot(plan,outputRoot);return checkedPlan(plan);
}
export function selectManagedSources(binding,{now=Date.now()}={}){
  const root=verifyBoundSourceRoot(binding),date=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const names=fs.readdirSync(root).filter(name=>/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)&&name.slice(0,10)>=binding.sourceSelection.startDate&&name.slice(0,10)<=date).sort();
  if(names.length>512)throw Error('CRU55_MANAGED_SOURCE_INDEX_BUDGET');
  return names;
}
export function identifyManagedSource(binding,name){
  const sourcePath=resolveBoundSourceFile(binding,path.join(binding.sourceRoot,name)),fd=fs.openSync(sourcePath,'r');
  try{
    const stat=fs.fstatSync(fd,{bigint:true}),bytes=Buffer.alloc(65536),n=fs.readSync(fd,bytes,0,bytes.length,0),end=bytes.subarray(0,n).indexOf(10);
    if(end<0){if(n===bytes.length)throw Error('CRU55_MANAGED_FIRST_RECORD_BUDGET');return null;}
    const row=JSON.parse(bytes.subarray(0,end).toString('utf8'));
    if(row.previousHash!=='GENESIS'||!/^[a-f0-9]{64}$/.test(row.recordHash||''))throw Error('CRU55_MANAGED_GENESIS_REQUIRED');
    const identity={physicalPath:sourcePath,dev:String(stat.dev),ino:String(stat.ino),birthtimeNs:String(stat.birthtimeNs),firstRecordHash:row.recordHash};
    return {sourcePath,sourceKey:digest(stableJson(identity)),sourceIdentity:identity};
  }finally{fs.closeSync(fd);}
}
export function publishManagedJson(binding,name,value){
  if(!/^[a-z0-9-]+\.json$/.test(name))throw Error('CRU55_MANAGED_STATUS_NAME');
  const target=assertBoundWriteRoot(binding,path.join(binding.outputRoot,name)),temp=assertBoundWriteRoot(binding,path.join(binding.outputRoot,crypto.randomUUID()+'.tmp'));
  const fd=fs.openSync(temp,'wx');try{fs.writeFileSync(fd,stableJson(value));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
  fs.renameSync(temp,target);
}
export async function runManagedCycle(binding,{runStreamCycle,ownerContext=null,now=Date.now()}={}){
  fs.mkdirSync(assertBoundWriteRoot(binding,binding.outputRoot),{recursive:true});
  const stateFile=path.join(binding.outputRoot,'stream-managed-state.json'),selectionFile=path.join(binding.outputRoot,'stream-selection.json');
  const state=fs.existsSync(stateFile)?readJson(stateFile):{bindingHash:binding.bindingHash,cursor:0,sources:{}};
  if(state.bindingHash!==binding.bindingHash)throw Error('CRU55_MANAGED_CONFIG_CHANGED');
  const names=selectManagedSources(binding,{now});if(!names.length)return {state:'WAITING_FOR_SOURCE',fullDayReady:false};
  const index=state.cursor%names.length,name=names[index],source=identifyManagedSource(binding,name);
  if(!source){state.cursor=(index+1)%names.length;publishManagedJson(binding,'stream-managed-state.json',state);return {state:'WAITING_FOR_COMPLETE_RECORD',sourceFiles:names.length,fullDayReady:false};}
  if(state.sources[name]&&state.sources[name]!==source.sourceKey)throw Error('CRU55_MANAGED_SOURCE_REPLACED');
  state.sources[name]=source.sourceKey;
  const relativeRunPath='sources/'+source.sourceKey,runRoot=assertBoundWriteRoot(binding,path.join(binding.outputRoot,...relativeRunPath.split('/')));
  const selection=fs.existsSync(selectionFile)?readJson(selectionFile):{schemaVersion:'cru55-stream-selection-v1',bindingHash:binding.bindingHash,views:{},...SAFETY};
  if(selection.bindingHash!==binding.bindingHash)throw Error('CRU55_MANAGED_CONFIG_CHANGED');
  const priorPublications={day:null,night:null};
  for(const view of ['day','night']){const prior=selection.views[view];if(!prior)continue;
    if(!/^sources\/[a-f0-9]{64}$/.test(prior.relativeRunPath||'')||!/^[a-f0-9]{64}$/.test(prior.artifactHash||''))throw Error('CRU55_MANAGED_PRIOR_REFERENCE');
    const artifactPath=assertBoundWriteRoot(binding,path.join(binding.outputRoot,...prior.relativeRunPath.split('/'),prior.artifactHash+'.stream-view.json'));
    if(fs.existsSync(artifactPath))priorPublications[view]={artifactPath,artifactHash:prior.artifactHash};
  }
  const result=await runStreamCycle({sourcePath:source.sourcePath,runRoot,sourceKind:binding.sourceKind,priorPublications,ownerContext,publishAtSessionBoundary:true,maxPages:8,maxBytes:8*1024*1024});
  verifyBoundSourceRoot(binding); // no routing publication after the approved alias changes
  if(result.state==='PUBLISHED'||result.state==='UNCHANGED'){
    const view=result.session?.toLowerCase(),availableAt=Date.parse(result.availableAt);
    if(!['day','night'].includes(view)||!/^[a-f0-9]{64}$/.test(result.artifactHash||'')||!Number.isFinite(availableAt))throw Error('CRU55_MANAGED_PUBLICATION_IDENTITY');
    if(!selection.views[view]||availableAt>=Date.parse(selection.views[view].availableAt))selection.views[view]={relativeRunPath,sourceKey:source.sourceKey,artifactHash:result.artifactHash,session:result.session,tradeDate:result.tradeDate,availableAt:result.availableAt,cutoff:result.cutoff};
    publishManagedJson(binding,'stream-selection.json',selection);
  }
  // A bounded step alternates files, including the new calendar date after
  // midnight. Separate genesis streams never imply cross-file CVD continuity.
  state.cursor=(index+1)%names.length;publishManagedJson(binding,'stream-managed-state.json',state);
  const views=fs.existsSync(selectionFile)?readJson(selectionFile).views:{};
  return {...result,sourceKey:source.sourceKey,relativeRunPath,sourceFiles:names.length,missingViews:['day','night'].filter(v=>!views[v]),sessionSelection:'PUBLISHED_CUTOFFS_ONLY',fullDayReady:false};
}

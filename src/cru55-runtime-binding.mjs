import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { readRuntimeIdentity } from './runtime-identity.mjs';

// A deployment proposal is data, never permission to start a writer or deploy code.
export function validateRuntimeBinding(binding,{runtimeRoot,head,approvedMain,activation=false}={}){
  if(binding?.schemaVersion!=='cru55-runtime-binding-v1'||!['PROPOSED','OWNER_APPROVED'].includes(binding.state)
    ||Object.entries(SAFETY).some(([k,v])=>binding[k]!==v))throw Error('CRU55_BINDING_CONTRACT');
  const absolute=p=>{if(typeof p!=='string'||!path.isAbsolute(p))throw Error('CRU55_BINDING_ABSOLUTE_PATH');return path.resolve(p);};
  const root=absolute(binding.runtimeRoot),data=absolute(binding.dataRoot),output=absolute(binding.outputRoot);
  const eq=(a,b)=>process.platform==='win32'?a.toLowerCase()===b.toLowerCase():a===b;
  if(!eq(root,absolute(runtimeRoot)))throw Error('CRU55_BINDING_RUNTIME_ROOT');
  // The existing collector/CRU34/acceptance launcher is rooted here. External
  // data roots need a separately reviewed whole-chain binding, not one override.
  if(!eq(data,path.join(root,'data')))throw Error('CRU55_BINDING_EXISTING_DATA_ROOT');
  if(!/^[a-f0-9]{40}$/.test(binding.runtimeCommit||'')||head!==binding.runtimeCommit)throw Error('CRU55_BINDING_HEAD_MISMATCH');
  if(!eq(output,path.join(data,'runtime','cru55-overview')))throw Error('CRU55_BINDING_OUTPUT_ROOT');
  if(binding.readerRoot!==binding.outputRoot||binding.sourceRoot!==path.join(data,'live-events'))throw Error('CRU55_BINDING_READER_WRITER_SOURCE_MISMATCH');
  if(binding.sourceVerification!=='FULL_PREFIX_EACH_BATCH'||binding.producer!=='BOUNDED_ACCEPTED_V1')throw Error('CRU55_BINDING_UNREVIEWED_PRODUCER');
  if(activation&&(binding.state!=='OWNER_APPROVED'||binding.runtimeCommit!==approvedMain
    ||typeof binding.ownerDecisionUrl!=='string'||!/^https:\/\/(github\.com|linear\.app)\//.test(binding.ownerDecisionUrl)))throw Error('CRU55_BINDING_OWNER_MAIN_GATE');
  return {bindingHash:digest(stableJson(binding)),runtimeRoot:root,runtimeCommit:head,dataRoot:data,sourceRoot:binding.sourceRoot,
    outputRoot:output,readerRoot:output,activationReady:activation,fullDayReady:false,producer:binding.producer,...SAFETY};
}

export function readRuntimeBinding(file,{runtimeRoot,activation=false}={}){
  const source=assertPlainPath(file),stat=fs.statSync(source);
  if(!stat.isFile()||stat.nlink!==1||stat.size>16384)throw Error('CRU55_BINDING_FILE_INVALID');
  const binding=JSON.parse(fs.readFileSync(source,'utf8'));
  const result=validateRuntimeBinding(binding,{runtimeRoot,head:readRuntimeIdentity(runtimeRoot).commit,
    approvedMain:readRuntimeIdentity(runtimeRoot,{ref:'refs/remotes/origin/main'}).commit,activation});
  if(activation){
    const changes=execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:runtimeRoot,encoding:'utf8',windowsHide:true,timeout:5000});
    if(changes.trim())throw Error('CRU55_BINDING_TRACKED_CODE_DIRTY');
  }
  for(const p of [result.runtimeRoot,result.dataRoot,result.sourceRoot,result.outputRoot])assertPlainPath(p);
  return result;
}

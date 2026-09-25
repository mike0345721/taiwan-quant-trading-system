import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { readRuntimeIdentity } from './runtime-identity.mjs';
import { validatePublicationSchedule } from './cru55-publication-schedule.mjs';

const samePath=(a,b)=>process.platform==='win32'?path.resolve(a).toLowerCase()===path.resolve(b).toLowerCase():path.resolve(a)===path.resolve(b);
const within=(root,file)=>{const r=path.relative(root,file);return r===''||(!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r));};
export function sourceDirectoryIdentity(root){
  const stat=fs.statSync(root,{bigint:true});if(!stat.isDirectory())throw Error('CRU55_SOURCE_DIRECTORY_REQUIRED');
  return {dev:String(stat.dev),ino:String(stat.ino),birthtimeNs:String(stat.birthtimeNs)};
}
// Only the approved source leaf may be a Windows junction. Frozen plain-path
// policy remains unchanged for all parents, physical targets and write roots.
export function verifyBoundSourceRoot(binding){
  const logical=path.resolve(binding.sourceRoot),alias=binding.sourceAlias;
  if(!alias)return assertPlainPath(logical);
  const physical=assertPlainPath(alias.physicalRoot);
  assertPlainPath(path.dirname(logical));
  if(alias.kind==='PLAIN'){
    assertPlainPath(logical);if(!samePath(logical,physical))throw Error('CRU55_SOURCE_ALIAS_TARGET');
  }else if(alias.kind==='WINDOWS_JUNCTION'){
    if(process.platform!=='win32'||!fs.lstatSync(logical).isSymbolicLink())throw Error('CRU55_SOURCE_JUNCTION_REQUIRED');
    const kind=execFileSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',"$ErrorActionPreference='Stop'; (Get-Item -LiteralPath $env:CRU55_ALIAS_PROBE -Force).LinkType"],
      {encoding:'utf8',windowsHide:true,timeout:5000,env:{...process.env,CRU55_ALIAS_PROBE:logical},stdio:['ignore','pipe','pipe']}).trim();
    if(kind!=='Junction')throw Error('CRU55_SOURCE_UNKNOWN_REPARSE');
    if(!samePath(fs.realpathSync.native(logical),physical))throw Error('CRU55_SOURCE_ALIAS_TARGET');
  }else throw Error('CRU55_SOURCE_ALIAS_KIND');
  if(stableJson(sourceDirectoryIdentity(physical))!==stableJson(alias.targetIdentity))throw Error('CRU55_SOURCE_TARGET_IDENTITY');
  const output=path.resolve(binding.outputRoot);
  if(within(physical,output)||within(output,physical))throw Error('CRU55_SOURCE_WRITE_OVERLAP');
  return physical;
}
export function resolveBoundSourceFile(binding,file){
  if(typeof file!=='string'||!path.isAbsolute(file))throw Error('CRU55_SOURCE_ABSOLUTE_FILE');
  const physical=verifyBoundSourceRoot(binding),logical=path.resolve(binding.sourceRoot),name=path.basename(file);
  if(!/^[a-zA-Z0-9][a-zA-Z0-9._-]*\.ndjson$/.test(name)||(!samePath(path.dirname(file),logical)&&!samePath(path.dirname(file),physical)))throw Error('CRU55_SOURCE_FILE_OUTSIDE_BINDING');
  const target=assertPlainPath(path.join(physical,name)),stat=fs.statSync(target);
  if(!stat.isFile()||stat.nlink!==1)throw Error('CRU55_SOURCE_NOT_PLAIN_FILE');
  // Recheck the approved alias after locating the physical file; callers retain
  // physical file identity and prefix verification around each publication.
  verifyBoundSourceRoot(binding);return target;
}
export function assertBoundWriteRoot(binding,target){
  const root=assertPlainPath(binding.outputRoot),actual=path.resolve(target);
  if(!within(root,actual))throw Error('CRU55_WRITE_ROOT_ESCAPE');
  assertPlainPath(actual);return actual;
}

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
  const version=binding.outputVersion;
  if(version!==undefined&&(binding.producer!=='STREAM_PAGED_V2'||!/^stream-[a-z0-9-]{1,64}$/.test(version)))throw Error('CRU55_BINDING_OUTPUT_VERSION');
  const expectedOutput=version?path.join(data,'cru55-runtime','output',version):path.join(data,'runtime','cru55-overview');
  if(!eq(output,expectedOutput))throw Error('CRU55_BINDING_OUTPUT_ROOT');
  if(binding.readerRoot!==binding.outputRoot||binding.sourceRoot!==path.join(data,'live-events'))throw Error('CRU55_BINDING_READER_WRITER_SOURCE_MISMATCH');
  const legacy=binding.sourceVerification==='FULL_PREFIX_EACH_BATCH'&&binding.producer==='BOUNDED_ACCEPTED_V1';
  const stream=binding.sourceVerification==='FULL_PREFIX_BEFORE_PUBLICATION'&&binding.producer==='STREAM_PAGED_V2';
  if(!legacy&&!stream)throw Error('CRU55_BINDING_UNREVIEWED_PRODUCER');
  const publicationSchedule=validatePublicationSchedule(binding.publicationSchedule);
  if(publicationSchedule&&(!stream||!version))throw Error('CRU55_BINDING_SCHEDULE_REQUIRES_VERSIONED_STREAM');
  if(stream||binding.sourceAlias){
    const a=binding.sourceAlias;
    if(!a||!['PLAIN','WINDOWS_JUNCTION'].includes(a.kind)||!path.isAbsolute(a.physicalRoot||'')||!a.targetIdentity
      ||['dev','ino','birthtimeNs'].some(k=>!/^\d+$/.test(a.targetIdentity[k]||'')))throw Error('CRU55_BINDING_SOURCE_ALIAS');
  }
  if(stream&&(!binding.sourceSelection||binding.sourceSelection.kind!=='DATED_CALENDAR_LEDGER'||!/^\d{4}-\d{2}-\d{2}$/.test(binding.sourceSelection.startDate||'')))throw Error('CRU55_BINDING_SOURCE_SELECTION');
  if(activation&&(binding.state!=='OWNER_APPROVED'||binding.runtimeCommit!==approvedMain
    ||typeof binding.ownerDecisionUrl!=='string'||!/^https:\/\/(github\.com|linear\.app)\//.test(binding.ownerDecisionUrl)))throw Error('CRU55_BINDING_OWNER_MAIN_GATE');
  return {bindingHash:digest(stableJson(binding)),runtimeRoot:root,runtimeCommit:head,dataRoot:data,sourceRoot:binding.sourceRoot,
    outputRoot:output,readerRoot:output,outputVersion:version??null,sourceAlias:binding.sourceAlias??null,sourceSelection:binding.sourceSelection??null,sourceVerification:binding.sourceVerification,
    publicationSchedule,activationReady:activation,fullDayReady:false,producer:binding.producer,...SAFETY};
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
  for(const p of [result.runtimeRoot,result.dataRoot,result.outputRoot])assertPlainPath(p);
  verifyBoundSourceRoot(result);
  return result;
}

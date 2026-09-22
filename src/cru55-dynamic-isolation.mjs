import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { readRuntimeBinding,resolveBoundSourceFile,assertBoundWriteRoot } from './cru55-runtime-binding.mjs';
export { assertPlainPath };
export const REPO=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const PRIVATE_ROOT=path.join(REPO,'data','cru55-dynamic');
const git=args=>execFileSync('git',args,{cwd:REPO,encoding:'utf8',windowsHide:true}).trim();
export function assertCandidate(){
  assertPlainPath(REPO);
  if(process.env.CRU55_RUNTIME_BINDING){
    const binding=readRuntimeBinding(process.env.CRU55_RUNTIME_BINDING,{runtimeRoot:REPO,activation:true});
    return {primary:path.dirname(binding.dataRoot),binding};
  }
  if(!fs.lstatSync(path.join(REPO,'.git')).isFile()||git(['branch','--show-current'])!=='codex/cru55-formal-entry-recovery-v1')throw Error('CRU55_CANDIDATE_WORKTREE_REQUIRED');
  const primary=path.dirname(path.resolve(REPO,git(['rev-parse','--git-common-dir'])));
  assertPlainPath(PRIVATE_ROOT);
  return {primary};
}
export function isolatedRunRoot(runId){
  const {binding}=assertCandidate();
  if(!/^[a-z0-9][a-z0-9-]{0,79}$/.test(runId||''))throw Error('CVD_RUN_ID_INVALID');
  const target=path.join(binding?.outputRoot??path.join(PRIVATE_ROOT,'output'),runId);
  return binding?assertBoundWriteRoot(binding,target):assertPlainPath(target);
}
export function assertInputPath(file){
  const {primary,binding}=assertCandidate();
  if(!path.isAbsolute(file||''))throw Error('CVD_ABSOLUTE_SOURCE_REQUIRED');
  if(binding)return resolveBoundSourceFile(binding,file);
  const actual=assertPlainPath(file),dir=path.dirname(actual).toLowerCase();
  const allowed=binding?[binding.sourceRoot]:[path.join(primary,'data','live-events'),path.join(PRIVATE_ROOT,'fixtures')];
  if(!allowed.some(p=>p.toLowerCase()===dir)||!actual.endsWith('.ndjson'))throw Error('CVD_SOURCE_NOT_ALLOWLISTED');
  const st=fs.statSync(actual);if(!st.isFile()||st.nlink!==1)throw Error('CVD_SOURCE_NOT_PLAIN_FILE');return actual;
}

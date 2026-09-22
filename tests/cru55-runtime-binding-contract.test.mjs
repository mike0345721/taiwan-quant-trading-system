import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { validateRuntimeBinding,readRuntimeBinding,sourceDirectoryIdentity } from '../src/cru55-runtime-binding.mjs';
import { readRuntimeIdentity } from '../src/runtime-identity.mjs';

const repo=fileURLToPath(new URL('../',import.meta.url));
const doc=fs.readFileSync(new URL('../docs/operations/CRU55_RUNTIME_BINDING_CANDIDATE_V1.md',import.meta.url),'utf8');
const template=JSON.parse(doc.match(/```json\r?\n([\s\S]*?)\r?\n```/)[1]);
function proposal(runtimeRoot,dataRoot,head){
  const sourceRoot=path.join(dataRoot,'live-events'),outputRoot=path.join(dataRoot,'cru55-runtime','output',template.outputVersion);
  fs.mkdirSync(sourceRoot,{recursive:true});
  return {...template,runtimeRoot,runtimeCommit:head,dataRoot,
    sourceRoot,outputRoot,readerRoot:outputRoot,sourceAlias:{kind:'PLAIN',physicalRoot:sourceRoot,targetIdentity:sourceDirectoryIdentity(sourceRoot)}};
}

test('documented proposal is inspectable but cannot activate; exact approved version never implies full-day readiness',()=>{
  const runtimeRoot=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-doc-proposal-')),dataRoot=path.join(runtimeRoot,'data'),head='a'.repeat(40);
  const binding=proposal(runtimeRoot,dataRoot,head),options={runtimeRoot,head,approvedMain:head};
  assert.equal(template.state,'PROPOSED');assert.equal(template.ownerDecisionUrl,undefined);
  assert.equal(validateRuntimeBinding(binding,options).activationReady,false);
  assert.throws(()=>validateRuntimeBinding(binding,{...options,activation:true}),/OWNER_MAIN_GATE/);
  const approved={...binding,state:'OWNER_APPROVED',ownerDecisionUrl:'https://linear.app/example/issue/EXAMPLE-1'};
  const result=validateRuntimeBinding(approved,{...options,activation:true});
  assert.equal(result.activationReady,true);assert.equal(result.fullDayReady,false);
  for(const [patch,error] of [
    [{runtimeCommit:'b'.repeat(40)},/HEAD_MISMATCH/],
    [{dataRoot:path.resolve('different-collector-root')},/EXISTING_DATA_ROOT/],
    [{sourceRoot:path.join(dataRoot,'another-source')},/READER_WRITER_SOURCE_MISMATCH/],
    [{readerRoot:path.join(dataRoot,'another-output')},/READER_WRITER_SOURCE_MISMATCH/],
    [{outputRoot:path.join(dataRoot,'another-output')},/OUTPUT_ROOT/],
    [{producer:'UNREVIEWED'},/OUTPUT_VERSION|UNREVIEWED_PRODUCER/],
    [{executionAuthorized:true},/CONTRACT/],
    [{ownerDecisionUrl:'https://example.com/approval'},/OWNER_MAIN_GATE/],
  ])assert.throws(()=>validateRuntimeBinding({...approved,...patch},{...options,activation:true}),error);
  assert.throws(()=>validateRuntimeBinding(approved,{...options,approvedMain:'b'.repeat(40),activation:true}),/OWNER_MAIN_GATE/);
});

test('inspection CLI reads a persisted proposal without creating output or changing it; activation refuses that proposal',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-binding-contract-'));
  try{
    const head=readRuntimeIdentity(repo).commit;assert.match(head,/^[a-f0-9]{40}$/);
    const dataRoot=path.join(path.resolve(repo),'data'),file=path.join(dir,'proposal.json');
    const outputRoot=path.join(dataRoot,'cru55-runtime','output',template.outputVersion),outputExisted=fs.existsSync(outputRoot);
    const bytes=JSON.stringify(proposal(path.resolve(repo),dataRoot,head));fs.writeFileSync(file,bytes);
    const output=execFileSync(process.execPath,[path.join(repo,'scripts/inspect-cru55-runtime-binding.mjs'),file,'plan'],{encoding:'utf8',windowsHide:true});
    const result=JSON.parse(output);
    assert.equal(result.runtimeCommit,head);assert.equal(result.readerRoot,outputRoot);
    assert.equal(result.activationReady,false);assert.equal(result.fullDayReady,false);
    assert.equal(fs.readFileSync(file,'utf8'),bytes);assert.equal(fs.existsSync(outputRoot),outputExisted);
    assert.throws(()=>readRuntimeBinding(file,{runtimeRoot:repo,activation:true}),/OWNER_MAIN_GATE/);
    assert.throws(()=>execFileSync(process.execPath,[path.join(repo,'scripts/inspect-cru55-runtime-binding.mjs'),file,'activation-preflight'],{encoding:'utf8',windowsHide:true,stdio:'pipe'}),error=>error.status!==0&&String(error.stderr).includes('OWNER_MAIN_GATE'));
    assert.deepEqual(fs.readdirSync(dir),['proposal.json']);
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('activation rejects tracked unstaged and staged edits in an isolated real Git repository even at matching approved SHA',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-binding-dirty-'));
  try{
    const runtimeRoot=path.join(dir,'runtime');fs.mkdirSync(runtimeRoot);
    const git=args=>execFileSync('git',args,{cwd:runtimeRoot,encoding:'utf8',windowsHide:true,stdio:'pipe'}).trim();
    git(['init','--quiet']);
    const tracked=path.join(runtimeRoot,'source.mjs'),original='export const fixture = true;\n';
    fs.writeFileSync(tracked,original);git(['add','source.mjs']);
    git(['-c','user.name=CRU55 test','-c','user.email=cru55-test@example.invalid','-c','commit.gpgsign=false','commit','--quiet','-m','isolated binding fixture']);
    const head=git(['rev-parse','HEAD']);git(['update-ref','refs/remotes/origin/main',head]);
    const binding={...proposal(runtimeRoot,path.join(runtimeRoot,'data'),head),state:'OWNER_APPROVED',ownerDecisionUrl:'https://linear.app/example/issue/TEST-1'};
    const file=path.join(dir,'binding.json');fs.writeFileSync(file,JSON.stringify(binding));
    const read=()=>readRuntimeBinding(file,{runtimeRoot,activation:true});
    assert.equal(git(['status','--porcelain','--untracked-files=no']),'');
    assert.equal(read().activationReady,true);assert.equal(read().fullDayReady,false);

    fs.writeFileSync(tracked,'export const fixture = "unstaged mutation";\n');
    assert.match(git(['status','--porcelain','--untracked-files=no']),/M source\.mjs/);
    assert.throws(read,/TRACKED_CODE_DIRTY/);
    git(['add','source.mjs']);assert.throws(read,/TRACKED_CODE_DIRTY/);
    assert.equal(git(['rev-parse','HEAD']),head);assert.equal(git(['rev-parse','refs/remotes/origin/main']),head);

    // Restore only this test-owned file and index, without resetting any checkout.
    fs.writeFileSync(tracked,original);git(['add','source.mjs']);assert.equal(read().activationReady,true);
    fs.writeFileSync(path.join(runtimeRoot,'untracked-local-data.txt'),'fixture');
    assert.equal(read().activationReady,true); // the activation contract checks tracked code, not private untracked data
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

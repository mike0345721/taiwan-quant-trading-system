import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { REPO, PRIVATE_ROOT, BRANCH } from '../src/cvd-observation-isolation.mjs';
import { materializeCvdBatch } from '../src/cvd-observation-materializer.mjs';
import { stableJson } from '../src/cvd-observation-core.mjs';
import { prepareCvdChart } from '../src/cvd-chart-artifact.mjs';
import { prepareCvdRelationship } from '../src/cvd-relationship-artifact.mjs';
import { prepareCvdHandoff,loadCvdHandoff } from '../src/cvd-handoff-artifact.mjs';
import { handoffFixture } from './cvd-handoff-fixture.mjs';
const bootstrap = process.env.GITHUB_ACTIONS === 'true' && fs.lstatSync(path.join(REPO, '.git')).isDirectory();
if (bootstrap) {
  test('handoff artifact CI uses an independent real isolated worktree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'cru54-handoff-ci-')), clone = path.join(root,'primary'), candidate = path.join(root,'candidate');
    for (const args of [['clone','--no-hardlinks','--no-checkout',REPO,clone],['-C',clone,'checkout','--detach','HEAD']]) {
      const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true,timeout:30000}); assert.equal(r.status,0,r.stderr);
    }
    // A preceding CI suite can leave the source on BRANCH, which clone inherits.
    // Detach the private clone and reuse its branch if present; never mutate the source.
    const exists=spawnSync('git',['-C',clone,'show-ref','--verify','--quiet','refs/heads/'+BRANCH],{encoding:'utf8',windowsHide:true,timeout:30000});
    assert.ok([0,1].includes(exists.status),exists.stderr);
    const args=exists.status===0?['-C',clone,'worktree','add',candidate,BRANCH]:['-C',clone,'worktree','add','-b',BRANCH,candidate,'HEAD'];
    const added=spawnSync('git',args,{encoding:'utf8',windowsHide:true,timeout:30000});assert.equal(added.status,0,added.stderr);
    const r=spawnSync(process.execPath,['--test','tests/cvd-handoff-artifact.test.mjs'],{cwd:candidate,encoding:'utf8',windowsHide:true,timeout:300000});
    assert.equal(r.status,0,r.stdout+r.stderr); process.stdout.write(r.stdout);
  });
} else {
 test('sealed handoff binds accepted C, rejects corruption; atomic retry and startup perform no raw reads',()=>{
  const dir=path.join(PRIVATE_ROOT,'fixtures');fs.mkdirSync(dir,{recursive:true});const sources=[];
  function prepare(spec){const runId='handoff-test-'+crypto.randomUUID(),f=handoffFixture(spec),sourcePath=path.join(dir,runId+'.ndjson');fs.writeFileSync(sourcePath,f.rows.map(r=>stableJson(r)+'\n').join(''));sources.push(sourcePath);materializeCvdBatch({runId,sourcePath});const b=prepareCvdChart(runId);return prepareCvdRelationship(runId,b.bundleHash).bundleHash;}
  const prior=prepare({start:'2026-09-12T04:56:00+08:00',price:100}),current=prepare({});
  const originalWrite=fs.writeFileSync,originalOpen=fs.openSync;
  // All C prerequisites exist; D must never revisit either raw fixture.
  fs.openSync=(file,...args)=>{if(sources.includes(String(file)))throw Error('RAW_READ_FORBIDDEN');return originalOpen(file,...args);};
  try{
   fs.writeFileSync=(file,...args)=>{if(typeof file==='number'){originalWrite(file,'{');throw Error('INJECTED_PARTIAL_WRITE');}return originalWrite(file,...args);};
   try{assert.throws(()=>prepareCvdHandoff(prior,current),/INJECTED_PARTIAL_WRITE/);}finally{fs.writeFileSync=originalWrite;}
   const receipt=prepareCvdHandoff(prior,current);assert.equal(receipt.state.code,'CONFIRMED_CONTINUATION');
   const loaded=loadCvdHandoff(receipt.bundleHash);assert.equal(loaded.handoffs['1m'].gap.points,2);assert.equal(loaded.handoffs['1m'].evidenceKind,'SYNTHETIC_FIXTURE');
   assert.equal(prepareCvdHandoff(prior,current).bundleHash,receipt.bundleHash);
   const artifact=path.join(PRIVATE_ROOT,'handoff',receipt.bundleHash+'.json'),saved=fs.readFileSync(artifact);fs.writeFileSync(artifact,'{}');assert.throws(()=>loadCvdHandoff(receipt.bundleHash),/HANDOFF_BUNDLE_HASH_INVALID/);fs.writeFileSync(artifact,saved);
   const cfile=path.join(PRIVATE_ROOT,'relationship',current+'.json'),cb=fs.readFileSync(cfile);fs.writeFileSync(cfile,'{}');assert.throws(()=>loadCvdHandoff(receipt.bundleHash),/RELATIONSHIP_BUNDLE_INVALID/);fs.writeFileSync(cfile,cb);
   assert.throws(()=>loadCvdHandoff('../bad'),/BUNDLE_ID_INVALID/);
  }finally{fs.openSync=originalOpen;fs.writeFileSync=originalWrite;}
 });
}
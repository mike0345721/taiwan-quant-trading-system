import { needsIsolatedTest, runIsolatedTest } from './isolated-git-test-fixture.mjs';
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
import { prepareSessionContext,loadSessionContext } from '../src/cvd-session-context-artifact.mjs';
import { handoffFixture } from './cvd-handoff-fixture.mjs';
const bootstrap = needsIsolatedTest(REPO, BRANCH, 'cvd-session-context-artifact.test.mjs');
if (bootstrap) {
  test('synthetic cases exercise real guards in an independent worktree', () => {
    runIsolatedTest(REPO, BRANCH, 'cvd-session-context-artifact.test.mjs');
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
   try{assert.throws(()=>prepareSessionContext(prior,current),/INJECTED_PARTIAL_WRITE/);}finally{fs.writeFileSync=originalWrite;}
   const receipt=prepareSessionContext(prior,current);assert.equal(receipt.state.code,'CONFIRMED_CONTINUATION');
   const loaded=loadSessionContext(receipt.bundleHash);assert.equal(loaded.sessionContext.scope,'OBSERVED_SEGMENT_TO_NOW');assert.equal(loaded.sessionContext.evidence.deltaCvd,19);assert.equal(loaded.handoffs['4h'].current.evidence.deltaCvd,19);assert.equal(loaded.handoffs['1m'].gap.points,2);assert.equal(loaded.handoffs['1m'].evidenceKind,'SYNTHETIC_FIXTURE');
   assert.equal(prepareSessionContext(prior,current).bundleHash,receipt.bundleHash);
   const artifact=path.join(PRIVATE_ROOT,'session-context',receipt.bundleHash+'.json'),saved=fs.readFileSync(artifact);fs.writeFileSync(artifact,'{}');assert.throws(()=>loadSessionContext(receipt.bundleHash),/SESSION_CONTEXT_BUNDLE_HASH_INVALID/);fs.writeFileSync(artifact,saved);
   const cfile=path.join(PRIVATE_ROOT,'relationship',current+'.json'),cb=fs.readFileSync(cfile);fs.writeFileSync(cfile,'{}');assert.throws(()=>loadSessionContext(receipt.bundleHash),/RELATIONSHIP_BUNDLE_INVALID/);fs.writeFileSync(cfile,cb);
   assert.throws(()=>loadSessionContext('../bad'),/BUNDLE_ID_INVALID/);
  }finally{fs.openSync=originalOpen;fs.writeFileSync=originalWrite;}
 });
}
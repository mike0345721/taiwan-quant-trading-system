import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { REPO, PRIVATE_ROOT, BRANCH } from '../src/cvd-observation-isolation.mjs';
import { materializeCvdBatch } from '../src/cvd-observation-materializer.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { SAFETY, stableJson } from '../src/cvd-observation-core.mjs';
import { prepareCvdChart } from '../src/cvd-chart-artifact.mjs';
import { prepareCvdRelationship, loadCvdRelationship } from '../src/cvd-relationship-artifact.mjs';
const bootstrap = process.env.GITHUB_ACTIONS === 'true' && fs.lstatSync(path.join(REPO, '.git')).isDirectory();
if (bootstrap) {
  test('relationship artifact CI uses an independent real isolated worktree', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(),'cru54-relationship-ci-')), clone = path.join(root,'primary'), candidate = path.join(root,'candidate');
    for (const args of [['clone','--no-hardlinks','--no-checkout',REPO,clone],['-C',clone,'worktree','add','-b',BRANCH,candidate,'HEAD']]) {
      const r=spawnSync('git',args,{encoding:'utf8',windowsHide:true,timeout:30000}); assert.equal(r.status,0,r.stderr);
    }
    const r=spawnSync(process.execPath,['--test','tests/cvd-relationship-artifact.test.mjs'],{cwd:candidate,encoding:'utf8',windowsHide:true,timeout:300000});
    assert.equal(r.status,0,r.stdout+r.stderr); process.stdout.write(r.stdout);
  });
} else {
  test('isolated relationship preparation: exact source, A/B binding, atomic partial-write retry and startup never reads raw', () => {
    const runId='relationship-test-'+crypto.randomUUID(), dir=path.join(PRIVATE_ROOT,'fixtures'); fs.mkdirSync(dir,{recursive:true});
    let hash='GENESIS';
    const rows=Array.from({length:19},(_,i)=>{
      const stamp=new Date(Date.UTC(2026,8,14,1)+i*10000).toISOString();
      const r=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:stamp,...SAFETY,payload:{productFamily:'TX',actualContract:'TXFI6',tradeDate:'2026-09-14',session:'DAY',eventTime:stamp,datetime:stamp,close:100+i,volume:2,tick_type:1}},hash); hash=r.recordHash; return r;
    });
    const sourcePath=path.join(dir,runId+'.ndjson'), bytes=rows.map(r=>stableJson(r)+'\n').join(''); fs.writeFileSync(sourcePath,bytes);
    materializeCvdBatch({sourcePath,runId}); const b=prepareCvdChart(runId);
    const originalWrite=fs.writeFileSync;
    fs.writeFileSync=(file,...args)=>{if(typeof file==='number'){originalWrite(file,'{');throw Error('INJECTED_PARTIAL_WRITE');}return originalWrite(file,...args);};
    try { assert.throws(()=>prepareCvdRelationship(runId,b.bundleHash),/INJECTED_PARTIAL_WRITE/); } finally {fs.writeFileSync=originalWrite;}
    const receipt=prepareCvdRelationship(runId,b.bundleHash), loaded=loadCvdRelationship(receipt.bundleHash);
    assert.equal(loaded.relationships['1m'].current.relationship.code,'ALIGNED');
    assert.equal(loaded.relationships['1m'].current.current.deltaCvd,12);
    assert.equal(loaded.charts['1m'].generationHash,receipt.generationHash);
    fs.writeFileSync(sourcePath,bytes.replace('100','999'));
    assert.throws(()=>prepareCvdRelationship(runId,b.bundleHash),/PREFIX_MISMATCH/);
    const open=fs.openSync;
    fs.openSync=(file,...args)=>{if(String(file)===sourcePath)throw Error('RAW_READ_FORBIDDEN');return open(file,...args);};
    try { assert.equal(loadCvdRelationship(receipt.bundleHash).relationships['1m'].current.current.deltaCvd,12); } finally {fs.openSync=open;}
    const artifact=path.join(PRIVATE_ROOT,'relationship',receipt.bundleHash+'.json'), saved=fs.readFileSync(artifact);
    fs.writeFileSync(artifact,'{}');assert.throws(()=>loadCvdRelationship(receipt.bundleHash),/BUNDLE_INVALID/);fs.writeFileSync(artifact,saved);
    assert.throws(()=>loadCvdRelationship('../unsafe'),/BUNDLE_ID_INVALID/);
    const pointer=path.join(PRIVATE_ROOT,'output',runId,'latest.json'), before=fs.readFileSync(pointer);
    fs.writeFileSync(pointer,'{}');assert.throws(()=>loadCvdRelationship(receipt.bundleHash),/POINTER_INVALID/);fs.writeFileSync(pointer,before);
  });
}

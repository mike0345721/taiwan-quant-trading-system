import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { sessionFixture,calendar } from './cvd-session-context-fixture.mjs';
import { projectGeneration } from '../src/cru55-dynamic-projection.mjs';
import { createDynamicReader } from '../src/cru55-dynamic-reader.mjs';
import { digest,stableJson,SAFETY,createCvdCheckpoint,appendCvdRecords,cvdSemanticResult } from '../src/cvd-observation-core.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeCvdBatch } from '../src/cru55-dynamic-materializer.mjs';
import { PRIVATE_ROOT,isolatedRunRoot } from '../src/cru55-dynamic-isolation.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import { cvdChunks,deltaChunks,windowPresentation } from '../public/cru55-presentation.mjs';

test('accepted relationship preparation limit fails explicitly; no silent window reset or cap increase',()=>{
  assert.throws(()=>sessionFixture({count:1025}),/RELATIONSHIP_PREPARATION_BUDGET/);
});

test('accepted CVD delta/session/relationship share cutoff and conserve synthetic volume',()=>{
  const f=sessionFixture(),p=projectGeneration(f.g,f.rows,calendar),v=p.view;
  assert.equal(v.kind,'SYNTHETIC_FIXTURE');assert.equal(v.sessionContext.evidence.parity,'EXACT');
  assert.equal(projectGeneration({...f.g,sourceBinding:{path:'D:/repo/Fixtures/test.ndjson'}},f.rows,calendar).view.kind,'SYNTHETIC_FIXTURE');
  assert.equal(v.sessionContext.cumulativeCvd,19);
  for(const frame of Object.keys(v.charts)){
    assert.equal(v.charts[frame].currentCvd,19);
    assert.equal(v.relationships[frame].sourceCutoff.recordHash,v.charts[frame].cutoff.recordHash);
    assert.equal(v.relationships[frame].evidenceKind,'SYNTHETIC_FIXTURE');
    assert.ok(cvdChunks(v.charts[frame]).length);assert.ok(deltaChunks(v.charts[frame],v.relationships[frame]).length);
    assert.ok(windowPresentation(v.relationships[frame]).state);
  }
  assert.equal(v.handoffs['1m'].handoff.reason,'SESSION_SIDE_MISSING');
});
test('handoff is wired but refuses nonadjacent sources and accepts lawful synthetic pair',()=>{
  const prior=sessionFixture({start:'2026-09-14T13:40:00+08:00'}),current=sessionFixture({start:'2026-09-14T15:00:00+08:00'});
  const p=projectGeneration(prior.g,prior.rows,calendar),c=projectGeneration(current.g,current.rows,calendar,p);
  assert.equal(c.view.handoffs['1m'].pairing.state,'COMPARABLE');
  const wrong=sessionFixture({start:'2026-09-16T15:00:00+08:00'});
  assert.equal(projectGeneration(wrong.g,wrong.rows,calendar,p).view.handoffs['1m'].pairing.state,'NOT_COMPARABLE');
});
test('mixed ledger identities never pool price bars under active chart identity',()=>{
  const a=sessionFixture({count:3}),b=sessionFixture({start:'2026-09-14T15:00:00+08:00',count:3});
  let hash='GENESIS';const rows=[...a.rows,...b.rows].map(({recordHash,previousHash,...row})=>{const r=buildLiveEventRecord(row,hash);hash=r.recordHash;return r;});
  const source='sha256:'+digest('mixed'),resolverIdentity='test',resolveSessionTradeDate=t=>{const s=classifyTxChartSession(t,calendar);return {session:s.session,tradeDate:s.tradeDate};};
  const checkpoint=appendCvdRecords(createCvdCheckpoint(source,resolverIdentity),rows,{sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:0,resolveSessionTradeDate});
  const g={generationHash:digest(stableJson(rows)),result:cvdSemanticResult(checkpoint),sourceBinding:{path:'/fixtures/test.ndjson'}};
  const v=projectGeneration(g,rows,calendar).view;
  assert.equal(v.charts['1m'].segments.length,2);
  assert.ok(v.charts['1m'].bars.length>0);
  assert.ok(v.charts['1m'].bars.every(b=>b.session==='NIGHT'&&b.tradeDate==='2026-09-15'));
});
test('reader cache rechecks view/generation; corrupt, lagging and blocked publications fail closed',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-reader-'));
  try{
    const f=sessionFixture(),view=projectGeneration(f.g,f.rows,calendar).view;
    const body={schemaVersion:'cru55-dynamic-view-v1',generationHash:f.g.generationHash,view,...SAFETY};
    const a={...body,artifactHash:digest(stableJson(body))},pointer={artifactHash:a.artifactHash,generationHash:a.generationHash};
    for(const name of ['day','night']){
      const dir=path.join(root,name);fs.mkdirSync(dir);fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(pointer));
      fs.writeFileSync(path.join(dir,'view-latest.json'),JSON.stringify(pointer));fs.writeFileSync(path.join(dir,a.artifactHash+'.view.json'),JSON.stringify(a));
    }
    const read=createDynamicReader(root);assert.equal(read().chart.currentCvd,19);assert.equal(read().rawReadsPerRequest,0);
    assert.throws(()=>read({view:'night'}),/SESSION_OR_CUTOFF/);
    const dir=path.join(root,'day'),other={...pointer,generationHash:'0'.repeat(64)};
    fs.writeFileSync(path.join(dir,'latest.json'),JSON.stringify(other));assert.throws(()=>read(),/BEHIND/);
    fs.writeFileSync(path.join(dir,'view-latest.json'),JSON.stringify(other));assert.throws(()=>read(),/INVALID/);
    fs.writeFileSync(path.join(dir,'lifecycle-status.json'),JSON.stringify({state:'BLOCKED'}));assert.throws(()=>read(),/PRODUCER_BLOCKED/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

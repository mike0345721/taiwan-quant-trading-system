import { needsIsolatedTest, runIsolatedTest } from './isolated-git-test-fixture.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { sessionFixture } from './cvd-session-context-fixture.mjs';
import { materializeCvdBatch } from '../src/cru55-dynamic-materializer.mjs';
import { REPO,PRIVATE_ROOT,isolatedRunRoot } from '../src/cru55-dynamic-isolation.mjs';

const bootstrap = needsIsolatedTest(REPO, 'codex/cru55-formal-entry-recovery-v1', 'cru55-dynamic-local.test.mjs');
if (bootstrap) {
  test('dynamic checkpoint exercises real isolation in an independent worktree', () => {
    runIsolatedTest(REPO, 'codex/cru55-formal-entry-recovery-v1', 'cru55-dynamic-local.test.mjs');
  });
} else {
test('bounded candidate checkpoint continues exactly, ignores replay and rejects changed physical prefix',()=>{
  const id='test-'+process.pid+'-'+Date.now(),root=isolatedRunRoot(id),file=path.join(PRIVATE_ROOT,'fixtures',id+'.ndjson');
  fs.mkdirSync(path.dirname(file),{recursive:true});const f=sessionFixture({count:5});
  fs.writeFileSync(file,f.rows.map(r=>JSON.stringify(r)).join('\n')+'\n',{flag:'wx'});
  try{
    const first=materializeCvdBatch({sourcePath:file,runId:id,stopOrdinal:2});assert.equal(first.processedRecords,2);
    const second=materializeCvdBatch({sourcePath:file,runId:id,stopOrdinal:5});assert.equal(second.processedRecords,3);
    const again=materializeCvdBatch({sourcePath:file,runId:id,stopOrdinal:5});assert.equal(again.processedRecords,0);
    assert.match(second.generation.generationHash,/^[a-f0-9]{64}$/);
    assert.equal(again.generation.generationHash,second.generation.generationHash);
    const old=fs.readFileSync(file);old[10]=old[10]===65?66:65;fs.writeFileSync(file,old);
    assert.throws(()=>materializeCvdBatch({sourcePath:file,runId:id}),/PREFIX|GENERATION|RECORD|JSON|SOURCE/);
  }finally{
    fs.unlinkSync(file);
    const parent=path.resolve(PRIVATE_ROOT,'output')+path.sep;
    if(!path.resolve(root).startsWith(parent))throw Error('TEST_CLEANUP_OUTSIDE_ROOT');
    fs.rmSync(root,{recursive:true,force:true});
  }
});


}

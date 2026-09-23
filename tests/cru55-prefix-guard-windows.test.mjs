import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {protectPrefix,assertPrefixProtected,releasePrefixGuards} from '../src/cru55-prefix-guard.mjs';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY} from '../src/cvd-observation-core.mjs';
import {beginPriorVerification,advancePriorVerification,priorStillVerified} from '../src/cru55-stream-prior-verifier.mjs';
const windows={skip:process.platform!=='win32'};
function fixture(){
  const parent=path.resolve('data');fs.mkdirSync(parent,{recursive:true});
  const root=fs.mkdtempSync(path.join(parent,'cru55-prefix-test-')),source=path.join(root,'source.ndjson'),out=path.join(root,'output/night');
  return {root,source,out,cleanup(){releasePrefixGuards(out);releasePrefixGuards(root);const relative=path.relative(parent,fs.realpathSync(root));assert.ok(relative.startsWith('cru55-prefix-test-')&&!relative.includes(path.sep));fs.rmSync(root,{recursive:true,force:true});}};
}
function binding(file){const s=fs.statSync(file,{bigint:true});return {path:file,dev:String(s.dev),ino:String(s.ino),birthtimeNs:String(s.birthtimeNs)};}
function append(file,start,count,previous='GENESIS'){
  for(let i=start;i<start+count;i++){
    const at=new Date(Date.parse('2026-09-14T15:00:00+08:00')+i*1000).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:at,...SAFETY,payload:{productFamily:'TX',actualContract:'TXFI6',eventTime:at,datetime:at,close:20000,volume:1,tick_type:1}},previous);
    fs.appendFileSync(file,JSON.stringify(row)+'\n');previous=row.recordHash;
  }return previous;
}
test('shared prefix + mapped section permits CPython append; rejects writes, truncate and replacement on existing handles',windows,()=>{
  const f=fixture();fs.writeFileSync(f.source,'original\n');const fd=fs.openSync(f.source,'r+');
  try{
    const id=protectPrefix(f.root,'current',binding(f.source),9);
    const writer=spawnSync('python',['-c',"import os,sys; f=os.open(sys.argv[1],os.O_APPEND|os.O_CREAT|os.O_WRONLY); os.write(f,b'appended\\n'); os.close(f)",f.source],{encoding:'utf8',windowsHide:true});
    assert.equal(writer.status,0,writer.stderr);assert.equal(fs.readFileSync(f.source,'utf8'),'original\nappended\r\n');
    assert.throws(()=>fs.writeSync(fd,Buffer.from('X'),0,1,0));
    for(const n of [0,1,8,9,17])assert.throws(()=>fs.ftruncateSync(fd,n));
    assert.throws(()=>fs.renameSync(f.source,f.source+'.moved'));
    const replacement=path.join(f.root,'replacement');fs.writeFileSync(replacement,'foreign\n');assert.throws(()=>fs.renameSync(replacement,f.source));
    assert.equal(assertPrefixProtected(f.root,'current',id),true);
    releasePrefixGuards(f.root);assert.throws(()=>assertPrefixProtected(f.root,'current',id),/LEASE_LOST/);
    fs.ftruncateSync(fd,0);assert.equal(fs.fstatSync(fd).size,0);
  }finally{fs.closeSync(fd);f.cleanup();}
});
test('continuous appends publish ordered cutoffs without restarts; lost lease rechecks raw without replaying ingestion',windows,()=>{
  const f=fixture();let previous=append(f.source,0,1100),count=1100;
  const opts={sourcePath:f.source,runRoot:f.out,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2,maxVerifyRanges:2};
  try{
    const publications=[];let lastIngest=0;
    for(let cycle=0;cycle<250&&publications.length<3;cycle++){
      previous=append(f.source,count++,1,previous);const r=runStreamCycle(opts);
      assert.ok(r.endByteOffset>=lastIngest);lastIngest=r.endByteOffset;
      assert.equal(r.metrics.verificationRestarts,0);
      if(r.state==='PUBLISHED'){publications.push(r.cutoff.ledgerOrdinal);const a=JSON.parse(fs.readFileSync(path.join(f.out,r.artifactHash+'.stream-view.json')));assert.equal(a.view.charts['1m'].currentCvd,r.cutoff.ledgerOrdinal);}
    }
    assert.equal(publications.length,3);assert.ok(publications[0]<publications[1]&&publications[1]<publications[2]);
    let r;for(let i=0;i<100;i++){r=runStreamCycle(opts);const job=JSON.parse(fs.readFileSync(path.join(f.out,'job.json'))).value;if(job.phase==='VERIFY'&&job.verifyIndex>1)break;}
    const ingestBefore=fs.readFileSync(path.join(f.out,'ingest.json'),'utf8');
    releasePrefixGuards(f.out); // models lost OS protection; old disk cursor is unusable
    const fd=fs.openSync(f.source,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,10);}finally{fs.closeSync(fd);}
    assert.throws(()=>runStreamCycle(opts),/STREAM_RAW_PREFIX_CHANGED/);
    assert.equal(fs.readFileSync(path.join(f.out,'ingest.json'),'utf8'),ingestBefore);
  }finally{f.cleanup();}
});
test('growing adjacent prior verifies its full captured prefix, and lost protection invalidates its persisted cursor',windows,()=>{
  const f=fixture();let previous=append(f.source,0,1100);const opts={sourcePath:f.source,runRoot:f.out,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2,maxVerifyRanges:2};
  try{
    let publication;for(let i=0;i<100;i++){publication=runStreamCycle(opts);if(publication.state==='PUBLISHED')break;}
    assert.equal(publication.state,'PUBLISHED');
    const ref={artifactHash:publication.artifactHash,artifactPath:path.join(f.out,publication.artifactHash+'.stream-view.json')};
    let s=beginPriorVerification(ref),count=1100,total=0;
    const budget=()=>({canTake:()=>true,take(n){total+=n;}});
    while(!s.complete){
      previous=append(f.source,count++,1,previous);
      s=advancePriorVerification(s,{budget:budget(),maxRanges:1,protectionGroup:f.root}).state;
      assert.equal(s.restarts,0);
    }
    assert.equal(total,s.targetOffset);assert.ok(priorStillVerified(s,{protectionGroup:f.root}));
    releasePrefixGuards(f.root);
    const fd=fs.openSync(f.source,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,10);}finally{fs.closeSync(fd);}
    assert.throws(()=>advancePriorVerification(s,{budget:budget(),maxRanges:1,protectionGroup:f.root}),/STREAM_PRIOR_RAW_PREFIX_CHANGED/);
  }finally{f.cleanup();}
});

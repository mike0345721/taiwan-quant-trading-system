import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {validatePublicationSchedule} from '../src/cru55-publication-schedule.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY} from '../src/cvd-observation-core.mjs';
const schedule={version:'COMPLETE_RECORD_PREFIX_V1',maxRecords:256};
function setup(count=700,sessionBoundary=null){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-schedule-')),sourcePath=path.join(root,'raw.ndjson');
  let previous='GENESIS';const rows=[];
  for(let i=0;i<count;i++){
    const base=sessionBoundary!==null&&i>=sessionBoundary?'2026-09-15T08:45:00+08:00':'2026-09-14T15:00:00+08:00';
    const time=new Date(Date.parse(base)+i*1000).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:time,...SAFETY,payload:{_product_family:'TX',_target_code:'TXFI6',timestamp:time,close:20000+i%11,volume:1,tick_type:1}},previous);previous=row.recordHash;rows.push(JSON.stringify(row)+'\n');
  }
  fs.writeFileSync(sourcePath,rows.join(''));
  return {root,rows,options:{sourcePath,runRoot:path.join(root,'indexed'),sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:2,publicationSchedule:schedule},dispose(){assert.equal(path.dirname(root),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('cru55-schedule-'));fs.rmSync(root,{recursive:true,force:true});}};
}
function finish(options){for(let i=0;i<400;i++){const r=runStreamCycle(options);if(['PUBLISHED','UNCHANGED'].includes(r.state))return r;}throw Error('DID_NOT_SETTLE');}
function artifact(options,result){return JSON.parse(fs.readFileSync(path.join(options.runRoot,result.artifactHash+'.stream-view.json')));}
test('scheduled complete prefixes match FULL_SCAN at every cutoff, retain backlog and partial tail',()=>{
  const f=setup();try{
    fs.appendFileSync(f.options.sourcePath,'{"partial":');
    const oracle={...f.options,runRoot:path.join(f.root,'oracle'),projectionMode:'FULL_SCAN'};
    for(const cutoff of [256,512,700]){
      const a=finish(f.options),b=finish(oracle);assert.equal(a.cutoff.ledgerOrdinal,cutoff);assert.equal(a.ingestedOrdinal,cutoff);
      assert.deepEqual(artifact(f.options,a),artifact(oracle,b));
      const size=f.rows.slice(0,cutoff).join('').length;
      assert.equal(a.endByteOffset,size);assert.equal(a.metrics.projectionWork.rawVerificationBytes,size);
      assert.equal(a.metrics.publicationBacklogBytes,fs.statSync(f.options.sourcePath).size-size);
      assert.equal(artifact(f.options,a).view.charts['1m'].currentCvd,cutoff);
    }
  }finally{f.dispose();}
});
test('schedule changes reject active jobs and invalid configuration',()=>{
  const f=setup();try{
    runStreamCycle(f.options);
    assert.throws(()=>runStreamCycle({...f.options,publicationSchedule:null}),/STREAM_JOB_BINDING_CHANGED/);
    assert.throws(()=>runStreamCycle({...f.options,publicationSchedule:{...schedule,maxRecords:128}}),/STREAM_JOB_BINDING_CHANGED/);
    assert.throws(()=>validatePublicationSchedule({...schedule,maxRecords:32769}),/SCHEDULE_INVALID/);
    assert.throws(()=>validatePublicationSchedule({...schedule,version:'future'}),/SCHEDULE_INVALID/);
  }finally{f.dispose();}
});
test('session boundary precedes scheduled ceiling and next session preserves its own origin',()=>{
  const f=setup(300,100);try{
    const opts={...f.options,publishAtSessionBoundary:true};
    const first=finish(opts);assert.equal(first.cutoff.ledgerOrdinal,100);assert.equal(first.session,'NIGHT');
    const next=finish(opts);assert.equal(next.cutoff.ledgerOrdinal,300);assert.equal(next.session,'DAY');
    assert.equal(artifact(opts,next).view.charts['1m'].currentCvd,200);
    assert.equal(next.metrics.projectionWork.rawVerificationBytes,fs.statSync(opts.sourcePath).size);
  }finally{f.dispose();}
});
test('before ingest commit and before/after public pointer interruptions recover without recount',()=>{
  for(const stage of ['INGEST','BEFORE_PUBLIC','AFTER_PUBLIC']){
    const f=setup(),rename=fs.renameSync;let injected=false;
    try{
      fs.renameSync=(from,to)=>{
        const ingest=stage==='INGEST'&&to===path.join(f.options.runRoot,'ingest.json')&&fs.existsSync(path.join(f.options.runRoot,'pages/latest.json'));
        const pub=stage!=='INGEST'&&to===path.join(f.options.runRoot,'stream-public.json');
        if(!injected&&(ingest||pub)){injected=true;if(stage==='AFTER_PUBLIC')rename(from,to);throw Error('TEST_INTERRUPTED');}return rename(from,to);
      };
      assert.throws(()=>finish(f.options),/TEST_INTERRUPTED/);fs.renameSync=rename;assert.ok(injected);
      const first=finish(f.options);assert.equal(first.cutoff.ledgerOrdinal,256);
      assert.equal(artifact(f.options,first).view.charts['1m'].currentCvd,256);
      const second=finish(f.options);assert.equal(second.cutoff.ledgerOrdinal,512);
      assert.equal(artifact(f.options,second).view.charts['1m'].currentCvd,512);
    }finally{fs.renameSync=rename;f.dispose();}
  }
});
test('later scheduled publication still rejects rewritten original prefix',()=>{
  const f=setup();try{
    const first=finish(f.options),fd=fs.openSync(f.options.sourcePath,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,2);}finally{fs.closeSync(fd);}
    assert.throws(()=>finish(f.options),/STREAM_RAW_PREFIX_CHANGED/);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.runRoot,'stream-public.json'))).artifactHash,first.artifactHash);
    assert.equal(JSON.parse(fs.readFileSync(path.join(f.options.runRoot,'lifecycle-status.json'))).state,'BLOCKED');
  }finally{f.dispose();}
});


import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runStreamCycle,PIPELINE_LIMITS} from '../src/cru55-stream-pipeline.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY} from '../src/cvd-observation-core.mjs';

function finish(options){for(let i=0;i<500;i++){const r=runStreamCycle(options);if(['PUBLISHED','UNCHANGED'].includes(r.state))return r;}throw Error('TEST_PIPELINE_DID_NOT_SETTLE');}
test('multiple new cutoffs produce byte-exact full-scan products while processing only appended records',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-indexed-oracle-')),sourcePath=path.join(root,'raw.ndjson');
  const options={sourcePath,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:2};
  let hash='GENESIS',ordinal=0;
  const append=(count,kind='futures_tick')=>{
    const lines=[];
    for(let n=0;n<count;n++,ordinal++){
      const clock=Date.parse('2026-09-14T15:00:00+08:00')+ordinal*20000;
      const event=new Date(clock).toISOString();
      const row=buildLiveEventRecord({kind,code:'TXFI6',receivedAt:new Date(clock+1).toISOString(),...SAFETY,
        payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',session:'NIGHT',tradeDate:'2026-09-15',eventTime:event,datetime:event,close:20000+ordinal%11,volume:1,tick_type:ordinal%3,bid_price:[19999],ask_price:[20001]}},hash);
      hash=row.recordHash;lines.push(JSON.stringify(row));
    }fs.appendFileSync(sourcePath,lines.join('\n')+'\n');
  };
  try{
    for(const [count,kind] of [[300,'futures_tick'],[19,'futures_tick'],[37,'futures_tick'],[1,'futures_bidask'],[131,'futures_tick']]){
      append(count,kind);
      const indexed=finish({...options,runRoot:path.join(root,'indexed')}),oracle=finish({...options,runRoot:path.join(root,'oracle'),projectionMode:'FULL_SCAN'});
      assert.equal(indexed.cutoff.ledgerOrdinal,ordinal);assert.equal(oracle.cutoff.ledgerOrdinal,ordinal);
      const actual=JSON.parse(fs.readFileSync(path.join(root,'indexed',indexed.artifactHash+'.stream-view.json')));
      const expected=JSON.parse(fs.readFileSync(path.join(root,'oracle',oracle.artifactHash+'.stream-view.json')));
      assert.deepEqual(actual,expected,'all products and publication history exact at '+ordinal);
      const packed=finish({...options,maxPages:8,indexLayout:'DERIVED_INDEX_PACK_V1',runRoot:path.join(root,'packed')});
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root,'packed',packed.artifactHash+'.stream-view.json'))),expected,'packed products exact at '+ordinal);
      assert.equal(packed.metrics.projectionWork.newRecords,count);
      assert.ok(packed.metrics.projectionWork.packs.maxArchivePages<=7);
      const c=indexed.metrics.projectionWork;
      assert.equal(c.processedRecords,count);assert.equal(c.newRecords,count);assert.equal(c.historicalReplayRecords,0);
      assert.equal(c.rebuildReason,ordinal===300?'INITIAL_BUILD':null);
      assert.equal(c.rangeQueries,213);assert.ok(c.aggregateNodes>0);
      assert.equal(c.rawVerificationBytes,fs.statSync(sourcePath).size);
      assert.equal(oracle.metrics.projectionWork.processedRecords,ordinal);
      assert.equal(oracle.metrics.projectionWork.newRecords,count);
      assert.equal(oracle.metrics.projectionWork.historicalReplayRecords,ordinal-count);
      t.diagnostic(JSON.stringify({cutoff:ordinal,append:count,indexed:c,oracleRecords:oracle.metrics.projectionWork.processedRecords,artifactExact:true}));
    }
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('oversized query and collision pages fail closed before budget or content reads',()=>{
  for(const phase of ['QUERY','COLLISION']){
    const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-indexed-invalid-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'indexed');
    const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:2};
    let hash='GENESIS';const rows=[];
    for(let n=0;n<270;n++){const time=new Date(Date.parse('2026-09-14T15:00:00+08:00')+n*1000).toISOString();const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:time,...SAFETY,payload:{_product_family:'TX',_target_code:'TXFI6',timestamp:time,close:20000+n%11,volume:1,tick_type:1}},hash);hash=row.recordHash;rows.push(JSON.stringify(row));}
    fs.writeFileSync(sourcePath,rows.join('\n')+'\n');
    const link=fs.linkSync,read=fs.readFileSync;let target=null,contentReads=0;
    try{
      if(phase==='COLLISION'){
        fs.linkSync=(from,to)=>{const result=link(from,to);if(!target&&path.basename(path.dirname(to))==='projection-index'){target=to;throw Error('TEST_ORPHAN_INDEX');}return result;};
        assert.throws(()=>finish(opts),/TEST_ORPHAN_INDEX/);fs.linkSync=link;
      }else{
        for(let i=0;i<100;i++){runStreamCycle(opts);const job=JSON.parse(read(path.join(runRoot,'job.json'))).value;if(job.phase==='QUERY'&&job.indexQuery.cursor?.stack.length){target=path.join(runRoot,'projection-index',job.indexQuery.cursor.stack.at(-1).ref.hash+'.json');break;}}
      }
      assert.ok(target);fs.truncateSync(target,PIPELINE_LIMITS.bytes+1);
      fs.readFileSync=(file,...args)=>{if(file===target)contentReads++;return read(file,...args);};
      assert.throws(()=>finish(opts),/STREAM_PIPELINE_FILE_INVALID/);assert.equal(contentReads,0);
      assert.equal(JSON.parse(read(path.join(runRoot,'lifecycle-status.json'))).state,'BLOCKED');
      assert.equal(fs.existsSync(path.join(runRoot,'stream-public.json')),false);
    }finally{fs.linkSync=link;fs.readFileSync=read;fs.rmSync(root,{recursive:true,force:true});}
  }
});

test('durable index collision after interruption is budgeted and resumes the previous complete page',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-indexed-recovery-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'indexed');
  const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:2};
  let hash='GENESIS';const rows=[];
  for(let n=0;n<270;n++){const time=new Date(Date.parse('2026-09-14T15:00:00+08:00')+n*1000).toISOString();const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:time,...SAFETY,payload:{_product_family:'TX',_target_code:'TXFI6',timestamp:time,close:20000+n%11,volume:1,tick_type:1}},hash);hash=row.recordHash;rows.push(JSON.stringify(row));}
  fs.writeFileSync(sourcePath,rows.join('\n')+'\n');
  const link=fs.linkSync,read=fs.readFileSync;let injected=false,collisions=0;
  try{
    fs.linkSync=(from,to)=>{const result=link(from,to);if(!injected&&path.basename(path.dirname(to))==='projection-index'){injected=true;throw Error('TEST_INDEX_DURABLE_JOB_NOT_COMMITTED');}return result;};
    assert.throws(()=>finish(opts),/TEST_INDEX_DURABLE_JOB_NOT_COMMITTED/);assert.ok(injected);fs.linkSync=link;
    let result;
    for(let i=0;i<100;i++){
      let bytes=0,pages=0;
      fs.readFileSync=(file,...args)=>{const value=read(file,...args);if(typeof file==='string'&&path.basename(path.dirname(file))==='projection-index'){bytes+=Buffer.byteLength(value);pages++;collisions++;}return value;};
      result=runStreamCycle(opts);fs.readFileSync=read;
      assert.ok(result.metrics.bytes>=bytes);assert.ok(result.metrics.pages>=pages);assert.ok(result.metrics.pages<=2);
      if(result.state==='PUBLISHED')break;
    }
    assert.equal(result.state,'PUBLISHED');assert.ok(collisions>0);
    const expected=finish({...opts,runRoot:path.join(root,'oracle'),projectionMode:'FULL_SCAN'});
    assert.deepEqual(JSON.parse(read(path.join(runRoot,result.artifactHash+'.stream-view.json'))),JSON.parse(read(path.join(root,'oracle',expected.artifactHash+'.stream-view.json'))));
  }finally{fs.linkSync=link;fs.readFileSync=read;fs.rmSync(root,{recursive:true,force:true});}
});

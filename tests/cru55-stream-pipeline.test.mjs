import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {createDynamicReader} from '../src/cru55-dynamic-reader.mjs';
import {prepareFormalEntry} from '../src/cru55-formal-entry.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {SAFETY} from '../src/cvd-observation-core.mjs';
const baseTime=Date.parse('2026-09-14T15:00:00+08:00');
function append(source,start,count,previous='GENESIS'){
  const fd=fs.openSync(source,'a');
  try{for(let i=start;i<start+count;i++){
    const t=new Date(baseTime+i*20000).toISOString(),row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(baseTime+i*20000+1).toISOString(),...SAFETY,
      payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',session:'NIGHT',tradeDate:'2026-09-15',eventTime:t,datetime:t,close:20000+i%11,volume:1,tick_type:1}},previous);
    fs.writeSync(fd,JSON.stringify(row)+'\n');previous=row.recordHash;
  }}finally{fs.closeSync(fd);}return previous;
}
function finish(options){let r;for(let n=0;n<200;n++){r=runStreamCycle(options);if(['PUBLISHED','UNCHANGED','WAITING_FOR_COMPLETE_RECORD'].includes(r.state))return r;}throw Error('TEST_PIPELINE_DID_NOT_SETTLE');}
test('Windows lifecycle and page pointer sharing contention recover without recount',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-retry-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out'),rename=fs.renameSync;
  const retries=new Map();append(sourcePath,0,20);
  try{t.mock.method(fs,'renameSync',(from,to)=>{if(['lifecycle-status.json','latest.json'].includes(path.basename(to))&&!retries.has(to)){retries.set(to,1);throw Object.assign(Error('transient-sharing'),{code:'EPERM'});}return rename(from,to);});
    const done=finish({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP'});assert.equal(done.cutoff.ledgerOrdinal,20);assert.equal(retries.size,2);assert.equal(JSON.parse(fs.readFileSync(path.join(runRoot,done.artifactHash+'.stream-view.json'))).view.charts['1m'].currentCvd,20);
  }finally{t.mock.restoreAll();fs.rmSync(root,{recursive:true,force:true});}
});
test('publication rechecks a changed raw stamp after a sharing delay before exposing the pointer',{skip:process.platform!=='win32'},t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-retry-stamp-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out'),rename=fs.renameSync;
  let previous=append(sourcePath,0,20),attempts=0;const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP'};
  try{const first=finish(opts);previous=append(sourcePath,20,1,previous);
    t.mock.method(fs,'renameSync',(from,to)=>{if(to===path.join(runRoot,'stream-public.json')&&++attempts===1){previous=append(sourcePath,21,1,previous);throw Object.assign(Error('sharing'),{code:'EPERM'});}return rename(from,to);});
    let pending;for(let i=0;i<40;i++){pending=runStreamCycle(opts);if(pending.reason==='SOURCE_CHANGED_DURING_VERIFY')break;}
    assert.equal(pending.reason,'SOURCE_CHANGED_DURING_VERIFY');assert.equal(attempts,1);assert.equal(JSON.parse(fs.readFileSync(path.join(runRoot,'stream-public.json'))).artifactHash,first.artifactHash);
    t.mock.restoreAll();const next=finish(opts);const final=next.cutoff.ledgerOrdinal===22?next:finish(opts);assert.equal(final.cutoff.ledgerOrdinal,22);assert.equal(JSON.parse(fs.readFileSync(path.join(runRoot,final.artifactHash+'.stream-view.json'))).view.charts['1m'].currentCvd,22);
  }finally{t.mock.restoreAll();fs.rmSync(root,{recursive:true,force:true});}
});
test('projection batch seals consumed pages before a later work-budget interruption',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-batch-resume-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out');
  const readFile=fs.readFileSync;
  try{
    append(sourcePath,0,500);const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:2};
    let job;
    for(let i=0;i<100;i++){runStreamCycle(opts);job=JSON.parse(readFile(path.join(runRoot,'job.json'))).value;if(job.phase==='PROJECT')break;}
    assert.equal(job.phase,'PROJECT');const before=job.nextIndex;let reads=0;
    fs.readFileSync=(file,...args)=>{if(String(file).endsWith('.page.json')&&++reads===2)throw Error('STREAM_WORK_BUDGET_PENDING');return readFile(file,...args);};
    const pending=runStreamCycle({...opts,maxPages:8});assert.equal(pending.reason,'WORK_BUDGET');
    fs.readFileSync=readFile;
    const saved=JSON.parse(readFile(path.join(runRoot,'job.json'))).value;
    assert.equal(saved.nextIndex,before+1);assert.equal(saved.projection.nextOrdinal,job.projection.nextOrdinal+128);
    const done=finish(opts),artifact=JSON.parse(readFile(path.join(runRoot,done.artifactHash+'.stream-view.json')));
    assert.equal(artifact.view.charts['1m'].currentCvd,500);assert.equal(artifact.view.charts['1m'].display.inputPoints,500);
  }finally{fs.readFileSync=readFile;fs.rmSync(root,{recursive:true,force:true});}
});
test('interrupted first immutable page resumes only from the exact durable raw pending batch',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-first-')),sourcePath=path.join(root,'source.ndjson'),runRoot=path.join(root,'out/night');
  const rename=fs.renameSync;append(sourcePath,0,20);const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE'};
  try{
    fs.renameSync=(from,to)=>{if(to===path.join(runRoot,'pages/latest.json'))throw Error('TEST_FIRST_POINTER_INTERRUPTED');return rename(from,to);};
    assert.throws(()=>runStreamCycle(opts),/TEST_FIRST_POINTER_INTERRUPTED/);fs.renameSync=rename;
    assert.equal(fs.existsSync(path.join(runRoot,'pages/latest.json')),false);
    assert.equal(fs.existsSync(path.join(runRoot,'pending.json')),true);
    const result=finish(opts);assert.equal(result.cutoff.ledgerOrdinal,20);
    assert.equal(createDynamicReader(path.dirname(runRoot))({view:'night'}).chart.currentCvd,20);
  }finally{fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true});}
});
test('new chain >1024 snapshots reaches six windows and protected API, then restart/appended source advances without recount',async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-chain-')),sourcePath=path.join(root,'source.ndjson'),output=path.join(root,'out'),runRoot=path.join(output,'night');
  let previous=append(sourcePath,0,1100);const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2,maxVerifyRanges:2};
  try{
    const a=finish(opts);assert.equal(a.state,'PUBLISHED');
    let read=createDynamicReader(output),data=read({view:'night'});
    assert.equal(data.chart.currentCvd,1100);assert.equal(data.chart.display.inputPoints,1100);assert.equal(data.integrity.originalRawPrefixVerified,true);assert.equal(Object.keys(data.scan).length,6);assert.ok(data.chart.bars.length>300);assert.ok(data.chart.vwap.length>300);
    const before=process.env.CRU55_DYNAMIC_ROOT;process.env.CRU55_DYNAMIC_ROOT=output;
    const handler=prepareFormalEntry({publicDir:path.resolve('public')},()=>null);if(before===undefined)delete process.env.CRU55_DYNAMIC_ROOT;else process.env.CRU55_DYNAMIC_ROOT=before;
    const server=http.createServer(async(req,res)=>{if(!await handler(req,res,new URL(req.url,'http://localhost'),()=>{if(req.headers.authorization==='fixture-session')return true;res.writeHead(401);res.end();return false;})){res.writeHead(404);res.end();}});
    await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port+'/api/v1/cvd-overview?view=night&timeframe=';
    try{
      assert.equal((await fetch(url+'1m')).status,401);
      for(const frame of ['1m','5m','15m','30m','1h','4h']){const response=await fetch(url+frame,{headers:{authorization:'fixture-session'}});assert.equal(response.status,200);const x=await response.json();assert.equal(x.chart.currentCvd,1100);assert.equal(x.chart.cutoff.recordHash,previous);assert.equal(x.chart.projectionHash,x.relationship.projectionHash);assert.equal(x.rawReadsPerRequest,0);assert.equal(x.chart.timeframe,frame);}
      previous=append(sourcePath,1100,200,previous);
      const partial=runStreamCycle({...opts,maxPages:2,maxVerifyRanges:2});assert.equal(partial.state,'PENDING');
      const b=finish(opts);assert.equal(b.state,'PUBLISHED');assert.notEqual(b.artifactHash,a.artifactHash);
      read=createDynamicReader(output);data=read({view:'night',timeframe:'4h'});assert.equal(data.chart.currentCvd,1300);assert.equal(data.chart.cutoff.recordHash,previous);assert.equal(data.chart.display.inputPoints,1300);
      const x=await(await fetch(url+'4h',{headers:{authorization:'fixture-session'}})).json();assert.equal(x.chart.currentCvd,1300);assert.equal(x.chart.cutoff.ledgerOrdinal,1300);
      assert.equal(finish(opts).state,'UNCHANGED');assert.equal(createDynamicReader(output)({view:'night'}).chart.currentCvd,1300);
    }finally{await new Promise(r=>server.close(r));}
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});
test('legacy stamp mode fails closed on raw rewrite and conservatively restarts on append',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-integrity-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out','night');
  try{
    const previous=append(sourcePath,0,1100),opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2,maxVerifyRanges:2,prefixProtection:'STAMP'};finish(opts);
    let r;for(let i=0;i<100;i++){r=runStreamCycle(opts);if(r.phase==='VERIFY')break;}assert.equal(r.phase,'VERIFY');
    append(sourcePath,1100,1,previous);r=runStreamCycle(opts);assert.equal(r.state,'PENDING');assert.ok(r.metrics.verificationRestarts>0);
    const fd=fs.openSync(sourcePath,'r+');try{fs.writeSync(fd,Buffer.from('X'),0,1,10);}finally{fs.closeSync(fd);}
    assert.throws(()=>finish(opts),/STREAM_RAW_PREFIX_CHANGED/);
    assert.throws(()=>createDynamicReader(path.dirname(runRoot))({view:'night'}),/CRU55_PRODUCER_BLOCKED/);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('unchanged cutoff reuses projection but still rereads every raw byte and refuses prefix mutation',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-reuse-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out','night');
  const read=fs.readSync,open=fs.openSync,close=fs.closeSync,readFile=fs.readFileSync;const fds=new Set();let rawBytes=0,pageReads=0;
  try{
    append(sourcePath,0,300);const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP'};
    const first=finish(opts),before=fs.readFileSync(path.join(runRoot,first.artifactHash+'.stream-view.json'));
    fs.openSync=(p,...args)=>{const fd=open(p,...args);if(p===sourcePath)fds.add(fd);return fd;};
    fs.closeSync=fd=>{fds.delete(fd);return close(fd);};
    fs.readSync=(fd,...args)=>{const n=read(fd,...args);if(fds.has(fd))rawBytes+=n;return n;};
    fs.readFileSync=(p,...args)=>{if(String(p).endsWith('.page.json'))pageReads++;return readFile(p,...args);};
    const next=finish(opts);assert.equal(next.state,'UNCHANGED');assert.equal(next.artifactHash,first.artifactHash);
    assert.equal(rawBytes,fs.statSync(sourcePath).size);assert.equal(pageReads,1);
    assert.deepEqual(fs.readFileSync(path.join(runRoot,next.artifactHash+'.stream-view.json')),before);
    const fd=fs.openSync(sourcePath,'r+');fs.writeSync(fd,Buffer.from('X'),0,1,10);fs.closeSync(fd);
    assert.throws(()=>finish(opts),/STREAM_RAW_PREFIX_CHANGED/);
  }finally{fs.readSync=read;fs.openSync=open;fs.closeSync=close;fs.readFileSync=readFile;fs.rmSync(root,{recursive:true,force:true});}
});

test('verification cursor is compact, resumes a sealed projection and rejects changed projection bytes',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-projection-ref-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out','night');
  try{
    append(sourcePath,0,500);const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',prefixProtection:'STAMP',maxPages:2,maxVerifyRanges:1};let job;
    for(let i=0;i<100;i++){runStreamCycle(opts);job=JSON.parse(fs.readFileSync(path.join(runRoot,'job.json'))).value;if(job.phase==='VERIFY')break;}
    assert.equal(job.phase,'VERIFY');assert.equal(job.projection,undefined);assert.match(job.projectionRef,/^[a-f0-9]{64}$/);
    assert.ok(fs.statSync(path.join(runRoot,'job.json')).size<10000);
    const file=path.join(runRoot,job.projectionRef+'.projection.json'),bytes=fs.readFileSync(file);
    const modified=JSON.parse(bytes);modified.contextInvalid=!modified.contextInvalid;fs.writeFileSync(file,JSON.stringify(modified));
    assert.throws(()=>finish(opts),/STREAM_PROJECTION_REFERENCE_CHANGED/);
    assert.equal(fs.existsSync(path.join(runRoot,'stream-public.json')),false);
  }finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('every actual raw range and archive/index page read shares the cycle byte budget; impossible budgets are rejected',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-budget-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out','night');
  append(sourcePath,0,300);
  const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2,maxVerifyRanges:2,maxBytes:5*1024*1024};
  assert.throws(()=>runStreamCycle({...opts,maxPages:1}),/STREAM_PIPELINE_BUDGET/);
  assert.throws(()=>runStreamCycle({...opts,maxBytes:512*1024}),/STREAM_PIPELINE_BUDGET/);
  const open=fs.openSync,close=fs.closeSync,read=fs.readSync,readFile=fs.readFileSync;const sourceFds=new Set();let rawBytes=0,pageBytes=0,pageReads=0;
  fs.openSync=(file,...args)=>{const fd=open(file,...args);if(file===sourcePath)sourceFds.add(fd);return fd;};
  fs.closeSync=(fd,...args)=>{sourceFds.delete(fd);return close(fd,...args);};
  fs.readSync=(fd,...args)=>{const n=read(fd,...args);if(sourceFds.has(fd))rawBytes+=n;return n;};
  fs.readFileSync=(file,...args)=>{const value=readFile(file,...args);if(typeof file==='string'&&(file.endsWith('.page.json')||path.basename(path.dirname(file))==='projection-index')){pageReads++;pageBytes+=Buffer.byteLength(value);}return value;};
  try{
    let result;for(let i=0;i<100;i++){
      rawBytes=pageBytes=pageReads=0;result=runStreamCycle(opts);
      assert.equal(result.metrics.bytes,rawBytes+pageBytes);assert.equal(result.metrics.pages,pageReads);
      assert.ok(result.metrics.bytes<=opts.maxBytes);assert.ok(pageReads<=opts.maxPages);
      if(result.state==='PUBLISHED')break;
    }assert.equal(result.state,'PUBLISHED');
  }finally{fs.openSync=open;fs.closeSync=close;fs.readSync=read;fs.readFileSync=readFile;fs.rmSync(root,{recursive:true,force:true});}
});

test('a calendar ledger publishes each observed session before moving on, without joining CVD origins',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-sessions-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out');
  let previous='GENESIS';const lines=[];
  for(const time of ['2026-09-14T08:45:00+08:00','2026-09-14T08:46:00+08:00','2026-09-14T15:00:00+08:00','2026-09-14T15:01:00+08:00']){
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(Date.parse(time)+1).toISOString(),...SAFETY,payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',eventTime:time,datetime:time,close:20000,volume:1,tick_type:1}},previous);previous=row.recordHash;lines.push(JSON.stringify(row));
  }
  fs.writeFileSync(sourcePath,lines.join('\n')+'\n');
  try{const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',publishAtSessionBoundary:true};const day=finish(opts),night=finish(opts);assert.equal(day.session,'DAY');assert.equal(day.cutoff.ledgerOrdinal,2);assert.equal(night.session,'NIGHT');assert.equal(night.cutoff.ledgerOrdinal,4);assert.notEqual(day.artifactHash,night.artifactHash);assert.equal(JSON.parse(fs.readFileSync(path.join(runRoot,night.artifactHash+'.stream-view.json'))).view.charts['1m'].currentCvd,2);}
  finally{fs.rmSync(root,{recursive:true,force:true});}
});

test('session boundary survives interruption after ingest commit and uses accepted timestamp/ignored-record rules',()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-boundary-recovery-')),sourcePath=path.join(root,'raw.ndjson'),runRoot=path.join(root,'out');
  let previous='GENESIS';const lines=[];
  const entries=[
    {event:'2026-09-14T09:00:00+08:00',received:'2026-09-14T15:00:00.001+08:00'},
    {event:'2026-09-14T14:00:00+08:00',received:'2026-09-14T15:00:00.002+08:00',duplicate:true},
    {event:'2026-09-14T14:00:00+08:00',received:'2026-09-14T15:00:00.003+08:00',simtrade:true},
    {event:'2026-09-14T15:01:00+08:00',received:'2026-09-14T15:01:00.001+08:00'},
  ];
  for(const e of entries){const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:e.received,...(e.duplicate?{duplicate:true}:{}),...SAFETY,payload:{_product_family:'TX',_target_code:'TXFI6',timestamp:e.event,close:20000,volume:1,tick_type:1,...(e.simtrade?{simtrade:true}:{})}},previous);previous=row.recordHash;lines.push(JSON.stringify(row));}
  fs.writeFileSync(sourcePath,lines.join('\n')+'\n');
  const rename=fs.renameSync;let injected=false;
  fs.renameSync=(from,to)=>{const result=rename(from,to);if(!injected&&to===path.join(runRoot,'ingest.json')&&JSON.parse(fs.readFileSync(to)).value.index===1){injected=true;throw Error('TEST_INTERRUPTED_AFTER_INGEST');}return result;};
  const opts={sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',publishAtSessionBoundary:true};
  try{
    assert.throws(()=>finish(opts),/TEST_INTERRUPTED_AFTER_INGEST/);assert.equal(injected,true);fs.renameSync=rename;
    const day=finish(opts);assert.equal(day.session,'DAY');assert.equal(day.cutoff.ledgerOrdinal,3);
    const night=finish(opts);assert.equal(night.session,'NIGHT');assert.equal(night.cutoff.ledgerOrdinal,4);
  }finally{fs.renameSync=rename;fs.rmSync(root,{recursive:true,force:true});}
});

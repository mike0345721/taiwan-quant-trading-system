import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {spawn,fork} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {once} from 'node:events';
import {runStreamCycle} from '../src/cru55-stream-pipeline.mjs';
import {releasePrefixGuards} from '../src/cru55-prefix-guard.mjs';
import {prepareFormalEntry} from '../src/cru55-formal-entry.mjs';
import {SAFETY} from '../src/cvd-observation-core.mjs';
const repo=fileURLToPath(new URL('../',import.meta.url)),[name,mode]=process.argv.slice(2);
if(!/^continuous-[a-z0-9-]+$/.test(name??''))throw Error('ISOLATED_RUN_NAME_REQUIRED');
const root=path.join(repo,'data/cru55-prefix-acceptance',name),output=path.join(root,'output'),runRoot=path.join(output,'night');
const sourcePath=path.join(root,'source/2026-09-14.ndjson'),read=p=>JSON.parse(fs.readFileSync(p,'utf8'));
if(mode==='--worker'){
  if(!fs.existsSync(path.join(root,'fixture-authorized')))throw Error('ISOLATED_FIXTURE_REQUIRED');
  try{
    for(;;){
      const result=runStreamCycle({sourcePath,runRoot,sourceKind:'SYNTHETIC_FIXTURE',maxPages:2});
      const job=fs.existsSync(path.join(runRoot,'job.json'))?read(path.join(runRoot,'job.json')).value:null;
      process.send({at:Date.now(),pid:process.pid,rss:process.memoryUsage().rss,result,verifyIndex:job?.verifyIndex??null,ingestOrdinal:read(path.join(runRoot,'ingest.json')).value.lastOrdinal});
      await new Promise(r=>setTimeout(r,100));
    }
  }finally{releasePrefixGuards(runRoot);}
}else{
  if(mode)throw Error('INVALID_MODE');
  fs.mkdirSync(root,{recursive:false});fs.writeFileSync(path.join(root,'fixture-authorized'),'synthetic only');
  const writer=spawn('python',[path.join(repo,'scripts/fixtures/cru55-continuous-writer.py'),root],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let writerError='';writer.stderr.on('data',b=>{writerError+=b;});
  const writerExit=once(writer,'exit');
  await new Promise((resolve,reject)=>{writer.stdout.on('data',b=>{if(b.toString().includes('"ready": true'))resolve();});writer.once('exit',code=>reject(Error('WRITER_EARLY_EXIT:'+code+':'+writerError)));});
  const cycles=[],publications=[],apiChecks=[];let worker,restarting=false,restarted=false,restart=null,workerError='',stopped=false;
  process.env.CRU55_DYNAMIC_ROOT=output;process.env.DASHBOARD_RUNTIME_COMMIT='ISOLATED_CONTINUOUS_PREFIX_CANDIDATE';
  const handler=prepareFormalEntry({publicDir:path.join(repo,'public')},()=>null),fixturePassword=crypto.randomUUID();
  const server=http.createServer(async(req,res)=>{
    const url=new URL(req.url,'http://localhost');
    const session=()=>{if((req.headers.cookie||'').includes('prefix_fixture=1'))return true;res.writeHead(401);res.end('{}');return false;};
    if(url.pathname==='/api/auth/login'&&req.method==='POST'){
      let body='';for await(const b of req)body+=b;if(JSON.parse(body).password!==fixturePassword){res.writeHead(401);res.end('{}');return;}
      res.writeHead(200,{'Content-Type':'application/json','Set-Cookie':'prefix_fixture=1; HttpOnly; SameSite=Strict; Path=/'});res.end('{}');return;
    }
    if(url.pathname==='/vendor/lightweight-charts.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(fs.readFileSync(path.join(repo,'node_modules/lightweight-charts/dist/lightweight-charts.standalone.production.js')));return;}
    try{if(await handler(req,res,url,session))return;res.writeHead(404);res.end();}catch(e){res.writeHead(500);res.end(JSON.stringify({reason:e.message}));}
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
  fs.writeFileSync(path.join(root,'browser.json'),JSON.stringify({url,fixturePassword}));
  console.log(JSON.stringify({root,url,fixturePassword}));
  async function checkApi(publication){
    const values=[];
    for(const frame of ['1m','5m','15m','30m','1h','4h']){
      const response=await fetch(url+'/api/v1/cvd-overview?view=night&timeframe='+frame,{headers:{cookie:'prefix_fixture=1'}}),data=await response.json();
      assert.equal(response.status,200);assert.equal(data.artifactHash,publication.artifactHash);assert.equal(data.chart.cutoff.ledgerOrdinal,publication.cutoff.ledgerOrdinal);assert.equal(data.chart.currentCvd,publication.cutoff.ledgerOrdinal);assert.equal(data.rawReadsPerRequest,0);assert.equal(data.chart.projectionHash,data.relationship.projectionHash);
      values.push({frame,artifactHash:data.artifactHash,cutoff:data.chart.cutoff.ledgerOrdinal,cvd:data.chart.currentCvd});
    }
    apiChecks.push({at:Date.now(),values});
  }
  let apiQueue=Promise.resolve();
  function startWorker(){
    worker=fork(fileURLToPath(import.meta.url),[name,'--worker'],{windowsHide:true,stdio:['ignore','pipe','pipe','ipc']});
    worker.stderr.on('data',b=>{workerError+=b;});
    worker.on('message',message=>{
      cycles.push(message);fs.appendFileSync(path.join(root,'cycles.jsonl'),JSON.stringify(message)+'\n');
      const r=message.result;
      if(r.state==='PUBLISHED'){
        publications.push({...r,publishedAt:message.at,pid:message.pid});
        console.log(JSON.stringify({published:r.cutoff.ledgerOrdinal,at:message.at,restarted,backlog:r.metrics.publicationBacklogBytes}));
        apiQueue=apiQueue.then(()=>checkApi(r));
      }
      if(publications.length>=2&&!restarted&&!restarting&&r.phase==='VERIFY'&&r.state==='PENDING'&&message.verifyIndex>1){
        restarting=true;restart={at:Date.now(),priorPid:worker.pid,ingestOrdinal:message.ingestOrdinal,verifyIndex:message.verifyIndex};
        worker.once('exit',()=>{restarted=true;restarting=false;startWorker();restart.newPid=worker.pid;});worker.kill();
      }
    });
    worker.on('exit',code=>{if(!stopped&&!restarting&&!restarted)workerError+='UNEXPECTED_WORKER_EXIT:'+code;});
  }
  startWorker();const started=Date.now();
  try{
    while(Date.now()-started<240000&&!fs.existsSync(path.join(root,'finish'))){
      if(writerError||workerError)throw Error(writerError+workerError);
      await new Promise(r=>setTimeout(r,250));
    }
    await apiQueue;
    assert.ok(publications.length>=4);assert.ok(restarted);
    for(let i=1;i<publications.length;i++)assert.ok(publications[i].cutoff.ledgerOrdinal>publications[i-1].cutoff.ledgerOrdinal);
    const writerRows=fs.readFileSync(path.join(root,'writer-metrics.jsonl'),'utf8').trim().split('\n').map(JSON.parse),byOrdinal=new Map(writerRows.map(x=>[x.ordinal,x]));
    const liveRows=writerRows.filter(x=>x.ordinal>1100);
    const ingestion=new Map();for(const c of cycles){for(const r of liveRows){if(r.ordinal<=c.ingestOrdinal&&!ingestion.has(r.ordinal))ingestion.set(r.ordinal,c.at);}}
    const timings=publications.map(p=>{const ordinal=p.cutoff.ledgerOrdinal,source=byOrdinal.get(ordinal),ingested=ingestion.get(ordinal);return {ordinal,publishedAt:p.publishedAt,sourceWrittenAt:source.sourceWrittenAtMs,ingestedAt:ingested??null,sourceToIngestionMs:ingested?ingested-source.sourceWrittenAtMs:null,ingestionToPublicationMs:ingested?p.publishedAt-ingested:null,sourceToPublicationMs:p.publishedAt-source.sourceWrittenAtMs,ingestionBacklogBytes:p.metrics.backlogBytes,publicationBacklogBytes:p.metrics.publicationBacklogBytes};});
    const receipt={schemaVersion:'cru55-protected-prefix-continuous-v1',kind:'SYNTHETIC_FIXTURE_REAL_WRITER_IO',elapsedMs:Date.now()-started,writerContinuedUntilAfterMeasurements:true,writerCount:writerRows.length,writerErrors:0,writeMsMax:Math.max(...liveRows.map(r=>r.writeMs)),writerGapMsMax:Math.max(...liveRows.slice(1).map((r,i)=>r.sourceWrittenAtMs-liveRows[i].sourceWrittenAtMs)),peakWorkerRss:Math.max(...cycles.map(c=>c.rss)),restart,verificationRestarts:Math.max(...cycles.map(c=>c.result.metrics.verificationRestarts)),publications:publications.map(p=>({artifactHash:p.artifactHash,cutoff:p.cutoff.ledgerOrdinal,cvd:p.cutoff.ledgerOrdinal,pid:p.pid})),timings,apiChecks,fullDayOperationalAcceptance:false,naturalLiveAcceptance:false,...SAFETY};
    fs.writeFileSync(path.join(root,'receipt.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify({receipt:path.join(root,'receipt.json'),publications:publications.length}));
  }finally{
    stopped=true;worker.kill();fs.writeFileSync(path.join(root,'stop-writer'),'stop');await writerExit;await new Promise(r=>server.close(r));
  }
}

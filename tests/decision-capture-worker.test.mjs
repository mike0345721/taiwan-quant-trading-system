import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {DatabaseSync} from 'node:sqlite';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {createTxChartService} from '../src/dashboard-tx-chart-service.mjs';
import {txChartHistoryPath} from '../src/dashboard-tx-chart-store.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {buildCru34LiveCheckpoint,cru34LiveCanonicalJson} from '../src/cru34-live-checkpoint.mjs';
import {observationDecisionSnapshot} from '../src/market-observation-journal.mjs';
import * as workspaceLibrary from '../src/dashboard-decision-workspace.mjs';
import * as marketChange from '../src/market-change-feed.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8'),server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const controllerSource=app.slice(app.indexOf('function decisionCaptureIdentity('),app.indexOf('function renderDecisionCaptureStatus('));
const builderSource=server.slice(server.indexOf('async function decisionWorkspacePayload('),server.indexOf('\nasync function currentDiscussionWorkspace('));
const envelopeSource=server.slice(server.indexOf('function decisionCaptureEnvelope('),server.indexOf('\nasync function loadMarketChangeFeed('));
const routeStart=server.indexOf("      if (req.method === 'GET' && pathname === '/api/v1/decision-capture') {");
const routeSource=server.slice(routeStart,server.indexOf("      if (req.method === 'GET' && pathname === '/api/v1/ask-gpt-context') {",routeStart));
const requestStart=app.indexOf('  request:',app.indexOf('const decisionCaptureController ='));
const requestSource=app.slice(requestStart+'  request:'.length,app.indexOf('\n',requestStart)).trim().replace(/,$/,'');

const scenarios=[... [false,true].flatMap(movingClock=>[false,true].map(warmupBeforeCopy=>({movingClock,warmupBeforeCopy}))),
  {movingClock:false,warmupBeforeCopy:true,interleave:'unchanged'},
  ...['append','append-displayed','append-warming'].map(interleave=>({movingClock:false,warmupBeforeCopy:true,interleave})),
  ...['store-edit','source-truncate','source-rewrite','source-identity','interior-before-poll','interior-after-poll'].map(tamper=>({movingClock:false,warmupBeforeCopy:true,interleave:'append',tamper}))];
for(const {movingClock,warmupBeforeCopy,interleave,tamper} of scenarios)test(`one real controller action advances native worker via actual capture handler within its original deadline; warmup=${warmupBeforeCopy}; movingClock=${movingClock}; interleave=${interleave??'none'}; tamper=${tamper??'none'}`, {timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-worker-pending-'));fs.mkdirSync(path.join(root,'live-events'));
  const base=Date.parse('2026-11-04T01:00:00Z'),fixtureNow=new Date(base+80000),clockStart=performance.now(),rows=[],sourceLedgerIdentity='sha256:'+'c'.repeat(64);
  let clockOffset=0;
  const clock=()=>new Date(fixtureNow.getTime()+clockOffset+(movingClock?performance.now()-clockStart:0));
  const safety={researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false};
  let service,exited;
  try{
    for(let index=0;index<80;index++){
      const at=new Date(base+index*1000).toISOString();
      rows.push(buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',product:'TXFK6',receivedAt:at,exchangeTimestamp:at,eventId:String(index),duplicate:false,sequenceGap:0,...safety,
        payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:at,code:'TXFK6',datetime:at,
          _product_family:'TX',_target_code:'TXFK6',close:20000+index,volume:2,tick_type:1}},rows.at(-1)?.recordHash??'GENESIS'));
    }
    fs.writeFileSync(path.join(root,'live-events','2026-11-04.ndjson'),rows.map(JSON.stringify).join('\n')+'\n');
    const publishCheckpoint=()=>{const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity});
    const checkpoint=buildCru34LiveCheckpoint({sourceLedgerIdentity,lastVerifiedLedgerOrdinal:rows.length,lastVerifiedRecordHash:rows.at(-1).recordHash,
      lastVerifiedStartByteOffset:rows.length*100,lastVerifiedEndByteOffset:rows.length*100+99,canonicalState:canonical.terminalState,lastVerifiedAvailableAt:rows.at(-1).receivedAt,
      rollingCanonicalEvents:canonical.events.map(({eventTime,rawRecord,...event})=>event)});
    fs.writeFileSync(path.join(root,'2026-11-04.checkpoint.json'),cru34LiveCanonicalJson(checkpoint)+'\n');};
    publishCheckpoint();
    service=createTxChartService({dataRoot:root,cacheRoot:path.join(root,'cache'),producerRoot:root,calendar,sourceLimits:{maxRecords:20},clock:()=>clock().getTime(),
      workerFactory:(url,options)=>{const worker=new Worker(url,options),post=worker.postMessage.bind(worker);
        worker.postMessage=message=>post({...message,selection:{...message.selection,now:clock()}});
        exited=new Promise(resolve=>worker.once('exit',resolve));return worker;}});
    let displayed=await service.load({timeframe:'5m',mode:'LIVE'});assert.ok(displayed.actualContract,'ordinary chart supplies the current selection');
    if(warmupBeforeCopy){
      let prepared=displayed.observationPreparation?.attempted===true;
      for(let n=0;n<32&&!displayed.sourceComplete;n++){
        displayed=await service.load({timeframe:'5m',mode:'LIVE'});prepared||=displayed.observationPreparation?.attempted===true;
      }
      assert.equal(displayed.sourceComplete,true);assert.equal(prepared,true,'ordinary bounded warmup must prepare observation before the user clicks');
    }
    let auditB;
    if(interleave){
      const auditA=displayed;assert.equal(auditA.sourceAuditProgress.state,'COMPLETE');
      clockOffset=5000;
      if(tamper==='interior-before-poll'){
        const file=path.join(root,'live-events','2026-11-04.ndjson'),before=fs.readFileSync(file);
        const needle=Buffer.from('"close":20040'),at=before.indexOf(needle);
        assert.ok(at>512&&at+needle.length<before.length-512,'rewrite is inside A, outside both checkpoints');
        const after=Buffer.from(before);after.write('"close":29940',at,'utf8');
        assert.equal(after.length,before.length);assert.deepEqual(after.subarray(0,512),before.subarray(0,512));
        assert.deepEqual(after.subarray(-512),before.subarray(-512));assert.notDeepEqual(after,before);
        fs.writeFileSync(file,after);
        t.diagnostic(JSON.stringify({sequence:'A COMPLETE -> interior equal-length rewrite -> legal append -> ordinary B poll -> Copy',prefixBytes:before.length,rewriteOffset:at}));
      }
      if(interleave.startsWith('append')){
        for(let added=0;added<(interleave==='append-warming'?21:1);added++){
          const at=new Date(fixtureNow.getTime()+1000+added*100).toISOString();
          const row=buildLiveEventRecord({...rows.at(-1),eventId:String(rows.length),receivedAt:at,exchangeTimestamp:at,
            payload:{...rows.at(-1).payload,eventTime:at,datetime:at,close:20000+rows.length}},rows.at(-1).recordHash);
          rows.push(row);fs.appendFileSync(path.join(root,'live-events','2026-11-04.ndjson'),JSON.stringify(row)+'\n');
        }
        publishCheckpoint();
      }
      for(let n=0;n<16;n++){
        auditB=await service.load({timeframe:'5m',mode:'LIVE'});
        if(auditB.sourceAuditProgress?.state==='PENDING'||interleave==='append-warming')break;
      }
      if(interleave==='append-warming')assert.equal(auditB.sourceAuditProgress,undefined);
      else{assert.equal(auditB.sourceAuditProgress?.state,'PENDING');assert.equal(auditB.sourceEventCount,rows.length);}
      if(tamper==='interior-before-poll'){
        const db=new DatabaseSync(txChartHistoryPath(root,path.join(root,'cache')));
        try{
          const cached=JSON.parse(db.prepare("SELECT json FROM events WHERE json LIKE '%\"close\":20040%' LIMIT 1").get().json);
          assert.equal(cached.payload.close,20040,'ordinary ingestion retained the old interior row');
          assert.equal(db.prepare('SELECT count(*) AS n FROM events').get().n,81,'ordinary polling committed the append before Copy');
        }finally{db.close();}
      }
      assert.ok(Date.parse(auditB.asOf)>Date.parse(auditA.asOf));
      // First finding: B is already visible. Second: another ordinary consumer
      // ingested the append while the UI still shows A, isolating lease retirement.
      displayed=['unchanged','append-displayed'].includes(interleave)?auditB:auditA;
      const sourceFile=path.join(root,'live-events','2026-11-04.ndjson');
      if(tamper==='store-edit'){
        const db=new DatabaseSync(txChartHistoryPath(root,path.join(root,'cache')));
        db.exec('UPDATE events SET key=NULL WHERE rowid=(SELECT min(rowid) FROM events)');db.close();
      }else if(tamper==='source-truncate')fs.writeFileSync(sourceFile,JSON.stringify(rows[0])+'\n');
      else if(tamper==='source-rewrite')fs.writeFileSync(sourceFile,fs.readFileSync(sourceFile,'utf8').replace('20000','29999'));
      else if(tamper==='interior-after-poll'){
        const before=fs.readFileSync(sourceFile),at=before.indexOf(Buffer.from('"close":20040'));
        assert.ok(at>512&&at+13<before.length-512);const after=Buffer.from(before);after.write('"close":29940',at);
        assert.equal(after.length,before.length);assert.deepEqual(after.subarray(0,512),before.subarray(0,512));
        assert.deepEqual(after.subarray(-512),before.subarray(-512));fs.writeFileSync(sourceFile,after);
      }
      else if(tamper==='source-identity'){
        fs.renameSync(sourceFile,sourceFile+'.old');fs.copyFileSync(sourceFile+'.old',sourceFile);
      }
    }
    const context={Date,marketCandidate:false,observationDecisionSnapshot,observedFlowAtChart:flow=>flow,forwardShadowBaseRoot:'synthetic',process:{env:{}},
      readDashboardRuntimeTruth:async()=>null,txChartService:service,loadIx0001BreadthForWorkspace:()=>null,txChartDataRoot:root,
      buildDataHealthContract:()=>({overall:'QUALITY_INSUFFICIENT',items:[],staleCount:0,unavailableCount:0}),readLocalJson:()=>null,futuresAuditPath:'synthetic',
      ...marketChange,currentObservedFlow:()=>null,currentMarketPulse:async()=>null,runtimeVersion:{},productSurfaceContract:{},
      assessTaifexMarketSession:()=>({state:'SYNTHETIC'}),operatingCalendar:{},...workspaceLibrary,
      buildDecisionWorkspace:options=>workspaceLibrary.buildDecisionWorkspace({...options,now:new Date(clock().getTime()+1000)}),
      req:{method:'GET'},pathname:'/api/v1/decision-capture',url:new URL('http://fixture/api/v1/decision-capture?timeframe=5m'),res:{}};
    vm.createContext(context);vm.runInContext(builderSource+'\n'+envelopeSource+'\nasync function route(){'+routeSource+'}',context);
    context.currentDiscussionWorkspace=options=>context.decisionWorkspacePayload({dataMode:'live'},null,null,options);
    const statuses=[],copies=[],applied=[];
    const create=vm.runInNewContext(controllerSource+'\ncreateDecisionCaptureController',{AbortController,setTimeout,clearTimeout});
    const request=vm.runInNewContext('('+requestSource+')',{api:async(url)=>{let sent;
        context.url=new URL(url,'http://fixture');
        context.sendJson=(_r,status,payload,headers)=>{sent={status,payload,headers};};
        await context.route();statuses.push(sent.status);assert.equal(sent.headers['Cache-Control'],'no-store');
        if(sent.status!==200&&sent.status!==202)throw Error(sent.payload.error);
        if(sent.status===202){assert.equal(applied.length,0);assert.equal(copies.length,0);assert.equal(sent.payload.data.workspace,undefined);}
        return sent.payload;}});
    const controller=create({request,
      selection:()=>({timeframe:'5m',identity:['tradeDate','actualContract','session','sessionId','continuityEpoch'].map(key=>displayed[key]??null),asOf:displayed.asOf}),
      ticket:()=> 'synthetic-session',currentSession:value=>value==='synthetic-session',
      apply:(data,pair)=>{applied.push({data,pair});displayed=data.chart;},clipboard:async value=>copies.push(value)});
    if(tamper){
      await assert.rejects(controller.copy().then(pair=>{
        if(tamper==='interior-before-poll')t.diagnostic(JSON.stringify({unexpectedCaptureSuccess:true,statuses,
          applied:applied.length,copies:copies.length,sourceComplete:displayed.sourceComplete,
          auditState:displayed.sourceAuditProgress?.state,sourceEvents:displayed.sourceEventCount,
          observationEvents:displayed.marketObservation?.profile?.tradeCount,cutoff:displayed.asOf}));
        return pair;
      }),/DECISION_CAPTURE_UNAVAILABLE/);
      assert.equal(applied.length,0);assert.equal(copies.length,0);assert.deepEqual(statuses,[503]);return;
    }
    const started=performance.now(),pair=await controller.copy(),elapsedMs=performance.now()-started;
    if(!warmupBeforeCopy)assert.ok(statuses.includes(202),'the real staged worker must exercise HTTP202');assert.equal(statuses.at(-1),200);
    assert.equal(applied.length,1);assert.deepEqual(copies,[pair.copyText]);assert.ok(elapsedMs<10000);
    const chart=applied[0].data.chart,observation=chart.marketObservation;
    assert.equal(chart.sourceAuditProgress.state,'COMPLETE');assert.equal(chart.sourceComplete,true);assert.ok(observation.snapshotId);
    assert.equal(observation.cutoff,chart.asOf);assert.equal(observation.price.last,chart.lastPrice);
    assert.equal(observation.profile.tradeCount,rows.length);assert.equal(observation.profile.totalVolume,rows.length*2);
    if(interleave)assert.equal(chart.asOf,auditB.asOf,'Copy must continue B, not return completed A');
    assert.equal(pair.snapshot.marketObservation.snapshotId,observation.snapshotId);assert.equal(pair.snapshot.executionAuthorized,false);
    t.diagnostic(JSON.stringify({synthetic:true,realWorker:true,realHandler:true,realController:true,requests:statuses.length,statuses,elapsedMs,sourceEvents:chart.sourceEventCount}));
  }finally{service?.close();if(exited)await exited;fs.rmSync(root,{recursive:true,force:true});}
});

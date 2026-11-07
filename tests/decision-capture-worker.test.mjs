import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {Worker} from 'node:worker_threads';
import {performance} from 'node:perf_hooks';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {createTxChartService} from '../src/dashboard-tx-chart-service.mjs';
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

test('one real controller action advances native worker via actual capture handler to an identical snapshot within its original deadline', {timeout:20000},async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'capture-worker-pending-'));fs.mkdirSync(path.join(root,'live-events'));
  const base=Date.parse('2026-11-04T01:00:00Z'),fixtureNow=new Date(base+80000),rows=[],sourceLedgerIdentity='sha256:'+'c'.repeat(64);
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
    const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity});
    const checkpoint=buildCru34LiveCheckpoint({sourceLedgerIdentity,lastVerifiedLedgerOrdinal:rows.length,lastVerifiedRecordHash:rows.at(-1).recordHash,
      lastVerifiedStartByteOffset:rows.length*100,lastVerifiedEndByteOffset:rows.length*100+99,canonicalState:canonical.terminalState,lastVerifiedAvailableAt:rows.at(-1).receivedAt,
      rollingCanonicalEvents:canonical.events.map(({eventTime,rawRecord,...event})=>event)});
    fs.writeFileSync(path.join(root,'2026-11-04.checkpoint.json'),cru34LiveCanonicalJson(checkpoint)+'\n');
    service=createTxChartService({dataRoot:root,cacheRoot:path.join(root,'cache'),producerRoot:root,calendar,sourceLimits:{maxRecords:20},
      workerFactory:(url,options)=>{const worker=new Worker(url,options),post=worker.postMessage.bind(worker);
        worker.postMessage=message=>post({...message,selection:{...message.selection,now:fixtureNow}});
        exited=new Promise(resolve=>worker.once('exit',resolve));return worker;}});
    let displayed=await service.load({timeframe:'5m',mode:'LIVE'});assert.ok(displayed.actualContract,'ordinary chart supplies the current selection');
    const context={Date,marketCandidate:false,observationDecisionSnapshot,observedFlowAtChart:flow=>flow,forwardShadowBaseRoot:'synthetic',process:{env:{}},
      readDashboardRuntimeTruth:async()=>null,txChartService:service,loadIx0001BreadthForWorkspace:()=>null,txChartDataRoot:root,
      buildDataHealthContract:()=>({overall:'QUALITY_INSUFFICIENT',items:[],staleCount:0,unavailableCount:0}),readLocalJson:()=>null,futuresAuditPath:'synthetic',
      ...marketChange,currentObservedFlow:()=>null,currentMarketPulse:async()=>null,runtimeVersion:{},productSurfaceContract:{},
      assessTaifexMarketSession:()=>({state:'SYNTHETIC'}),operatingCalendar:{},...workspaceLibrary,
      buildDecisionWorkspace:options=>workspaceLibrary.buildDecisionWorkspace({...options,now:new Date(fixtureNow.getTime()+1000)}),
      req:{method:'GET'},pathname:'/api/v1/decision-capture',url:new URL('http://fixture/api/v1/decision-capture?timeframe=5m'),res:{}};
    vm.createContext(context);vm.runInContext(builderSource+'\n'+envelopeSource+'\nasync function route(){'+routeSource+'}',context);
    context.currentDiscussionWorkspace=options=>context.decisionWorkspacePayload({dataMode:'live'},null,null,options);
    const statuses=[],copies=[],applied=[];
    const create=vm.runInNewContext(controllerSource+'\ncreateDecisionCaptureController',{AbortController,setTimeout,clearTimeout});
    const controller=create({request:async()=>{let sent;context.sendJson=(_r,status,payload,headers)=>{sent={status,payload,headers};};
        await context.route();statuses.push(sent.status);assert.equal(sent.headers['Cache-Control'],'no-store');
        if(sent.status!==200&&sent.status!==202)throw Error(sent.payload.error);
        if(sent.status===202){assert.equal(applied.length,0);assert.equal(copies.length,0);assert.equal(sent.payload.data.workspace,undefined);}
        return sent.payload;},
      selection:()=>({timeframe:'5m',identity:['tradeDate','actualContract','session','sessionId','continuityEpoch'].map(key=>displayed[key]??null),asOf:displayed.asOf}),
      ticket:()=> 'synthetic-session',currentSession:value=>value==='synthetic-session',
      apply:(data,pair)=>{applied.push({data,pair});displayed=data.chart;},clipboard:async value=>copies.push(value)});
    const started=performance.now(),pair=await controller.copy(),elapsedMs=performance.now()-started;
    assert.ok(statuses.includes(202),'the real staged worker must exercise HTTP202');assert.equal(statuses.at(-1),200);
    assert.equal(applied.length,1);assert.deepEqual(copies,[pair.copyText]);assert.ok(elapsedMs<10000);
    const chart=applied[0].data.chart,observation=chart.marketObservation;
    assert.equal(chart.sourceAuditProgress.state,'COMPLETE');assert.equal(chart.sourceComplete,true);assert.ok(observation.snapshotId);
    assert.equal(observation.cutoff,chart.asOf);assert.equal(observation.price.last,chart.lastPrice);
    assert.equal(observation.profile.tradeCount,80);assert.equal(observation.profile.totalVolume,160);
    assert.equal(pair.snapshot.marketObservation.snapshotId,observation.snapshotId);assert.equal(pair.snapshot.executionAuthorized,false);
    t.diagnostic(JSON.stringify({synthetic:true,realWorker:true,realHandler:true,realController:true,requests:statuses.length,statuses,elapsedMs,sourceEvents:chart.sourceEventCount}));
  }finally{service?.close();if(exited)await exited;fs.rmSync(root,{recursive:true,force:true});}
});

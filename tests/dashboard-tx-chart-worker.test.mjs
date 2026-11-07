import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { createTxChartService } from '../src/dashboard-tx-chart-service.mjs';
import { Worker } from 'node:worker_threads';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {buildCru34LiveCheckpoint,cru34LiveCanonicalJson} from '../src/cru34-live-checkpoint.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
for(const boundary of ['after-cutoff','same-cutoff'])test(`frozen chart with advancing ledger and Producer: ${boundary}`,{timeout:20000},async()=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chart-audit-moving-'));fs.mkdirSync(path.join(root,'live-events'));
  const rows=[],base=Date.parse('2026-11-04T01:00:00Z'),identity='sha256:'+'c'.repeat(64);
  const safety={researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false};
  const ledger=path.join(root,'live-events','2026-11-04.ndjson'),checkpoint=path.join(root,'2026-11-04.checkpoint.json');
  const append=()=>{const at=new Date(base+rows.length*1000).toISOString();
    const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',product:'TXFK6',receivedAt:at,exchangeTimestamp:at,
      eventId:String(rows.length),duplicate:false,sequenceGap:0,...safety,
      payload:{productFamily:'TX',actualContract:'TXFK6',tradeDate:'2026-11-04',session:'DAY',eventTime:at,
        code:'TXFK6',datetime:at,_product_family:'TX',_target_code:'TXFK6',close:20000+rows.length,volume:2,tick_type:1}},rows.at(-1)?.recordHash??'GENESIS');
    rows.push(row);fs.appendFileSync(ledger,JSON.stringify(row)+'\n');};
  for(let n=0;n<80;n++)append();
  let fixtureNow,exited,service,frozenCutoff=null,paired=null,sawDeferredObservation=false,refusedMismatch=false;
  try{
    service=createTxChartService({dataRoot:root,cacheRoot:path.join(root,'cache'),producerRoot:root,calendar,sourceLimits:{maxRecords:20},cacheTtlMs:0,
      workerFactory:(url,options)=>{const worker=new Worker(url,options),post=worker.postMessage.bind(worker);
        worker.postMessage=message=>post({...message,selection:{...message.selection,now:fixtureNow}});
        exited=new Promise(resolve=>worker.once('exit',resolve));return worker;}});
    for(let poll=0;poll<100;poll++){
      append();fixtureNow=new Date(base+(rows.length-(boundary==='after-cutoff'?1:0))*1000);
      const canonical=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:identity});
      const value=buildCru34LiveCheckpoint({sourceLedgerIdentity:identity,lastVerifiedLedgerOrdinal:rows.length,
        lastVerifiedRecordHash:rows.at(-1).recordHash,lastVerifiedStartByteOffset:rows.length*100,lastVerifiedEndByteOffset:rows.length*100+99,
        canonicalState:canonical.terminalState,lastVerifiedAvailableAt:rows.at(-1).receivedAt,
        rollingCanonicalEvents:canonical.events.map(({eventTime,rawRecord,...event})=>event)});
      fs.writeFileSync(checkpoint,cru34LiveCanonicalJson(value)+'\n');
      const chart=await service.load({capture:true,mode:'LIVE',timeframe:'5m',tradeDate:'2026-11-04',session:'DAY',actualContract:'TXFK6'});
      if(chart.sourceAuditProgress){frozenCutoff??=chart.asOf;assert.equal(chart.asOf,frozenCutoff,'the pending capture must retain its cutoff');}
      if(chart.sourceAuditProgress?.state==='COMPLETE'&&!chart.marketObservation?.snapshotId)sawDeferredObservation=true;
      if(chart.marketObservation?.reasonCodes.includes('CHART_OBSERVATION_PREFIX_MISMATCH')){refusedMismatch=true;break;}
      if(chart.sourceComplete&&chart.marketObservation?.snapshotId&&!chart.marketObservation.reasonCodes.includes('SOURCE_CATCHUP_PENDING')){paired=chart;break;}
    }
    assert.ok(frozenCutoff);assert.ok(sawDeferredObservation,'published observation must warm independently');
    if(boundary==='same-cutoff'){assert.ok(refusedMismatch,'later publication with equal timestamp must not silently expand the pinned chart prefix');return;}
    assert.ok(paired,'continuously advancing Producer must eventually pair the frozen prefix');
    assert.equal(paired.marketObservation.cutoff,frozenCutoff);
    assert.equal(paired.marketObservation.price.last,paired.lastPrice);
    assert.equal(paired.marketObservation.profile.tradeCount,paired.sourceEventCount);
    assert.equal(paired.marketObservation.profile.totalVolume,paired.bars.reduce((sum,bar)=>sum+bar.volume,0));
    assert.ok(Date.parse(rows.at(-1).receivedAt)>Date.parse(frozenCutoff));
  }finally{service?.close();if(exited)await exited;fs.rmSync(root,{recursive:true,force:true});}
});
function record(time,id,price) {
  const timestamp=new Date(time).toISOString();
  return {kind:'futures_tick',product:'TXFH6',receivedAt:timestamp,exchangeTimestamp:timestamp,eventId:'synthetic-'+id,
    duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,
    payload:{code:'TXFH6',datetime:timestamp,close:price,volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFH6'}};
}
function publishSyntheticFixture(root,date,rows) {
  // Construct a previously materialized cache fixture, including physical hash
  // and exact source offset. This tests cold bounded reads, not cache publication.
  const source=path.join(root,'live-events',date+'.ndjson'),bytes=Buffer.from(rows.map(value=>JSON.stringify(value)).join('\n')+'\n');
  fs.writeFileSync(source,bytes);
  const stem=date+'-'+hash(Buffer.from(path.resolve(source))).slice(0,12)+'-tx-ticks';
  fs.writeFileSync(path.join(root,'cache',stem+'.ndjson'),bytes);
  fs.writeFileSync(path.join(root,'cache',stem+'.meta.json'),JSON.stringify({schemaVersion:'dw2-tx-tick-cache-v3',sourcePath:path.resolve(source),
    sourceOffset:bytes.length,cacheSize:bytes.length,recordCount:rows.length,cacheHash:hash(bytes)}));
  return bytes.length;
}
test('cold worker produces an actual 75k-observation NIGHT+DAY chart within the default deadline while main-loop timers advance', {timeout:20000}, async t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'chart-worker-capacity-'));
  fs.mkdirSync(path.join(root,'live-events'));fs.mkdirSync(path.join(root,'cache'));
  let service,timer;
  try {
    const half=37500,night=Date.parse('2026-08-11T15:00:00+08:00'),day=Date.parse('2026-08-12T08:45:00+08:00');
    let fixtureBytes=publishSyntheticFixture(root,'2026-08-11',Array.from({length:half},(_,i)=>record(night+i*10,i,100+i%17)));
    fixtureBytes+=publishSyntheticFixture(root,'2026-08-12',Array.from({length:half},(_,i)=>record(day+i*10,i+half,110+i%19)));
    service=createTxChartService({dataRoot:root,cacheRoot:path.join(root,'cache'),calendar});
    let heartbeats=0;timer=setInterval(()=>heartbeats++,10);
    const started=performance.now();
    const chart=await service.load({timeframe:'1D',mode:'REPLAY',tradeDate:'2026-08-12',asOf:'2026-08-12T13:45:00+08:00'});
    const elapsedMs=performance.now()-started;clearInterval(timer);timer=null;
    t.diagnostic(JSON.stringify({synthetic:true,observations:75000,fixtureBytes,elapsedMs,heartbeats,status:chart.status,reason:chart.reason,sourceReadBytes:chart.sourceReadBytes,cacheReadBytes:chart.cacheReadBytes}));
    assert.equal(chart.reason,null);assert.equal(chart.status,'READY');assert.equal(chart.sourceComplete,true);
    assert.equal(chart.sourceReadBytes,0);assert.equal(chart.bars.length,1);assert.equal(chart.bars[0].volume,75000);
    assert.equal(chart.bars[0].high,128);assert.equal(chart.bars[0].low,100);assert.ok(elapsedMs<8000);assert.ok(heartbeats>=2);
  } finally {clearInterval(timer);service?.close();fs.rmSync(root,{recursive:true,force:true});}
});

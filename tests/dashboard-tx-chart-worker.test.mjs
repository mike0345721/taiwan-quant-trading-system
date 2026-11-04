import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { createTxChartService } from '../src/dashboard-tx-chart-service.mjs';

const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
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

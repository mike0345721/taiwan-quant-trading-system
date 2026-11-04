import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { createTxChartReadBudget,clearTxChartLedgerCache,loadTxDecisionChart,readTxLiveEventLedger } from '../src/dashboard-tx-chart-source.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
function row(timestamp,price=100) {return {kind:'futures_tick',product:'TXFH6',receivedAt:timestamp,exchangeTimestamp:timestamp,eventId:timestamp,
  duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,
  payload:{code:'TXFH6',datetime:timestamp,close:price,volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFH6'}};}
const line=value=>JSON.stringify(value)+'\n';
function fixture(t) {const root=fs.mkdtempSync(path.join(os.tmpdir(),'bounded-chart-'));fs.mkdirSync(path.join(root,'live-events'));
  t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});return root;}
test('one shared raw budget caps all selected files and subsequent calls catch up without duplicate rows',t=>{
  const root=fixture(t),a=path.join(root,'live-events','2026-08-11.ndjson'),b=path.join(root,'live-events','2026-08-12.ndjson');
  const first=line(row('2026-08-11T15:00:01+08:00')),second=line(row('2026-08-12T08:45:01+08:00'));
  fs.writeFileSync(a,first);fs.writeFileSync(b,second);
  const budget=createTxChartReadBudget({maxSourceBytes:Buffer.byteLength(first)});
  assert.equal(readTxLiveEventLedger(a,{budget,withProgress:true}).progress.complete,true);
  const pending=readTxLiveEventLedger(b,{budget,withProgress:true});assert.equal(pending.progress.complete,false);
  assert.equal(budget.sourceBytesRead,Buffer.byteLength(first));assert.equal(pending.records.length,0);
  assert.equal(readTxLiveEventLedger(b,{budget:createTxChartReadBudget(),withProgress:true}).records.length,1);
  const again=readTxLiveEventLedger(b,{budget:createTxChartReadBudget(),withProgress:true});assert.equal(again.records.length,1);assert.equal(again.progress.complete,true);
});
test('unfinished UTF-8 line is retried from its verified prefix without loss or duplicate evidence',t=>{
  const root=fixture(t),file=path.join(root,'live-events','2026-08-12.ndjson');
  const a=line(row('2026-08-12T08:45:01+08:00')),b=line({...row('2026-08-12T08:46:01+08:00'),eventId:'中文-event'});
  const bytes=Buffer.from(b),split=bytes.indexOf(Buffer.from('中文'))+1;
  fs.writeFileSync(file,Buffer.concat([Buffer.from(a),bytes.subarray(0,split)]));
  const initial=readTxLiveEventLedger(file,{budget:createTxChartReadBudget(),withProgress:true});
  assert.equal(initial.records.length,1);assert.equal(initial.progress.sourceOffset,Buffer.byteLength(a));assert.equal(initial.progress.complete,false);
  fs.appendFileSync(file,bytes.subarray(split));const complete=readTxLiveEventLedger(file,{budget:createTxChartReadBudget(),withProgress:true});
  assert.equal(complete.records.length,2);assert.equal(complete.records[1].eventId,'中文-event');assert.equal(complete.progress.complete,true);
});
test('partial inputs preserve numeric observations but block current derived qualification and complete capture claims',t=>{
  const root=fixture(t),file=path.join(root,'live-events','2026-08-12.ndjson');
  const prefix=[row('2026-08-12T08:45:01+08:00'),row('2026-08-12T08:50:01+08:00',101),row('2026-08-12T09:00:01+08:00',102)].map(line).join('');
  fs.writeFileSync(file,prefix+line(row('2026-08-12T09:01:01+08:00',103)));
  const chart=loadTxDecisionChart({dataRoot:root,calendar,timeframe:'5m',tradeDate:'2026-08-12',session:'DAY',now:new Date('2026-08-12T09:01:30+08:00'),sourceBudget:createTxChartReadBudget({maxSourceBytes:Buffer.byteLength(prefix)})});
  assert.equal(chart.status,'QUALITY_INSUFFICIENT');assert.equal(chart.sourceComplete,false);assert.ok(chart.bars.length>0);
  assert.equal(chart.trendStrength.indicator,'ADX');
  assert.notEqual(chart.trendStrength.state,'READY');
  assert.equal(chart.trendStrength.value,null);
  for(const value of [chart,...chart.bars,...chart.vwap,chart.levels.vwap,chart.levels.currentDayHigh,chart.openingRange]) {
    assert.equal(value.structureEligibility.state,'BLOCKED');assert.ok(value.structureEligibility.reasonCodes.includes('SOURCE_CATCHUP_PENDING'));
    assert.equal(value.captureCoverage.completeMarketWindow,false);assert.equal(value.fullSessionVerified,false);
  }
  assert.equal(chart.bars[0].close,100);assert.equal(chart.openingRange.high,101);assert.equal(chart.levels.currentDayHigh.value,102);
});

test('the actual bounded chart response publishes ADX from closed bars, without adding a raw source read',t=>{
  const root=fixture(t),file=path.join(root,'live-events','2026-08-12.ndjson');
  const start=Date.parse('2026-08-12T08:45:00+08:00');
  const records=Array.from({length:29},(_,i)=>row(new Date(start+i*60000+1000).toISOString(),100+i));
  const bytes=records.map(line).join('');fs.writeFileSync(file,bytes);
  const chart=loadTxDecisionChart({dataRoot:root,calendar,timeframe:'1m',tradeDate:'2026-08-12',session:'DAY',
    now:new Date(start+28*60000+2000),sourceBudget:createTxChartReadBudget()});
  assert.equal(chart.trendStrength.indicator,'ADX');assert.equal(chart.trendStrength.period,14);
  assert.equal(chart.trendStrength.closedBarCount,28);assert.equal(chart.trendStrength.value,100);
  assert.equal(chart.trendStrength.lastClosedBarAt,new Date(start+28*60000).toISOString());
  assert.equal(chart.trendStrength.sourceAvailableAt,chart.availableAt);
  assert.equal(chart.trendStrength.identity.actualContract,chart.actualContract);
  assert.equal(chart.trendStrength.asOf,chart.asOf);assert.equal(chart.sourceReadBytes,Buffer.byteLength(bytes));
  assert.equal(chart.trendStrength.formalWeight,0);assert.equal(chart.trendStrength.executionAuthorized,false);
});
test('cache size is checked before cache contents are read and oversized checkpoints are not written',t=>{
  const root=fixture(t),file=path.join(root,'live-events','2026-08-12.ndjson'),cacheRoot=path.join(root,'cache');
  fs.writeFileSync(file,line(row('2026-08-12T08:45:01+08:00')));readTxLiveEventLedger(file,{cacheRoot});clearTxChartLedgerCache();
  const recordsFile=path.join(cacheRoot,fs.readdirSync(cacheRoot).find(name=>name.endsWith('.ndjson'))),prior=fs.readFileSync(recordsFile);
  const original=fs.openSync;let cacheReads=0;fs.openSync=function(file,...args){if(path.resolve(file)===recordsFile)cacheReads++;return original.call(this,file,...args);};
  let result;try {result=readTxLiveEventLedger(file,{cacheRoot,budget:createTxChartReadBudget({maxCacheFileBytes:1}),withProgress:true});}finally{fs.openSync=original;}
  assert.equal(cacheReads,0);assert.ok(result.progress.reasonCodes.includes('TX_CHART_CACHE_BUDGET_EXCEEDED'));
  assert.ok(result.progress.reasonCodes.includes('TX_CHART_EXISTING_CACHE_PRESERVED'));assert.deepEqual(fs.readFileSync(recordsFile),prior);
});
test('an initial cache exceeding the byte cap is rejected before creating or renaming any output',t=>{
  const root=fixture(t),file=path.join(root,'live-events','2026-08-12.ndjson'),cacheRoot=path.join(root,'cache');
  fs.writeFileSync(file,line(row('2026-08-12T08:45:01+08:00')));
  const result=readTxLiveEventLedger(file,{cacheRoot,budget:createTxChartReadBudget({maxCacheFileBytes:1}),withProgress:true});
  assert.ok(result.progress.reasonCodes.includes('TX_CHART_CACHE_WRITE_BUDGET_EXCEEDED'));
  assert.equal(fs.existsSync(cacheRoot),false);assert.equal(result.records.length,1);assert.equal(result.progress.complete,true);
});
test('incremental checkpoint appends use the resident hash state without rereading and hashing the whole cache',t=>{
  const root=fixture(t),file=path.join(root,'live-events','2026-08-12.ndjson'),cacheRoot=path.join(root,'cache');
  const a=line(row('2026-08-12T08:45:01+08:00')),b=line(row('2026-08-12T08:46:01+08:00'));
  fs.writeFileSync(file,a);const initial=readTxLiveEventLedger(file,{cacheRoot,budget:createTxChartReadBudget({maxSourceBytes:Buffer.byteLength(a)}),withProgress:true});
  assert.equal(initial.progress.reasonCodes.includes('TX_CHART_CACHE_CHECKPOINT_FAILED'),false,'initial atomic fixture publication must succeed before append assertions');
  const recordsFile=path.join(cacheRoot,fs.readdirSync(cacheRoot).find(name=>name.endsWith('.ndjson')));
  fs.appendFileSync(file,b);const original=fs.readFileSync;let fullCacheReads=0;
  fs.readFileSync=function(file,...args){if(path.resolve(file)===recordsFile)fullCacheReads++;return original.call(this,file,...args);};
  try{readTxLiveEventLedger(file,{cacheRoot,budget:createTxChartReadBudget({maxSourceBytes:Buffer.byteLength(b)})});}finally{fs.readFileSync=original;}
  assert.equal(fullCacheReads,0);const bytes=fs.readFileSync(recordsFile),metadata=JSON.parse(fs.readFileSync(recordsFile.replace('.ndjson','.meta.json'),'utf8'));
  assert.equal(metadata.cacheHash,crypto.createHash('sha256').update(bytes).digest('hex'));assert.equal(metadata.recordCount,2);
  clearTxChartLedgerCache();assert.equal(readTxLiveEventLedger(file,{cacheRoot,budget:createTxChartReadBudget()}).length,2);
});
test('daily chart becomes complete after bounded catchup rather than permanently hiding 1D',t=>{
  const root=fixture(t),old=line(row('2026-08-11T15:00:01+08:00')),day=line(row('2026-08-12T08:45:01+08:00',102));
  fs.writeFileSync(path.join(root,'live-events','2026-08-11.ndjson'),old);fs.writeFileSync(path.join(root,'live-events','2026-08-12.ndjson'),day);
  const options={dataRoot:root,calendar,timeframe:'1D',mode:'REPLAY',tradeDate:'2026-08-12',asOf:'2026-08-12T13:45:00+08:00'};
  const partial=loadTxDecisionChart({...options,sourceBudget:createTxChartReadBudget({maxSourceBytes:Buffer.byteLength(old)})});
  assert.equal(partial.sourceComplete,false);assert.equal(partial.reason,'SOURCE_CATCHUP_PENDING');assert.equal(partial.bars.length,1);
  const complete=loadTxDecisionChart({...options,sourceBudget:createTxChartReadBudget({maxSourceBytes:Buffer.byteLength(day)})});
  assert.equal(complete.sourceComplete,true);assert.equal(complete.status,'READY');assert.equal(complete.bars[0].volume,2);
});
test('a depleted multi-date request cannot replace a reusable cache needed by the next single-date selection',t=>{
  const root=fixture(t),cacheRoot=path.join(root,'cache');fs.mkdirSync(cacheRoot);
  const files=['2026-08-11','2026-08-12'].map(date=>{
    const file=path.join(root,'live-events',date+'.ndjson');
    const bytes=Buffer.from([row(date+'T08:45:01+08:00'),row(date+'T08:46:01+08:00')].map(line).join(''));
    fs.writeFileSync(file,bytes);
    const identity=crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0,12),stem=date+'-'+identity+'-tx-ticks';
    fs.writeFileSync(path.join(cacheRoot,stem+'.ndjson'),bytes);
    fs.writeFileSync(path.join(cacheRoot,stem+'.meta.json'),JSON.stringify({schemaVersion:'dw2-tx-tick-cache-v3',sourcePath:path.resolve(file),
      sourceOffset:bytes.length,cacheSize:bytes.length,recordCount:2,cacheHash:crypto.createHash('sha256').update(bytes).digest('hex')}));
    return file;
  });
  const shared=createTxChartReadBudget({maxRecords:3});
  assert.equal(readTxLiveEventLedger(files[0],{cacheRoot,budget:shared,withProgress:true}).records.length,2);
  const second=readTxLiveEventLedger(files[1],{cacheRoot,budget:shared,withProgress:true});assert.equal(second.progress.complete,false);
  const independent=createTxChartReadBudget({maxRecords:3});
  const recovered=readTxLiveEventLedger(files[1],{cacheRoot,budget:independent,withProgress:true});
  assert.equal(recovered.records.length,2);assert.equal(recovered.progress.complete,true);
  assert.equal(independent.sourceBytesRead,0,'next selection must reuse its existing valid checkpoint instead of rescanning raw');
});
test('cache parsing stops at the declared bounded row count before decoding extra rows',t=>{
  const root=fixture(t),cacheRoot=path.join(root,'cache'),date='2026-08-12';fs.mkdirSync(cacheRoot);
  const file=path.join(root,'live-events',date+'.ndjson');
  const bytes=Buffer.from([1,2,3].map(i=>line(row(date+'T08:45:0'+i+'+08:00'))).join(''));fs.writeFileSync(file,bytes);
  const identity=crypto.createHash('sha256').update(path.resolve(file)).digest('hex').slice(0,12),stem=date+'-'+identity+'-tx-ticks';
  fs.writeFileSync(path.join(cacheRoot,stem+'.ndjson'),bytes);
  fs.writeFileSync(path.join(cacheRoot,stem+'.meta.json'),JSON.stringify({schemaVersion:'dw2-tx-tick-cache-v3',sourcePath:path.resolve(file),
    sourceOffset:bytes.length,cacheSize:bytes.length,recordCount:1,cacheHash:crypto.createHash('sha256').update(bytes).digest('hex')}));
  const original=JSON.parse;let parsedRows=0;
  JSON.parse=function(value,...args){if(typeof value==='string'&&value.includes('"kind":"futures_tick"'))parsedRows++;return original.call(this,value,...args);};
  try{readTxLiveEventLedger(file,{cacheRoot,budget:createTxChartReadBudget({maxRecords:2,maxSourceBytes:1}),withProgress:true});}finally{JSON.parse=original;}
  assert.equal(parsedRows,1,'extra cache rows must be refused before JSON object allocation');
});

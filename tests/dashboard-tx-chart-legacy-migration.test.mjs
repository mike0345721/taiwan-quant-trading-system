import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {loadTxDecisionChart,readTxLiveEventLedger,clearTxChartLedgerCache,createTxChartReadBudget} from '../src/dashboard-tx-chart-source.mjs';
import {txChartHistoryPath} from '../src/dashboard-tx-chart-store.mjs';

test('two individually valid legacy caches migrate when their combined cold read exceeds the request record budget',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tx-legacy-migration-')),cacheRoot=path.join(root,'cache');
  t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});
  fs.mkdirSync(path.join(root,'live-events'));let ordinal=0;
  const originals=new Map();
  for(const [date,count,start] of [['2026-11-04',80,'2026-11-04T07:00:00Z'],['2026-11-05',60,'2026-11-04T16:00:00Z']]){
    const rows=[];for(let i=0;i<count;i++){const at=new Date(Date.parse(start)+i*1000).toISOString();
      rows.push({kind:'futures_tick',product:'TXFK6',receivedAt:at,exchangeTimestamp:at,eventId:String(++ordinal),
        sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,
        payload:{code:'TXFK6',datetime:at,_product_family:'TX',_target_code:'TXFK6',close:20000+ordinal,volume:1}});}
    const file=path.join(root,'live-events',date+'.ndjson'),bytes=rows.map(JSON.stringify).join('\n')+'\n';
    fs.writeFileSync(file,bytes);originals.set(file,bytes);
    const primed=readTxLiveEventLedger(file,{cacheRoot,includeCaptureEvidence:true,withProgress:true,budget:createTxChartReadBudget({maxRecords:100})});
    assert.equal(primed.progress.complete,true);assert.equal(primed.records.length,count);
  }
  clearTxChartLedgerCache();assert.equal(fs.existsSync(txChartHistoryPath(root,cacheRoot)),false);
  const legacy=new Map(fs.readdirSync(cacheRoot).map(name=>[name,fs.readFileSync(path.join(cacheRoot,name))]));
  const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
  let chart;
  for(let poll=0;poll<12;poll++){
    const budget=createTxChartReadBudget({maxRecords:100});
    chart=loadTxDecisionChart({dataRoot:root,cacheRoot,calendar,timeframe:'5m',mode:'LIVE',tradeDate:'2026-11-05',
      session:'NIGHT',actualContract:'TXFK6',asOf:'2026-11-04T16:01:00Z',sourceBudget:budget});
    assert.ok(budget.sourceBytesRead<=budget.maxSourceBytes);assert.ok(budget.remainingRecords>=0);
    if(chart.sourceComplete)break;
  }
  assert.equal(chart.sourceComplete,true);assert.equal(chart.sourceEventCount,140);assert.equal(chart.lastPrice,20140);
  assert.equal(chart.bars.reduce((sum,bar)=>sum+bar.volume,0),140);assert.equal(chart.historyReadMode,'PRIVATE_SQLITE_STREAM');
  for(const [file,bytes] of originals)assert.equal(fs.readFileSync(file,'utf8'),bytes);
  for(const [name,bytes] of legacy)assert.deepEqual(fs.readFileSync(path.join(cacheRoot,name)),bytes);
});

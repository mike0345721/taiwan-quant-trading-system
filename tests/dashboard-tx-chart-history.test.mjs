import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import vm from 'node:vm';
import {EventEmitter} from 'node:events';
import {createTxChartService} from '../src/dashboard-tx-chart-service.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {loadTxDecisionChart,clearTxChartLedgerCache,releaseTxChartAudit,createTxChartReadBudget,TX_CHART_SOURCE_LIMITS} from '../src/dashboard-tx-chart-source.mjs';
import {readTxChartHistory,txChartHistoryPath} from '../src/dashboard-tx-chart-store.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
function fixture(t,{qualified=false}={}){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tx-chart-history-'));fs.mkdirSync(path.join(root,'live-events'));
  const cacheRoot=path.join(root,'cache');t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});
  const records=[];let previous='GENESIS';
  for(const [date,count,start] of [['2026-11-04',80,'2026-11-04T07:00:00Z'],['2026-11-05',60,'2026-11-04T16:00:00Z']]){
    const rows=[];for(let i=0;i<count;i++){const at=new Date(Date.parse(start)+i*1000).toISOString();
      const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',receivedAt:at,sequenceGap:0,researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false,
        ...(qualified?{product:'TXFK6',exchangeTimestamp:at,eventId:String(records.length),duplicate:false}:{}),
        payload:{code:'TXFK6',datetime:at,_product_family:'TX',_target_code:'TXFK6',close:20001+records.length,volume:1,tick_type:1}},previous);
      previous=row.recordHash;rows.push(row);records.push(row);}
    fs.writeFileSync(path.join(root,'live-events',date+'.ndjson'),rows.map(JSON.stringify).join('\n')+'\n');}
  return {root,cacheRoot,records};}
const options={calendar,timeframe:'5m',mode:'LIVE',tradeDate:'2026-11-05',session:'NIGHT',actualContract:'TXFK6',asOf:'2026-11-04T16:01:00.000Z'};
function run(f,extra={}){const {limits={},...selection}=extra,budget=createTxChartReadBudget({maxRecords:100,...limits});
  const chart=loadTxDecisionChart({...options,dataRoot:f.root,cacheRoot:f.cacheRoot,sourceBudget:budget,...selection});
  assert.ok(budget.sourceBytesRead<=budget.maxSourceBytes);assert.ok(budget.remainingRecords>=0);return chart;}
function complete(f,extra={}){for(let i=0;i<12;i++){const result=run(f,extra);if(result.sourceComplete)return result;}assert.fail('finite source did not finish within bounded retries');}
function sourceProofChunkCount(f){
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{return db.prepare('SELECT count(*) n FROM source_chunks JOIN active ON source_chunks.source=active.id').get().n;}
  finally{db.close();}
}
function content(chart){const {sourceComplete,sourceReadState,sourceProgress,sourceReadBytes,cacheReadBytes,cacheWriteBytes,historyReadMode,historyPageCacheKiB,historyReadBytes,cacheWriteMeasurement,...rest}=chart;return rest;}
test('ordinary controller and service continue a finite audit before five-second polling ages its cutoff',async t=>{
  const f=fixture(t,{qualified:true});complete(f);let elapsed=0,requests=0;
  class SourceWorker extends EventEmitter {
    postMessage({id}){queueMicrotask(()=>{requests++;this.emit('message',{id,chart:run(f,{
      asOf:null,now:new Date(Date.parse(options.asOf)+elapsed),staged:true,limits:{maxRecords:5}})});});}
    terminate(){this.emit('exit',0);return Promise.resolve(0);}
  }
  const service=createTxChartService({dataRoot:f.root,calendar,workerFactory:()=>new SourceWorker(),clock:()=>elapsed});
  t.after(()=>service.close());
  const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
  const start=app.indexOf('async function loadTxDecisionChart('),end=app.indexOf('\n}',start)+2;
  const timers=new Map();let timerId=0;
  const state={txChartTimeframe:'5m',txChartRequestId:0,csrfToken:'synthetic'};
  const context=vm.createContext({state,AbortController,URLSearchParams,
    api:async()=>({data:await service.load({timeframe:'5m',mode:'LIVE'})}),
    renderTxDecisionChart:chart=>{state.txChartPayload=chart;},renderTxChartFreshness(){},dwText(){},$:()=>null,
    setTimeout:(fn,ms)=>{const id=++timerId;timers.set(id,{fn,ms});return id;},clearTimeout:id=>timers.delete(id)});
  vm.runInContext(app.slice(start,end),context);
  let settled=false,error;const pending=context.loadTxDecisionChart().then(()=>{settled=true;},e=>{settled=true;error=e;});
  for(let turns=0;turns<80&&!settled;turns++){
    await new Promise(resolve=>setImmediate(resolve));
    const retry=[...timers].find(([,timer])=>timer.ms===250);
    if(retry){timers.delete(retry[0]);elapsed+=250;retry[1].fn();}
  }
  if(!settled){for(const timer of timers.values())if(timer.ms===10000)timer.fn();}
  await pending;if(error)throw error;
  assert.equal(state.txChartPayload.sourceAuditProgress.state,'COMPLETE');
  assert.equal(state.txChartPayload.asOf,options.asOf);
  assert.equal(state.txChartPayload.sourceEventCount,140);
  assert.ok(requests>25&&requests<40);assert.ok(elapsed<10000);
  assert.ok((requests-1)*5000>120000,'the original one-step/5s schedule crosses freshness');
  assert.equal(state.txChartPayload.structureEligibility.state,'ELIGIBLE');
  t.diagnostic(JSON.stringify({realController:true,realService:true,realSource:true,syntheticWorkerTransport:true,requests,elapsed,events:140}));
});

test('completed audit survives ordinary poll consumers and immediate capture uses the original cutoff',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  const visible=complete(f,selection);
  // Ordinary chart, Market Pulse and level-watch share this same source selection.
  for(let i=0;i<3;i++)run(f,{...selection,now:new Date(now.getTime()+5000+i),limits:{maxRecords:5}});
  const captured=run(f,{...selection,now:new Date(now.getTime()+6000),holdCompletedAudit:true,limits:{maxRecords:5}});
  assert.equal(captured.sourceAuditProgress.state,'COMPLETE');assert.equal(captured.asOf,visible.asOf);
  assert.equal(captured.sourceEventCount,visible.sourceEventCount);
  releaseTxChartAudit();
  const resumed=run(f,{...selection,now:new Date(now.getTime()+6500),limits:{maxRecords:5}});
  assert.equal(resumed.sourceAuditProgress.processedRecords+sourceProofChunkCount(f),15,'releasing capture preserves audit progress; proof rows share its record budget');
  assert.equal(resumed.asOf,new Date(now.getTime()+5000).toISOString());
});

for(const change of ['cache-edit','source-truncate','clock-rollback','expired'])test(`completed lease after ordinary poll still rejects ${change}`,t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  complete(f,selection);run(f,{...selection,now:new Date(now.getTime()+5000)});
  if(change==='cache-edit'){
    const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
    db.exec('UPDATE events SET key=NULL WHERE rowid=(SELECT min(rowid) FROM events)');db.close();
  }else if(change==='source-truncate')fs.writeFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify(f.records[80])+'\n');
  const capture={...selection,holdCompletedAudit:true,limits:{maxRecords:5},
    now:new Date(now.getTime()+(change==='clock-rollback'?-1:change==='expired'?10001:6000))};
  if(['cache-edit','source-truncate'].includes(change))assert.throws(()=>run(f,capture),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  else{const result=run(f,capture);assert.equal(result.sourceAuditProgress.state,'PENDING');assert.notEqual(result.asOf,options.asOf);}
});
test('staged current chart yields before raw time audit and resumes the frozen cutoff',t=>{
  const f=fixture(t);complete(f);
  const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  const first=run(f,selection);
  assert.equal(first.sourceAuditProgress?.state,'PENDING');
  assert.equal(first.sourceComplete,false);
  assert.equal(first.reason,'SOURCE_CATCHUP_PENDING');
  assert.equal(first.sourceAuditProgress.processedRecords,0);
  assert.equal(first.lastPrice,20140,'qualified price is still visible');
  const second=run(f,{...selection,now:new Date(now.getTime()+500)});
  assert.equal(second.sourceAuditProgress.processedRecords+sourceProofChunkCount(f),100);
  assert.equal(second.sourceAuditProgress.state,'PENDING');
  const result=complete(f,{...selection,now:new Date(now.getTime()+1000)});
  assert.equal(result.asOf,options.asOf,'resume must not silently advance the cutoff');
  const oracle=loadTxDecisionChart({...options,asOf:null,now,dataRoot:f.root,sourceBudget:createTxChartReadBudget()});
  const {sourceAuditProgress,...actual}=content(result);
  assert.deepEqual(actual,content(oracle));
  assert.equal(sourceAuditProgress.processedRecords,140);
});
test('an append during audit stays outside the frozen source prefix until the next chart',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  run(f,selection);const at=new Date(now.getTime()+2000).toISOString();
  const record={...f.records.at(-1),eventId:'after-audit-cutoff',receivedAt:at,exchangeTimestamp:at,
    payload:{...f.records.at(-1).payload,datetime:at,close:20201}};
  fs.appendFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify(record)+'\n');
  const frozen=complete(f,{...selection,now:new Date(now.getTime()+3000)});
  assert.equal(frozen.sourceEventCount,140);assert.equal(frozen.lastPrice,20140);assert.equal(frozen.asOf,options.asOf);
  const next=complete(f,{...selection,now:new Date(now.getTime()+3000)});
  assert.equal(next.sourceEventCount,141);assert.equal(next.lastPrice,20201);
  assert.equal(next.sourceAuditProgress.processedRecords,141);
  const oracle=loadTxDecisionChart({...options,asOf:null,now:new Date(now.getTime()+3000),dataRoot:f.root,sourceBudget:createTxChartReadBudget()});
  assert.deepEqual(next.structureEligibility,oracle.structureEligibility,'missing raw identity evidence stays unknown');
});
for(const change of ['cache-edit','source-truncate'])test(`staged audit rejects ${change} and cannot publish its old proof`,t=>{
  const f=fixture(t);complete(f);const selection={asOf:null,now:new Date(options.asOf),staged:true};
  run(f,selection);run(f,selection);
  if(change==='cache-edit'){
    const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
    db.exec('UPDATE events SET key=NULL WHERE rowid=(SELECT min(rowid) FROM events)');db.close();
  }else fs.writeFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify(f.records[80])+'\n');
  assert.throws(()=>run(f,selection),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  if(change==='cache-edit')assert.throws(()=>complete(f,selection),/TX_CHART_HISTORY_ROW_HASH_MISMATCH/);
  else assert.equal(complete(f,selection).sourceEventCount,81);
});
test('a read lease cannot absorb another request own write or survive a store restart',t=>{
  const f=fixture(t);complete(f);
  const history=()=>readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,calendar,
    files:['2026-11-04','2026-11-05'].map(date=>path.join(f.root,'live-events',date+'.ndjson')),
    budget:createTxChartReadBudget(),decode:JSON.parse,normalize:()=>assert.fail('no new source rows expected')});
  const lease=history().createRawReadLease();
  assert.equal(lease.step(()=>{},createTxChartReadBudget({maxRecords:10})),false);
  fs.appendFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify({...f.records.at(-1),eventId:'own-write'})+'\n');
  complete(f);
  assert.throws(()=>lease.step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  const beforeRestart=history().createRawReadLease();clearTxChartLedgerCache();
  assert.throws(()=>beforeRestart.step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});

for(const change of ['own-append','own-append-bounded','external-then-own-append','rewrite-after-own-append','interior-before-own-append','restart'])
test(`completed lease retirement proof: ${change}`,t=>{
  const f=fixture(t);complete(f);
  const history=readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,calendar,
    files:['2026-11-04','2026-11-05'].map(date=>path.join(f.root,'live-events',date+'.ndjson')),
    budget:createTxChartReadBudget(),decode:JSON.parse,normalize:()=>assert.fail('already materialized')});
  const lease=history.createRawReadLease();assert.equal(lease.step(()=>{},createTxChartReadBudget()),true);
  assert.equal(lease.supersededByOwnWrite(createTxChartReadBudget()),'UNCHANGED');
  if(change==='external-then-own-append'){
    const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
    db.exec('CREATE TABLE external_marker(value INTEGER)');db.close();complete(f);
  }
  const file=path.join(f.root,'live-events','2026-11-05.ndjson');
  if(change==='interior-before-own-append'){
    const before=fs.readFileSync(file),at=before.indexOf(Buffer.from('"close":20110'));
    assert.ok(at>512&&at+13<before.length-512);
    const after=Buffer.from(before);after.write('"close":29110',at,'utf8');
    assert.equal(after.length,before.length);assert.deepEqual(after.subarray(0,512),before.subarray(0,512));
    assert.deepEqual(after.subarray(-512),before.subarray(-512));assert.notDeepEqual(after,before);
    fs.writeFileSync(file,after);
  }
  fs.appendFileSync(file,JSON.stringify({...f.records.at(-1),eventId:'legal-append'})+'\n');complete(f);
  if(change==='rewrite-after-own-append')fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"kind":"futures_tick"','"kind":"futures_tock"'));
  if(change==='restart'){clearTxChartLedgerCache();complete(f);}
  if(change==='own-append'){
    assert.equal(lease.supersededByOwnWrite(createTxChartReadBudget({maxSourceBytes:1})),'PENDING','incomplete prefix proof cannot retire');
    assert.equal(lease.supersededByOwnWrite(createTxChartReadBudget()),'SUPERSEDED');
  }else if(change==='own-append-bounded'){
    let retired=false,steps=0;
    const prefixBytes=f.records.reduce((n,row)=>n+Buffer.byteLength(JSON.stringify(row)+'\n'),0);
    while(!retired&&steps<=Math.ceil(prefixBytes/128)+2){
      const budget=createTxChartReadBudget({maxSourceBytes:128});steps++;
      retired=lease.supersededByOwnWrite(budget)==='SUPERSEDED';assert.ok(budget.sourceBytesRead<=128);
    }
    assert.ok(steps>1,'positive control crosses byte-budget slices');
    assert.equal(retired,true,'legal append must make progress without relaxing the per-call budget');
    t.diagnostic(JSON.stringify({sourceBudget:128,steps,prefixBytes}));
  }else assert.throws(()=>lease.supersededByOwnWrite(createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  assert.throws(()=>lease.step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/,'retirement never rebases the old lease');
});
test('changing timeframe or explicit cutoff cancels rather than finishes an old audit',t=>{
  const f=fixture(t);complete(f);const selection={asOf:null,now:new Date(options.asOf),staged:true};
  run(f,selection);
  const historical=run(f,{...selection,asOf:'2026-11-04T07:00:39.000Z'});
  assert.equal(historical.sourceEventCount,40);assert.equal(historical.sourceAuditProgress,undefined);
  assert.equal(run(f,selection).sourceAuditProgress.processedRecords,0);
  const minute=run(f,{...selection,timeframe:'1m'});assert.equal(minute.timeframe,'1m');
  assert.equal(minute.sourceAuditProgress,undefined);
  assert.equal(run(f,selection).sourceAuditProgress.processedRecords,0);
});
test('audit lease rejects rewritten prefix plus growth rather than treating every growth as append',t=>{
  const f=fixture(t);complete(f);const selection={asOf:null,now:new Date(options.asOf),staged:true};
  run(f,selection);
  const file=path.join(f.root,'live-events','2026-11-04.ndjson');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"kind":"futures_tick"','"kind":"futures_tock"')+JSON.stringify(f.records[0])+'\n');
  assert.throws(()=>run(f,selection),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});
test('audit lease creation cannot absorb a source rewrite after history verification',t=>{
  const f=fixture(t);complete(f);
  const history=readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,calendar,
    files:['2026-11-04','2026-11-05'].map(date=>path.join(f.root,'live-events',date+'.ndjson')),
    budget:createTxChartReadBudget(),decode:JSON.parse,normalize:()=>assert.fail('already materialized')});
  const file=path.join(f.root,'live-events','2026-11-04.ndjson');
  fs.writeFileSync(file,fs.readFileSync(file,'utf8').replace('"kind":"futures_tick"','"kind":"futures_tock"'));
  assert.throws(()=>history.createRawReadLease().step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});
test('audit lease cannot acquire a new trust baseline after an intervening cache commit',t=>{
  const f=fixture(t);complete(f);
  const history=readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,calendar,
    files:['2026-11-04','2026-11-05'].map(date=>path.join(f.root,'live-events',date+'.ndjson')),
    budget:createTxChartReadBudget(),decode:JSON.parse,normalize:()=>assert.fail('already materialized')});
  const cache=txChartHistoryPath(f.root,f.cacheRoot),statSync=fs.statSync;let reads=0;
  fs.statSync=function(file,...args){
    if(String(file)===cache&&++reads===2){const db=new DatabaseSync(cache);
      db.exec("UPDATE events SET json='{}' WHERE rowid=(SELECT min(rowid) FROM events)");db.close();}
    return statSync.call(this,file,...args);
  };
  try{assert.throws(()=>history.createRawReadLease().step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);}
  finally{fs.statSync=statSync;}
  assert.ok(reads>=2,'the external commit injection really executed');
});
test('finishing a delayed audit preserves cutoff but rechecks current freshness',t=>{
  const f=fixture(t);
  for(const date of ['2026-11-04','2026-11-05']){
    const file=path.join(f.root,'live-events',date+'.ndjson');
    const rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse).map((row,index)=>({...row,
      product:'TXFK6',exchangeTimestamp:row.payload.datetime,eventId:`${date}-${index}`,duplicate:false}));
    fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');
  }
  complete(f);const now=new Date(options.asOf);
  const oracle=run(f,{asOf:null,now});assert.equal(oracle.structureEligibility.state,'ELIGIBLE');
  run(f,{asOf:null,now,staged:true});
  const old=complete(f,{asOf:null,now:new Date(now.getTime()+121000),staged:true});
  assert.equal(old.asOf,options.asOf);
  assert.ok(old.structureEligibility.reasonCodes.includes('SOURCE_EVENT_OR_RECEIPT_STALE'));
  assert.equal(old.structureEligibility.state,'BLOCKED');
});
test('cross-calendar source over the resident record budget finishes without losing early ticks, then restarts and reads historical cutoff',t=>{
  const f=fixture(t),full=complete(f);assert.equal(TX_CHART_SOURCE_LIMITS.maxRecords,200000);
  assert.equal(full.sourceEventCount,140);assert.equal(full.lastPrice,20140);assert.equal(full.historyReadMode,'PRIVATE_SQLITE_STREAM');
  assert.equal(full.bars.reduce((n,b)=>n+b.volume,0),140);
  const oracle=loadTxDecisionChart({...options,dataRoot:f.root,sourceBudget:createTxChartReadBudget()});assert.deepEqual(content(full),content(oracle));
  clearTxChartLedgerCache();assert.deepEqual(content(complete(f)),content(oracle));
  const asOf='2026-11-04T07:00:39.000Z';assert.deepEqual(content(complete(f,{asOf})),content(loadTxDecisionChart({...options,dataRoot:f.root,asOf,sourceBudget:createTxChartReadBudget()})));
});
test('replacement/truncation creates a new private generation and never reuses the old latest price',t=>{
  const f=fixture(t);complete(f);clearTxChartLedgerCache();
  const file=path.join(f.root,'live-events','2026-11-05.ndjson');fs.writeFileSync(file,JSON.stringify(f.records[80])+'\n');
  const result=complete(f);assert.equal(result.sourceEventCount,81);assert.equal(result.lastPrice,20081);
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{assert.ok(db.prepare('SELECT count(*) n FROM sources').get().n>=3,'old generation remains on disk');}finally{db.close();}
});
test('derived cache row corruption is rejected and never repairs or overwrites the original source',t=>{
  const f=fixture(t);complete(f);clearTxChartLedgerCache();const file=path.join(f.root,'live-events','2026-11-05.ndjson'),before=fs.readFileSync(file);
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));db.exec("UPDATE events SET key='{}' WHERE rowid=(SELECT min(rowid) FROM events)");db.close();
  assert.throws(()=>complete(f),/TX_CHART_HISTORY_ROW_HASH_MISMATCH/);assert.deepEqual(fs.readFileSync(file),before);
});
for(const field of ['key','violation'])test(`NULL ${field} cannot bypass cache verification before query filtering`,t=>{
  const f=fixture(t);
  if(field==='violation'){
    const file=path.join(f.root,'live-events','2026-11-04.ndjson'),rows=fs.readFileSync(file,'utf8').trim().split('\n').map(JSON.parse);
    rows[0].receivedAt=new Date(Date.parse(rows[0].receivedAt)-1).toISOString();fs.writeFileSync(file,rows.map(JSON.stringify).join('\n')+'\n');
  }
  complete(f);clearTxChartLedgerCache();const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
  db.exec(`UPDATE events SET ${field}=NULL WHERE rowid=(SELECT min(rowid) FROM events WHERE ${field} IS NOT NULL)`);db.close();
  assert.throws(()=>complete(f),/TX_CHART_HISTORY_ROW_HASH_MISMATCH/);
});
test('a governed-calendar revision rederives normalized identity after reopening and keeps prior generations',t=>{
  const f=fixture(t);complete(f);clearTxChartLedgerCache();
  const revised={...calendar,tradingDates:new Set([...calendar.tradingDates].filter(date=>date!=='2026-11-05')),
    nonTradingDates:new Set([...calendar.nonTradingDates,'2026-11-05'])};
  const result=complete(f,{calendar:revised,tradeDate:'2026-11-06'});
  const oracle=loadTxDecisionChart({...options,calendar:revised,tradeDate:'2026-11-06',dataRoot:f.root,sourceBudget:createTxChartReadBudget()});
  assert.equal(result.sourceEventCount,140);assert.equal(result.tradeDate,'2026-11-06');assert.deepEqual(content(result),content(oracle));
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{assert.ok(db.prepare('SELECT count(*) n FROM sources').get().n>=4);}finally{db.close();}
});
test('a legal line above 1 MiB crosses bounded reads without losing its cursor or exceeding the original byte budget',t=>{
  const f=fixture(t);complete(f);const file=path.join(f.root,'live-events','2026-11-05.ndjson');
  const record={...f.records.at(-1),eventId:'large-synthetic-line',payload:{...f.records.at(-1).payload,close:20141}};
  const limit=2*1024*1024,base=JSON.stringify({...record,padding:''})+'\n';
  const line=JSON.stringify({...record,padding:'x'.repeat(limit-500-Buffer.byteLength(base))})+'\n';
  assert.ok(Buffer.byteLength(line)>1024*1024);fs.appendFileSync(file,line);
  const first=run(f,{limits:{maxSourceBytes:limit}});assert.equal(first.sourceComplete,false);
  const result=complete(f,{limits:{maxSourceBytes:limit}});assert.equal(result.sourceEventCount,141);
  assert.equal(result.bars.reduce((n,b)=>n+b.volume,0),141);
});
test('a small source-byte budget stages prefix validation and still advances an appended complete row',t=>{
  const f=fixture(t);complete(f);clearTxChartLedgerCache();const file=path.join(f.root,'live-events','2026-11-05.ndjson');
  fs.appendFileSync(file,JSON.stringify({...f.records.at(-1),eventId:'small-budget-append'})+'\n');
  const result=complete(f,{limits:{maxSourceBytes:1024}});assert.equal(result.sourceEventCount,141);
});
test('truncating or rewriting an uncommitted partial line discards stale carry while keeping the committed prefix',t=>{
  for(const mode of ['truncate','rewrite']){
    const f=fixture(t);complete(f);const file=path.join(f.root,'live-events','2026-11-05.ndjson'),prefix=fs.readFileSync(file);
    const old={...f.records.at(-1),eventId:'obsolete-partial',payload:{...f.records.at(-1).payload,close:29999},padding:'x'.repeat(1500000)};
    const partial=Buffer.from(JSON.stringify(old));fs.appendFileSync(file,partial);assert.equal(run(f).sourceComplete,false);
    const replacement={...f.records.at(-1),eventId:'replacement-complete',payload:{...f.records.at(-1).payload,close:20142},padding:mode==='rewrite'?'y'.repeat(1500000):''};
    let bytes=Buffer.from(JSON.stringify(replacement)+'\n');
    if(mode==='rewrite'){bytes=Buffer.concat([bytes,Buffer.alloc(Math.max(0,partial.length-bytes.length),32)]);}
    fs.writeFileSync(file,Buffer.concat([prefix,bytes]));
    const result=complete(f);assert.equal(result.sourceEventCount,141);assert.equal(result.bars.at(-1).high,20142);
  }
});
test('external cache updates invalidate an already verified handle and cannot hide NULL corruption',t=>{
  const f=fixture(t);complete(f);const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
  db.exec('UPDATE events SET key=NULL WHERE rowid=(SELECT min(rowid) FROM events)');db.close();
  assert.throws(()=>complete(f),/TX_CHART_HISTORY_ROW_HASH_MISMATCH/);
});
test('an interrupted private transaction rolls back its cursor and trusted counts before an exact once retry',t=>{
  const f=fixture(t);complete(f);fs.appendFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify({...f.records.at(-1),eventId:'transaction-retry'})+'\n');
  const original=DatabaseSync.prototype.exec;let injected=false;
  DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&!injected){injected=true;throw Error('SYNTHETIC_COMMIT_INTERRUPTION');}return original.call(this,sql);};
  try{assert.throws(()=>run(f),/SYNTHETIC_COMMIT_INTERRUPTION/);}finally{DatabaseSync.prototype.exec=original;}
  const result=complete(f);assert.equal(result.sourceEventCount,141);assert.equal(result.bars.reduce((n,b)=>n+b.volume,0),141);
});

function smallHistory(t,maxSourceBytes=1024){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tx-chart-growing-line-'));
  const file=path.join(root,'source.ndjson'),cacheRoot=path.join(root,'cache');
  t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});
  const read=(sourceBytes=maxSourceBytes)=>{const budget=createTxChartReadBudget({maxSourceBytes:sourceBytes});
    const result=readTxChartHistory({dataRoot:root,cacheRoot,files:[file],budget,
      decode:line=>line.trim()?JSON.parse(line):null,normalize:()=>({key:null,violation:null}),calendar:{}});
    assert.ok(budget.sourceBytesRead<=sourceBytes);return result;};
  return {root,file,cacheRoot,read};
}
test('a complete near-budget line advances while the source keeps growing between every poll',t=>{
  const {file,read}=smallHistory(t);
  fs.writeFileSync(file,'{}\n');read();
  const partial=JSON.stringify({padding:'x'.repeat(1006)});
  assert.equal(Buffer.byteLength(partial),1020);
  fs.appendFileSync(file,partial);read();read();
  fs.appendFileSync(file,'\n');
  let result;
  for(let i=0;i<12;i++){
    fs.appendFileSync(file,' ');result=read();
    if(result.sources[0].progress.cacheRecordCount===2)break;
  }
  assert.equal(result.sources[0].progress.sourceOffset,1024,'the already complete legal line must leave the pending cursor');
  assert.equal(result.sources[0].progress.cacheRecordCount,2);
});

test('an exact-budget complete line advances even when carry validation leaves no bytes for its suffix',t=>{
  const {file,read}=smallHistory(t);fs.writeFileSync(file,'{}\n');read();
  const line=JSON.stringify({padding:'x'.repeat(1009)})+'\n';assert.equal(Buffer.byteLength(line),1024);
  fs.appendFileSync(file,line.slice(0,-1));read(); // Carry consumes exactly the post-checkpoint budget.
  fs.appendFileSync(file,'\n');let result;
  for(let i=0;i<12;i++){fs.appendFileSync(file,' ');result=read();if(result.sources[0].progress.cacheRecordCount===2)break;}
  assert.equal(result.sources[0].progress.sourceOffset,1027);assert.equal(result.sources[0].progress.cacheRecordCount,2);
  assert.equal(result.sources[0].progress.complete,false,'captured bytes are not a claim of latest-source completeness');
});

for(const mode of ['same-size rewrite','truncate','replace inode','rewrite prefix while growing']){
  test(`a reserved fresh-line read rejects ${mode} before it can publish`,t=>{
    const {root,file,cacheRoot,read}=smallHistory(t);fs.writeFileSync(file,'{}\n');read();
    const old=JSON.stringify({padding:'x'.repeat(1006)});fs.appendFileSync(file,old);read();read();fs.appendFileSync(file,'\n');
    assert.ok(read().sources[0].progress.reasonCodes.includes('TX_CHART_PARTIAL_LINE_VALIDATION_PENDING'));
    const replacement=mode==='truncate'?{value:'replacement'}:{padding:'y'.repeat(1006)};
    const prefix=mode==='rewrite prefix while growing'?'[]\n':'{}\n';
    if(mode==='replace inode')fs.renameSync(file,file+'.old');
    fs.writeFileSync(file,prefix+JSON.stringify(replacement)+'\n'+(mode==='rewrite prefix while growing'?' \n':''));
    // Make same-size replacement deterministic even on coarse timestamp filesystems.
    const future=new Date(Date.now()+5000);fs.utimesSync(file,future,future);
    let result;for(let i=0;i<12;i++){result=read();if(result.sources[0].progress.complete)break;}
    assert.equal(result.sources[0].progress.complete,true);
    const db=new DatabaseSync(txChartHistoryPath(root,cacheRoot),{readOnly:true});
    try{const rows=db.prepare('SELECT json FROM events WHERE source=? ORDER BY offset').all(result.sources[0].id);
      assert.equal(rows.length,2);assert.deepEqual(JSON.parse(rows[1].json),replacement);
    }finally{db.close();}
  });
}

test('a freshly captured complete line requires a further source check after committing',t=>{
  const {file,read}=smallHistory(t);fs.writeFileSync(file,'{}\n');read();
  const partial=JSON.stringify({padding:'x'.repeat(1006)});fs.appendFileSync(file,partial);read();read();fs.appendFileSync(file,'\n');
  read();const committed=read();
  assert.equal(committed.sources[0].progress.cacheRecordCount,2);
  assert.equal(committed.sources[0].progress.complete,false);
  assert.ok(committed.sources[0].progress.reasonCodes.includes('TX_CHART_SNAPSHOT_RECHECK_PENDING'));
  assert.equal(read().sources[0].progress.complete,false,'old checkpoints must pass before the new cursor check');
  assert.equal(read().sources[0].progress.complete,true);
});

test('a fresh large-line read commits its rewritten middle in the same phase without staging stale complete bytes',t=>{
  const {root,file,cacheRoot,read}=smallHistory(t,4096);fs.writeFileSync(file,'{}\n');read();
  const base={prefix:'x'.repeat(1500),value:'old',suffix:''};
  const old=JSON.stringify({...base,suffix:'y'.repeat(4092-Buffer.byteLength(JSON.stringify(base)))});
  assert.equal(Buffer.byteLength(old),4092);
  fs.appendFileSync(file,old);read();read();fs.appendFileSync(file,'\n');
  assert.ok(read().sources[0].progress.reasonCodes.includes('TX_CHART_PARTIAL_LINE_VALIDATION_PENDING'));
  const replacement=old.replace('"value":"old"','"value":"new"');
  assert.equal(replacement.slice(0,512),old.slice(0,512));assert.equal(replacement.slice(-512),old.slice(-512));
  fs.writeFileSync(file,'{}\n'+replacement+'\n{}\n');
  const committed=read();
  assert.equal(committed.sources[0].progress.cacheRecordCount,3,'fresh complete bytes must enter the transaction in this read phase');
  assert.equal(committed.sources[0].progress.complete,false);
  assert.ok(committed.sources[0].progress.reasonCodes.includes('TX_CHART_SNAPSHOT_RECHECK_PENDING'));
  const db=new DatabaseSync(txChartHistoryPath(root,cacheRoot),{readOnly:true});
  try{const rows=db.prepare('SELECT json FROM events WHERE source=? ORDER BY offset').all(committed.sources[0].id);
    assert.equal(JSON.parse(rows[1].json).value,'new');
  }finally{db.close();}
  assert.equal(read().sources[0].progress.complete,false);
  assert.equal(read().sources[0].progress.complete,true);
});

function freshReadWithOldTailDebt(t,rewrite){
  const f=smallHistory(t,2048),base={before:'x'.repeat(1180),value:'old',after:''};
  const prefix=JSON.stringify({...base,after:'y'.repeat(1438-Buffer.byteLength(JSON.stringify(base)))})+'\n';
  assert.equal(Buffer.byteLength(prefix),1439);fs.writeFileSync(f.file,prefix);f.read();
  const partial=JSON.stringify({padding:'z'.repeat(2031)});assert.equal(Buffer.byteLength(partial),2045);
  fs.appendFileSync(f.file,partial);f.read();f.read();fs.appendFileSync(f.file,'\n');
  assert.ok(f.read().sources[0].progress.reasonCodes.includes('TX_CHART_PARTIAL_LINE_VALIDATION_PENDING'));
  const current=rewrite?prefix.replace('"value":"old"','"value":"new"'):prefix;
  assert.equal(current.slice(0,512),prefix.slice(0,512));
  if(rewrite)assert.notEqual(current.slice(-512),prefix.slice(-512));
  fs.writeFileSync(f.file,current+partial+'\n{}\n');
  const committed=f.read();assert.equal(committed.sources[0].progress.complete,false);
  assert.equal(committed.sources[0].progress.cacheRecordCount,2);
  assert.deepEqual([...committed.raw],[],'unverified checkpoint debt must block history iterators');
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{const debt=db.prepare('SELECT * FROM checkpoint_debt WHERE source=?').get(committed.sources[0].id);
    assert.equal(debt.offset,1439);assert.equal(debt.tailSize,512);
  }finally{db.close();}
  return {...f,committed};
}
for(const restart of [false,true])test(`old-tail rewrite plus growth resets the generation before completion${restart?' after restart':''}`,t=>{
  const f=freshReadWithOldTailDebt(t,true),oldId=f.committed.sources[0].id;
  if(restart)clearTxChartLedgerCache();
  let result;for(let i=0;i<20;i++){result=f.read();if(result.sources[0].progress.complete)break;}
  assert.equal(result.sources[0].progress.complete,true);assert.notEqual(result.sources[0].id,oldId);
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{const rows=db.prepare('SELECT json FROM events WHERE source=? ORDER BY offset').all(result.sources[0].id);
    assert.equal(rows.length,3);assert.equal(JSON.parse(rows[0].json).value,'new');
    assert.ok(db.prepare('SELECT count(*) n FROM events WHERE source=?').get(oldId).n>0,'old generation evidence remains');
  }finally{db.close();}
});
test('checkpoint debt survives restart and validates over bounded requests before the current cursor',t=>{
  const f=freshReadWithOldTailDebt(t,false);clearTxChartLedgerCache();
  for(let i=0;i<4;i++){
    const result=f.read(256);assert.equal(result.sources[0].progress.complete,false);assert.deepEqual([...result.raw],[]);
    assert.ok(result.sources[0].progress.reasonCodes.includes(i===3?'TX_CHART_CURRENT_CHECKPOINT_VALIDATION_PENDING':'TX_CHART_PRIOR_CHECKPOINT_VALIDATION_PENDING'));
  }
  const result=f.read();assert.equal(result.sources[0].progress.complete,true);assert.equal(result.sources[0].progress.cacheRecordCount,3);
});

test('pre-debt recipe caches rederive new generations instead of trusting rows without durable checkpoints',t=>{
  const f=fixture(t);complete(f);clearTxChartLedgerCache();
  const legacy=createHash('sha256').update(JSON.stringify(['tx-chart-history-v2',calendar],(_key,value)=>value instanceof Map?[...value]:value instanceof Set?[...value]:value)).digest('hex');
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));let oldIds;
  try{const sources=db.prepare('SELECT id,identity FROM sources').all();oldIds=sources.map(s=>s.id);
    for(const s of sources)db.prepare('UPDATE sources SET identity=? WHERE id=?').run(s.identity.replace(/[a-f0-9]{64}$/,legacy),s.id);
    db.exec("UPDATE events SET json='obsolete-derived-row'");
  }finally{db.close();}
  const result=complete(f);assert.equal(result.sourceEventCount,140);assert.equal(result.lastPrice,20140);
  const check=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{assert.ok(check.prepare('SELECT id FROM active').all().every(row=>!oldIds.includes(row.id)));
    assert.equal(check.prepare("SELECT count(*) n FROM events WHERE json='obsolete-derived-row'").get().n,140);
  }finally{check.close();}
});

test('interrupted fresh-read commit rolls back checkpoint debt with its cursor and rows',t=>{
  const f=smallHistory(t);fs.writeFileSync(f.file,'{}\n');f.read();
  fs.appendFileSync(f.file,JSON.stringify({padding:'x'.repeat(1006)}));f.read();f.read();fs.appendFileSync(f.file,'\n');f.read();
  const exec=DatabaseSync.prototype.exec;let interrupted=false;
  DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT'&&!interrupted){interrupted=true;throw Error('SYNTHETIC_DEBT_COMMIT_INTERRUPTION');}return exec.call(this,sql);};
  try{assert.throws(()=>f.read(),/SYNTHETIC_DEBT_COMMIT_INTERRUPTION/);}finally{DatabaseSync.prototype.exec=exec;}
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{assert.equal(db.prepare('SELECT count(*) n FROM checkpoint_debt').get().n,0);
    assert.equal(db.prepare('SELECT offset FROM sources JOIN active ON sources.id=active.id').get().offset,3);
    assert.equal(db.prepare('SELECT count(*) n FROM events').get().n,1);
  }finally{db.close();}
  clearTxChartLedgerCache();let result;
  for(let i=0;i<12;i++){result=f.read();if(result.sources[0].progress.complete)break;}
  assert.equal(result.sources[0].progress.complete,true);assert.equal(result.sources[0].progress.cacheRecordCount,2);
});

function coldMultiSourceHistory(t,{largeLastRow=false,counts=[1500,1800]}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'tx-chart-cold-history-')),cacheRoot=path.join(root,'cache');
  const files=[path.join(root,'2026-11-04.ndjson'),path.join(root,'2026-11-05.ndjson')];
  const expected=[];
  for(const [source,count] of counts.entries()){
    const rows=Array.from({length:count},(_,index)=>({source,index,
      ...(largeLastRow&&source===1&&index===count-1?{padding:'x'.repeat(2*1024*1024)}:{})}));
    expected.push(...rows);fs.writeFileSync(files[source],rows.map(JSON.stringify).join('\n')+'\n');
  }
  t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});
  const read=()=>{
    const budget=createTxChartReadBudget();
    const result=readTxChartHistory({dataRoot:root,cacheRoot,files,budget,decode:JSON.parse,
      normalize:()=>({key:null,violation:null}),calendar:{}});
    assert.ok(budget.sourceBytesRead<=budget.maxSourceBytes);assert.ok(budget.cacheBytesRead<=budget.maxCacheBytes);
    assert.ok(budget.remainingRecords>=0);return result;
  };
  const initial=read();assert.deepEqual([...initial.raw],expected,'populate from the source before dropping all resident trust');
  clearTxChartLedgerCache();
  return {root,cacheRoot,read,expected};
}
const verifiedHistoryRows=result=>result.sources.reduce((sum,source)=>sum+source.progress.cacheVerifiedRecords,0);
function finishColdHistory(f,first){
  let result=first,previous=0;
  for(let poll=0;poll<20;poll++){
    const count=verifiedHistoryRows(result);
    assert.ok(count-previous<=2000,'all sources share one bounded validation unit');assert.ok(count>=previous);
    if(result.sources.every(source=>source.progress.complete)){
      assert.equal(count,f.expected.length);assert.deepEqual([...result.raw],f.expected);return result;
    }
    assert.deepEqual([...result.raw],[]);assert.deepEqual([...result.ordered],[]);assert.deepEqual(result.violations,[]);
    if(count===f.expected.length)assert.ok(result.sources.every(source=>source.progress.state==='CACHE_VALIDATED_AWAITING_RENDER'),
      'the final validation batch must not also render');
    previous=count;result=f.read();
  }
  assert.fail('cold history failed to make bounded progress');
}

test('cold cross-source history validates over multiple requests and restart cannot reuse resident trust',t=>{
  const f=coldMultiSourceHistory(t),first=f.read();
  assert.ok(verifiedHistoryRows(first)>0);assert.ok(verifiedHistoryRows(first)<=2000);
  assert.ok(verifiedHistoryRows(first)<f.expected.length);assert.deepEqual([...first.raw],[]);
  clearTxChartLedgerCache();
  const restarted=f.read();assert.ok(verifiedHistoryRows(restarted)<=2000);
  assert.ok(verifiedHistoryRows(restarted)<f.expected.length);finishColdHistory(f,restarted);
});

test('a legal multi-megabyte row still validates after the cold shared row slice yields',t=>{
  const f=coldMultiSourceHistory(t,{largeLastRow:true});finishColdHistory(f,f.read());
});

test('tampering beyond the first cold validation batch is rejected before any source can publish',t=>{
  const f=coldMultiSourceHistory(t),first=f.read();assert.ok(verifiedHistoryRows(first)<f.expected.length);
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
  try{db.exec("UPDATE events SET json='{\"changed\":true}' WHERE source=(SELECT max(id) FROM active) AND offset=(SELECT max(offset) FROM events WHERE source=(SELECT max(id) FROM active))");}
  finally{db.close();}
  let rejected=false;
  for(let poll=0;poll<20;poll++){
    try{const result=f.read();assert.ok(!result.sources.every(source=>source.progress.complete));assert.deepEqual([...result.raw],[]);}
    catch(error){assert.match(error.message,/TX_CHART_HISTORY_ROW_HASH_MISMATCH/);rejected=true;break;}
  }
  assert.equal(rejected,true);
});

test('matching cached count at the slice boundary is not trusted until the cursor reaches EOF',t=>{
  t.mock.method(performance,'now',()=>0);
  const f=coldMultiSourceHistory(t,{counts:[1000,1000]}),first=f.read();
  assert.equal(verifiedHistoryRows(first),2000);
  assert.ok(first.sources.some(source=>!source.progress.complete));assert.deepEqual([...first.raw],[]);
  const next=f.read();assert.ok(next.sources.every(source=>source.progress.complete));assert.deepEqual([...next.raw],f.expected);
});

test('the shared cold verification deadline yields before the row cap and resumes',t=>{
  const f=coldMultiSourceHistory(t);let clock=0;
  t.mock.method(performance,'now',()=>clock+=100);
  const first=f.read();assert.ok(verifiedHistoryRows(first)>0&&verifiedHistoryRows(first)<2000);
  assert.deepEqual([...first.raw],[]);t.mock.restoreAll();finishColdHistory(f,first);
});

test('new generations reject orphan rows before trusting a reused source id',t=>{
  const f=smallHistory(t);fs.writeFileSync(f.file,'');f.read();
  const other=path.join(f.root,'second.ndjson');fs.writeFileSync(other,'');
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));let id;
  try{
    id=db.prepare('SELECT max(id)+1 n FROM sources').get().n;
    const prefix=`${id}:0:`,json='{"orphan":true}',hash=value=>createHash('sha256').update(value).digest('hex'),rawHash=hash(prefix+json);
    db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,0,json,null,null,null,null,rawHash,
      hash(prefix+JSON.stringify([null,null,null,rawHash])),hash(prefix));
  }finally{db.close();}
  assert.throws(()=>readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,files:[f.file,other],
    budget:createTxChartReadBudget(),decode:JSON.parse,normalize:()=>({key:null,violation:null}),calendar:{}}),/TX_CHART_HISTORY_ROW_COUNT_MISMATCH/);
  const check=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{
    assert.equal(check.prepare('SELECT count(*) n FROM sources WHERE id=?').get(id).n,0,'failed generation transaction rolls back');
    assert.equal(check.prepare('SELECT count(*) n FROM active WHERE path=?').get(other).n,0);
    assert.equal(check.prepare('SELECT count(*) n FROM events WHERE source=?').get(id).n,1,'orphan evidence stays intact');
  }finally{check.close();}
});

for(const corruption of ['deleted row','extra hashed row','negative offset','NULL offset','count too high','count too low']){
  test(`bounded cold verification rejects ${corruption} before rendering`,t=>{
    const f=coldMultiSourceHistory(t);f.read();
    const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
    try{
      const id=db.prepare('SELECT max(id) id FROM active').get().id;
      if(corruption==='deleted row')db.prepare('DELETE FROM events WHERE source=? AND offset=(SELECT max(offset) FROM events WHERE source=?)').run(id,id);
      else if(corruption==='extra hashed row'||corruption==='negative offset'||corruption==='NULL offset'){
        const offset=corruption==='negative offset'?-2:corruption==='NULL offset'?null:
          db.prepare('SELECT max(offset)+1 n FROM events WHERE source=?').get(id).n;
        const prefix=`${id}:${offset}:`,json='{}',hash=value=>createHash('sha256').update(value).digest('hex'),rawHash=hash(prefix+json);
        db.prepare('INSERT INTO events VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,offset,json,null,null,null,null,rawHash,
          hash(prefix+JSON.stringify([null,null,null,rawHash])),hash(prefix));
      }else db.prepare(`UPDATE sources SET count=count${corruption==='count too high'?'+':'-'}1 WHERE id=?`).run(id);
    }finally{db.close();}
    let rejected=false;
    for(let poll=0;poll<20;poll++){
      try{const result=f.read();assert.ok(result.sources.some(source=>!source.progress.complete));assert.deepEqual([...result.raw],[]);}
      catch(error){assert.match(error.message,/TX_CHART_HISTORY_ROW_COUNT_MISMATCH/);rejected=true;break;}
    }
    assert.equal(rejected,true);
  });
}

test('normal polling and capture resume the same frozen audit rather than resetting each other',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  assert.equal(run(f,selection).sourceAuditProgress.processedRecords,0);
  const capture=run(f,{...selection,holdCompletedAudit:true,now:new Date(now.getTime()+250)});
  assert.equal(capture.sourceAuditProgress.processedRecords+sourceProofChunkCount(f),100,'capture mode is not source identity; proof rows use the same record budget');
  const normal=run(f,{...selection,now:new Date(now.getTime()+500)});
  assert.equal(normal.sourceAuditProgress.state,'COMPLETE');assert.equal(normal.asOf,options.asOf);
  const held=run(f,{...selection,holdCompletedAudit:true,now:new Date(now.getTime()+750)});
  assert.equal(held.sourceAuditProgress.state,'COMPLETE');assert.equal(held.asOf,options.asOf,'normal poll must not discard an active capture prefix');
});
test('abandoned capture hold expires without renewal and ordinary live polling advances again',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true,holdCompletedAudit:true};
  run(f,selection);complete(f,selection);
  const at=new Date(now.getTime()+2000).toISOString(),record={...f.records.at(-1),eventId:'after-abandoned-capture',receivedAt:at,exchangeTimestamp:at,
    payload:{...f.records.at(-1).payload,datetime:at,close:20201}};
  fs.appendFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify(record)+'\n');
  assert.equal(run(f,{...selection,now:new Date(now.getTime()+9000)}).asOf,options.asOf);
  const released=complete(f,{...selection,holdCompletedAudit:false,now:new Date(now.getTime()+10001)});
  assert.equal(released.sourceEventCount,141);assert.equal(released.lastPrice,20201);
  assert.equal(released.asOf,new Date(now.getTime()+10001).toISOString());
});

// A completed ordinary chart is the user's currently visible verified prefix.
// Copy must not immediately repeat the same full chart/audit work.
test('capture reuses a recently completed ordinary audit without changing its cutoff',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  const visible=complete(f,selection);assert.equal(visible.sourceAuditProgress.state,'COMPLETE');
  const captured=run(f,{...selection,now:new Date(now.getTime()+500),holdCompletedAudit:true});
  assert.equal(captured.sourceAuditProgress.state,'COMPLETE');assert.equal(captured.asOf,visible.asOf);
  assert.equal(captured.sourceEventCount,visible.sourceEventCount);assert.equal(captured.lastPrice,visible.lastPrice);
});
test('ordinary polling after completion starts a new audit instead of freezing the completed prefix',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  const previous=complete(f,selection),next=run(f,{...selection,now:new Date(now.getTime()+1000)});
  assert.equal(next.sourceAuditProgress.state,'PENDING');assert.notEqual(next.asOf,previous.asOf);
});
test('completed capture reuse expires and does not hide a changed verified store',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  complete(f,selection);
  const expired=run(f,{...selection,now:new Date(now.getTime()+10001),holdCompletedAudit:true});
  assert.equal(expired.sourceAuditProgress.state,'PENDING');assert.notEqual(expired.asOf,options.asOf);
  clearTxChartLedgerCache();complete(f);complete(f,selection);
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
  db.exec('UPDATE events SET key=NULL WHERE rowid=(SELECT min(rowid) FROM events)');db.close();
  assert.throws(()=>run(f,{...selection,now:new Date(now.getTime()+500),holdCompletedAudit:true}),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});


// Original-byte proof regressions: all sources are isolated synthetic files.
function proofHistory(t,{rows=180}={}){
  const f=smallHistory(t,4*1024*1024);
  const records=Array.from({length:rows},(_,index)=>({index,padding:'x'.repeat(80)}));
  const bytes=Buffer.from(records.map(JSON.stringify).join('\n')+'\n');
  fs.writeFileSync(f.file,bytes);const history=f.read();
  assert.equal(history.sources[0].progress.complete,true);
  return {...f,records,bytes,history};
}
for(const ownWrites of [false,true])test(`original-byte proof makes finite 128-byte progress with append between every step; ownWrites=${ownWrites}`,t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease(),seen=[];
  if(ownWrites)assert.equal(lease.step(()=>{},createTxChartReadBudget()),true);
  let done=false,steps=0,previous=0,totalRead=0;
  const start=performance.now(),bound=Math.ceil(f.bytes.length/128)+2;
  for(;steps<bound&&!done;steps++){
    fs.appendFileSync(f.file,'{}\n');
    if(ownWrites)f.read();
    const budget=createTxChartReadBudget({maxSourceBytes:128});
    done=ownWrites?lease.supersededByOwnWrite(budget)==='SUPERSEDED':lease.step(row=>seen.push(row),budget);
    assert.ok(budget.sourceBytesRead<=128);assert.ok(budget.cacheBytesRead<=budget.maxCacheBytes);
    const progress=lease.sourceProofProgress;assert.ok(progress.scannedBytes>previous);
    previous=progress.scannedBytes;totalRead+=budget.sourceBytesRead;
  }
  assert.equal(done,true);assert.equal(previous,f.bytes.length);assert.equal(totalRead,f.bytes.length);
  assert.equal(lease.sourceProofProgress.state,'VERIFIED');
  if(!ownWrites)assert.deepEqual(seen,f.records,'appended rows remain outside the frozen snapshot');
  t.diagnostic(JSON.stringify({sourceBudget:128,steps,bytes:totalRead,appendEveryStep:true,ownWrites,elapsedMs:performance.now()-start}));
});

test('proof cancellation discards capture cursors and the next capture verifies from a fresh lease',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};
  complete(f,selection);
  fs.appendFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify({...f.records.at(-1),eventId:'cancel-proof'})+'\n');
  run(f,{...selection,now:new Date(now.getTime()+1000)});
  const pending=run(f,{...selection,holdCompletedAudit:true,now:new Date(now.getTime()+1250),limits:{maxSourceBytes:128}});
  assert.equal(pending.sourceComplete,false);assert.equal(pending.sourceAuditProgress.phase,'SOURCE_PROOF');
  releaseTxChartAudit();
  const next=run(f,{...selection,holdCompletedAudit:true,now:new Date(now.getTime()+1500)});
  assert.equal(next.sourceAuditProgress.state,'PENDING');assert.equal(next.sourceAuditProgress.processedRecords,0);
  assert.equal(next.asOf,new Date(now.getTime()+1500).toISOString());
  assert.equal(complete(f,{...selection,holdCompletedAudit:true,now:new Date(now.getTime()+1750)}).sourceEventCount,141);
});

for(const change of ['interior','truncate','replace','cache'])test(`pending original-byte proof remains invalid after ${change}`,t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease();
  assert.equal(lease.step(()=>assert.fail('unverified rows'),createTxChartReadBudget({maxSourceBytes:128})),false);
  if(change==='interior'){
    const bytes=Buffer.from(f.bytes),at=bytes.indexOf(Buffer.from('"index":90'));
    assert.ok(at>512&&at<f.bytes.length-512);bytes.write('"index":99',at);fs.writeFileSync(f.file,bytes);fs.appendFileSync(f.file,'{}\n');
  }else if(change==='truncate')fs.writeFileSync(f.file,'{}\n');
  else if(change==='replace'){fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,f.bytes);}
  else{const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));try{db.exec("UPDATE events SET json='{}' WHERE offset=0");}finally{db.close();}}
  for(let attempt=0;attempt<2;attempt++)assert.throws(()=>lease.step(()=>assert.fail('unverified rows'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  assert.equal(lease.sourceProofProgress.state,'INVALID');
});

test('a completed proof renews all raw bytes after an interior edit plus append even without own writes',t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease();assert.equal(lease.step(()=>{},createTxChartReadBudget()),true);
  const bytes=Buffer.from(f.bytes),at=bytes.indexOf(Buffer.from('"index":90'));bytes.write('"index":99',at);
  fs.writeFileSync(f.file,bytes);fs.appendFileSync(f.file,'{}\n');
  assert.throws(()=>lease.step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});

test('source proof includes original bytes discarded by the chart projection',t=>{
  const f=smallHistory(t,4096),before='{"keep":1}\n'+JSON.stringify({ignored:'x'.repeat(2000)})+'\n';fs.writeFileSync(f.file,before);
  const history=readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,files:[f.file],budget:createTxChartReadBudget(),
    decode:line=>{const row=JSON.parse(line);return row.keep?row:null;},normalize:()=>({key:null,violation:null}),calendar:{}});
  const lease=history.createRawReadLease();assert.equal(lease.totalRecords,1);
  const after=Buffer.from(before);after[1000]=121;fs.writeFileSync(f.file,after);fs.appendFileSync(f.file,'{}\n');
  assert.throws(()=>lease.step(()=>assert.fail('unverified rows'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});

for(const race of ['same-size rewrite','replace','truncate'])test(`proof slice detects source ${race} between read and final descriptor/path check`,t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease(),read=fs.readSync;let injected=false;
  t.mock.method(fs,'readSync',function(...args){const result=read.apply(this,args);if(!injected){injected=true;
    if(race==='same-size rewrite'){const changed=Buffer.from(f.bytes);changed[1000]=121;fs.writeFileSync(f.file,changed);const later=new Date(Date.now()+5000);fs.utimesSync(f.file,later,later);}
    else if(race==='truncate')fs.writeFileSync(f.file,'{}\n');
    else{fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,f.bytes);}
  }return result;});
  assert.throws(()=>lease.step(()=>assert.fail('unverified rows'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  assert.equal(injected,true);assert.equal(lease.sourceProofProgress.state,'INVALID');
});

test('original proof and appended rows roll back together on source mutation during ingestion',t=>{
  const f=proofHistory(t,{rows:5}),dbFile=txChartHistoryPath(f.root,f.cacheRoot);
  const snapshot=()=>{const db=new DatabaseSync(dbFile,{readOnly:true});try{return {
    source:db.prepare('SELECT * FROM sources').all(),proof:db.prepare('SELECT * FROM source_provenance').all(),
    chunks:db.prepare('SELECT * FROM source_chunks').all(),events:db.prepare('SELECT * FROM events').all()};}finally{db.close();}};
  const before=snapshot();fs.appendFileSync(f.file,'{}\n');let injected=false;
  assert.throws(()=>readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,files:[f.file],budget:createTxChartReadBudget(),decode:JSON.parse,
    normalize:()=>{if(!injected){injected=true;const raw=fs.readFileSync(f.file);raw[100]=121;fs.writeFileSync(f.file,raw);const later=new Date(Date.now()+5000);fs.utimesSync(f.file,later,later);}return {key:null,violation:null};},calendar:{}}),/TX_CHART_SOURCE_CHANGED_DURING_READ/);
  assert.deepEqual(snapshot(),before,'all attempted proof, rows and cursor changes roll back');
  // Restore only this isolated synthetic source for an exact-once retry.
  fs.writeFileSync(f.file,Buffer.concat([f.bytes,Buffer.from('{}\n')]));
  clearTxChartLedgerCache();let result;for(let i=0;i<4;i++){result=f.read();if(result.sources[0].progress.complete)break;}
  const lease=result.createRawReadLease(),seen=[];assert.equal(lease.step(row=>seen.push(row),createTxChartReadBudget()),true);
  assert.equal(seen.length,6);
});

test('legacy cache without original proofs is preserved while a separate bounded current generation is reconstructed',t=>{
  // Build the actual pre-proof schema and rows directly. Never obtain a legacy
  // fixture by deleting witnesses from a generation created by today's writer.
  const f=smallHistory(t,4*1024*1024),records=Array.from({length:180},(_,index)=>({index,padding:'x'.repeat(80)}));
  f.bytes=Buffer.from(records.map(JSON.stringify).join('\n')+'\n');fs.writeFileSync(f.file,f.bytes);
  fs.mkdirSync(f.cacheRoot);const dbFile=txChartHistoryPath(f.root,f.cacheRoot),db=new DatabaseSync(dbFile);let original;
  const digest=value=>createHash('sha256').update(value).digest('hex'),stat=fs.statSync(f.file);
  const recipe=digest(JSON.stringify(['tx-chart-history-v2','checkpoint-debt-v1',{}]));
  const sourceIdentity=`${stat.dev}:${stat.ino}:${stat.birthtimeMs}:${recipe}`;
  try{db.exec(`CREATE TABLE binding(version TEXT,root TEXT);
    CREATE TABLE sources(id INTEGER PRIMARY KEY,path TEXT,identity TEXT,offset INTEGER,observed INTEGER,mtime REAL,
      headSize INTEGER,headHash TEXT,tailSize INTEGER,tailHash TEXT,count INTEGER);
    CREATE TABLE active(path TEXT PRIMARY KEY,id INTEGER);
    CREATE TABLE events(source INTEGER,offset INTEGER,json TEXT,key TEXT,event REAL,available REAL,violation TEXT,
      rawHash TEXT,keyHash TEXT,violationHash TEXT,PRIMARY KEY(source,offset));`);
    db.prepare('INSERT INTO binding VALUES(?,?)').run('tx-chart-history-v2',path.resolve(f.root));
    db.prepare('INSERT INTO sources VALUES(1,?,?,?,?,?,512,?,512,?,?)').run(f.file,sourceIdentity,f.bytes.length,f.bytes.length,stat.mtimeMs,
      digest(f.bytes.subarray(0,512)),digest(f.bytes.subarray(-512)),records.length);
    db.prepare('INSERT INTO active VALUES(?,1)').run(f.file);
    let offset=0;for(const record of records){const json=JSON.stringify(record),prefix=`1:${offset}:`,rawHash=digest(prefix+json);
      db.prepare('INSERT INTO events VALUES(1,?,?,NULL,NULL,NULL,NULL,?,?,?)').run(offset,json,rawHash,
        digest(prefix+JSON.stringify([null,null,null,rawHash])),digest(prefix));offset+=Buffer.byteLength(json)+1;}
    assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE name LIKE 'source_%' AND name!='sources'").all().length,0);
    original={sources:db.prepare('SELECT * FROM sources').all(),events:db.prepare('SELECT * FROM events').all()};
  }finally{db.close();}
  // A current raw rewrite cannot retroactively prove the historical cached 90.
  const raw=Buffer.from(f.bytes),at=raw.indexOf(Buffer.from('"index":90'));raw.write('"index":99',at);fs.writeFileSync(f.file,raw);
  const oldId=original.sources[0].id;let result,polls=0;
  for(;polls<100;polls++){result=f.read(1024);if(result.sources[0].progress.complete)break;
    assert.throws(()=>result.createRawReadLease(),/TX_CHART_HISTORY_NOT_VERIFIED/);
    if(polls===2)clearTxChartLedgerCache();
  }
  assert.ok(polls>2&&polls<100);assert.notEqual(result.sources[0].id,oldId);
  const check=new DatabaseSync(dbFile,{readOnly:true});
  try{const oldSource=check.prepare('SELECT * FROM sources WHERE id=?').get(oldId);
    const {proofFormat,...oldFields}=oldSource;assert.ok(proofFormat==null);assert.deepEqual([oldFields],original.sources.map(row=>({...row})));
    assert.deepEqual(check.prepare('SELECT * FROM events WHERE source=?').all(oldId),original.events);
    assert.equal(check.prepare('SELECT * FROM source_provenance WHERE source=?').get(oldId),undefined);
    assert.equal(check.prepare('SELECT count(*) n FROM source_chunks WHERE source=?').get(oldId).n,0);
  }finally{check.close();}
  const lease=result.createRawReadLease(),seen=[];assert.equal(lease.step(row=>seen.push(row),createTxChartReadBudget()),true);
  assert.equal(seen[90].index,99);assert.equal(JSON.parse(original.events[90].json).index,90);
  t.diagnostic(JSON.stringify({legacyPreserved:true,currentGeneration:result.sources[0].id,reconstructionPolls:polls+1,sourceBudget:1024}));
});

for(const corruption of ['missing chunk','wrong digest','gap','wrong generation'])test(`persisted original-byte evidence fails closed after restart: ${corruption}`,t=>{
  const f=proofHistory(t);clearTxChartLedgerCache();const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
  try{if(corruption==='missing chunk')db.exec('DELETE FROM source_chunks');
    else if(corruption==='wrong digest')db.exec("UPDATE source_chunks SET digest='"+'0'.repeat(64)+"'");
    else if(corruption==='gap')db.exec('UPDATE source_chunks SET start=start+1');
    else db.exec('UPDATE source_chunks SET source=source+100');
  }finally{db.close();}
  let history;for(let i=0;i<4;i++){history=f.read();if(history.sources[0].progress.complete)break;}
  const lease=history.createRawReadLease();
  assert.throws(()=>lease.step(()=>assert.fail('unverified proof'),createTxChartReadBudget()),/TX_CHART_HISTORY_(PROOF_UNAVAILABLE|READ_LEASE_INVALID)/);
  assert.equal(lease.sourceProofProgress.state,'INVALID');
});

test('bounded proof metadata/cache budget and cooperative time slice yield without losing the raw cursor',t=>{
  const f=proofHistory(t,{rows:1600}),lease=f.history.createRawReadLease(),seen=[];
  let clock=0;t.mock.method(performance,'now',()=>clock+=400);
  const first=createTxChartReadBudget();assert.equal(lease.step(row=>seen.push(row),first),false);
  assert.ok(first.sourceBytesRead>0&&first.sourceBytesRead<f.bytes.length);assert.deepEqual(seen,[]);
  t.mock.restoreAll();const progress=lease.sourceProofProgress.scannedBytes;
  const noCache=createTxChartReadBudget({maxCacheBytes:1});assert.equal(lease.step(row=>seen.push(row),noCache),false);
  assert.equal(lease.sourceProofProgress.scannedBytes,progress);assert.equal(noCache.cacheBytesRead,0);
  const last=createTxChartReadBudget();assert.equal(lease.step(row=>seen.push(row),last),true);assert.deepEqual(seen,f.records);
  assert.equal(first.sourceBytesRead+last.sourceBytesRead,f.bytes.length);
  assert.ok(last.sourceBytesRead<=last.maxSourceBytes);assert.ok(last.cacheBytesRead<=last.maxCacheBytes);
});


test('suffix append inside proof read does not invalidate a correctly witnessed frozen prefix',t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease(),read=fs.readSync,seen=[];let injected=false;
  t.mock.method(fs,'readSync',function(...args){const result=read.apply(this,args);if(!injected){injected=true;fs.appendFileSync(f.file,'{}\n');}return result;});
  assert.equal(lease.step(row=>seen.push(row),createTxChartReadBudget()),true);
  assert.deepEqual(seen,f.records);assert.equal(injected,true);
  assert.ok(fs.statSync(f.file).size>lease.sourceProofProgress.totalBytes);
});

test('suffix append inside ingestion preserves the fixed observed range and progresses on the next poll',t=>{
  const f=proofHistory(t,{rows:5});fs.appendFileSync(f.file,'{}\n');let injected=false;
  const history=readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,files:[f.file],budget:createTxChartReadBudget(),decode:JSON.parse,
    normalize:()=>{if(!injected){injected=true;fs.appendFileSync(f.file,'{}\n');}return {key:null,violation:null};},calendar:{}});
  const frozen=history.createRawReadLease(),seen=[];assert.equal(frozen.step(row=>seen.push(row),createTxChartReadBudget()),true);
  assert.equal(seen.length,6);const next=f.read(),appended=[];
  assert.equal(next.createRawReadLease().step(row=>appended.push(row),createTxChartReadBudget()),true);assert.equal(appended.length,7);
});


test('multiple growing sources share a bounded proof cursor without redoing completed earlier sources',t=>{
  const f=proofHistory(t,{rows:1}),second=path.join(f.root,'second.ndjson'),records=Array.from({length:40},(_,index)=>({index}));
  const bytes=Buffer.from(records.map(JSON.stringify).join('\n')+'\n');fs.writeFileSync(second,bytes);
  const history=readTxChartHistory({dataRoot:f.root,cacheRoot:f.cacheRoot,files:[f.file,second],budget:createTxChartReadBudget(),
    decode:JSON.parse,normalize:()=>({key:null,violation:null}),calendar:{}});
  const lease=history.createRawReadLease(),seen=[];let done=false,read=0,steps=0;
  for(;steps<20&&!done;steps++){
    fs.appendFileSync(f.file,'{}\n');fs.appendFileSync(second,'{}\n');
    const budget=createTxChartReadBudget({maxSourceBytes:128});done=lease.step(row=>seen.push(row),budget);read+=budget.sourceBytesRead;
    assert.ok(budget.sourceBytesRead<=128);
  }
  assert.equal(done,true);assert.deepEqual(seen,[...f.records,...records]);assert.equal(read,f.bytes.length+bytes.length);
});

test('restart cannot mint original proof from an interior rewrite followed by append',t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease();
  assert.equal(lease.step(()=>{},createTxChartReadBudget({maxSourceBytes:128})),false);clearTxChartLedgerCache();
  const changed=Buffer.from(f.bytes),at=changed.indexOf(Buffer.from('"index":90'));changed.write('"index":99',at);
  fs.writeFileSync(f.file,changed);fs.appendFileSync(f.file,'{}\n');
  assert.throws(()=>lease.step(()=>{},createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  let history;for(let i=0;i<4;i++){history=f.read();if(history.sources[0].progress.complete)break;}
  assert.equal(history.sources[0].id,f.history.sources[0].id,'existing proof remains attached to its original generation');
  assert.throws(()=>history.createRawReadLease().step(()=>assert.fail('unverified rows'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  t.diagnostic(JSON.stringify({beforeSha256:createHash('sha256').update(f.bytes).digest('hex'),
    afterSha256:createHash('sha256').update(fs.readFileSync(f.file)).digest('hex'),rewriteOffset:at,restartRejected:true}));
});

test('modest multi-chunk prefix verifies within original source/cache/record budgets and worker time limit',t=>{
  const start=performance.now(),f=proofHistory(t,{rows:12000}),lease=f.history.createRawReadLease();
  let done=false,steps=0,totalRead=0,records=0,maxStepMs=0;
  while(!done&&steps<20){const budget=createTxChartReadBudget({maxSourceBytes:128*1024,maxRecords:2000}),at=performance.now();
    done=lease.step(()=>records++,budget);steps++;totalRead+=budget.sourceBytesRead;maxStepMs=Math.max(maxStepMs,performance.now()-at);
    assert.ok(budget.sourceBytesRead<=budget.maxSourceBytes);assert.ok(budget.cacheBytesRead<=budget.maxCacheBytes);assert.ok(budget.remainingRecords>=0);
  }
  assert.equal(done,true);assert.equal(records,12000);assert.equal(totalRead,f.bytes.length);assert.ok(steps>1);assert.ok(maxStepMs<8000);
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});let chunks;
  try{chunks=db.prepare('SELECT count(*) n FROM source_chunks').get().n;assert.ok(chunks>1);assert.ok(db.prepare('SELECT max(end-start) n FROM source_chunks').get().n<=65536);}
  finally{db.close();}
  t.diagnostic(JSON.stringify({syntheticRecords:records,prefixBytes:f.bytes.length,proofChunks:chunks,sourceBudget:128*1024,recordBudget:2000,steps,maxStepMs,totalMs:performance.now()-start}));
});


test('pending retirement proof cannot return a cutoff below a newer minimumCutoff',t=>{
  const f=fixture(t);complete(f);const now=new Date(options.asOf),selection={asOf:null,now,staged:true};complete(f,selection);
  fs.appendFileSync(path.join(f.root,'live-events','2026-11-05.ndjson'),JSON.stringify({...f.records.at(-1),eventId:'newer-minimum'})+'\n');
  const b=run(f,{...selection,now:new Date(now.getTime()+1000)});assert.equal(b.sourceAuditProgress.state,'PENDING');
  const minimumCutoff=new Date(now.getTime()+1500).toISOString();
  const capture={...selection,holdCompletedAudit:true,minimumCutoff,now:new Date(now.getTime()+2000)};
  const pending=run(f,{...capture,limits:{maxSourceBytes:128}});
  assert.equal(pending.sourceComplete,false);assert.ok(Date.parse(pending.asOf)>=Date.parse(minimumCutoff));
  assert.notEqual(pending.asOf,b.asOf,'a pending proof must not expose the old frozen frame under a newer minimum');
  const final=complete(f,capture);assert.equal(final.sourceComplete,true);assert.ok(Date.parse(final.asOf)>=Date.parse(minimumCutoff));
});


test('proof metadata and raw audit rows share the exact record budget',t=>{
  const f=proofHistory(t,{rows:3}),lease=f.history.createRawReadLease(),seen=[];
  const proof=createTxChartReadBudget({maxRecords:1});assert.equal(lease.step(row=>seen.push(row),proof),false);
  assert.equal(proof.remainingRecords,0);assert.equal(proof.sourceBytesRead,f.bytes.length);assert.deepEqual(seen,[]);
  const audit=createTxChartReadBudget({maxRecords:1});assert.equal(lease.step(row=>seen.push(row),audit),false);
  assert.equal(audit.remainingRecords,0);assert.equal(audit.sourceBytesRead,0);assert.deepEqual(seen,[f.records[0]]);
  assert.equal(lease.step(row=>seen.push(row),createTxChartReadBudget()),true);assert.deepEqual(seen,f.records);
});


test('r5 missing provenance after refused interior rewrite cannot reconstruct a proven generation on restart',t=>{
  const f=proofHistory(t),id=f.history.sources[0].id,lease=f.history.createRawReadLease();
  const raw=Buffer.from(f.bytes),at=raw.indexOf(Buffer.from('"index":90'));
  assert.ok(at>512&&at<f.bytes.length-512);raw.write('"index":99',at);
  fs.writeFileSync(f.file,raw);fs.appendFileSync(f.file,'{}\n');
  assert.throws(()=>lease.step(()=>assert.fail('corrupt prefix published'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  assert.equal(lease.sourceProofProgress.state,'INVALID');clearTxChartLedgerCache();
  const dbFile=txChartHistoryPath(f.root,f.cacheRoot),db=new DatabaseSync(dbFile);let chunks;
  try{chunks=db.prepare('SELECT * FROM source_chunks').all();assert.ok(chunks.length>0);
    db.prepare('DELETE FROM source_provenance WHERE source=?').run(id);
  }finally{db.close();}
  for(let attempt=0;attempt<2;attempt++){
    assert.throws(()=>f.read(),/TX_CHART_HISTORY_PROOF_UNAVAILABLE/);clearTxChartLedgerCache();
  }
  const check=new DatabaseSync(dbFile,{readOnly:true});try{
    assert.equal(check.prepare('SELECT id FROM active').get().id,id);
    assert.equal(check.prepare('SELECT count(*) n FROM sources').get().n,1);
    assert.deepEqual(check.prepare('SELECT * FROM source_chunks').all(),chunks);
    assert.equal(check.prepare('SELECT * FROM source_provenance').get(),undefined);
  }finally{check.close();}
});

for(const mode of ['empty','missing chunks','missing proof tables','missing format and provenance'])test(`r5 generation marker prevents false legacy reconstruction: ${mode}`,t=>{
  const f=mode==='empty'?smallHistory(t):proofHistory(t);
  if(mode==='empty'){fs.writeFileSync(f.file,'');f.history=f.read();}
  const id=f.history.sources[0].id;clearTxChartLedgerCache();const dbFile=txChartHistoryPath(f.root,f.cacheRoot),db=new DatabaseSync(dbFile);
  try{if(mode==='missing proof tables')db.exec('DROP TABLE source_provenance; DROP TABLE source_chunks');
    else{db.exec('DELETE FROM source_provenance');if(mode==='missing chunks')db.exec('DELETE FROM source_chunks');
      if(mode==='missing format and provenance')db.exec('ALTER TABLE sources DROP COLUMN proofFormat');}
  }finally{db.close();}
  assert.throws(()=>f.read(),/TX_CHART_HISTORY_PROOF_UNAVAILABLE/);
  const check=new DatabaseSync(dbFile,{readOnly:true});try{assert.equal(check.prepare('SELECT id FROM active').get().id,id);
    assert.equal(check.prepare('SELECT count(*) n FROM sources').get().n,1);
  }finally{check.close();}
});

// Inject only after the final descriptor sample has been taken, before the
// following path sample. Real read/ingest/lease code executes unchanged.
function mutateBetweenFdAndPath(t,file,mutate){
  const read=fs.readSync,fstat=fs.fstatSync,stat=fs.statSync;let readSeen=false,injected=false,pathSeen=false,sampledSize;
  t.mock.method(fs,'readSync',function(...args){const result=read.apply(this,args);readSeen=true;return result;});
  t.mock.method(fs,'fstatSync',function(...args){const result=fstat.apply(this,args);
    if(readSeen&&!injected&&args[1]?.bigint){sampledSize=result.size;injected=true;mutate();}return result;});
  t.mock.method(fs,'statSync',function(...args){const result=stat.apply(this,args);
    if(injected&&args[0]===file&&args[1]?.bigint)pathSeen=true;return result;});
  return ()=>{assert.equal(injected,true);assert.equal(pathSeen,true);return sampledSize;};
}
for(const phase of ['proof','ingestion'])test(`r5 suffix append between fd and path samples preserves ${phase}`,t=>{
  const f=proofHistory(t,{rows:5}),lease=f.history.createRawReadLease(),seen=[];
  if(phase==='ingestion')fs.appendFileSync(f.file,'{}\n');
  const assertInjected=mutateBetweenFdAndPath(t,f.file,()=>fs.appendFileSync(f.file,'{}\n'));
  if(phase==='proof')assert.equal(lease.step(row=>seen.push(row),createTxChartReadBudget()),true);
  else assert.equal(f.read().createRawReadLease().step(row=>seen.push(row),createTxChartReadBudget()),true);
  const sampledSize=assertInjected();assert.ok(BigInt(fs.statSync(f.file).size)>sampledSize);t.mock.restoreAll();
  assert.deepEqual(seen,phase==='proof'?f.records:[...f.records,{}]);
  if(phase==='proof'){assert.equal(lease.sourceProofProgress.state,'VERIFIED');assert.equal(lease.step(()=>assert.fail('duplicate'),createTxChartReadBudget()),true);}
  const next=[];assert.equal(f.read().createRawReadLease().step(row=>next.push(row),createTxChartReadBudget()),true);
  assert.deepEqual(next,[...f.records,...Array.from({length:phase==='proof'?1:2},()=>({}))]);
});
for(const change of ['same-size rewrite','shrink','shrink grown suffix','replacement'])test(`r5 fd/path sample gap still rejects ${change}`,t=>{
  const f=proofHistory(t),lease=f.history.createRawReadLease();
  if(change==='shrink grown suffix')fs.appendFileSync(f.file,'{}\n{}\n');
  const assertInjected=mutateBetweenFdAndPath(t,f.file,()=>{
    if(change==='same-size rewrite'){const bytes=Buffer.from(f.bytes);bytes[1000]=121;fs.writeFileSync(f.file,bytes);
      const later=new Date(Date.now()+5000);fs.utimesSync(f.file,later,later);}
    else if(change==='shrink')fs.writeFileSync(f.file,'{}\n');
    else if(change==='shrink grown suffix')fs.truncateSync(f.file,f.bytes.length+3);
    else{fs.renameSync(f.file,f.file+'.old');fs.writeFileSync(f.file,f.bytes);}
  });
  assert.throws(()=>lease.step(()=>assert.fail('unverified rows'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
  assertInjected();t.mock.restoreAll();assert.equal(lease.sourceProofProgress.state,'INVALID');
  assert.throws(()=>lease.step(()=>assert.fail('sticky failure'),createTxChartReadBudget()),/TX_CHART_HISTORY_READ_LEASE_INVALID/);
});


for(const empty of [false,true])test(`r5 pre-marker proof generation is sealed without reconstructing original witnesses: empty=${empty}`,t=>{
  const f=empty?smallHistory(t):proofHistory(t);
  if(empty){fs.writeFileSync(f.file,'');f.history=f.read();}
  const id=f.history.sources[0].id,dbFile=txChartHistoryPath(f.root,f.cacheRoot);clearTxChartLedgerCache();
  const db=new DatabaseSync(dbFile);let original;
  try{db.exec('ALTER TABLE sources DROP COLUMN proofFormat');
    original={provenance:db.prepare('SELECT * FROM source_provenance').all(),chunks:db.prepare('SELECT * FROM source_chunks').all(),
      events:db.prepare('SELECT * FROM events').all()};
  }finally{db.close();}
  let history;for(let i=0;i<4;i++){history=f.read();if(history.sources[0].progress.complete)break;}
  assert.equal(history.sources[0].id,id);const seen=[];
  assert.equal(history.createRawReadLease().step(row=>seen.push(row),createTxChartReadBudget()),true);
  assert.deepEqual(seen,empty?[]:f.records);clearTxChartLedgerCache();
  const check=new DatabaseSync(dbFile);try{
    assert.equal(check.prepare('SELECT proofFormat FROM sources WHERE id=?').get(id).proofFormat,'original-bytes-v1');
    assert.deepEqual(check.prepare('SELECT * FROM source_provenance').all(),original.provenance);
    assert.deepEqual(check.prepare('SELECT * FROM source_chunks').all(),original.chunks);
    assert.deepEqual(check.prepare('SELECT * FROM events').all(),original.events);
    check.exec('DELETE FROM source_provenance; DELETE FROM source_chunks');
  }finally{check.close();}
  assert.throws(()=>f.read(),/TX_CHART_HISTORY_PROOF_UNAVAILABLE/);
});

for(const field of ['identity','offset','count','proofFormat'])test(`r5 corrupt generation witness rejects ${field} after restart`,t=>{
  const f=proofHistory(t),id=f.history.sources[0].id;clearTxChartLedgerCache();
  const db=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot));
  try{if(field==='proofFormat')db.exec("UPDATE sources SET proofFormat='unknown-format'");
    else if(field==='identity')db.exec("UPDATE source_provenance SET identity='wrong-generation'");
    else db.exec(`UPDATE source_provenance SET ${field}=${field}+1`);
  }finally{db.close();}
  assert.throws(()=>f.read(),/TX_CHART_HISTORY_(PROVENANCE_MISMATCH|ROW_COUNT_MISMATCH)/);
  const check=new DatabaseSync(txChartHistoryPath(f.root,f.cacheRoot),{readOnly:true});
  try{assert.equal(check.prepare('SELECT id FROM active').get().id,id);}finally{check.close();}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {loadTxDecisionChart,clearTxChartLedgerCache,createTxChartReadBudget,TX_CHART_SOURCE_LIMITS} from '../src/dashboard-tx-chart-source.mjs';
import {readTxChartHistory,txChartHistoryPath} from '../src/dashboard-tx-chart-store.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'tx-chart-history-'));fs.mkdirSync(path.join(root,'live-events'));
  const cacheRoot=path.join(root,'cache');t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});
  const records=[];let previous='GENESIS';
  for(const [date,count,start] of [['2026-11-04',80,'2026-11-04T07:00:00Z'],['2026-11-05',60,'2026-11-04T16:00:00Z']]){
    const rows=[];for(let i=0;i<count;i++){const at=new Date(Date.parse(start)+i*1000).toISOString();
      const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFK6',receivedAt:at,sequenceGap:0,researchOnly:true,formalWeight:0,executionAuthorized:false,orderRoutesEnabled:false,
        payload:{code:'TXFK6',datetime:at,_product_family:'TX',_target_code:'TXFK6',close:20001+records.length,volume:1,tick_type:1}},previous);
      previous=row.recordHash;rows.push(row);records.push(row);}
    fs.writeFileSync(path.join(root,'live-events',date+'.ndjson'),rows.map(JSON.stringify).join('\n')+'\n');}
  return {root,cacheRoot,records};}
const options={calendar,timeframe:'5m',mode:'LIVE',tradeDate:'2026-11-05',session:'NIGHT',actualContract:'TXFK6',asOf:'2026-11-04T16:01:00.000Z'};
function run(f,extra={}){const {limits={},...selection}=extra,budget=createTxChartReadBudget({maxRecords:100,...limits});
  const chart=loadTxDecisionChart({...options,dataRoot:f.root,cacheRoot:f.cacheRoot,sourceBudget:budget,...selection});
  assert.ok(budget.sourceBytesRead<=budget.maxSourceBytes);assert.ok(budget.remainingRecords>=0);return chart;}
function complete(f,extra={}){for(let i=0;i<12;i++){const result=run(f,extra);if(result.sourceComplete)return result;}assert.fail('finite source did not finish within bounded retries');}
function content(chart){const {sourceComplete,sourceReadState,sourceProgress,sourceReadBytes,cacheReadBytes,cacheWriteBytes,historyReadMode,historyPageCacheKiB,historyReadBytes,cacheWriteMeasurement,...rest}=chart;return rest;}
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

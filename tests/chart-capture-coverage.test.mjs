import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {knownCaptureIntervals, captureIntervalOverlaps} from '../src/chart-capture-coverage.mjs';
import {loadTxDecisionChart, readTxLiveEventLedger, clearTxChartLedgerCache} from '../src/dashboard-tx-chart-source.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {buildDecisionLevelWatch} from '../src/decision-level-watch.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const ms=time=>Date.parse(`2026-10-15T${time}+08:00`),iso=time=>new Date(time).toISOString();
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
function tick(time, price=100) {return {kind:'futures_tick',product:'TXFJ6',exchangeTimestamp:iso(time),receivedAt:iso(time-20),
 eventId:`tick-${time}`,duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,
 payload:{code:'TXFJ6',datetime:iso(time),close:price,volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFJ6'}};}
function lifecycle(time, {kind='provider_event',code=4,topic='TIC/v1/FOP/*/TFE/TXFJ6'}={}) {return {kind,product:'bridge',
 receivedAt:iso(time),exchangeTimestamp:iso(time),eventId:`event-${kind}-${time}`,duplicate:false,sequenceGap:0,
 executionAuthorized:false,orderRoutesEnabled:false,payload:{code:'bridge',datetime:iso(time),eventCode:code,info:topic}};}
const opening=()=>Array.from({length:9},(_,i)=>tick(ms('08:46:19.435')+i,100+i));
const after=()=>Array.from({length:61},(_,i)=>tick(ms('10:46:00')+i*30000,95+10*Math.sin(i/4)));
const cutoff=iso(ms('11:16:01'));
const rows=()=>[...opening(),lifecycle(ms('08:52:35')), ...after()];
function fixture(t, records=rows()) {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'cru21-capture-'));
 fs.mkdirSync(path.join(root,'live-events'));
 const file=path.join(root,'live-events','2026-10-15.ndjson');
 const bytes=Buffer.from(records.map(r=>JSON.stringify(r)).join('\n')+'\n');fs.writeFileSync(file,bytes);
 t.after(()=>{clearTxChartLedgerCache();fs.rmSync(root,{recursive:true,force:true});});
 const options={dataRoot:root,calendar,now:new Date(cutoff),cacheRoot:path.join(root,'cache')};
 return {root,file,bytes,options,chart:()=>loadTxDecisionChart(options)};
}

test('recorded Tick failure forms a conservative source-coordinate interval, not a guessed physical duration',()=>{
 const intervals=knownCaptureIntervals(rows(),{actualContract:'TXFJ6',cutoff});
 assert.equal(intervals.length,1);assert.equal(intervals[0].startSourceAt,iso(ms('08:46:19.443')));
 assert.equal(intervals[0].endSourceAt,iso(ms('10:46:00')));
 assert.equal(captureIntervalOverlaps(intervals,ms('08:45:00'),ms('09:00:00')),true);
 assert.equal(captureIntervalOverlaps(intervals,ms('10:50:00'),ms('10:55:00')),false);
});
test('known interrupted OR is restricted and cannot become the primary scenario node; prices stay unchanged',t=>{
 const f=fixture(t),chart=f.chart();
 assert.equal(chart.openingRange.high,108);assert.equal(chart.openingRange.low,100);
 assert.equal(chart.openingRange.status,'QUALITY_INSUFFICIENT');
 assert.equal(chart.openingRange.structureEligibility.state,'BLOCKED');
 assert.ok(chart.openingRange.qualityReasons.includes('KNOWN_CAPTURE_INTERRUPTION'));
 for(const key of ['openingRangeHigh','openingRangeLow','vwap','currentDayHigh','currentDayLow']){
  assert.equal(chart.levels[key].structureEligibility.state,'BLOCKED',key);
  assert.ok(chart.levels[key].qualityReasons.includes('KNOWN_CAPTURE_INTERRUPTION'),key);
 }
 assert.equal(chart.structureEligibility.state,'ELIGIBLE');
 const watch=buildDecisionLevelWatch({chart,snapshotTime:cutoff});
 assert.notEqual(watch.nextWatch?.family,'OPENING_RANGE');
 assert.notEqual(watch.scenarioWatch?.node?.family,'OPENING_RANGE');
 assert.equal(watch.executionAuthorized,false);assert.equal(watch.orderRoutesEnabled,false);
 assert.equal(hash(fs.readFileSync(f.file)),hash(f.bytes));
});
test('known pre-recovery bars remain restricted while independent complete post-recovery bars stay eligible',t=>{
 const chart=fixture(t).chart();
 assert.equal(chart.bars.find(b=>b.time===iso(ms('08:45:00'))).structureEligibility.state,'BLOCKED');
 assert.equal(chart.bars.find(b=>b.time===iso(ms('10:45:00'))).structureEligibility.state,'BLOCKED');
 assert.equal(chart.bars.find(b=>b.time===iso(ms('10:50:00'))).structureEligibility.state,'ELIGIBLE');
 assert.equal(chart.bars.find(b=>b.time===iso(ms('11:15:00'))).structureEligibility.state,'BLOCKED');
});
test('a sparse sample alone is not converted into an invented outage or zero-loss certificate',t=>{
 const chart=fixture(t,[...opening(),...after()]).chart();
 assert.equal(chart.openingRange.structureEligibility.state,'ELIGIBLE');
 assert.equal(chart.structureEligibility.audit.feedCompleteness,'UNKNOWN_NO_NATIVE_SEQUENCE');
});
test('BidAsk-only failure does not invent missing TX executed trades',()=>{
 const data=[...opening(),lifecycle(ms('08:52:35'),{topic:'QUO/v1/FOP/*/TFE/TXFJ6'}),...after()];
 assert.equal(knownCaptureIntervals(data,{actualContract:'TXFJ6',cutoff}).length,0);
});
test('another contract subscription failure cannot contaminate this contract',()=>{
 const data=[...opening(),lifecycle(ms('08:52:35'),{topic:'TIC/v1/FOP/*/TFE/MXFJ6'}),...after()];
 assert.equal(knownCaptureIntervals(data,{actualContract:'TXFJ6',cutoff}).length,0);
});
for(const kind of ['bridge_stopped','session_down'])test(`recorded ${kind} restricts a crossed window`,()=>{
 const data=[...opening(),lifecycle(ms('08:52:35'),{kind}),...after()];
 assert.equal(knownCaptureIntervals(data,{actualContract:'TXFJ6',cutoff}).length,1);
});
test('provider reconnect callbacks do not themselves certify restored trade delivery',()=>{
 const data=[...opening(),lifecycle(ms('08:50:00'),{code:12}),lifecycle(ms('08:51:00'),{code:13})];
 const gap=knownCaptureIntervals(data,{actualContract:'TXFJ6',cutoff})[0];
 assert.equal(gap.endSourceAt,null);assert.equal(captureIntervalOverlaps([gap],ms('08:45:00'),ms('09:00:00')),true);
});
test('future failure receipts cannot retroactively contaminate a cutoff before they are available',()=>{
 const data=[...opening(),lifecycle(ms('08:52:35'))];
 assert.equal(knownCaptureIntervals(data,{actualContract:'TXFJ6',cutoff:iso(ms('08:50:00'))}).length,0);
});
test('future or simulated ticks cannot close a known interruption',()=>{
 const future=tick(ms('11:17:00')),sim=tick(ms('10:50:00'));sim.payload.simtrade=true;
 const gap=knownCaptureIntervals([...opening(),lifecycle(ms('08:52:35')),sim,future],{actualContract:'TXFJ6',cutoff})[0];
 assert.equal(gap.endSourceAt,null);
});
test('default tick reader stays tick-only; the explicit evidence reader and cold cache retain failures',t=>{
 const f=fixture(t);const plain=readTxLiveEventLedger(f.file,{cacheRoot:f.options.cacheRoot});
 assert.equal(plain.length,70);assert.ok(plain.every(r=>r.kind==='futures_tick'));
 assert.equal(readTxLiveEventLedger(f.file,{cacheRoot:f.options.cacheRoot,includeCaptureEvidence:true}).length,71);
 clearTxChartLedgerCache();
 assert.equal(f.chart().openingRange.structureEligibility.state,'BLOCKED');
 const metadata=JSON.parse(fs.readFileSync(path.join(f.options.cacheRoot,fs.readdirSync(f.options.cacheRoot).find(n=>n.endsWith('.meta.json')))));
 assert.equal(metadata.schemaVersion,'dw2-tx-tick-cache-v3');
});
test('legacy tick-only v2 cache is rebuilt from untouched raw evidence instead of dropping interruptions',t=>{
 const f=fixture(t);f.chart();
 const names=fs.readdirSync(f.options.cacheRoot),metaPath=path.join(f.options.cacheRoot,names.find(n=>n.endsWith('.meta.json')));
 const recordPath=path.join(f.options.cacheRoot,names.find(n=>n.endsWith('.ndjson')));
 const records=fs.readFileSync(recordPath,'utf8').trim().split('\n').map(JSON.parse).filter(r=>r.kind==='futures_tick');
 const oldBytes=Buffer.from(records.map(r=>JSON.stringify(r)).join('\n')+'\n');
 const meta=JSON.parse(fs.readFileSync(metaPath));Object.assign(meta,{schemaVersion:'dw2-tx-tick-cache-v2',recordCount:records.length,cacheSize:oldBytes.length,cacheHash:hash(oldBytes)});
 fs.writeFileSync(recordPath,oldBytes);fs.writeFileSync(metaPath,JSON.stringify(meta));clearTxChartLedgerCache();
 assert.equal(f.chart().openingRange.structureEligibility.state,'BLOCKED');
 assert.equal(JSON.parse(fs.readFileSync(metaPath)).schemaVersion,'dw2-tx-tick-cache-v3');
 assert.equal(hash(fs.readFileSync(f.file)),hash(f.bytes));
});
test('incremental suffix and partial lines preserve an interruption before new quotes',t=>{
 const f=fixture(t,opening());readTxLiveEventLedger(f.file,{cacheRoot:f.options.cacheRoot});
 const text=JSON.stringify(lifecycle(ms('08:52:35'))),cut=Math.floor(text.length/2);
 fs.appendFileSync(f.file,text.slice(0,cut));
 assert.equal(readTxLiveEventLedger(f.file,{includeCaptureEvidence:true}).length,9);
 fs.appendFileSync(f.file,text.slice(cut)+'\n'+after().map(r=>JSON.stringify(r)).join('\n')+'\n');
 assert.equal(f.chart().openingRange.structureEligibility.state,'BLOCKED');
});

test('later reception failure does not contaminate an earlier independently completed opening window',t=>{
 const complete=[tick(ms('08:45:00'),100),tick(ms('08:50:00'),105),tick(ms('08:55:00'),99),tick(ms('09:00:00'),101),tick(ms('10:05:00'),98)];
 const chart=fixture(t,[...complete,lifecycle(ms('10:10:00')),...after()]).chart();
 assert.equal(chart.openingRange.structureEligibility.state,'ELIGIBLE');
 assert.ok(!chart.openingRange.qualityReasons?.includes('KNOWN_CAPTURE_INTERRUPTION'));
 assert.equal(chart.levels.vwap.structureEligibility.state,'BLOCKED');
});

test('owner-visible reason distinguishes a known capture interruption from clock disagreement',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 assert.match(source,/KNOWN_CAPTURE_INTERRUPTION:\s*'行情曾中斷/);
});
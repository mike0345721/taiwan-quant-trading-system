import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {knownCaptureIntervals,captureIntervalOverlaps} from '../src/chart-capture-coverage.mjs';
import {buildTxDecisionChart} from '../src/dashboard-tx-chart.mjs';
import {attachSourceTimeStructureEligibility} from '../src/source-time-structure.mjs';
import {buildDecisionLevelWatch} from '../src/decision-level-watch.mjs';
import {isStructureEligible} from '../src/structural-eligibility.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const ms=t=>Date.parse('2026-10-15T'+t+'+08:00'),iso=n=>new Date(n).toISOString();
function tick(at,price=100,receipt=at){return {kind:'futures_tick',product:'TXFJ6',receivedAt:iso(receipt),exchangeTimestamp:iso(at),eventId:'t-'+at+'-'+receipt,duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,payload:{code:'TXFJ6',datetime:iso(at),close:price,volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFJ6'}};}
function down(at){return {kind:'session_down',product:'bridge',receivedAt:iso(at),exchangeTimestamp:iso(at),eventId:'d-'+at,duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,payload:{code:'bridge',datetime:iso(at)}};}
function chartFor(rows,at){return attachSourceTimeStructureEligibility(buildTxDecisionChart(rows,{calendar,timeframe:'5m',mode:'LIVE',asOf:iso(at),tradeDate:'2026-10-15',session:'DAY'}),rows,{calendar,cutoff:iso(at)});}

test('late prior-session tick cannot close or invert a recorded day interruption',()=>{
 const rows=[tick(ms('11:00:00')),down(ms('11:01:00')),tick(ms('04:00:00'),99,ms('11:01:10')),tick(ms('11:02:00'))];
 const intervals=knownCaptureIntervals(rows,{actualContract:'TXFJ6',cutoff:iso(ms('11:03:00')),calendar});
 assert.equal(intervals.length,1);assert.equal(intervals[0].startSourceAt,iso(ms('11:00:00')));assert.equal(intervals[0].endSourceAt,iso(ms('11:02:00')));
 assert.equal(captureIntervalOverlaps(intervals,ms('11:00:00'),ms('11:05:00')),true);
});
test('a late tick without later recovery keeps the interval open',()=>{
 const intervals=knownCaptureIntervals([tick(ms('11:00:00')),down(ms('11:01:00')),tick(ms('04:00:00'),99,ms('11:01:10'))],{actualContract:'TXFJ6',cutoff:iso(ms('11:03:00')),calendar});
 assert.equal(intervals[0].endSourceAt,null);
});
test('equal source time after failure does not establish an advancing recovery witness',()=>{
 const intervals=knownCaptureIntervals([tick(ms('11:00:00')),down(ms('11:01:00')),tick(ms('11:00:00'),101,ms('11:01:10'))],{actualContract:'TXFJ6',cutoff:iso(ms('11:03:00')),calendar});
 assert.equal(intervals[0].endSourceAt,null);
});
test('without a preceding tick a prior-session delayed tick is not day restoration',()=>{
 const intervals=knownCaptureIntervals([down(ms('11:01:00')),tick(ms('04:00:00'),99,ms('11:01:10')),tick(ms('11:02:00'))],{actualContract:'TXFJ6',cutoff:iso(ms('11:03:00')),calendar});
 assert.equal(intervals[0].startSourceAt,null);assert.equal(intervals[0].endSourceAt,iso(ms('11:02:00')));
});
test('a late trade before the failure cannot regress the remembered source watermark',()=>{
 const intervals=knownCaptureIntervals([tick(ms('11:00:00')),tick(ms('04:00:00'),99,ms('11:00:10')),down(ms('11:01:00')),tick(ms('11:02:00'))],{actualContract:'TXFJ6',cutoff:iso(ms('11:03:00')),calendar});
 assert.equal(intervals[0].startSourceAt,iso(ms('11:00:00')));
});
test('malformed reversed interval cannot silently erase a known interruption',()=>{
 assert.equal(captureIntervalOverlaps([{startSourceAt:iso(ms('11:00:00')),endSourceAt:iso(ms('04:00:00'))}],ms('11:01:00'),ms('11:05:00')),true);
});
test('open outage after the latest tick restricts cumulative levels through current cutoff',()=>{
 const rows=[tick(ms('08:45:00'),100),tick(ms('08:50:00'),105),tick(ms('08:55:00'),99),tick(ms('09:00:00'),102),tick(ms('11:15:00'),101),down(ms('11:15:30'))];
 const chart=chartFor(rows,ms('11:16:00'));
 for(const key of ['vwap','currentDayHigh','currentDayLow']){assert.equal(chart.levels[key].structureEligibility.state,'BLOCKED',key);assert.ok(chart.levels[key].qualityReasons.includes('KNOWN_CAPTURE_INTERRUPTION'));}
 assert.equal(chart.structureEligibility.audit.feedCompleteness,'KNOWN_CAPTURE_INTERRUPTION');
 assert.equal(chart.openingRange.structureEligibility.state,'ELIGIBLE');
});
function interruptedRows(){return [tick(ms('08:46:00'),100),tick(ms('08:46:01'),108),down(ms('08:52:00')),...Array.from({length:61},(_,i)=>tick(ms('10:46:00')+i*30000,90+i))];}
test('blocked cumulative values remain inspectable but never become a fallback primary node',()=>{
 const cutoff=ms('11:16:01'),chart=chartFor(interruptedRows(),cutoff),watch=buildDecisionLevelWatch({chart,snapshotTime:iso(cutoff)});
 assert.equal(isStructureEligible(chart.levels.vwap),false);assert.ok(watch.levels.length>0);
 assert.equal(watch.nextWatch,null);assert.equal(watch.scenarioWatch,null);
});
test('a lawful remote context remains visible but cannot become an active fallback',()=>{
  const cutoff=ms('11:16:01'),chart=chartFor(interruptedRows(),cutoff);
  const prior={availability:'AVAILABLE',value:90,source:'PP1_GOVERNED_ACTUAL_CONTRACT_5M_REPLAY',actualContract:'TXFJ6',tradeDate:'2026-10-14',session:'DAY',availableAt:'2026-10-14T06:00:00Z',qualityStatus:'PASS'};
  const watch=buildDecisionLevelWatch({chart:{...chart,levels:{...chart.levels,previousClose:prior}},snapshotTime:iso(cutoff)});
  assert.equal(watch.state,'READY');
  assert.equal(watch.decisionFocus.state,'NO_ACTIVE_REFERENCE');
  assert.equal(watch.nextWatch,null);assert.equal(watch.scenarioWatch,null);
  assert.equal(watch.executionAuthorized,false);
});
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
function declaration(name){const start=app.indexOf('function '+name+'(');assert.ok(start>=0,'missing '+name);const next=app.indexOf('\nfunction ',start+1);return app.slice(start,next<0?app.length:next);}
function uiContext(){const writes={};const context={state:{txChartSeries:null,txChartLevelLines:[],levelWatch:null,decisionWorkspace:null},levelValue:v=>v?.availability==='AVAILABLE'?Number(v.value):null,fmt:v=>String(v),terminalWrite:(id,text,opts)=>{writes[id]={text,reason:opts?.reason};},dwText:()=>{},clearTxChartLevels:()=>{},levelWatchMatchesChart:()=>false,addTxChartLevel:()=>{},timeLabel:String,$:()=>({classList:{contains:()=>false}})};vm.createContext(context);vm.runInContext(declaration('captureCoverageWarning')+'\n'+declaration('renderTxChartLevels'),context);return {context,writes};}

test('numeric VWAP and session extremes show interruption warning beside preserved values',()=>{
 const {context,writes}=uiContext();const level=value=>({availability:'AVAILABLE',value,reason:'KNOWN_CAPTURE_INTERRUPTION',captureCoverage:{state:'KNOWN_INTERRUPTION'}});
 context.renderTxChartLevels({levels:{vwap:level(100),currentDayHigh:level(110),currentDayLow:level(90)},openingRange:{status:'QUALITY_INSUFFICIENT',reason:'KNOWN_CAPTURE_INTERRUPTION'}});
 assert.match(writes['dw-vwap-state'].text,/100.*行情缺口/);assert.match(writes['dw-session-levels'].text,/110.*90.*行情缺口/);
});
test('unaffected numeric fields do not acquire a capture-loss warning',()=>{
 const {context,writes}=uiContext();const level=value=>({availability:'AVAILABLE',value,qualityStatus:'PASS'});
 context.renderTxChartLevels({levels:{vwap:level(100),currentDayHigh:level(110),currentDayLow:level(90)}});
 assert.equal(writes['dw-vwap-state'].text,'100');assert.equal(writes['dw-session-levels'].text,'110 / 90');
});
test('crosshair uses source-bar coverage and does not call affected OHLC complete',()=>{
 const context={};vm.createContext(context);vm.runInContext(declaration('captureCoverageWarning')+'\n'+declaration('txBarObservationLabel'),context);
 const chart={bars:[{time:iso(ms('08:45:00')),captureCoverage:{state:'KNOWN_INTERRUPTION'}},{time:iso(ms('10:50:00')),qualityStatus:'PASS'}]};
 assert.match(context.txBarObservationLabel(chart,ms('08:45:00')),/行情缺口/);assert.doesNotMatch(context.txBarObservationLabel(chart,ms('08:45:00')),/^完整/);
 assert.equal(context.txBarObservationLabel(chart,ms('10:50:00')),'完整');
 assert.match(app,/txBarObservationLabel\(state\.txChartPayload, selectedTimeMs\)/);
});

test('same-session delayed advancing source tick cannot precede the interruption event boundary',()=>{
 const rows=[tick(ms('11:00:00')),down(ms('11:05:00')),tick(ms('11:02:00'),99,ms('11:06:00')),tick(ms('11:07:00'))];
 const intervals=knownCaptureIntervals(rows,{actualContract:'TXFJ6',cutoff:iso(ms('11:08:00')),calendar});
 assert.equal(intervals.length,1);assert.equal(intervals[0].endSourceAt,iso(ms('11:07:00')));
 assert.equal(captureIntervalOverlaps(intervals,ms('11:05:00'),ms('11:10:00')),true);
});
test('without a post-interruption source witness a delayed advancing trade leaves loss open',()=>{
 const intervals=knownCaptureIntervals([tick(ms('11:00:00')),down(ms('11:05:00')),tick(ms('11:02:00'),99,ms('11:06:00'))],{actualContract:'TXFJ6',cutoff:iso(ms('11:08:00')),calendar});
 assert.equal(intervals[0].endSourceAt,null);
});
test('additional failure evidence advances the pending restoration source boundary',()=>{
 const rows=[tick(ms('11:00:00')),down(ms('11:05:00')),down(ms('11:08:00')),tick(ms('11:07:00'),99,ms('11:09:00')),tick(ms('11:10:00'))];
 const intervals=knownCaptureIntervals(rows,{actualContract:'TXFJ6',cutoff:iso(ms('11:11:00')),calendar});
 assert.equal(intervals[0].endSourceAt,iso(ms('11:10:00')));
});

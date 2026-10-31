import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { clearTxChartLedgerCache, loadTxDecisionChart } from '../src/dashboard-tx-chart-source.mjs';
import { attachTimestampDependencyQuality } from '../src/chart-timestamp-dependency-quality.mjs';
import { buildDecisionLevelWatch } from '../src/decision-level-watch.mjs';
const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const iso = ms => new Date(ms).toISOString();
const FIVE = 300000;
const base = Date.parse('2026-10-12T19:00:00+08:00');
function tick(time, price = 100, lag = 20, id = String(time)) {
  return { kind: 'futures_tick', product: 'TXFJ6', receivedAt: iso(time + lag),
    exchangeTimestamp: iso(time), eventId: id, duplicate: false, sequenceGap: 0,
    executionAuthorized: false, orderRoutesEnabled: false,
    payload: { code: 'TXFJ6', datetime: iso(time), close: price, volume: 1,
      simtrade: false, _product_family: 'TX', _target_code: 'TXFJ6' } };
}
const prices = [100,112,98,116,99,110,100,113,101,115,104,111,107];
function cleanTicks() {
  return prices.flatMap((p,i) => [tick(base+i*FIVE,p,20,'o'+i),
    tick(base+i*FIVE+20000,p+5,20,'h'+i), tick(base+i*FIVE+40000,p-5,20,'l'+i)]);
}
function fixture(t, records) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-dependency-quality-'));
  fs.mkdirSync(path.join(root, 'live-events'));
  const groups = new Map();
  for (const record of records) {
    const date = iso(Date.parse(record.receivedAt)+8*3600000).slice(0,10);
    const rows = groups.get(date) || []; rows.push(record); groups.set(date,rows);
  }
  const before = new Map();
  for (const [date,rows] of groups) {
    const file = path.join(root, 'live-events', date+'.ndjson');
    const bytes = Buffer.from(rows.map(x=>JSON.stringify(x)).join('\n')+'\n');
    fs.writeFileSync(file,bytes); before.set(file,bytes);
  }
  t.after(()=>{ for(const [f,b] of before)assert.deepEqual(fs.readFileSync(f),b);
    fs.rmSync(root,{recursive:true,force:true});clearTxChartLedgerCache(); });
  const load = (overrides={}) => loadTxDecisionChart({ dataRoot:root,calendar,
    timeframe:'5m',mode:'REPLAY',tradeDate:'2026-10-13',session:'NIGHT',
    asOf:iso(base+12*FIVE+40021),now:new Date(base+12*FIVE+40021),...overrides });
  return { root, load };
}
const oldBad = () => tick(base-FIVE,100,-100,'old-skew');

test('bad event marks its actual bar and dependent cumulative values, not later independent clean bars', t=>{
  const chart=fixture(t,[oldBad(),...cleanTicks()]).load();
  assert.equal(chart.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.timeLineageViolationCount,1);
  assert.equal(chart.bars[0].qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.bars[0].timeLineageViolationCount,1);
  assert.equal(chart.bars[1].qualityStatus,'PASS');
  assert.equal(chart.levels.vwap.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.levels.nightHigh.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.levels.nightLow.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.ok(chart.vwap.every(p=>p.qualityStatus==='QUALITY_INSUFFICIENT'));
  assert.equal(chart.sourceEventCount,40);
  assert.equal(chart.bars[0].open,100);assert.equal(chart.bars[0].volume,1);
});
test('a clean local suffix does not clear quality debt or manufacture a current scenario',t=>{
  const chart=fixture(t,[oldBad(),...cleanTicks()]).load();
  const q=chart.timestampDependencyQuality;
  assert.equal(q.recentWindow.state,'CLEAN_LOCAL_BARS_OBSERVED');
  assert.equal(q.recentWindow.consecutiveCleanCompletedBars,12);
  assert.equal(q.recentWindow.start,iso(base));
  assert.equal(q.recentWindow.end,iso(base+12*FIVE));
  assert.equal(q.recentWindow.restoresTargets,false);
  assert.equal(q.sessionRestrictionCleared,false);
  const w=buildDecisionLevelWatch({chart,snapshotTime:chart.asOf});
  assert.equal(w.nextWatch,null);assert.equal(w.scenarioWatch,null);
  assert.equal(w.executionAuthorized,false);assert.equal(w.orderRoutesEnabled,false);
});

test('forming bars do not complete the clean window', t=>{
  const chart=fixture(t,[oldBad(),...cleanTicks()]).load({asOf:iso(base+11*FIVE+40021)});
  assert.equal(chart.timestampDependencyQuality.recentWindow.consecutiveCleanCompletedBars,11);
  assert.equal(chart.timestampDependencyQuality.recentWindow.state,'WAIT_CLEAN_COMPLETED_BARS');
});
test('a missing five-minute bar interrupts evidence rather than filling a gap', t=>{
  const rows=cleanTicks().filter(x=>!['o6','h6','l6'].includes(x.eventId));
  const chart=fixture(t,[oldBad(),...rows]).load();
  assert.equal(chart.timestampDependencyQuality.recentWindow.consecutiveCleanCompletedBars,5);
  assert.equal(chart.timestampDependencyQuality.recentWindow.state,'WAIT_CLEAN_COMPLETED_BARS');
});
test('a new adverse timestamp in the forming bar immediately blocks recovered local evidence', t=>{
  const time=base+12*FIVE+30000;
  const chart=fixture(t,[oldBad(),...cleanTicks(),tick(time,105,-50,'new-skew')]).load();
  assert.equal(chart.timestampDependencyQuality.recentWindow.state,'WAIT_CLEAN_COMPLETED_BARS');
  assert.equal(chart.timestampDependencyQuality.recentWindow.consecutiveCleanCompletedBars,0);
  assert.equal(chart.timestampDependencyQuality.recentWindow.lastViolationAt,iso(time));
});
test('stale chart input never becomes a currently clean window', t=>{
  const chart=fixture(t,[oldBad(),...cleanTicks()]).load({asOf:iso(base+13*FIVE+40021)});
  assert.equal(chart.timestampDependencyQuality.recentWindow.state,'WAIT_FRESH_SOURCE');
});
test('late session skew does not retroactively contaminate frozen opening-range inputs', t=>{
  const day=Date.parse('2026-10-13T08:50:00+08:00');
  const late=Date.parse('2026-10-13T09:20:00+08:00');
  const chart=fixture(t,[tick(day,100),tick(day+20000,110),tick(late,120,-100),tick(late+FIVE,125)])
    .load({session:'DAY',asOf:iso(late+FIVE+21)});
  assert.equal(chart.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.openingRange.status,'READY');
  assert.equal(chart.levels.openingRangeHigh.qualityStatus,'PASS');
  assert.equal(chart.levels.currentDayHigh.qualityStatus,'QUALITY_INSUFFICIENT');
});
test('skew inside the frozen range restricts OR status and both numeric references', t=>{
  const day=Date.parse('2026-10-13T08:50:00+08:00');
  const chart=fixture(t,[tick(day,100,-100),tick(day+20000,110),tick(day+20*60000,120)])
    .load({session:'DAY',asOf:iso(day+20*60000+21)});
  assert.equal(chart.openingRange.status,'QUALITY_INSUFFICIENT');
  assert.equal(chart.levels.openingRangeHigh.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.levels.openingRangeLow.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.openingRange.high,110);assert.equal(chart.openingRange.low,100);
});
test('future skew is not visible before effective availability', t=>{
  const future=base+13*FIVE;
  const chart=fixture(t,[...cleanTicks(),tick(future,130,-100)]).load();
  assert.equal(chart.timeLineageViolationCount,0);
  assert.equal(chart.qualityStatus,'PASS');
  assert.equal(chart.timestampDependencyQuality,undefined);
});
test('exact session-close event annotates the prior bucket instead of creating a new bar', t=>{
  const close=Date.parse('2026-10-13T05:00:00+08:00');
  const chart=fixture(t,[tick(close-60000,100),tick(close,101,-50)]).load({asOf:iso(close+1)});
  assert.equal(chart.bars.length,1);
  assert.equal(chart.bars[0].qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.bars[0].timeLineageViolationCount,1);
  assert.equal(chart.bars[0].time,'2026-10-12T20:55:00.000Z');
});
test('night violation keeps daily quality restricted but does not contaminate clean day VWAP', t=>{
  const day=Date.parse('2026-10-13T09:15:00+08:00');
  const chart=fixture(t,[oldBad(),tick(day,110)]).load({timeframe:'1D',session:null,asOf:iso(day+21)});
  assert.equal(chart.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.bars[0].qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.vwapSession,'DAY');
  assert.equal(chart.levels.vwap.qualityStatus,'PASS');
  assert.equal(chart.levels.nightHigh.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(chart.timestampDependencyQuality.recentWindow.state,'NOT_ASSESSED_TIMEFRAME');
});
test('prior-day references, other contracts, and input objects remain unchanged', ()=>{
  const prior=Object.freeze({availability:'AVAILABLE',value:95,qualityStatus:'PASS'});
  const chart=Object.freeze({timeframe:'5m',actualContract:'TXFJ6',tradeDate:'2026-10-13',session:'NIGHT',
    qualityStatus:'QUALITY_INSUFFICIENT',bars:Object.freeze([]),vwap:Object.freeze([]),
    levels:Object.freeze({previousDayHigh:prior}),availableAt:iso(base)});
  const violation=Object.freeze({actualContract:'TXFJ6',sessionTradeDate:'2026-10-13',session:'NIGHT',
    exchangeTimestamp:iso(base-100),effectiveAvailableAt:iso(base-100)});
  const before=JSON.stringify(chart);
  const annotated=attachTimestampDependencyQuality(chart,[violation],{cutoff:iso(base)});
  assert.equal(annotated.levels.previousDayHigh,prior);assert.equal(JSON.stringify(chart),before);
  assert.equal(attachTimestampDependencyQuality(chart,[{...violation,actualContract:'TXFK6'}],{cutoff:iso(base)}),chart);
  assert.equal(annotated.qualityStatus,chart.qualityStatus);
  assert.ok(Object.isFrozen(annotated.timestampDependencyQuality.recentWindow));
});

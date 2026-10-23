import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {auditCostedTxReplay,selectTrainingPlateau,auditPurgedWalkForward}
  from '../src/research-strategy-validation-v1.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const calendar=loadGovernedTradingCalendar(path.join(root,'config/taifex-official-calendar-2026.json'));
const sha=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const costTerms={feePointsPerSide:1,slippagePointsPerSide:2,taxPointsPerRoundTrip:0.5};
const costHash=sha(costTerms);
const costs={...costTerms,conventionSha256:costHash};
const sourceHash='a'.repeat(64),ruleHash='b'.repeat(64);
const manifest={
  schemaVersion:'tx-frozen-executable-outcome-corpus-v1',researchOnly:true,
  executionAuthorized:false,orderRoutesEnabled:false,origin:'GOVERNED_REAL_TX_REPLAY',
  completeSessionCoverage:true,asOfJoinVerified:true,continuityVerified:true,
  sourceSha256:sourceHash,frozenRulesSha256:ruleHash,
  costConventionSha256:costHash,governedCalendarHash:calendar.fileHash,
};
const samples=[...calendar.tradingDates].sort().filter(d=>d>='2026-02-02'&&d<='2026-05-29').slice(0,24);
assert.equal(samples.length,24,'fixture needs 24 official trading dates');
function event(date,i){
  const entry=46000+i*3;
  return {
    schemaVersion:'tx-executable-outcome-v1',researchOnly:true,executionAuthorized:false,
    orderRoutesEnabled:false,sourceMode:'GOVERNED_REAL_TX_REPLAY',
    quality:'PASS',pathCoverage:'COMPLETE_VERIFIED',simtrade:false,duplicate:false,sequenceGap:0,
    eventId:'sample-event-'+String(i).padStart(3,'0'),tradeDate:date,
    actualContract:'TXFK6',session:'DAY',side:'LONG',
    frozenRulesSha256:ruleHash,sourceSha256:sourceHash,governedCalendarHash:calendar.fileHash,
    featureAvailableAt:date+'T08:53:00+08:00',
    signalAvailableAt:date+'T08:59:00+08:00',
    entryAt:date+'T09:00:00+08:00',
    exitAt:date+'T13:00:00+08:00',
    outcomeAvailableAt:date+'T13:45:00+08:00',
    entryPrice:entry,exitPrice:entry+(i%5===0?-12:20),
  };
}
const trades=samples.map(event);
const run=arg=>auditCostedTxReplay({manifest,costs,trades,calendar,...arg});
test('frozen historical replay net-points requires explicit per-side costs and returns research-only receipt',()=>{
  const result=run();
  assert.equal(result.state,'HISTORICAL_DESCRIPTIVE_ONLY');
  const gross=trades.reduce((acc,t)=>acc+t.exitPrice-t.entryPrice,0);
  const expense=(2*(costs.feePointsPerSide+costs.slippagePointsPerSide)+costs.taxPointsPerRoundTrip)*trades.length;
  assert.equal(result.grossPoints,gross);assert.equal(result.costPoints,expense);
  assert.equal(result.netPoints,gross-expense);
  assert.equal(result.tradeCount,24);
  assert.match(result.receiptSha256,/^[a-f0-9]{64}$/);
  assert.equal(result.positiveEvProven,false);assert.equal(result.readyForTrading,false);
  assert.equal(result.formalWeight,0);assert.equal(result.executionAuthorized,false);
  assert.deepEqual(run(),result);
});
test('partial sampled PR90 lower-bound outcomes never count as costed trade PnL',()=>{
  const x=run({trades:trades.map((t,i)=>i===0?{...t,pathCoverage:'UNVERIFIED'}:t)});
  assert.equal(x.state,'BLOCKED');assert.equal(x.netPoints,null);
  assert.equal(run({manifest:{...manifest,completeSessionCoverage:false}}).state,'BLOCKED');
  assert.equal(run({manifest:{...manifest,origin:'SIMULATED'}}).state,'BLOCKED');
});
test('no free-fee, missing cost schedule, or fee drift can slip into the receipt',()=>{
  assert.equal(run({costs:{...costs,slippagePointsPerSide:0}}).netPoints,null);
  assert.equal(run({costs:{...costs,feePointsPerSide:2}}).state,'BLOCKED');
  assert.equal(run({manifest:{...manifest,costConventionSha256:'e'.repeat(64)}}).state,'BLOCKED');
});
test('future features, post-entry signals, source timestamp and session crossing are blocked',()=>{
  const altered=[
    {featureAvailableAt:trades[0].exitAt},
    {signalAvailableAt:trades[0].outcomeAvailableAt},
    {exitAt:samples[0]+'T15:30:00+08:00'},
    {entryAt:'2026-02-30T09:00:00+08:00'},
    {tradeDate:'2026-02-30'},
  ];
  for(const edit of altered){
    const x=run({trades:[{...trades[0],...edit},...trades.slice(1)]});
    assert.equal(x.state,'BLOCKED',JSON.stringify(edit));assert.equal(x.netPoints,null);
  }
});
test('duplicates, synthetic entries, wrong contract, missing session and insufficient dates are blocked',()=>{
  const edits=[{eventId:trades[1].eventId},{simtrade:true},{actualContract:'MXFK6'},{sequenceGap:1},{session:'NIGHT'},{quality:'PARTIAL'}];
  for(const edit of edits)assert.equal(run({trades:[{...trades[0],...edit},...trades.slice(1)]}).state,'BLOCKED',JSON.stringify(edit));
  assert.equal(run({trades:trades.slice(0,23)}).state,'BLOCKED');
  assert.equal(run({trades:[...trades.slice(0,23),{...trades[23],tradeDate:trades[22].tradeDate}]}).state,'BLOCKED');
});
const provenance={sourceSha256:sourceHash,costConventionSha256:costHash,frozenRulesSha256:ruleHash,
  scoreBasis:'NET_OF_FROZEN_COSTS',trainEndAt:'2026-04-01T13:30:00+08:00',
  testStartAt:'2026-04-03T09:00:00+08:00'};
const cells=Array.from({length:16},(_,i)=>({
  x:Math.floor(i/4),y:i%4,
  trainNetPointsPerTrade:10-2*Math.abs(Math.floor(i/4)-2)-2*Math.abs(i%4-2),
  testNetPointsPerTrade:i%3-1,trainTrades:60,testTrades:24,
  sourceSha256:sourceHash,costConventionSha256:costHash,frozenRulesSha256:ruleHash,
}));
test('parameter plateau selects on training-neighbourhood, not on future test score',()=>{
 const first=selectTrainingPlateau({cells,provenance});
 assert.equal(first.state,'TRAIN_SELECTED_OOS_DESCRIPTIVE_ONLY');
 assert.deepEqual([first.selection.x,first.selection.y],[2,2]);
 assert.equal(first.readyForTrading,false);
 const changed=cells.map(c=>({...c,testNetPointsPerTrade:c.x===1&&c.y===1?100000:-999}));
 const second=selectTrainingPlateau({cells:changed,provenance});
 assert.deepEqual([first.selection.x,first.selection.y],[second.selection.x,second.selection.y]);
 assert.equal(second.freshForwardHoldoutVerified,false);
});
test('missing grid cells, wrong hashes and reversed train/test chronology fail closed',()=>{
 assert.equal(selectTrainingPlateau({cells:cells.slice(1),provenance}).state,'BLOCKED');
 assert.equal(selectTrainingPlateau({cells,provenance:{...provenance,testStartAt:'2026-03-01T09:00:00+08:00'}}).state,'BLOCKED');
 assert.equal(selectTrainingPlateau({cells:cells.map((c,i)=>i?c:{...c,sourceSha256:'e'.repeat(64)}),provenance}).state,'BLOCKED');
});
test('existing purged walk-forward only qualifies chronological OOS structure, never a live strategy',()=>{
 const folds=[
  ['2026-01-09','2026-01-12','2026-01-13','2026-01-23'],
  ['2026-01-23','2026-01-26','2026-01-27','2026-02-06'],
  ['2026-02-06','2026-02-09','2026-02-10','2026-02-20']
 ].map(([trainLastDate,purgedDate,testFirstDate,testLastDate])=>({
  trainLastDate,purgedDate,testFirstDate,testLastDate,testDays:8
 }));
 const result={folds,predictions:Array.from({length:24},(_,i)=>({i}))};
 const good=auditPurgedWalkForward(result);
 assert.equal(good.forwardGatePassed,true);assert.equal(good.readyForTrading,false);
 assert.equal(auditPurgedWalkForward({...result,folds:[...folds.slice(0,2),{...folds[2],purgedDate:'2026-02-11'}]}).state,'BLOCKED');
 assert.equal(auditPurgedWalkForward({...result,predictions:result.predictions.slice(1)}).state,'BLOCKED');
});

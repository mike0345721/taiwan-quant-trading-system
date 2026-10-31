import test from 'node:test';
import assert from 'node:assert/strict';
import {buildDecisionLevelWatch} from '../src/decision-level-watch.mjs';

const at='2026-10-13T14:30:01.000Z';
const proof=(availableAt=at)=>({schemaVersion:'source-time-structure-v1',state:'ELIGIBLE',
  basis:'REPORTED_SOURCE_TIME_GEOMETRY',scope:'LIVE_DESCRIPTIVE_ONLY',availableAt,executionAuthorized:false});
const restricted=()=>({qualityStatus:'QUALITY_INSUFFICIENT',qualityReasons:['TIMESTAMP_LINEAGE_INSUFFICIENT']});
function fixture(){
  const identity={actualContract:'TXFJ6',tradeDate:'2026-10-14',session:'NIGHT'};
  const level=value=>({...identity,...restricted(),value,availability:'AVAILABLE',source:'ACTUAL_TX_TICK_STREAM',
    availableAt:at,structureEligibility:proof(),timeLineageViolationCount:20});
  return {...identity,...restricted(),timeframe:'5m',mode:'LIVE',availableAt:at,lastPrice:140,
    timeLineageViolationCount:20,structureEligibility:proof(),
    bars:Array.from({length:6},(_,i)=>{const start=Date.parse('2026-10-13T14:00:00Z')+i*300000;
      const completion=new Date(start+300001).toISOString();
      return {...identity,...restricted(),time:new Date(start).toISOString(),availableAt:new Date(start+299999).toISOString(),
        open:100,close:100,high:110,low:90,volume:10,
        structureEligibility:{...proof(completion),completionAvailableAt:completion}};
    }),
    levels:{vwap:level(100),nightHigh:level(130),nightLow:level(70)},openingRange:{status:'NOT_APPLICABLE'}};
}
test('LIVE source-time geometry yields real formula without promoting clock quality or price/Flow confirmation',()=>{
  const chart=fixture(); chart.lastPrice=100; const before=structuredClone(chart);
  const observedFlow={identity:{actualContract:'TXFJ6',tradeDate:'2026-10-14',session:'NIGHT'},sourceState:'LIVE',
    source:{availableAt:at},researchQuality:{status:'QUALITY_INSUFFICIENT'},
    windows:{primary60s:{pressure:{pressureRatio:.6},response:{displacementPoints:10}}}};
  const result=buildDecisionLevelWatch({chart,observedFlow,snapshotTime:at});
  assert.equal(result.state,'READY'); assert.equal(result.zonePoints,7);
  assert.equal(result.scenarioWatch.long.target.price,130);
  assert.equal(result.scenarioWatch.short.target.price,70);
  for(const side of [result.scenarioWatch.long,result.scenarioWatch.short]){
    assert.equal(side.rr.state,'AVAILABLE');assert.equal(side.rr.ratio,23/14);
    assert.equal(side.target.qualityStatus,'QUALITY_INSUFFICIENT');
    assert.equal(side.priceGateState,'UNAVAILABLE');
    assert.equal(side.priceGateReason,'CROSS_CLOCK_QUALITY_NOT_VERIFIED');
    assert.equal(side.flowConfirmationState,'QUALITY_INSUFFICIENT');
  }
  assert.equal(result.currentPriceQualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(result.executionAuthorized,false);assert.equal(result.orderRoutesEnabled,false);
  assert.deepEqual(chart,before);
});
test('live focus near an upper reference does not fabricate a still-ahead long target',()=>{
  const chart=fixture();
  const watch=buildDecisionLevelWatch({chart,snapshotTime:at});
  assert.equal(watch.decisionFocus.state,'ACTIVE_REFERENCE');
  assert.equal(watch.decisionFocus.activeNodeId,'SESSION_HIGH');
  assert.equal(watch.nextWatch.id,'SESSION_HIGH');
  assert.equal(watch.scenarioWatch.node.id,'SESSION_HIGH');
  assert.equal(watch.scenarioWatch.long.target,null);
  assert.equal(watch.scenarioWatch.long.rr.ratio,null);
  assert.equal(watch.evidenceGate.directionConfirmed,false);
  assert.equal(watch.executionAuthorized,false);
});

test('no near qualified direction level retains a null current scenario with observable context',()=>{
  const chart=fixture(); delete chart.levels.nightHigh; delete chart.levels.nightLow;
  const result=buildDecisionLevelWatch({chart,snapshotTime:at});
  assert.equal(result.decisionFocus.state,'NO_ACTIVE_REFERENCE');
  assert.equal(result.nextWatch,null);assert.equal(result.scenarioWatch,null);
  assert.equal(result.evidenceGate.directionConfirmed,false);
  assert.equal(result.executionAuthorized,false);
});
test('unknown restrictions, missing proof, replay and future proof cannot borrow descriptive eligibility',()=>{
  for(const mutate of [
    c=>{c.qualityReasons.push('UNKNOWN_REASON');},
    c=>{delete c.structureEligibility;},
    c=>{c.mode='REPLAY';},
    c=>{c.structureEligibility.availableAt='2026-10-13T14:35:00Z';},
  ]){
    const c=fixture();mutate(c);const r=buildDecisionLevelWatch({chart:c,snapshotTime:at});
    assert.equal(r.scenarioWatch?.long?.target??null,null);assert.equal(r.scenarioWatch?.long?.rr?.ratio??null,null);
  }
});
test('no completed eligible range retains null scenarios and enumerates unavailable dependencies',()=>{
  const chart=fixture();for(const bar of chart.bars)bar.structureEligibility={...bar.structureEligibility,state:'BLOCKED'};
  const r=buildDecisionLevelWatch({chart,snapshotTime:at});
  assert.equal(r.reason,'OBSERVATION_ZONE_UNAVAILABLE');assert.equal(r.scenarioWatch,null);
  assert.equal(r.unavailabilityDiagnostics.dependencies.eligibleRangeBarCount,0);
  assert.equal(r.unavailabilityDiagnostics.dependencies.restrictedRangeBarCount,6);
  assert.ok(r.unavailabilityDiagnostics.reasonCodes.includes('TIMESTAMP_LINEAGE_INSUFFICIENT'));
});
test('watermark receipt time bounds pivot completion and prevents future confirming bars',()=>{
  const chart=fixture(); chart.bars[3].high=160;
  chart.bars[4].structureEligibility.completionAvailableAt='2026-10-13T14:40:00Z';
  const r=buildDecisionLevelWatch({chart,snapshotTime:at});
  assert.equal(r.levels.some(x=>x.id==='SWING_HIGH'),false);
});

test('a clean pivot center retains restrictions from both neighboring dependency bars',()=>{
  const chart=fixture();chart.levels={};chart.bars[3].high=160;
  chart.bars[3].qualityStatus='PASS';chart.bars[3].qualityReasons=[];
  chart.bars[2].timeLineageViolationCount=2;chart.bars[4].timeLineageViolationCount=3;
  const r=buildDecisionLevelWatch({chart,snapshotTime:at});
  const pivot=r.levels.find(row=>row.id==='SWING_HIGH');
  assert.ok(pivot,'historical swing remains traceable when it is not near current price');
  assert.equal(r.decisionFocus.state,'NO_ACTIVE_REFERENCE');
  assert.equal(r.nextWatch,null);assert.equal(r.scenarioWatch,null);
  assert.equal(pivot.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.deepEqual(pivot.qualityReasons,['TIMESTAMP_LINEAGE_INSUFFICIENT']);
  assert.equal(pivot.timeLineageViolationCount,5);
  assert.equal(pivot.structureEligibility.inputBarTimes.length,3);
});

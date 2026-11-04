import test from 'node:test';
import assert from 'node:assert/strict';
import { assessCandidateMarketInputs } from '../src/candidate-market-inputs.mjs';
import { buildTxDecisionChart } from '../src/dashboard-tx-chart.mjs';
import { buildDashboardObservedFlow } from '../src/dashboard-observed-flow.mjs';
import { buildDataHealthContract } from '../src/dashboard-data-health.mjs';
import { buildDecisionWorkspace } from '../src/dashboard-decision-workspace.mjs';
import { calendar } from './research-replay-fixtures.mjs';

// Offline engineering inputs only. Never market/runtime qualification.
const now = new Date('2026-10-22T02:00:01Z'), at='2026-10-22T02:00:00.000Z';
function chart() {
  const records = [10000,10002].map((price,i)=>({kind:'futures_tick',code:'TXFK6',product:'TXFK6',
    receivedAt:`2026-10-22T02:00:00.${i}00Z`,exchangeTimestamp:`2026-10-22T02:00:00.${i}00Z`,
    eventId:'SYNTHETIC_MARKET_INPUT_'+i,duplicate:false,sequenceGap:0,executionAuthorized:false,orderRoutesEnabled:false,
    payload:{code:'TXFK6',close:String(price),volume:1,simtrade:false,_product_family:'TX',_target_code:'TXFK6'}}));
  return buildTxDecisionChart(records,{calendar,timeframe:'5m',asOf:now.toISOString(),tradeDate:'2026-10-22',session:'DAY'});
}
function flow() {
  const window={status:'QUALITY_INSUFFICIENT',windowMs:60000,pressure:{status:'QUALITY_INSUFFICIENT',
    totalExecutedVolume:10,classifiedCoverage:0.8,pressureRatio:0.25,buyProxyVolume:5,sellProxyVolume:3,
    unknownVolume:2,classifiedVolume:8,netAggressiveFlowProxy:2},response:{status:'READY',startPrice:10000,
    endPrice:10002,displacementPoints:2,displacementTicks:2},pathEfficiency:{status:'READY',value:0.5}};
  return buildDashboardObservedFlow({truthState:'LIVE',snapshot:{sourceMode:'LIVE',instrument:'TX',
    actualContract:'TXFK6',tradeDate:'2026-10-22',session:'DAY',continuityEpoch:'SYNTHETIC',tickSize:1,
    availableAt:at,primary60s:window,context300s:{...window,windowMs:300000},quality:{status:'QUALITY_INSUFFICIENT'}},
    operational:{checkpointIdentity:'a'.repeat(64),validUntil:'2026-10-22T02:00:30.000Z',observedAt:at}});
}
const copy=x=>JSON.parse(JSON.stringify(x));

test('actual chart and observed-Flow builders provide observations without an EOD snapshot',()=>{
  const c=chart(),f=flow(),result=assessCandidateMarketInputs({chart:c,flow:f,now});
  assert.equal(c.schemaVersion,'governed-tx-decision-chart-v2');assert.ok(c.bars.length);
  assert.equal(result.status,'PARTIAL');assert.equal(result.eodSnapshot,'UNAVAILABLE');
  assert.equal(result.marketInputs.chart.observationAvailable,true);assert.equal(result.marketInputs.flow.observationAvailable,true);
  assert.equal(result.marketInputs.flow.sourceState,'LIVE');assert.equal(f.windows.primary60s.pressure.classifiedCoverage,0.8);
  assert.equal(result.deliveryAccepted,false);assert.equal(result.dataQualificationDeclared,false);
});
test('no input and READY-only declarations cannot convert absent source into success',()=>{
  for(const args of [{},{chart:{ready:true,status:'READY'}},{flow:{ready:true,sourceState:'LIVE'}}])
    assert.equal(assessCandidateMarketInputs({...args,now}).status,'UNAVAILABLE');
});
test('one valid input is enough to expose its panel without qualifying a missing sibling',()=>{
  const a=assessCandidateMarketInputs({chart:chart(),now}),b=assessCandidateMarketInputs({flow:flow(),now});
  assert.equal(a.status,'PARTIAL');assert.equal(a.marketInputs.flow.observationAvailable,false);
  assert.equal(b.status,'PARTIAL');assert.equal(b.marketInputs.chart.observationAvailable,false);
});
test('stale/partial observations are retained without changing source status or coverage',()=>{
  const c=copy(chart()),f=copy(flow());c.status=c.qualityStatus='QUALITY_INSUFFICIENT';f.sourceState='STALE';
  const before=JSON.stringify({c,f}),result=assessCandidateMarketInputs({chart:c,flow:f,now:new Date('2026-10-22T02:02:00Z')});
  assert.equal(result.status,'PARTIAL');assert.equal(result.marketInputs.chart.qualityStatus,'QUALITY_INSUFFICIENT');
  assert.equal(result.marketInputs.flow.sourceState,'STALE');assert.equal(JSON.stringify({c,f}),before);
});
test('malformed, foreign-contract and future chart bars cannot masquerade as observations',()=>{
  for(const mutate of [c=>c.schemaVersion='OTHER',c=>c.mode='MOCK',c=>c.actualContract='OTHER',
    c=>c.availableAt='2026-10-22T02:00:20Z',c=>c.tradeDate='2026-02-31',c=>c.bars[0].close=null,
    c=>c.bars[0].volume=-1,c=>c.bars[0].actualContract='TXFM6',c=>c.bars=[]]){
    const c=copy(chart());mutate(c);assert.equal(assessCandidateMarketInputs({chart:c,now}).status,'UNAVAILABLE');
  }
});
test('Flow requires governed identity, source timing and actual window measurements',()=>{
  for(const mutate of [f=>f.schemaVersion='OTHER',f=>f.identity.actualContract='OTHER',f=>f.source.sourceMode='HISTORICAL',
    f=>f.source.availableAt='2026-10-22T02:00:20Z',f=>f.source.validUntil='invalid',
    f=>f.source.validUntil='2026-10-22T01:59:59Z',f=>f.windows={primary60s:{status:'READY',ready:true}}]){
    const f=copy(flow());mutate(f);assert.equal(assessCandidateMarketInputs({flow:f,now}).status,'UNAVAILABLE');
  }
});
test('actual data-health/workspace builders support absent EOD with real-shaped observations',()=>{
  const c=chart(),f=flow(),runtimeTruth={governed:false,reason:'MARKET_CANDIDATE_NO_SCHEDULER_QUERY',executionAuthorized:false};
  const service={brokerMarketData:{connected:false,state:'UNAVAILABLE'},indexLeadership:{state:'UNAVAILABLE'}};
  const health=buildDataHealthContract({service,runtimeTruth,chart:c,now});
  const workspace=buildDecisionWorkspace({dataHealth:health,runtimeTruth,chart:c,observedFlow:f,now});
  assert.equal(workspace.schemaVersion,'dashboard-decision-workspace-v1');
  assert.equal(workspace.globalStatus.actualContract,'TXFK6');assert.notEqual(workspace.globalStatus.decisionReadiness,'READY');
  assert.ok(health.items.some(item=>item.sourceAvailability==='SOURCE_MISSING'));
  assert.equal(workspace.snapshot.executionAuthorized,false);assert.equal(workspace.snapshot.orderRoutesEnabled,false);
  assert.equal(workspace.observedFlow.windows.primary60s.pressure.classifiedCoverage,0.8);
});

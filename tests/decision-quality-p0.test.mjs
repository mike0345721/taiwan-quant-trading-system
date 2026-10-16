import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { evaluateLiveFocus, evaluateConditionalRrApplicability, evaluateDecisionEvidenceGate } from '../src/decision-quality-p0.mjs';
import { buildDecisionLevelWatch } from '../src/decision-level-watch.mjs';

const qualified=(id,price,more={})=>({
 id,label:id,price,qualityStatus:'PASS',importanceBand:'SECONDARY',
 structureEligibility:{schemaVersion:'source-time-structure-v1',state:'ELIGIBLE',
   basis:'REPORTED_SOURCE_TIME_GEOMETRY',scope:'LIVE_DESCRIPTIVE_ONLY',
   availableAt:'2026-10-16T01:25:00.000Z',executionAuthorized:false},
 state:'MONITORING',...more,
});
const blocked=(id,price)=>({...qualified(id,price),qualityStatus:'QUALITY_INSUFFICIENT',
 qualityReasons:['KNOWN_CAPTURE_INTERRUPTION'],
 structureEligibility:{schemaVersion:'source-time-structure-v1',state:'BLOCKED',
   reasonCodes:['KNOWN_CAPTURE_INTERRUPTION']}});

test('owner actual-price example: remote previous-day reference is background; blocked VWAP is never promoted',()=>{
 const f=evaluateLiveFocus([blocked('VWAP',47195.4),qualified('PRIOR_LOW',46883),qualified('PRIOR_HIGH',47720)],
  {currentPrice:47243,zonePoints:14});
 assert.equal(f.state,'NO_ACTIVE_REFERENCE');
 assert.equal(f.activeNodeId,null);
 assert.equal(f.nearestBackground.id,'PRIOR_LOW');
 assert.equal(f.nearestBackground.distancePoints,360);
 assert.equal(f.activityRadiusPoints,28);
 assert.equal(f.observationOnly,true);
});

test('quality-restricted near reference never becomes an active node or silently repairs evidence',()=>{
 const f=evaluateLiveFocus([blocked('VWAP',47241),qualified('PRIOR_LOW',46883)],
  {currentPrice:47243,zonePoints:14});
 assert.equal(f.state,'NO_ACTIVE_REFERENCE');
 assert.equal(f.reasonCode,'NEAR_REFERENCE_QUALITY_BLOCKED');
 assert.equal(f.nearbyBlockedCount,1);
 assert.equal(f.nearbyEligibleCount,0);
});

test('valid nearby observation is selected ahead of distant historic importance',()=>{
 const f=evaluateLiveFocus([qualified('PRIOR_LOW',46883,{importanceBand:'PRIMARY'}),
   qualified('SWING_LOW',47238,{state:'APPROACHING',importanceBand:'SECONDARY'})],
 {currentPrice:47243,zonePoints:14});
 assert.equal(f.state,'ACTIVE_REFERENCE');
 assert.equal(f.activeNodeId,'SWING_LOW');
 assert.equal(f.proximityDoesNotProveTest,true);
});

test('zero or unknown observation zone fails closed instead of inventing focus',()=>{
 for(const zonePoints of [0,-1,null,NaN]){
  const f=evaluateLiveFocus([qualified('PRIOR_LOW',46883)],{currentPrice:47243,zonePoints});
  assert.equal(f.state,'UNAVAILABLE');
  assert.equal(f.activeNodeId,null);
 }
});

test('29.39 reference RR is arithmetically preserved but never interpreted as the current price entry RR',()=>{
 const ratio=823/28;
 const a=evaluateConditionalRrApplicability({state:'AVAILABLE',ratio},{
  currentPrice:47243,confirmationThreshold:46897,invalidationThreshold:46869,
  targetPrice:47720,direction:'LONG',zonePoints:14,
 });
 assert.equal(Number(ratio.toFixed(2)),29.39);
 assert.equal(a.state,'REFERENCE_PRICE_DISLOCATED');
 assert.equal(a.gapFromConfirmationPoints,346);
 assert.equal(a.currentEntryRr,null);
 assert.equal(a.entryAuthorized,false);
});

test('even a near-confirmation geometry remains observation-only, never an executable R:R',()=>{
 const a=evaluateConditionalRrApplicability({state:'AVAILABLE',ratio:2},{
  currentPrice:46899,confirmationThreshold:46897,invalidationThreshold:46869,
  targetPrice:47720,direction:'LONG',zonePoints:14,
 });
 assert.equal(a.state,'NEAR_REFERENCE_UNCONFIRMED');
 assert.equal(a.currentEntryRr,null);
 assert.equal(a.entryAuthorized,false);
});
test('price already beyond the target is not claimed to retain its geometric reward',()=>{
 const a=evaluateConditionalRrApplicability({state:'AVAILABLE',ratio:29.39},{
  currentPrice:47721,confirmationThreshold:46897,invalidationThreshold:46869,
  targetPrice:47720,direction:'LONG',zonePoints:14,
 });
 assert.equal(a.state,'TARGET_REACHED_OR_PASSED');
 assert.equal(a.currentEntryRr,null);
});
test('missing legitimate target or unknown quote never becomes ratio 0',()=>{
 const a=evaluateConditionalRrApplicability({state:'UNAVAILABLE',ratio:null},{
  currentPrice:47243,confirmationThreshold:46897,invalidationThreshold:46869,
  targetPrice:null,direction:'SHORT',zonePoints:14,
 });
 assert.equal(a.state,'UNAVAILABLE');
 assert.equal(a.currentEntryRr,null);
});

test('FLOW LIVE with insufficient classification quality cannot support pressure-response description',()=>{
 const f=evaluateDecisionEvidenceGate({chartQuality:'PASS',sourceGeometry:false,
  focus:{state:'ACTIVE_REFERENCE'},snapshotTime:'2026-10-16T01:30:00.000Z',
  flow:{sourceState:'LIVE',quality:'QUALITY_INSUFFICIENT',pressure60:.3,response60:2,availableAt:'2026-10-16T01:29:50.000Z'}});
 assert.equal(f.priceRelationAllowed,true);
 assert.equal(f.pressureResponseDescriptionAllowed,false);
 assert.ok(f.reasonCodes.includes('FLOW_QUALITY_OR_COVERAGE_INSUFFICIENT'));
 assert.equal(f.directionConfirmed,false);
 assert.equal(f.actionableRrAllowed,false);
 assert.equal(f.executionAuthorized,false);
});
test('even qualified pressure and displacement are descriptive, not automatic confirmation',()=>{
 const f=evaluateDecisionEvidenceGate({chartQuality:'PASS',sourceGeometry:true,
  focus:{state:'ACTIVE_REFERENCE'},snapshotTime:'2026-10-16T01:30:00.000Z',
  flow:{sourceState:'LIVE',quality:'PASS',pressure60:.3,response60:2,availableAt:'2026-10-16T01:29:50.000Z'}});
 assert.equal(f.pressureResponseDescriptionAllowed,true);
 assert.equal(f.directionConfirmed,false);
 assert.equal(f.priceAcceptanceConfirmed,false);
 assert.equal(f.actionableRrAllowed,false);
});

function sparseMarketFixture(){
 const anchor=Date.parse('2026-10-16T01:00:00.000Z');
 const bars=Array.from({length:6},(_,i)=>{
  const time=new Date(anchor+i*300000).toISOString();
  return {time,availableAt:new Date(anchor+(i+1)*300000-1).toISOString(),
   open:47240,high:47255,low:47230,close:47243,volume:12,qualityStatus:'PASS'};
 });
 const level=(price)=>({availability:'AVAILABLE',value:price,source:'GOVERNED_PRIOR',
   tradeDate:'2026-10-15',session:'DAY',actualContract:'TXFJ6',
   availableAt:'2026-10-16T01:28:00.000Z',qualityStatus:'PASS'});
 return {mode:'LIVE',timeframe:'5m',tradeDate:'2026-10-16',session:'DAY',actualContract:'TXFJ6',
  availableAt:'2026-10-16T01:29:58.000Z',lastPrice:47243,qualityStatus:'PASS',
  bars,openingRange:{status:'UNAVAILABLE'},
  levels:{vwap:{...level(47241),tradeDate:'2026-10-16',session:'DAY',qualityStatus:'QUALITY_INSUFFICIENT',
    qualityReasons:['KNOWN_CAPTURE_INTERRUPTION'],structureEligibility:{state:'BLOCKED'}},
    previousDayLow:level(46883),previousDayHigh:level(47720)}};
}
test('real backend builder attaches authoritative no-focus gate while preserving old descriptive evidence',()=>{
 const c=sparseMarketFixture(),original=structuredClone(c);
 const w=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-16T01:30:00.000Z'});
 assert.equal(w.decisionFocus.state,'NO_ACTIVE_REFERENCE');
 assert.equal(w.decisionFocus.reasonCode,'NEAR_REFERENCE_QUALITY_BLOCKED');
 assert.equal(w.evidenceGate.directionConfirmed,false);
 assert.equal(w.evidenceGate.actionableRrAllowed,false);
 assert.equal(w.executionAuthorized,false);
 assert.equal(w.orderRoutesEnabled,false);
 assert.deepEqual(c,original);
});
test('client renderer cannot show 29.39 as a current executable RR',()=>{
 const source=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const from=source.indexOf('function scenarioRrText(scenario) {');
 const to=source.indexOf('function scenarioTargetText(scenario) {',from);
 assert.ok(from>0&&to>from);
 const ctx={finiteNumber:v=>typeof v==='number'&&Number.isFinite(v)?v:null,
  fmt:(v,places)=>Number(v).toFixed(places)};
 vm.createContext(ctx);
 vm.runInContext(source.slice(from,to),ctx);
 const label=ctx.scenarioRrText({rr:{state:'AVAILABLE',ratio:823/28,
  applicability:{state:'REFERENCE_PRICE_DISLOCATED'}}});
 assert.match(label,/現價 R:R —/);
 assert.match(label,/條件式 29.39/);
 assert.doesNotMatch(label,/^R:R 29.39$/);
});
test('client and canonical model renderer contain explicit current-focus and RR gates',()=>{
 const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
 const ai=fs.readFileSync(new URL('../src/ask-gpt-inline-verification.mjs',import.meta.url),'utf8');
 assert.match(app,/decisionFocus\?\.state !== 'NO_ACTIVE_REFERENCE'/);
 assert.match(app,/現價可執行 R:R 不可用/);
 assert.match(ai,/decisionFocus\?\.state !== 'NO_ACTIVE_REFERENCE'/);
 assert.match(ai,/現價與確認門檻相差/);
});

test('stale or future pressure evidence is never certified as usable even if a provider reports PASS',()=>{
 for(const time of ['2026-10-16T01:20:00.000Z','2026-10-16T01:30:00.001Z',null]){
  const f=evaluateDecisionEvidenceGate({chartQuality:'PASS',sourceGeometry:false,
    focus:{state:'ACTIVE_REFERENCE'},snapshotTime:'2026-10-16T01:30:00.000Z',
    flow:{sourceState:'LIVE',quality:'PASS',pressure60:.4,response60:6,availableAt:time}});
  assert.equal(f.pressureResponseDescriptionAllowed,false);
  assert.equal(f.directionConfirmed,false);
  assert.equal(f.executionAuthorized,false);
 }
});

test('active nearby qualified node, not remote priority, determines present scenario',()=>{
 const c=sparseMarketFixture();
 c.levels.vwap={...c.levels.vwap,value:46850,source:'SESSION_EXACT_TX_TICK_VWAP',
  qualityStatus:'PASS',qualityReasons:[],structureEligibility:null};
 c.levels.previousDayLow={...c.levels.previousDayLow,value:47241};
 const w=buildDecisionLevelWatch({chart:c,snapshotTime:'2026-10-16T01:30:00.000Z'});
 assert.equal(w.decisionFocus.state,'ACTIVE_REFERENCE');
 assert.equal(w.decisionFocus.activeNodeId,'PRIOR_LOW');
 assert.equal(w.nextWatch?.id,'PRIOR_LOW','live nextWatch should match current nearby focus');
 assert.equal(w.scenarioWatch?.node?.id,'PRIOR_LOW','live scenario should match current nearby focus');
 assert.equal(w.evidenceGate.directionConfirmed,false);
 assert.equal(w.executionAuthorized,false);
});

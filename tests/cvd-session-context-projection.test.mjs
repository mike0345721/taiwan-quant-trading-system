import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { sessionFixture,calendar } from './cvd-session-context-fixture.mjs';
import { buildSessionContext,buildSessionContextHandoff } from '../src/cvd-session-context-projection.mjs';
import { buildCvdHandoffProjection } from '../src/cvd-handoff-projection.mjs';
import { FRAMES } from '../src/cvd-chart-projection.mjs';
const context=f=>buildSessionContext(f.g,f,f.events,calendar);
for(const session of ['DAY','NIGHT']) for(const proven of [false,true]) test(`${session} full/observed label requires accepted proof=${proven}`,()=>{
  const f=sessionFixture({start:session==='DAY'?'2026-09-14T08:45:00+08:00':'2026-09-14T15:00:00+08:00',proven}),c=context(f);
  assert.equal(c.scope,proven?'SESSION_TO_NOW':'OBSERVED_SEGMENT_TO_NOW');assert.equal(c.sessionStartProven,proven);
  assert.equal(c.label,session+'｜'+(proven?session==='DAY'?'本日盤中累積':'本夜盤累積':'觀測累積'));
  assert.equal(c.captureCompleteness,'UNPROVEN');
});
test('context uses inclusive first cumulative increment; fixed windows remain independent',()=>{
  const f=sessionFixture(),before=JSON.stringify(f.relationships),c=context(f),last=f.g.result.semantic.series.at(-1);
  assert.equal(c.evidence.deltaCvd,last.value);assert.equal(c.evidence.deltaCvd,19);assert.equal(c.originCumulativeBaseline,0);
  assert.equal(c.evidence.observedVolume,last.totalExecutedVolume);assert.equal(c.evidence.pressure.netAggressiveFlowProxy,c.evidence.deltaCvd);
  assert.equal(c.evidence.response.displacementPoints,18);assert.equal(c.evidence.priceDelta,18);assert.equal(c.evidence.pathEfficiency.value,1);
  assert.equal(c.relationship.code,'ALIGNED');assert.equal(c.evidence.complete,true);assert.equal(c.observedSpanMs,180000);
  for(const frame of ['1h','4h']) assert.equal(f.relationships[frame].current.current.complete,false);
  assert.equal(JSON.stringify(f.relationships),before);assert.equal(c.method.pressureIndependentVote,false);
});
test('all UNKNOWN preserves volume and null CVD, never neutral',()=>{
  const f=sessionFixture({tickType:0}),c=context(f);
  assert.equal(c.scope,'OBSERVED_SEGMENT_TO_NOW');assert.equal(c.evidence.unknownVolume,19);assert.equal(c.evidence.observedVolume,19);
  assert.equal(c.evidence.deltaCvd,null);assert.equal(c.cumulativeCvd,null);assert.equal(c.evidence.pressure.classifiedCoverage,0);
  assert.equal(c.relationship.code,'MIXED_OR_QUALITY_LIMITED');
});
for(const key of ['actualContract','session','tradeDate','continuityEpoch','availabilityLineageStatus','recordHash']) test(`same-segment fence: ${key}`,()=>{
  const f=sessionFixture();f.events=structuredClone(f.events);f.events[2][key]='INVALID';assert.equal(context(f).scope,'UNAVAILABLE');
});
test('continuity break/null gap and terminal mismatch fail closed',()=>{
  const f=sessionFixture();f.charts['1m'].display.boundaryAtCutoff=true;assert.equal(context(f).scope,'UNAVAILABLE');
  const g=sessionFixture();g.g.result.semantic.series[3].value=null;assert.equal(context(g).scope,'UNAVAILABLE');
});
test('unproven early tick never creates proof, inconsistent true proof fails closed',()=>{
  assert.equal(context(sessionFixture({start:'2026-09-14T08:45:00+08:00'})).sessionStartProven,false);
  assert.equal(context(sessionFixture({proven:true})).scope,'UNAVAILABLE');
});
test('accepted timestamp semantics and missing strict price endpoints preserve context',()=>{
  const f=sessionFixture({badPrice:true}),c=context(f);
  assert.equal(c.scope,'OBSERVED_SEGMENT_TO_NOW');assert.equal(c.evidence.deltaCvd,19);
  assert.equal(c.evidence.priceDelta,null);assert.equal(c.firstPrice,null);assert.equal(c.evidence.response.displacementPoints,18);
});
test('handoff uses context across all frames while recent partial truth remains; no cross-gap math',()=>{
  const p=sessionFixture({start:'2026-09-12T04:56:00+08:00',price:100}),c=sessionFixture(),pc=context(p),cc=context(c);
  for(const frame of FRAMES) {
    const h=buildSessionContextHandoff(p,c,p.events,c.events,calendar,pc,cc,frame);
    assert.equal(h.primaryEvidence,'SESSION_CONTEXT');assert.equal(h.handoff.code,'CONFIRMED_CONTINUATION');
    assert.equal(h.prior.evidence.deltaCvd,19);assert.equal(h.current.evidence.deltaCvd,19);assert.equal(h.gap.points,2);
    assert.equal(h.gap.label,'觀測片段端點差');assert.equal(h.pairing.closedMarketGap.cvd,null);assert.equal(h.pairing.closedMarketGap.pathEfficiency,null);
    assert.deepEqual(h.recentChange.current,c.relationships[frame].current.current);
    if(frame==='4h')assert.equal(h.recentChange.current.complete,false);
  }
});
test('observed endpoint price difference cannot imply official opening rejection',()=>{
  const p=sessionFixture({start:'2026-09-12T04:56:00+08:00',price:100}),c=sessionFixture({price:90});
  assert.equal(buildCvdHandoffProjection(p,c,p.events,c.events,calendar,'1m').handoff.code,'PRIOR_SESSION_REJECTED');
  const h=buildSessionContextHandoff(p,c,p.events,c.events,calendar,context(p),context(c),'1m');
  assert.equal(h.handoff.code,'UNCONFIRMED_OR_CONFLICT');assert.equal(h.handoff.reason,'OFFICIAL_OPEN_CLOSE_BOUNDARIES_UNPROVEN');
  assert.equal(h.gap.openingBoundaryProven,false);assert.equal(h.gap.officialCloseProven,false);
});
test('nonadjacency and rollover remain unavailable',()=>{
  for(const spec of [{start:'2026-09-07T09:00:00+08:00'},{contract:'TXFJ6'}]) {
    const p=sessionFixture({start:'2026-09-12T04:56:00+08:00'}),c=sessionFixture(spec);
    assert.equal(buildSessionContextHandoff(p,c,p.events,c.events,calendar,context(p),context(c),'4h').handoff.code,'UNAVAILABLE');
  }
});
test('context contains no second CVD accumulator or classification parsing',()=>{
  const code=fs.readFileSync(new URL('../src/cvd-session-context-projection.mjs',import.meta.url),'utf8');
  assert.doesNotMatch(code,/tick_type|appendCvdRecords|materializeTxCanonicalObservations|createCvdCheckpoint/);
});

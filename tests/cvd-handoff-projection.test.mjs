import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { handoffFixture,calendar } from './cvd-handoff-fixture.mjs';
import { buildCvdHandoffProjection } from '../src/cvd-handoff-projection.mjs';
import { FRAMES } from '../src/cvd-chart-projection.mjs';
const prior=handoffFixture({start:'2026-09-12T04:56:00+08:00',price:100});
const build=(current=handoffFixture(),p=prior,f='1m')=>buildCvdHandoffProjection(p,current,p?.events ?? [],current.events,calendar,f);
test('accepted C evidence and independent CVD/path retained exactly at all six selected windows',()=>{
  const c=handoffFixture(), before=structuredClone(c);
  for(const f of FRAMES) {const h=build(c,prior,f);assert.deepEqual(h.current.evidence,c.relationships[f].current.current);assert.deepEqual(h.prior.evidence,prior.relationships[f].current.current);assert.equal(h.current.cumulativeCvd,19);assert.equal(h.prior.cumulativeCvd,19);assert.equal(h.method.crossGapCvdArithmetic,false);assert.equal(h.method.crossGapPath,false);assert.equal(h.method.pressureIndependentVote,false);}
  assert.deepEqual(c,before);
});
test('governed Friday NIGHT to Monday DAY; closed-market gap has no fabricated activity',()=>{
  const h=build();assert.equal(h.pairing.kind,'NIGHT_TO_DAY');assert.equal(h.pairing.state,'COMPARABLE');assert.equal(h.gap.points,2);
  assert.deepEqual(h.pairing.closedMarketGap,{start:'2026-09-11T21:00:00.000Z',end:'2026-09-14T00:45:00.000Z',interpolation:false,cvd:null,volume:null,pressure:null,pathEfficiency:null});
  assert.equal(h.prior.lastPrice.price,118);assert.equal(h.current.firstPrice.price,120);assert.equal(h.gap.scope,'OBSERVED_FRAGMENT_ENDPOINT_PRICES_ONLY');
});
test('governed DAY to same-calendar afternoon NIGHT resolves next official tradeDate',()=>{
  const h=build(handoffFixture({start:'2026-09-11T15:00:00+08:00',price:130}),handoffFixture({start:'2026-09-11T13:40:00+08:00'}));
  assert.equal(h.pairing.kind,'DAY_TO_NEXT_NIGHT');assert.equal(h.pairing.state,'COMPARABLE');assert.equal(h.current.identity[1],'2026-09-14');
});
for(const [name,spec,expected] of [
  ['continuation',{},'CONFIRMED_CONTINUATION'],['weakening',{weakening:true},'CONFIRMED_BUT_WEAKENING'],
  ['rejection despite same clean current',{price:90},'PRIOR_SESSION_REJECTED'],
  ['takeover before rejection',{price:110,direction:-1},'OPPOSITE_TAKEOVER'],
  ['partial',{count:4},'UNCONFIRMED_OR_CONFLICT'],['missing current lawful price',{badPrice:true},'UNAVAILABLE']
]) test('SYNTHETIC '+name,()=>{const h=build(handoffFixture(spec));assert.equal(h.handoff.code,expected);assert.equal(h.evidenceKind,'SYNTHETIC_FIXTURE');});
test('partial prior cannot form clean direction; partial current may show only supported opening rejection',()=>{
  let h=build(handoffFixture(),handoffFixture({start:'2026-09-12T04:56:00+08:00',count:4}));assert.equal(h.handoff.code,'UNCONFIRMED_OR_CONFLICT');assert.equal(h.prior.evidence.complete,false);
  h=build(handoffFixture({price:90,count:4}));assert.equal(h.handoff.code,'PRIOR_SESSION_REJECTED');assert.equal(h.current.evidence.complete,false);
  h=build(handoffFixture(),prior,'4h');assert.equal(h.handoff.code,'UNCONFIRMED_OR_CONFLICT');assert.equal(h.current.evidence.deltaCvd,19);assert.equal(h.current.evidence.complete,false);
});
test('zero gap is lawful zero, missing prices never become zero',()=>{
  assert.equal(build(handoffFixture({price:118})).gap.points,0);
  const h=build(handoffFixture(),handoffFixture({start:'2026-09-12T04:56:00+08:00',badPrice:true}));assert.equal(h.gap.points,null);assert.equal(h.handoff.reason,'PRIOR_LAWFUL_PRICE_MISSING');
});
test('rollover, non-adjacent actual historical identities, missing lineage, source mix and missing side fail closed',()=>{
  assert.equal(build(handoffFixture({contract:'TXFJ6'})).handoff.reason,'ACTUAL_CONTRACT_NOT_COMPARABLE');
  const realNight=handoffFixture({start:'2026-09-12T00:00:00+08:00',kind:'GOVERNED_FRAGMENT'}),realDay=handoffFixture({start:'2026-09-07T08:45:00+08:00',kind:'GOVERNED_FRAGMENT'});
  const h=build(realDay,realNight);assert.equal(h.handoff.reason,'SESSIONS_NOT_GOVERNED_ADJACENT');assert.equal(h.gap.points,null);
  const broken=handoffFixture();broken.relationships['1m'].current.lineage.availableAt=null;assert.equal(build(broken).handoff.code,'UNAVAILABLE');
  assert.equal(build(handoffFixture({kind:'GOVERNED_FRAGMENT'})).handoff.reason,'REAL_SYNTHETIC_MIX_REFUSED');
  assert.equal(build(handoffFixture(),null).handoff.reason,'SESSION_SIDE_MISSING');
});
test('future prior availability cannot backpaint an earlier current cutoff',()=>{
  const p=structuredClone(prior),l=p.relationships['1m'].current.lineage;l.availableAt='2026-09-15T00:00:00Z';l.availableAtMs=Date.parse(l.availableAt);
  assert.equal(build(handoffFixture(),p).handoff.reason,'PRIOR_NOT_AVAILABLE_AT_CURRENT_CUTOFF');
});
test('exact six five-character Relationship labels shared by first-screen, Timeline and safe K markers',()=>{
  const js=fs.readFileSync(new URL('../public/cru54-relationship.js',import.meta.url),'utf8');
  for(const [code,label] of Object.entries({ALIGNED:'力價同步中',ALIGNED_BUT_WEAKENING:'同向但轉弱',PRESSURE_RESPONSE_MISMATCH:'力價不同步',OPPOSITE_DIVERGENCE:'力價反方向',MIXED_OR_QUALITY_LIMITED:'證據有分歧',UNAVAILABLE:'暫無法判讀'})) {
    assert.equal([...label].length,5);assert.match(js,new RegExp(code+": '"+label+"'"));
  }
  assert.match(js,/const short = labels;/);
  for(const label of ['延續獲確認','延續但轉弱','前勢遭拒絕','反向已接手','尚未獲確認','暫無法判讀']) assert.ok(js.includes(label));
});

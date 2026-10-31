import test from 'node:test';import assert from 'node:assert/strict';
import {compareResearchVariants} from '../src/research-incremental-oos.mjs';
import {resolveResearchOutcome} from '../src/research-replay-outcome.mjs';
import {fixture,dates,protocolFor,seal,resealPath} from './research-replay-fixtures.mjs';
const input=()=>({protocol:protocolFor(),rows:dates.map((d,i)=>{const f=fixture(d,i);return {signal:f.signal,outcome:resolveResearchOutcome(f),foldId:'fold'+Math.floor(i/8)};})});
const reseal=p=>seal(Object.fromEntries(Object.entries(p).filter(([k])=>k!=='sha256')));
test('SYNTHETIC 24 paired OOS dates, costs, same-day denominator and deterministic family-adjusted block intervals',()=>{
 const x=input(),r=compareResearchVariants(x);assert.equal(r.state,'PREREGISTERED_PAIRED_OOS_REPLAY');
 assert.equal(r.sampleSize,24);assert.equal(r.metrics.baseline.trades,24);assert.equal(r.metrics.depth.trades,12);
 assert.equal(r.metrics.filter.trades,16);assert.equal(r.metrics.combined.trades,8);assert.equal(r.metrics.depth.calendarDays,24);
 assert.equal(r.comparisons.length,5);assert.equal(r.comparisons[0].confidenceInterval.familyConfidence,.95);
 assert.equal(r.confidence,'LOW_SMALL_SAMPLE');assert.equal(r.positiveEvProven,false);
 assert.deepEqual(r,compareResearchVariants(x));assert.equal(r.metrics.baseline.returnPct,null);
});
test('overlap, embargo leakage, late freeze, future labels, date duplicates and dropped days block',()=>{
 for(const change of [x=>{x.protocol.folds[1].testStartAt=x.protocol.folds[0].testStartAt},
  x=>{x.protocol.folds[0].trainOutcomeAvailableAt=x.protocol.folds[0].testStartAt},
  x=>{x.protocol.frozenAt=x.protocol.folds[0].testStartAt},x=>{x.protocol.folds[0].embargoMs=0},
  x=>{x.rows[1]=x.rows[0]},x=>{x.rows.pop()},x=>{x.rows[0].outcome.netExitPoints=1000},
  x=>{x.protocol.horizonMs=null},x=>{x.rows[0].signal.features.quality='UNKNOWN'}]){
  const x=input();change(x);x.protocol=reseal(x.protocol);assert.equal(compareResearchVariants(x).state,'BLOCKED');
 }
});
test('the small-sample gate cannot be satisfied with repeated folds or fewer than 24 dates',()=>{
 const x=input();x.protocol.folds=[x.protocol.folds[0],x.protocol.folds[0],x.protocol.folds[0]];x.protocol=reseal(x.protocol);
 assert.equal(compareResearchVariants(x).state,'BLOCKED');
 const y=input();y.rows.pop();y.protocol.oosDates.pop();y.protocol=reseal(y.protocol);assert.equal(compareResearchVariants(y).state,'BLOCKED');
});
test('OOS refuses absent or prematurely available outcomes and sub-ms future features',()=>{
 for(const field of ['outcomeAvailableAt','featureAvailableAt','signalAvailableAt','horizonEndAt']){
  const x=input();delete x.rows[0].outcome[field];x.rows[0].outcome=reseal(x.rows[0].outcome);
  assert.equal(compareResearchVariants(x).state,'BLOCKED',field);
 }
 const x=input();x.rows[0].outcome.outcomeAvailableAt=x.rows[0].signal.signalAvailableAt;
 x.rows[0].outcome=reseal(x.rows[0].outcome);assert.equal(compareResearchVariants(x).state,'BLOCKED');
 const y=input(),f=fixture(dates[0]);f.signal.featureAvailableAt=dates[0]+'T02:00:00.000900000Z';f.signal.features.availableAt=f.signal.featureAvailableAt;resealPath(f);
 y.rows[0]={signal:f.signal,outcome:resolveResearchOutcome(f),foldId:'fold0'};assert.equal(compareResearchVariants(y).state,'BLOCKED');
});

import test from 'node:test';import assert from 'node:assert/strict';
import {resolveResearchOutcome,costedMove} from '../src/research-replay-outcome.mjs';
import {fixture,rules,resealPath,seal} from './research-replay-fixtures.mjs';
test('SYNTHETIC complete captured path: full-horizon extrema separate from trade excursion and costed exits',()=>{
 const f=fixture(),before=JSON.stringify(f),r=resolveResearchOutcome(f);
 assert.equal(r.state,'CAPTURE_AUDITED_REPLAY');assert.equal(r.mfePoints,8);assert.equal(r.maePoints,5);
 assert.equal(r.tradeMaePoints,0);assert.equal(r.exitReason,'TARGET_HIT');assert.equal(r.realizedPnl,null);
 assert.ok(r.maxNetLiquidationPoints<r.mfePoints);assert.ok(r.minNetLiquidationPoints < -r.maePoints);assert.equal(r.sizeContracts,1);
 assert.equal(r.timeToMfeMs,2000);assert.equal(r.timeToMaeMs,3000);assert.ok(r.netEndpointPoints<0);assert.ok(r.netExitPoints>0);
 assert.equal(JSON.stringify(f),before);assert.equal(r.executionAuthorized,false);
});
test('short side, gap-through stop uses observed price rather than optimistic threshold',()=>{
 const f=fixture();f.signal.side='SHORT';resealPath(f);const r=resolveResearchOutcome(f);
 assert.equal(r.mfePoints,5);assert.equal(r.maePoints,8);assert.equal(r.exitReason,'STOP_HIT');
 assert.equal(r.exitCost.grossPoints,-8);assert.ok(r.netExitPoints < -10);assert.ok(r.failureReasons.includes('STOP_HIT'));
});
test('cost erased gross gain is explicitly labelled; fee and tax are charged each side',()=>{
 const f=fixture();f.rules=seal({...Object.fromEntries(Object.entries(rules).filter(([k])=>k!=='sha256')),targetPoints:50,stopPoints:50});
 f.signal.rulesSha256=f.rules.sha256;f.coverage.rulesSha256=f.rules.sha256;resealPath(f);
 const r=resolveResearchOutcome(f);assert.equal(r.exitReason,'HORIZON_END');assert.ok(r.failureReasons.includes('COST_ERASED_GROSS_GAIN'));
 const c=costedMove(10000,10002,'LONG',rules);assert.equal(c.feePoints,.5);assert.equal(c.slippagePoints,2);assert.equal(c.taxPoints,.41);
 assert.ok(Math.abs(c.netPoints-(-.91))<1e-9);
});
test('missing capture audit, synthetic source, hash mutation and missing endpoints never yield full MFE',()=>{
 for(const change of [f=>{f.coverage=null},f=>{f.coverage.sourceMode='SYNTHETIC'},f=>{f.tape[3].price=99999},
  f=>{f.tape.shift();resealPath(f)},f=>{f.tape.pop();resealPath(f)},f=>{f.coverage.droppedEvents=1;f.coverage=seal(Object.fromEntries(Object.entries(f.coverage).filter(([k])=>k!=='sha256')))}]){
  const f=fixture();change(f);const r=resolveResearchOutcome(f);assert.equal(r.state,'BLOCKED');assert.equal(r.mfePoints,null);
 }
});
test('future features, rules frozen after signal, duplicates, NaN, session crossing, malformed times rejected',()=>{
 for(const change of [f=>{f.signal.featureAvailableAt='2026-10-22T02:00:01Z'},f=>{f.tape[2].recordHash=f.tape[1].recordHash},
  f=>{f.tape[2].price=NaN},f=>{f.tape[2].availableAt='2026-10-22T01:59:00Z'},f=>{f.signal.session='NIGHT'},
  f=>{f.rules=seal({...Object.fromEntries(Object.entries(rules).filter(([k])=>k!=='sha256')),frozenAt:'2026-10-23T00:00:00Z'});f.signal.rulesSha256=f.rules.sha256},
  f=>{f.tape[5].exchangeTimestamp='2026-02-30T02:00:00Z'}]){
  const f=fixture();change(f);resealPath(f);assert.equal(resolveResearchOutcome(f).state,'BLOCKED');
 }
});
test('a 6-second internal gap is blocked even with otherwise matching capture receipt',()=>{
 const f=fixture();f.tape.splice(2,5);resealPath(f);assert.equal(resolveResearchOutcome(f).reason,'PATH_BOUNDARY_OR_CONTINUITY_GAP');
});
test('submillisecond future feature and late freeze rejected; post-horizon tick cannot set extrema',()=>{
 const f=fixture();f.signal.featureAvailableAt='2026-10-22T02:00:00.000900000Z';resealPath(f);
 assert.equal(resolveResearchOutcome(f).state,'BLOCKED');
 const g=fixture();g.tape.at(-1).exchangeTimestamp='2026-10-22T02:00:10.000900000Z';g.tape.at(-1).price=20000;resealPath(g);
 const r=resolveResearchOutcome(g);assert.equal(r.state,'CAPTURE_AUDITED_REPLAY');assert.equal(r.mfePoints,8);
 assert.equal(r.endpointAt,'2026-10-22T02:00:09.000Z');
});

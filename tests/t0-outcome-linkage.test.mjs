// SYNTHETIC ENGINEERING FIXTURES. Never accepted by the pinned real-source loader.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {projectT0Outcomes} from '../src/t0-outcome-linkage.mjs';
import {P0_SPEC,buildHistoricalPaperSession,digest} from '../src/p0-paper-trading.mjs';
import {costViewsForTrade} from '../src/t0-h0-runner.mjs';
const policy=JSON.parse(fs.readFileSync(new URL('../research/t0-v1/cost-policy.json',import.meta.url)));
function fixture(side='LONG',exit=110,reason='TIME_EXIT') {
  const session={tradeDate:'2026-01-02',sessionId:'2026-01-02-DAY',contractCode:'202601',
    synthetic:false,fixtureOnly:false,formalWeight:0,researchOnly:true,executionAuthorized:false,
    inputEvidence:{t0SpecHash:P0_SPEC.t0SpecHash,costPolicyHash:P0_SPEC.costPolicyHash,strictManifestHash:P0_SPEC.strictManifestHash,rawTickSourceHash:'a'.repeat(64)},
    sampleState:'ELIGIBLE',qualityState:'PASS',pathQuality:'PASS_TICK_ORDERED',tradeState:'TRADE',breakoutDirection:side,
    orAvailableAt:'2026-01-02T01:00:00.000Z',orHigh:100,orLow:90,
    breakoutConfirmedAt:'2026-01-02T01:05:00.000Z',entryAt:'2026-01-02T01:10:00.000Z',entryReferencePrice:100,
    exitAt:reason==='TIME_EXIT'?'2026-01-02T02:10:00.000Z':'2026-01-02T01:20:00.000Z',exitReferencePrice:exit,
    timeExitAt:'2026-01-02T02:10:00.000Z',initialStopPrice:side==='LONG'?90:110,exitReason:reason,
    mfePoints:15,maePoints:-10};
  session.costViews=costViewsForTrade({direction:side,entryReferencePrice:100,exitReferencePrice:exit},policy);
  const events=[];buildHistoricalPaperSession(session,events);
  return {sessions:[session],events,costPolicy:structuredClone(policy),strictSessions:[{tradeDate:session.tradeDate,sessionId:session.sessionId,actualReplayContractCode:'202601'}]};
}
test('long and short bind exact intent, preserve signed MAE, fixed costs and historical availability',()=>{
  for(const side of ['LONG','SHORT']) {
    const f=fixture(side,side==='LONG'?110:90),before=JSON.stringify(f),r=projectT0Outcomes(f).rows[0];
    assert.equal(r.eventId,f.events.find(e=>e.eventType==='PAPER_INTENT_CREATED').eventId);
    assert.equal(r.signalAvailableAt,'2026-01-02T01:10:00.000Z');
    assert.equal(r.legacyConfirmationBarStartAt,'2026-01-02T01:05:00.000Z');
    assert.equal(r.maePoints,-10);assert.equal(r.maeMagnitudePoints,10);assert.equal(r.mfePoints,15);
    assert.equal(r.netExitPnlTwd,r.grossPnlTwd-r.commissionTwd-r.taxTwd-r.slippageTwd);
    assert.equal(r.maxNetLiquidationPnlTwd,3000-r.commissionTwd-r.slippageTwd); // low-price fixture tax rounds to zero
    assert.equal(r.realizedPnlTwd,null);assert.equal(r.forwardEligible,false);assert.equal(r.oosEligible,false);
    assert.equal(JSON.stringify(f),before);
  }
});
test('stop outcome has rule diagnostics and does not invent post-stop horizon or extrema timestamps',()=>{
  const f=fixture('LONG',89,'STOP_EXIT');f.sessions[0].maePoints=-11;
  const r=projectT0Outcomes(f).rows[0];
  assert.deepEqual(r.failureReasons,['STOP_EXIT','ADVERSE_OR_FLAT_EXIT']);
  assert.equal(r.scheduledHorizonNetPnlTwd,null);assert.equal(r.mfeAt,null);assert.equal(r.maeAt,null);
  assert.equal(r.causalExplanation,null);
});
test('small gross gains can become losses after the unchanged frozen costs',()=>{
  const r=projectT0Outcomes(fixture('LONG',102)).rows[0];
  assert.ok(r.grossPnlTwd>0);assert.ok(r.netExitPnlTwd<0);
  assert.deepEqual(r.failureReasons,['COST_ERASED_GROSS_GAIN']);
});
test('NO_TRADE retains the session denominator and null trade outcomes',()=>{
  const f=fixture();Object.assign(f.sessions[0],{tradeState:'NO_TRADE',noTradeReason:'NO_BREAKOUT_WITHIN_ENTRY_WINDOW'});
  f.events=[];buildHistoricalPaperSession(f.sessions[0],f.events);
  const r=projectT0Outcomes(f);
  assert.equal(r.summary.sessions,1);assert.equal(r.summary.linkedSignals,0);assert.equal(r.summary.noTradeSessions,1);
  assert.equal(r.rows[0].eventId,null);assert.equal(r.rows[0].netExitPnlTwd,null);assert.equal(r.rows[0].mfePoints,null);
});
test('missing numbers, cost retuning, wrong identity, invalid time and missing denominator fail closed',()=>{
  for(const change of [
    f=>f.sessions[0].mfePoints=null,f=>f.sessions[0].maePoints='0',
    f=>f.sessions[0].entryAt='2026-01-02T01:05:00.000Z',
    f=>f.sessions[0].contractCode='202602',f=>f.sessions[0].inputEvidence.costPolicyHash='0'.repeat(64),
    f=>f.costPolicy.baseTicksPerSide=1,f=>f.sessions[0].costViews[2].netPnl+=1,
    f=>f.sessions.push(structuredClone(f.sessions[0])),f=>f.strictSessions=[],
  ]) {const f=fixture();change(f);assert.throws(()=>projectT0Outcomes(f));}
});
test('rehashed but unrelated paper intent is rejected by full event parity',()=>{
  const f=fixture();f.events.find(e=>e.eventType==='PAPER_INTENT_CREATED').payload.referenceEntryPrice=99;
  let previous=null;
  for(const event of f.events) {event.payloadHash=digest(event.payload);event.priorRecordHash=previous;const {recordHash,...body}=event;event.recordHash=digest(body);previous=event.recordHash;}
  assert.throws(()=>projectT0Outcomes(f),/LEDGER_PARITY/);
});

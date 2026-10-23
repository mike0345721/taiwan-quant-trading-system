import test from 'node:test';
import assert from 'node:assert/strict';
import { readLocalHealth, summarizeReadonlyHealth } from '../src/readonly-health-monitor.mjs';
const closed = { state:'MARKET_CLOSED',marketShouldBeActive:false };
const bridge = { mode:'market_data_only',formalWeight:0,researchOnly:true,executionAuthorized:false,orderRoutesEnabled:false,bridgeState:'DEGRADED' };
const dashboard = { runtimeIdentityStatus:'VERIFIED',runtimeCommit:'a'.repeat(40),runtimeReady:false };
test('closed market preserves provider degradation and missing UI instead of false LIVE',()=>{
  const r=summarizeReadonlyHealth({market:closed,bridge,dashboard,expectedHead:'a'.repeat(40)});
  assert.equal(r.state,'MARKET_CLOSED_EXPECTED');assert.equal(r.bridge.reportedState,'DEGRADED');
  assert.equal(r.dashboard.runtimeReady,false);assert.equal(r.liveMarketAcceptance,false);
  assert.deepEqual(r.actionsTaken,[]);
  assert.equal(summarizeReadonlyHealth({market:closed,bridge}).state,'ATTENTION_REQUIRED');
  assert.equal(summarizeReadonlyHealth({market:closed,bridge:{...bridge,executionAuthorized:true},dashboard}).bridge.safetyVerified,false);
  assert.ok(summarizeReadonlyHealth({market:{state:'DAY',marketShouldBeActive:true},bridge,dashboard}).problems.includes('ACTIVE_SESSION_BRIDGE_DEGRADED'));
});
test('monitor only GETs exact loopback health paths; bad and oversized JSON stays unknown',async()=>{
  let calls=0;
  const fetchImpl=async(url,options)=>{calls++;assert.equal(options.method,'GET');assert.equal(options.redirect,'error');return new Response('{"ok":true}');};
  assert.deepEqual(await readLocalHealth('http://127.0.0.1:8790/health',{fetchImpl}),{ok:true});
  await assert.rejects(readLocalHealth('http://127.0.0.1:8790/shutdown',{fetchImpl}),/NOT_ALLOWED/);
  assert.equal(calls,1);
  assert.equal(await readLocalHealth('http://127.0.0.1:8790/health',{fetchImpl:async()=>new Response('x'.repeat(1048577))}),null);
  assert.equal(await readLocalHealth('http://127.0.0.1:8790/health',{fetchImpl:async()=>{throw Error('timeout')}}),null);
});

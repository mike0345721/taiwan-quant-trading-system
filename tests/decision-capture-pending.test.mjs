import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const app=fs.readFileSync(new URL('../public/app.js',import.meta.url),'utf8');
const server=fs.readFileSync(new URL('../server.mjs',import.meta.url),'utf8');
const controllerSource=app.slice(app.indexOf('function decisionCaptureIdentity('),app.indexOf('function renderDecisionCaptureStatus('));
const create=vm.runInNewContext(controllerSource+'\ncreateDecisionCaptureController',{AbortController,setTimeout,clearTimeout});
const identity=['2026-11-05','TXFK6','DAY','2026-11-05-DAY',null];
const cutoff='2026-11-05T01:35:00.000Z';
function ready(id='a'){
  const snapshot={snapshotHash:id.repeat(64),snapshotTime:cutoff,tradeDate:identity[0],contract:identity[1],session:identity[2],price:{value:30000}};
  const chart={tradeDate:identity[0],actualContract:identity[1],session:identity[2],sessionId:identity[3],timeframe:'5m',asOf:cutoff,lastPrice:30000,levels:{}};
  return {data:{schemaVersion:'decision-capture-v1',captureId:snapshot.snapshotHash,capturedAt:cutoff,chartCutoff:cutoff,
    workspace:{snapshot,chatGptCopy:`Snapshot: ${cutoff}\nHash: ${snapshot.snapshotHash}\nfixed`},chart}};
}
function warming(extra={}){return {data:{schemaVersion:'decision-capture-pending-v1',state:'PENDING',timeframe:'5m',
  chartCutoff:cutoff,identity:[...identity],reasonCodes:['SOURCE_CATCHUP_PENDING'],retryAfterMs:250,...extra}};}
function harness(response,options={}){
  let session='session-a',view={timeframe:'5m',identity:[...identity],asOf:'2026-11-05T01:34:59.000Z'};
  const reads=[],applied=[],copies=[],delays=[];
  const controller=create({request:async(frame,signal)=>{reads.push({frame,signal});return response(reads.length,signal);},selection:()=>view,
    ticket:()=>session,currentSession:token=>token===session,apply:(data,pair)=>applied.push({data,pair}),clipboard:async text=>copies.push(text),
    schedule:(fn,ms)=>{delays.push(ms);return setTimeout(fn,ms===250?1:ms);},cancel:clearTimeout,...options});
  return {controller,reads,applied,copies,delays,setSession:s=>{session=s;},setView:v=>{view={...view,...v};}};
}
const envelopeSource=server.slice(server.indexOf('function decisionCaptureEnvelope('),server.indexOf('\nasync function loadMarketChangeFeed('));
const envelope=vm.runInNewContext(envelopeSource+'\ndecisionCaptureEnvelope',{
  validateDecisionSnapshot(){},copyForChatGpt:s=>`Snapshot: ${s.snapshotTime}\nHash: ${s.snapshotHash}\nfixed`});

test('pending source audit returns no journal snapshot, capture ID or copy text',()=>{
  const payload=ready().data;payload.chart.sourceAuditProgress={state:'PENDING'};
  const result=envelope({chart:payload.chart,workspace:payload.workspace},'5m');
  assert.equal(result.state,'PENDING');assert.equal(result.schemaVersion,'decision-capture-pending-v1');
  assert.equal(result.chartCutoff,cutoff);assert.deepEqual(Array.from(result.identity),identity);
  assert.equal(result.captureId,undefined);assert.equal(result.workspace,undefined);assert.equal(result.retryAfterMs,250);
});
test('pending observation derivation cannot be serialized as a completed capture',()=>{
  const payload=ready().data;payload.chart.marketObservation={reasonCodes:['DERIVATION_CATCHUP_PENDING']};
  assert.equal(envelope({chart:payload.chart,workspace:payload.workspace},'5m').state,'PENDING');
});
test('known chart/observation prefix mismatch remains a failure, not a partial completed capture',()=>{
  const payload=ready().data;payload.chart.marketObservation={reasonCodes:['CHART_OBSERVATION_PREFIX_MISMATCH']};
  assert.throws(()=>envelope({chart:payload.chart,workspace:payload.workspace},'5m'),/MISMATCH/);
});
test('real authenticated route uses HTTP202/no-store for pending without returning completed capture',async()=>{
  const start=server.indexOf("      if (req.method === 'GET' && pathname === '/api/v1/decision-capture') {");
  const body=server.slice(start,server.indexOf("      if (req.method === 'GET' && pathname === '/api/v1/ask-gpt-context') {",start));
  let sent;
  const context={req:{method:'GET'},pathname:'/api/v1/decision-capture',url:new URL('http://fixture/api/v1/decision-capture?timeframe=5m'),res:{},
    currentDiscussionWorkspace:async()=>({}),decisionCaptureEnvelope:()=>warming().data,
    sendJson:(_r,status,payload,headers)=>{sent={status,payload,headers};}};
  vm.createContext(context);vm.runInContext('async function route(){'+body+'}',context);await context.route();
  assert.equal(sent.status,202);assert.equal(sent.headers['Cache-Control'],'no-store');assert.equal(sent.payload.data.state,'PENDING');
});
test('one Copy action polls only explicit pending and locks/copies exactly once after ready',async()=>{
  const h=harness(n=>n<3?warming():ready());const pair=await h.controller.copy();
  assert.equal(h.reads.length,3);assert.equal(h.applied.length,1);assert.deepEqual(h.copies,[pair.copyText]);
  assert.equal(h.delays.filter(ms=>ms===10000).length,1,'one total deadline, not one deadline per retry');
  assert.equal(h.delays.filter(ms=>ms===250).length,2);
});
test('duplicate Copy/Lock while pending coalesce; no clipboard write occurs before ready',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});
  const h=harness(async n=>n===1?warming():wait),lock=h.controller.capture(),a=h.controller.copy(),b=h.controller.copy();
  lock.catch(()=>{});a.catch(()=>{});assert.equal(a,b);await new Promise(resolve=>setTimeout(resolve,10));assert.equal(h.applied.length,0);assert.equal(h.copies.length,0);
  release(ready());await Promise.all([lock,a,b]);assert.equal(h.applied.length,1);assert.equal(h.copies.length,1);
});
test('continuous pending hits the same bounded deadline, preserves old lock and stops retrying',async()=>{
  let pending=false;const h=harness(()=>pending?warming():ready(),{timeoutMs:30});const old=await h.controller.capture();pending=true;
  await assert.rejects(h.controller.capture(),/DECISION_CAPTURE_TIMEOUT/);const count=h.reads.length;
  await new Promise(resolve=>setTimeout(resolve,10));assert.equal(h.reads.length,count);assert.equal(h.controller.locked(),old);assert.equal(h.applied.length,1);
});
test('pending cancellation on logout never starts another request or locks an obsolete snapshot',async()=>{
  let release;const wait=new Promise(resolve=>{release=resolve;});const h=harness(async n=>n===1?warming():wait);
  const capture=h.controller.copy();capture.catch(()=>{});await new Promise(resolve=>setTimeout(resolve,10));h.setSession('new');h.controller.reset();
  await assert.rejects(capture,/SESSION_CHANGED/);release(ready());await new Promise(resolve=>setTimeout(resolve,10));
  assert.equal(h.applied.length,0);assert.equal(h.copies.length,0);assert.equal(h.controller.locked(),null);
});
test('pending identity, cutoff drift and invalid retry instructions fail closed without copying',async()=>{
  for(const response of [()=>warming({identity:['2026-11-06',...identity.slice(1)]}),()=>warming({retryAfterMs:0}),
    n=>n===1?warming():warming({chartCutoff:'2026-11-05T01:35:01.000Z'}),
    n=>n===1?warming({chartCutoff:'2026-11-05T01:35:01.000Z'}):ready()]){
    const h=harness(response);await assert.rejects(h.controller.copy(),/MISMATCH|SUPERSEDED/);assert.equal(h.applied.length,0);assert.equal(h.copies.length,0);
  }
});
test('legacy completed response containing unfinished audit/derivation is rejected defensively',async()=>{
  for(const decorate of [p=>{p.data.chart.sourceAuditProgress={state:'PENDING'};},p=>{p.data.chart.marketObservation={reasonCodes:['DERIVATION_CATCHUP_PENDING']};}]){
    const p=ready();decorate(p);const h=harness(()=>p);await assert.rejects(h.controller.copy(),/NOT_READY/);
    assert.equal(h.applied.length,0);assert.equal(h.copies.length,0);
  }
});
test('ordinary source unavailability is not polled as catchup and completed partial observations remain usable',async()=>{
  const p=ready();p.data.chart.marketObservation={status:'UNAVAILABLE',reasonCodes:['NO_CLASSIFIED_EVENTS']};
  const h=harness(()=>p);await h.controller.copy();assert.equal(h.reads.length,1);assert.equal(h.copies.length,1);
  const failed=harness(()=>{throw Error('HTTP 503');});await assert.rejects(failed.controller.copy(),/503/);assert.equal(failed.reads.length,1);
});

test('capture response distinguishes input warmup from an actual frozen audit prefix',()=>{
  const p=ready().data;p.chart.sourceReadState='CATCHUP_PENDING';
  const capture={chart:p.chart,workspace:p.workspace};
  assert.equal(envelope(capture,'5m').cutoffState,'WARMING_INPUT');
  for(const state of ['PENDING','COMPLETE']){
    p.chart.sourceAuditProgress={state};
    assert.equal(envelope(capture,'5m').cutoffState,'FROZEN');
  }
});
test('advancing input warmup transitions to a single frozen cutoff and copies once',async()=>{
  const responses=[warming({cutoffState:'WARMING_INPUT',chartCutoff:'2026-11-05T01:34:59.500Z'}),
    warming({cutoffState:'WARMING_INPUT',chartCutoff:'2026-11-05T01:34:59.800Z'}),warming({cutoffState:'FROZEN'}),ready()];
  const h=harness(n=>responses[n-1]);const pair=await h.controller.copy();
  assert.equal(h.reads.length,4);assert.equal(h.applied.length,1);assert.deepEqual(h.copies,[pair.copyText]);
  assert.equal(pair.chartCutoff,cutoff);assert.equal(h.delays.filter(ms=>ms===10000).length,1);
});
test('only explicit warmup may advance; unknown phases, backward time and thawing fail closed',async()=>{
  const scenarios=[
    [warming({cutoffState:'UNRECOGNIZED'})],
    [warming({cutoffState:'WARMING_INPUT'}),warming({cutoffState:'WARMING_INPUT',chartCutoff:'2026-11-05T01:34:59.900Z'})],
    [warming({cutoffState:'FROZEN'}),warming({cutoffState:'WARMING_INPUT'})],
    [warming({cutoffState:'WARMING_INPUT',chartCutoff:'2026-11-05T01:35:00.100Z'}),ready()],
    [warming({cutoffState:'FROZEN'}),warming({cutoffState:'FROZEN',chartCutoff:'2026-11-05T01:35:00.100Z'})]
  ];
  for(const responses of scenarios){const h=harness(n=>responses[Math.min(n-1,responses.length-1)]);
    await assert.rejects(h.controller.copy(),/MISMATCH/);assert.equal(h.applied.length,0);assert.equal(h.copies.length,0);}
});
test('input warmup without a separate audit still uses a coherent final response and original deadline',async()=>{
  const h=harness(n=>n===1?warming({cutoffState:'WARMING_INPUT',chartCutoff:'2026-11-05T01:34:59.500Z'}):ready());
  await h.controller.copy();assert.equal(h.copies.length,1);assert.equal(h.reads.length,2);
  const stalled=harness(()=>warming({cutoffState:'WARMING_INPUT'}),{timeoutMs:30});
  await assert.rejects(stalled.controller.copy(),/TIMEOUT/);assert.equal(stalled.copies.length,0);assert.equal(stalled.applied.length,0);
});

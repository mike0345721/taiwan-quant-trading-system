import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createTxChartService } from '../src/dashboard-tx-chart-service.mjs';

function harness(options={}) {
  const workers=[]; let now=1000;
  class FakeWorker extends EventEmitter {
    constructor(url,settings) { super(); this.url=url;this.settings=settings;this.posts=[];this.terminations=0;workers.push(this); }
    postMessage(value) { this.posts.push(value); }
    terminate() { this.terminations++;return new Promise(resolve=>{this.finishTermination=()=>{this.emit('exit',0);resolve(0);};}); }
    answer(chart={status:'FORMING',bars:[{close:100}],availableAt:'2026-08-12T01:00:00Z'}) {
      const message=this.posts.at(-1);this.emit('message',{id:message.id,chart:{...chart,timeframe:message.selection.timeframe}});
    }
  }
  const service=createTxChartService({dataRoot:'synthetic-root',calendar:{},workerFactory:(...args)=>new FakeWorker(...args),clock:()=>now,...options});
  return {service,workers,setNow(value){now=value;}};
}
test('peek has no worker or source IO; worker receives explicit empty env and execArgv; identical loads coalesce',async()=>{
  const h=harness();
  try {
    assert.equal(h.service.peek().reason,'CHART_NOT_READY'); assert.equal(h.workers.length,0);
    const first=h.service.load({timeframe:'1D',extraSecret:'never-forwarded'}),second=h.service.load({timeframe:'1D'});
    assert.equal(first,second);assert.equal(h.workers.length,1);
    const w=h.workers[0];assert.deepEqual(w.settings.env,{});assert.deepEqual(w.settings.execArgv,[]);
    assert.deepEqual(Object.keys(w.settings.workerData).sort(),['cacheRoot','calendar','dataRoot','sourceLimits']);
    assert.equal(Object.hasOwn(w.posts[0].selection,'extraSecret'),false);
    w.answer();assert.equal((await first).bars[0].close,100);
    h.setNow(12000);assert.equal(h.service.peek({timeframe:'1D'}).reason,'CHART_SNAPSHOT_STALE');
    assert.equal(h.service.peek({timeframe:'1D'}).status,'UNAVAILABLE');assert.equal(h.workers.length,1);
    const renewed=h.service.load({timeframe:'1D'});assert.equal(w.posts.length,2);
    assert.equal(w.posts[1].selection.asOf,null,'LIVE request must not freeze a computed cutoff');w.answer();await renewed;
  } finally {h.service.close();h.workers.at(-1)?.finishTermination?.();}
});
test('one active worker plus one queued selection; overflow is immediate and all refusal responses keep safety boundaries',async()=>{
  const h=harness();
  try {
    const daily=h.service.load({timeframe:'1D'}),five=h.service.load();
    const busy=await h.service.load({timeframe:'1m'});assert.equal(busy.reason,'CHART_REQUEST_BUSY');
    assert.equal(busy.formalWeight,0);assert.equal(busy.researchOnly,true);assert.equal(busy.executionAuthorized,false);assert.equal(busy.orderRoutesEnabled,false);
    assert.equal(h.workers[0].posts.length,1);h.workers[0].answer();await daily;
    assert.equal(h.workers[0].posts.length,2);h.workers[0].answer();await five;assert.equal(h.workers.length,1);
  } finally {h.service.close();h.workers.at(-1)?.finishTermination?.();}
});
test('deadline settles active and queued work; delayed termination refuses replacement until actual exit',async()=>{
  const h=harness({requestTimeoutMs:25});
  try {
    const first=h.service.load({timeframe:'1D'}),queued=h.service.load();
    assert.equal((await first).reason,'CHART_REQUEST_TIMEOUT');assert.equal((await queued).reason,'CHART_REQUEST_TIMEOUT');
    assert.equal(h.workers[0].terminations,1);
    assert.equal((await h.service.load()).reason,'CHART_WORKER_RESTARTING');assert.equal(h.workers.length,1);
    h.workers[0].finishTermination();await Promise.resolve();
    const recovered=h.service.load();assert.equal(h.workers.length,2);h.workers[1].answer();assert.equal((await recovered).bars.length,1);
  } finally {h.service.close();h.workers.at(-1)?.finishTermination?.();}
});
test('idle and close terminate only the owned worker; invalid selection never starts work',async()=>{
  const h=harness({idleTimeoutMs:10});
  assert.equal((await h.service.load({timeframe:'invalid'})).reason,'CHART_SELECTION_INVALID');assert.equal(h.workers.length,0);
  const first=h.service.load();h.workers[0].answer();await first;
  await new Promise(resolve=>setTimeout(resolve,25));assert.equal(h.workers[0].terminations,1);
  h.workers[0].finishTermination();await Promise.resolve();
  const pending=h.service.load({timeframe:'1m'});h.service.close();assert.equal((await pending).reason,'CHART_SERVICE_CLOSED');
  assert.equal((await h.service.load()).reason,'CHART_SERVICE_CLOSED');h.workers.at(-1).finishTermination();
});

test('explicit unfinished chart or observation is not replayed from completed-result TTL cache',async()=>{
  for(const pending of [{sourceAuditProgress:{state:'PENDING'}},{sourceReadState:'CATCHUP_PENDING'},
    {marketObservation:{reasonCodes:['DERIVATION_CATCHUP_PENDING']}},{reasonCodes:['DERIVED_HISTORY_VERIFYING']}]){
    const h=harness();try{
      const first=h.service.load({capture:true});const worker=h.workers[0];worker.answer({...pending,status:'QUALITY_INSUFFICIENT',bars:[]});await first;
      const next=h.service.load({capture:true});assert.equal(worker.posts.length,2,'pending continuation must reach the worker even within cache TTL');
      worker.answer({status:'READY',bars:[{close:100}]});await next;
      await h.service.load({capture:true});assert.equal(worker.posts.length,2,'completed result still uses normal bounded TTL');
    }finally{h.service.close();h.workers.at(-1)?.finishTermination?.();}
  }
});

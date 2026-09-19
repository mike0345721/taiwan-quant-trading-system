import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createCvdCandidateServer } from '../src/cvd-candidate-server.mjs';
import { FRAMES } from '../src/cvd-chart-projection.mjs';
import { handoffFixture,calendar } from './cvd-handoff-fixture.mjs';
import { buildSessionContext,buildSessionContextHandoff } from '../src/cvd-session-context-projection.mjs';
test('Phase D memory-only authenticated API serves matched six-frame evidence and retains A/B/C routes',async()=>{
  const prior=handoffFixture({start:'2026-09-12T04:56:00+08:00',price:100}),current=handoffFixture();
  const sessionContext=buildSessionContext(current.g,current,current.events,calendar),priorContext=buildSessionContext(prior.g,prior,prior.events,calendar);
  const handoffs=Object.fromEntries(FRAMES.map(f=>[f,buildSessionContextHandoff(prior,current,prior.events,current.events,calendar,priorContext,sessionContext,f)]));
  const {server,token}=createCvdCandidateServer({frames:current.charts,relationships:current.relationships,handoffs,sessionContext,assets:{},head:'test-exact-head',port:0});
  await new Promise(resolve=>server.listen({host:'127.0.0.1',port:0},resolve));const base='http://127.0.0.1:'+server.address().port;
  const open=fs.openSync,read=fs.readFileSync;fs.openSync=fs.readFileSync=()=>{throw Error('REQUEST_FILESYSTEM_FORBIDDEN');};
  try {
    assert.equal((await fetch(base+'/api/handoff')).status,401);
    const auth=await fetch(base+'/session',{method:'POST',headers:{Origin:base,'Content-Type':'text/plain'},body:token});
    const headers={cookie:auth.headers.get('set-cookie').split(';')[0]};
    assert.equal((await fetch(base+'/api/session-context?timeframe=4h',{headers})).status,400);
    const context=await (await fetch(base+'/api/session-context',{headers})).json();assert.equal(context.scope,'OBSERVED_SEGMENT_TO_NOW');assert.equal(context.rawReadsPerRequest,0);assert.equal(context.cumulativeCvd,19);
    for(const f of FRAMES){
      const h=await (await fetch(base+'/api/handoff?timeframe='+f,{headers})).json();assert.equal(h.head,'test-exact-head');assert.equal(h.previewType,'ISOLATED_SESSION_CONTEXT');assert.equal(h.rawReadsPerRequest,0);
      assert.deepEqual(h.current.evidence,sessionContext.evidence);assert.equal(h.gap.points,2);assert.equal(h.timeframe,f);
      for(const route of ['cvd','relationship'])assert.equal((await fetch(base+'/api/'+route+'?timeframe='+f,{headers})).status,200);
    }
    for(const query of ['path=raw','timeframe=1D','timeframe=1m&timeframe=5m'])assert.equal((await fetch(base+'/api/handoff?'+query,{headers})).status,400);
    assert.equal((await fetch(base+'/api/handoff',{headers:{...headers,Origin:'https://invalid.example'}})).status,403);
    assert.equal((await fetch(base+'/api/handoff',{headers,method:'POST'})).status,405);
    sessionContext.semanticHash='changed';assert.equal((await fetch(base+'/api/session-context',{headers})).status,503);
    handoffs['1m'].semanticHash='changed';assert.equal((await fetch(base+'/api/handoff',{headers})).status,503);
  }finally{fs.openSync=open;fs.readFileSync=read;await new Promise(resolve=>server.close(resolve));}
});

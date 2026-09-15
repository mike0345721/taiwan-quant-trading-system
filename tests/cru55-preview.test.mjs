import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPreviewServer} from '../src/cru55-preview-server.mjs';
import {validateView,boundedRead} from '../src/cru55-preview-bundle.mjs';
import {sessionFixture,calendar} from './cvd-session-context-fixture.mjs';
import {buildSessionContext,buildSessionContextHandoff} from '../src/cvd-session-context-projection.mjs';
import {windowPresentation,cvdChunks,deltaChunks,FLOW,FRAMES} from '../public/cru55-presentation.mjs';
const fixture=sessionFixture();
const sessionContext=buildSessionContext(fixture.g,fixture,fixture.events,calendar);
const handoffs=Object.fromEntries(FRAMES.map(f=>[f,buildSessionContextHandoff(null,fixture,[],fixture.events,calendar,null,sessionContext,f)]));
const view={...fixture,sessionContext,handoffs,kind:'SYNTHETIC_FIXTURE'};
test('source kind, exact cutoff, timeframe endpoint and frozen safety fail closed',()=>{
  validateView(view);
  assert.throws(()=>validateView({...view,kind:'GOVERNED_FRAGMENT'}),/SOURCE_KIND/);
  for(const change of [v=>v.sessionContext.evidenceKind='GOVERNED_FRAGMENT',v=>v.relationships['4h'].evidenceKind='GOVERNED_FRAGMENT',v=>v.charts['5m'].currentCvd=99,v=>v.handoffs['15m'].sourceCutoff.recordHash='wrong',v=>v.sessionContext.executionAuthorized=true]){const v=structuredClone(view);change(v);assert.throws(()=>validateView(v));}
});
test('bounded reader rejects over-budget before reading bytes and rejects hardlinks',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'cru55-budget-')),file=path.join(dir,'fixture');
  fs.writeFileSync(file,'12345');const original=fs.readSync;let calls=0;fs.readSync=(...args)=>{calls++;return original(...args);};
  try{assert.throws(()=>boundedRead(file,4),/BUDGET/);assert.equal(calls,0);assert.equal(boundedRead(file,5).toString(),'12345');fs.linkSync(file,path.join(dir,'link'));assert.throws(()=>boundedRead(file,5),/BUDGET/);}finally{fs.readSync=original;fs.rmSync(dir,{recursive:true,force:true});}
});
test('one window presentation preserves partial/warming/unavailable and direction limitations',()=>{
  const row=(code,complete=true,delta=2,status='READY')=>({current:{relationship:{code},current:{complete,deltaCvd:delta,quality:{status}}}});
  assert.equal(windowPresentation(row('ALIGNED')).tone,'positive');assert.equal(windowPresentation(row('ALIGNED',true,-2)).tone,'negative');
  assert.equal(windowPresentation(row('ALIGNED_BUT_WEAKENING')).tone,'warning');
  assert.deepEqual([windowPresentation(row('ALIGNED',false)).state,windowPresentation(row('ALIGNED',false)).tone],['PARTIAL','neutral']);
  assert.equal(windowPresentation(row('ALIGNED',true,2,'WARMING_UP')).state,'WARMING');assert.equal(windowPresentation(null).state,'UNAVAILABLE');
  assert.equal(windowPresentation(row('MIXED_OR_QUALITY_LIMITED')).tone,'neutral');
});
test('CVD breaks nulls and segment resets; delta retains signed rolling values and null whitespace',()=>{
  const p={segments:[{index:0,points:[{time:1,value:5},{time:2,value:null},{time:3,value:8}]},{index:1,points:[{time:4,value:-3}]}]};
  assert.deepEqual(cvdChunks(p).map(c=>c.data.map(x=>x.value)),[[5],[8],[-3]]);
  const r={observations:[{segment:0,lineage:{availableAtMs:1000},deltaCvd:4,complete:false},{segment:0,lineage:{availableAtMs:2000},deltaCvd:-2},{segment:0,lineage:{availableAtMs:3000},deltaCvd:null}]};
  const d=deltaChunks(p,r)[0].data;assert.equal(d[0].color,FLOW.positive);assert.equal(d[1].color,FLOW.negative);assert.deepEqual(d[2],{time:3});
});
test('isolated authenticated API is memory-only and returns one exact scan/evidence source',async()=>{
  const {server,token}=createPreviewServer({bundle:{views:{day:view,night:view,demo:view},lower:{asOfDate:'test'},acceptedHead:'accepted',approvedMain:'main'},assets:{'/':{body:'preview',type:'text/html'}},head:'test',port:0});
  await new Promise(r=>server.listen({port:0,host:'127.0.0.1'},r));const base=`http://127.0.0.1:${server.address().port}`;
  const saved={read:fs.readFileSync,open:fs.openSync};fs.readFileSync=fs.openSync=()=>{throw Error('REQUEST_READ_FORBIDDEN');};
  try{
    assert.equal((await fetch(base+'/api/preview')).status,401);
    const auth=await fetch(base+'/session',{method:'POST',headers:{Origin:base,'Content-Type':'text/plain'},body:token});assert.equal(auth.status,200);assert.match(auth.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
    const headers={Cookie:auth.headers.get('set-cookie').split(';')[0]};
    for(const f of FRAMES){const res=await fetch(`${base}/api/preview?view=demo&timeframe=${f}`,{headers});assert.equal(res.status,200);const body=await res.json();assert.equal(body.chart.currentCvd,19);assert.deepEqual(body.scan[f].current,body.relationship.current);assert.equal(body.context.scope,'OBSERVED_SEGMENT_TO_NOW');assert.equal(body.rawReadsPerRequest,0);assert.notEqual(body.chart.freshness.state,'LIVE');}
    for(const q of ['view=bad','path=raw','timeframe=1d','view=day&view=demo'])assert.equal((await fetch(base+'/api/preview?'+q,{headers})).status,400);
    assert.equal((await fetch(base+'/api/preview',{headers:{...headers,Origin:'https://bad.example'}})).status,403);
    assert.equal((await fetch(base+'/api/preview',{headers,method:'POST'})).status,405);
    assert.equal((await fetch(base+'/api/order',{headers})).status,404);
    assert.equal((await fetch(base+'/api/lower',{headers})).status,200);
  }finally{fs.readFileSync=saved.read;fs.openSync=saved.open;await new Promise(r=>server.close(r));}
});

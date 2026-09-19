import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createPreviewServer} from '../src/cru55-preview-server.mjs';
import {validateView,boundedRead} from '../src/cru55-preview-bundle.mjs';
import {sessionFixture,calendar} from './cvd-session-context-fixture.mjs';
import {buildSessionContext,buildSessionContextHandoff} from '../src/cvd-session-context-projection.mjs';
import {windowPresentation,cvdChunks,deltaChunks,FLOW,FRAMES,timelineTime,scopeLabel,pressureCells,evidenceDirection,observedPricePercent,relationshipExplanation,contextSummary} from '../public/cru55-presentation.mjs';
const fixture=sessionFixture();
const sessionContext=buildSessionContext(fixture.g,fixture,fixture.events,calendar);
const handoffs=Object.fromEntries(FRAMES.map(f=>[f,buildSessionContextHandoff(null,fixture,[],fixture.events,calendar,null,sessionContext,f)]));
const view={...fixture,sessionContext,handoffs,kind:'SYNTHETIC_FIXTURE'};
test('timeline reads accepted availableAt lineage and missing stays unknown',()=>{
  assert.equal(timelineTime({lineage:{availableAtMs:1789353900001},time:1}),1789353900001);
  assert.equal(timelineTime({lineage:{availableAtMs:null},time:1}),null);
});
test('handoff scope distinguishes unavailable identity from observed accumulation',()=>{
  assert.equal(scopeLabel('SESSION_TO_NOW'),'本盤累積');assert.equal(scopeLabel('OBSERVED_SEGMENT_TO_NOW'),'觀測累積');
  assert.equal(scopeLabel('UNAVAILABLE'),'UNAVAILABLE');assert.equal(scopeLabel(null),'UNAVAILABLE');
});
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
  assert.equal(windowPresentation(row('ALIGNED')).tone,'positive');assert.equal(windowPresentation(row('ALIGNED',true,-2)).tone,'positive');
  assert.equal(windowPresentation(row('ALIGNED',true,0)).tone,'positive');
  assert.equal(windowPresentation(row('OPPOSITE_DIVERGENCE')).tone,'negative');
  assert.equal(windowPresentation(row('PRESSURE_RESPONSE_MISMATCH')).tone,'warning');
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

test('restored force cells reuse original boundaries and never infer incomplete window direction',()=>{
  for(const [ratio,cells] of [[0,0],[.099,0],[.1,1],[.324,1],[.325,2],[.549,2],[.55,3],[.774,3],[.775,4],[1,4]]){
    assert.equal(pressureCells(ratio).cells,cells);assert.equal(pressureCells(-ratio).cells,cells);
  }
  for(const bad of [null,undefined,NaN,Infinity,1.01,-1.01])assert.deepEqual(pressureCells(bad),{cells:0,direction:'neutral'});
  for(const state of ['PARTIAL','WARMING','UNAVAILABLE'])for(const value of [-1,0,1]){
    assert.deepEqual(pressureCells(value,state),{cells:0,direction:'neutral'});assert.deepEqual(evidenceDirection(value,state),{symbol:'—',direction:'neutral'});
  }
  assert.deepEqual(evidenceDirection(null,'AVAILABLE'),{symbol:'—',direction:'neutral'});
  assert.deepEqual(evidenceDirection(-2,'AVAILABLE'),{symbol:'▼',direction:'negative'});
  assert.deepEqual(evidenceDirection(2,'AVAILABLE'),{symbol:'▲',direction:'positive'});
  assert.deepEqual(evidenceDirection(0,'AVAILABLE'),{symbol:'＝',direction:'neutral'});
});

test('observed percent uses accepted first price and never backfills missing price with response',()=>{
  const c={firstPrice:{price:42003},lastPrice:{price:42103},evidence:{priceDelta:100,response:{displacementPoints:100}}};
  assert.equal(observedPricePercent(c),100/42003*100);
  for(const change of [x=>x.firstPrice=null,x=>x.lastPrice=null,x=>x.evidence.priceDelta=null,x=>x.firstPrice.price=0,x=>x.firstPrice.price=-1]){const x=structuredClone(c);change(x);assert.equal(observedPricePercent(x),null);}
  const x=structuredClone(c);x.evidence.priceDelta=-100;assert.ok(observedPricePercent(x)<0);
});
test('context explanatory copy describes accepted evidence and preserves fragment/stale/unknown truth',()=>{
  assert.match(relationshipExplanation('MIXED_OR_QUALITY_LIMITED'),/不足/);assert.match(relationshipExplanation('UNAVAILABLE'),/缺少/);
  assert.match(contextSummary({evidence:{},relationship:{code:'ALIGNED'},cumulativeCvd:12,sessionStartProven:false,freshness:{state:'STALE'}}),/買方主動成交累積較多；僅觀測片段。STALE/);
  assert.match(contextSummary({evidence:{},relationship:{code:'ALIGNED'},cumulativeCvd:null,sessionStartProven:false,freshness:{state:'UNAVAILABLE'}}),/未知/);
  assert.match(contextSummary(null),/不可用/);
});

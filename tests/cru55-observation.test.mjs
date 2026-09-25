import test from 'node:test';
import assert from 'node:assert/strict';
import {observationV1,renderObservation} from '../public/cru55-observation.mjs';
import {sessionFixture,calendar} from './cvd-session-context-fixture.mjs';
import {buildSessionContext} from '../src/cvd-session-context-projection.mjs';
import {FRAMES} from '../public/cru55-presentation.mjs';
const f=sessionFixture(),context=buildSessionContext(f.g,f,f.events,calendar);
const payload=frame=>({kind:'SYNTHETIC_FIXTURE',chart:{...f.charts[frame],freshness:{state:'HISTORICAL'}},context,
  relationship:f.relationships[frame],scan:Object.fromEntries(FRAMES.map(k=>[k,{current:f.relationships[k].current}]))});
const source=Date.parse(f.relationships['1m'].current.anchorEventTime);
test('10s/30s boundaries age accepted source time, not retrieval or publication time',()=>{
  const d=payload('1m');
  for(const [age,state]of [[10000,'HISTORICAL'],[10001,'DEGRADED'],[30000,'DEGRADED'],[30001,'DELAYED'],[60000,'DELAYED'],[100000,'STALE']])
    assert.equal(observationV1(d,'1m',source+age).state,state,age);
  d.chart.availableAt=new Date(source+99999).toISOString();
  assert.equal(observationV1(d,'1m',source+100000).state,'STALE');
  assert.equal(observationV1(d,'1m',source+100000).observationAgeMs,100000);
});
test('pinned, synthetic, quality and upstream states cannot be promoted to LIVE',()=>{
  const d=payload('1m');d.kind='GOVERNED_FRAGMENT';d.chart.freshness.state='LIVE';d.chart.quality='READY';d.context=structuredClone(context);d.context.evidence.quality.status='READY';
  assert.equal(observationV1(d,'1m',source+1000).state,'HISTORICAL');
  d.chart.sourceMode='CONTINUOUS_VERIFIED';
  assert.equal(observationV1(d,'1m',source+1000).state,'LIVE');
  d.context.evidence.quality.status='QUALITY_INSUFFICIENT';assert.notEqual(observationV1(d,'1m',source+1000).state,'LIVE');
  d.chart.freshness.state='STALE';assert.equal(observationV1(d,'1m',source+1000).state,'STALE');
  d.chart.freshness.state='UNAVAILABLE';assert.equal(observationV1(d,'1m',source+1000).state,'UNAVAILABLE');
});
test('missing values, invalid/future clocks, unknown continuity and zero remain distinct',()=>{
  assert.equal(observationV1(null,'1m').cumulativeCvd,null);
  for(const change of [d=>d.chart.lastTradeAvailableAt=null,d=>d.relationship.current.anchorEventTime=null,d=>d.context.cumulativeCvd=null,d=>d.context.scope='UNAVAILABLE']){
    const d=structuredClone(payload('1m'));change(d);assert.equal(observationV1(d,'1m',source+1000).state,'UNAVAILABLE');
  }
  assert.equal(observationV1(payload('1m'),'1m',source-1).state,'UNAVAILABLE');
  const d=structuredClone(payload('1m'));d.context.cumulativeCvd=0;delete d.chart.continuityEpoch;
  const m=observationV1(d,'1m',source+1000);assert.equal(m.cumulativeCvd,0);assert.equal(m.continuityEpoch,'UNKNOWN');
});
test('six selected windows retain exact accepted values and partial relationship states',()=>{
  for(const frame of FRAMES){const d=payload(frame),m=observationV1(d,frame,source+100000);
    assert.equal(m.cumulativeCvd,context.cumulativeCvd);assert.equal(m.deltaCvd,d.relationship.current.current.deltaCvd);
    assert.equal(m.window.code,d.relationship.current.relationship.code);assert.equal(m.sourceTime,source);
    assert.equal(m.cutoff,d.chart.cutoff.ledgerOrdinal);assert.equal(m.origin,context.origin.eventTimeMs);
  }
  assert.equal(observationV1(payload('4h'),'4h',source+100000).window.state,'PARTIAL');
});
test('real renderer exposes fields, ages the same payload and clears prior values on failure',()=>{
  const doc={createElement:()=>({children:[],textContent:'',append(...xs){this.children.push(...xs);}})};
  const host={ownerDocument:doc,dataset:{},replaceChildren(...xs){this.children=xs;}};
  const texts=()=>host.children.map(x=>x.children.map(y=>y.textContent).join(':')).join('\n');
  const d=payload('1m');renderObservation(host,d,'1m',source+10000);assert.equal(host.dataset.state,'HISTORICAL');
  renderObservation(host,d,'1m',source+100000);assert.equal(host.dataset.state,'STALE');
  for(const field of ['1m ΔCVD','實際契約','累積起點','發布截止','來源時間','分類覆蓋率','連續性','主動成交壓力','觀測資料年齡','本次處理延遲','狀態說明'])assert.ok(texts().includes(field),field);
  renderObservation(host,null,'4h',source+100000);assert.equal(host.dataset.state,'UNAVAILABLE');assert.match(texts(),/4h ΔCVD:不可用/);assert.doesNotMatch(texts(),/TXFI6/);
});

test('unavailable reasons distinguish missing, future and reversed trade clocks in Chinese',async()=>{
  const {observationReasonLabel}=await import('../public/cru55-observation.mjs');
  for(const [change,code]of [
    [d=>d.chart.lastTradeAvailableAt=null,'TRADE_CLOCK_MISSING'],
    [d=>d.relationship.current.anchorEventTime='invalid','TRADE_CLOCK_MISSING'],
    [d=>d.chart.lastTradeAvailableAt=new Date(source+2000).toISOString(),'TRADE_CLOCK_IN_FUTURE'],
    [d=>d.chart.lastTradeAvailableAt=new Date(source-1).toISOString(),'TRADE_CLOCK_ORDER_INVALID'],
    [d=>d.context.cumulativeCvd=null,'CVD_EVIDENCE_UNAVAILABLE']]){
    const d=structuredClone(payload('1m'));change(d);const m=observationV1(d,'1m',source+1000);
    assert.equal(m.reason,code);assert.equal(m.state,'UNAVAILABLE');assert.match(observationReasonLabel(code),/[\u4e00-\u9fff]/);
    const doc={createElement:()=>({children:[],append(...xs){this.children.push(...xs);}})},host={ownerDocument:doc,dataset:{},replaceChildren(...xs){this.children=xs;}};
    renderObservation(host,d,'1m',source+1000);
    const row=host.children.find(x=>x.children[0].textContent==='狀態說明');assert.equal(row.children[1].textContent,observationReasonLabel(code));assert.equal(row.children[1].title,code);
  }
});

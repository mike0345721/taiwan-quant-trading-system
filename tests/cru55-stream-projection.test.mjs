import test from 'node:test';
import assert from 'node:assert/strict';
import {createStreamCheckpoint,appendStreamRecord} from '../src/cru55-stream-core.mjs';
import {createProjectionJob,consumeProjectionPage,finishProjectionJob,PROJECTION_LIMITS} from '../src/cru55-stream-projection.mjs';
import {digest,stableJson,SAFETY,createCvdCheckpoint,appendCvdRecords,cvdSemanticResult} from '../src/cvd-observation-core.mjs';
import {evaluateBestQuoteEligibility,materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {buildCvdChartProjection} from '../src/cvd-chart-projection.mjs';
import {buildCvdRelationshipProjection} from '../src/cvd-relationship-projection.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {classifyTxChartSession,buildOneMinuteBars,aggregateChartBars} from '../src/dashboard-tx-chart.mjs';
import {buildSessionContext} from '../src/cvd-session-context-projection.mjs';
import {sessionFixture,calendar} from './cvd-session-context-fixture.mjs';
const resolver=t=>{const s=classifyTxChartSession(t,calendar);return {session:s.session,tradeDate:s.tradeDate};};
function pagesFor(rows,source='sha256:'+digest('2026-09-14T09:00:00+08:00')){
  let checkpoint=createStreamCheckpoint(source,'governed-fixture'),head=null;const pages=[],quotes=[];
  for(let start=0;start<rows.length;start+=128){const records=rows.slice(start,start+128),previousTerminalHash=checkpoint.state.terminalHash,facts=[];
    for(const r of records){const x=appendStreamRecord(checkpoint,r,{resolveSessionTradeDate:resolver,lookupQuote:(e,{afterOrdinal})=>quotes.findLast(q=>q.ledgerOrdinal>afterOrdinal&&evaluateBestQuoteEligibility(q,e).eligible)??null});checkpoint=x.checkpoint;if(x.event?.kind==='futures_bidask')quotes.push(x.event);facts.push({ordinal:checkpoint.state.ordinal,recordHash:r.recordHash,event:x.event,point:x.point,pressure:x.pressure,segmentStarted:x.segmentStarted,segment:x.point?checkpoint.state.activeSegment:null});}
    const page={schemaVersion:'cru55-stream-page-v1',sourceLedgerIdentity:source,resolverIdentity:'governed-fixture',previousPageHash:head,previousQuotePageHash:null,previousTerminalHash,startOrdinal:start+1,endOrdinal:start+records.length,quoteCount:0,records,facts,checkpoint,...SAFETY};pages.push(page);head=digest(stableJson(page));
  }return {checkpoint,pages};
}
function run(rows,source){const archive=pagesFor(rows,source);let job=createProjectionJob({checkpoint:archive.checkpoint,sourceKind:'SYNTHETIC_FIXTURE',generationHash:digest('generation'),calendar});for(const p of archive.pages)job=consumeProjectionPage(JSON.parse(JSON.stringify(job)),p);return {...archive,job,result:finishProjectionJob(job)};}
test('six current and previous windows and observed context equal frozen oracle below old limit',()=>{
  for(const tickType of [1,0]){const f=sessionFixture({count:95,tickType}),{result}=run(f.rows);
    for(const frame of Object.keys(result.charts)){assert.deepEqual(result.relationships[frame].current.current,f.relationships[frame].current.current,frame);assert.deepEqual(result.relationships[frame].current.previous,f.relationships[frame].current.previous,frame);assert.deepEqual(result.relationships[frame].current.relationship,f.relationships[frame].current.relationship);}
    const frozen=buildSessionContext(f.g,{charts:f.charts,relationships:f.relationships},f.events,calendar);assert.deepEqual(result.sessionContext.evidence,frozen.evidence);assert.equal(result.sessionContext.scope,frozen.scope);
  }
});
function chain(rows){let previous='GENESIS';return rows.map(r=>{const {recordHash:_,previousHash:__,...data}=r;const body={...data,previousHash:previous};const row={...body,recordHash:digest(`${previous}\n${stableJson(body)}`)};previous=row.recordHash;return row;});}
function oracle(rows,frame){const sourceLedgerIdentity='sha256:'+digest('2026-09-14T09:00:00+08:00'),resolverIdentity='governed-fixture';const cp=appendCvdRecords(createCvdCheckpoint(sourceLedgerIdentity,resolverIdentity),rows,{sourceLedgerIdentity,resolverIdentity,resolveSessionTradeDate:resolver,ledgerOrdinalOffset:0});const g={generationHash:digest('generation'),result:cvdSemanticResult(cp),prefixSha256:digest('prefix'),sourceBinding:{path:'/test/data/cru54-private/fixtures/test.ndjson'}};const events=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity,resolveSessionTradeDate:resolver}).events;const chart=buildCvdChartProjection(g,{generationHash:g.generationHash,cutoffRecordHash:g.result.semantic.cutoffRecordHash,bars:[],reason:'TEST',timeLineageViolationCount:0},frame);return buildCvdRelationshipProjection(g,events,chart,frame);}
test('late physical predecessor, quote cross-check, long gap and unknown remain equal to accepted windows',()=>{
  const base=sessionFixture({count:19}).rows;
  const quote={...base[0],kind:'futures_bidask',payload:{...base[0].payload,bid_price:[119],ask_price:[120]}};
  const late={...base[18],payload:{...base[18].payload,eventTime:base[15].payload.eventTime,datetime:base[15].payload.datetime}};
  for(const rows of [chain([quote,...base]),chain([...base.slice(0,18),late]),chain([base[0],...base.slice(8)])]){
    const {result}=run(rows);for(const frame of Object.keys(result.charts)){const expected=oracle(rows,frame);assert.deepEqual(result.relationships[frame].current.current,expected.current.current);assert.deepEqual(result.relationships[frame].current.previous,expected.current.previous);}
  }
});
test('lawful quote and unrelated tails retain accepted last-trade CVD, windows and context clocks',()=>{
  const f=sessionFixture({count:19}),base=f.rows,last=base.at(-1),stamp=new Date(Date.parse(last.receivedAt)+10000).toISOString();
  const quote={...last,receivedAt:stamp,kind:'futures_bidask',payload:{...last.payload,eventTime:stamp,bid_price:[119],ask_price:[120]}};
  const unrelated={...last,receivedAt:stamp,kind:'stock_tick',payload:{}};
  const context=buildSessionContext(f.g,{charts:f.charts,relationships:f.relationships},f.events,calendar);
  for(const tail of [quote,unrelated]){const rows=chain([...base,tail]),result=run(rows).result;
    assert.equal(result.charts['1m'].currentCvd,19);assert.equal(result.charts['1m'].availableAt,stamp);assert.equal(result.charts['1m'].lastTradeAvailableAt,last.receivedAt);assert.equal(result.charts['1m'].cutoff.ledgerOrdinal,20);assert.equal(result.charts['1m'].display.boundaryAtCutoff,false);
    assert.deepEqual(result.sessionContext.evidence,context.evidence);assert.deepEqual(result.sessionContext.cutoff,context.cutoff);
    for(const frame of Object.keys(result.charts)){const expected=oracle(rows,frame);assert.deepEqual(result.relationships[frame].current.current,expected.current.current);assert.deepEqual(result.relationships[frame].current.previous,expected.current.previous);}
  }
});
test('real terminal boundaries, multiple segments and invalid price clocks preserve refusal',()=>{
  const base=sessionFixture({count:19}).rows;
  const tail={...base.at(-1),kind:'futures_bidask',payload:{...base.at(-1).payload,bid_price:[119],ask_price:[120]}};
  for(const row of [{...tail,payload:{...tail.payload,actualContract:'TXFJ6'}},{...tail,kind:'quote_type_resubscribe',payload:{product:'TX'}},{...tail,kind:'stock_tick',receivedAt:'2026-09-14T01:00:00.000Z',payload:{}}]){const result=run(chain([...base,row])).result;assert.equal(result.relationships['1m'].current.current,null);assert.equal(result.sessionContext.scope,'UNAVAILABLE');assert.equal(result.charts['1m'].currentCvd,null);}
  const breakRow={...base[8],kind:'quote_type_resubscribe',payload:{product:'TX'}};
  const segmented=run(chain([...base.slice(0,8),breakRow,...base.slice(8)])).result;assert.equal(segmented.sessionContext.reason,'CONTEXT_SINGLE_SEGMENT_REQUIRED');assert.equal(segmented.charts['1m'].currentCvd,11);assert.equal(segmented.handoffs['1m'].pairing.state,'NOT_COMPARABLE');
  const prices=buildOneMinuteBars(base,{calendar,asOf:base.at(-1).receivedAt});assert.equal(segmented.charts['1m'].bars.reduce((n,b)=>n+b.volume,0),19);assert.deepEqual(segmented.charts['1m'].bars.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]),prices.bars.map(b=>[Date.parse(b.time)/1000,b.open,b.high,b.low,b.close,b.volume]));
  const badClock=run(sessionFixture({count:19,badPrice:true}).rows).result;assert.equal(badClock.charts['1m'].bars.length,0);assert.equal(badClock.sessionContext.evidence.priceDelta,null);assert.equal(badClock.charts['1m'].priceTimeLineageViolationCount,19);
});
test('more than 1024 points use restartable bounded page reducer with price and VWAP',()=>{
  let previousHash='GENESIS';const origin=Date.parse('2026-09-14T09:00:00+08:00');
  const rows=Array.from({length:1400},(_,i)=>{const time=new Date(origin+i*1000).toISOString();const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(origin+i*1000+1).toISOString(),...SAFETY,payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',tradeDate:'2026-09-14',session:'DAY',eventTime:time,datetime:time,close:100+i%11,volume:1,tick_type:1}},previousHash);previousHash=row.recordHash;return row;});
  const {result,job,pages,checkpoint}=run(rows);assert.equal(result.charts['1m'].currentCvd,1400);assert.equal(result.charts['1m'].display.inputPoints,1400);assert.ok(result.charts['1m'].segments[0].points.length<=1024);assert.equal(result.relationships['1m'].current.current.deltaCvd,60);assert.equal(result.sessionContext.cumulativeCvd,1400);assert.equal(result.sessionContext.evidence.observedVolume,1400);assert.ok(result.charts['1m'].bars.length>0);assert.ok(result.charts['1m'].vwap.every(p=>Number.isFinite(p.value)));assert.ok(Buffer.byteLength(JSON.stringify(job))<PROJECTION_LIMITS.jobBytes);assert.equal(result.semanticHash,undefined);
  const empty=createProjectionJob({checkpoint,sourceKind:'SYNTHETIC_FIXTURE',generationHash:digest('generation'),calendar});assert.throws(()=>finishProjectionJob(empty),/INCOMPLETE/);assert.throws(()=>consumeProjectionPage(empty,pages[1]),/BINDING/);const changed=structuredClone(pages[0]);changed.records[0].payload.close=999;assert.throws(()=>consumeProjectionPage(empty,changed),/RECORD_INVALID/);
});
test('late legal price bars preserve clock-sorted OHLC and exact observed VWAP',()=>{
  const base=sessionFixture({count:19}).rows;
  const late={...base.at(-1),payload:{...base.at(-1).payload,eventTime:base[2].payload.eventTime,datetime:base[2].payload.datetime,close:115,volume:3}};
  const rows=chain([...base,late]),{result}=run(rows);
  const normalized=buildOneMinuteBars(rows,{calendar,asOf:rows.at(-1).receivedAt});
  for(const frame of Object.keys(result.charts)){
    const expected=aggregateChartBars(normalized.internalBars,frame).bars;
    assert.deepEqual(result.charts[frame].bars.map(b=>[b.time,b.open,b.high,b.low,b.close,b.volume]),expected.map(b=>[Date.parse(b.time)/1000,b.open,b.high,b.low,b.close,b.volume]));
  }
  const volume=normalized.ticks.reduce((n,t)=>n+t.volume,0),pv=normalized.ticks.reduce((n,t)=>n+t.price*t.volume,0);assert.equal(result.charts['1m'].vwap.at(-1).value,pv/volume);assert.equal(result.sessionContext.scope,'UNAVAILABLE');
  assert.equal(result.charts['1m'].segments[0].clockInvalid,false);assert.equal(result.charts['1m'].display.currentPlotAvailable,true);
  const regressed=chain([...base,{...base.at(-1),receivedAt:base[2].receivedAt}]),bad=run(regressed).result;
  assert.equal(bad.charts['1m'].segments[0].clockInvalid,true);assert.equal(bad.charts['1m'].segments[0].points.length,0);assert.equal(bad.charts['1m'].display.currentPlotAvailable,false);
});
test('governed prior handoff stays candidate-bound and refuses mixed evidence',()=>{
  const night=sessionFixture({start:'2026-09-12T04:00:00+08:00',count:19});const prior=run(night.rows,'sha256:'+digest('night')).result;
  const day=run(sessionFixture({count:19}).rows);
  const result=finishProjectionJob(day.job,{prior});assert.equal(result.handoffs['1m'].pairing.state,'COMPARABLE');assert.equal(result.handoffs['1m'].gap.state,'AVAILABLE');assert.equal(result.handoffs['1m'].gap.officialCloseProven,false);assert.notEqual(result.projectionHash,day.result.projectionHash);
  const previousPublication=run(sessionFixture({count:18}).rows).result;
  const separate=finishProjectionJob(day.job,{prior,previousPublication});assert.equal(separate.handoffs['1m'].pairing.state,'COMPARABLE');assert.deepEqual(separate.relationships['1m'].observations.map(o=>o.lineage.cutoffLedgerOrdinal),[18,19]);
  const mixed=structuredClone(prior);mixed.sessionContext.evidenceKind='GOVERNED_FRAGMENT';assert.equal(finishProjectionJob(day.job,{prior:mixed}).handoffs['1m'].pairing.reason,'REAL_SYNTHETIC_MIX_REFUSED');
});
test('delta display carries only bounded same-identity publication endpoints',()=>{
  const rows=sessionFixture({count:95}).rows,first=run(rows.slice(0,80)).result,last=run(rows);
  const carried=finishProjectionJob(last.job,{prior:first});assert.equal(carried.relationships['1m'].observations.length,2);assert.equal(carried.relationships['1m'].observations[0].lineage.cutoffLedgerOrdinal,80);assert.equal(carried.relationships['1m'].observations[1].lineage.cutoffLedgerOrdinal,95);assert.equal(carried.relationships['1m'].history.sampling,'PUBLICATION_ENDPOINT_NOT_PER_POINT_HISTORY');
  const foreign=structuredClone(first);foreign.relationships['1m'].sourceCutoff.sourceLedgerIdentity='sha256:'+digest('foreign');assert.equal(finishProjectionJob(last.job,{prior:foreign}).relationships['1m'].observations.length,1);
  const polluted=structuredClone(first);polluted.sessionContext.projectionHash=digest('wrong');assert.equal(finishProjectionJob(last.job,{prior:polluted}).handoffs['1m'].pairing.state,'NOT_COMPARABLE');
  const edited=structuredClone(last.job);edited.context.total=0;assert.throws(()=>finishProjectionJob(edited),/JOB_INVALID/);
});
test('nine-hour night stream exceeds snapshot limit with all twelve windows complete',t=>{
  const start='2026-09-11T15:00:00+08:00',template=sessionFixture({start,count:1}).rows[0],origin=Date.parse(start);
  const rows=chain(Array.from({length:1100},(_,i)=>{const eventTime=new Date(origin+i*30000).toISOString();return {...template,receivedAt:new Date(origin+i*30000+1).toISOString(),payload:{...template.payload,eventTime,datetime:eventTime,close:100+i%7,volume:1,tick_type:1}};}));
  const {result,job}=run(rows,'sha256:'+digest(start));assert.equal(result.sessionContext.cumulativeCvd,1100);
  for(const r of Object.values(result.relationships)){assert.equal(r.current.current.complete,true);assert.equal(r.current.previous.complete,true);assert.equal(r.current.current.parity,'EXACT');assert.equal(r.current.previous.parity,'EXACT');}
  assert.equal(result.relationships['4h'].current.current.deltaCvd,480);assert.equal(result.relationships['4h'].current.previous.deltaCvd,480);assert.equal(result.charts['1m'].bars.length,550);assert.ok(Buffer.byteLength(JSON.stringify(job))<PROJECTION_LIMITS.jobBytes);t.diagnostic(`persisted job bytes=${Buffer.byteLength(JSON.stringify(job))}; point count=1100; minute buckets=550; total scan pages=9`);
});

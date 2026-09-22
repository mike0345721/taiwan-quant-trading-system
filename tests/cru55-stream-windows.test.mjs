import test from 'node:test';
import assert from 'node:assert/strict';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {createCvdCheckpoint,appendCvdRecords,cvdSemanticResult,digest,stableJson,SAFETY} from '../src/cvd-observation-core.mjs';
import {createStreamCheckpoint,appendStreamRecord,streamCurrent} from '../src/cru55-stream-core.mjs';
import {projectGeneration} from '../src/cru55-dynamic-projection.mjs';
import {classifyTxChartSession} from '../src/dashboard-tx-chart.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
const resolver=t=>{const s=classifyTxChartSession(t,calendar);return {session:s.session,tradeDate:s.sessionTradeDate};};

test('eight-hour multi-bar oracle: six windows retain complete/partial, UNKNOWN and late-event semantics after restart',()=>{
  const source='sha256:'+digest('stream-window-oracle'),resolverIdentity='window-oracle-v1',origin=Date.parse('2026-09-14T15:00:00+08:00');
  for(const late of [false,true]){
    let previous='GENESIS';
    const rows=Array.from({length:961},(_,i)=>{
      const physical=origin+i*30000,event=physical-(late&&i===960?45000:0),stamp=new Date(event).toISOString();
      const row=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(physical+1).toISOString(),...SAFETY,
        payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',...resolver(stamp),eventTime:stamp,datetime:stamp,close:100+i%11,volume:1+i%5,tick_type:i%17===0?0:i%3===0?2:1}},previous);
      previous=row.recordHash;return row;
    });
    const frozen=appendCvdRecords(createCvdCheckpoint(source,resolverIdentity),rows,{sourceLedgerIdentity:source,resolverIdentity,ledgerOrdinalOffset:0,resolveSessionTradeDate:resolver});
    let checkpoint=createStreamCheckpoint(source,resolverIdentity);const points=[],segments=[];
    for(const row of rows){const next=appendStreamRecord(checkpoint,row,{resolveSessionTradeDate:resolver});checkpoint=next.checkpoint;if(next.point){points.push(next.point);segments[next.point.segment]=checkpoint.state.activeSegment;}if(checkpoint.state.ordinal%128===0)checkpoint=JSON.parse(JSON.stringify(checkpoint));}
    const result=cvdSemanticResult(frozen),s=result.semantic;
    assert.equal(streamCurrent(checkpoint).value,s.value);assert.deepEqual(points,s.series);assert.deepEqual(segments,s.segments);
    const rebuilt={...s,series:points,segments};assert.equal(digest(stableJson(rebuilt)),result.semanticHash);
    const g={generationHash:digest(stableJson(rows)),result,prefixSha256:digest('oracle'),sourceBinding:{path:'/fixtures/stream-window-oracle.ndjson'}};
    const expected=projectGeneration(g,rows,calendar).view,actual=projectGeneration({...g,result:{semantic:rebuilt,semanticHash:result.semanticHash}},rows,calendar).view;
    assert.deepEqual(actual,expected);assert.equal(Object.keys(actual.relationships).length,6);
    assert.ok(actual.charts['1m'].bars.length>100);
    assert.equal(checkpoint.state.activeSegment.startOrdinal,1);
    assert.ok(checkpoint.state.activeSegment.unknownVolume>0);
  }
});

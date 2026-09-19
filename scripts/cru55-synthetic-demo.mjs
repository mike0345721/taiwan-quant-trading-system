// Explicit synthetic UI data; processed exclusively through unchanged accepted functions.
import {createCvdCheckpoint,appendCvdRecords,cvdSemanticResult,SAFETY,digest,stableJson} from '../src/cvd-observation-core.mjs';
import {buildLiveEventRecord} from '../src/live-event-ledger.mjs';
import {materializeTxCanonicalObservations} from '../src/tx-intraday-pressure-path-efficiency.mjs';
import {loadGovernedTradingCalendar} from '../src/market-state-forward-shadow-calendar.mjs';
import {classifyTxChartSession,buildOneMinuteBars} from '../src/dashboard-tx-chart.mjs';
import {buildCvdChartProjection,FRAMES} from '../src/cvd-chart-projection.mjs';
import {buildCvdRelationshipProjection} from '../src/cvd-relationship-projection.mjs';
import {buildSessionContext,buildSessionContextHandoff} from '../src/cvd-session-context-projection.mjs';
export function buildDemo() {
  const calendar=loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
  const start=Date.parse('2026-09-14T08:45:00+08:00'), resolveSessionTradeDate=t=>{const s=classifyTxChartSession(t,calendar);return {session:s.session,tradeDate:s.tradeDate};};
  let hash='GENESIS';
  const rows=Array.from({length:721},(_,i)=>{
    const t=start+i*10000, stamp=new Date(t).toISOString();
    const trend=i<220?i*.19:i<400?42-(i-220)*.24:-1+(i-400)*.34;
    const close=42000+Math.round(trend+7*Math.sin(i*.11)+3*Math.cos(i*.43));
    const buy=(i<220 || i>=400)?i%5!==0:i%5===0;
    const r=buildLiveEventRecord({kind:'futures_tick',code:'TXFI6',receivedAt:new Date(t+1).toISOString(),...SAFETY,payload:{productFamily:'TX',_product_family:'TX',_target_code:'TXFI6',actualContract:'TXFI6',tradeDate:'2026-09-14',session:'DAY',eventTime:stamp,datetime:stamp,close,volume:1+(i*7)%17,tick_type:buy?1:2}},hash);
    hash=r.recordHash; return r;
  });
  const sourceLedgerIdentity='sha256:'+digest('CRU55_SYNTHETIC_UI_DEMO'),resolverIdentity='governed-fixture';
  const cp=appendCvdRecords(createCvdCheckpoint(sourceLedgerIdentity,resolverIdentity),rows,{sourceLedgerIdentity,resolverIdentity,resolveSessionTradeDate,ledgerOrdinalOffset:0});
  const g={generationHash:digest(stableJson(rows)),result:cvdSemanticResult(cp),prefixSha256:digest('CRU55_SYNTHETIC_UI_DEMO_PREFIX'),sourceBinding:{path:'/test/data/cru54-private/fixtures/cru55-ui-demo.ndjson'}};
  const events=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity,resolveSessionTradeDate}).events;
  const context=buildOneMinuteBars(rows,{calendar,asOf:g.result.semantic.availableAt});
  const price={generationHash:g.generationHash,cutoffRecordHash:g.result.semantic.cutoffRecordHash,bars:context.bars,timeLineageViolationCount:context.timeLineageViolationCount,reason:'SYNTHETIC_UI_DEMO'};
  const charts=Object.fromEntries(FRAMES.map(f=>[f,buildCvdChartProjection(g,price,f)]));
  const relationships=Object.fromEntries(FRAMES.map(f=>[f,buildCvdRelationshipProjection(g,events,charts[f],f)]));
  const current={charts,relationships},sessionContext=buildSessionContext(g,current,events,calendar);
  const handoffs=Object.fromEntries(FRAMES.map(f=>[f,buildSessionContextHandoff(null,current,[],events,calendar,null,sessionContext,f)]));
  return {...current,sessionContext,handoffs,kind:'SYNTHETIC_FIXTURE'};
}

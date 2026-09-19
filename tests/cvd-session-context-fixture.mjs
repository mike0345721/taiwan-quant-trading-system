import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, SAFETY, digest, stableJson } from '../src/cvd-observation-core.mjs';
import { buildLiveEventRecord } from '../src/live-event-ledger.mjs';
import { materializeTxCanonicalObservations } from '../src/tx-intraday-pressure-path-efficiency.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';
import { buildCvdChartProjection, FRAMES } from '../src/cvd-chart-projection.mjs';
import { buildCvdRelationshipProjection } from '../src/cvd-relationship-projection.mjs';
export const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json',import.meta.url));
export function sessionFixture({ start='2026-09-14T09:00:00+08:00', price=120, direction=1, weakening=false, count=19, badPrice=false, contract='TXFI6', kind='SYNTHETIC_FIXTURE', proven=false, tickType=null }={}) {
  let hash='GENESIS'; const origin=Date.parse(start), session=classifyTxChartSession(start,calendar);
  const rows=Array.from({length:count},(_,i)=>{
    const stamp=new Date(origin+i*10000).toISOString();
    const r=buildLiveEventRecord({kind:'futures_tick',code:contract,receivedAt:new Date(origin+i*10000+(badPrice?-1:1)).toISOString(),...SAFETY,
      payload:{productFamily:'TX',_product_family:'TX',_target_code:contract,actualContract:contract,tradeDate:session.tradeDate,session:session.session,
        eventTime:stamp,datetime:stamp,close:price+i*direction,volume:weakening&&i<=12?4:1,tick_type:tickType ?? (direction===1?1:2)}},hash);hash=r.recordHash;return r;
  });
  const sourceLedgerIdentity='sha256:'+digest(start), resolverIdentity='governed-fixture';
  const resolveSessionTradeDate=t=>{const s=classifyTxChartSession(t,calendar);return {session:s.session,tradeDate:s.tradeDate};};
  const checkpoint=appendCvdRecords(createCvdCheckpoint(sourceLedgerIdentity,resolverIdentity),rows,{sourceLedgerIdentity,resolverIdentity,resolveSessionTradeDate,ledgerOrdinalOffset:0});
  const g={generationHash:digest(stableJson(rows)),result:cvdSemanticResult(checkpoint),prefixSha256:digest('prefix'),sourceBinding:{path:kind==='SYNTHETIC_FIXTURE'?'/test/data/cru54-private/fixtures/test.ndjson':'/test/data/live-events/test.ndjson'}};
  if(proven) { g.result.semantic.segments[0].sessionStartProven=true; g.result.semanticHash=digest(stableJson(g.result.semantic)); }
  const events=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity,resolveSessionTradeDate}).events;
  const priceContext={generationHash:g.generationHash,cutoffRecordHash:g.result.semantic.cutoffRecordHash,bars:[],reason:'TEST_NO_CHART_BARS',timeLineageViolationCount:0};
  const charts=Object.fromEntries(FRAMES.map(f=>[f,buildCvdChartProjection(g,priceContext,f)]));
  const relationships=Object.fromEntries(FRAMES.map(f=>[f,buildCvdRelationshipProjection(g,events,charts[f],f)]));
  return {rows,events,charts,relationships,g};
}

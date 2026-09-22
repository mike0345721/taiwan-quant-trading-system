import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest,stableJson,SAFETY } from './cvd-observation-core.mjs';
import { FRAMES,buildCvdChartProjection,CHART_LIMITS } from './cvd-chart-projection.mjs';
import { buildCvdRelationshipProjection } from './cvd-relationship-projection.mjs';
import { buildSessionContext,buildSessionContextHandoff } from './cvd-session-context-projection.mjs';
import { materializeTxCanonicalObservations } from './tx-intraday-pressure-path-efficiency.mjs';
import { buildOneMinuteBars,classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { readCvdGeneration } from './cru55-dynamic-materializer.mjs';
import { REPO,isolatedRunRoot,assertInputPath,assertPlainPath } from './cru55-dynamic-isolation.mjs';

// Projection preparation is a producer operation, never an HTTP raw-ledger read.
export function projectGeneration(generation,rows,calendar,prior=null){
  const s=generation.result.semantic;
  if(rows.length!==s.cutoffLedgerOrdinal||rows.at(-1)?.recordHash!==s.cutoffRecordHash)throw Error('CRU55_PREFIX_CUTOFF_MISMATCH');
  const resolveSessionTradeDate=t=>{const c=classifyTxChartSession(t,calendar);return {session:c.session,tradeDate:c.sessionTradeDate};};
  const events=materializeTxCanonicalObservations(rows,{sourceLedgerIdentity:s.sourceLedgerIdentity,resolveSessionTradeDate}).events;
  const priceContext=buildOneMinuteBars(rows,{calendar,asOf:s.availableAt??generation.cutoffReceivedAt});
  const active=s.activeIdentity;
  const price={generationHash:generation.generationHash,cutoffRecordHash:s.cutoffRecordHash,bars:priceContext.bars.filter(b=>active&&b.actualContract===active[0]&&b.sessionTradeDate===active[1]&&b.session===active[2]),
    timeLineageViolationCount:priceContext.timeLineageViolationCount,reason:priceContext.timeLineageViolationCount?'PRICE_TIME_LINEAGE_EXCLUSIONS':'SAME_PREFIX_PRICE_CONTEXT_ONLY'};
  const charts=Object.fromEntries(FRAMES.map(f=>[f,buildCvdChartProjection(generation,price,f)]));
  const relationships=Object.fromEntries(FRAMES.map(f=>[f,buildCvdRelationshipProjection(generation,events,charts[f],f)]));
  const fixture=generation.sourceBinding?.path?.replaceAll('\\','/').toLowerCase().includes('/fixtures/');
  if(fixture)for(const r of Object.values(relationships))r.evidenceKind='SYNTHETIC_FIXTURE';
  const loaded={charts,relationships};
  const sessionContext=buildSessionContext(generation,loaded,events,calendar);
  const handoffs=Object.fromEntries(FRAMES.map(f=>[f,buildSessionContextHandoff(prior?.loaded??null,loaded,prior?.events??[],events,calendar,prior?.context??null,sessionContext,f)]));
  return {view:{kind:relationships['1m'].evidenceKind,charts,relationships,sessionContext,handoffs},loaded,events,context:sessionContext};
}
function prefix(g){
  if(g.endByteOffset>CHART_LIMITS.prefixBytes)throw Error('CVD_CHART_PREFIX_BUDGET');
  const source=assertInputPath(g.sourceBinding.path),fd=fs.openSync(source,'r');
  try{
    const st=fs.fstatSync(fd),b=g.sourceBinding;
    if(st.dev!==b.dev||st.ino!==b.ino||st.birthtimeMs!==b.birthtimeMs||st.size<g.endByteOffset)throw Error('CRU55_SOURCE_BINDING_MISMATCH');
    const bytes=Buffer.alloc(g.endByteOffset);let n=0;
    while(n<bytes.length){const size=fs.readSync(fd,bytes,n,bytes.length-n,n);if(!size)throw Error('CRU55_PREFIX_TRUNCATED');n+=size;}
    if(digest(bytes)!==g.prefixSha256||bytes.at(-1)!==10)throw Error('CRU55_PREFIX_CHANGED');
    return bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
  }finally{fs.closeSync(fd);}
}
export function prepareDynamicProjection(runId,priorRunId=null){
  const g=readCvdGeneration(runId);if(!g)throw Error('CVD_GENERATION_MISSING');
  const resolverIdentity=digest(stableJson([digest(fs.readFileSync(path.join(REPO,'config/taifex-official-calendar-2026.json'))),
    ...['src/dashboard-tx-chart.mjs','src/market-state-forward-shadow-calendar.mjs','src/tx-intraday-pressure-path-efficiency.mjs','src/cvd-observation-core.mjs','src/cru55-dynamic-materializer.mjs'].map(f=>digest(fs.readFileSync(path.join(REPO,f))))]));
  const verify=g=>{if(g.checkpoint.state.resolverIdentity!==resolverIdentity)throw Error('CRU55_RESOLVER_CHANGED');};verify(g);
  const calendar=loadGovernedTradingCalendar(path.join(REPO,'config/taifex-official-calendar-2026.json'));
  let prior=null;
  if(priorRunId){const pg=readCvdGeneration(priorRunId);if(!pg)throw Error('CRU55_PRIOR_GENERATION_MISSING');verify(pg);prior=projectGeneration(pg,prefix(pg),calendar);}
  const current=projectGeneration(g,prefix(g),calendar,prior);
  // Do not relabel the accepted pinned projection as LIVE: each publication is a verified historical cutoff.
  const body={schemaVersion:'cru55-dynamic-view-v1',generationHash:g.generationHash,view:current.view,...SAFETY};
  const artifact={...body,artifactHash:digest(stableJson(body))};
  const root=isolatedRunRoot(runId),bytes=stableJson(artifact);
  if(Buffer.byteLength(bytes)>32*1024*1024)throw Error('CRU55_PROJECTION_BUDGET');
  const target=assertPlainPath(path.join(root,artifact.artifactHash+'.view.json'));
  try{fs.writeFileSync(target,bytes,{flag:'wx'});}catch(e){if(e.code!=='EEXIST'||fs.readFileSync(target,'utf8')!==bytes)throw e;}
  const tmp=assertPlainPath(path.join(root,crypto.randomUUID()+'.tmp'));
  fs.writeFileSync(tmp,JSON.stringify({artifactHash:artifact.artifactHash,generationHash:g.generationHash}),{flag:'wx'});
  fs.renameSync(tmp,assertPlainPath(path.join(root,'view-latest.json')));
  return {artifactHash:artifact.artifactHash,generationHash:g.generationHash,cutoff:current.view.charts['1m'].cutoff,
    cvd:current.view.charts['1m'].currentCvd,delta:current.view.relationships['1m'].current.current?.deltaCvd??null,
    session:current.view.sessionContext.scope,handoff:current.view.handoffs['1m'].handoff};
}

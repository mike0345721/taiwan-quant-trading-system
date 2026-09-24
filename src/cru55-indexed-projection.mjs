import { stableJson } from './cvd-observation-core.mjs';
import { createProjectionJob, projectionPrimitives, PROJECTION_LIMITS } from './cru55-stream-projection.mjs';
import { beginRangeQueries, advanceRangeQueries } from './cru55-projection-range-index.mjs';
const {validate,seal}=projectionPrimitives;
const frames={'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000};
const same=(a,b)=>stableJson(a)===stableJson(b);
const clock=s=>Date.parse(s.snapshotAvailableAt??s.cutoffReceivedAt);

export function startIndexedProjection(options,previous=null) {
  const fresh=createProjectionJob(options),s=fresh.checkpoint.state;
  let reason='INITIAL_BUILD',prior=null;
  if(previous){
    prior=validate(previous.projection);const old=prior.checkpoint.state;
    if(previous.schemaVersion!=='cru55-indexed-projection-v1')reason='INDEX_SCHEMA_CHANGED';
    else if(old.sourceLedgerIdentity!==s.sourceLedgerIdentity||old.resolverIdentity!==s.resolverIdentity||prior.sourceKind!==fresh.sourceKind||!same(prior.calendar,fresh.calendar))reason='SOURCE_OR_RESOLVER_CHANGED';
    else if(s.ordinal<old.ordinal)reason='CUTOFF_REGRESSION';
    else if(!same(old.activeIdentity,s.activeIdentity)||old.segmentCount!==s.segmentCount||!same(old.activeSegment?.identity,s.activeSegment?.identity)||old.activeSegment?.startOrdinal!==s.activeSegment?.startOrdinal)reason='ACTIVE_SEGMENT_CHANGED';
    else if(!Number.isFinite(clock(s))||clock(s)<clock(old)||fresh.endMs<prior.endMs||Date.parse(s.lastPoint.availableAt)<Date.parse(old.lastPoint.availableAt))reason='CUTOFF_CLOCK_REGRESSION';
    else if(previous.index.futurePriceExcluded||previous.index.maxPointAvailable>Date.parse(old.lastPoint.availableAt))reason='HISTORICAL_AVAILABILITY_REEVALUATION';
    else reason=null;
  }
  if(reason)return {projection:fresh,index:{roots:[],futurePriceExcluded:false,maxPointAvailable:null},reason,resumed:false};
  const projection=seal({...prior,checkpoint:fresh.checkpoint,generationHash:fresh.generationHash,endMs:fresh.endMs,startMs:fresh.startMs});
  return {projection,index:structuredClone(previous.index),reason:null,resumed:true};
}

export function projectionQuerySpecs(job) {
  const s=job.checkpoint.state,last=s.lastPoint;
  const base={lo:s.activeSegment.startOrdinal,hi:last.ledgerOrdinal,available:Date.parse(last.availableAt)};
  const queries=[];
  for(const [frame,W]of Object.entries(frames))for(let previous=0;previous<2;previous++){
    const upper=job.endMs-previous*W;queries.push({kind:'window',frame,previous,filter:{...base,lower:upper-W,upper}});
  }
  queries.push({kind:'context',filter:{...base,lower:job.startMs-1,upper:job.endMs}});
  const span=Math.max(1,last.ledgerOrdinal-s.activeSegment.startOrdinal+1),start=s.activeSegment.startOrdinal;
  // Invert the oracle's integer ordinal bin operation exactly. A bounded binary
  // search also avoids ceil multiplication rounding at large safe ordinals.
  const bin=ordinal=>Math.min(PROJECTION_LIMITS.displayBuckets-1,Math.floor((ordinal-start)*PROJECTION_LIMITS.displayBuckets/span));
  const lowerBound=target=>{let lo=start,hi=last.ledgerOrdinal+1;while(lo<hi){const mid=lo+Math.floor((hi-lo)/2);if(bin(mid)<target)lo=mid+1;else hi=mid;}return lo;};
  for(let b=0;b<PROJECTION_LIMITS.displayBuckets;b++)queries.push({kind:'display',bin:b,filter:{lo:lowerBound(b),hi:b===PROJECTION_LIMITS.displayBuckets-1?last.ledgerOrdinal:lowerBound(b+1)-1}});
  return queries;
}

export function advanceIndexedProjectionQueries(projection,index,state,readNode,counters) {
  const specs=projectionQuerySpecs(projection);
  state.cursor??=beginRangeQueries(index.roots,specs,state.historicalOrdinal??0);
  const result=advanceRangeQueries(state.cursor,readNode);
  counters.rangeNodes=result.visitedNodes;counters.aggregateNodes=result.aggregateNodes;counters.orderedLeaves=result.orderedLeaves;
  counters.historicalOrderedLeaves=result.historicalOrderedLeaves;counters.unsafeHistoricalLeaves=result.unsafeHistoricalLeaves;counters.rangeQueries=specs.length;
  for(let i=0;i<specs.length;i++){
    const spec=specs[i],q=result.results[i];
    if(spec.kind==='display'){if(q.display)projection.display[spec.bin]=q.display;}
    else if(spec.kind==='context')projection.context=q.acc;
    else projection.windows[spec.frame][spec.previous]=q.acc;
  }
  return seal(projection);
}

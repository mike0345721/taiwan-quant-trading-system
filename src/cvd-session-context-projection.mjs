import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';
import { buildTxObservedFlowWindow } from './tx-intraday-research-snapshot.mjs';
import { classifyRelationship } from './cvd-relationship-projection.mjs';
import { handoffSide, buildCvdHandoffProjection, classifyHandoff } from './cvd-handoff-projection.mjs';

const equal = (a,b) => stableJson(a) === stableJson(b);
const finite = Number.isFinite;
export function sessionContextLabel(session, scope) {
  if (scope === 'UNAVAILABLE' || !['DAY','NIGHT'].includes(session)) return '暫無法判讀';
  return session + '｜' + (scope === 'SESSION_TO_NOW' ? session === 'DAY' ? '本日盤中累積' : '本夜盤累積' : '觀測累積');
}

// An observed interval, not a seventh CRU44 timeframe. No classifier or accumulator.
// The accepted A terminal cumulative point includes its first physical increment;
// its origin baseline is the verified segment's pre-first-trade zero, not first.value.
export function buildSessionContext(generation, loaded, events, calendar) {
  const chart = loaded.charts['1m'], s = generation?.result?.semantic;
  const side = handoffSide(loaded,events,calendar,'1m');
  const base = { schemaVersion:'cru54-session-context-v1', ...SAFETY,
    generationHash:chart.generationHash, semanticHash:chart.semanticHash, sourceCutoff:chart.cutoff,
    evidenceKind:side.evidenceKind, sourceMode:'PINNED_HISTORICAL_GENERATION',
    identity:chart.identity, session:chart.session, tradeDate:chart.tradeDate, actualContract:chart.actualContract,
    continuityEpoch:chart.continuityEpoch, segment:chart.segmentIndex, origin:chart.origin,
    cutoff:side.lineage, observedSpanMs:null, scope:'UNAVAILABLE', label:'暫無法判讀',
    sessionStartProven:false, captureCompleteness:'UNPROVEN', relationship:{code:'UNAVAILABLE'},
    evidence:null, cumulativeCvd:null, originCumulativeBaseline:null, firstPrice:null, lastPrice:null,
    method:{cvd:'ACCEPTED_CUMULATIVE_MINUS_SEGMENT_ORIGIN_BASELINE', pressureIndependentVote:false,
      fixedWindowWarmupIndependent:true, completeMeans:'OBSERVED_INTERVAL_ONLY', crossSessionArithmetic:false}, reason:null };
  const refuse = reason => ({...base, reason, relationship:{code:'UNAVAILABLE',reason}});
  if (!s || generation.result.semanticHash !== digest(stableJson(s)) || generation.generationHash !== chart.generationHash
    || generation.result.semanticHash !== chart.semanticHash || Object.entries(SAFETY).some(([k,v])=>s[k]!==v)) return refuse('CONTEXT_ACCEPTED_BINDING_INVALID');
  if (side.reason) return refuse(side.reason);
  if (s.segments.length !== 1 || !equal(s.activeIdentity,chart.identity) || s.series.length > 1024 || events.length > 25000) return refuse('CONTEXT_SINGLE_SEGMENT_REQUIRED');
  const segment=s.segments[0], first=s.series[0], last=s.series.at(-1);
  if (!first || !last || !equal(segment.identity,chart.identity) || segment.startOrdinal !== first.ledgerOrdinal
    || segment.lastOrdinal !== last.ledgerOrdinal || !equal(chart.origin,{eventTime:segment.observedStart,eventTimeMs:timestampMs(segment.observedStart),availableAt:segment.startAvailableAt,availableAtMs:timestampMs(segment.startAvailableAt),ledgerOrdinal:segment.startOrdinal})
    || last.value !== s.value || last.value !== chart.currentCvd) return refuse('CONTEXT_ORIGIN_OR_TERMINAL_INVALID');
  const cutoff=events.find(e=>e.ledgerOrdinal===last.ledgerOrdinal);
  if (!cutoff || cutoff.recordHash!==last.recordHash || cutoff.availableAt!==last.availableAt || cutoff.eventTime!==last.eventTime) return refuse('CONTEXT_CUTOFF_INVALID');
  const originMs=timestampMs(first.eventTime), endMs=timestampMs(last.eventTime);
  if (!finite(originMs) || !finite(endMs) || endMs<originMs) return refuse('CONTEXT_CLOCK_INVALID');
  let ordinal=0, eventMs=-Infinity;
  for(const p of s.series) {
    const e=events.find(e=>e.ledgerOrdinal===p.ledgerOrdinal);
    if (p.segment!==0 || p.ledgerOrdinal<=ordinal || !e || e.recordHash!==p.recordHash
      || !equal([e.actualContract,e.tradeDate,e.session,e.continuityEpoch],segment.identity)
      || e.sourceLedgerIdentity!==s.sourceLedgerIdentity || e.identityStatus!=='USABLE' || e.availabilityLineageStatus!=='USABLE'
      || e.availableAt!==p.availableAt || e.eventTime!==p.eventTime || !finite(e.availableMs) || !finite(e.eventMs)
      || e.availableMs>cutoff.availableMs || e.eventMs<eventMs
      || (p.value==null && p.reason!=='NO_CLASSIFIED_VOLUME')) return refuse('CONTEXT_LINEAGE_OR_CONTINUITY_INVALID');
    ordinal=p.ledgerOrdinal; eventMs=e.eventMs;
  }
  // Keep earlier same-identity quotes only as the frozen pressure cross-check's context.
  // All executed trades must be exactly the accepted physical segment, never pooled.
  const selected=events.filter(e=>e.ledgerOrdinal<=last.ledgerOrdinal && e.availableMs<=cutoff.availableMs
    && equal([e.actualContract,e.tradeDate,e.session,e.continuityEpoch],segment.identity)
    && (e.kind!=='futures_tick' || e.ledgerOrdinal>=first.ledgerOrdinal));
  const publicWindow=buildTxObservedFlowWindow(selected,cutoff,{instrument:'TX',product:'TX',market:'TAIFEX',tickSize:1},endMs-originMs+1).public;
  const pressure=publicWindow.pressure;
  if (['buyProxyVolume','sellProxyVolume','unknownVolume','totalExecutedVolume'].some(k=>pressure[k]!==last[k])) return refuse('CONTEXT_VOLUME_PRESSURE_PARITY_MISMATCH');
  const delta=last.value; // accepted current value minus verified pre-first-trade baseline 0
  if (delta!==null && delta!==pressure.netAggressiveFlowProxy) return refuse('CONTEXT_CVD_PRESSURE_PARITY_MISMATCH');
  const proven=segment.sessionStartProven===true && chart.sessionStartProven===true;
  if (proven && originMs!==Date.parse(side.sessionContext.sessionStart)) return refuse('CONTEXT_SESSION_START_PROOF_INCONSISTENT');
  const scope=proven?'SESSION_TO_NOW':'OBSERVED_SEGMENT_TO_NOW';
  const evidence={status:'OBSERVED_CONTEXT',complete:true,reason:publicWindow.unavailableReason,
    observedSpanMs:endMs-originMs,requiredSpanMs:null,originEventMs:originMs,upperInclusiveMs:endMs,
    baseline:'ACCEPTED_SEGMENT_PRE_FIRST_TRADE',deltaCvd:delta,observedVolume:last.totalExecutedVolume,
    unknownVolume:last.unknownVolume,pressure,response:publicWindow.response,pathEfficiency:publicWindow.pathEfficiency,
    quality:publicWindow.quality,parity:delta==null?'NO_CLASSIFIED_VOLUME':'EXACT',
    priceDelta:side.firstPrice && side.lastPrice ? side.lastPrice.price-side.firstPrice.price : null,
    priceReason:side.firstPrice && side.lastPrice ? 'LAWFUL_OBSERVED_ENDPOINTS' : 'CONTEXT_LAWFUL_PRICE_UNAVAILABLE',
    captureCompleteness:'UNPROVEN',sessionStartProven:proven};
  return {...base,scope,label:sessionContextLabel(chart.session,scope),sessionStartProven:proven,
    observedSpanMs:endMs-originMs,evidence,relationship:classifyRelationship(evidence,null),
    cumulativeCvd:last.value,originCumulativeBaseline:0,firstPrice:side.firstPrice,lastPrice:side.lastPrice,
    reason:publicWindow.unavailableReason || 'CAPTURE_COMPLETENESS_UNPROVEN'};
}

export function buildSessionContextHandoff(priorLoaded,currentLoaded,priorEvents,currentEvents,calendar,priorContext,currentContext,timeframe) {
  const fixed=buildCvdHandoffProjection(priorLoaded,currentLoaded,priorEvents,currentEvents,calendar,timeframe);
  const adapt=(side,context)=>side && ({...side,relationship:context?.relationship || {code:'UNAVAILABLE'},evidence:context?.evidence ?? null,
    cumulativeCvd:context?.cumulativeCvd ?? null,contextScope:context?.scope ?? 'UNAVAILABLE',sessionStartProven:context?.sessionStartProven===true});
  const prior=adapt(fixed.prior,priorContext),current=adapt(fixed.current,currentContext);
  const invalid=currentContext.scope==='UNAVAILABLE' || (priorContext && priorContext.scope==='UNAVAILABLE');
  const pairing=invalid?{state:'NOT_COMPARABLE',reason:'SESSION_CONTEXT_UNAVAILABLE'}:fixed.pairing;
  // D observed endpoints never proved the official previous close. Retain honest
  // endpoint wording even with current start proof; no official-close assertion.
  const gap={...fixed.gap,label:'觀測片段端點差',openingBoundaryProven:currentContext.sessionStartProven===true,officialCloseProven:false};
  let handoff=classifyHandoff(prior,current,pairing,gap);
  if(handoff.code==='PRIOR_SESSION_REJECTED') handoff={code:'UNCONFIRMED_OR_CONFLICT',reason:'OFFICIAL_OPEN_CLOSE_BOUNDARIES_UNPROVEN'};
  return {...fixed,schemaVersion:'cru54-session-context-handoff-v1',prior,current,pairing,gap,handoff,
    primaryEvidence:'SESSION_CONTEXT',recentChange:{prior:fixed.prior?.evidence ?? null,current:fixed.current.evidence},
    method:{...fixed.method,openingRejectionRequiresBothBoundaries:true}};
}

import { validateCru34LiveCheckpoint } from './cru34-live-checkpoint.mjs';
import { accumulateCanonicalCvdEvents, canonicalCvdSemanticResult, createCvdCheckpoint, stableJson, stableJsonDigest, digest, SAFETY, LIMITS } from './cvd-observation-core.mjs';

export const CANONICAL_CVD_FRAGMENT_VERSION = 'cru61-canonical-cvd-fragment-v1';
const time = value => typeof value === 'string' && /(?:Z|[+-]\d{2}:\d{2})$/i.test(value)
  && Number.isFinite(Date.parse(value)) ? Date.parse(value) : null;
const iso = value => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 8.64e15 ? new Date(value).toISOString() : null;
const seal = state => ({state,stateHash:digest(stableJson(state))});
const fail = reason => { throw new Error(reason); };

export function validateCanonicalCvdFragment(checkpoint) {
  const s=checkpoint?.state;
  if(s?.schemaVersion!==CANONICAL_CVD_FRAGMENT_VERSION || checkpoint.stateHash!==stableJsonDigest(s)
      || !s.cvd || !s.resolverIdentity || !Number.isSafeInteger(s.sourceOrdinal) || s.sourceOrdinal<1
      || !/^[a-f0-9]{64}$/.test(s.sourceRecordHash||'') || !/^[a-f0-9]{64}$/.test(s.sourceCheckpointHash||'')
      || !Array.isArray(s.cvd.series) || s.cvd.series.length>LIMITS.stateRecords
      || !Array.isArray(s.cvd.quotes) || s.cvd.quotes.length>LIMITS.quoteCount
      || Object.entries(SAFETY).some(([k,v])=>s[k]!==v||s.cvd[k]!==v))fail('CVD_FRAGMENT_CHECKPOINT_INVALID');
  return s;
}

function normalizeEvents(source) {
  let ordinal=0;
  return source.rollingCanonicalEvents.map(raw=>{
    if(!raw || !['futures_tick','futures_bidask'].includes(raw.kind)
        || raw.sourceLedgerIdentity!==source.sourceLedgerIdentity
        || !Number.isSafeInteger(raw.ledgerOrdinal) || raw.ledgerOrdinal<=ordinal || raw.ledgerOrdinal>source.lastVerifiedLedgerOrdinal
        || !/^[a-f0-9]{64}$/.test(raw.recordHash||'')
        || Object.entries(SAFETY).some(([k,v])=>raw[k]!==v))fail('CVD_FRAGMENT_CANONICAL_LINEAGE_INVALID');
    ordinal=raw.ledgerOrdinal;
    const eventTime=raw.eventTime??iso(raw.eventMs),availableAt=raw.availableAt??iso(raw.availableMs);
    if((raw.eventTime!=null&&time(raw.eventTime)!==raw.eventMs)
        || (raw.availableAt!=null&&time(raw.availableAt)!==raw.availableMs))fail('CVD_FRAGMENT_TIME_WITNESS_MISMATCH');
    return {...raw,eventTime,availableAt};
  });
}

/** A read-only adapter over an existing validated producer checkpoint, not a new
 * collector or a sum of overlapping Flow windows. Pass the whole rolling vector
 * so an ordinal/hash overlap can prove that refreshes consume new ticks once. */
export function updateCanonicalCvdFragment(previous, input, {
  resolverIdentity, resolveSessionTradeDate=null, initialEventLimit=20000, storage=null, maxEvents=20000, continuation=false,
}={}) {
  const source=validateCru34LiveCheckpoint(input),before=previous?validateCanonicalCvdFragment(previous):null;
  if(!resolverIdentity || !Number.isSafeInteger(initialEventLimit)||initialEventLimit<1||initialEventLimit>20000)fail('CVD_FRAGMENT_PARAMETERS_INVALID');
  if(!Number.isInteger(maxEvents)||maxEvents<1||maxEvents>20000||(!storage&&(continuation||maxEvents!==20000)))fail('CVD_FRAGMENT_STAGING_INVALID');
  if(continuation&&(!before||before.sourceCheckpointHash!==source.checkpointHash))fail('CVD_FRAGMENT_STAGING_SOURCE_CHANGED');
  if(!source.canonicalState || typeof source.canonicalState.breakPending!=='boolean'
      || typeof source.canonicalState.epochLineageInvalid!=='boolean')fail('CVD_FRAGMENT_TERMINAL_LINEAGE_MISSING');
  if(before&&before.resolverIdentity!==resolverIdentity)fail('CVD_FRAGMENT_RESOLVER_MISMATCH');
  const events=normalizeEvents(source);
  let resetReason=before?null:'INITIAL_OBSERVED_FRAGMENT',reset=!before;
  if(before&&before.cvd.sourceLedgerIdentity!==source.sourceLedgerIdentity){reset=true;resetReason='SOURCE_IDENTITY_CHANGED';}
  if(before&&!reset&&!continuation){
    if(source.lastVerifiedLedgerOrdinal<before.sourceOrdinal)fail('CVD_FRAGMENT_SOURCE_ROLLBACK');
    if(source.lastVerifiedLedgerOrdinal===before.sourceOrdinal&&source.lastVerifiedRecordHash!==before.sourceRecordHash)fail('CVD_FRAGMENT_SOURCE_ANCHOR_CONFLICT');
    // Producer retention preserves ticks but may legally prune an unused quote
    // after its 2s relevance window. A trailing quote is therefore not a valid
    // continuity witness. Older private v1 caches recover this tick anchor from
    // the sealed series, without changing their cumulative origin.
    const previousTick=before.cvd.series.at(-1);
    const anchorOrdinal=before.lastTickOrdinal??previousTick?.ledgerOrdinal??null;
    const anchorHash=before.lastTickHash??previousTick?.recordHash??null;
    if(anchorOrdinal!==null){
      const overlap=events.find(event=>event.kind==='futures_tick'&&event.ledgerOrdinal===anchorOrdinal);
      if(overlap&&overlap.recordHash!==anchorHash)fail('CVD_FRAGMENT_OVERLAP_HASH_CONFLICT');
      if(!overlap){reset=true;resetReason='ROLLING_OVERLAP_UNAVAILABLE';}
    }
  }
  const remaining=reset?events.slice(-initialEventLimit):events.filter(event=>before.lastCanonicalOrdinal===null||event.ledgerOrdinal>before.lastCanonicalOrdinal);
  const suffix=remaining.slice(0,maxEvents),complete=suffix.length===remaining.length;
  const cvd=reset?structuredClone(createCvdCheckpoint(source.sourceLedgerIdentity,resolverIdentity).state):structuredClone(before.cvd);
  // The producer retains each historical tick's legally matched quote. An initial
  // partial slice may begin after that quote; absent cross-check stays unavailable.
  if(!storage&&cvd.series.length+suffix.filter(event=>event.kind==='futures_tick').length>LIMITS.stateRecords)fail('CVD_FRAGMENT_HISTORY_BUDGET');
  if(storage&&reset)storage.beginOrigin(source.sourceLedgerIdentity,suffix[0]?.ledgerOrdinal??null);
  accumulateCanonicalCvdEvents(cvd,suffix,{resolveSessionTradeDate,storage});
  // Intermediate state is private staging, never a published source checkpoint.
  // Do not stamp the unprocessed source terminal time/ordinal onto this prefix.
  cvd.ordinal=complete?source.lastVerifiedLedgerOrdinal:suffix.at(-1).ledgerOrdinal;
  cvd.terminalHash=complete?source.lastVerifiedRecordHash:suffix.at(-1).recordHash;
  // Only the processed canonical endpoint witnesses private-prefix lineage.
  // An earlier published epoch's invalid flag must not poison a recovered epoch;
  // the source terminal state is authoritative only after all events are consumed.
  cvd.canonicalState=complete?structuredClone(source.canonicalState):{
    epochLineageInvalid:suffix.at(-1).availabilityLineageStatus!=='USABLE',breakPending:false};
  cvd.cutoffReceivedAt=complete?source.lastVerifiedAvailableAt??null:suffix.at(-1).availableAt;
  cvd.snapshotAvailabilityInvalid=time(cvd.cutoffReceivedAt)===null||(complete?source.canonicalState.epochLineageInvalid:suffix.at(-1).availabilityLineageStatus!=='USABLE');
  cvd.snapshotAvailableAt=cvd.snapshotAvailabilityInvalid?null:cvd.cutoffReceivedAt;
  if(complete&&source.canonicalState.breakPending){cvd.pendingSegment=true;cvd.quotes=[];}
  const processed=complete?events:suffix,last=processed.at(-1),lastTick=processed.findLast(event=>event.kind==='futures_tick');
  const keepCursor=!reset&&before.lastCanonicalOrdinal!==null&&(!last||before.lastCanonicalOrdinal>last.ledgerOrdinal);
  const s={schemaVersion:CANONICAL_CVD_FRAGMENT_VERSION,resolverIdentity,cvd,
    sourceOrdinal:cvd.ordinal,sourceRecordHash:cvd.terminalHash,
    sourceCheckpointHash:source.checkpointHash,lastCanonicalOrdinal:keepCursor?before.lastCanonicalOrdinal:last?.ledgerOrdinal??null,
    lastCanonicalHash:keepCursor?before.lastCanonicalHash:last?.recordHash??null,
    lastTickOrdinal:lastTick?.ledgerOrdinal??(reset?null:before?.lastTickOrdinal??before?.cvd.series.at(-1)?.ledgerOrdinal)??null,
    lastTickHash:lastTick?.recordHash??(reset?null:before?.lastTickHash??before?.cvd.series.at(-1)?.recordHash)??null,
    initialEventLimit,originReason:reset?resetReason:before.originReason,
    originOrdinal:reset?suffix[0]?.ledgerOrdinal??null:before.originOrdinal,
    originAvailableAt:reset?suffix[0]?.availableAt??null:before.originAvailableAt,...SAFETY};
  const checkpoint=seal(s);
  validateCanonicalCvdFragment(checkpoint);
  const {semantic}=canonicalCvdSemanticResult(cvd,{sourceMode:'VALIDATED_EXISTING_PRODUCER_FRAGMENT'});
  const cvdSemantic={...semantic,originOrdinal:s.originOrdinal,originAvailableAt:s.originAvailableAt,resetReason:s.originReason,
    limitations:['OBSERVED_FRAGMENT_NOT_FULL_SESSION','INITIAL_QUOTE_HISTORY_MAY_BE_PARTIAL','EVENT_TIME_FROM_PRODUCER_MILLISECOND_WITNESS',
      'NO_INDEPENDENT_CAPTURE_COMPLETENESS_PROOF']};
  return {checkpoint,cvdSemantic,canonicalEvents:suffix,resetReason,complete};
}

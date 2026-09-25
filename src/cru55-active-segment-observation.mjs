import {stableJson, SAFETY} from './cvd-observation-core.mjs';

const equal = (a,b) => stableJson(a) === stableJson(b);
const hash = x => /^[a-f0-9]{64}$/.test(x ?? '');
const fail = () => { throw Error('CRU55_ACTIVE_SEGMENT_BINDING_INVALID'); };

// Called only after the reader verifies the immutable artifact and full-prefix
// publication. No raw reads, accumulation, historical-point fallback or writes.
export function buildActiveSegmentObservation({artifactHash, chart:c, relationship:r}) {
  if (!hash(artifactHash) || c?.schemaVersion !== 'cru55-stream-chart-v1'
      || r?.schemaVersion !== 'cru55-stream-relationship-v1'
      || !hash(c.generationHash) || !hash(c.projectionHash)
      || r.generationHash !== c.generationHash || r.projectionHash !== c.projectionHash
      || r.evidenceKind !== c.evidenceKind || r.timeframe !== c.timeframe
      || !equal(r.sourceCutoff,c.cutoff)
      || [c,r].some(x=>Object.entries(SAFETY).some(([k,v])=>x[k]!==v))) fail();
  const o=r.current, segment=c.segments?.find(s=>s.index===c.segmentIndex);
  const available=Number.isFinite(c.currentCvd) && c.display?.boundaryAtCutoff===false;
  if (available && (!o || !segment || segment.terminalInvalid
      || !equal(o.identity,c.identity) || !equal(segment.identity,c.identity)
      || !equal(segment.origin,c.origin) || o.segment!==c.segmentIndex
      || !equal(c.identity,[c.actualContract,c.tradeDate,c.session,c.continuityEpoch])
      || o.cumulativeCvd!==c.currentCvd || c.display.endpoint!==c.currentCvd
      || !Number.isInteger(c.origin?.ledgerOrdinal) || c.origin.ledgerOrdinal<1
      || !Number.isFinite(c.origin.eventTimeMs) || !Number.isFinite(c.origin.availableAtMs)
      || !o.lineage || o.lineage.sourceLedgerIdentity!==c.cutoff.sourceLedgerIdentity
      || o.lineage.availabilityLineageStatus!=='USABLE'
      || o.lineage.cutoffLedgerOrdinal<c.origin.ledgerOrdinal
      || o.lineage.cutoffLedgerOrdinal>c.cutoff.ledgerOrdinal
      || o.lineage.availableAt!==c.lastTradeAvailableAt)) fail();
  return {
    schemaVersion:'cru55-active-segment-observation-v1', ...SAFETY,
    artifactHash, generationHash:c.generationHash, projectionHash:c.projectionHash,
    evidenceKind:c.evidenceKind, sourceCutoff:c.cutoff,
    scope:available?'CURRENT_CONTINUOUS_OBSERVED_SEGMENT':'UNAVAILABLE',
    label:'當前連續觀測段 CVD', cumulativeCvd:available?c.currentCvd:null,
    identity:available?c.identity:null, actualContract:available?c.actualContract:null,
    tradeDate:available?c.tradeDate:null, session:available?c.session:null,
    continuityEpoch:available?c.continuityEpoch:null, segment:available?c.segmentIndex:null,
    origin:available?c.origin:null, lastTrade:available?{...o.lineage,eventTime:o.anchorEventTime}:null,
    boundaryAtCutoff:c.display?.boundaryAtCutoff!==false,
    reason:available?c.reason:(c.reason||'NO_LAWFUL_CURRENT_TRADE'),
    quality:c.quality, classifiedCoverage:available?c.classifiedCoverage:null,
    sessionStartProven:false, captureCompleteness:'UNPROVEN',
    method:'VERIFIED_PUBLICATION_CURRENT_NOT_HISTORY_ENDPOINT',
  };
}

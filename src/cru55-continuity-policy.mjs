export const CONTINUITY_POLICY = 'GUARDED_PREFIX_CONTINUITY_V1';
export const CONTINUITY_PRODUCER = 'STREAM_PAGED_V3';
export const CONTINUITY_OUTPUT = 'stream-continuity-v1';
export const FULL_PREFIX_POLICY = 'FULL_PREFIX_BEFORE_PUBLICATION';
// Availability cannot go backwards; ordinals are comparable only within a source.
export function continuityPublicationAdvances(next, previous) {
  if (!Number.isFinite(Date.parse(next.availableAt)) || !Number.isSafeInteger(next.cutoff?.ledgerOrdinal)) throw Error('CRU55_CONTINUITY_PUBLICATION_ORDER_INVALID');
  return !previous || (Date.parse(next.availableAt) >= Date.parse(previous.availableAt) &&
    (next.sourceKey !== previous.sourceKey || next.cutoff.ledgerOrdinal >= previous.cutoff.ledgerOrdinal));
}
export function validateContinuityConfig(b) {
  const requested = b.producer === CONTINUITY_PRODUCER || b.sourceVerification === CONTINUITY_POLICY || b.outputVersion === CONTINUITY_OUTPUT;
  if (!requested) return false;
  if (b.producer !== CONTINUITY_PRODUCER || b.sourceVerification !== CONTINUITY_POLICY || b.outputVersion !== CONTINUITY_OUTPUT ||
      !/^https:\/\/(github\.com|linear\.app)\//.test(b.ownerDecisionUrl ?? '')) throw Error('CRU55_CONTINUITY_BINDING_INVALID');
  return true;
}
// Admission remains closed. A new hash of today's file is not a trusted baseline.
// Existing research manifests do not admit this new schema/policy; no conversion
// to a legacy artifact or retrospective availability is provided here.
export const CONTINUITY_RESEARCH = Object.freeze({eligible:false, state:'QUARANTINED',
  reason:'TRUSTED_FULL_SOURCE_AND_TEMPORAL_ADMISSION_NOT_ESTABLISHED',
  required:'FULL_VERIFICATION_AGAINST_TRUSTED_BASELINE_PLUS_TIME_COVERAGE_QUALITY'});

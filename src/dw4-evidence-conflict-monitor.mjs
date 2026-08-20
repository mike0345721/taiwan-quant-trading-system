export const DW4_DIRECTION_STATES = Object.freeze([
  'SUPPORTS_UP',
  'SUPPORTS_DOWN',
  'NEUTRAL',
  'CONFLICT_INTERNAL',
  'NOT_ELIGIBLE',
]);

export const DW4_AVAILABILITY_STATES = Object.freeze(['AVAILABLE', 'UNAVAILABLE', 'STALE']);
export const DW4_QUALITY_STATES = Object.freeze(['PASS', 'QUALITY_INSUFFICIENT', 'UNKNOWN']);
export const DW4_PROMOTION_STATES = Object.freeze(['ELIGIBLE', 'RAW_ONLY', 'RESEARCH_ONLY', 'NOT_PROMOTED']);
export const DW4_CONFLICT_STATES = Object.freeze([
  'ALIGNED_UP', 'ALIGNED_DOWN', 'MIXED', 'NO_DIRECTIONAL_EVIDENCE',
]);
export const DW4_COVERAGE_STATES = Object.freeze(['COMPLETE', 'PARTIAL', 'INSUFFICIENT']);
export const DW4_DATA_TRUST_STATES = Object.freeze(['PASS', 'DEGRADED', 'QUALITY_INSUFFICIENT', 'BLOCKED']);

export const DW4_EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 'dw4-evidence-conflict-monitor-v2',
  allowedDirectionStates: DW4_DIRECTION_STATES,
  allowedAvailabilityStates: DW4_AVAILABILITY_STATES,
  allowedQualityStates: DW4_QUALITY_STATES,
  allowedPromotionStates: DW4_PROMOTION_STATES,
  allowedConflictStates: DW4_CONFLICT_STATES,
  allowedCoverageStates: DW4_COVERAGE_STATES,
  allowedDataTrustStates: DW4_DATA_TRUST_STATES,
  missingIsNeutral: false,
  staleIsNeutral: false,
  qualityInsufficientIsNeutral: false,
  hiddenWeightsAllowed: false,
  numericScoreAllowed: false,
  tradingSignalAllowed: false,
  promotionRequired: Object.freeze([
    'RAW_COLLECTION',
    'COVERAGE_AUDIT',
    'QUALITY_AUDIT',
    'AVAILABLE_AT_AUDIT',
    'DETERMINISTIC_REPLAY',
    'DESCRIPTIVE_VALIDATION',
    'OWNER_REVIEW',
    'DW4_EVIDENCE_CANDIDATE',
  ]),
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
});

export const DW4_SOURCE_IDENTITY_GUARDS = Object.freeze({
  ndx: 'NDX_PROXY',
  trueNq: 'SOURCE_GAP_OWNER_DECISION_REQUIRED',
  tsmcPrice: 'RAW_PRICE_ONLY',
  tsmcContribution: 'CONTRIBUTION_NOT_YET_ELIGIBLE',
  rawOptions: 'RAW_COLLECTION_CANDIDATE',
  validatedIntradayIv: 'NOT_PROMOTED',
  providerGreeks: 'FUTURE_NOT_REQUIRED',
});

function iso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

function requiredEnum(value, allowed, code) {
  if (!allowed.includes(value)) throw new Error(code);
  return value;
}

export function createDw4EvidenceObservation(input = {}) {
  if (typeof input.evidenceId !== 'string' || !input.evidenceId.trim()) throw new Error('EVIDENCE_ID_REQUIRED');
  const directionState = requiredEnum(input.directionState, DW4_DIRECTION_STATES, 'DIRECTION_STATE_INVALID');
  const availabilityState = requiredEnum(input.availabilityState, DW4_AVAILABILITY_STATES, 'AVAILABILITY_STATE_INVALID');
  const qualityState = requiredEnum(input.qualityState, DW4_QUALITY_STATES, 'QUALITY_STATE_INVALID');
  const promotionState = requiredEnum(input.promotionState, DW4_PROMOTION_STATES, 'PROMOTION_STATE_INVALID');
  const eventTime = iso(input.eventTime);
  const availableAt = iso(input.availableAt);
  if (availabilityState === 'AVAILABLE') {
    if (!eventTime) throw new Error('EVENT_TIME_INVALID');
    if (!availableAt) throw new Error('AVAILABLE_AT_INVALID');
    if (Date.parse(availableAt) < Date.parse(eventTime)) throw new Error('AVAILABLE_AT_BEFORE_EVENT');
  }
  const eligible = availabilityState === 'AVAILABLE'
    && qualityState === 'PASS'
    && promotionState === 'ELIGIBLE'
    && directionState !== 'NOT_ELIGIBLE';
  if (!eligible && directionState !== 'NOT_ELIGIBLE') throw new Error('NON_ELIGIBLE_OBSERVATION_MUST_NOT_ASSERT_DIRECTION');
  return Object.freeze({
    schemaVersion: 'dw4-evidence-observation-v2',
    evidenceId: input.evidenceId.trim(),
    family: typeof input.family === 'string' && input.family.trim() ? input.family.trim() : 'UNCLASSIFIED',
    directionState,
    availabilityState,
    qualityState,
    promotionState,
    eligibleDirectionalEvidence: eligible,
    eventTime,
    availableAt,
    sourceId: typeof input.sourceId === 'string' && input.sourceId.trim() ? input.sourceId.trim() : null,
    qualityReasons: Object.freeze([...(input.qualityReasons || [])].filter(Boolean).sort()),
    detail: input.detail ?? null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

function uniqueSorted(values) {
  return Object.freeze([...new Set(values)].sort());
}

export function summarizeDw4Evidence(observations = [], {
  expectedEvidenceFamilies = null,
  snapshotBlocked = false,
} = {}) {
  const evidence = Object.freeze([...observations]);
  const expected = uniqueSorted(expectedEvidenceFamilies || evidence.map((item) => item.family));
  const eligible = evidence.filter((item) => item.eligibleDirectionalEvidence && expected.includes(item.family));
  const eligibleFamilies = uniqueSorted(eligible.map((item) => item.family));
  const unavailableFamilies = uniqueSorted(evidence
    .filter((item) => expected.includes(item.family) && item.availabilityState === 'UNAVAILABLE')
    .map((item) => item.family));
  const staleFamilies = uniqueSorted(evidence
    .filter((item) => expected.includes(item.family) && item.availabilityState === 'STALE')
    .map((item) => item.family));
  const qualityExcludedFamilies = uniqueSorted(evidence
    .filter((item) => expected.includes(item.family) && item.qualityState !== 'PASS')
    .map((item) => item.family));
  const promotionExcludedFamilies = uniqueSorted(evidence
    .filter((item) => expected.includes(item.family) && item.promotionState !== 'ELIGIBLE')
    .map((item) => item.family));
  const observedFamilies = new Set(evidence.map((item) => item.family));
  const missingFamilies = uniqueSorted(expected.filter((family) => !observedFamilies.has(family)));

  const up = eligible.some((item) => item.directionState === 'SUPPORTS_UP');
  const down = eligible.some((item) => item.directionState === 'SUPPORTS_DOWN');
  const internal = eligible.some((item) => item.directionState === 'CONFLICT_INTERNAL');
  let conflictState = 'NO_DIRECTIONAL_EVIDENCE';
  if (internal || (up && down)) conflictState = 'MIXED';
  else if (up) conflictState = 'ALIGNED_UP';
  else if (down) conflictState = 'ALIGNED_DOWN';

  const coverageState = eligibleFamilies.length === 0
    ? 'INSUFFICIENT'
    : eligibleFamilies.length === expected.length
      ? 'COMPLETE'
      : 'PARTIAL';

  const hasQualityLimitation = qualityExcludedFamilies.length > 0;
  const hasOtherLimitation = unavailableFamilies.length > 0
    || staleFamilies.length > 0
    || missingFamilies.length > 0
    || promotionExcludedFamilies.length > 0;
  const dataTrustState = snapshotBlocked || eligibleFamilies.length === 0
    ? 'BLOCKED'
    : hasQualityLimitation
      ? 'QUALITY_INSUFFICIENT'
      : hasOtherLimitation
        ? 'DEGRADED'
        : 'PASS';

  return Object.freeze({
    schemaVersion: 'dw4-evidence-conflict-summary-v2',
    conflictState,
    coverageState,
    dataTrustState,
    expectedEvidenceFamilies: expected,
    eligibleEvidenceFamilies: eligibleFamilies,
    unavailableEvidenceFamilies: unavailableFamilies,
    staleEvidenceFamilies: staleFamilies,
    qualityExcludedFamilies,
    promotionExcludedFamilies,
    missingEvidenceFamilies: missingFamilies,
    expectedFamilies: expected.length,
    eligibleFamilies: eligibleFamilies.length,
    evidenceCount: evidence.length,
    evidence,
    score: null,
    confidence: null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

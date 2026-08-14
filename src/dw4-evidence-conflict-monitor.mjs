export const DW4_EVIDENCE_STATES = Object.freeze([
  'SUPPORTS_UP',
  'SUPPORTS_DOWN',
  'NEUTRAL',
  'CONFLICT_INTERNAL',
  'UNAVAILABLE',
  'STALE',
  'QUALITY_INSUFFICIENT',
]);

export const DW4_CONFLICT_STATES = Object.freeze([
  'ALIGNED_UP',
  'ALIGNED_DOWN',
  'MIXED',
  'INSUFFICIENT_EVIDENCE',
  'QUALITY_BLOCKED',
]);

export const DW4_EVIDENCE_CONTRACT = Object.freeze({
  schemaVersion: 'dw4-evidence-conflict-monitor-v1',
  allowedEvidenceStates: DW4_EVIDENCE_STATES,
  allowedConflictStates: DW4_CONFLICT_STATES,
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

export function createDw4EvidenceObservation(input = {}) {
  if (typeof input.evidenceId !== 'string' || !input.evidenceId.trim()) throw new Error('EVIDENCE_ID_REQUIRED');
  if (!DW4_EVIDENCE_STATES.includes(input.state)) throw new Error('EVIDENCE_STATE_INVALID');
  const eventTime = iso(input.eventTime);
  const availableAt = iso(input.availableAt);
  if (!eventTime) throw new Error('EVENT_TIME_INVALID');
  if (!availableAt) throw new Error('AVAILABLE_AT_INVALID');
  if (Date.parse(availableAt) < Date.parse(eventTime)) throw new Error('AVAILABLE_AT_BEFORE_EVENT');
  if (['UNAVAILABLE', 'STALE', 'QUALITY_INSUFFICIENT'].includes(input.state) && input.direction != null) {
    throw new Error('NON_DIRECTIONAL_STATE_MUST_NOT_HAVE_DIRECTION');
  }
  return Object.freeze({
    schemaVersion: 'dw4-evidence-observation-v1',
    evidenceId: input.evidenceId.trim(),
    group: typeof input.group === 'string' && input.group.trim() ? input.group.trim() : 'UNCLASSIFIED',
    state: input.state,
    eventTime,
    availableAt,
    sourceId: typeof input.sourceId === 'string' && input.sourceId.trim() ? input.sourceId.trim() : null,
    qualityReasons: Object.freeze([...(input.qualityReasons || [])].filter(Boolean).sort()),
    requiredForV1: input.requiredForV1 !== false,
    detail: input.detail ?? null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function summarizeDw4Evidence(observations = []) {
  const evidence = [...observations];
  const required = evidence.filter((item) => item.requiredForV1 !== false);
  let state = 'INSUFFICIENT_EVIDENCE';
  if (required.some((item) => item.state === 'QUALITY_INSUFFICIENT')) {
    state = 'QUALITY_BLOCKED';
  } else if (required.some((item) => ['UNAVAILABLE', 'STALE'].includes(item.state)) || required.length === 0) {
    state = 'INSUFFICIENT_EVIDENCE';
  } else {
    const up = required.some((item) => item.state === 'SUPPORTS_UP');
    const down = required.some((item) => item.state === 'SUPPORTS_DOWN');
    const internal = required.some((item) => item.state === 'CONFLICT_INTERNAL');
    if (internal || (up && down)) state = 'MIXED';
    else if (up) state = 'ALIGNED_UP';
    else if (down) state = 'ALIGNED_DOWN';
  }
  return Object.freeze({
    schemaVersion: 'dw4-evidence-conflict-summary-v1',
    state,
    evidenceCount: evidence.length,
    evidence: Object.freeze(evidence),
    score: null,
    confidence: null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

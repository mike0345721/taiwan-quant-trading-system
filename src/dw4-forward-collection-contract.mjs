const REQUIRED_TEXT = Object.freeze([
  'source',
  'sourceId',
  'instrument',
  'market',
  'tradeDate',
  'session',
  'eventTime',
  'receivedAt',
  'availableAt',
  'rawPayloadHash',
  'qualityStatus',
  'collectionRunId',
  'collectorVersion',
]);

export const DW4_COLLECTION_HEALTH_STATES = Object.freeze([
  'AVAILABLE',
  'PARTIAL',
  'STALE',
  'MISSING',
  'UNAVAILABLE',
  'QUALITY_INSUFFICIENT',
  'UNKNOWN',
]);

export const DW4_NATIVE_SEQUENCE_STATES = Object.freeze(['AVAILABLE', 'UNAVAILABLE']);

function parsedTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = Date.parse(value);
  return Number.isFinite(result) ? result : null;
}

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function validateDw4ForwardCollectionRecord(record = {}) {
  const errors = [];
  for (const key of REQUIRED_TEXT) {
    if (!text(record[key])) errors.push(`${key.toUpperCase()}_REQUIRED`);
  }
  if (record.researchOnly !== true) errors.push('RESEARCH_ONLY_REQUIRED');
  if (record.executionAuthorized !== false) errors.push('EXECUTION_MUST_BE_FALSE');
  if (record.orderRoutesEnabled !== false) errors.push('ORDER_ROUTES_MUST_BE_FALSE');
  if (record.formalWeight !== 0) errors.push('FORMAL_WEIGHT_MUST_BE_ZERO');
  if (!DW4_COLLECTION_HEALTH_STATES.includes(record.qualityStatus)) errors.push('QUALITY_STATUS_INVALID');
  if (!DW4_NATIVE_SEQUENCE_STATES.includes(record.nativeSequenceAvailability)) errors.push('NATIVE_SEQUENCE_AVAILABILITY_INVALID');
  if (record.nativeSequenceAvailability === 'UNAVAILABLE' && record.nativeSequence != null) errors.push('NATIVE_SEQUENCE_MUST_BE_NULL');
  if (record.nativeSequenceAvailability === 'AVAILABLE'
    && (!Number.isInteger(record.nativeSequence) || record.nativeSequence < 0)) {
    errors.push('NATIVE_SEQUENCE_REQUIRED');
  }
  if (text(record.rawPayloadHash) && !/^[a-f0-9]{64}$/i.test(record.rawPayloadHash)) errors.push('RAW_PAYLOAD_HASH_INVALID');

  const eventMs = parsedTime(record.eventTime);
  const receivedMs = parsedTime(record.receivedAt);
  const availableMs = parsedTime(record.availableAt);
  if (record.eventTime && eventMs == null) errors.push('EVENT_TIME_INVALID');
  if (record.receivedAt && receivedMs == null) errors.push('RECEIVED_AT_INVALID');
  if (record.availableAt && availableMs == null) errors.push('AVAILABLE_AT_INVALID');
  if (availableMs != null && eventMs != null && availableMs < eventMs) errors.push('AVAILABLE_AT_BEFORE_EVENT');
  if (availableMs != null && receivedMs != null && availableMs < receivedMs) errors.push('AVAILABLE_AT_BEFORE_RECEIVED');

  const timestampLineageQuality = eventMs != null && receivedMs != null && receivedMs < eventMs
    ? 'QUALITY_INSUFFICIENT'
    : 'PASS';
  const qualityReasons = new Set(Array.isArray(record.qualityReasons) ? record.qualityReasons.filter(text) : []);
  if (timestampLineageQuality === 'QUALITY_INSUFFICIENT') qualityReasons.add('TIMESTAMP_LINEAGE_INSUFFICIENT');
  if (timestampLineageQuality === 'QUALITY_INSUFFICIENT' && record.qualityStatus !== 'QUALITY_INSUFFICIENT') {
    errors.push('TIMESTAMP_LINEAGE_REQUIRES_QUALITY_INSUFFICIENT');
  }

  if (errors.length) return Object.freeze({ ok: false, errors: Object.freeze([...new Set(errors)]), canonical: null });
  return Object.freeze({
    ok: true,
    errors: Object.freeze([]),
    canonical: Object.freeze({
      schemaVersion: 'dw4-forward-collection-v1',
      source: text(record.source),
      sourceId: text(record.sourceId),
      instrument: text(record.instrument),
      market: text(record.market),
      tradeDate: text(record.tradeDate),
      session: text(record.session),
      contract: text(record.contract),
      expiry: text(record.expiry),
      eventTime: new Date(eventMs).toISOString(),
      receivedAt: new Date(receivedMs).toISOString(),
      availableAt: new Date(availableMs).toISOString(),
      nativeSequenceAvailability: record.nativeSequenceAvailability,
      nativeSequence: record.nativeSequenceAvailability === 'AVAILABLE' ? record.nativeSequence : null,
      rawPayloadHash: record.rawPayloadHash.toLowerCase(),
      qualityStatus: record.qualityStatus,
      qualityReasons: Object.freeze([...qualityReasons].sort()),
      timestampLineageQuality,
      collectionRunId: text(record.collectionRunId),
      collectorVersion: text(record.collectorVersion),
      payload: record.payload ?? null,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    }),
  });
}

export const DW4_COLLECTION_ACTIVATION_BOUNDARY = Object.freeze({
  schemaVersion: 'dw4-collection-activation-boundary-v1',
  existingCollectorReuseRequired: true,
  duplicateCollectorAllowed: false,
  productionActivationApproved: false,
  windowsStartupModified: false,
  continuitySupervisorActivated: false,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
});

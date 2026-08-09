const REQUIRED_TEXT = ['source', 'instrument', 'market', 'tradeDate', 'session', 'eventTime', 'receivedAt', 'availableAt', 'rawPayloadHash', 'qualityStatus'];
const QUALITY = new Set(['VALID', 'PARTIAL', 'STALE', 'INVALID']);

function parseTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function validateMarketStateCollectionRecord(record = {}) {
  const errors = [];
  if (record.executionAuthorized !== false) errors.push('EXECUTION_MUST_BE_FALSE');
  if (record.researchOnly !== true) errors.push('RESEARCH_ONLY_REQUIRED');
  for (const key of REQUIRED_TEXT) {
    if (typeof record[key] !== 'string' || !record[key].trim()) errors.push(`${key.toUpperCase()}_REQUIRED`);
  }
  const eventMs = parseTime(record.eventTime);
  const receivedMs = parseTime(record.receivedAt);
  const availableMs = parseTime(record.availableAt);
  if (record.eventTime && eventMs == null) errors.push('EVENT_TIME_INVALID');
  if (record.receivedAt && receivedMs == null) errors.push('RECEIVED_AT_INVALID');
  if (record.availableAt && availableMs == null) errors.push('AVAILABLE_AT_INVALID');
  if (eventMs != null && availableMs != null && availableMs < eventMs) errors.push('AVAILABLE_AT_BEFORE_EVENT');
  if (availableMs != null && receivedMs != null && availableMs > receivedMs) errors.push('AVAILABLE_AT_AFTER_RECEIVED');
  if (typeof record.rawPayloadHash === 'string' && !/^[a-f0-9]{64}$/i.test(record.rawPayloadHash)) errors.push('RAW_PAYLOAD_HASH_INVALID');
  if (typeof record.qualityStatus === 'string' && !QUALITY.has(record.qualityStatus)) errors.push('QUALITY_STATUS_INVALID');
  if (record.orderRoutesEnabled === true) errors.push('ORDER_ROUTES_MUST_NOT_BE_ENABLED');
  return {
    ok: errors.length === 0,
    errors: [...new Set(errors)],
    canonical: errors.length ? null : {
      schemaVersion: 'market-state-collection-v1',
      source: record.source,
      instrument: record.instrument,
      market: record.market,
      tradeDate: record.tradeDate,
      session: record.session,
      eventTime: record.eventTime,
      receivedAt: record.receivedAt,
      availableAt: record.availableAt,
      sourceId: record.sourceId ?? null,
      sequence: record.sequence ?? null,
      rawPayloadHash: record.rawPayloadHash.toLowerCase(),
      qualityStatus: record.qualityStatus,
      payload: record.payload ?? null,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    },
  };
}

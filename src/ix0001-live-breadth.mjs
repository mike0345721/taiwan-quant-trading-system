import crypto from 'node:crypto';

export const IX0001_BREADTH_FIELDS = Object.freeze([
  'raise_count', 'fall_count', 'flat_count', 'limit_up_count', 'limit_down_count', 'no_trade',
]);

export const IX0001_BREADTH_CONTRACT = Object.freeze({
  schemaVersion: 'ix0001-live-breadth-v1',
  provider: 'shioaji',
  sourceId: 'SHIOAJI_INDEX_QUOTE_IX0001',
  callback: 'set_on_quote_idx_v1_callback',
  ledgerKind: 'index_quote',
  instrument: 'IX0001',
  market: 'TWSE',
  sessionCoverage: 'TWSE_DAY_0900_1330_PLUS_CLOSING_QUOTE',
  nightSession: 'NOT_APPLICABLE',
  resetBehavior: 'TRADE_DATE_SCOPED_PROVIDER_SNAPSHOT',
  duplicateCollectorAllowed: false,
  promotionState: 'RAW_ONLY',
  maximumPromotionReadiness: 'RAW_VALIDATED_CANDIDATE',
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
});

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function sha256(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function iso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}+08:00`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function nonNegativeInteger(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isInteger(number) && number >= 0 ? number : null;
}

function taipeiMinute(instant) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(new Date(instant)).filter((part) => part.type !== 'literal')
    .map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function sessionAt(eventTime) {
  const minute = taipeiMinute(eventTime);
  if (minute < 8 * 60 + 45) return 'PREMARKET';
  if (minute < 13 * 60 + 45) return 'DAY';
  return 'AFTER_MARKET';
}

export function extractIx0001Breadth(record = {}) {
  const reasons = [];
  if (record.kind !== 'index_quote') reasons.push('SOURCE_KIND_MISMATCH');
  if (record.code !== 'IX0001' || record.product !== 'IX0001') reasons.push('SOURCE_IDENTITY_MISMATCH');
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
  const eventTime = iso(record.exchangeTimestamp || payload.datetime);
  const receivedAt = iso(payload._received_at || record.receivedAt);
  if (!eventTime) reasons.push('EVENT_TIME_MISSING_OR_INVALID');
  if (!receivedAt) reasons.push('RECEIVED_AT_MISSING_OR_INVALID');
  const tradeDate = typeof payload.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)
    ? payload.date
    : null;
  if (!tradeDate) reasons.push('TRADE_DATE_MISSING_OR_INVALID');
  const fields = {};
  for (const field of IX0001_BREADTH_FIELDS) {
    const value = nonNegativeInteger(payload[field]);
    if (value == null) reasons.push(`MISSING_OR_INVALID_${field.toUpperCase()}`);
    else fields[field] = value;
  }
  const session = eventTime ? sessionAt(eventTime) : 'UNKNOWN';
  if (session !== 'DAY') reasons.push(`SESSION_${session}_NOT_ELIGIBLE_FOR_LIVE_BREADTH`);
  const eventMs = eventTime ? Date.parse(eventTime) : null;
  const receivedMs = receivedAt ? Date.parse(receivedAt) : null;
  const availableAt = eventMs != null && receivedMs != null
    ? new Date(Math.max(eventMs, receivedMs)).toISOString()
    : null;
  if (eventMs != null && receivedMs != null && receivedMs < eventMs) {
    reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  }
  const qualityStatus = reasons.length ? 'QUALITY_INSUFFICIENT' : 'AVAILABLE';
  const canonicalRaw = { tradeDate, session, eventTime, receivedAt, ...fields };
  return Object.freeze({
    schemaVersion: IX0001_BREADTH_CONTRACT.schemaVersion,
    source: 'shioaji',
    sourceId: IX0001_BREADTH_CONTRACT.sourceId,
    instrument: 'IX0001',
    market: 'TWSE',
    tradeDate,
    session,
    contract: 'IX0001',
    eventTime,
    receivedAt,
    availableAt,
    breadth: Object.freeze(fields),
    rawPayloadHash: sha256(canonicalRaw),
    nativeSequenceAvailability: 'UNAVAILABLE',
    nativeSequence: null,
    qualityStatus,
    qualityReasons: Object.freeze([...new Set(reasons)].sort()),
    promotionState: 'RAW_ONLY',
    directionState: 'NOT_ELIGIBLE',
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function auditIx0001Breadth(records = [], { tradeDate, asOf } = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('TRADE_DATE_REQUIRED');
  const asOfMs = Date.parse(asOf || '');
  if (!Number.isFinite(asOfMs)) throw new Error('AS_OF_INVALID');
  const extracted = records.map(extractIx0001Breadth)
    .filter((item) => item.tradeDate === tradeDate)
    .sort((left, right) => (left.availableAt || '').localeCompare(right.availableAt || ''));
  const futureDataViolations = extracted.filter((item) => Date.parse(item.availableAt || '') > asOfMs).length;
  const legal = extracted.filter((item) => Date.parse(item.availableAt || '') <= asOfMs);
  const day = legal.filter((item) => item.session === 'DAY');
  const clean = day.filter((item) => item.qualityStatus === 'AVAILABLE');
  const qualityInsufficient = day.filter((item) => item.qualityStatus === 'QUALITY_INSUFFICIENT');
  const missingFieldReasons = unique(extracted.flatMap((item) => item.qualityReasons)
    .filter((reason) => reason.startsWith('MISSING_OR_INVALID_')));
  const status = clean.length > 0 && futureDataViolations === 0 && missingFieldReasons.length === 0
    ? 'RAW_VALIDATED_CANDIDATE'
    : 'NOT_READY';
  return Object.freeze({
    schemaVersion: 'ix0001-live-breadth-audit-v1',
    tradeDate,
    asOf: new Date(asOfMs).toISOString(),
    status,
    callback: IX0001_BREADTH_CONTRACT.callback,
    sourceId: IX0001_BREADTH_CONTRACT.sourceId,
    recordCount: legal.length,
    dayRecordCount: day.length,
    cleanRecordCount: clean.length,
    qualityInsufficientRecordCount: qualityInsufficient.length,
    qualityReasonCounts: Object.freeze(Object.fromEntries([...new Set(qualityInsufficient
      .flatMap((item) => item.qualityReasons))].sort().map((reason) => [
      reason,
      qualityInsufficient.filter((item) => item.qualityReasons.includes(reason)).length,
    ]))),
    firstEventTime: day[0]?.eventTime || null,
    lastEventTime: day.at(-1)?.eventTime || null,
    latestAvailableAt: day.at(-1)?.availableAt || null,
    futureDataViolations,
    coverageState: day.length > 0
      && taipeiMinute(day[0].eventTime) <= 9 * 60 + 1
      && taipeiMinute(day.at(-1).eventTime) >= 13 * 60 + 30
      ? 'COMPLETE' : day.length > 0 ? 'PARTIAL' : 'INSUFFICIENT',
    expectedSessionWindow: 'TWSE_DAY_0900_1330_PLUS_CLOSING_QUOTE',
    missingFieldReasons,
    nightSession: 'NOT_APPLICABLE',
    resetBehavior: IX0001_BREADTH_CONTRACT.resetBehavior,
    promotionState: 'RAW_ONLY',
    directionState: 'NOT_ELIGIBLE',
    deterministicReplayHash: sha256(legal),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

function unique(values) {
  return Object.freeze([...new Set(values)].sort());
}

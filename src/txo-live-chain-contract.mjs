import crypto from 'node:crypto';

export const TXO_UNIVERSE_OPTIONS = Object.freeze({
  A: Object.freeze({ id: 'BOUNDED_FULL_RELEVANT_EXPIRY_CHAIN', decision: 'REJECTED_FOR_V1_LOAD_RISK' }),
  B: Object.freeze({ id: 'GOVERNED_NEAR_MARKET_LIQUID_PAIRS', decision: 'RECOMMENDED' }),
  C: Object.freeze({ id: 'DYNAMIC_VOLUME_RANKED_UNIVERSE', decision: 'REJECTED_NON_REPLAYABLE_WITHOUT_FROZEN_SNAPSHOT' }),
});

export const TXO_LIVE_CHAIN_CONTRACT = Object.freeze({
  schemaVersion: 'txo-live-chain-forward-v1',
  source: 'shioaji',
  sourceId: 'SHIOAJI_FOP_TXO_TICK_BIDASK',
  sourceRoot: 'TXO',
  sourceRootExpiryClass: 'MONTHLY',
  weeklyRootStatus: 'NOT_VERIFIED_IN_CURRENT_TXO_ROOT',
  recommendedUniverse: TXO_UNIVERSE_OPTIONS.B.id,
  selectionInputs: Object.freeze([
    'providerContractSnapshot', 'underlyingPrice', 'twoSidedQuoteSnapshot', 'ownerApprovedMaxContracts',
  ]),
  selectionRule: 'NEAREST_NON_EXPIRED_TXO_EXPIRY_THEN_NEAREST_TWO_SIDED_CALL_PUT_PAIRS',
  expirySwitch: 'REBUILD_ONLY_FROM_NEW_GOVERNED_SELECTION_SNAPSHOT',
  settlementDay: 'NO_SILENT_SWITCH',
  secondLoginAllowed: false,
  secondBridgeAllowed: false,
  secondWriterAllowed: false,
  productionActivationApproved: false,
  windowsActivationPerformed: false,
  nativeSequenceAvailability: 'UNAVAILABLE',
  packetLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
  rawOptionsAreValidatedIv: false,
  providerGreeksAvailable: false,
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

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function iso(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}+08:00`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function number(value) {
  if (value == null || value === '') return null;
  const parsed = Number(Array.isArray(value) ? value[0] : value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function normalizeTxoLiveRecord(record = {}) {
  const payload = record.payload && typeof record.payload === 'object' ? record.payload : {};
  const reasons = [];
  if (!['options_tick', 'options_bidask'].includes(record.kind)) reasons.push('EVENT_KIND_INVALID');
  const contract = String(payload.code || record.code || '').trim() || null;
  const expiry = String(payload._expiry || '').trim() || null;
  const strike = number(payload._strike);
  const callPut = String(payload._call_put || '').toUpperCase();
  if (!contract?.startsWith('TXO')) reasons.push('TXO_CONTRACT_REQUIRED');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expiry || '')) reasons.push('EXPIRY_REQUIRED');
  if (!(strike > 0)) reasons.push('STRIKE_REQUIRED');
  if (!['C', 'P'].includes(callPut)) reasons.push('CALL_PUT_REQUIRED');
  const eventTime = iso(record.exchangeTimestamp || payload.datetime);
  const receivedAt = iso(payload._received_at || record.receivedAt);
  if (!eventTime) reasons.push('EVENT_TIME_INVALID');
  if (!receivedAt) reasons.push('RECEIVED_AT_INVALID');
  const eventMs = eventTime ? Date.parse(eventTime) : null;
  const receivedMs = receivedAt ? Date.parse(receivedAt) : null;
  const availableAt = eventMs != null && receivedMs != null
    ? new Date(Math.max(eventMs, receivedMs)).toISOString()
    : null;
  if (eventMs != null && receivedMs != null && receivedMs < eventMs) reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  const bidPrice = number(payload.bid_price ?? payload.bid);
  const bidSize = number(payload.bid_volume ?? payload.bid_size);
  const askPrice = number(payload.ask_price ?? payload.ask);
  const askSize = number(payload.ask_volume ?? payload.ask_size);
  if (record.kind === 'options_bidask' && !(bidPrice >= 0 && askPrice >= bidPrice && bidSize >= 0 && askSize >= 0)) {
    reasons.push('TWO_SIDED_QUOTE_INVALID');
  }
  const lastPrice = number(payload.close ?? payload.price);
  const volume = number(payload.volume);
  const openInterest = number(payload.open_interest ?? payload.openInterest);
  const raw = {
    contract, expiry, strike, callPut, eventTime, receivedAt,
    bidPrice, bidSize, askPrice, askSize, lastPrice, volume, openInterest,
  };
  return Object.freeze({
    schemaVersion: TXO_LIVE_CHAIN_CONTRACT.schemaVersion,
    source: 'shioaji',
    sourceId: TXO_LIVE_CHAIN_CONTRACT.sourceId,
    instrument: 'TXO',
    market: 'TAIFEX',
    tradeDate: typeof payload._trade_date === 'string' ? payload._trade_date : null,
    session: typeof payload._session === 'string' ? payload._session : 'UNKNOWN',
    contract,
    expiry,
    strike,
    callPut,
    eventTime,
    receivedAt,
    availableAt,
    bidPrice,
    bidSize,
    askPrice,
    askSize,
    lastPrice,
    volume,
    openInterest,
    underlying: 'TX',
    underlyingEventTime: iso(payload._underlying_event_time),
    nativeSequenceAvailability: 'UNAVAILABLE',
    nativeSequence: null,
    rawPayloadHash: hash(raw),
    collectionRunId: String(payload._collection_run_id || '').trim() || null,
    collectorVersion: 'shioaji-readonly-bridge-txo-v1',
    qualityStatus: reasons.length ? 'QUALITY_INSUFFICIENT' : 'AVAILABLE',
    qualityReasons: Object.freeze([...new Set(reasons)].sort()),
    impliedVolatility: null,
    skew: null,
    providerGreeks: null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function evaluateTxoCollectionHealth(input = {}) {
  const expected = Number(input.expectedSubscriptionCount);
  const restored = Number(input.restoredSubscriptionCount);
  const writerPass = input.writerState === 'PASS';
  const countersPass = [input.dropped, input.callbackErrors, input.writerErrors]
    .every((value) => Number(value || 0) === 0);
  let collectorState = 'UNAVAILABLE';
  let coverageStatus = 'MISSING';
  if (input.enabled !== true) {
    collectorState = 'STOPPED_EXPECTED';
    coverageStatus = 'MISSING';
  } else if (!Number.isInteger(expected) || expected <= 0) {
    collectorState = 'UNKNOWN';
  } else if (!writerPass || !countersPass || restored !== expected) {
    collectorState = 'DEGRADED';
    coverageStatus = restored > 0 ? 'PARTIAL' : 'UNAVAILABLE';
  } else {
    collectorState = 'HEALTHY';
    coverageStatus = 'AVAILABLE';
  }
  return Object.freeze({
    schemaVersion: 'txo-live-chain-health-v1',
    collectorState,
    subscriptionCount: Number(input.subscriptionCount || 0),
    expectedSubscriptionCount: Number.isInteger(expected) ? expected : null,
    restoredSubscriptionCount: Number.isInteger(restored) ? restored : null,
    lastQuoteAt: input.lastQuoteAt || null,
    latestEventTime: input.latestEventTime || null,
    latestReceivedAt: input.latestReceivedAt || null,
    writerState: input.writerState || 'UNKNOWN',
    queueDepth: Number(input.queueDepth || 0),
    dropped: Number(input.dropped || 0),
    callbackErrors: Number(input.callbackErrors || 0),
    writerErrors: Number(input.writerErrors || 0),
    diskHealth: input.diskHealth || 'UNKNOWN',
    coverageStatus,
    nativeSequenceAvailability: 'UNAVAILABLE',
    packetLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function estimateTxoStorage({ eventsPerMinute, averageBytesPerEvent, activeHoursPerDay }) {
  for (const value of [eventsPerMinute, averageBytesPerEvent, activeHoursPerDay]) {
    if (!Number.isFinite(Number(value)) || Number(value) < 0) throw new Error('ESTIMATE_INPUT_INVALID');
  }
  const eventsPerHour = Number(eventsPerMinute) * 60;
  const bytesPerHour = eventsPerHour * Number(averageBytesPerEvent);
  return Object.freeze({ eventsPerMinute: Number(eventsPerMinute), eventsPerHour, bytesPerHour,
    bytesPerDay: bytesPerHour * Number(activeHoursPerDay), measured: false });
}

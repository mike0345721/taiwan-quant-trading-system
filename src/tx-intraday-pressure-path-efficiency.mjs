const TX_MARKET_KINDS = new Set(['futures_tick', 'futures_bidask']);
const CONTINUITY_BREAK_KINDS = new Set([
  'futures_reconnect_resubscribe_started',
  'quote_type_resubscribe',
  'quote_type_reconnect_resubscribe',
]);

function text(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

export function timestampMs(value) {
  const raw = text(value);
  if (!raw) return null;
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(raw) ? raw : `${raw}+08:00`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? parsed : null;
}

function txRecord(record) {
  if (!TX_MARKET_KINDS.has(record?.kind)) return false;
  const payload = record?.payload || {};
  const family = text(payload.productFamily) || text(payload._product_family);
  if (family) return family === 'TX';
  const code = text(payload.actualContract) || text(payload.targetCode)
    || text(payload._target_code) || text(payload.code) || text(record?.code)
    || text(record?.product);
  return Boolean(code && /^TXF/i.test(code));
}

function txContinuityBreak(record) {
  if (!CONTINUITY_BREAK_KINDS.has(record?.kind)) return false;
  const payload = record?.payload || {};
  if (text(payload.product) === 'TX') return true;
  if (Array.isArray(payload.products) && payload.products.some((item) => String(item) === 'TX')) return true;
  const actual = text(payload.actualContract);
  return Boolean(actual && /^TXF/i.test(actual));
}

function eventTimeOf(record) {
  const payload = record?.payload || {};
  return text(payload.eventTime) || text(payload.datetime)
    || text(payload.timestamp) || text(record?.exchangeTimestamp);
}

function actualContractOf(record) {
  const payload = record?.payload || {};
  return text(payload.actualContract) || text(payload.targetCode)
    || text(payload._target_code) || text(payload.code)
    || text(record?.code) || text(record?.product);
}

function explicitIdentity(record) {
  const payload = record?.payload || {};
  return {
    tradeDate: text(payload.tradeDate) || text(payload._trade_date) || text(record?.tradeDate),
    session: text(payload.session) || text(payload._session) || text(record?.session),
  };
}

function assertSafety(record) {
  if (record?.formalWeight !== 0
      || record?.researchOnly !== true
      || record?.executionAuthorized !== false
      || record?.orderRoutesEnabled !== false) {
    throw new Error('CRU34_SAFETY_BOUNDARY_INVALID');
  }
}

function identityFor(record, eventTime, resolveSessionTradeDate) {
  const explicit = explicitIdentity(record);
  if (explicit.tradeDate && explicit.session) return explicit;
  if (typeof resolveSessionTradeDate !== 'function' || !eventTime) return explicit;
  let resolved = null;
  try {
    resolved = resolveSessionTradeDate(eventTime, record) || null;
  } catch {
    resolved = null;
  }
  return {
    tradeDate: explicit.tradeDate || text(resolved?.tradeDate) || text(resolved?.sessionTradeDate),
    session: explicit.session || text(resolved?.session),
  };
}

export function materializeTxCanonicalObservations(records, {
  sourceLedgerIdentity,
  resolveSessionTradeDate = null,
} = {}) {
  if (!Array.isArray(records)) throw new Error('CRU34_RECORDS_REQUIRED');
  const sourceIdentity = text(sourceLedgerIdentity);
  if (!sourceIdentity) throw new Error('CRU34_SOURCE_LEDGER_IDENTITY_REQUIRED');

  const events = [];
  let epoch = 1;
  let breakPending = false;
  let breakReason = 'LEDGER_PREFIX_START';
  let seenTick = false;
  let seenBidAsk = false;
  let lastReceivedMs = null;
  let epochLineageInvalid = false;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const ledgerOrdinal = index + 1;

    if (txContinuityBreak(record)) {
      breakPending = true;
      breakReason = record.kind;
      continue;
    }

    if (breakPending && txRecord(record)) {
      epoch += 1;
      breakPending = false;
      seenTick = false;
      seenBidAsk = false;
      lastReceivedMs = null;
      epochLineageInvalid = false;
    }

    const physicalReceivedMs = timestampMs(record?.receivedAt);
    if (physicalReceivedMs == null) {
      epochLineageInvalid = true;
    } else if (lastReceivedMs != null && physicalReceivedMs < lastReceivedMs) {
      epochLineageInvalid = true;
    }
    if (physicalReceivedMs != null) lastReceivedMs = physicalReceivedMs;

    if (!txRecord(record) || record?.duplicate === true || record?.payload?.simtrade === true) continue;
    assertSafety(record);

    const payload = record.payload || {};
    const eventTime = eventTimeOf(record);
    const eventMs = timestampMs(eventTime);
    const receivedAt = text(record.receivedAt);
    const receivedMs = timestampMs(receivedAt);
    const actualContract = actualContractOf(record);
    const { tradeDate, session } = identityFor(record, eventTime, resolveSessionTradeDate);
    const recordHash = text(record.recordHash);

    let availabilityLineageStatus = 'USABLE';
    const qualityReasons = [];
    if (receivedMs == null) {
      availabilityLineageStatus = 'INVALID_RECEIVED_AT';
      qualityReasons.push('RECEIVED_AT_INVALID');
    } else if (epochLineageInvalid) {
      availabilityLineageStatus = 'INVALID_NON_MONOTONIC_RECEIVED_AT';
      qualityReasons.push('CONTINUITY_SEGMENT_LINEAGE_INVALID');
    }
    if (!recordHash) qualityReasons.push('RECORD_HASH_MISSING');
    if (eventMs == null) qualityReasons.push('EVENT_TIME_INVALID');
    if (!actualContract) qualityReasons.push('ACTUAL_CONTRACT_MISSING');
    if (!tradeDate) qualityReasons.push('TRADE_DATE_MISSING');
    if (!session) qualityReasons.push('SESSION_MISSING');

    if (record.kind === 'futures_tick') seenTick = true;
    if (record.kind === 'futures_bidask') seenBidAsk = true;
    const joinedContinuityStatus = seenTick && seenBidAsk ? 'USABLE' : 'WARMING';

    const identityStatus = actualContract && tradeDate && session && eventMs != null
      ? 'USABLE' : 'INCOMPLETE';
    if (availabilityLineageStatus !== 'USABLE' || !recordHash || identityStatus !== 'USABLE') {
      if (!qualityReasons.length) qualityReasons.push('CANONICAL_LINEAGE_INCOMPLETE');
    }

    events.push(Object.freeze({
      kind: record.kind,
      instrument: 'TX',
      product: 'TX',
      market: 'TAIFEX',
      actualContract,
      tradeDate,
      session,
      continuityEpoch: `TX:${epoch}`,
      continuityBasis: epoch === 1 ? 'LEDGER_PREFIX_START' : breakReason,
      joinedContinuityStatus,
      eventTime,
      eventMs,
      receivedAt,
      availableAt: receivedAt,
      availableMs: receivedMs,
      availabilityLineageStatus,
      identityStatus,
      ledgerOrdinal,
      recordHash,
      sourceLedgerIdentity: sourceIdentity,
      payload,
      qualityReasons: Object.freeze([...new Set(qualityReasons)]),
      rawRecord: record,
    }));
  }

  return Object.freeze({
    schemaVersion: 'cru34-canonical-observation-lineage-v1',
    sourceLedgerIdentity: sourceIdentity,
    events: Object.freeze(events),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

function mismatchReason(quote, tick) {
  if (quote.actualContract !== tick.actualContract) return 'ACTUAL_CONTRACT_MISMATCH';
  if (quote.tradeDate !== tick.tradeDate) return 'TRADE_DATE_MISMATCH';
  if (quote.session !== tick.session) return 'SESSION_MISMATCH';
  if (quote.continuityEpoch !== tick.continuityEpoch) return 'CONTINUITY_EPOCH_MISMATCH';
  return null;
}

export function evaluateBestQuoteEligibility(quote, tick, { maxQuoteAgeMs = 2_000 } = {}) {
  if (quote?.kind !== 'futures_bidask' || tick?.kind !== 'futures_tick') {
    return Object.freeze({ eligible: false, reason: 'KIND_MISMATCH', quoteAgeMs: null });
  }
  const mismatch = mismatchReason(quote, tick);
  if (mismatch) return Object.freeze({ eligible: false, reason: mismatch, quoteAgeMs: null });
  if (!(quote.ledgerOrdinal < tick.ledgerOrdinal)) {
    return Object.freeze({ eligible: false, reason: 'QUOTE_NOT_PHYSICALLY_PRIOR', quoteAgeMs: null });
  }
  if (tick.joinedContinuityStatus !== 'USABLE') {
    return Object.freeze({ eligible: false, reason: 'CONTINUITY_NOT_READY', quoteAgeMs: null });
  }
  if (quote.availabilityLineageStatus !== 'USABLE' || tick.availabilityLineageStatus !== 'USABLE') {
    return Object.freeze({ eligible: false, reason: 'AVAILABILITY_LINEAGE_UNUSABLE', quoteAgeMs: null });
  }
  if (quote.identityStatus !== 'USABLE' || tick.identityStatus !== 'USABLE') {
    return Object.freeze({ eligible: false, reason: 'IDENTITY_UNUSABLE', quoteAgeMs: null });
  }
  if (!quote.recordHash || !tick.recordHash || quote.sourceLedgerIdentity !== tick.sourceLedgerIdentity) {
    return Object.freeze({ eligible: false, reason: 'LEDGER_LINEAGE_UNUSABLE', quoteAgeMs: null });
  }
  if (quote.eventMs == null || tick.eventMs == null || quote.eventMs > tick.eventMs) {
    return Object.freeze({ eligible: false, reason: 'QUOTE_EVENT_TIME_FUTURE', quoteAgeMs: null });
  }
  if (quote.availableMs == null || tick.availableMs == null || quote.availableMs > tick.availableMs) {
    return Object.freeze({ eligible: false, reason: 'QUOTE_AVAILABLE_AT_FUTURE', quoteAgeMs: null });
  }
  const quoteAgeMs = tick.eventMs - quote.eventMs;
  if (quoteAgeMs < 0 || quoteAgeMs > maxQuoteAgeMs) {
    return Object.freeze({ eligible: false, reason: 'QUOTE_STALE_OR_FUTURE', quoteAgeMs });
  }
  return Object.freeze({ eligible: true, reason: null, quoteAgeMs });
}

export function buildSnapshotLineage(usedEvents, cutoffEvent) {
  if (!Array.isArray(usedEvents) || !cutoffEvent) throw new Error('CRU34_LINEAGE_INPUT_REQUIRED');
  if (!cutoffEvent.recordHash || !cutoffEvent.sourceLedgerIdentity) {
    throw new Error('CRU34_CUTOFF_LINEAGE_REQUIRED');
  }
  const source = cutoffEvent.sourceLedgerIdentity;
  const usable = usedEvents.filter(Boolean);
  for (const event of usable) {
    if (event.sourceLedgerIdentity !== source) throw new Error('CRU34_SOURCE_LEDGER_MISMATCH');
    if (!(event.ledgerOrdinal <= cutoffEvent.ledgerOrdinal)) throw new Error('CRU34_INPUT_AFTER_CUTOFF');
    if (event.availabilityLineageStatus !== 'USABLE') throw new Error('CRU34_INPUT_LINEAGE_UNUSABLE');
  }
  const maxUsed = usable.reduce((latest, event) => (
    !latest || event.ledgerOrdinal > latest.ledgerOrdinal ? event : latest
  ), null);
  const available = usable.reduce((latest, event) => (
    latest == null || event.availableMs > latest.availableMs ? event : latest
  ), null);
  return Object.freeze({
    availableAt: available?.availableAt || cutoffEvent.availableAt,
    cutoffLedgerOrdinal: cutoffEvent.ledgerOrdinal,
    cutoffRecordHash: cutoffEvent.recordHash,
    maxUsedLedgerOrdinal: maxUsed?.ledgerOrdinal || cutoffEvent.ledgerOrdinal,
    maxUsedRecordHash: maxUsed?.recordHash || cutoffEvent.recordHash,
    sourceLedgerIdentity: source,
  });
}

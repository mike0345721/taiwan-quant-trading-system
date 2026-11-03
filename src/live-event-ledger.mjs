import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function canonical(value) {
  return JSON.stringify(stable(value));
}

function hash(previousHash, body) {
  return crypto.createHash('sha256').update(`${previousHash}\n${canonical(body)}`).digest('hex');
}

function percentile(sorted, fraction) {
  if (!sorted.length) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * fraction) - 1));
  return sorted[index];
}

function timestampMs(value, { assumeTaipei = false } = {}) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}${assumeTaipei ? '+08:00' : ''}`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? parsed : null;
}

function expectedClosingAuctionLag(record, receivedMs, exchangeMs) {
  if (!Number.isFinite(receivedMs) || !Number.isFinite(exchangeMs)) return false;
  const receivedTaipei = new Date(receivedMs + 8 * 60 * 60_000);
  const exchangeTaipei = new Date(exchangeMs + 8 * 60 * 60_000);
  const receivedSeconds = receivedTaipei.getUTCHours() * 3600
    + receivedTaipei.getUTCMinutes() * 60
    + receivedTaipei.getUTCSeconds();
  const exchangeSeconds = exchangeTaipei.getUTCHours() * 3600
    + exchangeTaipei.getUTCMinutes() * 60
    + exchangeTaipei.getUTCSeconds();
  return record?.kind === 'stock_tick'
    && exchangeSeconds === 13 * 3600 + 30 * 60
    && receivedSeconds >= 13 * 3600 + 30 * 60
    && receivedSeconds <= 13 * 3600 + 35 * 60;
}

export function taiwanMarketSession(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const weekday = parts.weekday;
  const minutes = Number(parts.hour) * 60 + Number(parts.minute);
  const tradingDay = !['Sat', 'Sun'].includes(weekday);
  const isTradingSession = tradingDay && minutes >= 9 * 60 && minutes <= 13 * 60 + 30;
  let state = 'non_trading_session';
  if (isTradingSession) state = 'trading_session';
  else if (tradingDay && minutes < 9 * 60) state = 'pre_open';
  else if (tradingDay && minutes > 13 * 60 + 30) state = 'after_close';
  return { timeZone: 'Asia/Taipei', weekday, minutes, state, isTradingSession };
}

function forbidden(value) {
  const blocked = /^(api[_-]?key|secret[_-]?key|password|token|credential|order|cancel|position|balance|account)$/i;
  const visit = (item) => {
    if (!item || typeof item !== 'object') return false;
    return Object.entries(item).some(([key, child]) => blocked.test(key) || visit(child));
  };
  return visit(value);
}

export function buildLiveEventRecord(event, previousHash = 'GENESIS') {
  if (!event || typeof event !== 'object') throw new Error('event_required');
  if (!event.receivedAt || Number.isNaN(Date.parse(event.receivedAt))) throw new Error('received_at_invalid');
  if (!event.kind || !event.code) throw new Error('event_identity_required');
  if (event.executionAuthorized !== false || event.orderRoutesEnabled !== false) throw new Error('execution_boundary_invalid');
  if (forbidden(event.payload)) throw new Error('sensitive_or_execution_field_rejected');
  const body = { ...event, previousHash };
  return { ...body, recordHash: hash(previousHash, body) };
}

export function appendLiveEvent(filePath, event) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const audit = fs.existsSync(filePath) ? auditLiveEventLedger(filePath) : { latestHash: 'GENESIS', ok: true };
  if (!audit.ok) throw new Error('existing_ledger_invalid');
  const record = buildLiveEventRecord(event, audit.latestHash);
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  return record;
}

export function auditLiveEventLedger(filePath, { now = new Date(), staleAfterMs = 60_000 } = {}) {
  if (!fs.existsSync(filePath)) return { ok: false, reason: 'ledger_missing', events: 0, latestHash: 'GENESIS' };
  // Freeze the byte boundary before reading. A live writer may continue
  // appending, but events produced while this audit consumes CPU/disk must not
  // leak into the evidence snapshot being evaluated.
  const snapshotBytes = fs.statSync(filePath).size;
  // This synchronous audit materializes the full snapshot and per-event arrays.
  // Match the existing inline daily-acceptance budget; never allocate/read a
  // multi-GB ledger or mistake a bounded prefix for a complete integrity audit.
  const maxAuditBytes = 64 * 1024 * 1024;
  if (snapshotBytes > maxAuditBytes) return {
    ok: false, auditState: 'AUDIT_INCOMPLETE', reason: 'ledger_audit_size_limit',
    events: null, latestHash: null, bytes: snapshotBytes, bytesRead: 0, maxAuditBytes,
    executionAuthorized: false,
  };
  const descriptor = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(snapshotBytes);
  let offset = 0;
  try {
    while (offset < snapshotBytes) {
      const read = fs.readSync(descriptor, buffer, offset, snapshotBytes - offset, offset);
      if (read <= 0) break;
      offset += read;
    }
  } finally {
    fs.closeSync(descriptor);
  }
  const lines = buffer.subarray(0, offset).toString('utf8').split(/\r?\n/).filter(Boolean);
  let previousHash = 'GENESIS';
  let earliestReceivedAt = null;
  let latestReceivedAt = null;
  let latestMarketReceivedAt = null;
  let earliestReceivedMs = null;
  let latestReceivedMs = null;
  let latestMarketReceivedMs = null;
  let previousReceivedMs = null;
  let maxInterEventGapMs = 0;
  let outOfOrderEvents = 0;
  let invalidLines = 0;
  let hashFailures = 0;
  let duplicates = 0;
  let sequenceGaps = 0;
  let clockSkewEvents = 0;
  let regularSessionClockSkewEvents = 0;
  let reconnectEvidenceCycles = 0;
  let reconnectPending = false;
  let latestReconnectReadyAt = null;
  let latestReconnectReadyMs = null;
  let postReconnectProductEvents = {};
  let postReconnectProductStats = {};
  let postReconnectProductKindStats = {};
  let latestCompletedReconnectProductStats = {};
  let latestCompletedReconnectProductKindStats = {};
  let preReconnectProductStats = {};
  const observedOperationalErrors = {
    callbackErrors: 0,
    dropped: 0,
    writerErrors: 0,
  };
  const products = new Set();
  const latencyMs = [];
  const absoluteTimestampOffsetMs = [];
  const kindStats = new Map();
  const productStats = new Map();
  const productKindStats = new Map();
  const regularSessionProductStats = new Map();
  for (const line of lines) {
    try {
      const record = JSON.parse(line);
      const { recordHash, ...body } = record;
      const expected = hash(previousHash, body);
      if (body.previousHash !== previousHash || recordHash !== expected) hashFailures += 1;
      previousHash = recordHash || previousHash;
      if (record.duplicate) duplicates += 1;
      if (Number(record.sequenceGap) > 0) sequenceGaps += Number(record.sequenceGap);
      const callbackReceivedMs = timestampMs(record?.payload?._received_at)
        ?? timestampMs(record.receivedAt);
      const exchangeMs = timestampMs(record.exchangeTimestamp, { assumeTaipei: true });
      const derivedLatencyMs = record.clockSkewMs != null && Number.isFinite(Number(record.clockSkewMs))
        ? Number(record.clockSkewMs)
        : callbackReceivedMs != null && exchangeMs != null
          ? callbackReceivedMs - exchangeMs
          : null;
      if (derivedLatencyMs != null && Math.abs(derivedLatencyMs) > 5_000) clockSkewEvents += 1;
      if (record.product && record.product !== 'bridge' && derivedLatencyMs != null) {
        latencyMs.push(derivedLatencyMs);
        absoluteTimestampOffsetMs.push(Math.abs(derivedLatencyMs));
      }
      if (record.kind) {
        kindStats.set(record.kind, (kindStats.get(record.kind) || 0) + 1);
        for (const counter of Object.keys(observedOperationalErrors)) {
          observedOperationalErrors[counter] = Math.max(
            observedOperationalErrors[counter],
            Number(record?.payload?.[counter]) || 0,
          );
        }
        if (record.kind === 'session_down' || record.kind === 'bridge_stopped') reconnectPending = true;
        if (record.kind === 'subscriptions_ready' && reconnectPending) {
          reconnectEvidenceCycles += 1;
          reconnectPending = false;
          latestCompletedReconnectProductStats = postReconnectProductStats;
          latestCompletedReconnectProductKindStats = postReconnectProductKindStats;
          preReconnectProductStats = Object.fromEntries(
            [...regularSessionProductStats.entries()].map(([product, stats]) => [
              product,
              { ...stats },
            ]),
          );
          latestReconnectReadyAt = record.receivedAt;
          latestReconnectReadyMs = timestampMs(record.receivedAt);
          postReconnectProductEvents = {};
          postReconnectProductStats = {};
          postReconnectProductKindStats = {};
        }
      }
      const receivedMs = Date.parse(record.receivedAt);
      if (Number.isFinite(receivedMs)) {
        if (previousReceivedMs != null) {
          if (receivedMs < previousReceivedMs) outOfOrderEvents += 1;
          else maxInterEventGapMs = Math.max(maxInterEventGapMs, receivedMs - previousReceivedMs);
        }
        previousReceivedMs = receivedMs;
        if (earliestReceivedMs == null || receivedMs < earliestReceivedMs) {
          earliestReceivedMs = receivedMs;
          earliestReceivedAt = record.receivedAt;
        }
        if (latestReceivedMs == null || receivedMs > latestReceivedMs) {
          latestReceivedMs = receivedMs;
          latestReceivedAt = record.receivedAt;
        }
      }
      if (record.product) {
        products.add(record.product);
        const productKinds = productKindStats.get(record.product) || new Map();
        productKinds.set(record.kind, (productKinds.get(record.kind) || 0) + 1);
        productKindStats.set(record.product, productKinds);
        const stats = productStats.get(record.product) || {
          events: 0, duplicates: 0, sequenceGaps: 0, clockSkewEvents: 0,
          firstReceivedAt: null, lastReceivedAt: null, maxInterEventGapMs: 0,
        };
        stats.events += 1;
        stats.duplicates += Number(Boolean(record.duplicate));
        stats.sequenceGaps += Math.max(0, Number(record.sequenceGap) || 0);
        stats.clockSkewEvents += Number(Math.abs(Number(record.clockSkewMs)) > 5_000);
        if (Number.isFinite(receivedMs)) {
          if (stats.lastReceivedAt) {
            const productGap = receivedMs - Date.parse(stats.lastReceivedAt);
            if (productGap >= 0) stats.maxInterEventGapMs = Math.max(stats.maxInterEventGapMs, productGap);
          }
          if (!stats.firstReceivedAt || receivedMs < Date.parse(stats.firstReceivedAt)) stats.firstReceivedAt = record.receivedAt;
          if (!stats.lastReceivedAt || receivedMs > Date.parse(stats.lastReceivedAt)) stats.lastReceivedAt = record.receivedAt;
        }
        productStats.set(record.product, stats);
        if (record.product !== 'bridge' && Number.isFinite(receivedMs)
          && taiwanMarketSession(new Date(receivedMs)).isTradingSession) {
          const sessionStats = regularSessionProductStats.get(record.product) || {
            events: 0,
            clockSkewEvents: 0,
            firstReceivedAt: null,
            lastReceivedAt: null,
            maxInterEventGapMs: 0,
          };
          sessionStats.events += 1;
          if (derivedLatencyMs != null && Math.abs(derivedLatencyMs) > 5_000
            && !expectedClosingAuctionLag(record, receivedMs, exchangeMs)) {
            sessionStats.clockSkewEvents += 1;
            regularSessionClockSkewEvents += 1;
          }
          if (sessionStats.lastReceivedAt) {
            sessionStats.maxInterEventGapMs = Math.max(
              sessionStats.maxInterEventGapMs,
              receivedMs - Date.parse(sessionStats.lastReceivedAt),
            );
          }
          sessionStats.firstReceivedAt ||= record.receivedAt;
          sessionStats.lastReceivedAt = record.receivedAt;
          regularSessionProductStats.set(record.product, sessionStats);
        }
        if (record.product !== 'bridge' && latestReconnectReadyMs != null
          && Number.isFinite(receivedMs) && receivedMs > latestReconnectReadyMs
          && taiwanMarketSession(new Date(receivedMs)).isTradingSession) {
          postReconnectProductEvents[record.product] =
            (postReconnectProductEvents[record.product] || 0) + 1;
          const reconnectStats = postReconnectProductStats[record.product] || {
            events: 0,
            clockSkewEvents: 0,
            firstReceivedAt: null,
            lastReceivedAt: null,
            maxInterEventGapMs: 0,
          };
          reconnectStats.events += 1;
          if (derivedLatencyMs != null && Math.abs(derivedLatencyMs) > 5_000
            && !expectedClosingAuctionLag(record, receivedMs, exchangeMs)) {
            reconnectStats.clockSkewEvents += 1;
          }
          if (reconnectStats.lastReceivedAt) {
            reconnectStats.maxInterEventGapMs = Math.max(
              reconnectStats.maxInterEventGapMs,
              receivedMs - Date.parse(reconnectStats.lastReceivedAt),
            );
          }
          reconnectStats.firstReceivedAt ||= record.receivedAt;
          reconnectStats.lastReceivedAt = record.receivedAt;
          postReconnectProductStats[record.product] = reconnectStats;
          const reconnectKinds = postReconnectProductKindStats[record.product] || {};
          reconnectKinds[record.kind] = (reconnectKinds[record.kind] || 0) + 1;
          postReconnectProductKindStats[record.product] = reconnectKinds;
        }
        if (record.product !== 'bridge' && Number.isFinite(receivedMs)
          && (latestMarketReceivedMs == null || receivedMs > latestMarketReceivedMs)) {
          latestMarketReceivedMs = receivedMs;
          latestMarketReceivedAt = record.receivedAt;
        }
      }
      if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false || forbidden(record.payload)) hashFailures += 1;
    } catch {
      invalidLines += 1;
    }
  }
  const ageMs = latestMarketReceivedMs == null ? null : now.getTime() - latestMarketReceivedMs;
  latencyMs.sort((left, right) => left - right);
  absoluteTimestampOffsetMs.sort((left, right) => left - right);
  const negativeTimestampOffsetSamples = latencyMs.filter((value) => value < 0).length;
  const marketSession = taiwanMarketSession(now);
  return {
    ok: invalidLines === 0 && hashFailures === 0,
    events: lines.length,
    invalidLines,
    hashFailures,
    duplicates,
    sequenceGaps,
    clockSkewEvents,
    regularSessionClockSkewEvents,
    products: [...products].sort(),
    kindStats: Object.fromEntries([...kindStats.entries()].sort(([left], [right]) => left.localeCompare(right))),
    productStats: Object.fromEntries([...productStats.entries()].sort(([left], [right]) => left.localeCompare(right))),
    productKindStats: Object.fromEntries(
      [...productKindStats.entries()]
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([product, kinds]) => [
          product,
          Object.fromEntries([...kinds.entries()].sort(([left], [right]) => left.localeCompare(right))),
        ]),
    ),
    reconnectEvidenceCycles,
    latestReconnectReadyAt,
    postReconnectProductEvents,
    postReconnectProductStats,
    postReconnectProductKindStats,
    latestCompletedReconnectProductStats,
    latestCompletedReconnectProductKindStats,
    preReconnectProductStats,
    regularSessionProductStats: Object.fromEntries(
      [...regularSessionProductStats.entries()].sort(([left], [right]) => left.localeCompare(right)),
    ),
    observedOperationalErrors,
    earliestReceivedAt,
    latestReceivedAt,
    latestMarketReceivedAt,
    durationMs: earliestReceivedMs == null || latestReceivedMs == null ? null : latestReceivedMs - earliestReceivedMs,
    maxInterEventGapMs,
    outOfOrderEvents,
    duplicateRate: lines.length ? duplicates / lines.length : 0,
    ageMs,
    stale: ageMs == null || ageMs > staleAfterMs,
    staleExpected: (ageMs == null || ageMs > staleAfterMs) && !marketSession.isTradingSession,
    marketSession,
    latency: {
      samples: latencyMs.length,
      p50Ms: percentile(latencyMs, 0.50),
      p95Ms: percentile(latencyMs, 0.95),
      p99Ms: percentile(latencyMs, 0.99),
      minMs: latencyMs.length ? latencyMs[0] : null,
      maxMs: latencyMs.length ? latencyMs.at(-1) : null,
      negativeSamples: negativeTimestampOffsetSamples,
      negativeRate: latencyMs.length
        ? negativeTimestampOffsetSamples / latencyMs.length
        : null,
      absoluteP95Ms: percentile(absoluteTimestampOffsetMs, 0.95),
      interpretation: 'received_at_minus_exchange_timestamp; includes host/exchange clock offset',
    },
    bytes: snapshotBytes,
    latestHash: previousHash,
    executionAuthorized: false,
  };
}

export function evaluateLiveEventAcceptance(audit, {
  requiredProducts = ['2330', 'IX0001'],
  minEventsPerProduct = 100,
  minDurationMs = 30 * 60_000,
  maxDuplicateRate = 0.01,
  maxInterEventGapMs = 5 * 60_000,
  requireReconnectEvidence = true,
  evidenceNotBefore = null,
  operationalHealth = null,
} = {}) {
  if (audit?.auditState === 'AUDIT_INCOMPLETE') {
    // Unread data is unknown, not evidence of corruption, absence, or zero errors.
    // Independently observed operational failures still fail acceptance.
    const counters = { callbackErrors: 'callback_error_detected', dropped: 'queue_drop_detected', writerErrors: 'writer_error_detected' };
    const counterValues = Object.fromEntries(Object.keys(counters).map(key => {
      const value = operationalHealth?.[key];
      return [key, typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null];
    }));
    const failReasons = Object.entries(counters).filter(([key]) => counterValues[key] > 0).map(([, reason]) => reason);
    const countersComplete = Object.values(counterValues).every(value => value !== null);
    const pendingReasons = [audit.reason, ...(!countersComplete ? ['operational_health_evidence_missing'] : [])];
    return {
      status: failReasons.length ? 'FAIL' : 'PENDING', passed: false,
      reasons: [...failReasons, ...pendingReasons], failReasons, pendingReasons,
      thresholds: { requiredProducts, minEventsPerProduct, minDurationMs, maxDuplicateRate,
        maxInterEventGapMs, requireReconnectEvidence, evidenceNotBefore },
      evidence: {
        auditState: audit.auditState, auditReason: audit.reason,
        snapshotBytes: audit.bytes, bytesRead: audit.bytesRead, maxAuditBytes: audit.maxAuditBytes,
        requiredProductDurationMs: null, requiredProductMaxGapMs: null, postRepairWindowReady: null,
        acceptanceClockSkewEvents: null, latestReconnectReadyAt: null,
        postReconnectProductEvents: null, postReconnectProductStats: null, preReconnectProductStats: null,
        observedOperationalErrors: null, operationalHealth,
      },
      checks: {
        integrity: null, requiredProducts: null, postRepairMarketWindow: null,
        continuity: null, timing: null, disconnectHeuristic: null, reconnectEvidence: null,
        postRestartMarketQuotes: null, duplicates: null,
        ...Object.fromEntries(Object.entries(counterValues).map(([key, value]) => [key, value === null ? null : value === 0])),
      },
    };
  }
  const failReasons = [];
  const pendingReasons = [];
  const events = Number(audit?.events) || 0;
  const evidenceReady = events > 0;
  const evidenceNotBeforeMs = evidenceNotBefore ? Date.parse(evidenceNotBefore) : null;
  const acceptanceClockSkewEvents = Number.isFinite(Number(audit?.regularSessionClockSkewEvents))
    ? Number(audit.regularSessionClockSkewEvents)
    : Number(audit?.clockSkewEvents) || 0;
  const allRequiredStats = requiredProducts
    .map((product) => audit?.productStats?.[product])
    .filter(Boolean);
  const regularRequiredStats = requiredProducts
    .map((product) => audit?.regularSessionProductStats?.[product])
    .filter(Boolean);
  const baselineContinuityStats = regularRequiredStats.length === requiredProducts.length
    ? regularRequiredStats
    : allRequiredStats;
  const continuityStats = requireReconnectEvidence ? requiredProducts.map((product) => {
    const before = audit?.preReconnectProductStats?.[product];
    const after = audit?.postReconnectProductStats?.[product];
    const segmentDuration = (stats) => {
      const first = Date.parse(stats.firstReceivedAt);
      const last = Date.parse(stats.lastReceivedAt);
      return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0;
    };
    if (!before && !after) return null;
    return {
      events: Number(before?.events || 0) + Number(after?.events || 0),
      firstReceivedAt: before?.firstReceivedAt || after?.firstReceivedAt || null,
      lastReceivedAt: after?.lastReceivedAt || before?.lastReceivedAt || null,
      maxInterEventGapMs: Math.max(
        Number(before?.maxInterEventGapMs) || 0,
        Number(after?.maxInterEventGapMs) || 0,
      ),
      cleanDurationMs: (before ? segmentDuration(before) : 0) + (after ? segmentDuration(after) : 0),
    };
  }).filter(Boolean) : baselineContinuityStats;
  const requiredProductDurationMs = continuityStats.length === requiredProducts.length
    ? Math.min(...continuityStats.map((stats) => stats.cleanDurationMs ?? (() => {
      const first = Date.parse(stats.firstReceivedAt);
      const last = Date.parse(stats.lastReceivedAt);
      return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0;
    })()))
    : 0;
  const requiredProductMaxGapMs = continuityStats.length
    ? Math.max(...continuityStats.map((stats) => Number(stats.maxInterEventGapMs) || 0))
    : 0;
  const postRepairStats = continuityStats.filter((stats) => {
    const first = Date.parse(stats.firstReceivedAt);
    return evidenceNotBeforeMs == null || (Number.isFinite(first) && first >= evidenceNotBeforeMs);
  });
  const postRepairWindowReady = postRepairStats.length === requiredProducts.length;
  const postReconnectQuotesReady = requiredProducts.every(
    (product) => Number(audit?.postReconnectProductEvents?.[product] || 0) >= 1,
  );
  if (!audit?.ok) failReasons.push('ledger_integrity_failed');
  if ((Number(audit?.invalidLines) || 0) > 0) failReasons.push('invalid_row_detected');
  if ((Number(audit?.hashFailures) || 0) > 0) failReasons.push('hash_error_detected');
  if (!evidenceReady) pendingReasons.push('awaiting_first_event');
  for (const product of requiredProducts) {
    const stats = audit?.productStats?.[product];
    if (!stats) pendingReasons.push(`required_product_missing:${product}`);
    else if (stats.events < minEventsPerProduct) pendingReasons.push(`insufficient_product_events:${product}`);
  }
  if (!postRepairWindowReady) pendingReasons.push('post_repair_market_evidence_missing');
  if (evidenceReady && requiredProductDurationMs < minDurationMs) pendingReasons.push('observation_window_too_short');
  if ((Number(audit?.duplicateRate) || 0) > maxDuplicateRate) failReasons.push('duplicate_rate_exceeded');
  if ((Number(audit?.sequenceGaps) || 0) > 0) failReasons.push('sequence_gap_detected');
  if (acceptanceClockSkewEvents > 0) failReasons.push('clock_skew_detected');
  if ((Number(audit?.outOfOrderEvents) || 0) > 0) failReasons.push('out_of_order_event_detected');
  if (requiredProductMaxGapMs > maxInterEventGapMs) failReasons.push('possible_disconnect_gap_detected');
  if (evidenceReady && requireReconnectEvidence && (Number(audit?.reconnectEvidenceCycles) || 0) < 1) {
    pendingReasons.push('reconnect_evidence_missing');
  } else if (requireReconnectEvidence && !postReconnectQuotesReady) {
    pendingReasons.push('post_restart_market_quotes_missing');
  }
  for (const [counter, value] of Object.entries(audit?.observedOperationalErrors || {})) {
    if (Number(value) > 0) {
      const reason = {
        callbackErrors: 'callback_error_detected',
        dropped: 'queue_drop_detected',
        writerErrors: 'writer_error_detected',
      }[counter];
      if (reason && !failReasons.includes(reason)) failReasons.push(reason);
    }
  }
  if (!operationalHealth) {
    pendingReasons.push('operational_health_evidence_missing');
  } else {
    if (Number(operationalHealth.callbackErrors) > 0 && !failReasons.includes('callback_error_detected')) {
      failReasons.push('callback_error_detected');
    }
    if (Number(operationalHealth.dropped) > 0 && !failReasons.includes('queue_drop_detected')) {
      failReasons.push('queue_drop_detected');
    }
    if (Number(operationalHealth.writerErrors) > 0 && !failReasons.includes('writer_error_detected')) {
      failReasons.push('writer_error_detected');
    }
  }
  const status = failReasons.length ? 'FAIL' : pendingReasons.length ? 'PENDING' : 'PASS';
  const reasons = [...failReasons, ...pendingReasons];
  return {
    status,
    passed: status === 'PASS',
    reasons,
    failReasons,
    pendingReasons,
    thresholds: {
      requiredProducts, minEventsPerProduct, minDurationMs, maxDuplicateRate,
      maxInterEventGapMs, requireReconnectEvidence, evidenceNotBefore,
    },
    evidence: {
      requiredProductDurationMs,
      requiredProductMaxGapMs,
      postRepairWindowReady,
      acceptanceClockSkewEvents,
      latestReconnectReadyAt: audit?.latestReconnectReadyAt || null,
      postReconnectProductEvents: audit?.postReconnectProductEvents || {},
      postReconnectProductStats: audit?.postReconnectProductStats || {},
      preReconnectProductStats: audit?.preReconnectProductStats || {},
      observedOperationalErrors: audit?.observedOperationalErrors || {},
      operationalHealth,
    },
    checks: {
      integrity: Boolean(audit?.ok),
      requiredProducts: requiredProducts.every((product) => Boolean(audit?.productStats?.[product])),
      postRepairMarketWindow: postRepairWindowReady && requiredProductDurationMs >= minDurationMs,
      continuity: evidenceReady ? (Number(audit?.sequenceGaps) || 0) === 0 && (Number(audit?.outOfOrderEvents) || 0) === 0 : null,
      timing: evidenceReady ? acceptanceClockSkewEvents === 0 : null,
      disconnectHeuristic: evidenceReady ? requiredProductMaxGapMs <= maxInterEventGapMs : null,
      reconnectEvidence: evidenceReady ? !requireReconnectEvidence || (Number(audit?.reconnectEvidenceCycles) || 0) >= 1 : null,
      postRestartMarketQuotes: requireReconnectEvidence ? postReconnectQuotesReady : true,
      callbackErrors: operationalHealth ? Number(operationalHealth.callbackErrors) === 0 : null,
      dropped: operationalHealth ? Number(operationalHealth.dropped) === 0 : null,
      writerErrors: operationalHealth ? Number(operationalHealth.writerErrors) === 0 : null,
      duplicates: evidenceReady ? (Number(audit?.duplicateRate) || 0) <= maxDuplicateRate : null,
    },
  };
}

export function replayLiveEventLedger(filePath, { until = null, product = null } = {}) {
  const cutoff = until ? Date.parse(until) : Number.POSITIVE_INFINITY;
  if (Number.isNaN(cutoff)) throw new Error('until_invalid');
  const audit = auditLiveEventLedger(filePath);
  if (!audit.ok) throw new Error('ledger_audit_failed');
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean)
    .map((line) => JSON.parse(line))
    .filter((record) => Date.parse(record.receivedAt) <= cutoff && (!product || record.product === product));
}

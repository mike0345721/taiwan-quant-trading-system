import crypto from 'node:crypto';

export const MARKET_CHANGE_FEED_CONTRACT = Object.freeze({
  schemaVersion: 'market-change-feed-contract-v1',
  observationCadence: 'EACH_LEGAL_COMPLETED_5M_BAR',
  comparison: 'PREVIOUS_LEGAL_COMPLETED_SNAPSHOT_VS_CURRENT',
  allowedEventTypes: Object.freeze([
    'VWAP_CROSS_UP',
    'VWAP_CROSS_DOWN',
    'OR_BREAK_UP',
    'OR_BREAK_DOWN',
    'OR_REENTRY_FROM_ABOVE',
    'OR_REENTRY_FROM_BELOW',
    'NEW_SESSION_HIGH',
    'NEW_SESSION_LOW',
    'DATA_HEALTH_DEGRADED',
    'DATA_HEALTH_RECOVERED',
  ]),
  evidenceEngineAvailability: Object.freeze(['AVAILABLE', 'INSUFFICIENT_EVIDENCE', 'UNAVAILABLE']),
  dataTrustStates: Object.freeze(['PASS', 'QUALITY_INSUFFICIENT', 'STALE', 'MISSING', 'UNAVAILABLE']),
  markerTimeframe: '5m',
  dataHealthTransitionPolicy: 'REQUIRES_GOVERNED_TIME_LOCAL_EVIDENCE',
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
});

export const MARKET_CHANGE_DERIVATION_VERSION = 'market-change-feed-v1.1.0';
const FIVE_MINUTES_MS = 5 * 60_000;

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function stableMarketChangeJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function marketChangeDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function timestamp(value) {
  if (typeof value !== 'string' || !value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function unique(values) {
  return Object.freeze([...new Set(values.filter(Boolean))].sort());
}

function pointForBar(points, bar) {
  return (points || []).find((point) => point.time === bar.time
    && (!point.sessionId || point.sessionId === bar.sessionId)
    && (!point.actualContract || point.actualContract === bar.actualContract)) || null;
}

function maxIso(values) {
  const valid = values.filter((value) => timestamp(value) != null).sort();
  return valid.at(-1) || null;
}

function qualityReasons(chart, bar) {
  const reasons = [...(chart?.qualityReasons || [])];
  if (bar?.qualityStatus && bar.qualityStatus !== 'PASS') reasons.push('BAR_QUALITY_INSUFFICIENT');
  if ((chart?.timeLineageViolationCount || 0) > 0) reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  if ((chart?.sequenceGapEventCount || 0) > 0) reasons.push('SEQUENCE_CONTINUITY_INSUFFICIENT');
  return unique(reasons);
}

function qualityStatus(chart, bar) {
  if (!bar) return 'UNAVAILABLE';
  if (chart?.qualityStatus === 'UNAVAILABLE') return 'UNAVAILABLE';
  return chart?.qualityStatus === 'PASS' && bar.qualityStatus === 'PASS' ? 'PASS' : 'QUALITY_INSUFFICIENT';
}

export function buildCompletedFiveMinuteObservations(chart) {
  if (chart?.timeframe !== '5m') throw new Error('MARKET_CHANGE_REQUIRES_5M_CHART');
  const asOfMs = timestamp(chart.asOf || chart.availableAt);
  if (asOfMs == null) return Object.freeze([]);
  const ordered = [...(chart.bars || [])].sort((left, right) => String(left.time).localeCompare(String(right.time)));
  let sessionKey = null;
  let runningHigh = null;
  let runningLow = null;
  const observations = [];

  for (const bar of ordered) {
    const startMs = timestamp(bar.time);
    const barAvailableMs = timestamp(bar.availableAt);
    if (startMs == null || barAvailableMs == null) continue;
    const observedAtMs = startMs + FIVE_MINUTES_MS;
    if (observedAtMs > asOfMs || barAvailableMs > asOfMs) continue;
    if (!bar.sessionId || !bar.session || !bar.sessionTradeDate || !bar.actualContract) continue;
    const currentSessionKey = `${bar.sessionTradeDate}|${bar.session}|${bar.sessionId}|${bar.actualContract}`;
    if (currentSessionKey !== sessionKey) {
      sessionKey = currentSessionKey;
      runningHigh = null;
      runningLow = null;
    }
    const high = finite(bar.high);
    const low = finite(bar.low);
    const close = finite(bar.close);
    if (high == null || low == null || close == null) continue;
    runningHigh = runningHigh == null ? high : Math.max(runningHigh, high);
    runningLow = runningLow == null ? low : Math.min(runningLow, low);
    const vwapPoint = pointForBar(chart.vwap, bar);
    const or = chart.openingRange;
    const orLegal = bar.session === 'DAY'
      && ['READY', 'QUALITY_INSUFFICIENT'].includes(or?.status)
      && timestamp(or.availableAt) != null
      && timestamp(or.availableAt) <= observedAtMs
      && or.actualContract === bar.actualContract;
    const currentQuality = qualityStatus(chart, bar);
    const currentQualityReasons = qualityReasons(chart, bar);
    const body = {
      schemaVersion: 'governed-5m-evidence-observation-v1',
      tradeDate: bar.tradeDate,
      sessionTradeDate: bar.sessionTradeDate,
      session: bar.session,
      sessionId: bar.sessionId,
      actualContract: bar.actualContract,
      barTime: new Date(startMs).toISOString(),
      observedAt: new Date(observedAtMs).toISOString(),
      availableAt: maxIso([new Date(observedAtMs).toISOString(), bar.availableAt, vwapPoint?.availableAt, orLegal ? or.availableAt : null]),
      asOf: new Date(asOfMs).toISOString(),
      completed: true,
      price: Object.freeze({ open: finite(bar.open), high, low, close, volume: finite(bar.volume) }),
      vwap: vwapPoint && finite(vwapPoint.value) != null
        ? Object.freeze({ availability: 'AVAILABLE', value: finite(vwapPoint.value), sourceId: 'SESSION_EXACT_TX_TICK_VWAP' })
        : Object.freeze({ availability: 'UNAVAILABLE', value: null, sourceId: 'SESSION_EXACT_TX_TICK_VWAP' }),
      openingRange: orLegal
        ? Object.freeze({ availability: 'AVAILABLE', high: finite(or.high), low: finite(or.low), sourceId: 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900' })
        : Object.freeze({ availability: 'UNAVAILABLE', high: null, low: null, sourceId: 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900' }),
      sessionHigh: runningHigh,
      sessionLow: runningLow,
      qualityStatus: currentQuality,
      qualityReasons: currentQualityReasons,
      dataTrust: Object.freeze({ status: currentQuality, reasons: currentQualityReasons }),
      dataHealthTransitionSupport: 'NOT_SUPPORTED_BY_TIME_LOCAL_EVIDENCE',
      timeLocalDataHealthState: null,
      derivationVersion: MARKET_CHANGE_DERIVATION_VERSION,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    };
    if (timestamp(body.availableAt) == null || timestamp(body.availableAt) > asOfMs) continue;
    observations.push(Object.freeze({ ...body, observationId: marketChangeDigest(body) }));
  }
  return Object.freeze(observations);
}

function comparable(previous, current) {
  if (!previous?.completed || !current?.completed) return false;
  return previous.sessionTradeDate === current.sessionTradeDate
    && previous.session === current.session
    && previous.sessionId === current.sessionId
    && previous.actualContract === current.actualContract
    && timestamp(previous.observedAt) < timestamp(current.observedAt)
    && timestamp(previous.availableAt) <= timestamp(previous.asOf)
    && timestamp(current.availableAt) <= timestamp(current.asOf);
}

const EVENT_COPY = Object.freeze({
  VWAP_CROSS_UP: ['向上穿越 VWAP', '完成的 5 分鐘收盤價由 VWAP 下方移至上方。'],
  VWAP_CROSS_DOWN: ['向下跌破 VWAP', '完成的 5 分鐘收盤價由 VWAP 上方移至下方。'],
  OR_BREAK_UP: ['向上突破 Opening Range', '完成的 5 分鐘收盤價站上 Opening Range 高點。'],
  OR_BREAK_DOWN: ['向下跌破 Opening Range', '完成的 5 分鐘收盤價跌破 Opening Range 低點。'],
  OR_REENTRY_FROM_ABOVE: ['由上方回到 Opening Range', '完成的 5 分鐘收盤價由區間上方回到 Opening Range 內。'],
  OR_REENTRY_FROM_BELOW: ['由下方回到 Opening Range', '完成的 5 分鐘收盤價由區間下方回到 Opening Range 內。'],
  NEW_SESSION_HIGH: ['更新時段高點', '完成的 5 分鐘證據形成新的時段高點。'],
  NEW_SESSION_LOW: ['更新時段低點', '完成的 5 分鐘證據形成新的時段低點。'],
  DATA_HEALTH_DEGRADED: ['資料品質轉弱', '既有 governed Data Health 由正常轉為降級。'],
  DATA_HEALTH_RECOVERED: ['資料品質恢復', '既有 governed Data Health 由降級轉回正常。'],
});

const EVIDENCE_GROUP = Object.freeze({
  PRIMARY_STRUCTURE: Object.freeze(['VWAP_CROSS_UP', 'VWAP_CROSS_DOWN', 'OR_BREAK_UP', 'OR_BREAK_DOWN', 'OR_REENTRY_FROM_ABOVE', 'OR_REENTRY_FROM_BELOW']),
  SECONDARY_STRUCTURE: Object.freeze(['NEW_SESSION_HIGH', 'NEW_SESSION_LOW']),
  DATA_TRUST: Object.freeze(['DATA_HEALTH_DEGRADED', 'DATA_HEALTH_RECOVERED']),
});

function evidenceGroup(eventType) {
  return Object.entries(EVIDENCE_GROUP).find(([, eventTypes]) => eventTypes.includes(eventType))?.[0] || 'SECONDARY_STRUCTURE';
}

function eventSourceIds(eventType) {
  if (eventType.startsWith('VWAP_')) return ['governedTx5mBar', 'sessionExactTickVwap'];
  if (eventType.startsWith('OR_')) return ['governedTx5mBar', 'frozenT0DayOpeningRange'];
  if (eventType.startsWith('NEW_SESSION_')) return ['governedTx5mBar', 'sessionPriceStructure'];
  return ['governedTx5mBar', 'governedDataHealth'];
}

function eventFacts(eventType, previous, current) {
  const base = {
    previous: {
      close: previous.price.close,
      vwap: previous.vwap.value,
      openingRangeHigh: previous.openingRange.high,
      openingRangeLow: previous.openingRange.low,
      sessionHigh: previous.sessionHigh,
      sessionLow: previous.sessionLow,
      dataTrustStatus: previous.dataTrust?.status || previous.qualityStatus,
      timeLocalDataHealthState: previous.timeLocalDataHealthState || null,
    },
    current: {
      close: current.price.close,
      vwap: current.vwap.value,
      openingRangeHigh: current.openingRange.high,
      openingRangeLow: current.openingRange.low,
      sessionHigh: current.sessionHigh,
      sessionLow: current.sessionLow,
      dataTrustStatus: current.dataTrust?.status || current.qualityStatus,
      timeLocalDataHealthState: current.timeLocalDataHealthState || null,
    },
  };
  return Object.freeze({ ...base, eventType });
}

function buildEvent(eventType, previous, current) {
  const [headline, summary] = EVENT_COPY[eventType];
  const body = {
    schemaVersion: 'market-change-event-v1',
    eventType,
    tradeDate: current.tradeDate,
    sessionTradeDate: current.sessionTradeDate,
    session: current.session,
    sessionId: current.sessionId,
    actualContract: current.actualContract,
    previousObservedAt: previous.observedAt,
    observedAt: current.observedAt,
    eventAt: current.observedAt,
    availableAt: current.availableAt,
    markerTime: current.barTime,
    headline,
    summary,
    evidenceGroup: evidenceGroup(eventType),
    sourceFacts: eventFacts(eventType, previous, current),
    sourceIds: Object.freeze(eventSourceIds(eventType)),
    qualityStatus: current.qualityStatus,
    qualityReasons: unique([...(previous.qualityReasons || []), ...(current.qualityReasons || [])]),
    derivationVersion: MARKET_CHANGE_DERIVATION_VERSION,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  return Object.freeze({ ...body, eventId: marketChangeDigest(body) });
}

export function deriveEvidenceChanges(previous, current) {
  if (!comparable(previous, current)) return Object.freeze([]);
  const eventTypes = [];
  const previousClose = finite(previous.price?.close);
  const currentClose = finite(current.price?.close);
  const previousVwap = finite(previous.vwap?.value);
  const currentVwap = finite(current.vwap?.value);
  if (previousVwap != null && currentVwap != null && previousClose != null && currentClose != null) {
    if (previousClose <= previousVwap && currentClose > currentVwap) eventTypes.push('VWAP_CROSS_UP');
    if (previousClose >= previousVwap && currentClose < currentVwap) eventTypes.push('VWAP_CROSS_DOWN');
  }

  const previousOr = previous.openingRange || {};
  const currentOr = current.openingRange || {};
  if (previousOr.availability === 'AVAILABLE' && currentOr.availability === 'AVAILABLE') {
    const high = finite(currentOr.high);
    const low = finite(currentOr.low);
    if (high != null && low != null && previousClose != null && currentClose != null) {
      if (previousClose <= high && currentClose > high) eventTypes.push('OR_BREAK_UP');
      if (previousClose >= low && currentClose < low) eventTypes.push('OR_BREAK_DOWN');
      if (previousClose > high && currentClose <= high && currentClose >= low) eventTypes.push('OR_REENTRY_FROM_ABOVE');
      if (previousClose < low && currentClose >= low && currentClose <= high) eventTypes.push('OR_REENTRY_FROM_BELOW');
    }
  }

  if (finite(previous.sessionHigh) != null && finite(current.sessionHigh) > finite(previous.sessionHigh)) eventTypes.push('NEW_SESSION_HIGH');
  if (finite(previous.sessionLow) != null && finite(current.sessionLow) < finite(previous.sessionLow)) eventTypes.push('NEW_SESSION_LOW');
  const governedTimeLocalHealth = previous.dataHealthTransitionSupport === 'GOVERNED_TIME_LOCAL_EVIDENCE'
    && current.dataHealthTransitionSupport === 'GOVERNED_TIME_LOCAL_EVIDENCE';
  if (governedTimeLocalHealth && previous.timeLocalDataHealthState === 'FRESH' && current.timeLocalDataHealthState === 'DEGRADED') eventTypes.push('DATA_HEALTH_DEGRADED');
  if (governedTimeLocalHealth && previous.timeLocalDataHealthState === 'DEGRADED' && current.timeLocalDataHealthState === 'FRESH') eventTypes.push('DATA_HEALTH_RECOVERED');

  return Object.freeze(eventTypes.sort().map((eventType) => buildEvent(eventType, previous, current)));
}

function markerStyle(eventType) {
  const factualUpwardMove = ['VWAP_CROSS_UP', 'OR_BREAK_UP', 'OR_REENTRY_FROM_BELOW', 'NEW_SESSION_HIGH'].includes(eventType);
  const group = evidenceGroup(eventType);
  const labels = {
    VWAP_CROSS_UP: 'VWAP↑', VWAP_CROSS_DOWN: 'VWAP↓', OR_BREAK_UP: 'OR↑', OR_BREAK_DOWN: 'OR↓',
    OR_REENTRY_FROM_ABOVE: 'OR↩', OR_REENTRY_FROM_BELOW: 'OR↪', NEW_SESSION_HIGH: '時段高',
    NEW_SESSION_LOW: '時段低', DATA_HEALTH_DEGRADED: '品質↓', DATA_HEALTH_RECOVERED: '品質↑',
  };
  return Object.freeze({
    position: factualUpwardMove ? 'belowBar' : 'aboveBar',
    color: group === 'DATA_TRUST' ? '#f5c86b' : group === 'PRIMARY_STRUCTURE' ? '#8aa7ff' : '#9aa8bd',
    shape: 'circle',
    text: labels[eventType],
    evidenceGroup: group,
  });
}

export function chartMarkersFromEvents(events, chart) {
  if (chart?.timeframe !== '5m') return Object.freeze([]);
  const bars = [...(chart?.bars || [])].sort((left, right) => String(left.time).localeCompare(String(right.time)));
  const markers = [];
  for (const event of events || []) {
    if (event.actualContract !== chart?.actualContract) continue;
    const eventMs = timestamp(event.markerTime);
    const candidates = bars.filter((bar) => timestamp(bar.time) <= eventMs
      && bar.sessionTradeDate === event.sessionTradeDate
      && bar.session === event.session);
    const bar = candidates.at(-1);
    if (!bar) continue;
    const style = markerStyle(event.eventType);
    markers.push(Object.freeze({
      ...style,
      time: bar.time,
      eventId: event.eventId,
      eventType: event.eventType,
      eventAt: event.eventAt,
      qualityStatus: event.qualityStatus,
    }));
  }
  return Object.freeze(markers.sort((left, right) => left.time.localeCompare(right.time)
    || left.eventType.localeCompare(right.eventType)
    || left.eventId.localeCompare(right.eventId)));
}

const GROUP_ORDER = Object.freeze({ PRIMARY_STRUCTURE: 0, SECONDARY_STRUCTURE: 1, DATA_TRUST: 2 });

function groupHeadline(events) {
  if (events.some((event) => event.evidenceGroup === 'PRIMARY_STRUCTURE')) return '價格結構出現變化';
  if (events.some((event) => event.evidenceGroup === 'SECONDARY_STRUCTURE')) return '時段結構出現更新';
  return '資料信任狀態出現變化';
}

export function groupMarketChangeEvents(events) {
  const grouped = new Map();
  for (const event of events || []) {
    const key = `${event.sessionTradeDate}|${event.session}|${event.actualContract}|${event.observedAt}`;
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(event);
  }
  return Object.freeze([...grouped.entries()].map(([key, groupedEvents]) => {
    const orderedEvents = Object.freeze([...groupedEvents].sort((left, right) =>
      (GROUP_ORDER[left.evidenceGroup] ?? 9) - (GROUP_ORDER[right.evidenceGroup] ?? 9)
      || left.eventType.localeCompare(right.eventType)
      || left.eventId.localeCompare(right.eventId)));
    const body = {
      schemaVersion: 'market-change-event-group-v1',
      observedAt: orderedEvents[0].observedAt,
      availableAt: maxIso(orderedEvents.map((event) => event.availableAt)),
      sessionTradeDate: orderedEvents[0].sessionTradeDate,
      session: orderedEvents[0].session,
      actualContract: orderedEvents[0].actualContract,
      headline: groupHeadline(orderedEvents),
      evidenceCount: orderedEvents.length,
      evidenceGroups: unique(orderedEvents.map((event) => event.evidenceGroup)),
      qualityStatus: orderedEvents.some((event) => event.qualityStatus !== 'PASS') ? 'QUALITY_INSUFFICIENT' : 'PASS',
      qualityReasons: unique(orderedEvents.flatMap((event) => event.qualityReasons || [])),
      events: orderedEvents,
    };
    return Object.freeze({ ...body, groupId: marketChangeDigest({ key, ...body }) });
  }).sort((left, right) => left.observedAt.localeCompare(right.observedAt) || left.groupId.localeCompare(right.groupId)));
}

export function buildMarketChangeFeed(chart) {
  const observations = buildCompletedFiveMinuteObservations(chart);
  const deduplicated = new Map();
  for (let index = 1; index < observations.length; index += 1) {
    for (const event of deriveEvidenceChanges(observations[index - 1], observations[index])) {
      deduplicated.set(event.eventId, event);
    }
  }
  const events = Object.freeze([...deduplicated.values()].sort((left, right) => left.eventAt.localeCompare(right.eventAt)
    || left.eventType.localeCompare(right.eventType)
    || left.eventId.localeCompare(right.eventId)));
  const eventGroups = groupMarketChangeEvents(events);
  const engineAvailability = observations.length >= 2 ? 'AVAILABLE'
    : observations.length === 1 ? 'INSUFFICIENT_EVIDENCE' : 'UNAVAILABLE';
  const latestObservation = observations.at(-1) || null;
  const dataTrust = Object.freeze({
    status: latestObservation?.qualityStatus || chart?.qualityStatus || 'UNAVAILABLE',
    reasons: unique(latestObservation?.qualityReasons || chart?.qualityReasons || []),
    historicalTransitionSupport: 'NOT_SUPPORTED_BY_TIME_LOCAL_EVIDENCE',
  });
  const body = {
    schemaVersion: 'market-change-feed-v1',
    contract: MARKET_CHANGE_FEED_CONTRACT,
    mode: chart.mode,
    tradeDate: chart.tradeDate,
    sessionTradeDate: chart.sessionTradeDate,
    session: chart.session,
    actualContract: chart.actualContract,
    status: engineAvailability,
    engineAvailability,
    dataTrust,
    observationCount: observations.length,
    eventCount: events.length,
    eventGroupCount: eventGroups.length,
    observations,
    events,
    eventGroups,
    latestFirst: Object.freeze([...events].reverse()),
    latestGroupsFirst: Object.freeze([...eventGroups].reverse()),
    futureDataViolations: 0,
    derivationVersion: MARKET_CHANGE_DERIVATION_VERSION,
    dataQuality: Object.freeze({
      qualityStatus: dataTrust.status,
      qualityReasons: dataTrust.reasons,
      nativeSequenceAvailable: false,
      trueTxTickLoss: 'unknown',
    }),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  return Object.freeze({ ...body, logicalHash: marketChangeDigest(body) });
}

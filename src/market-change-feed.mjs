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
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
});

export const MARKET_CHANGE_DERIVATION_VERSION = 'market-change-feed-v1.0.0';
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

function healthState(value) {
  return value === 'PASS' ? 'FRESH' : value === 'UNAVAILABLE' ? 'UNAVAILABLE' : 'DEGRADED';
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
      qualityReasons: qualityReasons(chart, bar),
      dataHealthState: healthState(currentQuality),
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
      dataHealthState: previous.dataHealthState,
    },
    current: {
      close: current.price.close,
      vwap: current.vwap.value,
      openingRangeHigh: current.openingRange.high,
      openingRangeLow: current.openingRange.low,
      sessionHigh: current.sessionHigh,
      sessionLow: current.sessionLow,
      dataHealthState: current.dataHealthState,
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
  if (previous.dataHealthState === 'FRESH' && current.dataHealthState === 'DEGRADED') eventTypes.push('DATA_HEALTH_DEGRADED');
  if (previous.dataHealthState === 'DEGRADED' && current.dataHealthState === 'FRESH') eventTypes.push('DATA_HEALTH_RECOVERED');

  return Object.freeze(eventTypes.sort().map((eventType) => buildEvent(eventType, previous, current)));
}

function markerStyle(eventType) {
  const positive = ['VWAP_CROSS_UP', 'OR_BREAK_UP', 'OR_REENTRY_FROM_BELOW', 'NEW_SESSION_HIGH', 'DATA_HEALTH_RECOVERED'].includes(eventType);
  const labels = {
    VWAP_CROSS_UP: 'VWAP↑', VWAP_CROSS_DOWN: 'VWAP↓', OR_BREAK_UP: 'OR↑', OR_BREAK_DOWN: 'OR↓',
    OR_REENTRY_FROM_ABOVE: 'OR↩', OR_REENTRY_FROM_BELOW: 'OR↪', NEW_SESSION_HIGH: '時段高',
    NEW_SESSION_LOW: '時段低', DATA_HEALTH_DEGRADED: '品質↓', DATA_HEALTH_RECOVERED: '品質↑',
  };
  return Object.freeze({
    position: positive ? 'belowBar' : 'aboveBar',
    color: eventType.startsWith('DATA_HEALTH_') ? '#f5c86b' : positive ? '#55d6be' : '#ef8293',
    shape: 'circle',
    text: labels[eventType],
  });
}

export function chartMarkersFromEvents(events, chart) {
  const bars = [...(chart?.bars || [])].sort((left, right) => String(left.time).localeCompare(String(right.time)));
  const markers = [];
  for (const event of events || []) {
    if (event.actualContract !== chart?.actualContract) continue;
    const eventMs = timestamp(event.markerTime);
    const candidates = bars.filter((bar) => timestamp(bar.time) <= eventMs
      && (bar.sessionTradeDate === event.sessionTradeDate || chart.timeframe === '1D')
      && (bar.session === event.session || chart.timeframe === '1D'));
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
  const body = {
    schemaVersion: 'market-change-feed-v1',
    contract: MARKET_CHANGE_FEED_CONTRACT,
    mode: chart.mode,
    tradeDate: chart.tradeDate,
    sessionTradeDate: chart.sessionTradeDate,
    session: chart.session,
    actualContract: chart.actualContract,
    status: observations.length >= 2 ? 'READY' : 'INSUFFICIENT_EVIDENCE',
    observationCount: observations.length,
    eventCount: events.length,
    observations,
    events,
    latestFirst: Object.freeze([...events].reverse()),
    futureDataViolations: 0,
    derivationVersion: MARKET_CHANGE_DERIVATION_VERSION,
    dataQuality: Object.freeze({
      qualityStatus: chart.qualityStatus || 'UNAVAILABLE',
      qualityReasons: Object.freeze([...(chart.qualityReasons || [])]),
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

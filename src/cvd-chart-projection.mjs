import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';
import { aggregateChartBars } from './dashboard-tx-chart.mjs';

export const FRAMES = Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h']);
export const CHART_LIMITS = Object.freeze({ points: 4000, segments: 16, bars: 1000, responseBytes: 2 * 1024 * 1024, prefixBytes: 64 * 1024 * 1024 });
const fail = reason => { throw new Error(reason); };
const equal = (a, b) => stableJson(a) === stableJson(b);

// Only select already accumulated points. Never sum or reclassify CVD here.
function displayPoints(points, budget) {
  const selected = new Set([0, points.length - 1]);
  const stride = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor((budget - 2) / 4))));
  for (let i = 0; i < points.length; i += stride) {
    const end = Math.min(points.length, i + stride);
    selected.add(i); selected.add(end - 1);
    const legal = Array.from({ length: end - i }, (_, n) => i + n).filter(n => points[n].value != null);
    if (legal.length) {
      selected.add(legal.reduce((a, b) => points[a].value < points[b].value ? a : b));
      selected.add(legal.reduce((a, b) => points[a].value > points[b].value ? a : b));
    }
  }
  // Preserve every null transition rather than connecting across unavailable history.
  for (let i = 1; i < points.length; i++) if ((points[i].value == null) !== (points[i - 1].value == null)) { selected.add(i - 1); selected.add(i); }
  if (selected.size > budget) fail('CVD_CHART_POINT_BUDGET');
  return [...selected].filter(n => n >= 0).sort((a, b) => a - b).map(n => points[n]);
}

export function buildCvdChartProjection(generation, price, timeframe = '1m') {
  if (!FRAMES.includes(timeframe)) fail('CVD_CHART_TIMEFRAME_INVALID');
  const s = generation?.result?.semantic;
  if (!s || generation.result.semanticHash !== digest(stableJson(s)) || Object.entries(SAFETY).some(([k, v]) => s[k] !== v)) fail('CVD_CHART_SEMANTIC_INVALID');
  if (price.generationHash !== generation.generationHash || price.cutoffRecordHash !== s.cutoffRecordHash) fail('CVD_CHART_PRICE_IDENTITY_MISMATCH');
  if (s.segments.length > CHART_LIMITS.segments) fail('CVD_CHART_SEGMENT_BUDGET');
  const perSegment = Math.floor(CHART_LIMITS.points / Math.max(1, s.segments.length));
  let previousOrdinal = -1;
  for (const point of s.series) {
    if (!Number.isSafeInteger(point.ledgerOrdinal) || point.ledgerOrdinal <= previousOrdinal || !s.segments[point.segment]) fail('CVD_CHART_PHYSICAL_ORDER_INVALID');
    previousOrdinal = point.ledgerOrdinal;
  }
  const segments = s.segments.map((segment, index) => {
    const all = s.series.filter(p => p.segment === index);
    let lastTime = -Infinity, clockInvalid = false;
    const points = all.map(p => {
      const time = timestampMs(p.availableAt);
      if (time == null || time < lastTime) clockInvalid = true;
      if (time != null) lastTime = time;
      return { time: time == null ? null : time / 1000, value: p.value, ledgerOrdinal: p.ledgerOrdinal, recordHash: p.recordHash, availableAt: p.availableAt, eventTime: p.eventTime, reason: p.reason };
    });
    const selected = clockInvalid ? [] : displayPoints(points, perSegment);
    // A terminal boundary has no new trade point: explicitly terminate the displayed current path.
    const terminalInvalid = index === s.segments.length - 1 && s.value == null && points.at(-1)?.value != null;
    return { index, identity: segment.identity, actualContract: segment.identity[0], tradeDate: segment.identity[1], session: segment.identity[2], continuityEpoch: segment.identity[3],
      origin: { eventTime: segment.observedStart, eventTimeMs: timestampMs(segment.observedStart), availableAt: segment.startAvailableAt, availableAtMs: timestampMs(segment.startAvailableAt), ledgerOrdinal: segment.startOrdinal },
      sessionStartProven: segment.sessionStartProven, scope: segment.scope, captureCompleteness: segment.captureCompleteness,
      quality: segment.quality, reason: clockInvalid ? 'CVD_CHART_TIME_LINEAGE_INVALID' : segment.reason,
      clockInvalid, terminalInvalid, inputPointCount: all.length, points: selected };
  });
  const current = s.segments.at(-1);
  const currentMatches = current && equal(current.identity, s.activeIdentity);
  const priceBars = aggregateChartBars(price.bars, timeframe).bars;
  if (priceBars.length > CHART_LIMITS.bars) fail('CVD_CHART_BAR_BUDGET');
  const bars = priceBars.map(b => ({ time: timestampMs(b.time) / 1000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume,
    actualContract: b.actualContract, tradeDate: b.sessionTradeDate, session: b.session, availableAt: b.availableAt }));
  const result = { schemaVersion: 'cru54-cvd-chart-v1', ...SAFETY, timeframe, sourceMode: 'PINNED_HISTORICAL_GENERATION',
    generationHash: generation.generationHash, semanticHash: generation.result.semanticHash,
    cutoff: { sourceLedgerIdentity: s.sourceLedgerIdentity, ledgerOrdinal: s.cutoffLedgerOrdinal, recordHash: s.cutoffRecordHash, prefixSha256: generation.prefixSha256 },
    identity: s.activeIdentity, actualContract: s.activeIdentity?.[0] ?? null, tradeDate: s.activeIdentity?.[1] ?? null, session: s.activeIdentity?.[2] ?? null,
    continuityEpoch: s.activeIdentity?.[3] ?? null, segmentIndex: currentMatches ? s.segments.length - 1 : null,
    origin: currentMatches ? segments.at(-1).origin : null, sessionStartProven: currentMatches ? current.sessionStartProven : false,
    scope: 'OBSERVED_FRAGMENT', captureCompleteness: s.captureCompleteness, nativeMissingSequenceCount: s.nativeMissingSequenceCount,
    currentCvd: s.value, availableAt: s.availableAt, lastTradeAvailableAt: s.lastTradeAvailableAt, lastTradeAvailableAtMs: timestampMs(s.lastTradeAvailableAt), quality: currentMatches ? current.quality : 'UNAVAILABLE',
    reason: s.currentReason, classifiedCoverage: currentMatches ? current.classifiedCoverage : null,
    summary: currentMatches ? { buyProxyVolume: current.buyProxyVolume, sellProxyVolume: current.sellProxyVolume, unknownVolume: current.unknownVolume, totalExecutedVolume: current.totalExecutedVolume } : null,
    segments, bars, priceReason: price.reason, priceTimeLineageViolationCount: price.timeLineageViolationCount,
    display: { cvdTime: 'AVAILABLE_AT', priceTime: 'EXCHANGE_BAR_START', selection: 'PHYSICAL_ORDER_MIN_MAX_FIRST_LAST', inputPoints: s.series.length,
      outputPoints: segments.reduce((n, seg) => n + seg.points.length, 0), maxPoints: CHART_LIMITS.points, maxBars: CHART_LIMITS.bars,
      endpoint: s.value, currentPlotAvailable: !!currentMatches && !segments.at(-1)?.clockInvalid,
      historyLastCvd: s.series.at(-1)?.value ?? null, boundaryAtCutoff: s.value == null && s.series.at(-1)?.value != null },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > CHART_LIMITS.responseBytes) fail('CVD_CHART_RESPONSE_BUDGET');
  return result;
}

export function withFreshness(projection, now = Date.now()) {
  const ms = projection.availableAt == null ? null : timestampMs(projection.lastTradeAvailableAt), age = ms == null ? null : now - ms;
  // A pinned generation cannot certify a current live feed, even when its timestamp is recent.
  return { ...projection, freshness: { state: age == null || age < 0 ? 'UNAVAILABLE' : age > 60_000 ? 'STALE' : 'HISTORICAL',
    reason: age == null ? 'TRADE_AVAILABLE_AT_MISSING' : age < 0 ? 'TRADE_AVAILABLE_AT_IN_FUTURE' : 'PINNED_GENERATION_NOT_LIVE', ageMs: age, assessedAt: new Date(now).toISOString() } };
}

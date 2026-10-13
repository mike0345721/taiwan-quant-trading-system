// Keep timestamp restrictions on the values that actually depend on an event.
// This module NEVER repairs a raw timestamp, clears session-level quality,
// promotes a target, or authorizes execution. Clean-window evidence is descriptive.
const REASON = 'TIMESTAMP_LINEAGE_INSUFFICIENT';
const WIDTH = Object.freeze({ '1m': 60000, '5m': 300000, '15m': 900000,
  '30m': 1800000, '1h': 3600000, '4h': 14400000 });
const REQUIRED_BARS = 12;
const FRESH_MS = 120000;
function ms(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const n = Date.parse(/(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : text + '+08:00');
  return Number.isFinite(n) ? n : null;
}
const iso = n => Number.isFinite(n) ? new Date(n).toISOString() : null;
function limit(value, count) {
  if (!value || !count) return value;
  return Object.freeze({ ...value,
    qualityStatus: ['UNAVAILABLE', 'UNKNOWN'].includes(value.qualityStatus)
      ? value.qualityStatus : 'QUALITY_INSUFFICIENT',
    qualityReasons: Object.freeze([...new Set([...(value.qualityReasons || []), REASON])]),
    timeLineageViolationCount: Math.max(Number(value.timeLineageViolationCount) || 0, count),
  });
}
function inputMatches(v, chart) {
  return Boolean(chart.actualContract && chart.tradeDate && v.actualContract === chart.actualContract
    && v.sessionTradeDate === chart.tradeDate);
}
function barViolationCount(bar, violations, timeframe) {
  const start = ms(timeframe === '1D' ? bar.sessionStart : bar.time);
  const end = timeframe === '1D' ? ms(bar.sessionEnd) : start == null ? null : start + WIDTH[timeframe];
  if (start == null || !Number.isFinite(end)) return 0;
  let count = 0;
  for (const v of violations) {
    if (bar.actualContract !== v.actualContract || bar.tradeDate !== v.sessionTradeDate) continue;
    if (timeframe !== '1D' && (bar.session !== v.session || (bar.sessionId && bar.sessionId !== v.sessionId))) continue;
    if (v.bucketEventMs >= start && v.bucketEventMs < end) count++;
  }
  return count;
}
function countThrough(violations, session, availableAt, start = null, end = null) {
  const available = ms(availableAt);
  if (available == null || !['DAY', 'NIGHT'].includes(session)) return 0;
  return violations.filter(v => {
    const event = v.eventMs, effective = v.effectiveMs;
    return v.session === session && event != null && effective != null && effective <= available
      && (start == null || event >= start) && (end == null || event < end);
  }).length;
}
function cleanWindow(chart, bars, violations, cutoff) {
  const at = ms(cutoff), sourceAt = ms(chart.availableAt);
  const lastBad = violations.reduce((n, v) => Math.max(n, v.effectiveMs), -Infinity);
  const base = { timeframe: '5m', requiredCompletedBars: REQUIRED_BARS,
    consecutiveCleanCompletedBars: 0, start: null, end: null,
    lastViolationAt: iso(lastBad), assessmentAt: iso(at),
    scope: 'TIMESTAMP_AND_EXISTING_BAR_QUALITY_ONLY_NOT_FEED_COMPLETENESS',
    restoresSessionQuality: false, restoresTargets: false };
  if (chart.timeframe !== '5m') return Object.freeze({ ...base, state: 'NOT_ASSESSED_TIMEFRAME' });
  if (at == null || sourceAt == null || sourceAt > at || at - sourceAt > FRESH_MS) {
    return Object.freeze({ ...base, state: 'WAIT_FRESH_SOURCE' });
  }
  const completed = bars.filter(b => {
    const t = ms(b.time), available = ms(b.availableAt);
    return t != null && available != null && t + WIDTH['5m'] <= at && available <= at;
  });
  const picked = [];
  let expected = null;
  for (let i = completed.length - 1; i >= 0 && picked.length < REQUIRED_BARS; i--) {
    const b = completed[i], t = ms(b.time);
    if (b.qualityStatus !== 'PASS' || b.actualContract !== chart.actualContract
      || b.tradeDate !== chart.tradeDate || b.session !== chart.session
      || t <= lastBad || (expected != null && t !== expected)) break;
    picked.unshift(b); expected = t - WIDTH['5m'];
  }
  const lastEnd = picked.length ? ms(picked.at(-1).time) + WIDTH['5m'] : null;
  const recent = lastEnd != null && at - lastEnd < WIDTH['5m'];
  return Object.freeze({ ...base, consecutiveCleanCompletedBars: picked.length,
    start: picked[0]?.time ?? null, end: iso(lastEnd),
    state: picked.length === REQUIRED_BARS && recent ? 'CLEAN_LOCAL_BARS_OBSERVED' : 'WAIT_CLEAN_COMPLETED_BARS' });
}

/** Attach dependency quality after the existing session gate has been applied. */
export function attachTimestampDependencyQuality(chart, scopedViolations, { cutoff } = {}) {
  if (!chart || !Array.isArray(scopedViolations) || !scopedViolations.length) return chart;
  const cutoffMs = ms(cutoff);
  const violations = scopedViolations.filter(v => inputMatches(v, chart)
    && ms(v.effectiveAvailableAt) != null && cutoffMs != null && ms(v.effectiveAvailableAt) <= cutoffMs)
    .map(v => {
      const eventMs = ms(v.exchangeTimestamp), effectiveMs = ms(v.effectiveAvailableAt);
      const end = ms(v.sessionEnd);
      return { ...v, eventMs, effectiveMs, bucketEventMs: eventMs === end ? eventMs - 1 : eventMs };
    });
  if (!violations.length) return chart;
  const bars = Object.freeze((chart.bars || []).map(bar =>
    limit(bar, barViolationCount(bar, violations, chart.timeframe))));
  const vwapSession = chart.vwapSession || chart.session;
  const vwap = Object.freeze((chart.vwap || []).map(point =>
    limit(point, countThrough(violations, vwapSession, point.availableAt))));
  const levels = { ...(chart.levels || {}) };
  const dependencies = { currentDayHigh: 'DAY', currentDayLow: 'DAY',
    nightHigh: 'NIGHT', nightLow: 'NIGHT', vwap: vwapSession };
  for (const [name, session] of Object.entries(dependencies)) {
    const value = levels[name];
    if (value?.availability === 'AVAILABLE') levels[name] = limit(value, countThrough(violations, session, value.availableAt));
  }
  // Frozen OR uses only 08:45 <= eventTime < 09:00. Later clock problems
  // cannot contaminate this independent, previously frozen input window.
  const orStart = ms(chart.tradeDate + 'T08:45:00+08:00');
  const orEnd = ms(chart.tradeDate + 'T09:00:00+08:00');
  let openingRange = chart.openingRange;
  if (openingRange && orStart != null && orEnd != null) {
    const n = countThrough(violations, 'DAY', openingRange.availableAt, orStart, orEnd);
    if (n) openingRange = Object.freeze({ ...limit(openingRange, n),
      status: openingRange.status === 'READY' ? 'QUALITY_INSUFFICIENT' : openingRange.status });
    for (const name of ['openingRangeHigh', 'openingRangeLow']) {
      const value = levels[name];
      if (value?.availability === 'AVAILABLE') levels[name] = limit(value,
        countThrough(violations, 'DAY', value.availableAt, orStart, orEnd));
    }
  }
  // Prior-day references have independent governed provenance. Do not rewrite
  // them using this session's violations or treat missing provenance as PASS.
  return Object.freeze({ ...chart, bars, vwap, levels: Object.freeze(levels), openingRange,
    timestampDependencyQuality: Object.freeze({ schemaVersion: 'chart-timestamp-dependency-quality-v1',
      selectedContractViolationCount: violations.length,
      restrictedBarCount: bars.filter(b => Number(b.timeLineageViolationCount) > 0).length,
      recentWindow: cleanWindow(chart, bars, violations, cutoff),
      rawEvidenceRewritten: false, sessionRestrictionCleared: false, executionAuthorized: false }) });
}

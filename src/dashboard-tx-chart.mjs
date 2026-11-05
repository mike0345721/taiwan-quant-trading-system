import crypto from 'node:crypto';
import { resolveGovernedTradingDay } from './market-state-forward-shadow-calendar.mjs';
import { contractMonthFromLiveCode } from './v310-forward-operations.mjs';

const TAIPEI_OFFSET = '+08:00';
const MINUTE_MS = 60_000;
const NORMALIZED_TICK_CACHE = new WeakMap();
const TAIPEI_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});
const TIMEFRAME_MINUTES = Object.freeze({
  '1m': 1,
  '5m': 5,
  '15m': 15,
  '30m': 30,
  '1h': 60,
  '4h': 240,
});

export const CHART_BAR_CONTRACT = Object.freeze({
  schemaVersion: 'chart-bar-contract-v2',
  source: 'actual TX contract executed Tick',
  baseTimeframe: '1m',
  supportedTimeframes: Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', '1D']),
  dailySemantics: 'NIGHT_PLUS_DAY_TRADE_DATE',
  dailyIdentity: '<sessionTradeDate>-TRADE_DATE',
  sessionPolicy: 'PP1_POLICY_V1_WITH_GOVERNED_TAIFEX_TRADING_CALENDAR',
  dayOpeningRange: '08:45-09:00 Asia/Taipei',
  volumeDefinition: 'same actual TX contract executed trade volume',
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
});

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

// Shared chart ordering provenance. Callers supply the same availability text
// that the chart normalizer sees; its spelling is part of fallback event IDs.
export function txChartTickOrderKey({ eventId, actualContract, exchangeTimestamp, availableAt, price, volume }) {
  return {
    eventId: eventId || digest([actualContract, exchangeTimestamp, availableAt, price, volume]),
    exchangeMs: timestampMs(exchangeTimestamp),
    availableMs: timestampMs(availableAt),
  };
}

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function maximum(rows, field) {
  return rows.reduce((value, row) => Math.max(value, row[field]), -Infinity);
}
function minimum(rows, field) {
  return rows.reduce((value, row) => Math.min(value, row[field]), Infinity);
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}${TAIPEI_OFFSET}`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? parsed : null;
}

function taipeiParts(value) {
  const parts = TAIPEI_FORMATTER.formatToParts(value).filter((part) => part.type !== 'literal');
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

function taipeiDate(value) {
  const parts = taipeiParts(value);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateShift(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function zoned(date, time) {
  return `${date}T${time}${TAIPEI_OFFSET}`;
}

function officialTradingDay(calendar, date) {
  try { return resolveGovernedTradingDay(calendar, date).officialTradingDay; }
  catch { return false; }
}

function nextOfficialTradeDate(calendar, afterDate) {
  for (let offset = 1; offset <= 10; offset += 1) {
    const candidate = dateShift(afterDate, offset);
    if (officialTradingDay(calendar, candidate)) return candidate;
  }
  throw new Error('TX_CHART_NEXT_OFFICIAL_TRADE_DATE_UNAVAILABLE');
}

export function classifyTxChartSession(eventTimestamp, calendar) {
  const eventMs = timestampMs(eventTimestamp);
  if (eventMs == null) throw new Error('TX_CHART_EXCHANGE_TIMESTAMP_INVALID');
  const parts = taipeiParts(new Date(eventMs));
  const calendarDate = `${parts.year}-${parts.month}-${parts.day}`;
  const minuteOfDay = Number(parts.hour) * 60 + Number(parts.minute);
  const second = Number(parts.second);

  if (minuteOfDay >= 8 * 60 + 45 && (minuteOfDay < 13 * 60 + 45 || (minuteOfDay === 13 * 60 + 45 && second === 0))) {
    if (!officialTradingDay(calendar, calendarDate)) throw new Error('TX_CHART_DAY_NOT_OFFICIAL_TRADING_DATE');
    return Object.freeze({
      calendarDate,
      tradeDate: calendarDate,
      sessionTradeDate: calendarDate,
      session: 'DAY',
      sessionId: `${calendarDate}-DAY`,
      sessionStart: new Date(zoned(calendarDate, '08:45:00')).toISOString(),
      sessionEnd: new Date(zoned(calendarDate, '13:45:00')).toISOString(),
      crossMidnight: false,
    });
  }

  const closingBoundary = minuteOfDay === 5 * 60 && second === 0;
  if (minuteOfDay >= 15 * 60 || minuteOfDay < 5 * 60 || closingBoundary) {
    const startCalendarDate = minuteOfDay >= 15 * 60 ? calendarDate : dateShift(calendarDate, -1);
    if (!officialTradingDay(calendar, startCalendarDate)) throw new Error('TX_CHART_NIGHT_START_NOT_OFFICIAL_TRADING_DATE');
    const tradeDate = nextOfficialTradeDate(calendar, startCalendarDate);
    const endCalendarDate = dateShift(startCalendarDate, 1);
    return Object.freeze({
      calendarDate,
      tradeDate,
      sessionTradeDate: tradeDate,
      session: 'NIGHT',
      sessionId: `${startCalendarDate}-NIGHT`,
      sessionStart: new Date(zoned(startCalendarDate, '15:00:00')).toISOString(),
      sessionEnd: new Date(zoned(endCalendarDate, '05:00:00')).toISOString(),
      crossMidnight: true,
    });
  }
  throw new Error('TX_CHART_EVENT_OUTSIDE_GOVERNED_SESSION');
}

function normalizeTick(record, calendar) {
  if (record && typeof record === 'object') {
    const byCalendar = NORMALIZED_TICK_CACHE.get(record);
    if (byCalendar?.has(calendar)) return byCalendar.get(calendar);
  }
  const remember = (value) => {
    if (record && typeof record === 'object') {
      let byCalendar = NORMALIZED_TICK_CACHE.get(record);
      if (!byCalendar) {
        byCalendar = new WeakMap();
        NORMALIZED_TICK_CACHE.set(record, byCalendar);
      }
      byCalendar.set(calendar, value);
    }
    return value;
  };
  if (record?.kind !== 'futures_tick' || record?.duplicate === true) return remember(null);
  if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) {
    throw new Error('TX_CHART_EXECUTION_BOUNDARY_INVALID');
  }
  const payload = record.payload || {};
  const productFamily = payload._product_family || (/^TXF[A-L]\d$/.test(record.product || '') ? 'TX' : null);
  if (productFamily !== 'TX' || payload.simtrade === true) return remember(null);
  const actualContract = String(payload._target_code || record.product || payload.code || '');
  if (!/^TXF[A-L]\d$/.test(actualContract)) return remember(null);
  const exchangeTimestamp = String(payload.datetime || record.exchangeTimestamp || '');
  const exchangeMs = timestampMs(exchangeTimestamp);
  const availableAt = record.receivedAt || payload._received_at || null;
  const availableMs = timestampMs(availableAt);
  const price = finite(payload.close);
  const volume = finite(payload.volume);
  if (exchangeMs == null || availableMs == null || price == null || volume == null || volume <= 0) return remember(null);
  const context = classifyTxChartSession(exchangeTimestamp, calendar);
  if (availableMs < exchangeMs) {
    return remember(Object.freeze({
      invalidReason: 'AVAILABLE_AT_BEFORE_EXCHANGE_TIMESTAMP',
      actualContract,
      exchangeTimestamp: new Date(exchangeMs).toISOString(),
      availableAt: new Date(availableMs).toISOString(),
      deltaMs: availableMs - exchangeMs,
      ...context,
    }));
  }
  if (exchangeMs < Date.parse(context.sessionStart) || exchangeMs > Date.parse(context.sessionEnd)) return null;
  return remember(Object.freeze({
    ...txChartTickOrderKey({ eventId: record.eventId, actualContract, exchangeTimestamp, availableAt, price, volume }),
    exchangeTimestamp: new Date(exchangeMs).toISOString(),
    availableAt: new Date(availableMs).toISOString(),
    price,
    volume,
    actualContract,
    contractMonth: contractMonthFromLiveCode(actualContract, context.sessionTradeDate),
    sequenceGap: Math.max(0, Number(record.sequenceGap) || 0),
    ...context,
  }));
}

function tickOrder(left, right) {
  return left.exchangeMs - right.exchangeMs
    || left.availableMs - right.availableMs
    || left.eventId.localeCompare(right.eventId);
}

export { tickOrder as compareTxChartTicks };

function bucketStartMs(tick, widthMinutes) {
  const sessionStartMs = Date.parse(tick.sessionStart);
  const sessionEndMs = Date.parse(tick.sessionEnd);
  const effectiveMs = tick.exchangeMs === sessionEndMs ? tick.exchangeMs - 1 : tick.exchangeMs;
  return sessionStartMs + Math.floor((effectiveMs - sessionStartMs) / (widthMinutes * MINUTE_MS)) * widthMinutes * MINUTE_MS;
}

function createBar(tick, startMs) {
  return {
    time: new Date(startMs).toISOString(),
    tradeDate: tick.tradeDate,
    sessionTradeDate: tick.sessionTradeDate,
    session: tick.session,
    sessionId: tick.sessionId,
    sessionStart: tick.sessionStart,
    sessionEnd: tick.sessionEnd,
    actualContract: tick.actualContract,
    contractMonth: tick.contractMonth,
    open: tick.price,
    high: tick.price,
    low: tick.price,
    close: tick.price,
    volume: tick.volume,
    firstEventTime: tick.exchangeTimestamp,
    lastEventTime: tick.exchangeTimestamp,
    availableAt: tick.availableAt,
    qualityStatus: tick.sequenceGap > 0 ? 'QUALITY_INSUFFICIENT' : 'PASS',
    eventCount: 1,
    sequenceGapCount: tick.sequenceGap,
    _priceVolume: tick.price * tick.volume,
  };
}

function updateBar(bar, tick) {
  bar.high = Math.max(bar.high, tick.price);
  bar.low = Math.min(bar.low, tick.price);
  bar.close = tick.price;
  bar.volume += tick.volume;
  bar.lastEventTime = tick.exchangeTimestamp;
  if (tick.availableAt > bar.availableAt) bar.availableAt = tick.availableAt;
  bar.eventCount += 1;
  bar.sequenceGapCount += tick.sequenceGap;
  bar._priceVolume += tick.price * tick.volume;
  if (bar.sequenceGapCount > 0) bar.qualityStatus = 'QUALITY_INSUFFICIENT';
}

function publicBar(bar) {
  const { _priceVolume, ...result } = bar;
  return Object.freeze(result);
}

// Streaming summaries retain extrema and provenance, never representative/fake
// ticks. The caller supplies the same stable tickOrder as the array builder so
// floating-point additions have exactly the same order as the original path.
function emptyTickSummary() {
  return { count: 0, first: null, last: null, high: null, low: null, volume: 0,
    availableAt: null, sequenceGapEventCount: 0, sequenceGapSize: 0, contracts: new Map(), opening: null };
}

function addTickSummary(summary, tick, includeOpening = true) {
  summary.count += 1;
  if (!summary.first || tickOrder(tick, summary.first) < 0) summary.first = tick;
  if (!summary.last || tickOrder(tick, summary.last) >= 0) summary.last = tick;
  summary.high = summary.high == null ? tick.price : Math.max(summary.high, tick.price);
  summary.low = summary.low == null ? tick.price : Math.min(summary.low, tick.price);
  summary.volume += tick.volume;
  if (summary.availableAt == null || tick.availableAt > summary.availableAt) summary.availableAt = tick.availableAt;
  summary.sequenceGapEventCount += tick.sequenceGap > 0 ? 1 : 0;
  summary.sequenceGapSize += tick.sequenceGap;
  const prior = summary.contracts.get(tick.actualContract);
  if (!prior || tickOrder(tick, prior) < 0) summary.contracts.set(tick.actualContract, tick);
  if (includeOpening && tick.session === 'DAY') {
    const start = Date.parse(zoned(tick.tradeDate, '08:45:00'));
    if (tick.exchangeMs >= start && tick.exchangeMs < start + 15 * MINUTE_MS) {
      summary.opening ||= emptyTickSummary();
      addTickSummary(summary.opening, tick, false);
    }
  }
}

function summaryContracts(summary) {
  return [...summary.contracts.values()].sort(tickOrder).map((tick) => tick.actualContract);
}

function summaryLevel(name, value, summary, source, qualityStatus = 'PASS') {
  if (value == null || !summary.count) return Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason: 'SOURCE_UNAVAILABLE' });
  return Object.freeze({ name, availability: 'AVAILABLE', value, source,
    tradeDate: summary.first.tradeDate, session: summary.first.session,
    eventTime: summary.last.exchangeTimestamp, availableAt: summary.last.availableAt,
    actualContract: summary.first.actualContract, qualityStatus });
}

function summaryOpeningRange(summary, asOfMs) {
  if (!summary.count || summary.first.session !== 'DAY') {
    return Object.freeze({ status: 'NOT_APPLICABLE', high: null, low: null, reason: 'NIGHT_OPENING_RANGE_NOT_FROZEN' });
  }
  const endMs = Date.parse(zoned(summary.first.tradeDate, '09:00:00'));
  if (asOfMs < endMs) return Object.freeze({ status: 'FORMING', high: null, low: null, reason: 'OPENING_RANGE_NOT_COMPLETE' });
  const opening = summary.opening;
  if (!opening?.count) return Object.freeze({ status: 'UNAVAILABLE', high: null, low: null, reason: 'OPENING_RANGE_TICKS_UNAVAILABLE' });
  const qualityStatus = opening.sequenceGapEventCount > 0 ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({ status: qualityStatus === 'PASS' ? 'READY' : 'QUALITY_INSUFFICIENT',
    high: opening.high, low: opening.low, source: 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900',
    tradeDate: summary.first.tradeDate, session: 'DAY', eventTime: opening.last.exchangeTimestamp,
    availableAt: new Date(Math.max(endMs, Date.parse(opening.availableAt))).toISOString(),
    actualContract: summary.first.actualContract, qualityStatus });
}

function summaryCoverage(summary, session, timeLineageViolationCount = 0) {
  const contracts = summaryContracts(summary);
  const qualityStatus = !summary.count ? 'UNAVAILABLE'
    : contracts.length !== 1 || summary.sequenceGapEventCount > 0 || timeLineageViolationCount > 0
      ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({ session, eventCount: summary.count,
    firstEventTime: summary.first?.exchangeTimestamp || null,
    lastEventTime: summary.last?.exchangeTimestamp || null,
    availableAt: summary.availableAt, actualContract: contracts.length === 1 ? contracts[0] : null,
    availableContracts: Object.freeze(contracts), qualityStatus,
    sequenceGapEventCount: summary.sequenceGapEventCount, sequenceGapSize: summary.sequenceGapSize,
    timeLineageViolationCount });
}

function buildStreamingChartBase(ticks, { calendar, asOf, tradeDate, session, timeframe }) {
  if (!calendar) throw new Error('TX_CHART_GOVERNED_CALENDAR_REQUIRED');
  const asOfMs = asOf == null ? Infinity : timestampMs(asOf);
  if (asOfMs == null) throw new Error('TX_CHART_AS_OF_INVALID');
  const base = { all: emptyTickSummary(), day: emptyTickSummary(), night: emptyTickSummary(),
    contracts: new Map(), sessions: new Map(), internalBars: [],
    futureExcluded: 0, timeLineageViolationCount: 0, dayViolations: 0, nightViolations: 0,
    futureDataViolations: 0 };
  const bars = new Map();
  let previous = null;
  const inScope = (tick) => timeframe === '1D' ? tick.sessionTradeDate === tradeDate
    : (!tradeDate || tick.tradeDate === tradeDate) && (!session || tick.session === session);
  for (const tick of ticks || []) {
    if (!tick) continue;
    if (tick.invalidReason) {
      if (inScope(tick)) {
        base.timeLineageViolationCount += 1;
        if (tick.session === 'DAY') base.dayViolations += 1;
        if (tick.session === 'NIGHT') base.nightViolations += 1;
      }
      continue;
    }
    if (tick.availableMs > asOfMs || tick.exchangeMs > asOfMs) { base.futureExcluded += 1; continue; }
    if (previous && tickOrder(previous, tick) > 0) throw new Error('TX_CHART_STREAM_ORDER_INVALID');
    previous = tick;
    const startMs = bucketStartMs(tick, 1);
    const key = `${tick.sessionId}|${tick.actualContract}|${startMs}`;
    const bar = bars.get(key);
    if (bar) updateBar(bar, tick); else bars.set(key, createBar(tick, startMs));
    if (!inScope(tick)) continue;
    addTickSummary(base.all, tick);
    addTickSummary(tick.session === 'DAY' ? base.day : base.night, tick);
    let contract = base.contracts.get(tick.actualContract);
    if (!contract) {
      contract = { all: emptyTickSummary(), day: emptyTickSummary(), night: emptyTickSummary() };
      base.contracts.set(tick.actualContract, contract);
    }
    addTickSummary(contract.all, tick);
    addTickSummary(tick.session === 'DAY' ? contract.day : contract.night, tick);
    const sessionKey = `${tick.sessionId}|${tick.actualContract}`;
    let selected = base.sessions.get(sessionKey);
    if (!selected) { selected = emptyTickSummary(); base.sessions.set(sessionKey, selected); }
    addTickSummary(selected, tick);
  }
  base.internalBars = [...bars.values()].sort((left, right) => left.time.localeCompare(right.time));
  return base;
}

export function buildOneMinuteBars(records, { calendar, asOf = null } = {}) {
  if (!calendar) throw new Error('TX_CHART_GOVERNED_CALENDAR_REQUIRED');
  const asOfMs = asOf == null ? Infinity : timestampMs(asOf);
  if (asOfMs == null) throw new Error('TX_CHART_AS_OF_INVALID');
  const ticks = [];
  let futureExcluded = 0;
  let timeLineageViolationCount = 0;
  const timeLineageViolations = [];
  for (const record of records || []) {
    const tick = normalizeTick(record, calendar);
    if (!tick) continue;
    if (tick.invalidReason) {
      timeLineageViolationCount += 1;
      timeLineageViolations.push(tick);
      continue;
    }
    if (tick.availableMs > asOfMs || tick.exchangeMs > asOfMs) { futureExcluded += 1; continue; }
    ticks.push(tick);
  }
  ticks.sort(tickOrder);
  const bars = new Map();
  for (const tick of ticks) {
    const startMs = bucketStartMs(tick, 1);
    const key = `${tick.sessionId}|${tick.actualContract}|${startMs}`;
    const bar = bars.get(key);
    if (bar) updateBar(bar, tick); else bars.set(key, createBar(tick, startMs));
  }
  const oneMinuteBars = [...bars.values()].sort((left, right) => left.time.localeCompare(right.time));
  return Object.freeze({
    ticks: Object.freeze(ticks),
    bars: Object.freeze(oneMinuteBars.map(publicBar)),
    internalBars: oneMinuteBars,
    futureExcluded,
    timeLineageViolationCount,
    timeLineageViolations: Object.freeze(timeLineageViolations),
    sequenceGapEventCount: ticks.filter((tick) => tick.sequenceGap > 0).length,
    sequenceGapSize: ticks.reduce((sum, tick) => sum + tick.sequenceGap, 0),
    futureDataViolations: 0,
  });
}

export function aggregateChartBars(oneMinuteBars, timeframe) {
  const minutes = TIMEFRAME_MINUTES[timeframe];
  if (!minutes) throw new Error('TX_CHART_TIMEFRAME_UNSUPPORTED');
  if (timeframe === '1m') return Object.freeze({ status: 'READY', bars: Object.freeze(oneMinuteBars.map(publicBar)) });
  const aggregated = new Map();
  for (const source of oneMinuteBars) {
    const sessionStartMs = Date.parse(source.sessionStart);
    const sourceMs = Date.parse(source.time);
    const startMs = sessionStartMs + Math.floor((sourceMs - sessionStartMs) / (minutes * MINUTE_MS)) * minutes * MINUTE_MS;
    const key = `${source.sessionId}|${source.actualContract}|${startMs}`;
    let bar = aggregated.get(key);
    if (!bar) {
      bar = {
        ...source,
        time: new Date(startMs).toISOString(),
        _priceVolume: Number(source._priceVolume) || Number(source.close) * Number(source.volume),
      };
      aggregated.set(key, bar);
      continue;
    }
    bar.high = Math.max(Number(bar.high), Number(source.high));
    bar.low = Math.min(Number(bar.low), Number(source.low));
    bar.close = Number(source.close);
    bar.volume += Number(source.volume);
    bar.lastEventTime = source.lastEventTime;
    if (source.availableAt > bar.availableAt) bar.availableAt = source.availableAt;
    bar.eventCount += Number(source.eventCount) || 0;
    bar.sequenceGapCount += Number(source.sequenceGapCount) || 0;
    bar._priceVolume += Number(source._priceVolume) || Number(source.close) * Number(source.volume);
    if (source.qualityStatus !== 'PASS') bar.qualityStatus = 'QUALITY_INSUFFICIENT';
  }
  return Object.freeze({ status: 'READY', bars: Object.freeze([...aggregated.values()].sort((left, right) => left.time.localeCompare(right.time)).map(publicBar)) });
}

function coverageForSession(ticks, session, timeLineageViolationCount = 0) {
  const ordered = [...ticks].sort(tickOrder);
  const contracts = [...new Set(ordered.map((tick) => tick.actualContract))];
  const sequenceGapEventCount = ordered.filter((tick) => tick.sequenceGap > 0).length;
  const sequenceGapSize = ordered.reduce((sum, tick) => sum + tick.sequenceGap, 0);
  const qualityStatus = !ordered.length ? 'UNAVAILABLE'
    : contracts.length !== 1 || sequenceGapEventCount > 0 || timeLineageViolationCount > 0
      ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({
    session,
    eventCount: ordered.length,
    firstEventTime: ordered[0]?.exchangeTimestamp || null,
    lastEventTime: ordered.at(-1)?.exchangeTimestamp || null,
    availableAt: ordered.map((tick) => tick.availableAt).sort().at(-1) || null,
    actualContract: contracts.length === 1 ? contracts[0] : null,
    availableContracts: Object.freeze(contracts),
    qualityStatus,
    sequenceGapEventCount,
    sequenceGapSize,
    timeLineageViolationCount,
  });
}

function qualityReasons({ coverageState, contractConsistencyState, sequenceGapEventCount, timeLineageViolationCount }) {
  const reasons = [];
  if (coverageState !== 'COMPLETE') {
    if (coverageState === 'UNAVAILABLE') reasons.push('TRADE_DATE_TICK_SOURCE_UNAVAILABLE');
  }
  if (contractConsistencyState === 'MISMATCH') reasons.push('ACTUAL_CONTRACT_MISMATCH');
  if (sequenceGapEventCount > 0) reasons.push('SEQUENCE_CONTINUITY_INSUFFICIENT');
  if (timeLineageViolationCount > 0) reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  return reasons;
}

function buildDailyTradeDateBar(base, {
  tradeDate,
  asOf,
  actualContract = null,
}) {
  const asOfMs = timestampMs(asOf);
  const tradeDateTicks = base.ticks.filter((tick) => tick.sessionTradeDate === tradeDate);
  const tradeDateViolations = base.timeLineageViolations.filter((tick) => tick.sessionTradeDate === tradeDate);
  const nightTicksAll = tradeDateTicks.filter((tick) => tick.session === 'NIGHT');
  const dayTicksAll = tradeDateTicks.filter((tick) => tick.session === 'DAY');
  const nightViolationCount = tradeDateViolations.filter((tick) => tick.session === 'NIGHT').length;
  const dayViolationCount = tradeDateViolations.filter((tick) => tick.session === 'DAY').length;
  const nightCoverage = coverageForSession(nightTicksAll, 'NIGHT', nightViolationCount);
  const dayCoverage = coverageForSession(dayTicksAll, 'DAY', dayViolationCount);
  const nightContracts = nightCoverage.availableContracts;
  const dayContracts = dayCoverage.availableContracts;
  const allContracts = [...new Set([...nightContracts, ...dayContracts])];
  const contractMismatch = nightContracts.length > 1 || dayContracts.length > 1
    || (nightContracts.length === 1 && dayContracts.length === 1 && nightContracts[0] !== dayContracts[0]);
  const selectedContract = actualContract
    || (allContracts.length === 1 ? allContracts[0] : null)
    || dayContracts[0]
    || nightContracts[0]
    || null;
  const contractConsistencyState = contractMismatch ? 'MISMATCH'
    : allContracts.length === 1 ? 'MATCH'
      : allContracts.length === 0 ? 'UNAVAILABLE' : 'PARTIAL';
  const nightTicks = nightTicksAll.filter((tick) => tick.actualContract === selectedContract);
  const dayTicks = dayTicksAll.filter((tick) => tick.actualContract === selectedContract);
  const ordered = [...nightTicks, ...dayTicks].sort(tickOrder);
  const hasNight = nightTicks.length > 0;
  const hasDay = dayTicks.length > 0;
  const coverageState = hasNight && hasDay ? 'COMPLETE' : ordered.length ? 'PARTIAL' : 'UNAVAILABLE';
  const dayCloseMs = Date.parse(zoned(tradeDate, '13:45:00'));
  const windowState = asOfMs < dayCloseMs ? 'FORMING' : 'CLOSED';
  const sequenceGapEventCount = ordered.filter((tick) => tick.sequenceGap > 0).length;
  const sequenceGapSize = ordered.reduce((sum, tick) => sum + tick.sequenceGap, 0);
  const timeLineageViolationCount = tradeDateViolations.length;
  const reasons = qualityReasons({ coverageState, contractConsistencyState, sequenceGapEventCount, timeLineageViolationCount });
  if (!hasNight && ordered.length) reasons.unshift('NIGHT_SESSION_MISSING');
  if (!hasDay && ordered.length) reasons.unshift('DAY_SESSION_MISSING');
  const qualityStatus = ordered.length && coverageState === 'COMPLETE' && contractConsistencyState === 'MATCH'
    && sequenceGapEventCount === 0 && timeLineageViolationCount === 0 ? 'PASS'
    : ordered.length ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE';
  const status = contractMismatch ? 'UNAVAILABLE'
    : !ordered.length ? 'UNAVAILABLE'
      : windowState === 'FORMING' ? 'FORMING'
        : qualityStatus === 'PASS' ? 'READY' : 'QUALITY_INSUFFICIENT';
  const bar = ordered.length && !contractMismatch ? Object.freeze({
    time: new Date(zoned(tradeDate, '00:00:00')).toISOString(),
    tradeDate,
    sessionTradeDate: tradeDate,
    session: 'NIGHT_PLUS_DAY',
    sessionId: `${tradeDate}-TRADE_DATE`,
    sessionStart: nightTicks[0]?.sessionStart || dayTicks[0]?.sessionStart || null,
    sessionEnd: new Date(dayCloseMs).toISOString(),
    actualContract: selectedContract,
    contractMonth: ordered[0]?.contractMonth || null,
    open: ordered[0].price,
    high: maximum(ordered, 'price'),
    low: minimum(ordered, 'price'),
    close: ordered.at(-1).price,
    volume: ordered.reduce((sum, tick) => sum + tick.volume, 0),
    firstEventTime: ordered[0].exchangeTimestamp,
    lastEventTime: ordered.at(-1).exchangeTimestamp,
    availableAt: ordered.map((tick) => tick.availableAt).sort().at(-1),
    qualityStatus,
    qualityReasons: Object.freeze([...reasons]),
    eventCount: ordered.length,
    sequenceGapCount: sequenceGapSize,
    windowState,
    coverageState,
  }) : null;
  return Object.freeze({
    status,
    reason: contractMismatch ? 'ACTUAL_CONTRACT_MISMATCH'
      : !ordered.length ? 'TX_TICK_SOURCE_UNAVAILABLE'
        : reasons[0] || null,
    bars: Object.freeze(bar ? [bar] : []),
    ticks: Object.freeze(ordered),
    nightTicks: Object.freeze(nightTicks),
    dayTicks: Object.freeze(dayTicks),
    selectedContract,
    availableContracts: Object.freeze(allContracts),
    contractConsistencyState,
    coverageState,
    windowState,
    sessionCoverage: Object.freeze({ night: nightCoverage, day: dayCoverage }),
    qualityStatus,
    qualityReasons: Object.freeze(reasons),
    sequenceGapEventCount,
    sequenceGapSize,
    timeLineageViolationCount,
  });
}

function cumulativeSessionVwap(oneMinuteBars) {
  let priceVolume = 0;
  let volume = 0;
  return oneMinuteBars.map((bar) => {
    priceVolume += Number(bar._priceVolume) || Number(bar.close) * Number(bar.volume);
    volume += Number(bar.volume);
    return Object.freeze({
      time: bar.time,
      value: volume > 0 ? priceVolume / volume : null,
      availableAt: bar.availableAt,
      sessionId: bar.sessionId,
      actualContract: bar.actualContract,
    });
  });
}

function vwapForTimeframe(vwap1m, bars) {
  const result = [];
  for (const bar of bars) {
    const eligible = vwap1m.filter((point) => point.sessionId === bar.sessionId
      && point.actualContract === bar.actualContract
      && point.time >= bar.time
      && point.time <= bar.lastEventTime
      && point.availableAt <= bar.availableAt);
    const point = eligible.at(-1);
    if (point) result.push(Object.freeze({ time: bar.time, value: point.value, availableAt: point.availableAt }));
  }
  return Object.freeze(result);
}

function level(name, value, ticks, source, qualityStatus = 'PASS') {
  if (value == null || !ticks.length) return Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason: 'SOURCE_UNAVAILABLE' });
  return Object.freeze({
    name,
    availability: 'AVAILABLE',
    value,
    source,
    tradeDate: ticks[0].tradeDate,
    session: ticks[0].session,
    eventTime: ticks.at(-1).exchangeTimestamp,
    availableAt: ticks.at(-1).availableAt,
    actualContract: ticks[0].actualContract,
    qualityStatus,
  });
}

function openingRange(ticks, asOfMs) {
  if (!ticks.length || ticks[0].session !== 'DAY') {
    return Object.freeze({ status: 'NOT_APPLICABLE', high: null, low: null, reason: 'NIGHT_OPENING_RANGE_NOT_FROZEN' });
  }
  const startMs = Date.parse(`${ticks[0].tradeDate}T08:45:00${TAIPEI_OFFSET}`);
  const endMs = Date.parse(`${ticks[0].tradeDate}T09:00:00${TAIPEI_OFFSET}`);
  if (asOfMs < endMs) return Object.freeze({ status: 'FORMING', high: null, low: null, reason: 'OPENING_RANGE_NOT_COMPLETE' });
  const openingTicks = ticks.filter((tick) => tick.exchangeMs >= startMs && tick.exchangeMs < endMs);
  if (!openingTicks.length) return Object.freeze({ status: 'UNAVAILABLE', high: null, low: null, reason: 'OPENING_RANGE_TICKS_UNAVAILABLE' });
  const qualityStatus = openingTicks.some((tick) => tick.sequenceGap > 0) ? 'QUALITY_INSUFFICIENT' : 'PASS';
  const lastInputAvailableMs = maximum(openingTicks, 'availableMs');
  return Object.freeze({
    status: qualityStatus === 'PASS' ? 'READY' : 'QUALITY_INSUFFICIENT',
    high: maximum(openingTicks, 'price'),
    low: minimum(openingTicks, 'price'),
    source: 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900',
    tradeDate: ticks[0].tradeDate,
    session: 'DAY',
    eventTime: openingTicks.at(-1).exchangeTimestamp,
    availableAt: new Date(Math.max(endMs, lastInputAvailableMs)).toISOString(),
    actualContract: ticks[0].actualContract,
    qualityStatus,
  });
}

export function buildTxDecisionChart(records, {
  calendar,
  timeframe = '5m',
  asOf = new Date().toISOString(),
  tradeDate = null,
  session = null,
  actualContract = null,
  priorDay = null,
  mode = 'LIVE',
} = {}) {
  const base = buildOneMinuteBars(records, { calendar, asOf });
  const asOfMs = timestampMs(asOf);
  if (timeframe === '1D') {
    const daily = buildDailyTradeDateBar(base, { tradeDate, asOf, actualContract });
    const selectedTicks = daily.ticks;
    const dayTicks = daily.dayTicks;
    const nightTicks = daily.nightTicks;
    const vwapSession = dayTicks.length ? 'DAY' : nightTicks.length ? 'NIGHT' : 'UNAVAILABLE';
    const vwapTicks = vwapSession === 'DAY' ? dayTicks : vwapSession === 'NIGHT' ? nightTicks : [];
    const vwapBars = base.internalBars.filter((bar) => bar.sessionTradeDate === tradeDate
      && bar.session === vwapSession
      && bar.actualContract === daily.selectedContract);
    const vwap1m = cumulativeSessionVwap(vwapBars);
    const latestVwap = vwap1m.at(-1)?.value ?? null;
    const dailyBar = daily.bars[0];
    const vwap = latestVwap != null && dailyBar ? Object.freeze([Object.freeze({
      time: dailyBar.time,
      value: latestVwap,
      availableAt: vwap1m.at(-1).availableAt,
      vwapSession,
    })]) : Object.freeze([]);
    const or = dayTicks.length
      ? openingRange(dayTicks, asOfMs)
      : Object.freeze({ status: 'NOT_APPLICABLE', high: null, low: null, reason: 'DAY_OPENING_RANGE_NOT_AVAILABLE' });
    const sessionHigh = (ticks) => ticks.length ? maximum(ticks, 'price') : null;
    const sessionLow = (ticks) => ticks.length ? minimum(ticks, 'price') : null;
    const unavailablePrior = (name) => Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason: 'PRIOR_DAY_SOURCE_UNAVAILABLE' });
    const levels = Object.freeze({
      currentDayHigh: level('CURRENT_DAY_HIGH', sessionHigh(dayTicks), dayTicks, 'ACTUAL_TX_TICK_STREAM'),
      currentDayLow: level('CURRENT_DAY_LOW', sessionLow(dayTicks), dayTicks, 'ACTUAL_TX_TICK_STREAM'),
      nightHigh: level('NIGHT_HIGH', sessionHigh(nightTicks), nightTicks, 'ACTUAL_TX_TICK_STREAM'),
      nightLow: level('NIGHT_LOW', sessionLow(nightTicks), nightTicks, 'ACTUAL_TX_TICK_STREAM'),
      previousDayHigh: unavailablePrior('PREVIOUS_DAY_HIGH'),
      previousDayLow: unavailablePrior('PREVIOUS_DAY_LOW'),
      previousClose: unavailablePrior('PREVIOUS_CLOSE'),
      openingRangeHigh: or.high == null ? Object.freeze({ name: 'OR_HIGH', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_HIGH', availability: 'AVAILABLE', value: or.high }),
      openingRangeLow: or.low == null ? Object.freeze({ name: 'OR_LOW', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_LOW', availability: 'AVAILABLE', value: or.low }),
      vwap: latestVwap == null ? Object.freeze({ name: 'VWAP', availability: 'UNAVAILABLE', value: null, reason: 'TX_TICK_VOLUME_UNAVAILABLE', vwapSession })
        : Object.freeze({ ...level('VWAP', latestVwap, vwapTicks, 'SESSION_EXACT_TX_TICK_VWAP'), vwapSession }),
    });
    return Object.freeze({
      schemaVersion: 'governed-tx-decision-chart-v2',
      barContract: CHART_BAR_CONTRACT,
      status: daily.status,
      reason: daily.reason,
      mode,
      timeframe,
      tradeDate,
      sessionTradeDate: tradeDate,
      session: 'NIGHT_PLUS_DAY',
      sessionId: tradeDate ? `${tradeDate}-TRADE_DATE` : null,
      actualContract: daily.selectedContract,
      contractMonth: selectedTicks[0]?.contractMonth || null,
      availableContracts: daily.availableContracts,
      contractRollover: Object.freeze({
        detected: daily.contractConsistencyState === 'MISMATCH',
        policy: 'NIGHT_DAY_ACTUAL_CONTRACT_MUST_MATCH',
        excludedContracts: Object.freeze(daily.contractConsistencyState === 'MISMATCH' ? [...daily.availableContracts] : []),
      }),
      contractConsistencyState: daily.contractConsistencyState,
      windowState: daily.windowState,
      coverageState: daily.coverageState,
      sessionCoverage: daily.sessionCoverage,
      asOf: asOfMs == null ? null : new Date(asOfMs).toISOString(),
      bars: daily.bars,
      vwap,
      vwapSession,
      openingRange: or,
      levels,
      lastPrice: selectedTicks.at(-1)?.price ?? null,
      lastEventTime: selectedTicks.at(-1)?.exchangeTimestamp ?? null,
      availableAt: selectedTicks.map((tick) => tick.availableAt).sort().at(-1) || null,
      qualityStatus: daily.qualityStatus,
      qualityReasons: daily.qualityReasons,
      sequenceGapEventCount: daily.sequenceGapEventCount,
      sequenceGapSize: daily.sequenceGapSize,
      source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
      actualContractSelection: 'SHIOAJI_TXFR1_RESOLVED_TARGET_LATEST_LEGAL_TICK',
      sourceEventCount: selectedTicks.length,
      futureExcluded: base.futureExcluded,
      timeLineageViolationCount: daily.timeLineageViolationCount,
      futureDataViolations: base.futureDataViolations,
      barSemanticsOwnerDecisionRequired: false,
      eventMarkerSlots: Object.freeze(['MARKET_STATE_CHANGE', 'OR_BREAK', 'VWAP_RECLAIM_LOSS', 'BREADTH_CONFLICT', 'ESTIMATED_CVD_DIVERGENCE', 'DATA_STALE', 'GLOBAL_ALIGNMENT_CHANGE']),
      markers: Object.freeze([]),
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    });
  }
  const available = base.ticks.filter((tick) => (!tradeDate || tick.tradeDate === tradeDate) && (!session || tick.session === session));
  const contractCandidates = [...new Set(available.map((tick) => tick.actualContract))];
  const sessionContractViolation = contractCandidates.length > 1;
  const selectedContract = actualContract || [...available].sort(tickOrder).at(-1)?.actualContract || null;
  const ticks = available.filter((tick) => tick.actualContract === selectedContract);
  const sessionId = [...ticks].sort(tickOrder).at(-1)?.sessionId || null;
  const selectedTicks = ticks.filter((tick) => tick.sessionId === sessionId);
  const selectedOneMinute = base.internalBars.filter((bar) => bar.sessionId === sessionId && bar.actualContract === selectedContract);
  const timeframeResult = aggregateChartBars(selectedOneMinute, timeframe);
  const bars = timeframeResult.bars;
  const vwap1m = cumulativeSessionVwap(selectedOneMinute);
  const vwap = timeframeResult.status === 'READY' ? vwapForTimeframe(vwap1m, bars) : Object.freeze([]);
  const or = openingRange(selectedTicks, asOfMs);
  const sessionHigh = selectedTicks.length ? maximum(selectedTicks, 'price') : null;
  const sessionLow = selectedTicks.length ? minimum(selectedTicks, 'price') : null;
  const latestVwap = vwap1m.at(-1)?.value ?? null;
  const priorCompatible = priorDay && priorDay.actualContract === selectedContract;
  const unavailablePrior = (name) => Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason: priorDay ? 'ACTUAL_CONTRACT_MISMATCH' : 'PRIOR_DAY_SOURCE_UNAVAILABLE' });
  const levels = Object.freeze({
    currentDayHigh: selectedTicks[0]?.session === 'DAY' ? level('CURRENT_DAY_HIGH', sessionHigh, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : level('CURRENT_DAY_HIGH', null, [], 'ACTUAL_TX_TICK_STREAM'),
    currentDayLow: selectedTicks[0]?.session === 'DAY' ? level('CURRENT_DAY_LOW', sessionLow, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : level('CURRENT_DAY_LOW', null, [], 'ACTUAL_TX_TICK_STREAM'),
    nightHigh: selectedTicks[0]?.session === 'NIGHT' ? level('NIGHT_HIGH', sessionHigh, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : level('NIGHT_HIGH', null, [], 'ACTUAL_TX_TICK_STREAM'),
    nightLow: selectedTicks[0]?.session === 'NIGHT' ? level('NIGHT_LOW', sessionLow, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : level('NIGHT_LOW', null, [], 'ACTUAL_TX_TICK_STREAM'),
    previousDayHigh: priorCompatible ? priorDay.high : unavailablePrior('PREVIOUS_DAY_HIGH'),
    previousDayLow: priorCompatible ? priorDay.low : unavailablePrior('PREVIOUS_DAY_LOW'),
    previousClose: priorCompatible ? priorDay.close : unavailablePrior('PREVIOUS_CLOSE'),
    openingRangeHigh: or.high == null ? Object.freeze({ name: 'OR_HIGH', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_HIGH', availability: 'AVAILABLE', value: or.high }),
    openingRangeLow: or.low == null ? Object.freeze({ name: 'OR_LOW', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_LOW', availability: 'AVAILABLE', value: or.low }),
    vwap: latestVwap == null ? Object.freeze({ name: 'VWAP', availability: 'UNAVAILABLE', value: null, reason: 'TX_TICK_VOLUME_UNAVAILABLE', vwapSession: selectedTicks[0]?.session || session || 'UNAVAILABLE' })
      : Object.freeze({ ...level('VWAP', latestVwap, selectedTicks, 'SESSION_EXACT_TX_TICK_VWAP'), vwapSession: selectedTicks[0]?.session || session || 'UNAVAILABLE' }),
  });
  const scopedTimeLineageViolationCount = base.timeLineageViolations.filter((tick) => (!tradeDate || tick.sessionTradeDate === tradeDate)
    && (!session || tick.session === session)).length;
  const sequenceGapEventCount = selectedTicks.filter((tick) => tick.sequenceGap > 0).length;
  const sequenceGapSize = selectedTicks.reduce((sum, tick) => sum + tick.sequenceGap, 0);
  const intradayQualityReasons = [];
  if (sessionContractViolation) intradayQualityReasons.push('SESSION_CONTRACT_CHANGE_DETECTED');
  if (sequenceGapEventCount > 0) intradayQualityReasons.push('SEQUENCE_CONTINUITY_INSUFFICIENT');
  if (scopedTimeLineageViolationCount > 0) intradayQualityReasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  const qualityStatus = !selectedTicks.length ? 'UNAVAILABLE'
    : sessionContractViolation || scopedTimeLineageViolationCount > 0 || sequenceGapEventCount > 0 ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({
    schemaVersion: 'governed-tx-decision-chart-v2',
    barContract: CHART_BAR_CONTRACT,
    status: timeframeResult.status === 'OWNER_DECISION_REQUIRED' ? 'OWNER_DECISION_REQUIRED'
      : !selectedTicks.length ? 'UNAVAILABLE'
        : sessionContractViolation ? 'QUALITY_INSUFFICIENT' : 'READY',
    reason: timeframeResult.reason || (!selectedTicks.length ? 'TX_TICK_SOURCE_UNAVAILABLE'
      : sessionContractViolation ? 'SESSION_CONTRACT_CHANGE_DETECTED' : null),
    mode,
    timeframe,
    tradeDate: selectedTicks[0]?.tradeDate || tradeDate,
    sessionTradeDate: selectedTicks[0]?.sessionTradeDate || tradeDate,
    session: selectedTicks[0]?.session || session,
    sessionId,
    actualContract: selectedContract,
    contractMonth: selectedTicks[0]?.contractMonth || null,
    availableContracts: Object.freeze(contractCandidates),
    contractRollover: Object.freeze({
      detected: contractCandidates.length > 1,
      policy: 'CONTRACTS_ISOLATED_NEVER_MIXED',
      excludedContracts: Object.freeze(contractCandidates.filter((code) => code !== selectedContract)),
    }),
    asOf: asOfMs == null ? null : new Date(asOfMs).toISOString(),
    bars,
    vwap,
    vwapSession: selectedTicks[0]?.session || session || 'UNAVAILABLE',
    openingRange: or,
    levels,
    lastPrice: selectedTicks.at(-1)?.price ?? null,
    lastEventTime: selectedTicks.at(-1)?.exchangeTimestamp ?? null,
    availableAt: selectedTicks.map((tick) => tick.availableAt).sort().at(-1) || null,
    qualityStatus,
    qualityReasons: Object.freeze(intradayQualityReasons),
    sequenceGapEventCount,
    sequenceGapSize,
    contractConsistencyState: sessionContractViolation ? 'MISMATCH' : selectedTicks.length ? 'MATCH' : 'UNAVAILABLE',
    source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
    actualContractSelection: 'SHIOAJI_TXFR1_RESOLVED_TARGET_LATEST_LEGAL_TICK',
    sourceEventCount: selectedTicks.length,
    futureExcluded: base.futureExcluded,
    timeLineageViolationCount: scopedTimeLineageViolationCount,
    futureDataViolations: base.futureDataViolations,
    barSemanticsOwnerDecisionRequired: false,
    eventMarkerSlots: Object.freeze(['MARKET_STATE_CHANGE', 'OR_BREAK', 'VWAP_RECLAIM_LOSS', 'BREADTH_CONFLICT', 'ESTIMATED_CVD_DIVERGENCE', 'DATA_STALE', 'GLOBAL_ALIGNMENT_CHANGE']),
    markers: Object.freeze([]),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

function buildStreamingDailyTradeDateBar(base, {
  tradeDate,
  asOf,
  actualContract = null,
}) {
  const asOfMs = timestampMs(asOf);
  const nightTicksAll = base.night;
  const dayTicksAll = base.day;
  const nightViolationCount = base.nightViolations;
  const dayViolationCount = base.dayViolations;
  const nightCoverage = summaryCoverage(nightTicksAll, 'NIGHT', nightViolationCount);
  const dayCoverage = summaryCoverage(dayTicksAll, 'DAY', dayViolationCount);
  const nightContracts = nightCoverage.availableContracts;
  const dayContracts = dayCoverage.availableContracts;
  const allContracts = [...new Set([...nightContracts, ...dayContracts])];
  const contractMismatch = nightContracts.length > 1 || dayContracts.length > 1
    || (nightContracts.length === 1 && dayContracts.length === 1 && nightContracts[0] !== dayContracts[0]);
  const selectedContract = actualContract
    || (allContracts.length === 1 ? allContracts[0] : null)
    || dayContracts[0]
    || nightContracts[0]
    || null;
  const contractConsistencyState = contractMismatch ? 'MISMATCH'
    : allContracts.length === 1 ? 'MATCH'
      : allContracts.length === 0 ? 'UNAVAILABLE' : 'PARTIAL';
  const selected = base.contracts.get(selectedContract);
  const nightTicks = selected?.night || emptyTickSummary();
  const dayTicks = selected?.day || emptyTickSummary();
  const ordered = selected?.all || emptyTickSummary();
  const hasNight = nightTicks.count > 0;
  const hasDay = dayTicks.count > 0;
  const coverageState = hasNight && hasDay ? 'COMPLETE' : ordered.count ? 'PARTIAL' : 'UNAVAILABLE';
  const dayCloseMs = Date.parse(zoned(tradeDate, '13:45:00'));
  const windowState = asOfMs < dayCloseMs ? 'FORMING' : 'CLOSED';
  const sequenceGapEventCount = ordered.sequenceGapEventCount;
  const sequenceGapSize = ordered.sequenceGapSize;
  const timeLineageViolationCount = base.timeLineageViolationCount;
  const reasons = qualityReasons({ coverageState, contractConsistencyState, sequenceGapEventCount, timeLineageViolationCount });
  if (!hasNight && ordered.count) reasons.unshift('NIGHT_SESSION_MISSING');
  if (!hasDay && ordered.count) reasons.unshift('DAY_SESSION_MISSING');
  const qualityStatus = ordered.count && coverageState === 'COMPLETE' && contractConsistencyState === 'MATCH'
    && sequenceGapEventCount === 0 && timeLineageViolationCount === 0 ? 'PASS'
    : ordered.count ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE';
  const status = contractMismatch ? 'UNAVAILABLE'
    : !ordered.count ? 'UNAVAILABLE'
      : windowState === 'FORMING' ? 'FORMING'
        : qualityStatus === 'PASS' ? 'READY' : 'QUALITY_INSUFFICIENT';
  const bar = ordered.count && !contractMismatch ? Object.freeze({
    time: new Date(zoned(tradeDate, '00:00:00')).toISOString(),
    tradeDate,
    sessionTradeDate: tradeDate,
    session: 'NIGHT_PLUS_DAY',
    sessionId: `${tradeDate}-TRADE_DATE`,
    sessionStart: nightTicks.first?.sessionStart || dayTicks.first?.sessionStart || null,
    sessionEnd: new Date(dayCloseMs).toISOString(),
    actualContract: selectedContract,
    contractMonth: ordered.first?.contractMonth || null,
    open: ordered.first.price,
    high: ordered.high,
    low: ordered.low,
    close: ordered.last.price,
    volume: ordered.volume,
    firstEventTime: ordered.first.exchangeTimestamp,
    lastEventTime: ordered.last.exchangeTimestamp,
    availableAt: ordered.availableAt,
    qualityStatus,
    qualityReasons: Object.freeze([...reasons]),
    eventCount: ordered.count,
    sequenceGapCount: sequenceGapSize,
    windowState,
    coverageState,
  }) : null;
  return Object.freeze({
    status,
    reason: contractMismatch ? 'ACTUAL_CONTRACT_MISMATCH'
      : !ordered.count ? 'TX_TICK_SOURCE_UNAVAILABLE'
        : reasons[0] || null,
    bars: Object.freeze(bar ? [bar] : []),
    ticks: Object.freeze(ordered),
    nightTicks: Object.freeze(nightTicks),
    dayTicks: Object.freeze(dayTicks),
    selectedContract,
    availableContracts: Object.freeze(allContracts),
    contractConsistencyState,
    coverageState,
    windowState,
    sessionCoverage: Object.freeze({ night: nightCoverage, day: dayCoverage }),
    qualityStatus,
    qualityReasons: Object.freeze(reasons),
    sequenceGapEventCount,
    sequenceGapSize,
    timeLineageViolationCount,
  });
}


/**
 * One-pass chart reduction over real records in stable compareTxChartTicks order.
 * The durable source must sort normalized legal ticks (including availability and
 * fallback event-ID semantics) before yielding. This preserves the array API's
 * floating-point addition order; out-of-order input fails explicitly. Duplicate,
 * invalid and future rows retain the original normalizer/cutoff semantics.
 * Resident data is O(minutes + sessions + contracts), independent of tick count.
 * The iterable is consumed once and is never materialized into a tick array.
 */
export function buildTxDecisionChartStreaming(records, options = {}) {
  const ticks = { *[Symbol.iterator]() {
    for (const record of records || []) yield normalizeTick(record, options.calendar);
  } };
  return buildTxDecisionChartFromOrderedTicks(ticks, options);
}

/**
 * Internal derived-cache entry point. Accepts complete normalized ticks produced
 * by the original chart normalizer, after cache identity/integrity verification.
 * This is not a raw endpoint-input API. Persist invalidReason records as well as
 * legal ticks so scoped lineage counts survive cache reload. The caller must not
 * prefilter future ticks: this shared reducer owns cutoff and futureExcluded.
 */
export function buildTxDecisionChartFromOrderedTicks(ticks, {
  calendar,
  timeframe = '5m',
  asOf = new Date().toISOString(),
  tradeDate = null,
  session = null,
  actualContract = null,
  priorDay = null,
  mode = 'LIVE',
} = {}) {
  const base = buildStreamingChartBase(ticks, { calendar, asOf, tradeDate, session, timeframe });
  const asOfMs = timestampMs(asOf);
  if (timeframe === '1D') {
    const daily = buildStreamingDailyTradeDateBar(base, { tradeDate, asOf, actualContract });
    const selectedTicks = daily.ticks;
    const dayTicks = daily.dayTicks;
    const nightTicks = daily.nightTicks;
    const vwapSession = dayTicks.count ? 'DAY' : nightTicks.count ? 'NIGHT' : 'UNAVAILABLE';
    const vwapTicks = vwapSession === 'DAY' ? dayTicks : vwapSession === 'NIGHT' ? nightTicks : emptyTickSummary();
    const vwapBars = base.internalBars.filter((bar) => bar.sessionTradeDate === tradeDate
      && bar.session === vwapSession
      && bar.actualContract === daily.selectedContract);
    const vwap1m = cumulativeSessionVwap(vwapBars);
    const latestVwap = vwap1m.at(-1)?.value ?? null;
    const dailyBar = daily.bars[0];
    const vwap = latestVwap != null && dailyBar ? Object.freeze([Object.freeze({
      time: dailyBar.time,
      value: latestVwap,
      availableAt: vwap1m.at(-1).availableAt,
      vwapSession,
    })]) : Object.freeze([]);
    const or = dayTicks.count
      ? summaryOpeningRange(dayTicks, asOfMs)
      : Object.freeze({ status: 'NOT_APPLICABLE', high: null, low: null, reason: 'DAY_OPENING_RANGE_NOT_AVAILABLE' });
    const sessionHigh = (ticks) => ticks.high;
    const sessionLow = (ticks) => ticks.low;
    const unavailablePrior = (name) => Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason: 'PRIOR_DAY_SOURCE_UNAVAILABLE' });
    const levels = Object.freeze({
      currentDayHigh: summaryLevel('CURRENT_DAY_HIGH', sessionHigh(dayTicks), dayTicks, 'ACTUAL_TX_TICK_STREAM'),
      currentDayLow: summaryLevel('CURRENT_DAY_LOW', sessionLow(dayTicks), dayTicks, 'ACTUAL_TX_TICK_STREAM'),
      nightHigh: summaryLevel('NIGHT_HIGH', sessionHigh(nightTicks), nightTicks, 'ACTUAL_TX_TICK_STREAM'),
      nightLow: summaryLevel('NIGHT_LOW', sessionLow(nightTicks), nightTicks, 'ACTUAL_TX_TICK_STREAM'),
      previousDayHigh: unavailablePrior('PREVIOUS_DAY_HIGH'),
      previousDayLow: unavailablePrior('PREVIOUS_DAY_LOW'),
      previousClose: unavailablePrior('PREVIOUS_CLOSE'),
      openingRangeHigh: or.high == null ? Object.freeze({ name: 'OR_HIGH', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_HIGH', availability: 'AVAILABLE', value: or.high }),
      openingRangeLow: or.low == null ? Object.freeze({ name: 'OR_LOW', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_LOW', availability: 'AVAILABLE', value: or.low }),
      vwap: latestVwap == null ? Object.freeze({ name: 'VWAP', availability: 'UNAVAILABLE', value: null, reason: 'TX_TICK_VOLUME_UNAVAILABLE', vwapSession })
        : Object.freeze({ ...summaryLevel('VWAP', latestVwap, vwapTicks, 'SESSION_EXACT_TX_TICK_VWAP'), vwapSession }),
    });
    return Object.freeze({
      schemaVersion: 'governed-tx-decision-chart-v2',
      barContract: CHART_BAR_CONTRACT,
      status: daily.status,
      reason: daily.reason,
      mode,
      timeframe,
      tradeDate,
      sessionTradeDate: tradeDate,
      session: 'NIGHT_PLUS_DAY',
      sessionId: tradeDate ? `${tradeDate}-TRADE_DATE` : null,
      actualContract: daily.selectedContract,
      contractMonth: selectedTicks.first?.contractMonth || null,
      availableContracts: daily.availableContracts,
      contractRollover: Object.freeze({
        detected: daily.contractConsistencyState === 'MISMATCH',
        policy: 'NIGHT_DAY_ACTUAL_CONTRACT_MUST_MATCH',
        excludedContracts: Object.freeze(daily.contractConsistencyState === 'MISMATCH' ? [...daily.availableContracts] : []),
      }),
      contractConsistencyState: daily.contractConsistencyState,
      windowState: daily.windowState,
      coverageState: daily.coverageState,
      sessionCoverage: daily.sessionCoverage,
      asOf: asOfMs == null ? null : new Date(asOfMs).toISOString(),
      bars: daily.bars,
      vwap,
      vwapSession,
      openingRange: or,
      levels,
      lastPrice: selectedTicks.last?.price ?? null,
      lastEventTime: selectedTicks.last?.exchangeTimestamp ?? null,
      availableAt: selectedTicks.availableAt || null,
      qualityStatus: daily.qualityStatus,
      qualityReasons: daily.qualityReasons,
      sequenceGapEventCount: daily.sequenceGapEventCount,
      sequenceGapSize: daily.sequenceGapSize,
      source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
      actualContractSelection: 'SHIOAJI_TXFR1_RESOLVED_TARGET_LATEST_LEGAL_TICK',
      sourceEventCount: selectedTicks.count,
      futureExcluded: base.futureExcluded,
      timeLineageViolationCount: daily.timeLineageViolationCount,
      futureDataViolations: base.futureDataViolations,
      barSemanticsOwnerDecisionRequired: false,
      eventMarkerSlots: Object.freeze(['MARKET_STATE_CHANGE', 'OR_BREAK', 'VWAP_RECLAIM_LOSS', 'BREADTH_CONFLICT', 'ESTIMATED_CVD_DIVERGENCE', 'DATA_STALE', 'GLOBAL_ALIGNMENT_CHANGE']),
      markers: Object.freeze([]),
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    });
  }
  const contractCandidates = summaryContracts(base.all);
  const sessionContractViolation = contractCandidates.length > 1;
  const selectedContract = actualContract || base.all.last?.actualContract || null;
  const selected = base.contracts.get(selectedContract)?.all;
  const sessionId = selected?.last?.sessionId || null;
  const selectedTicks = base.sessions.get(sessionId + '|' + selectedContract) || emptyTickSummary();
  const selectedOneMinute = base.internalBars.filter((bar) => bar.sessionId === sessionId && bar.actualContract === selectedContract);
  const timeframeResult = aggregateChartBars(selectedOneMinute, timeframe);
  const bars = timeframeResult.bars;
  const vwap1m = cumulativeSessionVwap(selectedOneMinute);
  const vwap = timeframeResult.status === 'READY' ? vwapForTimeframe(vwap1m, bars) : Object.freeze([]);
  const or = summaryOpeningRange(selectedTicks, asOfMs);
  const sessionHigh = selectedTicks.count ? selectedTicks.high : null;
  const sessionLow = selectedTicks.count ? selectedTicks.low : null;
  const latestVwap = vwap1m.at(-1)?.value ?? null;
  const priorCompatible = priorDay && priorDay.actualContract === selectedContract;
  const unavailablePrior = (name) => Object.freeze({ name, availability: 'UNAVAILABLE', value: null, reason: priorDay ? 'ACTUAL_CONTRACT_MISMATCH' : 'PRIOR_DAY_SOURCE_UNAVAILABLE' });
  const levels = Object.freeze({
    currentDayHigh: selectedTicks.first?.session === 'DAY' ? summaryLevel('CURRENT_DAY_HIGH', sessionHigh, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : summaryLevel('CURRENT_DAY_HIGH', null, emptyTickSummary(), 'ACTUAL_TX_TICK_STREAM'),
    currentDayLow: selectedTicks.first?.session === 'DAY' ? summaryLevel('CURRENT_DAY_LOW', sessionLow, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : summaryLevel('CURRENT_DAY_LOW', null, emptyTickSummary(), 'ACTUAL_TX_TICK_STREAM'),
    nightHigh: selectedTicks.first?.session === 'NIGHT' ? summaryLevel('NIGHT_HIGH', sessionHigh, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : summaryLevel('NIGHT_HIGH', null, emptyTickSummary(), 'ACTUAL_TX_TICK_STREAM'),
    nightLow: selectedTicks.first?.session === 'NIGHT' ? summaryLevel('NIGHT_LOW', sessionLow, selectedTicks, 'ACTUAL_TX_TICK_STREAM') : summaryLevel('NIGHT_LOW', null, emptyTickSummary(), 'ACTUAL_TX_TICK_STREAM'),
    previousDayHigh: priorCompatible ? priorDay.high : unavailablePrior('PREVIOUS_DAY_HIGH'),
    previousDayLow: priorCompatible ? priorDay.low : unavailablePrior('PREVIOUS_DAY_LOW'),
    previousClose: priorCompatible ? priorDay.close : unavailablePrior('PREVIOUS_CLOSE'),
    openingRangeHigh: or.high == null ? Object.freeze({ name: 'OR_HIGH', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_HIGH', availability: 'AVAILABLE', value: or.high }),
    openingRangeLow: or.low == null ? Object.freeze({ name: 'OR_LOW', availability: 'UNAVAILABLE', value: null, reason: or.reason }) : Object.freeze({ ...or, name: 'OR_LOW', availability: 'AVAILABLE', value: or.low }),
    vwap: latestVwap == null ? Object.freeze({ name: 'VWAP', availability: 'UNAVAILABLE', value: null, reason: 'TX_TICK_VOLUME_UNAVAILABLE', vwapSession: selectedTicks.first?.session || session || 'UNAVAILABLE' })
      : Object.freeze({ ...summaryLevel('VWAP', latestVwap, selectedTicks, 'SESSION_EXACT_TX_TICK_VWAP'), vwapSession: selectedTicks.first?.session || session || 'UNAVAILABLE' }),
  });
  const scopedTimeLineageViolationCount = base.timeLineageViolationCount;
  const sequenceGapEventCount = selectedTicks.sequenceGapEventCount;
  const sequenceGapSize = selectedTicks.sequenceGapSize;
  const intradayQualityReasons = [];
  if (sessionContractViolation) intradayQualityReasons.push('SESSION_CONTRACT_CHANGE_DETECTED');
  if (sequenceGapEventCount > 0) intradayQualityReasons.push('SEQUENCE_CONTINUITY_INSUFFICIENT');
  if (scopedTimeLineageViolationCount > 0) intradayQualityReasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  const qualityStatus = !selectedTicks.count ? 'UNAVAILABLE'
    : sessionContractViolation || scopedTimeLineageViolationCount > 0 || sequenceGapEventCount > 0 ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({
    schemaVersion: 'governed-tx-decision-chart-v2',
    barContract: CHART_BAR_CONTRACT,
    status: timeframeResult.status === 'OWNER_DECISION_REQUIRED' ? 'OWNER_DECISION_REQUIRED'
      : !selectedTicks.count ? 'UNAVAILABLE'
        : sessionContractViolation ? 'QUALITY_INSUFFICIENT' : 'READY',
    reason: timeframeResult.reason || (!selectedTicks.count ? 'TX_TICK_SOURCE_UNAVAILABLE'
      : sessionContractViolation ? 'SESSION_CONTRACT_CHANGE_DETECTED' : null),
    mode,
    timeframe,
    tradeDate: selectedTicks.first?.tradeDate || tradeDate,
    sessionTradeDate: selectedTicks.first?.sessionTradeDate || tradeDate,
    session: selectedTicks.first?.session || session,
    sessionId,
    actualContract: selectedContract,
    contractMonth: selectedTicks.first?.contractMonth || null,
    availableContracts: Object.freeze(contractCandidates),
    contractRollover: Object.freeze({
      detected: contractCandidates.length > 1,
      policy: 'CONTRACTS_ISOLATED_NEVER_MIXED',
      excludedContracts: Object.freeze(contractCandidates.filter((code) => code !== selectedContract)),
    }),
    asOf: asOfMs == null ? null : new Date(asOfMs).toISOString(),
    bars,
    vwap,
    vwapSession: selectedTicks.first?.session || session || 'UNAVAILABLE',
    openingRange: or,
    levels,
    lastPrice: selectedTicks.last?.price ?? null,
    lastEventTime: selectedTicks.last?.exchangeTimestamp ?? null,
    availableAt: selectedTicks.availableAt || null,
    qualityStatus,
    qualityReasons: Object.freeze(intradayQualityReasons),
    sequenceGapEventCount,
    sequenceGapSize,
    contractConsistencyState: sessionContractViolation ? 'MISMATCH' : selectedTicks.count ? 'MATCH' : 'UNAVAILABLE',
    source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
    actualContractSelection: 'SHIOAJI_TXFR1_RESOLVED_TARGET_LATEST_LEGAL_TICK',
    sourceEventCount: selectedTicks.count,
    futureExcluded: base.futureExcluded,
    timeLineageViolationCount: scopedTimeLineageViolationCount,
    futureDataViolations: base.futureDataViolations,
    barSemanticsOwnerDecisionRequired: false,
    eventMarkerSlots: Object.freeze(['MARKET_STATE_CHANGE', 'OR_BREAK', 'VWAP_RECLAIM_LOSS', 'BREADTH_CONFLICT', 'ESTIMATED_CVD_DIVERGENCE', 'DATA_STALE', 'GLOBAL_ALIGNMENT_CHANGE']),
    markers: Object.freeze([]),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

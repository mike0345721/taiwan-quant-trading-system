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
  schemaVersion: 'chart-bar-contract-v1',
  source: 'actual TX contract executed Tick',
  baseTimeframe: '1m',
  supportedTimeframes: Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h']),
  ownerDecisionRequiredTimeframes: Object.freeze(['1D']),
  dailySemanticsQuestion: 'DAY_ONLY vs NIGHT_PLUS_DAY_TRADE_DATE',
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

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
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
  if (availableMs < exchangeMs) {
    return remember(Object.freeze({ invalidReason: 'AVAILABLE_AT_BEFORE_EXCHANGE_TIMESTAMP' }));
  }
  const context = classifyTxChartSession(exchangeTimestamp, calendar);
  if (exchangeMs < Date.parse(context.sessionStart) || exchangeMs > Date.parse(context.sessionEnd)) return null;
  return remember(Object.freeze({
    eventId: record.eventId || digest([actualContract, exchangeTimestamp, availableAt, price, volume]),
    exchangeTimestamp: new Date(exchangeMs).toISOString(),
    exchangeMs,
    availableAt: new Date(availableMs).toISOString(),
    availableMs,
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

export function buildOneMinuteBars(records, { calendar, asOf = null } = {}) {
  if (!calendar) throw new Error('TX_CHART_GOVERNED_CALENDAR_REQUIRED');
  const asOfMs = asOf == null ? Infinity : timestampMs(asOf);
  if (asOfMs == null) throw new Error('TX_CHART_AS_OF_INVALID');
  const ticks = [];
  let futureExcluded = 0;
  let timeLineageViolationCount = 0;
  for (const record of records || []) {
    const tick = normalizeTick(record, calendar);
    if (!tick) continue;
    if (tick.invalidReason) { timeLineageViolationCount += 1; continue; }
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
    futureDataViolations: 0,
  });
}

export function aggregateChartBars(oneMinuteBars, timeframe) {
  if (timeframe === '1D') {
    return Object.freeze({ status: 'OWNER_DECISION_REQUIRED', bars: Object.freeze([]), reason: 'BAR_SEMANTICS_OWNER_DECISION_REQUIRED' });
  }
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
  const lastInputAvailableMs = Math.max(...openingTicks.map((tick) => tick.availableMs));
  return Object.freeze({
    status: qualityStatus === 'PASS' ? 'READY' : 'QUALITY_INSUFFICIENT',
    high: Math.max(...openingTicks.map((tick) => tick.price)),
    low: Math.min(...openingTicks.map((tick) => tick.price)),
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
  const asOfMs = timestampMs(asOf);
  const or = openingRange(selectedTicks, asOfMs);
  const sessionHigh = selectedTicks.length ? Math.max(...selectedTicks.map((tick) => tick.price)) : null;
  const sessionLow = selectedTicks.length ? Math.min(...selectedTicks.map((tick) => tick.price)) : null;
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
    vwap: latestVwap == null ? Object.freeze({ name: 'VWAP', availability: 'UNAVAILABLE', value: null, reason: 'TX_TICK_VOLUME_UNAVAILABLE' }) : level('VWAP', latestVwap, selectedTicks, 'SESSION_EXACT_TX_TICK_VWAP'),
  });
  const qualityStatus = !selectedTicks.length ? 'UNAVAILABLE'
    : sessionContractViolation || base.timeLineageViolationCount > 0 || selectedTicks.some((tick) => tick.sequenceGap > 0) ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({
    schemaVersion: 'governed-tx-decision-chart-v1',
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
    openingRange: or,
    levels,
    lastPrice: selectedTicks.at(-1)?.price ?? null,
    lastEventTime: selectedTicks.at(-1)?.exchangeTimestamp ?? null,
    availableAt: selectedTicks.map((tick) => tick.availableAt).sort().at(-1) || null,
    qualityStatus,
    source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
    actualContractSelection: 'SHIOAJI_TXFR1_RESOLVED_TARGET_LATEST_LEGAL_TICK',
    sourceEventCount: selectedTicks.length,
    futureExcluded: base.futureExcluded,
    timeLineageViolationCount: base.timeLineageViolationCount,
    futureDataViolations: base.futureDataViolations,
    barSemanticsOwnerDecisionRequired: true,
    eventMarkerSlots: Object.freeze(['MARKET_STATE_CHANGE', 'OR_BREAK', 'VWAP_RECLAIM_LOSS', 'BREADTH_CONFLICT', 'ESTIMATED_CVD_DIVERGENCE', 'DATA_STALE', 'GLOBAL_ALIGNMENT_CHANGE']),
    markers: Object.freeze([]),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
}

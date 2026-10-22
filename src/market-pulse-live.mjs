import fs from 'node:fs';
import path from 'node:path';
import { listReplayDays } from './intraday-replay-catalog.mjs';

const FIVE_MINUTES_MS = 5 * 60_000;
const MIN_RVOL_SAMPLE_DAYS = 20;
const LIVE_SOURCE_FRESHNESS_MS = 120_000;
const CASH_DAY_START_MINUTE = 9 * 60;
const CASH_DAY_END_MINUTE = 13 * 60 + 30;

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function percentile(values, current) {
  const sample = values.map(Number).filter(Number.isFinite);
  if (!sample.length || !Number.isFinite(current)) return null;
  return sample.filter((value) => value <= current).length / sample.length * 100;
}

function taipeiMinute(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  return Number(parts.hour) * 60 + Number(parts.minute);
}

function liveTimestampState(value, now) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return 'INVALID';
  const ageMs = now.getTime() - timestamp;
  if (ageMs < -5_000) return 'FUTURE';
  if (ageMs > LIVE_SOURCE_FRESHNESS_MS) return 'STALE';
  return 'LIVE';
}

function completedFiveMinuteBars(chart, asOf) {
  if (chart?.timeframe !== '5m' || !Array.isArray(chart?.bars)) return [];
  const asOfMs = Date.parse(asOf || chart.asOf || chart.availableAt || new Date().toISOString());
  if (!Number.isFinite(asOfMs)) return [];
  return chart.bars.filter((bar) => {
    const start = Date.parse(bar?.time);
    return Number.isFinite(start) && start + FIVE_MINUTES_MS <= asOfMs;
  });
}

function historicalRvolRows(archiveDir, chart, slot, currentBar) {
  const catalog = listReplayDays(archiveDir)
    .filter((item) => item.auditPassed && item.tradeDate < chart.tradeDate)
    .slice(-MIN_RVOL_SAMPLE_DAYS);
  const session = String(chart.session || '').toLowerCase();
  const values = [];
  const dates = [];
  for (const item of catalog) {
    const payload = readJson(path.join(archiveDir, `${item.tradeDate}-${session}.json`));
    if (!payload || payload.product !== 'TX' || payload.session !== session) continue;
    const bars = Array.isArray(payload.bars) ? payload.bars : [];
    const index = bars.findIndex((bar) => String(bar?.timestamp || '').slice(11, 16) === slot);
    const volume = index >= 0 ? finite(bars[index]?.volume) : null;
    if (volume == null) continue;
    values.push(volume);
    dates.push(item.tradeDate);
  }
  return { values, dates, currentBar };
}

// A live completed-slot comparison must never borrow an old full bar after reconnect.
function contiguousCompletedBars(bars) {
  return bars.every((bar, index) => {
    const ms = Date.parse(bar?.time || '');
    if (!Number.isFinite(ms)) return false;
    return index === 0 || ms - Date.parse(bars[index - 1]?.time || '') === FIVE_MINUTES_MS;
  });
}

export function buildLiveRvol({ chart, archiveDir, now = new Date() } = {}) {
  let currentBar = null;
  const sourceEvidence = () => ({
    sourceAvailableAt: chart?.availableAt || chart?.bars?.at(-1)?.availableAt || null,
    sourceQualityStatus: chart?.qualityStatus || 'UNKNOWN',
    sourceQualityReasons: chart?.qualityReasons || [],
    completedBarTime: currentBar?.time || null,
    completedBarAvailableAt: currentBar?.availableAt || null,
    completedBarQualityStatus: currentBar?.qualityStatus || 'UNKNOWN',
  });
  const unavailable = (reason, extra = {}) => Object.freeze({
    state: 'UNAVAILABLE', reason, ratio: null, percentile: null, sampleDays: 0,
    baselineMedian: null, currentVolume: null, cumulativeRatio: null, ...sourceEvidence(), ...extra,
  });
  if (!chart || chart.timeframe !== '5m') return unavailable('RVOL_REQUIRES_5M_CHART');
  if (!archiveDir || !fs.existsSync(archiveDir)) return unavailable('RVOL_ARCHIVE_MISSING');
  const liveAvailableAt = chart.availableAt || chart.bars?.at(-1)?.availableAt || null;
  if (!liveAvailableAt) return unavailable('RVOL_SOURCE_AVAILABILITY_MISSING');
  const freshness = liveTimestampState(liveAvailableAt, now);
  if (freshness !== 'LIVE') return unavailable(freshness === 'STALE' ? 'RVOL_SOURCE_STALE' : 'RVOL_SOURCE_TIME_INVALID');
  const completed = completedFiveMinuteBars(chart, now.toISOString());
  currentBar = completed.at(-1);
  if (!currentBar) return unavailable('NO_COMPLETED_5M_BAR');

  // Source freshness by itself does not prove the selected completed bar is current.
  const expectedStartMs = Math.floor(now.getTime() / FIVE_MINUTES_MS) * FIVE_MINUTES_MS - FIVE_MINUTES_MS;
  const selectedStartMs = Date.parse(currentBar.time || '');
  if (!Number.isFinite(selectedStartMs) || selectedStartMs !== expectedStartMs) {
    return unavailable('RVOL_COMPLETED_SLOT_NOT_CURRENT', {
      completedBarTime: currentBar.time || null,
      completedBarAvailableAt: currentBar.availableAt || null,
      expectedCompletedBarTime: new Date(expectedStartMs).toISOString(),
    });
  }
  const selectedAvailableAtMs = Date.parse(currentBar.availableAt || '');
  if (!Number.isFinite(selectedAvailableAtMs)) {
    return unavailable('RVOL_COMPLETED_BAR_AVAILABILITY_MISSING', { completedBarTime: currentBar.time });
  }
  if (selectedAvailableAtMs < selectedStartMs - 5_000 || selectedAvailableAtMs > now.getTime() + 5_000) {
    return unavailable('RVOL_COMPLETED_BAR_TIME_INVALID', { completedBarTime: currentBar.time });
  }
  if (!contiguousCompletedBars(completed)) {
    return unavailable('RVOL_COMPLETED_SERIES_GAP', { completedBarTime: currentBar.time });
  }
  if (chart.qualityStatus !== 'PASS' || (chart.qualityReasons?.length || 0) > 0
      || chart.sequenceGapEventCount > 0 || chart.timeLineageViolationCount > 0) {
    return unavailable('RVOL_SOURCE_QUALITY_INSUFFICIENT');
  }
  if (currentBar.qualityStatus !== 'PASS' || currentBar.sequenceGapCount > 0) {
    return unavailable('RVOL_COMPLETED_BAR_QUALITY_INSUFFICIENT');
  }

  const slot = String(currentBar.time || '').slice(11, 16);
  if (!/^\d{2}:\d{2}$/.test(slot)) return unavailable('RVOL_SLOT_INVALID');
  const history = historicalRvolRows(archiveDir, chart, slot, currentBar);
  const baselineMedian = median(history.values);
  const currentVolume = finite(currentBar.volume);
  if (currentVolume == null || currentVolume < 0) return unavailable('CURRENT_BAR_VOLUME_UNAVAILABLE', {
    sampleDays: history.values.length,
  });
  if (history.values.length < MIN_RVOL_SAMPLE_DAYS || baselineMedian == null || baselineMedian <= 0) {
    return Object.freeze({
      ...sourceEvidence(),
      state: 'BASELINE_NOT_READY',
      reason: 'RVOL_BASELINE_NOT_READY',
      ratio: null,
      percentile: null,
      sampleDays: history.values.length,
      baselineMedian,
      currentVolume,
      completedBarTime: currentBar.time,
      completedBarAvailableAt: currentBar.availableAt || null,
      baselineStartDate: history.dates.at(0) || null,
      baselineEndDate: history.dates.at(-1) || null,
      timeframe: '5m',
      session: chart.session || null,
    });
  }
  // Bucket times and first observed ticks do not certify collection from session open.
  // The current source contract has no full-session capture proof. Keep cumulative
  // values unknown, including when a rounded first bucket equals the opening time.
  return Object.freeze({
    ...sourceEvidence(),
    state: 'READY',
    reason: null,
    ratio: currentVolume / baselineMedian,
    percentile: percentile(history.values, currentVolume),
    sampleDays: history.values.length,
    baselineMedian,
    currentVolume,
    completedBarTime: currentBar.time,
    completedBarAvailableAt: currentBar.availableAt || null,
    cumulativeVolume: null,
    cumulativeBaselineMedian: null,
    cumulativeRatio: null,
    cumulativeCoverage: 'SESSION_PREFIX_UNVERIFIED',
    cumulativeReason: 'RVOL_SESSION_CAPTURE_COVERAGE_UNVERIFIED',
    baselineStartDate: history.dates.at(0) || null,
    baselineEndDate: history.dates.at(-1) || null,
    timeframe: '5m',
    session: chart.session || null,
    baselineMethod: 'MEDIAN_SAME_SESSION_SAME_5M_SLOT_PRIOR_20_AUDITED_DAYS',
  });
}

function safeLatestRecord(bridgeLatest, key) {
  const record = bridgeLatest?.data?.[key] || bridgeLatest?.[key] || null;
  if (!record || record.executionAuthorized !== false || record.orderRoutesEnabled !== false) return null;
  return record;
}

function safeOfficialCashClose(reference, expectedCashDate, now) {
  if (!reference || reference.kind !== 'TWSE_OFFICIAL_TAIEX_CASH_CLOSE'
      || reference.indexName !== '發行量加權股價指數'
      || reference.source !== 'TWSE_OPENAPI_MI_INDEX'
      || reference.executionAuthorized !== false || reference.orderRoutesEnabled !== false
      || reference.date !== expectedCashDate) return null;
  const close = finite(reference.close);
  const timestamp = Date.parse(reference.receivedAt || '');
  const cashCloseMs = Date.parse(expectedCashDate + 'T05:30:00.000Z');
  if (close == null || close <= 0 || !Number.isFinite(timestamp) || !Number.isFinite(cashCloseMs)
      || timestamp < cashCloseMs || timestamp > now.getTime() + 5_000) return null;
  return reference;
}

function nightCashDate(chart) {
  const sessionId = chart?.bars?.[0]?.sessionId || null;
  return /^\d{4}-\d{2}-\d{2}-NIGHT$/.test(String(sessionId)) ? sessionId.slice(0, 10) : null;
}
export function buildLiveBasis({ chart, bridgeLatest, cashCloseReference = null, now = new Date() } = {}) {
  const unavailable = (reason) => Object.freeze({
    state: 'UNAVAILABLE', reason, label: '基差', points: null, pct: null,
    futuresPrice: null, spotPrice: null, futuresAvailableAt: null, spotAvailableAt: null,
  });
  const futuresPrice = finite(chart?.lastPrice);
  const futuresAvailableAt = chart?.availableAt || chart?.bars?.at(-1)?.availableAt || null;
  const ix = safeLatestRecord(bridgeLatest, 'IX0001');
  const expectedNightCashDate = chart?.session === 'NIGHT' ? nightCashDate(chart) : null;
  const official = expectedNightCashDate
    ? safeOfficialCashClose(cashCloseReference, expectedNightCashDate, now) : null;
  const spotPrice = finite(official ? official.close : ix?.payload?.close);
  const spotAvailableAt = official?.receivedAt || ix?.receivedAt || ix?.payload?._received_at || null;
  const spotTradeDate = official?.date || ix?.payload?.date || null;
  const spotClockSkewMs = official ? null : finite(ix?.clockSkewMs);
  if (futuresPrice == null || !futuresAvailableAt) return unavailable('FUTURES_PRICE_UNAVAILABLE');
  if (spotPrice == null || !spotAvailableAt || !spotTradeDate) return unavailable('IX0001_REFERENCE_UNAVAILABLE');
  const futuresMs = Date.parse(futuresAvailableAt);
  const spotMs = Date.parse(spotAvailableAt);
  const nowMs = now.getTime();
  if (![futuresMs, spotMs].every(Number.isFinite)) return unavailable('BASIS_TIMESTAMP_INVALID');
  const futuresFreshness = liveTimestampState(futuresAvailableAt, now);
  if (futuresFreshness !== 'LIVE') return unavailable(futuresFreshness === 'STALE' ? 'FUTURES_SOURCE_STALE' : 'FUTURES_SOURCE_TIME_INVALID');
  const points = futuresPrice - spotPrice;
  const base = {
    reason: null, points, pct: spotPrice ? points / spotPrice * 100 : null,
    futuresPrice, spotPrice, futuresAvailableAt, spotAvailableAt, spotTradeDate,
    sourceSkewMs: Math.abs(futuresMs - spotMs),
    actualContract: chart?.actualContract || null,
    chartTradeDate: chart?.tradeDate || null,
    session: chart?.session || null,
    spotClockSkewMs,
    sourceReference: official ? 'TWSE_OFFICIAL_CASH_CLOSE' : 'SHIOAJI_IX0001',
    sourcePublisherTimestamp: official?.publisherTimestamp || null,
  };
  if (chart?.session === 'DAY') {
    const minute = taipeiMinute(now);
    if (minute < CASH_DAY_START_MINUTE || minute > CASH_DAY_END_MINUTE) return unavailable('CASH_SESSION_CLOSED');
    if (spotTradeDate !== chart.tradeDate) return unavailable('BASIS_TRADE_DATE_MISMATCH');
    if (nowMs - spotMs > LIVE_SOURCE_FRESHNESS_MS) return unavailable('BASIS_SOURCE_STALE');
    if (spotClockSkewMs == null || Math.abs(spotClockSkewMs) > LIVE_SOURCE_FRESHNESS_MS) {
      return unavailable('BASIS_SPOT_TIMESTAMP_LINEAGE_INSUFFICIENT');
    }
    if (Math.abs(futuresMs - spotMs) > LIVE_SOURCE_FRESHNESS_MS) return unavailable('BASIS_SOURCE_TIME_SKEW');
    return Object.freeze({ ...base, state: 'LIVE', label: '盤中基差', referenceMode: 'LIVE_IX0001' });
  }
  if (chart?.session === 'NIGHT') {
    const expectedCashDate = nightCashDate(chart);
    if (!expectedCashDate || spotTradeDate !== expectedCashDate) return unavailable('NIGHT_CASH_REFERENCE_DATE_MISMATCH');
    return Object.freeze({
      ...base,
      state: 'SESSION_CLOSED_REFERENCE',
      label: '夜盤對現貨收盤差',
      referenceMode: official ? 'TWSE_OFFICIAL_LAST_CASH_CLOSE' : 'LAST_CASH_CLOSE',
    });
  }
  return unavailable('BASIS_SESSION_UNAVAILABLE');
}

export function buildMarketPulseLive({ chart, bridgeLatest, cashCloseReference, archiveDir, now = new Date() } = {}) {
  const rvol = buildLiveRvol({ chart, archiveDir, now });
  const basis = buildLiveBasis({ chart, bridgeLatest, cashCloseReference, now });
  return Object.freeze({
    schemaVersion: 'market-pulse-live-v1',
    generatedAt: now.toISOString(),
    identity: Object.freeze({ actualContract: chart?.actualContract || null, tradeDate: chart?.tradeDate || null, session: chart?.session || null }),
    sourceAvailableAt: chart?.availableAt || chart?.bars?.at(-1)?.availableAt || null,
    rvol,
    basis,
    recommendation: false,
    systemDirectionalSignal: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { loadReplayFrame } from './intraday-confirmation.mjs';

const DAY_FILE = /^(\d{4}-\d{2}-\d{2})-day\.json$/;

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function median(values) {
  const sorted = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summarize(payload) {
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  if (!bars.length) return null;
  const values = bars.flatMap((bar) => [bar.open, bar.high, bar.low, bar.close]).map(Number).filter(Number.isFinite);
  if (!values.length) return null;
  return {
    contract: payload.contract || null,
    bars: bars.length,
    firstTimestamp: bars[0]?.timestamp || null,
    lastTimestamp: bars.at(-1)?.timestamp || null,
    open: finite(bars[0]?.open) ? Number(bars[0].open) : null,
    high: Math.max(...bars.map((bar) => Number(bar.high)).filter(Number.isFinite)),
    low: Math.min(...bars.map((bar) => Number(bar.low)).filter(Number.isFinite)),
    close: finite(bars.at(-1)?.close) ? Number(bars.at(-1).close) : null,
    volume: bars.reduce((sum, bar) => sum + (finite(bar.volume) ? Number(bar.volume) : 0), 0),
  };
}

function auditPassed(state) {
  return typeof state === 'string' && state.startsWith('passed');
}

export function listReplayDays(archiveDir) {
  if (!fs.existsSync(archiveDir)) return [];
  const dates = fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && DAY_FILE.test(entry.name))
    .map((entry) => entry.name.match(DAY_FILE)[1])
    .sort();

  return dates.map((tradeDate) => {
    const day = readJson(path.join(archiveDir, `${tradeDate}-day.json`));
    const night = readJson(path.join(archiveDir, `${tradeDate}-night.json`));
    const audit = readJson(path.join(archiveDir, `${tradeDate}-audit.json`));
    const daySummary = summarize(day);
    const nightSummary = summarize(night);
    const contractMatches = Boolean(daySummary?.contract && nightSummary?.contract && daySummary.contract === nightSummary.contract);
    const expectedBars = 60;
    return {
      tradeDate,
      contract: daySummary?.contract || null,
      bars: daySummary?.bars || 0,
      firstTimestamp: daySummary?.firstTimestamp || null,
      lastTimestamp: daySummary?.lastTimestamp || null,
      auditState: audit?.state || 'not_audited',
      auditPassed: auditPassed(audit?.state),
      coveragePct: Math.min(100, Math.round((daySummary?.bars || 0) / expectedBars * 100)),
      nightAvailable: Boolean(nightSummary),
      nightContract: nightSummary?.contract || null,
      contractMatches,
    };
  });
}

function unavailable(state, reason, catalog, selectedTradeDate = null) {
  return {
    available: false, ready: false, state, reasons: [reason], cursor: 0, totalBars: 0, bars: [],
    selectedTradeDate, replayDates: catalog, executionAuthorized: false,
  };
}

export function loadCatalogReplay(archiveDir, fallbackPath, { tradeDate = null, cursor = Number.MAX_SAFE_INTEGER } = {}) {
  const catalog = listReplayDays(archiveDir);
  const verified = catalog.filter((item) => item.auditPassed);
  const defaultTradeDate = verified.at(-1)?.tradeDate || catalog.at(-1)?.tradeDate || null;
  const requestedTradeDate = tradeDate || defaultTradeDate;
  if (requestedTradeDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedTradeDate)) {
    return unavailable('replay_date_invalid', '回放日期格式不正確', catalog, requestedTradeDate);
  }

  let filePath = fallbackPath;
  if (requestedTradeDate) {
    const selected = catalog.find((item) => item.tradeDate === requestedTradeDate);
    if (!selected) return unavailable('replay_date_not_found', '找不到所選交易日的完整回放資料', catalog, requestedTradeDate);
    filePath = path.join(archiveDir, `${requestedTradeDate}-day.json`);
  }

  const frame = loadReplayFrame(filePath, cursor);
  if (!frame.totalBars) return { ...frame, selectedTradeDate: requestedTradeDate, defaultTradeDate, replayDates: catalog };
  const selectedIndex = catalog.findIndex((item) => item.tradeDate === requestedTradeDate);
  const previousDate = selectedIndex > 0 ? catalog[selectedIndex - 1].tradeDate : null;
  const previousPayload = previousDate ? readJson(path.join(archiveDir, `${previousDate}-day.json`)) : null;
  const nightPayload = requestedTradeDate ? readJson(path.join(archiveDir, `${requestedTradeDate}-night.json`)) : null;
  const currentPayload = requestedTradeDate ? readJson(path.join(archiveDir, `${requestedTradeDate}-day.json`)) : readJson(filePath);
  const previousDay = summarize(previousPayload);
  const night = summarize(nightPayload);
  const current = summarize(currentPayload);

  const priorDates = catalog.slice(Math.max(0, selectedIndex - 20), Math.max(0, selectedIndex));
  const priorPayloads = priorDates.map((item) => readJson(path.join(archiveDir, `${item.tradeDate}-day.json`))).filter(Boolean);
  const relativeVolumeSeries = frame.bars.map((visibleBar) => {
    const utcTime = visibleBar?.timestamp?.slice(11, 16) || null;
    const comparableVolumes = priorPayloads.map((payload) => {
      const bar = payload?.bars?.find((candidate) => candidate.timestamp?.slice(11, 16) === utcTime);
      return finite(bar?.volume) ? Number(bar.volume) : null;
    }).filter(Number.isFinite);
    const baseline = median(comparableVolumes);
    return {
      timestamp: visibleBar.timestamp,
      ratio: baseline && finite(visibleBar.volume) ? Number(visibleBar.volume) / baseline : null,
      sampleDays: comparableVolumes.length,
      baselineMedian: baseline,
    };
  });
  const lastRelativeVolume = relativeVolumeSeries.at(-1) || {};
  const selectedMeta = catalog.find((item) => item.tradeDate === requestedTradeDate) || null;

  return {
    ...frame,
    selectedTradeDate: requestedTradeDate,
    defaultTradeDate,
    replayDates: catalog,
    relativeVolumeSeries,
    context: {
      contract: current?.contract || frame.contract || null,
      previousTradeDate: previousDate,
      previousDayHigh: previousDay?.high ?? null,
      previousDayLow: previousDay?.low ?? null,
      previousDayClose: previousDay?.close ?? null,
      nightHigh: night?.high ?? null,
      nightLow: night?.low ?? null,
      nightClose: night?.close ?? null,
      nightContract: night?.contract ?? null,
      nightContractMatches: Boolean(current?.contract && night?.contract && current.contract === night.contract),
      relativeVolume20d: lastRelativeVolume.ratio ?? null,
      relativeVolumeSampleDays: lastRelativeVolume.sampleDays || 0,
      auditState: selectedMeta?.auditState || 'not_audited',
      auditPassed: Boolean(selectedMeta?.auditPassed),
      coveragePct: selectedMeta?.coveragePct ?? null,
    },
    executionAuthorized: false,
  };
}

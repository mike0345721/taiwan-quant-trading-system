import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import {
  calculateExactVwap,
  costViewsForTrade,
  firstBreakout,
  openingRange,
} from './t0-h0-runner.mjs';
import { evaluateEntryGapThroughStop, hashJson } from './t0-data-replay-gate.mjs';

const DAY_START = '084500';
const DAY_END_EXCLUSIVE = '134500';
const REQUIRED_BUCKETS = 28;

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function localDayIso(dateText, timeText) {
  const date = `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`;
  const hh = Number(timeText.slice(0, 2));
  const mm = Number(timeText.slice(2, 4));
  const ss = Number(timeText.slice(4, 6));
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (hh - 8) * 3_600_000 + mm * 60_000 + ss * 1_000).toISOString();
}

function bucket5m(timestamp) {
  return new Date(Math.floor(Date.parse(timestamp) / 300_000) * 300_000).toISOString();
}

export function resolveRawTickSource(root, tradeDate) {
  const fileName = `Daily_${tradeDate.replaceAll('-', '_')}.zip`;
  const sourceClass = tradeDate < '2026-07-01' ? 'PURCHASED_TAIFEX_DAILY_ZIP' : 'TAIFEX_DAILY_ZIP';
  const directory = tradeDate < '2026-07-01'
    ? path.join(root, 'data/intraday/paid-staging/202601-06-inner-zips')
    : path.join(root, 'data/intraday/raw');
  return { sourceClass, zipPath: path.join(directory, fileName), csvEntry: fileName.replace(/\.zip$/i, '.csv') };
}

export function buildTickBars(ticks) {
  const map = new Map();
  for (const tick of ticks) {
    const timestamp = bucket5m(tick.exchangeTimestamp);
    const bar = map.get(timestamp) || { timestamp, open: tick.price, high: tick.price, low: tick.price, close: tick.price, volume: 0, complete: true };
    bar.high = Math.max(bar.high, tick.price);
    bar.low = Math.min(bar.low, tick.price);
    bar.close = tick.price;
    bar.volume += tick.volume;
    map.set(timestamp, bar);
  }
  return [...map.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function requiredPathCoverage(tradeDate, bars) {
  const available = new Set(bars.map((bar) => bar.timestamp));
  const start = Date.parse(`${tradeDate}T00:45:00.000Z`);
  const required = Array.from({ length: REQUIRED_BUCKETS }, (_, index) => new Date(start + index * 300_000).toISOString());
  const missing = required.filter((timestamp) => !available.has(timestamp));
  return { state: missing.length === 0 ? 'PASS' : 'INCOMPLETE', requiredBucketCount: REQUIRED_BUCKETS, missingBucketCount: missing.length, missingBuckets: missing };
}

export async function readNaturalTicks({ root, tradeDate, contractCode }) {
  const source = resolveRawTickSource(root, tradeDate);
  if (!fs.existsSync(source.zipPath)) return { source, sourceState: 'MISSING', ticks: [], bars: [], statistics: { staleOrInvalidCount: 0, contractMismatchCount: 0 } };
  const child = spawn('tar', ['-xOf', source.zipPath, source.csvEntry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const ticks = [];
  let rowNumber = 0;
  let staleOrInvalidCount = 0;
  let otherContractEventCount = 0;
  let fileOrderOutOfOrderCount = 0;
  let priorSelectedTimestamp = null;
  const compactDate = tradeDate.replaceAll('-', '');
  for await (const line of lines) {
    rowNumber += 1;
    const columns = line.split(',');
    if (columns.length < 6) continue;
    const dateText = columns[0].trim();
    const product = columns[1].trim();
    const rowContract = columns[2].trim();
    const timeText = columns[3].trim();
    if (dateText !== compactDate || product !== 'TX') continue;
    if (!/^\d{6}$/.test(timeText) || timeText < DAY_START || timeText >= DAY_END_EXCLUSIVE) continue;
    if (rowContract !== contractCode) { otherContractEventCount += 1; continue; }
    const price = Number(columns[4].trim());
    const grossSides = Number(columns[5].trim());
    if (!Number.isFinite(price) || !Number.isFinite(grossSides) || grossSides < 0) { staleOrInvalidCount += 1; continue; }
    const exchangeTimestamp = localDayIso(dateText, timeText);
    if (priorSelectedTimestamp && exchangeTimestamp < priorSelectedTimestamp) fileOrderOutOfOrderCount += 1;
    priorSelectedTimestamp = exchangeTimestamp;
    ticks.push({ sourceRowNumber: rowNumber, tradeDate, sessionId: `${tradeDate}-DAY`, contractCode: rowContract, exchangeTimestamp, price, volume: grossSides / 2 });
  }
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  if (exitCode !== 0) throw new Error(`RAW_TICK_READ_FAILED:${tradeDate}:${stderr.trim()}`);
  ticks.sort((a, b) => a.exchangeTimestamp.localeCompare(b.exchangeTimestamp) || a.sourceRowNumber - b.sourceRowNumber);
  ticks.forEach((tick, index) => { tick.normalizedSequence = index + 1; });
  const bars = buildTickBars(ticks);
  return {
    source: { ...source, zipSha256: sha256File(source.zipPath) }, sourceState: 'AVAILABLE', ticks, bars,
    statistics: {
      staleOrInvalidCount,
      contractMismatchCount: 0,
      otherContractEventCount,
      fileOrderOutOfOrderCount,
      normalizedOutOfOrderCount: 0,
      duplicateCount: 0,
      duplicateDetectionState: 'UNAVAILABLE_NO_EXCHANGE_EVENT_ID',
      sourceExchangeSequenceAvailable: false,
      sequenceGapCount: 0,
      sequenceBasis: 'EXCHANGE_TIMESTAMP_THEN_SOURCE_ROW_NUMBER',
      sequenceGapInterpretation: 'NO_GAP_IN_DERIVED_CONTIGUOUS_SEQUENCE_NOT_EXCHANGE_PACKET_PROOF',
    },
  };
}

export function buildResolutionRecord({ manifestRow, tickRead, ohlcAudit }) {
  const coverage = requiredPathCoverage(manifestRow.tradeDate, tickRead.bars || []);
  const timestampPass = (tickRead.ticks || []).every((tick) => Number.isFinite(Date.parse(tick.exchangeTimestamp)));
  const contractPass = (tickRead.ticks || []).every((tick) => tick.contractCode === manifestRow.actualReplayContractCode);
  const tickPass = tickRead.sourceState === 'AVAILABLE' && tickRead.ticks.length > 0 && coverage.state === 'PASS' && timestampPass && contractPass
    && tickRead.statistics.normalizedOutOfOrderCount === 0 && tickRead.statistics.contractMismatchCount === 0;
  let selectedReplayResolution = 'NO_SAMPLE';
  let fallbackReason = null;
  if (tickPass) selectedReplayResolution = 'TICK_REPLAY_PASS';
  else if (ohlcAudit?.pass) {
    selectedReplayResolution = 'FIVE_MINUTE_OHLC_FALLBACK';
    fallbackReason = tickRead.sourceState !== 'AVAILABLE' ? 'RAW_TICK_SOURCE_MISSING'
      : tickRead.ticks.length === 0 ? 'EXPECTED_CONTRACT_HAS_NO_DAY_TICKS'
        : coverage.state !== 'PASS' ? 'REQUIRED_TICK_PATH_INCOMPLETE'
          : !timestampPass ? 'EXCHANGE_TIMESTAMP_INVALID' : !contractPass ? 'CONTRACT_MISMATCH' : 'TICK_QUALITY_FAILED';
  } else fallbackReason = 'TICK_AND_OHLC_REPLAY_UNAVAILABLE';
  return {
    schemaVersion: 't0-replay-resolution-record-v1', tradeDate: manifestRow.tradeDate, sessionId: manifestRow.sessionId,
    selectedResearchContractCode: manifestRow.selectedResearchContractCode,
    actualReplayContractCode: manifestRow.actualReplayContractCode,
    rawTickSource: tickRead.sourceState === 'AVAILABLE' ? path.basename(tickRead.source.zipPath) : null,
    rawTickSourceClass: tickRead.source.sourceClass,
    rawTickSourceHash: tickRead.source.zipSha256 || null,
    tickCoverageStart: tickRead.ticks[0]?.exchangeTimestamp || null,
    tickCoverageEnd: tickRead.ticks.at(-1)?.exchangeTimestamp || null,
    tickEventCount: tickRead.ticks.length,
    exchangeTimestampState: timestampPass && tickRead.ticks.length ? 'PASS_ASIA_TAIPEI_TO_UTC' : 'UNAVAILABLE',
    sequenceGapCount: tickRead.statistics.sequenceGapCount || 0,
    sequenceEvidenceState: tickRead.statistics.sourceExchangeSequenceAvailable ? 'EXCHANGE_SEQUENCE_AVAILABLE' : 'DERIVED_ORDER_ONLY_NO_EXCHANGE_SEQUENCE',
    duplicateCount: tickRead.statistics.duplicateCount || 0,
    duplicateEvidenceState: tickRead.statistics.duplicateDetectionState,
    outOfOrderCount: tickRead.statistics.normalizedOutOfOrderCount || 0,
    sourceFileOrderOutOfOrderCount: tickRead.statistics.fileOrderOutOfOrderCount || 0,
    contractMismatchCount: tickRead.statistics.contractMismatchCount || 0,
    otherContractEventCount: tickRead.statistics.otherContractEventCount || 0,
    staleOrInvalidCount: tickRead.statistics.staleOrInvalidCount || 0,
    requiredPathCoverageState: coverage.state,
    missingRequiredBuckets: coverage.missingBuckets,
    tickQualityState: tickPass ? 'PASS_WITH_DERIVED_SEQUENCE_LIMITATION' : tickRead.sourceState === 'AVAILABLE' ? 'DEGRADED' : 'UNAVAILABLE',
    selectedReplayResolution, fallbackReason,
    performanceSummaryProduced: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

export function selectNaturalTickSessions(records) {
  const passes = records.filter((row) => row.selectedReplayResolution === 'TICK_REPLAY_PASS').sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const candidates = passes.map((row) => ({ tradeDate: row.tradeDate, sessionId: row.sessionId, settlementClass: row.settlementClass, rollSession: row.rollSession }));
  const normal = passes.find((row) => row.settlementClass === 'NORMAL_SESSION' && !row.rollSession);
  const settlement = passes.find((row) => row.settlementClass === 'SETTLEMENT_FINAL_CONTRACT');
  const roll = passes.find((row) => row.rollSession);
  const selected = [];
  for (const row of [normal, settlement, roll]) if (row && !selected.some((item) => item.sessionId === row.sessionId)) selected.push(row);
  if (selected.length < 3) {
    for (const row of passes) {
      if (!selected.some((item) => item.sessionId === row.sessionId)) selected.push(row);
      if (selected.length === 3) break;
    }
  }
  return {
    selectionRule: 'EARLIEST_TICK_PASS_NORMAL_THEN_EARLIEST_SETTLEMENT_FINAL_THEN_EARLIEST_ROLL_WITH_DISTINCT_SESSION_FALLBACK',
    candidateSessionList: candidates,
    selectedSessionList: selected.slice(0, 3).map((row) => row.sessionId),
    selectionInputHash: hashJson(candidates),
  };
}

function tickMaeMfe(direction, entryPrice, ticks) {
  if (!ticks.length) return { maePoints: null, mfePoints: null, qualityState: 'UNAVAILABLE' };
  const moves = ticks.map((tick) => direction === 'LONG' ? tick.price - entryPrice : entryPrice - tick.price);
  return { maePoints: Math.min(...moves), mfePoints: Math.max(...moves), qualityState: 'PASS' };
}

function tickFalseBreakout({ direction, entryPrice, stopPrice, orHigh, orLow, ticks, bars, confirmationIndex }) {
  const oneR = Math.abs(entryPrice - stopPrice);
  const oneRPrice = direction === 'LONG' ? entryPrice + oneR : entryPrice - oneR;
  const observationBars = bars.slice(confirmationIndex + 1, confirmationIndex + 4);
  if (observationBars.length < 3) return { falseBreakout: 'UNAVAILABLE', falseBreakoutQualityState: 'UNAVAILABLE', falseBreakoutReason: 'FALSE_BREAKOUT_PATH_UNAVAILABLE' };
  let reachedOneR = false;
  for (let index = 0; index < observationBars.length; index += 1) {
    const bar = observationBars[index];
    const end = new Date(Date.parse(bar.timestamp) + 300_000).toISOString();
    const path = ticks.filter((tick) => tick.exchangeTimestamp >= bar.timestamp && tick.exchangeTimestamp < end);
    const groups = new Map();
    for (const tick of path) {
      const group = groups.get(tick.exchangeTimestamp) || [];
      group.push(tick);
      groups.set(tick.exchangeTimestamp, group);
    }
    for (const [timestamp, group] of groups) {
      const stop = group.some((tick) => direction === 'LONG' ? tick.price <= stopPrice : tick.price >= stopPrice);
      const favorable = group.some((tick) => direction === 'LONG' ? tick.price >= oneRPrice : tick.price <= oneRPrice);
      if (stop) return { falseBreakout: true, falseBreakoutQualityState: 'PASS_TICK_ORDERED', falseBreakoutReason: 'STOPPED_WITHIN_FALSE_BREAKOUT_WINDOW', observationBarNumber: index + 1, eventTimestamp: timestamp, sequencePolicy: favorable ? 'AMBIGUOUS_SEQUENCE_CONSERVATIVE' : 'TICK_TIME_ORDER' };
      if (favorable) reachedOneR = true;
    }
    const returned = direction === 'LONG' ? bar.close <= orHigh : bar.close >= orLow;
    if (returned) return reachedOneR
      ? { falseBreakout: false, falseBreakoutQualityState: 'PASS_TICK_ORDERED', falseBreakoutReason: 'FAVORABLE_1R_REACHED_BEFORE_OR_RETURN', observationBarNumber: index + 1 }
      : { falseBreakout: true, falseBreakoutQualityState: 'PASS_TICK_ORDERED', falseBreakoutReason: direction === 'LONG' ? 'RETURNED_BELOW_OR_HIGH_BEFORE_1R' : 'RETURNED_ABOVE_OR_LOW_BEFORE_1R', observationBarNumber: index + 1 };
  }
  return { falseBreakout: false, falseBreakoutQualityState: 'PASS_TICK_ORDERED', falseBreakoutReason: reachedOneR ? 'FAVORABLE_1R_REACHED_WITHIN_WINDOW' : 'NO_OR_RETURN_WITHIN_THREE_BARS' };
}

export function executeNaturalTickSession({ manifestRow, tickRead, costPolicy }) {
  const base = {
    schemaVersion: 't0-h0-natural-tick-session-result-v1', fixtureOnly: false, officialResearchEligible: false, synthetic: false,
    tradeDate: manifestRow.tradeDate, sessionId: manifestRow.sessionId, contractCode: manifestRow.actualReplayContractCode,
    settlementClass: manifestRow.settlementClass, rollSession: manifestRow.rollSession, eligibilityClass: manifestRow.eligibilityClass,
    replayResolution: 'TICK_REPLAY_PASS', pathQuality: 'PASS_TICK_ORDERED', performanceSummaryProduced: false,
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  const coverage = requiredPathCoverage(manifestRow.tradeDate, tickRead.bars);
  if (coverage.state !== 'PASS' || !tickRead.ticks.length) return { ...base, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE', noSampleReason: 'TICK_PATH_UNAVAILABLE' };
  const or = openingRange(tickRead.bars);
  if (or.qualityState !== 'PASS') return { ...base, ...or, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE' };
  const breakout = firstBreakout(tickRead.bars, or.orHigh, or.orLow);
  if (!breakout) return { ...base, ...or, sampleState: 'ELIGIBLE', tradeState: 'NO_TRADE', noTradeReason: 'NO_BREAKOUT_WITHIN_ENTRY_WINDOW' };
  const confirmationIndex = tickRead.bars.indexOf(breakout.confirmationBar);
  const entryBar = tickRead.bars[confirmationIndex + 1];
  if (!entryBar || entryBar.timestamp > `${manifestRow.tradeDate}T02:00:00.000Z`) return { ...base, ...or, sampleState: 'ELIGIBLE', tradeState: 'NO_TRADE', noTradeReason: 'ENTRY_WINDOW_EXPIRED', breakoutDirection: breakout.direction };
  const entryTick = tickRead.ticks.find((tick) => tick.exchangeTimestamp >= entryBar.timestamp && tick.exchangeTimestamp < new Date(Date.parse(entryBar.timestamp) + 300_000).toISOString());
  if (!entryTick) return { ...base, ...or, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE', noSampleReason: 'LEGAL_ENTRY_TICK_UNAVAILABLE' };
  const stopPrice = breakout.direction === 'LONG' ? or.orLow : or.orHigh;
  const entryGap = evaluateEntryGapThroughStop({ direction: breakout.direction, entryOpen: entryTick.price, stopPrice });
  if (entryGap.tradeState === 'NO_TRADE') return { ...base, ...or, sampleState: 'ELIGIBLE', ...entryGap, breakoutConfirmedAt: breakout.confirmationBar.timestamp, initialStopPrice: stopPrice };
  const entryIndex = tickRead.ticks.indexOf(entryTick);
  const timeExitAt = new Date(Date.parse(entryTick.exchangeTimestamp) + 60 * 60_000).toISOString();
  let exitTick = null;
  let exitReason = null;
  let sequencePolicy = 'TICK_TIME_ORDER';
  for (let index = entryIndex; index < tickRead.ticks.length;) {
    const timestamp = tickRead.ticks[index].exchangeTimestamp;
    const group = [];
    while (index < tickRead.ticks.length && tickRead.ticks[index].exchangeTimestamp === timestamp) group.push(tickRead.ticks[index++]);
    const adverse = group.find((tick) => breakout.direction === 'LONG' ? tick.price <= stopPrice : tick.price >= stopPrice);
    if (adverse) { exitTick = adverse; exitReason = 'STOP_EXIT'; sequencePolicy = 'FIRST_LEGAL_ADVERSE_TICK'; break; }
    if (timestamp >= timeExitAt) { exitTick = group[0]; exitReason = 'TIME_EXIT'; break; }
  }
  if (!exitTick) return { ...base, ...or, sampleState: 'NO_SAMPLE', tradeState: 'NO_SAMPLE', noSampleReason: 'TIME_EXIT_PRICE_UNAVAILABLE', breakoutDirection: breakout.direction };
  const exitIndex = tickRead.ticks.indexOf(exitTick);
  const pathTicks = tickRead.ticks.slice(entryIndex, exitIndex + 1);
  const maeMfe = tickMaeMfe(breakout.direction, entryTick.price, pathTicks);
  const falseBreakout = tickFalseBreakout({ direction: breakout.direction, entryPrice: entryTick.price, stopPrice, orHigh: or.orHigh, orLow: or.orLow, ticks: tickRead.ticks, bars: tickRead.bars, confirmationIndex });
  const vwapContext = calculateExactVwap(tickRead.ticks.filter((tick) => tick.exchangeTimestamp <= entryTick.exchangeTimestamp));
  const costViews = costViewsForTrade({ direction: breakout.direction, entryReferencePrice: entryTick.price, exitReferencePrice: exitTick.price }, costPolicy);
  return {
    ...base, ...or, sampleState: 'ELIGIBLE', tradeState: 'TRADE', noTradeReason: null,
    breakoutDirection: breakout.direction, breakoutConfirmedAt: breakout.confirmationBar.timestamp,
    entryAt: entryTick.exchangeTimestamp, entryReferencePrice: entryTick.price, entrySourceRowNumber: entryTick.sourceRowNumber,
    initialStopPrice: stopPrice, exitAt: exitTick.exchangeTimestamp, exitReferencePrice: exitTick.price,
    exitSourceRowNumber: exitTick.sourceRowNumber, exitReason, eventSequencePolicy: sequencePolicy, timeExitAt,
    maePoints: maeMfe.maePoints, mfePoints: maeMfe.mfePoints,
    maeR: Math.abs(entryTick.price - stopPrice) > 0 ? maeMfe.maePoints / Math.abs(entryTick.price - stopPrice) : null,
    mfeR: Math.abs(entryTick.price - stopPrice) > 0 ? maeMfe.mfePoints / Math.abs(entryTick.price - stopPrice) : null,
    falseBreakout, vwapContext, costViews,
    tickEvidence: { tickEventCount: tickRead.ticks.length, pathTickCount: pathTicks.length, sourceZip: path.basename(tickRead.source.zipPath), sourceZipHash: tickRead.source.zipSha256 },
  };
}

export function compareTickAndOhlc(tickResult, ohlcResult) {
  const fields = ['tradeState', 'breakoutDirection', 'entryAt', 'entryReferencePrice', 'exitAt', 'exitReferencePrice', 'exitReason', 'maePoints', 'mfePoints'];
  return {
    schemaVersion: 't0-tick-vs-ohlc-diagnostic-v1', tradeDate: tickResult.tradeDate, sessionId: tickResult.sessionId,
    officialReplayResolution: 'TICK_REPLAY_PASS', comparisonReplayResolution: 'FIVE_MINUTE_OHLC_DIAGNOSTIC_ONLY',
    differences: Object.fromEntries(fields.map((field) => [field, { tick: tickResult[field] ?? null, ohlc: ohlcResult[field] ?? null, equal: (tickResult[field] ?? null) === (ohlcResult[field] ?? null) }])),
    falseBreakout: { tick: tickResult.falseBreakout ?? null, ohlc: ohlcResult.falseBreakout ?? null },
    mixedIntoResearchStatistics: false, performanceSummaryProduced: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

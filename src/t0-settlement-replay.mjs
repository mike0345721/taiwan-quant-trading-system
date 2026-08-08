import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { spawn } from 'node:child_process';
import { hashJson } from './t0-data-replay-gate.mjs';

const SETTLEMENT_DATES = Object.freeze([
  '2026-01-21', '2026-02-23', '2026-03-18', '2026-04-15',
  '2026-05-20', '2026-06-17', '2026-07-15',
]);

function fileHash(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function isoFromTaipeiTrade(dateText, timeText) {
  const date = `${dateText.slice(0, 4)}-${dateText.slice(4, 6)}-${dateText.slice(6, 8)}`;
  const hh = Number(timeText.slice(0, 2));
  const mm = Number(timeText.slice(2, 4));
  const ss = Number(timeText.slice(4, 6));
  return new Date(Date.parse(`${date}T00:00:00.000Z`) + (hh - 8) * 3_600_000 + mm * 60_000 + ss * 1_000).toISOString();
}

function bucketTimestamp(exchangeTimestamp) {
  const ms = Date.parse(exchangeTimestamp);
  return new Date(Math.floor(ms / 300_000) * 300_000).toISOString();
}

function validDayTime(hhmmss) {
  return hhmmss >= '084500' && hhmmss < '134500';
}

export function settlementZipPath(root, tradeDate) {
  const name = `Daily_${tradeDate.replaceAll('-', '_')}.zip`;
  if (tradeDate < '2026-07-01') return path.join(root, 'data/intraday/paid-staging/202601-06-inner-zips', name);
  return path.join(root, 'data/intraday/raw', name);
}

export async function replayContractFromZip({ zipPath, tradeDate, contractCode }) {
  if (!fs.existsSync(zipPath)) throw new Error(`RAW_ZIP_MISSING:${tradeDate}`);
  const entry = `Daily_${tradeDate.replaceAll('-', '_')}.csv`;
  const child = spawn('tar', ['-xOf', zipPath, entry], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  const bars = new Map();
  let tickCount = 0;
  let firstExchangeTimestamp = null;
  let lastExchangeTimestamp = null;
  for await (const line of lines) {
    const columns = line.split(',');
    if (columns.length < 6) continue;
    const [dateText, productText, contractText, timeText, priceText, volumeText] = columns.map((value) => value.trim());
    if (dateText !== tradeDate.replaceAll('-', '') || productText !== 'TX' || contractText !== contractCode || !/^\d{6}$/.test(timeText) || !validDayTime(timeText)) continue;
    const price = Number(priceText);
    const volume = Number(volumeText) / 2;
    if (!Number.isFinite(price) || !Number.isFinite(volume) || volume < 0) continue;
    const exchangeTimestamp = isoFromTaipeiTrade(dateText, timeText);
    const timestamp = bucketTimestamp(exchangeTimestamp);
    const bar = bars.get(timestamp) || { timestamp, open: price, high: price, low: price, close: price, volume: 0, complete: true };
    bar.high = Math.max(bar.high, price);
    bar.low = Math.min(bar.low, price);
    bar.close = price;
    bar.volume += volume;
    bars.set(timestamp, bar);
    tickCount += 1;
    firstExchangeTimestamp ||= exchangeTimestamp;
    lastExchangeTimestamp = exchangeTimestamp;
  }
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  if (exitCode !== 0) throw new Error(`RAW_ZIP_READ_FAILED:${tradeDate}:${stderr.trim()}`);
  const sortedBars = [...bars.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const required = Array.from({ length: 28 }, (_, index) => new Date(Date.parse(`${tradeDate}T00:45:00.000Z`) + index * 300_000).toISOString());
  const requiredThrough1100Complete = required.every((timestamp) => bars.has(timestamp));
  return {
    schemaVersion: '1.0.0', sourceType: 'HISTORICAL_TICK_REPLAY', product: 'TX', tradeDate,
    contractCode, sourceZip: path.basename(zipPath), sourceZipSha256: fileHash(zipPath), tickCount,
    firstExchangeTimestamp, lastExchangeTimestamp, barCount: sortedBars.length,
    requiredThrough1100Bars: 28, requiredThrough1100Complete, bars: sortedBars,
    researchOnly: true, executionAuthorized: false,
  };
}

function role(set, name) {
  return set.records.find((record) => record.contractRole === name) || null;
}

export async function scanSettlementContracts({ root, pp1P05 }) {
  const scans = [];
  for (const tradeDate of SETTLEMENT_DATES) {
    const set = pp1P05.sets.find((candidate) => candidate.sessionId === `${tradeDate}-DAY`);
    if (!set) throw new Error(`PP1_SELECTION_SET_MISSING:${tradeDate}`);
    const selected = role(set, 'SELECTED_RESEARCH');
    const replay = await replayContractFromZip({ zipPath: settlementZipPath(root, tradeDate), tradeDate, contractCode: selected.contractCode });
    const strict = replay.requiredThrough1100Complete && replay.tickCount > 0 && /^\d{6}$/.test(selected.contractCode);
    scans.push({
      tradeDate, sessionId: set.sessionId, selectionSetId: set.selectionSetId,
      actualReplayContractCode: replay.contractCode,
      selectedResearchContractCode: selected.contractCode,
      sessionFrozenLiquidityLeadContractCode: role(set, 'SESSION_FROZEN_LIQUIDITY_LEAD')?.contractCode || null,
      nearestEligibleMonthlyContractCode: role(set, 'NEAREST_ELIGIBLE_MONTH')?.contractCode || null,
      liquidityObservationState: role(set, 'OBSERVED_LIQUIDITY_LEAD')?.qualityState || 'UNAVAILABLE',
      contractPolicyAlignment: strict ? 'PASS' : 'DEGRADED',
      selectionMode: selected.selectionReason,
      fallbackReason: selected.fallbackReason,
      eligibilityClass: strict ? 'STRICT_PP1_ALIGNED' : replay.tickCount > 0 ? 'RESEARCH_FALLBACK' : 'NO_SAMPLE',
      qualityState: strict ? 'PASS' : replay.tickCount > 0 ? 'DEGRADED' : 'UNAVAILABLE',
      researchEligible: strict || replay.tickCount > 0,
      t0SampleEligible: strict || replay.tickCount > 0,
      tradeEligible: false,
      settlementClass: 'SETTLEMENT_FINAL_CONTRACT',
      lineage: {
        lineageMode: 'HISTORICAL_REPLAY', exchangeTimestamp: replay.lastExchangeTimestamp,
        replayAvailableAt: selected.timestampLineage?.featureAvailableAt || selected.selectedAt,
        featureAvailableAt: selected.timestampLineage?.featureAvailableAt || selected.selectedAt,
        sourceZipSha256: replay.sourceZipSha256,
      },
      replay,
    });
  }
  return { schemaVersion: '1.0.0', scanId: 'T0_SETTLEMENT_CONTRACT_SCAN_V1', dates: SETTLEMENT_DATES, scans, scanHash: hashJson(scans), researchOnly: true, executionAuthorized: false };
}

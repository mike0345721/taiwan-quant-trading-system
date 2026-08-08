import fs from 'node:fs';
import readline from 'node:readline';
import { buildTickBars, executeNaturalTickSession, readNaturalTicks } from './t0-natural-tick-integration.mjs';
import { buildHistoricalPaperSession, digest, P0_SPEC } from './p0-paper-trading.mjs';

function finite(value) { return Number.isFinite(Number(value)); }

function toUtc(timestamp) {
  if (typeof timestamp !== 'string' || !timestamp) return null;
  const text = /(?:Z|[+-]\d\d:\d\d)$/.test(timestamp) ? timestamp : `${timestamp}+08:00`;
  const milliseconds = Date.parse(text);
  return Number.isFinite(milliseconds) ? new Date(milliseconds).toISOString() : null;
}

export function executeP0SingleEngine({ manifestRow, tickRead, costPolicy, existingEvents = [], recordedAt = null }) {
  const detection = executeNaturalTickSession({ manifestRow, tickRead, costPolicy });
  detection.inputEvidence = {
    t0SpecHash: P0_SPEC.t0SpecHash,
    costPolicyHash: P0_SPEC.costPolicyHash,
    strictManifestHash: P0_SPEC.strictManifestHash,
    rawMarketInputHash: tickRead.source?.zipSha256 || tickRead.source?.logicalHash || null,
    inputMode: tickRead.source?.sourceClass || 'UNKNOWN_MARKET_SOURCE',
  };
  const before = existingEvents.length;
  const paper = buildHistoricalPaperSession(detection, existingEvents, { recordedAt });
  return {
    detection,
    paper,
    appendedEvents: existingEvents.slice(before),
    inputEvidenceHash: digest({
      tradeDate: manifestRow.tradeDate,
      sessionId: manifestRow.sessionId,
      contractCode: manifestRow.actualReplayContractCode,
      tickCount: tickRead.ticks.length,
      firstTick: tickRead.ticks[0] || null,
      lastTick: tickRead.ticks.at(-1) || null,
      sourceHash: tickRead.source?.zipSha256 || tickRead.source?.logicalHash || null,
    }),
  };
}

export async function executeP0HistoricalRaw({ root, manifestRow, costPolicy, existingEvents = [] }) {
  const tickRead = await readNaturalTicks({ root, tradeDate: manifestRow.tradeDate, contractCode: manifestRow.actualReplayContractCode });
  if (tickRead.sourceState !== 'AVAILABLE') throw new Error(`P0_RAW_MARKET_DATA_UNAVAILABLE:${manifestRow.sessionId}`);
  return executeP0SingleEngine({ manifestRow, tickRead, costPolicy, existingEvents });
}

export async function readP0LiveTicks({ ledgerFile, tradeDate, contractCode }) {
  if (!fs.existsSync(ledgerFile)) return { sourceState: 'MISSING', source: { ledgerFile }, ticks: [], bars: [], statistics: {} };
  const stream = fs.createReadStream(ledgerFile, { encoding: 'utf8' });
  const lines = readline.createInterface({ input: stream, crlfDelay: Infinity });
  const ticks = [];
  let invalidCount = 0;
  let duplicateCount = 0;
  let sequenceGapCount = 0;
  let rowNumber = 0;
  for await (const line of lines) {
    rowNumber += 1;
    let record;
    try { record = JSON.parse(line); } catch { invalidCount += 1; continue; }
    if (record.kind !== 'futures_tick' || record.payload?._product_family !== 'TX') continue;
    if (record.payload?.date !== tradeDate || record.payload?._target_code !== contractCode) continue;
    if (record.payload?.simtrade === true) continue;
    if (record.duplicate === true) { duplicateCount += 1; continue; }
    sequenceGapCount += Number(record.sequenceGap || 0);
    const exchangeTimestamp = toUtc(record.exchangeTimestamp || record.payload?.datetime);
    if (!exchangeTimestamp || !finite(record.payload?.close) || !finite(record.payload?.volume)) { invalidCount += 1; continue; }
    ticks.push({
      sourceRowNumber: rowNumber,
      tradeDate,
      sessionId: `${tradeDate}-DAY`,
      contractCode,
      exchangeTimestamp,
      receivedTimestamp: toUtc(record.receivedAt),
      price: Number(record.payload.close),
      volume: Number(record.payload.volume),
      eventId: record.eventId,
    });
  }
  ticks.sort((a, b) => a.exchangeTimestamp.localeCompare(b.exchangeTimestamp) || a.sourceRowNumber - b.sourceRowNumber);
  ticks.forEach((tick, index) => { tick.normalizedSequence = index + 1; });
  const logicalHash = digest(ticks.map(({ eventId, exchangeTimestamp, price, volume }) => ({ eventId, exchangeTimestamp, price, volume })));
  return {
    sourceState: 'AVAILABLE',
    source: { sourceClass: 'SHIOAJI_APPEND_ONLY_LIVE_LEDGER', ledgerFile, logicalHash },
    ticks,
    bars: buildTickBars(ticks),
    statistics: { staleOrInvalidCount: invalidCount, contractMismatchCount: 0, duplicateCount, sequenceGapCount },
  };
}

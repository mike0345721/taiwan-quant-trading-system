import fs from 'node:fs';
import readline from 'node:readline';
import { taifexSession } from './taifex-intraday.mjs';

function numeric(value) {
  const n = Number(String(value ?? '').trim());
  return Number.isFinite(n) ? n : null;
}

function isoDate(value) {
  return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
}

function bucketTimestamp(date, time, minutes = 5) {
  const raw = String(time).padStart(6, '0');
  const hour = Number(raw.slice(0, 2));
  const rawMinute = Number(raw.slice(2, 4));
  const isDayClose = hour === 13 && rawMinute === 45;
  const isNightClose = hour === 5 && rawMinute === 0;
  const bucketHour = isNightClose ? 4 : hour;
  const adjustedMinute = isDayClose ? 44 : isNightClose ? 59 : rawMinute;
  const minute = Math.floor(adjustedMinute / minutes) * minutes;
  return new Date(`${isoDate(date)}T${String(bucketHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).toISOString();
}

function newStream(contract, session) {
  return {
    contract,
    session,
    totalVolume: 0,
    tickCount: 0,
    lastPrice: null,
    lastNonZeroDirection: 0,
    signedVolume: 0,
    upVolume: 0,
    downVolume: 0,
    unclassifiedVolume: 0,
    upTicks: 0,
    downTicks: 0,
    unclassifiedTicks: 0,
    bars: new Map(),
  };
}

function classifyTick(stream, price) {
  if (stream.lastPrice == null) return 0;
  if (price > stream.lastPrice) return 1;
  if (price < stream.lastPrice) return -1;
  return stream.lastNonZeroDirection;
}

function applyTick(stream, { date, time, price, volume }) {
  const direction = classifyTick(stream, price);
  if (direction !== 0) stream.lastNonZeroDirection = direction;
  stream.lastPrice = price;
  stream.tickCount += 1;
  stream.totalVolume += volume;
  stream.signedVolume += direction * volume;
  if (direction > 0) {
    stream.upVolume += volume;
    stream.upTicks += 1;
  } else if (direction < 0) {
    stream.downVolume += volume;
    stream.downTicks += 1;
  } else {
    stream.unclassifiedVolume += volume;
    stream.unclassifiedTicks += 1;
  }

  const timestamp = bucketTimestamp(date, time, 5);
  let bar = stream.bars.get(timestamp);
  if (!bar) {
    bar = {
      timestamp,
      volume: 0,
      signedVolume: 0,
      upVolume: 0,
      downVolume: 0,
      unclassifiedVolume: 0,
      upTicks: 0,
      downTicks: 0,
      unclassifiedTicks: 0,
      tickRuleCvd: 0,
    };
    stream.bars.set(timestamp, bar);
  }
  bar.volume += volume;
  bar.signedVolume += direction * volume;
  if (direction > 0) {
    bar.upVolume += volume;
    bar.upTicks += 1;
  } else if (direction < 0) {
    bar.downVolume += volume;
    bar.downTicks += 1;
  } else {
    bar.unclassifiedVolume += volume;
    bar.unclassifiedTicks += 1;
  }
  bar.tickRuleCvd = stream.signedVolume;
}

function finalizeStream(stream) {
  const directionalVolume = stream.upVolume + stream.downVolume;
  return {
    schemaVersion: 'market-state-taifex-tick-rule-flow-v1',
    source: 'TAIFEX_paid_historical_futures_trade_summary',
    product: 'TX',
    contract: stream.contract,
    session: stream.session,
    timeframe: '5m',
    classificationMethod: 'TICK_RULE_WITH_ZERO_TICK_CARRY_FORWARD',
    estimatedTradeDirection: true,
    realAggressorSide: false,
    bidAskAvailable: false,
    volumeDefinition: 'TAIFEX B+S divided by 2',
    tickCount: stream.tickCount,
    totalVolume: stream.totalVolume,
    upVolume: stream.upVolume,
    downVolume: stream.downVolume,
    unclassifiedVolume: stream.unclassifiedVolume,
    signedVolume: stream.signedVolume,
    tickRuleCvd: stream.signedVolume,
    classificationCoverage: stream.totalVolume > 0 ? directionalVolume / stream.totalVolume : null,
    bars: [...stream.bars.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

export async function aggregateTaifexTickRuleFlowCsv(filePath, { tradeDate } = {}) {
  const streams = new Map();
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let acceptedTicks = 0;
  let malformedTicks = 0;
  let excludedSpreadRows = 0;
  let excludedNonTxRows = 0;

  for await (const line of lines) {
    lineNumber += 1;
    if (lineNumber === 1 || !line) continue;
    const columns = line.split(',');
    if (columns.length < 6) {
      malformedTicks += 1;
      continue;
    }
    if (columns[1]?.trim() !== 'TX') {
      excludedNonTxRows += 1;
      continue;
    }
    const date = columns[0]?.trim();
    const contract = columns[2]?.trim();
    const time = columns[3]?.trim();
    const price = numeric(columns[4]);
    const twoSidedQuantity = numeric(columns[5]);
    if (contract?.includes('/')) {
      excludedSpreadRows += 1;
      continue;
    }
    if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(contract) || !/^\d{5,6}$/.test(time)
      || price == null || twoSidedQuantity == null || twoSidedQuantity < 0) {
      malformedTicks += 1;
      continue;
    }
    const session = taifexSession(time);
    const key = `${contract}|${session}`;
    if (!streams.has(key)) streams.set(key, newStream(contract, session));
    applyTick(streams.get(key), {
      date,
      time,
      price,
      volume: twoSidedQuantity / 2,
    });
    acceptedTicks += 1;
  }

  const allStreams = [...streams.values()];
  const dayLeader = allStreams
    .filter((item) => item.session === 'day')
    .sort((a, b) => b.totalVolume - a.totalVolume)[0];
  const contractTotals = new Map();
  for (const stream of allStreams) {
    contractTotals.set(stream.contract, (contractTotals.get(stream.contract) || 0) + stream.totalVolume);
  }
  const fallbackContract = [...contractTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const selectedContract = dayLeader?.contract ?? fallbackContract;
  const sessions = {};
  for (const session of ['day', 'night']) {
    const selected = streams.get(`${selectedContract}|${session}`);
    if (selected) sessions[session] = finalizeStream(selected);
  }

  return {
    schemaVersion: 'market-state-taifex-tick-rule-flow-batch-v1',
    tradeDate: tradeDate ?? null,
    selectedContract,
    contractSelection: dayLeader ? 'day_session_volume_leader' : 'combined_volume_fallback',
    acceptedTicks,
    malformedTicks,
    excludedSpreadRows,
    excludedNonTxRows,
    sessions,
    limitation: 'Tick-rule direction is an estimate from trade prices only; no Bid/Ask is present in the paid trade-summary file.',
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

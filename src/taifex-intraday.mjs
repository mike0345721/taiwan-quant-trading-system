import fs from 'node:fs';
import readline from 'node:readline';

function numeric(value) { const number = Number(String(value).trim()); return Number.isFinite(number) ? number : null; }
function isoDate(value) { return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`; }

export function taifexSession(time) {
  const hhmm = Number(String(time).padStart(6, '0').slice(0, 4));
  return hhmm >= 845 && hhmm <= 1345 ? 'day' : 'night';
}

export function taifexTimestamp(date, time) {
  const raw = String(time).padStart(6, '0');
  const hour = Number(raw.slice(0, 2));
  const rawMinute = Number(raw.slice(2, 4));
  // A closing tick stamped exactly 13:45 belongs to the final 13:40-13:45
  // candle, not to a new interval after the regular session has ended.
  const isDayClose = hour === 13 && rawMinute === 45;
  const isNightClose = hour === 5 && rawMinute === 0;
  const bucketHour = isNightClose ? 4 : hour;
  const minute = isDayClose ? 40 : isNightClose ? 55 : Math.floor(rawMinute / 5) * 5;
  return new Date(`${isoDate(date)}T${String(bucketHour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00+08:00`).toISOString();
}

export async function aggregateTaifexTxCsv(filePath, {
  tradeDate,
  provider = 'TAIFEX official 30-day tick file',
} = {}) {
  const streams = new Map();
  const input = fs.createReadStream(filePath, { encoding: 'utf8' });
  const lines = readline.createInterface({ input, crlfDelay: Infinity });
  let lineNumber = 0;
  let acceptedTicks = 0;
  let malformedTicks = 0;
  let excludedNonOutrightRows = 0;
  let excludedSpreadRows = 0;
  const malformedExamples = [];
  for await (const line of lines) {
    lineNumber += 1;
    if (lineNumber === 1 || !line) continue;
    const columns = line.split(',');
    if (columns.length < 6 || columns[1]?.trim() !== 'TX') continue;
    const date = columns[0]?.trim();
    const contract = columns[2]?.trim();
    const time = columns[3]?.trim();
    const price = numeric(columns[4]);
    const twoSidedQuantity = numeric(columns[5]);
    if (contract?.includes('/')) { excludedSpreadRows += 1; continue; }
    if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(contract) || !/^\d{5,6}$/.test(time) || twoSidedQuantity == null || twoSidedQuantity < 0) {
      malformedTicks += 1;
      if (malformedExamples.length < 5) malformedExamples.push({ date, contract, time, price: columns[4]?.trim(), quantity: columns[5]?.trim() });
      continue;
    }
    if (price == null) { excludedNonOutrightRows += 1; continue; }
    const session = taifexSession(time);
    const timestamp = taifexTimestamp(date, time);
    const key = `${contract}|${session}`;
    if (!streams.has(key)) streams.set(key, { contract, session, volume: 0, ticks: 0, bars: new Map() });
    const stream = streams.get(key);
    // TAIFEX labels this field B+S, so matched contracts equal half the reported two-sided quantity.
    const matchedVolume = twoSidedQuantity / 2;
    stream.volume += matchedVolume;
    stream.ticks += 1;
    const bar = stream.bars.get(timestamp);
    if (!bar) {
      stream.bars.set(timestamp, { timestamp, open: price, high: price, low: price, close: price, volume: matchedVolume, complete: true });
    } else {
      bar.high = Math.max(bar.high, price);
      bar.low = Math.min(bar.low, price);
      bar.close = price;
      bar.volume += matchedVolume;
    }
    acceptedTicks += 1;
  }

  const bySession = {};
  const allStreams = [...streams.values()];
  // Anchor both sessions to the day-session dominant contract.  Selecting the
  // largest contract independently for day and night creates a false overnight
  // gap on rollover days (for example: night=near month, day=next month).
  const dayLeader = allStreams
    .filter((item) => item.session === 'day')
    .sort((a, b) => b.volume - a.volume)[0];
  const contractTotals = new Map();
  for (const stream of allStreams) contractTotals.set(stream.contract, (contractTotals.get(stream.contract) || 0) + stream.volume);
  const fallbackContract = [...contractTotals.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
  const selectedContract = dayLeader?.contract || fallbackContract;

  for (const session of ['day', 'night']) {
    const selected = streams.get(`${selectedContract}|${session}`);
    if (!selected) continue;
    const bars = [...selected.bars.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
    const peerSession = [...streams.values()].find((item) => item.contract === selected.contract && item.session !== session);
    bySession[session] = {
      schemaVersion: '1.0.0', source: 'historical_replay', provider, product: 'TX',
      contract: selected.contract, session, timeframe: '5m', tradeDate: tradeDate || null,
      volumeDefinition: 'TAIFEX B+S divided by 2', tickCount: selected.ticks, barCount: bars.length,
      sessionVolume: selected.volume, tradeDateCombinedVolume: selected.volume + (peerSession?.volume || 0),
      firstTimestamp: bars[0]?.timestamp || null, lastTimestamp: bars.at(-1)?.timestamp || null, bars,
    };
  }
  return {
    acceptedTicks, malformedTicks, malformedExamples, excludedNonOutrightRows, excludedSpreadRows,
    selectedContract,
    contractSelection: dayLeader ? 'day_session_volume_leader' : 'combined_volume_fallback',
    contracts: [...new Set(allStreams.map((item) => item.contract))].sort(),
    sessions: bySession,
  };
}

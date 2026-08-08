import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledgerDir = path.join(root, 'data', 'live-events');
const requestedDate = process.argv.find((value) => value.startsWith('--date='))?.slice(7);
const from = process.argv.find((value) => value.startsWith('--from='))?.slice(7) || null;
const to = process.argv.find((value) => value.startsWith('--to='))?.slice(5) || null;
const fromMs = from ? Date.parse(from) : null;
const toMs = to ? Date.parse(to) : null;
const date = requestedDate || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Taipei' });
const ledgerPath = path.join(ledgerDir, `${date}.ndjson`);
if (!fs.existsSync(ledgerPath)) throw new Error(`ledger_missing:${date}`);

const stats = new Map();
const over5sByReceivedSecond = new Map();
const samples = [];
const measuredOffsets = [];
let invalidLines = 0;
let total = 0;
let windowEvents = 0;

function getStats(key) {
  if (!stats.has(key)) {
    stats.set(key, {
      events: 0,
      measured: 0,
      over1s: 0,
      over5s: 0,
      over10s: 0,
      negative: 0,
      maxAbsoluteMs: 0,
    });
  }
  return stats.get(key);
}

const input = readline.createInterface({
  input: fs.createReadStream(ledgerPath, { encoding: 'utf8' }),
  crlfDelay: Infinity,
});
for await (const line of input) {
  if (!line.trim()) continue;
  total += 1;
  try {
    const record = JSON.parse(line);
    const receivedMs = Date.parse(record.receivedAt);
    if ((fromMs != null && (!Number.isFinite(receivedMs) || receivedMs < fromMs))
      || (toMs != null && (!Number.isFinite(receivedMs) || receivedMs > toMs))) {
      continue;
    }
    windowEvents += 1;
    const key = `${record.product || 'unknown'}:${record.kind || 'unknown'}`;
    const row = getStats(key);
    row.events += 1;
    const value = Number(record.clockSkewMs);
    if (!Number.isFinite(value)) continue;
    const absolute = Math.abs(value);
    measuredOffsets.push(value);
    row.measured += 1;
    row.negative += Number(value < 0);
    row.over1s += Number(absolute > 1_000);
    row.over5s += Number(absolute > 5_000);
    row.over10s += Number(absolute > 10_000);
    row.maxAbsoluteMs = Math.max(row.maxAbsoluteMs, absolute);
    if (absolute > 5_000 && samples.length < 30) {
      samples.push({
        product: record.product,
        kind: record.kind,
        exchangeTimestamp: record.exchangeTimestamp,
        receivedAt: record.receivedAt,
        clockSkewMs: value,
        sequence: record.sequence,
      });
    }
    if (absolute > 5_000) {
      const second = String(record.receivedAt || '').slice(0, 19);
      over5sByReceivedSecond.set(second, (over5sByReceivedSecond.get(second) || 0) + 1);
    }
  } catch {
    invalidLines += 1;
  }
}

const report = {
  schemaVersion: 'live-timestamp-offset-diagnostic-v1',
  date,
  window: { from, to },
  total,
  windowEvents,
  invalidLines,
  byProductAndKind: Object.fromEntries(
    [...stats.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ),
  over5sByReceivedSecond: Object.fromEntries(
    [...over5sByReceivedSecond.entries()].sort(([left], [right]) => left.localeCompare(right)),
  ),
  firstOver5sSamples: samples,
  timestampOffset: (() => {
    const sorted = [...measuredOffsets].sort((left, right) => left - right);
    const percentile = (ratio) => sorted.length
      ? sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * ratio) - 1))]
      : null;
    return {
      samples: sorted.length,
      minMs: sorted.length ? sorted[0] : null,
      p50Ms: percentile(0.50),
      p95Ms: percentile(0.95),
      p99Ms: percentile(0.99),
      maxMs: sorted.length ? sorted.at(-1) : null,
      negativeSamples: sorted.filter((value) => value < 0).length,
    };
  })(),
  interpretation: 'clockSkewMs is received_at minus exchange timestamp and includes clock offset plus transport/callback delay',
  researchOnly: true,
  executionAuthorized: false,
};
console.log(JSON.stringify(report, null, 2));

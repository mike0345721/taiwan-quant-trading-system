import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { aggregateTaifexTxCsv } from '../src/taifex-intraday.mjs';
import { importFiveMinuteBars } from '../src/intraday-import.mjs';

function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

const input = argument('--input');
const tradeDate = argument('--trade-date');
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) {
  console.error('Usage: node scripts/build-taifex-replay.mjs --input <csv> --trade-date YYYY-MM-DD');
  process.exit(2);
}

const result = await aggregateTaifexTxCsv(path.resolve(input), { tradeDate });
const archiveDir = path.resolve('data', 'intraday', 'archive');
for (const [session, payload] of Object.entries(result.sessions)) atomicWrite(path.join(archiveDir, `${tradeDate}-${session}.json`), payload);
const day = result.sessions.day;
if (!day) throw new Error('TAIFEX_TX_DAY_SESSION_NOT_FOUND');
const imported = importFiveMinuteBars(day, path.resolve('data', 'intraday', 'replay-bars.json'), { allowHistorical: true });
if (!imported.ok) throw new Error(`TAIFEX_REPLAY_REJECTED: ${imported.errors.join(', ')}`);
atomicWrite(path.resolve('data', 'intraday', 'taifex-replay-status.json'), {
  state: 'ready', generatedAt: new Date().toISOString(), tradeDate, sourceFile: path.basename(input),
  acceptedTicks: result.acceptedTicks, malformedTicks: result.malformedTicks, malformedExamples: result.malformedExamples, excludedNonOutrightRows: result.excludedNonOutrightRows, excludedSpreadRows: result.excludedSpreadRows, contracts: result.contracts,
  sessions: Object.fromEntries(Object.entries(result.sessions).map(([key, value]) => [key, { contract: value.contract, ticks: value.tickCount, bars: value.barCount, volume: value.bars.reduce((sum, bar) => sum + bar.volume, 0), firstTimestamp: value.firstTimestamp, lastTimestamp: value.lastTimestamp }])),
  replaySession: 'day', executionAuthorized: false,
});
console.log(JSON.stringify({ state: 'ready', tradeDate, acceptedTicks: result.acceptedTicks, malformedTicks: result.malformedTicks, malformedExamples: result.malformedExamples, excludedNonOutrightRows: result.excludedNonOutrightRows, excludedSpreadRows: result.excludedSpreadRows, sessions: Object.fromEntries(Object.entries(result.sessions).map(([key, value]) => [key, { contract: value.contract, bars: value.barCount, ticks: value.tickCount }])) }, null, 2));

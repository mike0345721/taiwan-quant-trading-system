import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { aggregateTaifexTxCsv } from '../src/taifex-intraday.mjs';
import { importFiveMinuteBars } from '../src/intraday-import.mjs';

import { dailyStorageRoots } from '../src/daily-storage-binding.mjs';
import { assertPlainLocalPath } from '../src/owner-local-research-root.mjs';

const roots = dailyStorageRoots();
const dataPath = (...parts) => path.resolve(roots.bound ? roots.storageAppRoot : process.cwd(), ...parts);
if (roots.bound) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--input', '--trade-date']);
  if (args.length !== allowed.size * 2 || args.some((arg, i) => i % 2 === 0 && !allowed.delete(arg))) throw Error('DAILY_ARGUMENT_REJECTED');
}
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temp, filePath);
}

const input = argument('--input');
const tradeDate = argument('--trade-date');
if (roots.bound) {
  const raw = path.join(roots.storageAppRoot, 'data/intraday/raw');
  const relative = path.relative(raw, path.resolve(input || ''));
  if (!relative || relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) throw Error('DAILY_INPUT_REJECTED');
  assertPlainLocalPath(path.resolve(input), false);
}
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) {
  console.error('Usage: node scripts/build-taifex-replay.mjs --input <csv> --trade-date YYYY-MM-DD');
  process.exit(2);
}

const result = await aggregateTaifexTxCsv(path.resolve(input), { tradeDate });
const archiveDir = dataPath('data', 'intraday', 'archive');
for (const [session, payload] of Object.entries(result.sessions)) atomicWrite(path.join(archiveDir, `${tradeDate}-${session}.json`), payload);
const day = result.sessions.day;
if (!day) throw new Error('TAIFEX_TX_DAY_SESSION_NOT_FOUND');
const imported = importFiveMinuteBars(day, dataPath('data', 'intraday', 'replay-bars.json'), { allowHistorical: true });
if (!imported.ok) throw new Error(`TAIFEX_REPLAY_REJECTED: ${imported.errors.join(', ')}`);
atomicWrite(dataPath('data', 'intraday', 'taifex-replay-status.json'), {
  state: 'ready', generatedAt: new Date().toISOString(), tradeDate, sourceFile: path.basename(input),
  acceptedTicks: result.acceptedTicks, malformedTicks: result.malformedTicks, malformedExamples: result.malformedExamples, excludedNonOutrightRows: result.excludedNonOutrightRows, excludedSpreadRows: result.excludedSpreadRows, contracts: result.contracts,
  sessions: Object.fromEntries(Object.entries(result.sessions).map(([key, value]) => [key, { contract: value.contract, ticks: value.tickCount, bars: value.barCount, volume: value.bars.reduce((sum, bar) => sum + bar.volume, 0), firstTimestamp: value.firstTimestamp, lastTimestamp: value.lastTimestamp }])),
  replaySession: 'day', executionAuthorized: false,
});
console.log(JSON.stringify({ state: 'ready', tradeDate, acceptedTicks: result.acceptedTicks, malformedTicks: result.malformedTicks, malformedExamples: result.malformedExamples, excludedNonOutrightRows: result.excludedNonOutrightRows, excludedSpreadRows: result.excludedSpreadRows, sessions: Object.fromEntries(Object.entries(result.sessions).map(([key, value]) => [key, { contract: value.contract, bars: value.barCount, ticks: value.tickCount }])) }, null, 2));

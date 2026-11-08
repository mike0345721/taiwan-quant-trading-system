import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';

import { dailyStorageRoots } from '../src/daily-storage-binding.mjs';

const roots = dailyStorageRoots();
const dataPath = (...parts) => path.resolve(roots.bound ? roots.storageAppRoot : process.cwd(), ...parts);
if (roots.bound) {
  const args = process.argv.slice(2);
  const allowed = new Set(['--trade-date']);
  if (args.length !== allowed.size * 2 || args.some((arg, i) => i % 2 === 0 && !allowed.delete(arg))) throw Error('DAILY_ARGUMENT_REJECTED');
}
function argument(name) { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : null; }
function finite(value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); }
function same(left, right) { return finite(left) && finite(right) && Math.abs(Number(left) - Number(right)) < 1e-9; }
function atomicWrite(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temp = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(temp, filePath); }

const tradeDate = argument('--trade-date');
if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) {
  console.error('Usage: node scripts/audit-taifex-replay.mjs --trade-date YYYY-MM-DD');
  process.exit(2);
}

const replayPath = dataPath('data', 'intraday', 'archive', `${tradeDate}-day.json`);
if (!fs.existsSync(replayPath)) throw new Error('TAIFEX_REPLAY_DAY_ARCHIVE_NOT_FOUND');
const replay = JSON.parse(fs.readFileSync(replayPath, 'utf8'));
const bars = replay.bars || [];
if (!bars.length) throw new Error('TAIFEX_REPLAY_DAY_BARS_EMPTY');
const nightPath = dataPath('data', 'intraday', 'archive', `${tradeDate}-night.json`);
if (!fs.existsSync(nightPath)) throw new Error('TAIFEX_REPLAY_NIGHT_ARCHIVE_NOT_FOUND');
const nightReplay = JSON.parse(fs.readFileSync(nightPath, 'utf8'));
const nightBars = nightReplay.bars || [];
if (!nightBars.length) throw new Error('TAIFEX_REPLAY_NIGHT_BARS_EMPTY');
const calculated = {
  open: Number(bars[0].open), high: Math.max(...bars.map((bar) => Number(bar.high))), low: Math.min(...bars.map((bar) => Number(bar.low))),
  close: Number(bars.at(-1).close), sessionVolume: bars.reduce((sum, bar) => sum + Number(bar.volume), 0),
  bars: bars.length,
};

const db = new DatabaseSync(dataPath('v2', 'data', 'research-v2.sqlite'), { readOnly: true });
let official;
let officialRows;
try {
  db.exec('PRAGMA query_only = ON;');
  officialRows = db.prepare(`SELECT trade_date, contract, session, open, high, low, close, volume, is_active
    FROM futures_contract_daily WHERE trade_date=? AND product='TX' AND contract=?`).all(tradeDate, replay.contract);
  official = officialRows.find((row) => row.is_active === 1) || officialRows[0];
} finally { db.close(); }
if (!official) throw new Error('OFFICIAL_ACTIVE_TX_DAILY_ROW_NOT_FOUND');

const checks = Object.fromEntries(['open', 'high', 'low', 'close'].map((key) => [key, { pass: same(calculated[key], official[key]), replay: calculated[key], official: Number(official[key]) }]));
checks.daySessionCoverage = {
  pass: bars.length === 60 && bars[0]?.timestamp?.slice(11, 16) === '00:45' && bars.at(-1)?.timestamp?.slice(11, 16) === '05:40',
  bars: bars.length, firstTimestamp: bars[0]?.timestamp || null, lastTimestamp: bars.at(-1)?.timestamp || null,
  expected: '60 bars, 08:45-13:40 Asia/Taipei',
};
checks.nightSessionCoverage = {
  pass: nightBars.length >= 160 && nightBars[0]?.timestamp?.slice(11, 16) === '07:00' && nightBars.at(-1)?.timestamp?.slice(11, 16) === '20:55',
  bars: nightBars.length, firstTimestamp: nightBars[0]?.timestamp || null, lastTimestamp: nightBars.at(-1)?.timestamp || null,
  coveragePct: Math.round(nightBars.length / 168 * 10_000) / 100,
  expected: 'at least 95% of 168 intervals, spanning 15:00-04:55 Asia/Taipei; zero-trade intervals are not fabricated',
};
checks.contractConsistency = {
  pass: Boolean(replay.contract && nightReplay.contract && replay.contract === nightReplay.contract),
  dayContract: replay.contract || null, nightContract: nightReplay.contract || null,
};
checks.volume = {
  pass: calculated.sessionVolume <= Number(official.volume), exactComparable: false,
  replayOutrightDaySession: calculated.sessionVolume, officialIncludingSpreadAndBlock: Number(official.volume),
  difference: Number(official.volume) - calculated.sessionVolume,
};
const pass = Object.values(checks).every((item) => item.pass);
const report = {
  schemaVersion: '1.0.0', state: pass ? 'passed_with_scope_warning' : 'failed', generatedAt: new Date().toISOString(), tradeDate,
  product: 'TX', contract: replay.contract, session: 'day', source: replay.provider,
  checks, bars: calculated.bars, nightBars: nightBars.length, sessionVolume: calculated.sessionVolume,
  volumeScope: 'tick replay contains outright non-block trades; official daily volume also includes spread and block trades, so only a containment check is valid', executionAuthorized: false,
  officialCandidates: officialRows,
};
atomicWrite(dataPath('data', 'intraday', 'taifex-replay-audit.json'), report);
atomicWrite(dataPath('data', 'intraday', 'archive', `${tradeDate}-audit.json`), report);
console.log(JSON.stringify(report, null, 2));
if (!pass) process.exit(1);

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';

import { atomicWriteJson } from '../src/restartable-research-runner.mjs';

const root = path.resolve(import.meta.dirname, '..');
const inputDir = path.resolve(root, process.argv[2] || 'data/intraday/paid-staging/202601-06-inner-zips');
const archiveDir = path.resolve(root, process.argv[3] || 'data/intraday/archive');
const outputPath = path.resolve(root, process.argv[4] || 'research/pp1-v1/opening-close-evidence.json');

function localTimestamp(date, time) {
  const padded = time.padStart(6, '0');
  return new Date(`${date.slice(0,4)}-${date.slice(4,6)}-${date.slice(6,8)}T${padded.slice(0,2)}:${padded.slice(2,4)}:${padded.slice(4,6)}+08:00`);
}
function sessionBounds(sessionType, first, last) {
  const firstDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(first);
  const lastDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(last);
  if (sessionType === 'DAY') return [new Date(`${firstDate}T08:45:00+08:00`), new Date(`${lastDate}T13:45:00+08:00`)];
  const start = new Date(`${firstDate}T15:00:00+08:00`);
  const lastTaipeiHour = Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', hourCycle: 'h23' }).format(last));
  const endDate = lastTaipeiHour < 8 ? lastDate : new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(last.getTime() + 86_400_000));
  return [start, new Date(`${endDate}T05:00:00+08:00`)];
}
async function scan(file) {
  const match = file.match(/^Daily_(\d{4})_(\d{2})_(\d{2})\.zip$/);
  const tradeDate = `${match[1]}-${match[2]}-${match[3]}`;
  const archive = JSON.parse(fs.readFileSync(path.join(archiveDir, `${tradeDate}-day.json`), 'utf8'));
  const contract = archive.contract;
  const child = spawn('tar', ['-xOf', path.join(inputDir, file)], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.setEncoding('utf8'); child.stderr.on('data', (chunk) => { stderr += chunk; });
  const states = { DAY: { first: null, firstAuction: false, last: null }, NIGHT: { first: null, firstAuction: false, last: null } };
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
  let header = true;
  for await (const line of lines) {
    if (header) { header = false; continue; }
    if (!line.includes(',TX')) continue;
    const c = line.split(',');
    if (c.length < 9 || c[1].trim() !== 'TX' || c[2].trim() !== contract || c[2].includes('/') || !/^\d+(?:\.\d+)?$/.test(c[4].trim())) continue;
    const date = c[0].trim(); const time = c[3].trim().padStart(6,'0');
    if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(time)) continue;
    const hhmm = Number(time.slice(0,4)); const sessionType = hhmm >= 845 && hhmm <= 1345 ? 'DAY' : 'NIGHT';
    const timestamp = localTimestamp(date,time); const state = states[sessionType];
    if (!state.first || timestamp < state.first) { state.first = timestamp; state.firstAuction = c[8].trim() === '*'; }
    if (!state.last || timestamp > state.last) state.last = timestamp;
  }
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  if (exitCode !== 0) throw new Error(`PP1_RAW_ZIP_SCAN_FAILED:${file}:${stderr.trim()}`);
  const rows = [];
  for (const sessionType of ['DAY','NIGHT']) {
    const state = states[sessionType]; if (!state.first || !state.last) continue;
    const [start,end] = sessionBounds(sessionType,state.first,state.last);
    rows.push({ tradeDate, sessionType, contractCode: contract, firstExchangeTimestamp: state.first.toISOString(), openingAuctionAtSessionStart: state.firstAuction && state.first.getTime() === start.getTime(), openingDelaySeconds: (state.first-start)/1000, lastExchangeTimestamp: state.last.toISOString(), closeAgeSeconds: (end-state.last)/1000, sourceArchive: file });
  }
  return rows;
}

async function main() {
  const files = fs.readdirSync(inputDir).filter((name) => /^Daily_\d{4}_\d{2}_\d{2}\.zip$/.test(name)).sort();
  const rows = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(4, files.length) }, async () => {
    while (cursor < files.length) {
      const index = cursor; cursor += 1;
      rows.push(...await scan(files[index]));
    }
  });
  await Promise.all(workers);
  rows.sort((a,b) => `${a.tradeDate}-${a.sessionType}`.localeCompare(`${b.tradeDate}-${b.sessionType}`));
  atomicWriteJson(outputPath, { schemaVersion: 'pp1-opening-close-evidence-v1', generatedAt: new Date().toISOString(), sourceType: 'TAIFEX_PAID_RAW_TICK_ARCHIVE', filesScanned: files.length, tradeDates: new Set(rows.map((row) => row.tradeDate)).size, rows });
  console.log(JSON.stringify({ outputPath, filesScanned: files.length, tradeDates: new Set(rows.map((row) => row.tradeDate)).size, rows: rows.length }, null, 2));
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });

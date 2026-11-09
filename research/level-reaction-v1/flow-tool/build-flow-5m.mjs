// build-flow-5m.mjs — research only, read-only on source data.
// Converts TAIFEX official TX tick files (Daily_YYYY_MM_DD.zip, and the 202601-06.tgz bundle)
// into 5-minute bars with tick-rule buy/sell volume. Tick rule is a PROXY: TAIFEX tick files
// carry no aggressor side and no bid/ask. Trade dates on/after --before are refused (holdout).
// Usage: node build-flow-5m.mjs [--raw-dir DIR] [--tgz FILE] [--out DIR] [--before YYYY-MM-DD]
import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SELF = fileURLToPath(import.meta.url);
const HERE = path.dirname(SELF);
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const RAW_DIR = opt('--raw-dir', 'D:\\Taiwan stock\\standalone-v1\\data\\intraday\\raw');
const TGZ = opt('--tgz', 'D:\\Taiwan stock\\standalone-v1\\歷史期貨簡檔\\202601-06.tgz');
const OUT = opt('--out', path.join(HERE, 'out'));
const BEFORE = opt('--before', '2026-09-01');
const TMP = path.join(OUT, '_tmp');

export function sessionOf(time) { const hhmm = Number(String(time).padStart(6, '0').slice(0, 4)); return hhmm >= 845 && hhmm <= 1345 ? 'day' : 'night'; }
export function bucketOf(date, time) {
  const raw = String(time).padStart(6, '0'); const hour = Number(raw.slice(0, 2)); const m = Number(raw.slice(2, 4));
  const dayClose = hour === 13 && m === 45, nightClose = hour === 5 && m === 0;
  const h = nightClose ? 4 : hour, mm = dayClose ? 40 : nightClose ? 55 : Math.floor(m / 5) * 5;
  return new Date(`${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}T${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00+08:00`).toISOString();
}

// Parse one TAIFEX daily CSV. Returns { tradeDate, contract, sessions:{day,night}, stats }.
export async function parseCsv(file) {
  const streams = new Map(); let dates = new Set(); let n = 0, malformed = 0, auction = 0;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: 'latin1' }), crlfDelay: Infinity });
  let first = true;
  for await (const line of rl) {
    if (first) { first = false; continue; }
    if (!line) continue;
    const c = line.split(',');
    if (c.length < 6 || c[1]?.trim() !== 'TX') continue;
    const date = c[0].trim(), contract = c[2].trim(), time = c[3].trim();
    if (contract.includes('/')) continue;
    const price = Number(c[4]), qty = Number(c[5]);
    if (!/^\d{8}$/.test(date) || !/^\d{6}$/.test(contract) || !/^\d{5,6}$/.test(time) || !Number.isFinite(price) || !Number.isFinite(qty) || qty < 0) { malformed++; continue; }
    const isAuction = (c[8] ?? '').trim() === '*';
    const session = sessionOf(time), key = `${contract}|${session}`;
    if (!streams.has(key)) streams.set(key, { contract, session, volume: 0, last: null, sign: 0, bars: new Map() });
    const s = streams.get(key); const vol = qty / 2; s.volume += vol; n++;
    let sign = 0;
    if (isAuction) { auction++; } else {
      if (s.last !== null) sign = price > s.last ? 1 : price < s.last ? -1 : s.sign;
      s.last = price; s.sign = sign;
    }
    const ts = bucketOf(date, time);
    let b = s.bars.get(ts);
    if (!b) { b = { timestamp: ts, open: price, high: price, low: price, close: price, volume: 0, buyVol: 0, sellVol: 0, unknownVol: 0, ticks: 0 }; s.bars.set(ts, b); }
    b.high = Math.max(b.high, price); b.low = Math.min(b.low, price); b.close = price; b.volume += vol; b.ticks++;
    if (sign > 0) b.buyVol += vol; else if (sign < 0) b.sellVol += vol; else b.unknownVol += vol;
    if (session === 'day') dates.add(date);
  }
  const dayLeader = [...streams.values()].filter(s => s.session === 'day').sort((a, b) => b.volume - a.volume)[0];
  const contract = dayLeader?.contract ?? null;
  const tradeDate = dates.size ? [...dates].sort().at(-1) : null;
  const sessions = {};
  for (const sess of ['day', 'night']) {
    const s = streams.get(`${contract}|${sess}`);
    sessions[sess] = s ? [...s.bars.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp)) : [];
  }
  return { tradeDate: tradeDate && `${tradeDate.slice(0, 4)}-${tradeDate.slice(4, 6)}-${tradeDate.slice(6, 8)}`, contract, sessions, stats: { ticks: n, malformed, auction } };
}

function walk(dir) { const out = []; for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) out.push(...walk(p)); else out.push(p); } return out; }
function extract(archive, dest) {
  fs.mkdirSync(dest, { recursive: true });
  try { execFileSync('tar', ['-xf', archive, '-C', dest], { stdio: 'ignore' }); return; } catch {}
  if (process.platform !== 'win32') { execFileSync('unzip', ['-q', '-o', archive, '-d', dest], { stdio: 'ignore' }); return; }
  execFileSync('powershell', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath '${archive.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`], { stdio: 'ignore' });
}
const dateFromName = f => { const m = path.basename(f).match(/(\d{4})_(\d{2})_(\d{2})/); return m ? `${m[1]}-${m[2]}-${m[3]}` : null; };

async function processZip(zip, done, log) {
  const d = dateFromName(zip);
  if (d && (d >= BEFORE || done.has(d))) return;
  const tmp = path.join(TMP, 'z_' + path.basename(zip).replace(/\W/g, '_'));
  try {
    extract(zip, tmp);
    const csv = walk(tmp).find(f => f.toLowerCase().endsWith('.csv'));
    if (!csv) { log.push({ zip, error: 'NO_CSV' }); return; }
    await processCsv(csv, done, log, zip);
  } catch (e) { log.push({ zip, error: String(e.message || e) }); }
  finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
async function processCsv(csv, done, log, src = csv) {
  const r = await parseCsv(csv);
  if (!r.tradeDate) { log.push({ src, error: 'NO_TX_DAY_SESSION' }); return; }
  if (r.tradeDate >= BEFORE) { log.push({ src, tradeDate: r.tradeDate, refused: 'HOLDOUT' }); return; }
  if (done.has(r.tradeDate)) return;
  fs.writeFileSync(path.join(OUT, `${r.tradeDate}-flow.json`), JSON.stringify({ schemaVersion: 'flow-5m-v1', tradeDate: r.tradeDate, contract: r.contract, side: 'TICK_RULE_PROXY_NOT_AGGRESSOR', source: path.basename(src), stats: r.stats, day: r.sessions.day, night: r.sessions.night }));
  done.add(r.tradeDate);
  log.push({ src: path.basename(src), tradeDate: r.tradeDate, contract: r.contract, dayBars: r.sessions.day.length, nightBars: r.sessions.night.length, ...r.stats });
  console.log(`${r.tradeDate} ${r.contract} day ${r.sessions.day.length} night ${r.sessions.night.length} ticks ${r.stats.ticks}`);
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true }); fs.rmSync(TMP, { recursive: true, force: true }); fs.mkdirSync(TMP, { recursive: true });
  const done = new Set(fs.readdirSync(OUT).map(f => f.match(/^(\d{4}-\d{2}-\d{2})-flow\.json$/)?.[1]).filter(Boolean));
  const log = []; const t0 = Date.now();
  console.log(`output: ${OUT}\nalready done: ${done.size} days\nholdout refused from: ${BEFORE}`);
  if (fs.existsSync(RAW_DIR)) {
    const zips = fs.readdirSync(RAW_DIR).filter(f => /^Daily_\d{4}_\d{2}_\d{2}\.zip$/i.test(f)).sort().map(f => path.join(RAW_DIR, f));
    console.log(`raw zips: ${zips.length}`);
    for (const z of zips) await processZip(z, done, log);
  } else console.log('raw dir not found: ' + RAW_DIR);
  if (fs.existsSync(TGZ)) {
    console.log('extracting bundle (this can take several minutes): ' + TGZ);
    const tmp = path.join(TMP, 'bundle');
    try {
      extract(TGZ, tmp);
      const files = walk(tmp).sort();
      for (const f of files) {
        if (/\.zip$/i.test(f)) await processZip(f, done, log);
        else if (/\.csv$/i.test(f)) { const d = dateFromName(f); if (!d || (d < BEFORE && !done.has(d))) await processCsv(f, done, log); }
      }
    } catch (e) { log.push({ bundle: TGZ, error: String(e.message || e) }); }
    finally { fs.rmSync(tmp, { recursive: true, force: true }); }
  } else console.log('bundle not found: ' + TGZ);
  fs.rmSync(TMP, { recursive: true, force: true });
  const summary = { finishedAt: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000), before: BEFORE, days: done.size, errors: log.filter(x => x.error).length, log };
  fs.writeFileSync(path.join(OUT, '_summary.json'), JSON.stringify(summary, null, 1));
  console.log(`\nDONE. days written: ${done.size}, errors: ${summary.errors}. You can close this window.`);
}
if (process.argv[1] && path.resolve(process.argv[1]).toLowerCase() === SELF.toLowerCase()) main();

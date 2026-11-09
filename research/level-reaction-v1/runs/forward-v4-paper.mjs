// V4 trend-following forward PAPER tracker. Research only: never sends orders.
// Uses the frozen V4 code (trend-volume-v4.mjs) unchanged. Rules added for forward tracking only:
//  - forward start 2026-11-09 (Taipei); the book is flat at the start; no trade entered before it is simulated or stored
//  - archive days before 2026-10-15 are not loaded; 10/15..11/08 bars are used only as indicator warm-up
//  - closed trades are appended once to an append-only, hash-chained ledger; each run also appends a run record
// Usage: node forward-v4-paper.mjs --archive <dir> --out <dir> [--start 2026-11-09] [--load-from 2026-10-15]
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { loadArchive, buildHourly, simulateFrom, TREND_SPEC, TREND_SPEC_HASH } from './trend-volume-v4.mjs';
import { loadCostPolicy } from '../../../src/level-reaction-study.mjs';

export const EXPECTED_SPEC_HASH = '4f8234e468e2284b1d15f701e3024966d3a2e7439898f389b17ab9a35e2433ed';
const args = process.argv.slice(2);
const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };

export function forwardTrades(bars, policy, startMs) {
  const trades = []; let busyUntil = -1;
  for (let i = 1; i < bars.length; i++) {
    if (bars[i].t < startMs) continue;
    const s = bars[i - 1];
    const ok = s.hh != null && s.atr != null && s.atrPct != null && s.atrPct >= 1 / 3 && bars[i].seg === s.seg;
    if (i <= busyUntil || !ok) continue;
    const dir = s.close > s.hh ? 1 : s.close < s.ll ? -1 : 0;
    if (!dir) continue;
    const t = simulateFrom(bars, i, dir, policy); if (!t) continue;
    trades.push(t); busyUntil = t.exitIndex;
  }
  return trades;
}

function currentStop(bars, t) { // display only: same trailing rule as the frozen code
  let stop = t.entry - t.dir * t.risk, ext = t.entry;
  for (let j = t.i; j <= t.exitIndex; j++) {
    const b = bars[j];
    ext = t.dir > 0 ? Math.max(ext, b.high) : Math.min(ext, b.low);
    if (b.atr) { const tr = ext - t.dir * TREND_SPEC.chandelierAtr * b.atr; stop = t.dir > 0 ? Math.max(stop, tr) : Math.min(stop, tr); }
  }
  return stop;
}

const h = s => crypto.createHash('sha256').update(s).digest('hex');
function readLedger(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : []; }
function append(file, rows, rec) {
  const prev = rows.at(-1)?.hash ?? null; const seq = rows.length + 1;
  const body = { seq, ...rec, prevHash: prev, researchOnly: true, executionAuthorized: false };
  const full = { ...body, hash: h(JSON.stringify(body)) };
  fs.appendFileSync(file, JSON.stringify(full) + '\n'); rows.push(full); return full;
}
export function verifyLedger(rows) { let prev = null; for (const r of rows) { const { hash, ...body } = r; if (r.prevHash !== prev || h(JSON.stringify(body)) !== hash) return false; prev = hash; } return true; }

export function runForward({ archive, out, start = '2026-11-09', loadFrom = '2026-10-15', policy = loadCostPolicy(), now = new Date() }) {
  if (TREND_SPEC_HASH !== EXPECTED_SPEC_HASH) throw new Error('V4_SPEC_CHANGED');
  fs.mkdirSync(out, { recursive: true });
  const sessions = loadArchive(archive.endsWith(path.sep) || archive.endsWith('/') ? archive : archive + path.sep, '9999-12-31').filter(s => s.tradeDate >= loadFrom);
  const bars = buildHourly(sessions);
  const startMs = Date.parse(`${start}T00:00:00+08:00`);
  const trades = forwardTrades(bars, policy, startMs);
  const ledgerFile = path.join(out, 'forward-v4-ledger.jsonl');
  const rows = readLedger(ledgerFile);
  if (!verifyLedger(rows)) throw new Error('LEDGER_HASH_CHAIN_BROKEN');
  const known = new Set(rows.filter(r => r.type === 'trade_closed').map(r => r.entryTime));
  let added = 0;
  for (const t of trades.filter(t => t.reason !== 'DATA_END')) {
    const entryTime = new Date(t.t).toISOString();
    if (known.has(entryTime)) continue;
    append(ledgerFile, rows, { type: 'trade_closed', recordedAt: now.toISOString(), specHash: TREND_SPEC_HASH, entryTime, exitTime: new Date(bars[t.exitIndex].t).toISOString(), contract: bars[t.i].contract,
      direction: t.dir > 0 ? 'LONG' : 'SHORT', entry: t.entry, exit: t.exit, exitReason: t.reason, riskPoints: +t.risk.toFixed(2), rGross: +t.rGross.toFixed(4), rNetTX: +t.rNet.toFixed(4), rNetMTX: +t.rNetMTX.toFixed(4), rNetTMF: +t.rNetTMF.toFixed(4), holdHours: t.hours });
    added++;
  }
  const open = trades.find(t => t.reason === 'DATA_END');
  const closed = rows.filter(r => r.type === 'trade_closed');
  const sum = closed.reduce((s, r) => s + r.rNetTX, 0);
  const status = {
    schemaVersion: 'forward-v4-status-v1', generatedAt: now.toISOString(), specHash: TREND_SPEC_HASH, forwardStart: start,
    lastBar: bars.length ? new Date(bars.at(-1).t).toISOString() : null, lastTradeDate: sessions.at(-1)?.tradeDate ?? null,
    closedTrades: closed.length, targetTrades: 60, totalRNetTX: +sum.toFixed(3), meanRNetTX: closed.length ? +(sum / closed.length).toFixed(3) : null,
    winRate: closed.length ? +(closed.filter(r => r.rNetTX > 0).length / closed.length).toFixed(3) : null,
    openPosition: open ? { direction: open.dir > 0 ? 'LONG' : 'SHORT', entryTime: new Date(open.t).toISOString(), entry: open.entry, currentStop: +currentStop(bars, open).toFixed(1), initialRiskPoints: +open.risk.toFixed(1), lastClose: bars.at(-1).close, openRGross: +(open.dir * (bars.at(-1).close - open.entry) / open.risk).toFixed(3) } : null,
    newClosedThisRun: added, ledgerRecords: rows.length + 1, researchOnly: true, executionAuthorized: false,
  };
  append(ledgerFile, rows, { type: 'run', recordedAt: now.toISOString(), lastTradeDate: status.lastTradeDate, closedTrades: status.closedTrades, openPosition: status.openPosition });
  fs.writeFileSync(path.join(out, 'forward-v4-status.json'), JSON.stringify(status, null, 1));
  return status;
}

if (process.argv[1]?.endsWith('forward-v4-paper.mjs')) {
  const archive = opt('--archive', 'D:\\Taiwan stock\\standalone-v1\\data\\intraday\\archive\\');
  const out = opt('--out', 'D:\\Taiwan stock\\standalone-v1\\data\\strategy-research\\forward-v4-20261109\\ledger');
  const s = runForward({ archive, out, start: opt('--start', '2026-11-09'), loadFrom: opt('--load-from', '2026-10-15') });
  console.log(`V4 paper tracker | data through ${s.lastTradeDate} | closed trades ${s.closedTrades}/60 | total ${s.totalRNetTX}R | open: ${s.openPosition ? `${s.openPosition.direction} @ ${s.openPosition.entry}, stop ${s.openPosition.currentStop}` : 'none'} | new this run ${s.newClosedThisRun}`);
}

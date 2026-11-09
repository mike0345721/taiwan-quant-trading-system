// V4 trend-following (60m, day+night continuous) and V5 volume-surge reaction study. Research only.
// Specs below are frozen before outcomes are read; see prereg-v4v5-2026-11-09.json.
import fs from 'node:fs';
import crypto from 'node:crypto';
import { calculateTradeCost } from '../../../src/t0-data-replay-gate.mjs';
import { loadCostPolicy, stableJson, holm } from '../../../src/level-reaction-study.mjs';

export const TREND_SPEC = Object.freeze({
  version: 'trend-60m-v4', barMinutes: 60, sessions: 'DAY+NIGHT continuous within one contract; indicators reset at contract change',
  entry: 'close beyond prior 20-bar Donchian high/low -> enter next bar open in breakout direction; one position at a time',
  channel: 20, atrPeriod: 14, initialStopAtr: 2, chandelierAtr: 3,
  trailing: 'long: max(stop, highest high since entry - 3*ATR) updated at each bar close; short mirrored',
  exits: 'gap through stop fills at bar open; else stop price; forced exit at last bar close before contract change',
  volFilter: 'skip entry when ATR14 is in the bottom third of its own prior 250 60m-bar values; no trades before 250 bars of history',
  instrument: 'TX', costView: 'BASE_2_TICKS_PER_SIDE', alsoReport: ['MTX', 'TMF'],
  control: 'same number of random entries (eligible bars, random direction), identical exits, 2000 draws; p = share of draws with mean net R >= observed',
  researchOnly: true, executionAuthorized: false,
});
export const SURGE_SPEC = Object.freeze({
  version: 'volume-surge-v5', bar: '5m', rvol: 'bar volume / median volume of the same clock slot over the prior 20 sessions of the same type (DAY or NIGHT)',
  eventThreshold: 3, controlMaxRvol: 1.5, direction: 'sign(close - open) of the surge bar; zero-body bars skipped',
  outcome: 'signed move from surge-bar close to close 12 bars later (60m), in units of ATR14 (5m, rolled across previous session); events without 12 later bars in the session are excluded',
  control: 'for each event, a random non-surge bar (RVOL<1.5) in the same session type, same hour bucket and same decile of |body|/ATR; 2000 draws',
  primary: 'mean signed outcome of surge events minus matched controls, two-sided permutation p (continuation if >0, reversal if <0)',
  secondary: ['30m horizon', 'TW day open (08:45-09:14 bars)', 'US cash open (first 15 min after 21:30 summer / 22:30 winter Taiwan time)', 'other times', 'tradable check: enter next bar open in surge direction, 1.5 ATR stop, 60m time exit, net R'],
  researchOnly: true, executionAuthorized: false,
});
const sha = o => crypto.createHash('sha256').update(stableJson(o)).digest('hex');
export const TREND_SPEC_HASH = sha(TREND_SPEC), SURGE_SPEC_HASH = sha(SURGE_SPEC);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
const median = a => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

export function loadArchive(dir, before = '2026-09-01') {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => /-(day|night)\.json$/.test(f)).sort()) {
    const d = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    if (d.tradeDate >= before) throw new Error('HOLDOUT ' + f);
    out.push({ tradeDate: d.tradeDate, session: d.session.toUpperCase(), contract: d.contract, bars: d.bars.map(b => ({ t: Date.parse(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })) });
  }
  return out.sort((a, b) => a.bars[0].t - b.bars[0].t);
}

// ---------------- V4 trend ----------------
function to60m(s) {
  const start = s.bars[0].t - ((s.bars[0].t / 60000 - (s.session === 'DAY' ? 45 : 0)) % 60) * 60000; // align to :45 day / :00 night
  const g = new Map();
  for (const b of s.bars) {
    const k = Math.floor((b.t - start) / 3600000);
    const x = g.get(k);
    if (!x) g.set(k, { t: start + k * 3600000, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
    else { x.high = Math.max(x.high, b.high); x.low = Math.min(x.low, b.low); x.close = b.close; x.volume += b.volume; }
  }
  return [...g.values()].sort((a, b) => a.t - b.t).map(x => ({ ...x, contract: s.contract, session: s.session, tradeDate: s.tradeDate }));
}

export function buildHourly(sessions) {
  const bars = sessions.flatMap(to60m).sort((a, b) => a.t - b.t);
  // indicators per contract segment
  let seg = -1, prevContract = null;
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    if (b.contract !== prevContract) { seg++; prevContract = b.contract; }
    b.seg = seg;
  }
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    b.tr = p && p.seg === b.seg ? Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)) : b.high - b.low;
    let n = 0, s = 0; for (let j = i; j >= 0 && n < TREND_SPEC.atrPeriod && bars[j].seg === b.seg; j--, n++) s += bars[j].tr;
    b.atr = n === TREND_SPEC.atrPeriod ? s / n : null;
    let hh = -Infinity, ll = Infinity, m = 0;
    for (let j = i - 1; j >= 0 && m < TREND_SPEC.channel && bars[j].seg === b.seg; j--, m++) { hh = Math.max(hh, bars[j].high); ll = Math.min(ll, bars[j].low); }
    b.hh = m === TREND_SPEC.channel ? hh : null; b.ll = m === TREND_SPEC.channel ? ll : null;
    const hist = []; for (let j = i - 1; j >= 0 && hist.length < 250; j--) if (bars[j].atr != null) hist.push(bars[j].atr);
    b.atrPct = b.atr != null && hist.length === 250 ? hist.filter(x => x < b.atr).length / 250 : null;
    b.lastOfSeg = false;
  }
  for (let i = 0; i < bars.length; i++) bars[i].lastOfSeg = i === bars.length - 1 || bars[i + 1].seg !== bars[i].seg;
  return bars;
}

function costR(entry, exit, dir, risk, policy, ins = 'TX') {
  const c = calculateTradeCost({ instrument: ins, entryIndex: entry, exitIndex: exit, direction: dir > 0 ? 'LONG' : 'SHORT', slippageTicksPerSide: 2 }, policy);
  return c.netPnl / policy.instruments[ins].contractMultiplier / risk;
}

export function simulateFrom(bars, i, dir, policy) { // entry at bar i open, signal ATR from bar i-1
  const atr = bars[i - 1].atr; if (!(atr > 0) || bars[i].seg !== bars[i - 1].seg) return null;
  const entry = bars[i].open, risk = TREND_SPEC.initialStopAtr * atr;
  let stop = entry - dir * risk, ext = entry, exit = null, reason = null, j = i;
  for (; j < bars.length && bars[j].seg === bars[i].seg; j++) {
    const b = bars[j];
    if (j > i && (dir > 0 ? b.open <= stop : b.open >= stop)) { exit = b.open; reason = 'STOP_GAP'; break; }
    if (dir > 0 ? b.low <= stop : b.high >= stop) { exit = stop; reason = 'STOP'; break; }
    ext = dir > 0 ? Math.max(ext, b.high) : Math.min(ext, b.low);
    if (b.atr) { const trail = ext - dir * TREND_SPEC.chandelierAtr * b.atr; stop = dir > 0 ? Math.max(stop, trail) : Math.min(stop, trail); }
    if (b.lastOfSeg) { exit = b.close; reason = 'CONTRACT_END'; break; }
  }
  if (exit === null) { j = Math.min(j, bars.length - 1); exit = bars[j].close; reason = 'DATA_END'; }
  const gross = dir * (exit - entry) / risk;
  return { i, exitIndex: j, dir, entry, exit, reason, risk, rGross: gross, rNet: costR(entry, exit, dir, risk, policy), rNetMTX: costR(entry, exit, dir, risk, policy, 'MTX'), rNetTMF: costR(entry, exit, dir, risk, policy, 'TMF'), hours: j - i + 1, t: bars[i].t, tradeDate: bars[i].tradeDate };
}

export function runTrend(bars, policy, seed = 4) {
  const trades = []; let busyUntil = -1;
  const eligible = [];
  for (let i = 1; i < bars.length; i++) {
    const s = bars[i - 1];
    const ok = s.hh != null && s.atr != null && s.atrPct != null && s.atrPct >= 1 / 3 && bars[i].seg === s.seg;
    if (ok) eligible.push(i);
    if (i <= busyUntil || !ok) continue;
    const dir = s.close > s.hh ? 1 : s.close < s.ll ? -1 : 0;
    if (!dir) continue;
    const t = simulateFrom(bars, i, dir, policy); if (!t) continue;
    trades.push(t); busyUntil = t.exitIndex;
  }
  const rand = rng(seed); const obs = mean(trades.map(t => t.rNet)); let ge = 0; const ctrl = [];
  for (let d = 0; d < 2000; d++) {
    let s = 0, n = 0;
    while (n < trades.length) { const i = eligible[Math.floor(rand() * eligible.length)]; const t = simulateFrom(bars, i, rand() < 0.5 ? 1 : -1, policy); if (!t) continue; s += t.rNet; n++; }
    const m = s / n; ctrl.push(m); if (m >= obs) ge++;
  }
  let eq = 0, peak = 0, dd = 0; for (const t of trades) { eq += t.rNet; peak = Math.max(peak, eq); dd = Math.min(dd, eq - peak); }
  const wins = trades.filter(t => t.rNet > 0), losses = trades.filter(t => t.rNet <= 0);
  const sorted = [...trades].sort((a, b) => b.rNet - a.rNet);
  return {
    specHash: TREND_SPEC_HASH, hourlyBars: bars.length, n: trades.length, long: trades.filter(t => t.dir > 0).length, short: trades.filter(t => t.dir < 0).length,
    meanRNet: obs, meanRGross: mean(trades.map(t => t.rGross)), meanRNetMTX: mean(trades.map(t => t.rNetMTX)), meanRNetTMF: mean(trades.map(t => t.rNetTMF)),
    totalRNet: trades.reduce((s, t) => s + t.rNet, 0), winRate: wins.length / trades.length, avgWinR: mean(wins.map(t => t.rNet)), avgLossR: mean(losses.map(t => t.rNet)),
    maxDrawdownR: dd, top3ShareOfGrossWins: wins.length ? sorted.slice(0, 3).reduce((s, t) => s + t.rNet, 0) / wins.reduce((s, t) => s + t.rNet, 0) : null,
    medianHoldHours: median(trades.map(t => t.hours)), controlMeanRNet: mean(ctrl), pVsRandom: (1 + ge) / 2001,
    firstHalf: mean(trades.filter(t => t.tradeDate < '2026-05-01').map(t => t.rNet)), secondHalf: mean(trades.filter(t => t.tradeDate >= '2026-05-01').map(t => t.rNet)),
    nFirstHalf: trades.filter(t => t.tradeDate < '2026-05-01').length, reasons: trades.reduce((m, t) => (m[t.reason] = (m[t.reason] || 0) + 1, m), {}), trades,
  };
}

// ---------------- V5 volume surge ----------------
const US_DST = d => d >= '2026-03-08' && d < '2026-11-01';
function usOpenBucket(t) { const d = new Date(t).toISOString().slice(0, 10); const openMin = US_DST(d) ? 13 * 60 + 30 : 14 * 60 + 30; const m = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes(); return m >= openMin && m < openMin + 15; }
function twOpenBucket(t) { const m = new Date(t).getUTCHours() * 60 + new Date(t).getUTCMinutes(); return m >= 45 && m < 75; }

export function runSurge(sessions, policy, seed = 5) {
  const rand = rng(seed);
  const slotKey = (s, b) => `${s.session}:${new Date(b.t).getUTCHours()}:${new Date(b.t).getUTCMinutes()}`;
  const history = new Map(); // slot -> array of past volumes (by session)
  const rows = [];
  let prevBars = [];
  for (const s of sessions) {
    const bars = s.bars;
    const all = prevBars.concat(bars), off = prevBars.length;
    const atr = all.map((b, i) => i === 0 ? null : Math.max(b.high - b.low, Math.abs(b.high - all[i - 1].close), Math.abs(b.low - all[i - 1].close)));
    for (let i = 0; i < bars.length; i++) {
      const k = slotKey(s, bars[i]); const h = history.get(k) || [];
      const rv = h.length >= 20 ? bars[i].volume / median(h.slice(-20)) : null;
      let sum = 0, n = 0; for (let j = off + i; j > 0 && n < 14; j--, n++) sum += atr[j];
      const a = n === 14 ? sum / 14 : null;
      const body = bars[i].close - bars[i].open;
      if (rv != null && a > 0 && body !== 0) {
        const dir = Math.sign(body);
        const f12 = i + 12 < bars.length ? dir * (bars[i + 12].close - bars[i].close) / a : null;
        const f6 = i + 6 < bars.length ? dir * (bars[i + 6].close - bars[i].close) / a : null;
        rows.push({ tradeDate: s.tradeDate, session: s.session, i, t: bars[i].t, rv, a, dir, bodyAtr: Math.abs(body) / a, hour: new Date(bars[i].t).getUTCHours(), f12, f6, tw: s.session === 'DAY' && twOpenBucket(bars[i].t), us: s.session === 'NIGHT' && usOpenBucket(bars[i].t), sref: s });
      }
    }
    for (const b of bars) { const k = slotKey(s, b); if (!history.has(k)) history.set(k, []); history.get(k).push(b.volume); }
    prevBars = bars;
  }
  // body deciles over all rows
  const sortedBody = rows.map(r => r.bodyAtr).sort((a, b) => a - b);
  const lowerBound = x => { let lo = 0, hi = sortedBody.length; while (lo < hi) { const m = (lo + hi) >> 1; if (sortedBody[m] < x) lo = m + 1; else hi = m; } return lo; };
  const dec = x => Math.min(9, Math.floor(10 * lowerBound(x) / sortedBody.length));
  for (const r of rows) { r.dec = dec(r.bodyAtr); r.stratum = `${r.session}:${r.hour}:${r.dec}`; }
  const ctrlPool = new Map(); for (const r of rows) if (r.rv < SURGE_SPEC.controlMaxRvol) { if (!ctrlPool.has(r.stratum)) ctrlPool.set(r.stratum, []); ctrlPool.get(r.stratum).push(r); }
  const evaluate = (events, key) => {
    const pools = new Map([...ctrlPool].map(([k, v]) => [k, v.filter(c => c[key] != null).map(c => c[key])]));
    const ev = events.filter(e => e[key] != null && (pools.get(e.stratum) || []).length);
    if (!ev.length) return { n: 0 };
    const obs = mean(ev.map(e => e[key]));
    const evPools = ev.map(e => pools.get(e.stratum));
    const draws = [];
    for (let d = 0; d < 2000; d++) { let s = 0; for (const p of evPools) s += p[Math.floor(rand() * p.length)]; draws.push(s / ev.length); }
    const cm = mean(draws); const dev = Math.abs(obs - cm); const pTwo = (1 + draws.filter(x => Math.abs(x - cm) >= dev).length) / 2001;
    return { n: ev.length, days: new Set(ev.map(e => e.tradeDate)).size, meanSignedAtr: obs, controlMeanSignedAtr: cm, diff: obs - cm, pTwoSided: pTwo, continuationShare: ev.filter(e => e[key] > 0).length / ev.length };
  };
  const events = rows.filter(r => r.rv >= SURGE_SPEC.eventThreshold);
  const primary = evaluate(events, 'f12');
  const secondary = { h30m: evaluate(events, 'f6'), twOpen: evaluate(events.filter(e => e.tw), 'f12'), usOpen: evaluate(events.filter(e => e.us), 'f12'), other: evaluate(events.filter(e => !e.tw && !e.us), 'f12'), day: evaluate(events.filter(e => e.session === 'DAY'), 'f12'), night: evaluate(events.filter(e => e.session === 'NIGHT'), 'f12') };
  // tradable check (descriptive)
  const tr = [];
  for (const e of events) {
    const bars = e.sref.bars; if (e.i + 13 >= bars.length) continue;
    const entry = bars[e.i + 1].open, risk = 1.5 * e.a, stop = entry - e.dir * risk; let exit = null;
    for (let j = e.i + 1; j <= e.i + 12; j++) { const b = bars[j]; if (j > e.i + 1 && (e.dir > 0 ? b.open <= stop : b.open >= stop)) { exit = b.open; break; } if (e.dir > 0 ? b.low <= stop : b.high >= stop) { exit = stop; break; } }
    if (exit === null) exit = bars[e.i + 13].open;
    tr.push(costR(entry, exit, e.dir, risk, policy));
  }
  return { specHash: SURGE_SPEC_HASH, candidateBars: rows.length, surgeEvents: events.length, surgeShare: events.length / rows.length, primary, secondary, tradable: { n: tr.length, meanRNet: mean(tr), winRate: tr.filter(x => x > 0).length / tr.length } };
}

if (process.argv[1]?.endsWith('trend-volume-v4.mjs') && process.argv[2]) {
  const policy = loadCostPolicy();
  const sessions = loadArchive(process.argv[2]);
  const pre = JSON.parse(fs.readFileSync(new URL('./prereg-v4v5-2026-11-09.json', import.meta.url)));
  if (pre.trendSpecHash !== TREND_SPEC_HASH || pre.surgeSpecHash !== SURGE_SPEC_HASH) throw new Error('SPEC_CHANGED_AFTER_PREREG');
  const bars = buildHourly(sessions);
  const trend = runTrend(bars, policy);
  const surge = runSurge(sessions, policy);
  const { trades, ...trendSummary } = trend;
  fs.writeFileSync(new URL('./training-v4v5.json', import.meta.url), JSON.stringify({ trend: trendSummary, surge }, null, 1));
  fs.writeFileSync(new URL('./training-v4-trades.ndjson', import.meta.url), trades.map(t => JSON.stringify(t)).join('\n'));
  console.log(JSON.stringify({ trend: trendSummary, surge }, (k, v) => typeof v === 'number' ? +v.toFixed(4) : v, 1));
}

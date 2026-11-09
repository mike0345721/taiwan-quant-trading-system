// V6 multi-timeframe alignment study (5m / 15m / 30m / 60m / 240m). Research only, never sends orders.
// The spec is frozen (hashed) before any outcome is read. The same frozen code runs once on the development
// window (Jan-Aug 2026) and once on the holdout (tradeDate >= 2026-09-01). No parameter is changed between runs.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { calculateTradeCost } from '../../../src/t0-data-replay-gate.mjs';
import { loadCostPolicy, stableJson } from '../../../src/level-reaction-study.mjs';

export const MTF_SPEC = Object.freeze({
  version: 'mtf-alignment-v6',
  data: 'official TAIFEX 5m archive, TX, DAY and NIGHT sessions concatenated per contract; indicators reset at contract change',
  timeframesMin: [5, 15, 30, 60, 240],
  tfBars: 'session-anchored clock buckets (DAY from 08:45, NIGHT from 15:00); last bucket of a session may be partial; a bucket counts only after its last 5m bar has closed',
  direction: 'at the close of 5m bar i, for each timeframe: sign(close_i - EMA20 of that timeframe completed-bar closes); EMA seeded by SMA of first 20 bars of the contract segment',
  score: 'sum of the five directions (-5..+5); bars lacking any EMA or ATR are ineligible',
  event: 'onset of full alignment: |score_i| = 5 and score_{i-1} != score_i; direction = sign(score_i); one position at a time',
  entry: 'open of bar i+1 (same session required)',
  risk: '1.5 x ATR14 of 5m bars at bar i (true range rolled across sessions within contract)',
  exits: 'stop -1R, target +2R, time exit at close of bar i+12 (60 min) or the session last bar, whichever first; a bar touching both stop and target counts as stop; a later-bar open beyond stop/target fills at that open',
  instrument: 'TX', costView: '2 ticks slippage per side + commission + tax (repo cost policy)', alsoReport: ['MTX', 'TMF'],
  control: 'for each event, a random eligible bar of the same session type and same hour-from-session-start bucket, traded in the SAME direction as the event with identical exits; 2000 draws',
  primary: 'mean net R (TX) of events minus mean of matched controls; one-sided p = share of control draws with mean >= events mean; pass if p < 0.05 AND events mean net R > 0',
  secondary: ['win rate (net R > 0) events vs controls', 'dose response: every eligible bar traded in sign(score) direction, grouped by |score| 1..5 (overlapping, descriptive)', '5m-only onsets: 5m direction flips while the four higher timeframes are not all in that direction', 'split by DAY/NIGHT and LONG/SHORT', 'MTX and TMF costs'],
  holdoutStart: '2026-09-01', researchOnly: true, executionAuthorized: false,
});
export const MTF_SPEC_HASH = crypto.createHash('sha256').update(stableJson(MTF_SPEC)).digest('hex');

const DAY_START = 45, NIGHT_START = 15 * 60; // minutes from 00:00 Taipei
const DAY_END = 13 * 60 + 45, NIGHT_END = 5 * 60 + 24 * 60;
const tpeMin = t => { const d = new Date(t + 8 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// window: 'DEV' (tradeDate < holdoutStart) or 'HOLDOUT' (>= holdoutStart). Warm-up bars from the previous window are allowed
// for indicators only (events are taken only inside the window).
export function loadSessions(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => /-(day|night)\.json$/.test(f)).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out.push({ tradeDate: d.tradeDate, session: d.session.toUpperCase(), contract: d.contract, bars: d.bars.map(b => ({ t: Date.parse(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close })) });
  }
  return out.sort((a, b) => a.bars[0].t - b.bars[0].t);
}

export function buildBars(sessions) {
  const bars = [];
  let seg = -1, prev = null;
  sessions.forEach((s, si) => {
    if (s.contract !== prev) { seg++; prev = s.contract; }
    const start = s.session === 'DAY' ? DAY_START : NIGHT_START, end = s.session === 'DAY' ? DAY_END : NIGHT_END;
    s.bars.forEach((b, k) => {
      let m = tpeMin(b.t); if (s.session === 'NIGHT' && m < 12 * 60) m += 24 * 60;
      bars.push({ ...b, seg, sid: si, type: s.session, tradeDate: s.tradeDate, contract: s.contract, mFrom: m - start, mEnd: end - start, lastOfSession: k === s.bars.length - 1 });
    });
  });
  // ATR14 rolled within segment
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i], p = bars[i - 1];
    b.tr = p && p.seg === b.seg ? Math.max(b.high - b.low, Math.abs(b.high - p.close), Math.abs(b.low - p.close)) : b.high - b.low;
    let n = 0, s = 0; for (let j = i; j >= 0 && n < 14 && bars[j].seg === b.seg; j--, n++) s += bars[j].tr;
    b.atr = n === 14 ? s / 14 : null;
  }
  // EMA20 per timeframe on completed buckets
  const tfs = MTF_SPEC.timeframesMin;
  const st = tfs.map(() => ({ seg: -1, closes: [], ema: null }));
  for (let i = 0; i < bars.length; i++) {
    const b = bars[i];
    b.dirs = tfs.map((tf, k) => {
      const S = st[k];
      if (S.seg !== b.seg) { S.seg = b.seg; S.closes = []; S.ema = null; }
      const bucket = Math.floor(b.mFrom / tf), bucketEnd = Math.min((bucket + 1) * tf, b.mEnd);
      const complete = b.mFrom + 5 >= bucketEnd || b.lastOfSession;
      if (complete) {
        S.closes.push(b.close);
        if (S.closes.length === 20) S.ema = mean(S.closes);
        else if (S.closes.length > 20) S.ema = S.ema + (2 / 21) * (b.close - S.ema);
      }
      return S.ema == null ? null : Math.sign(b.close - S.ema);
    });
    b.eligible = b.atr != null && b.dirs.every(d => d != null) && !b.lastOfSession;
    b.score = b.eligible ? b.dirs.reduce((s, d) => s + d, 0) : null;
    b.hourBucket = `${b.type}:${Math.floor(b.mFrom / 60)}`;
  }
  return bars;
}

function costR(entry, exit, dir, risk, policy, ins) {
  const c = calculateTradeCost({ instrument: ins, entryIndex: entry, exitIndex: exit, direction: dir > 0 ? 'LONG' : 'SHORT', slippageTicksPerSide: 2 }, policy);
  return c.netPnl / policy.instruments[ins].contractMultiplier / risk;
}

export function simulate(bars, i, dir, policy) {
  const sig = bars[i], e = bars[i + 1];
  if (!sig.eligible || !e || e.sid !== sig.sid) return null;
  const risk = 1.5 * sig.atr, entry = e.open, stop = entry - dir * risk, tgt = entry + dir * 2 * risk;
  let exit = null, reason = null, j = i + 1;
  for (; j < bars.length && bars[j].sid === sig.sid; j++) {
    const b = bars[j];
    if (j > i + 1) {
      if (dir > 0 ? b.open <= stop : b.open >= stop) { exit = b.open; reason = 'STOP_GAP'; break; }
      if (dir > 0 ? b.open >= tgt : b.open <= tgt) { exit = b.open; reason = 'TARGET_GAP'; break; }
    }
    const hitS = dir > 0 ? b.low <= stop : b.high >= stop, hitT = dir > 0 ? b.high >= tgt : b.low <= tgt;
    if (hitS) { exit = stop; reason = 'STOP'; break; }
    if (hitT) { exit = tgt; reason = 'TARGET'; break; }
    if (j === i + 12 || b.lastOfSession) { exit = b.close; reason = j === i + 12 ? 'TIME' : 'SESSION_END'; break; }
  }
  if (exit == null) return null;
  return { i, exitIndex: j, dir, entry, exit, reason, risk, t: e.t, tradeDate: sig.tradeDate, type: sig.type,
    rGross: dir * (exit - entry) / risk, rNet: costR(entry, exit, dir, risk, policy, 'TX'), rNetMTX: costR(entry, exit, dir, risk, policy, 'MTX'), rNetTMF: costR(entry, exit, dir, risk, policy, 'TMF') };
}

const summ = ts => ({ n: ts.length, meanRNet: mean(ts.map(t => t.rNet)), winRate: ts.length ? ts.filter(t => t.rNet > 0).length / ts.length : null, meanRGross: mean(ts.map(t => t.rGross)) });

export function runMtf(bars, policy, { window, seed = 6 } = {}) {
  const inWin = b => window === 'HOLDOUT' ? b.tradeDate >= MTF_SPEC.holdoutStart : b.tradeDate < MTF_SPEC.holdoutStart;
  const events = []; let busy = -1;
  const pool = new Map();
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i];
    if (!b.eligible || !inWin(b)) continue;
    (pool.get(b.hourBucket) || pool.set(b.hourBucket, []).get(b.hourBucket)).push(i);
    if (i <= busy) continue;
    const p = bars[i - 1];
    if (Math.abs(b.score) === 5 && (!p.eligible || p.seg !== b.seg || p.score !== b.score)) {
      const t = simulate(bars, i, Math.sign(b.score), policy); if (!t) continue;
      events.push(t); busy = t.exitIndex;
    }
  }
  const obs = mean(events.map(t => t.rNet));
  const rand = rng(seed); let ge = 0; const ctrlMeans = [], ctrlWins = [];
  for (let d = 0; d < 2000; d++) {
    let s = 0, w = 0, n = 0;
    for (const ev of events) {
      const cand = pool.get(bars[ev.i].hourBucket);
      let t = null; for (let k = 0; k < 50 && !t; k++) t = simulate(bars, cand[Math.floor(rand() * cand.length)], ev.dir, policy);
      if (!t) continue; s += t.rNet; w += t.rNet > 0 ? 1 : 0; n++;
    }
    ctrlMeans.push(s / n); ctrlWins.push(w / n); if (s / n >= obs) ge++;
  }
  const p = (1 + ge) / 2001;
  // secondary: dose response (every eligible bar in window, direction sign(score))
  const dose = {};
  for (let i = 1; i < bars.length; i++) { const b = bars[i]; if (!b.eligible || !inWin(b) || b.score === 0) continue; const t = simulate(bars, i, Math.sign(b.score), policy); if (!t) continue; (dose[Math.abs(b.score)] ||= []).push(t); }
  // secondary: 5m-only onsets
  const only5 = []; busy = -1;
  for (let i = 1; i < bars.length; i++) {
    const b = bars[i], q = bars[i - 1]; if (!b.eligible || !inWin(b) || i <= busy || !q.eligible || q.seg !== b.seg) continue;
    if (b.dirs[0] !== 0 && b.dirs[0] !== q.dirs[0] && !b.dirs.slice(1).every(d => d === b.dirs[0])) { const t = simulate(bars, i, b.dirs[0], policy); if (t) { only5.push(t); busy = t.exitIndex; } }
  }
  return {
    specHash: MTF_SPEC_HASH, window, firstDate: bars.find(inWin)?.tradeDate, lastDate: [...bars].reverse().find(inWin)?.tradeDate,
    events: summ(events), long: summ(events.filter(t => t.dir > 0)), short: summ(events.filter(t => t.dir < 0)), day: summ(events.filter(t => t.type === 'DAY')), night: summ(events.filter(t => t.type === 'NIGHT')),
    meanRNetMTX: mean(events.map(t => t.rNetMTX)), meanRNetTMF: mean(events.map(t => t.rNetTMF)),
    controlMeanRNet: mean(ctrlMeans), controlWinRate: mean(ctrlWins), excessRNet: obs - mean(ctrlMeans), pOneSided: p,
    pass: p < 0.05 && obs > 0,
    reasons: events.reduce((m, t) => (m[t.reason] = (m[t.reason] || 0) + 1, m), {}),
    dose: Object.fromEntries(Object.entries(dose).map(([k, v]) => [k, summ(v)])), only5m: summ(only5),
    researchOnly: true, executionAuthorized: false,
  };
}

if (process.argv[1]?.endsWith('mtf-alignment-v6.mjs')) {
  const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const window = opt('--window', 'DEV');
  const dirs = opt('--archive').split(',');
  const sessions = dirs.flatMap(loadSessions);
  if (window === 'DEV' && sessions.some(s => s.tradeDate >= MTF_SPEC.holdoutStart)) throw new Error('HOLDOUT DATA PRESENT IN DEV RUN');
  const bars = buildBars(sessions);
  const r = runMtf(bars, loadCostPolicy(), { window });
  const out = opt('--out'); if (out) fs.writeFileSync(out, JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
}

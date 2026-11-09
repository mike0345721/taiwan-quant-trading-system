// V7 Shioaji order-flow confirmation study. Research only, never sends orders.
// Input: flow1m-YYYY-MM-DD.json files (build-flow-1m-shioaji.mjs) + official 5m archive (for the data-quality gate and
// higher-timeframe warm-up). Spec frozen (hashed) before outcomes are read. DEV = tradeDate < 2026-09-01, HOLDOUT = >=.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { calculateTradeCost } from '../../../src/t0-data-replay-gate.mjs';
import { loadCostPolicy, stableJson, holm } from '../../../src/level-reaction-study.mjs';

export const FLOW_SPEC = Object.freeze({
  version: 'orderflow-v7',
  data: 'Shioaji TX ticks (provider tick_type aggressor) and 5-level bid/ask, aggregated to 1m; dominant contract per session',
  qualityGate: 'a session is used only if captured TX volume is 90%-110% of the official 5m archive volume over the same 5m buckets AND the official archive has >= 95% of the session 5m buckets covered by captured ticks',
  bars5m: '5m bars built from 1m (Taipei clock buckets); ATR14 on 5m rolled across sessions within a contract (official archive used for warm-up when the Shioaji day is missing)',
  decisionPoints: 'every 5m bar close t in a usable session, from the 3rd 5m bar of the session, excluding the last 12 bars of the session',
  base: 'momentum move: m = close_t - close_(t-15min); a decision point qualifies if |m| >= 0.5 * ATR14_5m; base direction = sign(m)',
  features: {
    cvd15: '(aggressor buy volume - aggressor sell volume) / total volume over the last 15 minutes (tick_type)',
    book5: 'mean over bid/ask snapshots in the last 5 minutes of (sum top-5 bid volume - sum top-5 ask volume) / (sum both)',
  },
  confirmed: 'feature has the same sign as the base direction AND |feature| >= the DEV-window 67th percentile of |feature| at qualifying points (threshold computed from DEV features only, then frozen and reused on HOLDOUT)',
  opposed: 'feature has the opposite sign of the base direction (any magnitude)',
  trade: 'enter at the open of the next 1m bar in the base direction; stop 1.5 x ATR14_5m; target 2R; time exit 60 minutes; session end exit; exits checked on 1m bars, a bar touching both counts as stop; TX costs (2 ticks per side)',
  primary: {
    P1: 'cvd15: mean net R(confirmed) - mean net R(opposed)',
    P2: 'book5: mean net R(confirmed) - mean net R(opposed)',
    P3: '6-timeframe alignment incl. 1m (1,5,15,30,60,240; EMA20 direction as in V6; 5m+ from official archive closes rolled within contract, 1m EMA20 from Shioaji 1m closes reset each session): onsets of full alignment at 1m closes, one position at a time, vs same-hour same-direction random 1m entries (2000 draws), mean net R excess',
  },
  inference: 'P1/P2: one-sided p from 2000 within-day permutations of the feature among qualifying points (price paths fixed). P3: one-sided p vs matched controls. Holm across P1-P3. Pass = Holm-adjusted p < 0.05 and positive effect. Tradable flag additionally requires mean net R of confirmed (or aligned) trades > 0.',
  secondary: ['tick-count imbalance (buy ticks - sell ticks)/(all) over 15m', 'quote-classified CVD', 'basis lead (TX minus IX0001 change over 15m, DAY only)', '2330 aggressor flow 15m (DAY only)', 'DAY vs NIGHT', 'veto view: opposed vs all qualifying points', 'win rates'],
  holdoutStart: '2026-09-01', researchOnly: true, executionAuthorized: false,
});
export const FLOW_SPEC_HASH = crypto.createHash('sha256').update(stableJson(FLOW_SPEC)).digest('hex');

const TPE = 8 * 3600000;
const tpeMin = t => { const d = new Date(t + TPE); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
const tpeDate = t => new Date(t + TPE).toISOString().slice(0, 10);
const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const quantile = (a, q) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(q * s.length))]; };

// session key compatible with the official archive tradeDate: DAY -> date; NIGHT (15:00..05:00) -> tradeDate of the NEXT archive file.
export function sessionOfMinute(t) {
  const m = tpeMin(t);
  if (m >= 525 && m < 825) return { type: 'DAY', start: tpeDate(t) };
  if (m >= 900) return { type: 'NIGHT', start: tpeDate(t) };
  if (m < 300) return { type: 'NIGHT', start: tpeDate(t - 86400000) };
  return null;
}

export function loadArchive(dir) {
  const out = [];
  for (const f of fs.readdirSync(dir).filter(f => /-(day|night)\.json$/.test(f)).sort()) {
    const d = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    out.push({ tradeDate: d.tradeDate, session: d.session.toUpperCase(), contract: d.contract, bars: d.bars.map(b => ({ t: Date.parse(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })) });
  }
  return out.sort((a, b) => a.bars[0].t - b.bars[0].t);
}

// Load 1m flow files. window: 'DEV' or 'HOLDOUT'. DEV refuses holdout files.
export function loadFlow(dir, window) {
  const files = fs.readdirSync(dir).filter(f => /^flow1m-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
  const minutes = []; const ix = new Map(), st = new Map();
  for (const f of files) {
    const o = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
    const cols = o.txColumns;
    for (const r of o.tx) { const x = Object.fromEntries(cols.map((c, i) => [c, r[i]])); if (x.o == null || !(x.v > 0)) { if (x.ban > 0) minutes.push({ ...x, bookOnly: true }); continue; } minutes.push(x); }
    for (const [t, c] of o.ix0001) ix.set(t, c);
    for (const [t, c, v, bv, sv] of o.s2330) st.set(t, { c, v, bv, sv });
  }
  return { minutes, ix, st };
}

// Build per-session 1m arrays on the dominant contract, with archive tradeDate mapping.
export function buildSessions(flow, archive) {
  const arch = new Map(); // sessionStartKey -> archive session
  for (const s of archive) { const k = `${s.session}:${tpeDate(s.bars[0].t)}`; arch.set(k, s); }
  const groups = new Map();
  for (const x of flow.minutes) {
    const s = sessionOfMinute(x.t); if (!s) continue;
    const k = `${s.type}:${s.start}`; const g = groups.get(k) || { key: k, type: s.type, byC: new Map() }; groups.set(k, g);
    const c = g.byC.get(x.contract) || []; c.push(x); g.byC.set(x.contract, c);
  }
  const sessions = [];
  for (const g of groups.values()) {
    const a = arch.get(g.key); if (!a) continue;
    let best = null, bv = -1; for (const [c, arr] of g.byC) { const v = arr.reduce((s, x) => s + (x.v || 0), 0); if (v > bv) { bv = v; best = c; } }
    const mins = g.byC.get(best).sort((x, y) => x.t - y.t);
    // quality gate vs archive
    const bucketVol = new Map(); for (const x of mins) if (!x.bookOnly) { const b = x.t - (x.t % 300000); bucketVol.set(b, (bucketVol.get(b) || 0) + x.v); }
    let archV = 0, capV = 0, covered = 0;
    for (const b of a.bars) { archV += b.volume; const cv = bucketVol.get(b.t) || 0; capV += cv; if (cv > 0) covered++; }
    const volRatio = archV ? capV / archV : 0, coverage = a.bars.length ? covered / a.bars.length : 0;
    sessions.push({ key: g.key, type: g.type, tradeDate: a.tradeDate, contract: best, archContract: a.contract, mins: mins.filter(x => !x.bookOnly), book: mins, volRatio, coverage, usable: volRatio >= 0.9 && volRatio <= 1.1 && coverage >= 0.95, archive: a });
  }
  return sessions.sort((x, y) => x.archive.bars[0].t - y.archive.bars[0].t);
}

// ATR14 on official 5m bars rolled within contract (all archive sessions, so missing Shioaji days do not break warm-up).
export function atrMap(archive) {
  const m = new Map(); let prev = null, prevC = null; const trs = [];
  for (const s of archive) {
    if (s.contract !== prevC) { trs.length = 0; prev = null; prevC = s.contract; }
    for (const b of s.bars) { const tr = prev ? Math.max(b.high - b.low, Math.abs(b.high - prev.close), Math.abs(b.low - prev.close)) : b.high - b.low; trs.push(tr); if (trs.length > 14) trs.shift(); if (trs.length === 14) m.set(b.t, mean(trs)); prev = b; }
  }
  return m;
}

function costR(entry, exit, dir, risk, policy, ins = 'TX') {
  const c = calculateTradeCost({ instrument: ins, entryIndex: entry, exitIndex: exit, direction: dir > 0 ? 'LONG' : 'SHORT', slippageTicksPerSide: 2 }, policy);
  return c.netPnl / policy.instruments[ins].contractMultiplier / risk;
}

// simulate on 1m bars of one session starting at index k (entry at mins[k].o)
export function sim1m(mins, k, dir, risk, policy, maxMin = 60) {
  if (k >= mins.length) return null;
  const entry = mins[k].o, stop = entry - dir * risk, tgt = entry + dir * 2 * risk, tEnd = mins[k].t + maxMin * 60000;
  let exit = null, reason = null, j = k;
  for (; j < mins.length; j++) {
    const b = mins[j];
    if (b.t >= tEnd) { exit = mins[j - 1].c; reason = 'TIME'; j--; break; }
    if (j > k) { if (dir > 0 ? b.o <= stop : b.o >= stop) { exit = b.o; reason = 'STOP_GAP'; break; } if (dir > 0 ? b.o >= tgt : b.o <= tgt) { exit = b.o; reason = 'TARGET_GAP'; break; } }
    if (dir > 0 ? b.l <= stop : b.h >= stop) { exit = stop; reason = 'STOP'; break; }
    if (dir > 0 ? b.h >= tgt : b.l <= tgt) { exit = tgt; reason = 'TARGET'; break; }
  }
  if (exit == null) { j = mins.length - 1; exit = mins[j].c; reason = 'SESSION_END'; }
  return { exitIdx: j, entry, exit, reason, rGross: dir * (exit - entry) / risk, rNet: costR(entry, exit, dir, risk, policy) };
}

// decision points for P1/P2 and secondaries
export function decisionPoints(sessions, atr, flow, policy, inWin) {
  const pts = [];
  for (const s of sessions) {
    if (!s.usable || !inWin(s.tradeDate)) continue;
    const mins = s.mins; const idxByT = new Map(mins.map((x, i) => [x.t, i]));
    const bars5 = s.archive.bars; // decision at official 5m bar closes (timestamps), prices from Shioaji 1m
    for (let b = 2; b < bars5.length - 12; b++) {
      const t5 = bars5[b].t, tClose = t5 + 300000; const A = atr.get(t5); if (!(A > 0)) continue;
      const win = mins.filter(x => x.t >= tClose - 15 * 60000 && x.t < tClose); if (win.length < 5) continue;
      const lastIdx = idxByT.get(win.at(-1).t); const k = lastIdx + 1; if (k >= mins.length || mins[k].t < tClose) continue;
      const before = mins.filter(x => x.t < tClose - 15 * 60000).at(-1); if (!before) continue;
      const m = win.at(-1).c - before.c; if (Math.abs(m) < 0.5 * A) continue;
      const dir = Math.sign(m);
      const v = win.reduce((q, x) => q + x.v, 0), bv = win.reduce((q, x) => q + x.bv, 0), sv = win.reduce((q, x) => q + x.sv, 0);
      const bn = win.reduce((q, x) => q + x.bn, 0), sn = win.reduce((q, x) => q + x.sn, 0), qb = win.reduce((q, x) => q + x.qb, 0), qs = win.reduce((q, x) => q + x.qs, 0);
      const bw = s.book.filter(x => x.t >= tClose - 5 * 60000 && x.t < tClose && x.ban > 0);
      const nb = bw.reduce((q, x) => q + x.ban, 0);
      const book5 = nb ? bw.reduce((q, x) => q + x.imbSum, 0) / nb : null;
      let basis = null, s2330 = null;
      if (s.type === 'DAY') {
        const ixNow = flow.ix.get(win.at(-1).t), ixThen = flow.ix.get(before.t);
        if (ixNow != null && ixThen != null) basis = ((win.at(-1).c - before.c) - (ixNow - ixThen)) / A; // futures move not matched by index
        let b2 = 0, s2 = 0; for (const x of win) { const q = flow.st.get(x.t); if (q) { b2 += q.bv; s2 += q.sv; } } s2330 = b2 + s2 ? (b2 - s2) / (b2 + s2) : null;
      }
      const tr = sim1m(mins, k, dir, 1.5 * A, policy); if (!tr) continue;
      pts.push({ day: s.tradeDate + ':' + s.type, type: s.type, t: tClose, dir, cvd15: v ? (bv - sv) / v : null, cnt15: bn + sn ? (bn - sn) / (bn + sn) : null, qcvd15: qb + qs ? (qb - qs) / (qb + qs) : null, book5, basis, s2330, ...tr });
    }
  }
  return pts;
}

export function confirmTest(pts, feat, threshold, { perms = 2000, seed = 11 } = {}) {
  const use = pts.filter(p => p[feat] != null);
  const label = (p, f) => { const v = f * p.dir; return v > 0 && Math.abs(f) >= threshold ? 'C' : v < 0 ? 'O' : 'N'; };
  const stat = vals => { const c = [], o = []; use.forEach((p, i) => { const l = label(p, vals[i]); if (l === 'C') c.push(p.rNet); else if (l === 'O') o.push(p.rNet); }); return { diff: mean(c) - mean(o), c, o }; };
  const vals = use.map(p => p[feat]); const obs = stat(vals);
  const byDay = new Map(); use.forEach((p, i) => { (byDay.get(p.day) || byDay.set(p.day, []).get(p.day)).push(i); });
  const r = rng(seed); let ge = 0;
  for (let k = 0; k < perms; k++) {
    const pv = vals.slice();
    for (const idx of byDay.values()) { const sh = idx.map(i => vals[i]); for (let a = sh.length - 1; a > 0; a--) { const b = Math.floor(r() * (a + 1)); [sh[a], sh[b]] = [sh[b], sh[a]]; } idx.forEach((i, j) => { pv[i] = sh[j]; }); }
    if (stat(pv).diff >= obs.diff) ge++;
  }
  const w = a => a.length ? a.filter(x => x > 0).length / a.length : null;
  return { feature: feat, threshold, n: use.length, nConfirmed: obs.c.length, nOpposed: obs.o.length, meanConfirmed: mean(obs.c), meanOpposed: mean(obs.o), meanAll: mean(use.map(p => p.rNet)), winConfirmed: w(obs.c), winOpposed: w(obs.o), winAll: w(use.map(p => p.rNet)), diff: obs.diff, p: (1 + ge) / (perms + 1) };
}

// P3: 6-TF alignment incl. 1m
export function runAlign6(sessions, archive, policy, inWin, seed = 13) {
  // higher-TF EMA20 directions from official archive (5,15,30,60,240) at each 5m close; reuse V6 logic
  const tfs = [5, 15, 30, 60, 240]; const st = tfs.map(() => ({ c: null, closes: [], ema: null }));
  const emaAt = new Map(); // 5m bar t -> [ema per tf]
  for (const s of archive) {
    const start = s.session === 'DAY' ? 45 : 900, end = s.session === 'DAY' ? 825 : 1740;
    s.bars.forEach((b, k) => {
      let m = tpeMin(b.t); if (s.session === 'NIGHT' && m < 720) m += 1440; const mFrom = m - start;
      const e = tfs.map((tf, i) => { const S = st[i]; if (S.c !== s.contract) { S.c = s.contract; S.closes = []; S.ema = null; }
        const bucketEnd = Math.min((Math.floor(mFrom / tf) + 1) * tf, end - start);
        if (mFrom + 5 >= bucketEnd || k === s.bars.length - 1) { S.closes.push(b.close); if (S.closes.length === 20) S.ema = mean(S.closes); else if (S.closes.length > 20) S.ema += (2 / 21) * (b.close - S.ema); }
        return S.ema; });
      emaAt.set(b.t, e);
    });
  }
  const events = [], pool = new Map();
  const dirsAll = [];
  for (const s of sessions) {
    if (!s.usable || !inWin(s.tradeDate)) continue;
    const mins = s.mins; let e1 = null; const cl = [];
    let lastScore = null, busyT = -1;
    for (let k = 0; k < mins.length - 1; k++) {
      const x = mins[k]; cl.push(x.c); if (cl.length === 20) e1 = mean(cl); else if (cl.length > 20) e1 += (2 / 21) * (x.c - e1);
      const tClose = x.t + 60000; // last completed 5m bar starts at floor(tClose/5m)*5m - 5m
      const b5 = Math.floor(tClose / 300000) * 300000 - 300000; const E = emaAt.get(b5);
      const A = atrFor(b5);
      if (e1 == null || !E || E.some(v => v == null) || !(A > 0)) { lastScore = null; continue; }
      const dirs = [Math.sign(x.c - e1), ...E.map(v => Math.sign(x.c - v))]; const score = dirs.reduce((q, d) => q + d, 0);
      const hb = `${s.type}:${Math.floor((tpeMin(x.t) - (s.type === 'DAY' ? 525 : 900) + 1440) % 1440 / 60)}`;
      if (mins[k + 1].t - x.t <= 5 * 60000) (pool.get(hb) || pool.set(hb, []).get(hb)).push({ s, k: k + 1, A });
      if (Math.abs(score) === 6 && lastScore !== score && x.t > busyT && mins.length - k > 13) {
        const tr = sim1m(mins, k + 1, Math.sign(score), 1.5 * A, policy);
        if (tr) { events.push({ ...tr, dir: Math.sign(score), hb, type: s.type, day: s.tradeDate }); busyT = mins[tr.exitIdx].t; }
      }
      lastScore = score;
    }
  }
  function atrFor(t) { return ATR.get(t); }
  const obs = mean(events.map(e => e.rNet)); const r = rng(seed); let ge = 0; const cm = [];
  for (let d = 0; d < 2000; d++) {
    let sum = 0, n = 0;
    for (const e of events) { const c = pool.get(e.hb); if (!c?.length) continue; const q = c[Math.floor(r() * c.length)]; const tr = sim1m(q.s.mins, q.k, e.dir, 1.5 * q.A, policy); if (!tr) continue; sum += tr.rNet; n++; }
    const m = sum / n; cm.push(m); if (m >= obs) ge++;
  }
  return { n: events.length, meanRNet: obs, winRate: events.length ? events.filter(e => e.rNet > 0).length / events.length : null, controlMeanRNet: mean(cm), excess: obs - mean(cm), p: (1 + ge) / 2001 };
}
let ATR = new Map();

export function runV7({ flowDir, archiveDir, window, thresholds = null }) {
  const policy = loadCostPolicy();
  const inWin = d => window === 'HOLDOUT' ? d >= FLOW_SPEC.holdoutStart : d < FLOW_SPEC.holdoutStart;
  const archive = loadArchive(archiveDir);
  if (window === 'DEV' && archive.some(s => s.tradeDate >= FLOW_SPEC.holdoutStart)) throw new Error('HOLDOUT ARCHIVE PRESENT IN DEV RUN');
  const flow = loadFlow(flowDir, window);
  if (window === 'DEV' && flow.minutes.some(x => tpeDate(x.t) >= FLOW_SPEC.holdoutStart)) throw new Error('HOLDOUT FLOW PRESENT IN DEV RUN');
  ATR = atrMap(archive);
  const sessions = buildSessions(flow, archive);
  const pts = decisionPoints(sessions, ATR, flow, policy, inWin);
  const thr = thresholds || { cvd15: quantile(pts.filter(p => p.cvd15 != null).map(p => Math.abs(p.cvd15)), 0.67), book5: quantile(pts.filter(p => p.book5 != null).map(p => Math.abs(p.book5)), 0.67),
    cnt15: quantile(pts.filter(p => p.cnt15 != null).map(p => Math.abs(p.cnt15)), 0.67), qcvd15: quantile(pts.filter(p => p.qcvd15 != null).map(p => Math.abs(p.qcvd15)), 0.67),
    basis: quantile(pts.filter(p => p.basis != null).map(p => Math.abs(p.basis)), 0.67), s2330: quantile(pts.filter(p => p.s2330 != null).map(p => Math.abs(p.s2330)), 0.67) };
  const P1 = confirmTest(pts, 'cvd15', thr.cvd15), P2 = confirmTest(pts, 'book5', thr.book5);
  const P3 = runAlign6(sessions, archive, policy, inWin);
  const ps = [P1.p, P2.p, P3.p]; const adj = holm(ps);
  const sec = Object.fromEntries(['cnt15', 'qcvd15', 'basis', 's2330'].map(f => [f, confirmTest(pts, f, thr[f], { perms: 500 })]));
  const split = Object.fromEntries(['DAY', 'NIGHT'].map(ty => [ty, confirmTest(pts.filter(p => p.type === ty), 'cvd15', thr.cvd15, { perms: 500 })]));
  return {
    specHash: FLOW_SPEC_HASH, window, thresholds: thr,
    sessions: sessions.filter(s => inWin(s.tradeDate)).map(s => ({ key: s.key, tradeDate: s.tradeDate, contract: s.contract, volRatio: +s.volRatio.toFixed(3), coverage: +s.coverage.toFixed(3), usable: s.usable })),
    usableSessions: sessions.filter(s => s.usable && inWin(s.tradeDate)).length, qualifyingPoints: pts.length,
    P1, P2, P3, holmAdjusted: { P1: adj[0], P2: adj[1], P3: adj[2] },
    pass: { P1: adj[0] < 0.05 && P1.diff > 0, P2: adj[1] < 0.05 && P2.diff > 0, P3: adj[2] < 0.05 && P3.excess > 0 },
    tradable: { P1: P1.meanConfirmed > 0, P2: P2.meanConfirmed > 0, P3: P3.meanRNet > 0 },
    secondary: sec, cvdByType: split, researchOnly: true, executionAuthorized: false,
  };
}

if (process.argv[1]?.endsWith('orderflow-v7.mjs')) {
  const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
  const window = opt('--window', 'DEV');
  const thr = opt('--thresholds') ? JSON.parse(fs.readFileSync(opt('--thresholds'), 'utf8')).thresholds : null;
  if (window === 'HOLDOUT' && !thr) throw new Error('HOLDOUT needs --thresholds from the DEV result');
  const r = runV7({ flowDir: opt('--flow'), archiveDir: opt('--archive'), window, thresholds: thr });
  if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(r, null, 1));
  const { sessions, ...brief } = r; console.log(JSON.stringify(brief, null, 1));
}

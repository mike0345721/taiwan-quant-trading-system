// V10: (A) how to tell a trend day from a range day, and can it be known early; (B) moving-average squeeze -> expansion
// as the start of a trend. Research only, never sends orders. Spec frozen (hashed) before results are read.
import fs from 'node:fs';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { stableJson, holm } from '../../../src/level-reaction-study.mjs';
import { buildHourly } from './trend-volume-v4.mjs';

export const V10_SPEC = Object.freeze({
  version: 'daytype-squeeze-v10',
  dayTypeDefinition: 'efficiency ratio of a TX day session: ER = |last close - first open| / sum of absolute 5m price steps (open -> each 5m close). Trend day = top third of ER over all sample days, range day = bottom third.',
  preOpenPredictors: ['prior night range / night open', 'prior night ER', 'prior day ER', '|day open - prior day close| / prior day range', 'daily MA squeeze (TWII MA5/10/20/60 spread / ATR14, prior day)', 'NR7 (prior day range smallest of 7)'],
  intradayCheckpoints: ['09:15 (first 6 bars)', '09:45 (first 12 bars)'],
  maSqueeze: 'spread = (max - min of MA5, MA10, MA20, MA60 of closes) / ATR14; squeeze when spread <= 20th percentile of the previous 250 values; expansion event = close above all four MAs (long) or below all four (short) while any of the previous 3 bars was in squeeze; one event per squeeze episode (first breakout)',
  squeezeData: { daily: 'TWII daily 1997-2026, forward 20 days', hourly: 'TX 60m bars (official archive, day+night), forward 10 bars' },
  squeezeOutcome: 'direction-signed forward move in ATR units (no costs, descriptive move size); control = all days/bars that are not squeeze events, signed by a random direction with the same long share as the events (5000 bootstrap draws by calendar year for daily, by month for hourly); also unsigned |move| vs all bars',
  primary: {
    P1: 'pre-open: the largest |Spearman rho| among the 6 predictors vs day ER; p from 2000 max-statistic permutations',
    P2: 'intraday: Spearman rho between ER of the first 12 bars (to 09:45) and ER of the rest of the day; one-sided p (rho > 0) from 2000 permutations',
    P3: 'daily TWII squeeze breakout: mean signed forward-20-day move (ATR units) minus control; one-sided bootstrap p',
    P4: 'hourly TX squeeze breakout: mean signed forward-10-bar move (ATR units) minus control; one-sided bootstrap p',
  },
  inference: 'Holm across P1-P4; pass = adjusted p < 0.05 with the stated sign',
  secondary: ['trend-day hit rate when a predictor is in its top third (base rate 33%)', 'direction continuation: sign(first 30/60 min move) vs sign(rest of day)', 'squeeze breakout unsigned move size vs all bars (does a squeeze lead to a bigger move, in either direction)', 'non-squeeze breakouts (close above/below all MAs) for comparison'],
  data: 'official TAIFEX 5m archive 2026-01-02..2026-11-06 (holdout already used in V6/V7); TWII daily from Yahoo',
  researchOnly: true, executionAuthorized: false,
});
export const V10_SPEC_HASH = crypto.createHash('sha256').update(stableJson(V10_SPEC)).digest('hex');

const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rank = a => { const idx = a.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(a.length); for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2; i = j + 1; } return r; };
const pearson = (a, b) => { const ma = mean(a), mb = mean(b); let c = 0, va = 0, vb = 0; for (let i = 0; i < a.length; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };
const spearman = (a, b) => pearson(rank(a), rank(b));
const er = pts => { let path = 0; for (let i = 1; i < pts.length; i++) path += Math.abs(pts[i] - pts[i - 1]); return path > 0 ? Math.abs(pts.at(-1) - pts[0]) / path : 0; };

export function loadArchiveAll(dir) {
  return fs.readdirSync(dir).filter(f => /-(day|night)\.json$/.test(f)).sort().map(f => { const d = JSON.parse(fs.readFileSync(dir + f, 'utf8'));
    return { tradeDate: d.tradeDate, session: d.session.toUpperCase(), contract: d.contract, bars: d.bars.map(b => ({ t: Date.parse(b.timestamp), open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume })) }; })
    .sort((a, b) => a.bars[0].t - b.bars[0].t);
}
export function loadTWII(file) {
  return zlib.gunzipSync(fs.readFileSync(file)).toString().split('\n').slice(1).map(l => l.split(',')).map(x => ({ d: x[0], o: +x[1], h: +x[2], l: +x[3], c: +x[4] })).filter(r => r.d && [r.o, r.h, r.l, r.c].every(Number.isFinite) && r.h >= r.l && r.c > 0);
}

// MA squeeze machinery on a generic bar array [{t|d, high, low, close, seg}]
export function squeezeEvents(bars, fwd) {
  const n = bars.length, close = bars.map(b => b.close);
  const out = { events: [], all: [] };
  const spreads = [];
  let inEpisode = false;
  const sq = new Array(n).fill(false);
  for (let i = 0; i < n; i++) {
    const segStart = (() => { let j = i; while (j > 0 && bars[j - 1].seg === bars[i].seg) j--; return j; })();
    if (i - segStart < 74) { spreads.length = 0; continue; }
    const ma = p => mean(close.slice(i - p + 1, i + 1));
    const m = [ma(5), ma(10), ma(20), ma(60)];
    let tr = 0; for (let j = i - 13; j <= i; j++) tr += Math.max(bars[j].high - bars[j].low, Math.abs(bars[j].high - bars[j - 1].close), Math.abs(bars[j].low - bars[j - 1].close));
    const atr = tr / 14; if (!(atr > 0)) continue;
    const spread = (Math.max(...m) - Math.min(...m)) / atr;
    const hist = spreads.slice(-250);
    sq[i] = hist.length >= 250 && spread <= [...hist].sort((a, b) => a - b)[49];
    spreads.push(spread);
    const j = i + fwd; if (j >= n || bars[j].seg !== bars[i].seg || hist.length < 250) continue;
    const move = (close[j] - close[i]) / atr;
    const dir = close[i] > Math.max(...m) ? 1 : close[i] < Math.min(...m) ? -1 : 0;
    const recentSq = sq[i - 1] || sq[i - 2] || sq[i - 3];
    const rec = { i, key: bars[i].key, dir, move, recentSq };
    out.all.push(rec);
    if (sq[i]) inEpisode = true;
    if (dir && recentSq && inEpisode) { out.events.push(rec); inEpisode = false; }
  }
  return out;
}
export function squeezeTest(res, seed) {
  const ev = res.events, ctrl = res.all.filter(r => !ev.includes(r));
  const longShare = ev.filter(e => e.dir > 0).length / ev.length;
  const obs = mean(ev.map(e => e.dir * e.move));
  const keys = [...new Set(res.all.map(r => r.key))];
  const evBy = new Map(keys.map(k => [k, ev.filter(e => e.key === k)])), ctBy = new Map(keys.map(k => [k, ctrl.filter(c => c.key === k)]));
  const r = rng(seed); let le = 0; const diffs = [];
  // control mean: random direction with the same long share
  const ctrlMean = arr => { let s = 0; for (const c of arr) s += (r() < longShare ? 1 : -1) * c.move; return s / arr.length; };
  const base = ctrlMean(ctrl);
  for (let d = 0; d < 5000; d++) {
    const pick = keys.map(() => keys[Math.floor(r() * keys.length)]);
    const e = pick.flatMap(k => evBy.get(k)), c = pick.flatMap(k => ctBy.get(k)); if (!e.length || !c.length) continue;
    const diff = mean(e.map(x => x.dir * x.move)) - ctrlMean(c); diffs.push(diff); if (diff <= 0) le++;
  }
  const nonSqBreak = ctrl.filter(c => c.dir !== 0);
  return { events: ev.length, longShare: +longShare.toFixed(2), meanSignedMoveATR: +obs.toFixed(3), controlMeanATR: +base.toFixed(3), excess: +(obs - base).toFixed(3), p: (1 + le) / (diffs.length + 1),
    winShare: +(ev.filter(e => e.dir * e.move > 0).length / ev.length).toFixed(3),
    unsignedMoveEvents: +mean(ev.map(e => Math.abs(e.move))).toFixed(3), unsignedMoveAll: +mean(res.all.map(e => Math.abs(e.move))).toFixed(3),
    nonSqueezeBreakouts: { n: nonSqBreak.length, meanSignedMoveATR: +mean(nonSqBreak.map(c => c.dir * c.move)).toFixed(3), winShare: +(nonSqBreak.filter(c => c.dir * c.move > 0).length / nonSqBreak.length).toFixed(3) } };
}

export function runV10({ archiveDir, twiiFile }) {
  const S = loadArchiveAll(archiveDir);
  const tw = loadTWII(twiiFile);
  // ---------- A: day type ----------
  const days = [];
  for (let k = 0; k < S.length; k++) {
    const s = S[k]; if (s.session !== 'DAY' || s.bars.length < 50) continue;
    const night = S[k - 1]?.session === 'NIGHT' ? S[k - 1] : null; const prevDay = S.slice(0, k).reverse().find(x => x.session === 'DAY');
    if (!night || !prevDay) continue;
    const pts = [s.bars[0].open, ...s.bars.map(b => b.close)];
    const nPts = [night.bars[0].open, ...night.bars.map(b => b.close)], pPts = [prevDay.bars[0].open, ...prevDay.bars.map(b => b.close)];
    const nHi = Math.max(...night.bars.map(b => b.high)), nLo = Math.min(...night.bars.map(b => b.low));
    const pHi = Math.max(...prevDay.bars.map(b => b.high)), pLo = Math.min(...prevDay.bars.map(b => b.low)), pClose = prevDay.bars.at(-1).close;
    // daily squeeze from TWII up to the prior trading day
    const ti = tw.findLastIndex(r => r.d < s.tradeDate);
    let dailySpread = null; if (ti >= 80) { const c = tw.slice(0, ti + 1).map(r => r.c); const ma = p => mean(c.slice(-p)); const m = [ma(5), ma(10), ma(20), ma(60)]; let tr = 0; for (let j = ti - 13; j <= ti; j++) tr += Math.max(tw[j].h - tw[j].l, Math.abs(tw[j].h - tw[j - 1].c), Math.abs(tw[j].l - tw[j - 1].c)); dailySpread = (Math.max(...m) - Math.min(...m)) / (tr / 14); }
    const prevRanges = S.slice(0, k).filter(x => x.session === 'DAY').slice(-7).map(x => Math.max(...x.bars.map(b => b.high)) - Math.min(...x.bars.map(b => b.low)));
    const c6 = pts.slice(0, 7), c12 = pts.slice(0, 13);
    days.push({ date: s.tradeDate, er: er(pts), move: pts.at(-1) - pts[0],
      f: { nightRange: (nHi - nLo) / night.bars[0].open, nightER: er(nPts), prevER: er(pPts), gap: Math.abs(s.bars[0].open - pClose) / (pHi - pLo), dailySqueeze: dailySpread == null ? null : -dailySpread, nr7: prevRanges.length === 7 && prevRanges[6] === Math.min(...prevRanges) ? 1 : 0 },
      er6: er(c6), er12: er(c12), rest6: er(pts.slice(6)), rest12: er(pts.slice(12)), m6: c6.at(-1) - c6[0], m12: c12.at(-1) - c12[0], r6: pts.at(-1) - c6.at(-1), r12: pts.at(-1) - c12.at(-1) });
  }
  const ers = days.map(d => d.er).sort((a, b) => a - b); const t1 = ers[Math.floor(ers.length / 3)], t2 = ers[Math.floor(2 * ers.length / 3)];
  const fnames = Object.keys(days[0].f); const r = rng(10);
  const rhoOf = (xs, ys) => spearman(xs, ys);
  const preRho = Object.fromEntries(fnames.map(fn => { const ok = days.filter(d => d.f[fn] != null); return [fn, +rhoOf(ok.map(d => d.f[fn]), ok.map(d => d.er)).toFixed(3)]; }));
  const obsMax = Math.max(...Object.values(preRho).map(Math.abs)); let geMax = 0;
  for (let k = 0; k < 2000; k++) { const perm = days.map(d => d.er); for (let a = perm.length - 1; a > 0; a--) { const b = Math.floor(r() * (a + 1)); [perm[a], perm[b]] = [perm[b], perm[a]]; }
    const m = Math.max(...fnames.map(fn => { const idx = days.map((d, i) => i).filter(i => days[i].f[fn] != null); return Math.abs(rhoOf(idx.map(i => days[i].f[fn]), idx.map(i => perm[i]))); })); if (m >= obsMax) geMax++; }
  const P1p = (1 + geMax) / 2001;
  const rho12 = rhoOf(days.map(d => d.er12), days.map(d => d.rest12)); let ge12 = 0;
  for (let k = 0; k < 2000; k++) { const perm = days.map(d => d.rest12); for (let a = perm.length - 1; a > 0; a--) { const b = Math.floor(r() * (a + 1)); [perm[a], perm[b]] = [perm[b], perm[a]]; } if (rhoOf(days.map(d => d.er12), perm) >= rho12) ge12++; }
  const P2p = (1 + ge12) / 2001;
  const hit = fn => { const ok = days.filter(d => d.f[fn] != null); const v = ok.map(d => d.f[fn]).sort((a, b) => a - b); const th = v[Math.floor(2 * v.length / 3)]; const top = ok.filter(d => d.f[fn] >= th); return { n: top.length, trendDayShare: +(top.filter(d => d.er >= t2).length / top.length).toFixed(3), rangeDayShare: +(top.filter(d => d.er <= t1).length / top.length).toFixed(3) }; };
  const cont = (mk, rk) => { const ok = days.filter(d => d[mk] !== 0 && d[rk] !== 0); return { n: ok.length, sameDirection: +(ok.filter(d => Math.sign(d[mk]) === Math.sign(d[rk])).length / ok.length).toFixed(3) }; };
  const early = ['er6', 'er12'].map(k => { const v = days.map(d => d[k]).sort((a, b) => a - b); const th = v[Math.floor(2 * v.length / 3)]; const top = days.filter(d => d[k] >= th); const rk = k === 'er6' ? 'rest6' : 'rest12'; const allRest = days.map(d => d[rk]).sort((a, b) => a - b); const rt2 = allRest[Math.floor(2 * allRest.length / 3)];
    const mk = k === 'er6' ? 'm6' : 'm12', rr = k === 'er6' ? 'r6' : 'r12';
    return [k, { topThirdN: top.length, restIsTrendShare: +(top.filter(d => d[rk] >= rt2).length / top.length).toFixed(3), directionContinues: +(top.filter(d => Math.sign(d[mk]) === Math.sign(d[rr])).length / top.length).toFixed(3) }]; });

  // ---------- B: MA squeeze ----------
  const twBars = tw.map(x => ({ key: x.d.slice(0, 4), seg: 0, high: x.h, low: x.l, close: x.c }));
  const B3 = squeezeTest(squeezeEvents(twBars, 20), 31);
  const hb = buildHourly(S).map(b => ({ ...b, key: new Date(b.t + 8 * 3600000).toISOString().slice(0, 7) }));
  const B4 = squeezeTest(squeezeEvents(hb, 10), 41);

  const ps = [P1p, P2p, B3.p, B4.p]; const adj = holm(ps);
  return {
    specHash: V10_SPEC_HASH, days: days.length, firstDay: days[0].date, lastDay: days.at(-1).date,
    dayTypeThresholds: { rangeDayER_max: +t1.toFixed(3), trendDayER_min: +t2.toFixed(3), medianER: +ers[ers.length >> 1].toFixed(3) },
    P1: { preOpenRho: preRho, maxAbsRho: +obsMax.toFixed(3), p: P1p }, P2: { rho: +rho12.toFixed(3), p: P2p }, P3_dailyTWII: B3, P4_hourlyTX: B4,
    holmAdjusted: { P1: adj[0], P2: adj[1], P3: adj[2], P4: adj[3] },
    pass: { P1: adj[0] < 0.05, P2: adj[1] < 0.05 && rho12 > 0, P3: adj[2] < 0.05 && B3.excess > 0, P4: adj[3] < 0.05 && B4.excess > 0 },
    secondary: { preOpenTopThird: Object.fromEntries(fnames.map(fn => [fn, hit(fn)])), firstHalfHourDirection: cont('m6', 'r6'), firstHourDirection: cont('m12', 'r12'), earlyER: Object.fromEntries(early), rho6: +rhoOf(days.map(d => d.er6), days.map(d => d.rest6)).toFixed(3) },
    researchOnly: true, executionAuthorized: false,
  };
}

if (process.argv[1]?.endsWith('daytype-squeeze-v10.mjs')) {
  const r = runV10({ archiveDir: process.argv[2], twiiFile: process.argv[3] });
  if (process.argv[4]) fs.writeFileSync(process.argv[4], JSON.stringify(r, null, 1));
  console.log(JSON.stringify(r, null, 1));
}

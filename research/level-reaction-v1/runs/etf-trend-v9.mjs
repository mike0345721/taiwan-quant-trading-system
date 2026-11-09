// V9 small-account version: long/flat trend filter on 4 asset classes that Taiwan-listed ETFs cover
// (Taiwan equity, US equity, US Treasuries, gold). Proxies: TWII, ES=F, ZN=F, GC=F daily closes. Research only.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { stableJson } from '../../../src/level-reaction-study.mjs';
import { loadMarkets, buildReturns } from './multi-market-trend-v8.mjs';

export const ETF_SPEC = Object.freeze({
  version: 'etf-trend-v9',
  universe: { TWII: 'Taiwan equity ETF (e.g. 0050/006208)', SP500_FUT: 'US equity ETF (e.g. 00646)', UST10Y_FUT: 'US Treasury ETF (proxy: 10y futures price, no coupon)', GOLD_FUT: 'gold ETF (e.g. 00635U)' },
  period: '2001-01-02 .. 2026-11-06; returns as in V8 (6-sigma roll filter)',
  trend: 'long/flat: hold the asset if the sum of its last 252 daily returns > 0, else cash (0% return)',
  hold: 'benchmark: always hold every asset (same risk sizing, no trend filter)',
  sizing: 'raw w_i = 0.15 / sigma_i(60d) / 4; if sum of raw weights over held assets > 1, scale them down to sum 1 (no leverage)',
  rebalance: 'every 21st union-calendar day from closes, applied from the next day',
  costs: '0.10% per unit turnover (discounted commission + 0.1% ETF sell tax, halved per side) + 0.40%/year holding cost on invested weight',
  primary: 'annualised Sharpe of trend minus hold; one-sided p from 5000 calendar-year block bootstrap draws (share with difference <= 0); pass if p < 0.05',
  secondary: ['max drawdown trend vs hold', 'sub-periods 2001-2010, 2011-2018, 2019-2026', 'years 2008, 2011, 2015, 2018, 2020, 2022', 'average invested share', 'CAGR'],
  researchOnly: true, executionAuthorized: false,
});
export const ETF_SPEC_HASH = crypto.createHash('sha256').update(stableJson(ETF_SPEC)).digest('hex');
const START = '2001-01-02';
const names = Object.keys(ETF_SPEC.universe);

function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function stats(pnl) {
  const xs = pnl.map(p => p.r); let eq = 1, pk = 1, dd = 0; for (const x of xs) { eq *= 1 + x; pk = Math.max(pk, eq); dd = Math.min(dd, eq / pk - 1); }
  const yrs = (Date.parse(pnl.at(-1).d) - Date.parse(pnl[0].d)) / 31557600000; const k = xs.length / yrs;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
  return { sharpe: +(m / sd * Math.sqrt(k)).toFixed(3), cagr: +((eq ** (1 / yrs) - 1) * 100).toFixed(2), annVol: +(sd * Math.sqrt(k) * 100).toFixed(2), maxDD: +(dd * 100).toFixed(1), years: +yrs.toFixed(1) };
}
const shOf = xs => { const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)); return m / sd; };

export function runV9(dir) {
  const { dates, R } = buildReturns(loadMarkets(dir, names));
  const sig = {};
  for (const n of names) {
    const { r, valid } = R[n]; const s = new Array(dates.length).fill(null), sd = new Array(dates.length).fill(null); const v = [];
    for (let i = 0; i < dates.length; i++) { if (valid[i]) v.push(i); if (v.length < 260) continue; const a = v.slice(-252), b = v.slice(-60);
      s[i] = a.reduce((q, k) => q + r[k], 0) > 0 ? 1 : 0; const m = b.reduce((q, k) => q + r[k], 0) / 60; sd[i] = Math.sqrt(b.reduce((q, k) => q + (r[k] - m) ** 2, 0) / 59) * Math.sqrt(252); }
    sig[n] = { s, sd };
  }
  const run = useTrend => {
    const w = Object.fromEntries(names.map(n => [n, 0])); const pnl = []; let k = 0, invested = 0, cnt = 0;
    const yrRows = dates.filter(d => d >= START).length / ((Date.parse('2026-11-06') - Date.parse(START)) / 31557600000);
    for (let i = 0; i < dates.length; i++) {
      if (dates[i] < START) continue;
      let day = 0; for (const n of names) day += w[n] * R[n].r[i];
      const inv = names.reduce((s, n) => s + w[n], 0); day -= inv * 0.004 / yrRows; invested += inv; cnt++;
      if (k++ % 21 === 0) {
        const raw = {}; for (const n of names) raw[n] = sig[n].s[i] == null || !(sig[n].sd[i] > 0) ? 0 : (useTrend ? sig[n].s[i] : 1) * 0.15 / sig[n].sd[i] / names.length;
        const tot = Object.values(raw).reduce((s, v) => s + v, 0); const f = tot > 1 ? 1 / tot : 1;
        for (const n of names) { const t = raw[n] * f; day -= Math.abs(t - w[n]) * 0.001; w[n] = t; }
      }
      pnl.push({ d: dates[i], r: day });
    }
    return { pnl, avgInvested: +(invested / cnt).toFixed(3) };
  };
  const T = run(true), H = run(false);
  const years = [...new Set(T.pnl.map(p => p.d.slice(0, 4)))];
  const by = p => Object.fromEntries(years.map(y => [y, p.filter(q => q.d.startsWith(y)).map(q => q.r)]));
  const bt = by(T.pnl), bh = by(H.pnl); const rr = rng(9); let le = 0;
  for (let d = 0; d < 5000; d++) { const pick = years.map(() => years[Math.floor(rr() * years.length)]); if (shOf(pick.flatMap(y => bt[y])) - shOf(pick.flatMap(y => bh[y])) <= 0) le++; }
  const p = (1 + le) / 5001;
  const sub = (pn, a, b) => stats(pn.filter(q => q.d >= a && q.d <= b));
  const yr = (pn, y) => +(pn.filter(q => q.d.startsWith(y)).reduce((s, q) => s + q.r, 0) * 100).toFixed(1);
  const st = sig; const last = dates.length - 1;
  return {
    specHash: ETF_SPEC_HASH, trend: { ...stats(T.pnl), avgInvested: T.avgInvested }, hold: { ...stats(H.pnl), avgInvested: H.avgInvested },
    pTrendNotBetter: p, pass: p < 0.05 && stats(T.pnl).sharpe > stats(H.pnl).sharpe,
    subPeriods: Object.fromEntries([['2001-2010', '2001-01-01', '2010-12-31'], ['2011-2018', '2011-01-01', '2018-12-31'], ['2019-2026', '2019-01-01', '2026-12-31']].map(([k, a, b]) => [k, { trend: sub(T.pnl, a, b), hold: sub(H.pnl, a, b) }])),
    years: Object.fromEntries(['2008', '2011', '2015', '2018', '2020', '2022'].map(y => [y, { trend: yr(T.pnl, y), hold: yr(H.pnl, y) }])),
    currentSignals: Object.fromEntries(names.map(n => [n, { trend: st[n].s[last], vol: +(st[n].sd[last] * 100).toFixed(1) }])),
    researchOnly: true, executionAuthorized: false,
  };
}

if (process.argv[1]?.endsWith('etf-trend-v9.mjs')) {
  const r = runV9(process.argv[2]); if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(r, null, 1)); console.log(JSON.stringify(r, null, 1));
}

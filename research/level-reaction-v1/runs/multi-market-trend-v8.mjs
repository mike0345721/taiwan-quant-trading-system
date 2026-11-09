// V8 multi-market trend-following study on public daily data (Yahoo continuous front-month futures, indices, stocks).
// Research only, never sends orders. Spec is frozen (hashed) and committed before results are read.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { stableJson } from '../../../src/level-reaction-study.mjs';

export const MM_SPEC = Object.freeze({
  version: 'multi-market-trend-v8',
  universe: ['TWII', 'TSMC', 'MEDIATEK', 'SP500_FUT', 'UST10Y_FUT', 'EUR_FUT', 'JPY_FUT', 'GOLD_FUT', 'CRUDE_FUT', 'COPPER_FUT', 'SOYBEAN_FUT', 'CORN_FUT'],
  excluded: { NASDAQ_FUT: 'redundant with SP500', NIKKEI: 'redundant equity', USDTWD: 'no liquid retail futures' },
  period: '2001-01-02 .. 2026-11-06 (a market joins after 260 valid days)',
  calendar: 'union of all trading dates; a market with no bar on a date has return 0 that day and keeps its position',
  returns: 'close-to-close simple return; if price <= 0 or |r| > 6 x trailing 60-day std of that market, r := 0 (continuous-contract roll artefacts, negative oil)',
  proxyNote: 'TWII price index stands in for TX futures; TSMC/MEDIATEK stock prices stand in for their stock futures; Yahoo =F series are unadjusted front-month splices',
  vol: 'sigma_i = std of the last 60 daily returns x sqrt(252)',
  signalA_primary: 'time-series momentum: s = sign(sum of the last 252 daily returns)',
  signalB_secondary: 'Donchian: long after close > highest close of prior 100 days, short after close < lowest of prior 100; exit long when close < lowest close of prior 50, exit short when close > highest of prior 50',
  sizing: 'w_i = s_i x (0.10 / sigma_i) / N_active (N_active = markets with a valid signal that day)',
  rebalance: 'positions recomputed every 5th calendar-union business day from closes; applied from the NEXT day return (1-day lag)',
  costsPerUnitTurnover: { equityIndexRatesFx: 0.0003, commodities: 0.0005, singleStocks: 0.0010 },
  benchmark: 'TX-only: the same rule and sizing on TWII alone (w = s x 0.10/sigma)',
  primary: 'portfolio net annualised Sharpe over the full period; one-sided p from 5000 calendar-year block bootstrap draws (share of draws with Sharpe <= 0); pass if p < 0.05',
  secondary: ['portfolio Sharpe minus TX-only Sharpe (same bootstrap)', 'Donchian version', 'sub-periods 2001-2010, 2011-2018, 2019-2026', 'max drawdown', 'correlation of portfolio daily returns with TWII buy-and-hold', 'calendar years 2008, 2020, 2022', 'per-market contribution'],
  researchOnly: true, executionAuthorized: false,
});
export const MM_SPEC_HASH = crypto.createHash('sha256').update(stableJson(MM_SPEC)).digest('hex');

const COST_CLASS = { TSMC: 'singleStocks', MEDIATEK: 'singleStocks', CRUDE_FUT: 'commodities', COPPER_FUT: 'commodities', SOYBEAN_FUT: 'commodities', CORN_FUT: 'commodities', GOLD_FUT: 'commodities' };
const costOf = m => MM_SPEC.costsPerUnitTurnover[COST_CLASS[m] || 'equityIndexRatesFx'];
const START = '2001-01-02', END = '2026-11-06';

export function loadMarkets(dir, names) {
  const out = {};
  for (const n of names) {
    const txt = zlib.gunzipSync(fs.readFileSync(path.join(dir, `${n}.csv.gz`))).toString('utf8').split('\n');
    const rows = txt.slice(1).map(l => l.split(',')).map(x => ({ d: x[0], c: Number(x[4]) })).filter(r => r.d && Number.isFinite(r.c) && r.d <= END);
    const m = new Map(); for (const r of rows) m.set(r.d, r.c); out[n] = m;
  }
  return out;
}

export function buildReturns(markets) {
  const dates = [...new Set(Object.values(markets).flatMap(m => [...m.keys()]))].filter(d => d >= '2000-01-01' && d <= END).sort();
  const R = {};
  for (const [n, m] of Object.entries(markets)) {
    const r = new Array(dates.length).fill(0), valid = new Array(dates.length).fill(false), px = new Array(dates.length).fill(null);
    let last = null; const hist = [];
    dates.forEach((d, i) => {
      const c = m.get(d);
      if (c == null) { px[i] = last; return; }
      if (last != null) {
        let x = last > 0 && c > 0 ? c / last - 1 : 0;
        const sd = hist.length >= 20 ? Math.sqrt(hist.slice(-60).reduce((s, v) => s + v * v, 0) / Math.min(60, hist.length)) : null;
        if (sd != null && Math.abs(x) > 6 * sd) x = 0;
        r[i] = x; valid[i] = true; hist.push(x);
      }
      last = c; px[i] = c;
    });
    R[n] = { r, valid, px };
  }
  return { dates, R };
}

function signalsTSMOM(R, dates) {
  const out = {};
  for (const [n, { r, valid }] of Object.entries(R)) {
    const s = new Array(dates.length).fill(null), sig = new Array(dates.length).fill(null);
    const vals = []; // indices of valid returns
    for (let i = 0; i < dates.length; i++) {
      if (valid[i]) vals.push(i);
      if (vals.length < 260) continue;
      const last252 = vals.slice(-252), last60 = vals.slice(-60);
      const sum = last252.reduce((q, k) => q + r[k], 0);
      const m = last60.reduce((q, k) => q + r[k], 0) / 60; const sd = Math.sqrt(last60.reduce((q, k) => q + (r[k] - m) ** 2, 0) / 59) * Math.sqrt(252);
      s[i] = Math.sign(sum); sig[i] = sd > 0 ? sd : null;
    }
    out[n] = { s, sig };
  }
  return out;
}

function signalsDonchian(R, dates) {
  const out = {};
  for (const [n, { r, valid, px }] of Object.entries(R)) {
    const s = new Array(dates.length).fill(null), sig = new Array(dates.length).fill(null);
    const vals = []; let pos = 0;
    for (let i = 0; i < dates.length; i++) {
      if (valid[i]) vals.push(i);
      if (vals.length < 260) continue;
      const closes = vals.map(k => px[k]); const c = closes.at(-1);
      const p100 = closes.slice(-101, -1), p50 = closes.slice(-51, -1);
      const hi100 = Math.max(...p100), lo100 = Math.min(...p100), hi50 = Math.max(...p50), lo50 = Math.min(...p50);
      if (pos > 0 && c < lo50) pos = 0; else if (pos < 0 && c > hi50) pos = 0;
      if (c > hi100) pos = 1; else if (c < lo100) pos = -1;
      const last60 = vals.slice(-60); const m = last60.reduce((q, k) => q + r[k], 0) / 60;
      const sd = Math.sqrt(last60.reduce((q, k) => q + (r[k] - m) ** 2, 0) / 59) * Math.sqrt(252);
      s[i] = pos; sig[i] = sd > 0 ? sd : null;
    }
    out[n] = { s, sig };
  }
  return out;
}

// Daily portfolio P&L with weekly rebalance, 1-day lag, turnover costs
export function backtest(R, dates, sigs, names) {
  const w = Object.fromEntries(names.map(n => [n, 0]));
  const pnl = [], contrib = Object.fromEntries(names.map(n => [n, 0]));
  let k = 0;
  for (let i = 0; i < dates.length; i++) {
    let day = 0;
    if (dates[i] >= START) for (const n of names) { const x = w[n] * R[n].r[i]; day += x; contrib[n] += x; }
    // rebalance at close of i (applies from i+1)
    if (dates[i] >= START && (k++ % 5 === 0)) {
      const active = names.filter(n => sigs[n].s[i] != null && sigs[n].sig[i] != null);
      for (const n of names) {
        const target = active.includes(n) ? sigs[n].s[i] * (0.10 / sigs[n].sig[i]) / active.length : 0;
        const cost = Math.abs(target - w[n]) * costOf(n); day -= cost; contrib[n] -= cost; w[n] = target;
      }
    }
    if (dates[i] >= START) pnl.push({ d: dates[i], r: day });
  }
  return { pnl, contrib };
}

export const sharpe = xs => { const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1)); return sd > 0 ? m / sd * Math.sqrt(252) : 0; };
// reporting fix (after first run): the union calendar has ~290 rows a year, so annualise with the actual rows per calendar year
function stats(pnl) {
  const xs = pnl.map(p => p.r); let eq = 1, pk = 1, dd = 0; for (const x of xs) { eq *= 1 + x; pk = Math.max(pk, eq); dd = Math.min(dd, eq / pk - 1); }
  const yrs = (Date.parse(pnl.at(-1).d) - Date.parse(pnl[0].d)) / (365.25 * 86400000) || 1; const k = xs.length / yrs;
  const m = xs.reduce((s, v) => s + v, 0) / xs.length; const sd = Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
  return { sharpe: +(m / sd * Math.sqrt(k)).toFixed(3), annReturn: +(m * k * 100).toFixed(2), annVol: +(sd * Math.sqrt(k) * 100).toFixed(2), cagr: +((eq ** (1 / yrs) - 1) * 100).toFixed(2), maxDD: +(dd * 100).toFixed(1), years: +yrs.toFixed(1) };
}
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function yearBootstrap(pnlA, pnlB, draws = 5000, seed = 8) {
  const years = [...new Set(pnlA.map(p => p.d.slice(0, 4)))];
  const byA = Object.fromEntries(years.map(y => [y, pnlA.filter(p => p.d.startsWith(y)).map(p => p.r)]));
  const byB = pnlB ? Object.fromEntries(years.map(y => [y, pnlB.filter(p => p.d.startsWith(y)).map(p => p.r)])) : null;
  const r = rng(seed); let le0 = 0, diffLe0 = 0;
  for (let k = 0; k < draws; k++) {
    const pick = years.map(() => years[Math.floor(r() * years.length)]);
    const a = pick.flatMap(y => byA[y]); const sa = sharpe(a); if (sa <= 0) le0++;
    if (byB) { const b = pick.flatMap(y => byB[y]); if (sa - sharpe(b) <= 0) diffLe0++; }
  }
  return { pSharpeLE0: (1 + le0) / (draws + 1), pDiffLE0: byB ? (1 + diffLe0) / (draws + 1) : null };
}
const corr = (a, b) => { const n = a.length, ma = a.reduce((s, v) => s + v, 0) / n, mb = b.reduce((s, v) => s + v, 0) / n; let c = 0, va = 0, vb = 0; for (let i = 0; i < n; i++) { c += (a[i] - ma) * (b[i] - mb); va += (a[i] - ma) ** 2; vb += (b[i] - mb) ** 2; } return c / Math.sqrt(va * vb); };

export function runV8(dir) {
  const names = MM_SPEC.universe;
  const markets = loadMarkets(dir, names);
  const { dates, R } = buildReturns(markets);
  const tsm = signalsTSMOM(R, dates), don = signalsDonchian(R, dates);
  const port = backtest(R, dates, tsm, names), tx = backtest(R, dates, tsm, ['TWII']);
  const portD = backtest(R, dates, don, names), txD = backtest(R, dates, don, ['TWII']);
  const boot = yearBootstrap(port.pnl, tx.pnl);
  const sub = (pnl, a, b) => stats(pnl.filter(p => p.d >= a && p.d <= b));
  const twBH = dates.map((d, i) => ({ d, r: R.TWII.r[i] })).filter(p => p.d >= START);
  const yr = (pnl, y) => +(pnl.filter(p => p.d.startsWith(y)).reduce((s, p) => s + p.r, 0) * 100).toFixed(1);
  // weekly correlations (descriptive)
  const wk = n => { const out = []; for (let i = 0; i + 5 <= dates.length; i += 5) { if (dates[i] < '2005-01-01') continue; out.push(R[n].r.slice(i, i + 5).reduce((s, v) => s + v, 0)); } return out; };
  const allN = [...names];
  const corrM = Object.fromEntries(allN.map(a => [a, Object.fromEntries(allN.map(b => [b, +corr(wk(a), wk(b)).toFixed(2)]))]));
  const totalContrib = Object.values(port.contrib).reduce((s, v) => s + v, 0);
  return {
    specHash: MM_SPEC_HASH,
    primary: { portfolio: stats(port.pnl), txOnly: stats(tx.pnl), pSharpeLE0: boot.pSharpeLE0, pass: boot.pSharpeLE0 < 0.05, pPortfolioNotBetterThanTX: boot.pDiffLE0 },
    donchian: { portfolio: stats(portD.pnl), txOnly: stats(txD.pnl) },
    subPeriods: Object.fromEntries([['2001-2010', '2001-01-01', '2010-12-31'], ['2011-2018', '2011-01-01', '2018-12-31'], ['2019-2026', '2019-01-01', '2026-12-31']].map(([k, a, b]) => [k, { portfolio: sub(port.pnl, a, b), txOnly: sub(tx.pnl, a, b), twiiBuyHold: sub(twBH, a, b) }])),
    crisisYearsPct: Object.fromEntries(['2008', '2011', '2015', '2018', '2020', '2022'].map(y => [y, { portfolio: yr(port.pnl, y), txOnly: yr(tx.pnl, y), twiiBuyHold: yr(twBH, y) }])),
    corrWithTWIIBuyHold: +corr(port.pnl.map(p => p.r), twBH.map(p => p.r)).toFixed(3),
    contributionShare: Object.fromEntries(Object.entries(port.contrib).map(([k, v]) => [k, +(v / totalContrib * 100).toFixed(1)])),
    weeklyCorrelations2005: corrM,
    equityCurve: port.pnl.filter((p, i) => i % 21 === 0).map(p => p.d),
    researchOnly: true, executionAuthorized: false,
    _series: { port: port.pnl, tx: tx.pnl, twBH },
  };
}

if (process.argv[1]?.endsWith('multi-market-trend-v8.mjs')) {
  const r = runV8(process.argv[2]);
  const { _series, equityCurve, ...brief } = r;
  if (process.argv[3]) fs.writeFileSync(process.argv[3], JSON.stringify(brief, null, 1));
  console.log(JSON.stringify(brief, null, 1));
}

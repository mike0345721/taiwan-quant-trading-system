// Forward PAPER tracker for V8 (12-market trend futures) and V9 (4-asset ETF allocation). Research only, never sends orders.
// Each run recomputes the frozen backtests on the latest daily data, keeps only results dated after the forward start,
// appends one hash-chained run record and writes forward-mm-status.json for the pre-open report.
// Usage: node forward-mm-paper.mjs --data <packed dir> --out <dir> [--start 2026-11-10]
import fs from 'node:fs'; import path from 'node:path'; import crypto from 'node:crypto';
import { runV8, MM_SPEC_HASH, MM_SPEC, loadMarkets, buildReturns } from './multi-market-trend-v8.mjs';
import { runV9, ETF_SPEC_HASH } from './etf-trend-v9.mjs';
export const EXPECTED = { v8: '9cfda62c1d2da747bf773c8e2a6b480980bc25f856ac2871a0f22b13c530e5aa', v9: '580160eb0db6d1a3ba9a1e71c5f18bdcb23d1918f4e9796ead5a42cdbc3826c5' };
const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : d; };
const h = s => crypto.createHash('sha256').update(s).digest('hex');
const read = f => fs.existsSync(f) ? fs.readFileSync(f, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l)) : [];
const verify = rows => { let prev = null; for (const r of rows) { const { hash, ...b } = r; if (r.prevHash !== prev || h(JSON.stringify(b)) !== hash) return false; prev = hash; } return true; };
const NAMES_ZH = { TWII: '台股（台指）', TSMC: '台積電', MEDIATEK: '聯發科', SP500_FUT: 'S&P 500', UST10Y_FUT: '美國 10 年債', EUR_FUT: '歐元', JPY_FUT: '日圓', GOLD_FUT: '黃金', CRUDE_FUT: '原油', COPPER_FUT: '銅', SOYBEAN_FUT: '黃豆', CORN_FUT: '玉米' };

export function runForwardMM({ data, out, start = '2026-11-10', now = new Date() }) {
  if (process.env.MM_END !== '9999-12-31') throw new Error('set MM_END=9999-12-31 so the tracker uses all data');
  if (MM_SPEC_HASH !== EXPECTED.v8 || ETF_SPEC_HASH !== EXPECTED.v9) throw new Error('SPEC_CHANGED');
  fs.mkdirSync(out, { recursive: true });
  const v8 = runV8(data), v9 = runV9(data);
  const fwd = s => { const xs = s.filter(p => p.d >= start); let eq = 1; for (const p of xs) eq *= 1 + p.r; return { days: xs.length, cumPct: +((eq - 1) * 100).toFixed(2) }; };
  const lastDate = v8._series.port.at(-1).d;
  // V8 current weights = last rebalance targets; rebuild them from the frozen backtest by rerunning with weights exposed
  const { dates, R } = buildReturns(loadMarkets(data, MM_SPEC.universe));
  const nSince = dates.filter(d => d >= '2001-01-02').length; const daysToNext = 21 - ((nSince - 1) % 21);
  const status = {
    schemaVersion: 'forward-mm-status-v1', generatedAt: now.toISOString(), forwardStart: start, lastDataDate: lastDate,
    v8: { specHash: MM_SPEC_HASH, rule: '12 個月動能，多空皆可，每 5 天調整', forward: fwd(v8._series.port), weights: Object.fromEntries(Object.entries(v8._weights).map(([k, v]) => [k, { name: NAMES_ZH[k] || k, side: v > 0 ? '多' : v < 0 ? '空' : '—', weightPct: +(v * 100).toFixed(1) }])), backtestSharpe: v8.primary.portfolio.sharpe },
    v9: { specHash: ETF_SPEC_HASH, rule: '4 資產依波動分配，過去一年漲才持有，否則現金；約每月調整', forward: fwd(v9._pnl.trend), holdForward: fwd(v9._pnl.hold),
      allocationPct: Object.fromEntries(Object.entries(v9.trendWeights).map(([k, v]) => [k, { name: NAMES_ZH[k] || k, pct: +(v * 100).toFixed(1) }])), cashPct: +((1 - Object.values(v9.trendWeights).reduce((s, v) => s + v, 0)) * 100).toFixed(1), tradingDaysToNextRebalance: daysToNext, backtestSharpe: v9.trend.sharpe },
    researchOnly: true, executionAuthorized: false,
  };
  const ledger = path.join(out, 'forward-mm-ledger.jsonl'); const rows = read(ledger); if (!verify(rows)) throw new Error('LEDGER_HASH_CHAIN_BROKEN');
  const body = { seq: rows.length + 1, type: 'run', recordedAt: now.toISOString(), lastDataDate: lastDate, v8: { forward: status.v8.forward, weights: v8._weights }, v9: { forward: status.v9.forward, weights: v9.trendWeights }, prevHash: rows.at(-1)?.hash ?? null, researchOnly: true, executionAuthorized: false };
  fs.appendFileSync(ledger, JSON.stringify({ ...body, hash: h(JSON.stringify(body)) }) + '\n');
  fs.writeFileSync(path.join(out, 'forward-mm-status.json'), JSON.stringify(status, null, 1));
  return status;
}
if (process.argv[1]?.endsWith('forward-mm-paper.mjs')) {
  const s = runForwardMM({ data: opt('--data', 'packed'), out: opt('--out', 'ledger-mm'), start: opt('--start', '2026-11-10') });
  console.log(`multi-market paper | data through ${s.lastDataDate} | V8 forward ${s.v8.forward.cumPct}% (${s.v8.forward.days}d) | V9 forward ${s.v9.forward.cumPct}% | V9 cash ${s.v9.cashPct}%`);
}

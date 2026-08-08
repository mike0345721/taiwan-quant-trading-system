import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);

function finite(value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); }
function mean(values) { const valid = values.filter(finite).map(Number); return valid.length ? valid.reduce((a, b) => a + b, 0) / valid.length : null; }
function quantile(values, q) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q; const lo = Math.floor(p); const hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}
function pctChange(current, prior) { return finite(current) && finite(prior) && Number(prior) !== 0 ? (Number(current) / Number(prior) - 1) * 100 : null; }
function shiftDate(dateText, days) { const d = new Date(`${dateText}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }

function observations(key) {
  return db.prepare('SELECT observation_date AS date, value FROM macro_observations WHERE series_key=? ORDER BY observation_date').all(key);
}

function asOf(series, tradeDate) {
  let lo = 0; let hi = series.length - 1; let answer = -1;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    if (series[mid].date < tradeDate) { answer = mid; lo = mid + 1; } else hi = mid - 1;
  }
  return answer;
}

function featureRows(rows, seriesByKey) {
  return rows.map((row) => {
    const at = Object.fromEntries(Object.entries(seriesByKey).map(([key, series]) => [key, asOf(series, row.tradeDate)]));
    const value = (key, lag = 0) => {
      const index = at[key] - lag;
      return index >= 0 ? Number(seriesByKey[key][index].value) : null;
    };
    const gapPct = finite(row.nextTxOpen) && finite(row.txClose) ? (Number(row.nextTxOpen) / Number(row.txClose) - 1) * 100 : null;
    const copperIndex = asOf(seriesByKey.PCOPPUSDM, shiftDate(row.tradeDate, -45));
    const copper = (lag = 0) => copperIndex - lag >= 0 ? Number(seriesByKey.PCOPPUSDM[copperIndex - lag].value) : null;
    return {
      ...row,
      gapPct,
      yen5dPct: pctChange(value('DEXJPUS'), value('DEXJPUS', 5)),
      dollarBroad5dPct: pctChange(value('DTWEXBGS'), value('DTWEXBGS', 5)),
      us2y5dDelta: finite(value('DGS2')) && finite(value('DGS2', 5)) ? value('DGS2') - value('DGS2', 5) : null,
      curve10y2y: finite(value('DGS10')) && finite(value('DGS2')) ? value('DGS10') - value('DGS2') : null,
      real10y5dDelta: finite(value('DFII10')) && finite(value('DFII10', 5)) ? value('DFII10') - value('DFII10', 5) : null,
      fedFunds20dDelta: finite(value('DFF')) && finite(value('DFF', 20)) ? value('DFF') - value('DFF', 20) : null,
      highYieldSpread5dDelta: finite(value('BAMLH0A0HYM2')) && finite(value('BAMLH0A0HYM2', 5)) ? value('BAMLH0A0HYM2') - value('BAMLH0A0HYM2', 5) : null,
      vix5dPct: pctChange(value('VIXCLS'), value('VIXCLS', 5)),
      renminbi5dPct: pctChange(value('DEXCHUS'), value('DEXCHUS', 5)),
      oil5dPct: pctChange(value('DCOILWTICO'), value('DCOILWTICO', 5)),
      goldPreviousReturnPct: finite(row.goldReturnPct) ? Number(row.goldReturnPct) : null,
      copperFuturesPreviousReturnPct: finite(row.copperFuturesReturnPct) ? Number(row.copperFuturesReturnPct) : null,
      copper3mPctLagged: pctChange(copper(), copper(3)),
    };
  });
}

function summarizeSubset(rows) {
  return {
    samples: rows.length,
    averageReturnPct: mean(rows.map((r) => r.sameDayReturnPct)),
    averageAbsoluteMovePct: mean(rows.map((r) => Math.abs(Number(r.sameDayReturnPct)))),
    averageAbsoluteGapPct: mean(rows.map((r) => Math.abs(Number(r.gapPct)))),
    negativeDayRate: mean(rows.map((r) => Number(r.sameDayReturnPct) < 0 ? 1 : 0)),
  };
}

function study(rows, field) {
  const valid = rows.filter((r) => finite(r[field]) && finite(r.sameDayReturnPct) && finite(r.gapPct));
  const lowCut = quantile(valid.map((r) => r[field]), 0.25);
  const highCut = quantile(valid.map((r) => r[field]), 0.75);
  const split = Math.floor(valid.length * 0.7);
  const periods = { all: valid, early70: valid.slice(0, split), late30: valid.slice(split) };
  const result = {};
  for (const [period, sample] of Object.entries(periods)) {
    const low = sample.filter((r) => Number(r[field]) <= lowCut);
    const high = sample.filter((r) => Number(r[field]) >= highCut);
    const base = summarizeSubset(sample); const lowSummary = summarizeSubset(low); const highSummary = summarizeSubset(high);
    result[period] = {
      base, low: lowSummary, high: highSummary,
      highVolatilityLift: base.averageAbsoluteMovePct ? highSummary.averageAbsoluteMovePct / base.averageAbsoluteMovePct : null,
      lowVolatilityLift: base.averageAbsoluteMovePct ? lowSummary.averageAbsoluteMovePct / base.averageAbsoluteMovePct : null,
      highMinusLowReturnPct: finite(highSummary.averageReturnPct) && finite(lowSummary.averageReturnPct)
        ? highSummary.averageReturnPct - lowSummary.averageReturnPct : null,
    };
  }
  return { field, lowCut, highCut, firstTradeDate: valid[0]?.tradeDate ?? null, lastTradeDate: valid.at(-1)?.tradeDate ?? null, ...result };
}

try {
  applyMigrations(db, config.migrationsPath);
  const keys = ['VIXCLS', 'DGS10', 'DGS2', 'DFII10', 'DFF', 'DTWEXBGS', 'DEXJPUS', 'BAMLH0A0HYM2', 'DEXCHUS', 'DCOILWTICO', 'PCOPPUSDM'];
  const seriesByKey = Object.fromEntries(keys.map((key) => [key, observations(key)]));
  const missing = keys.filter((key) => !seriesByKey[key].length);
  if (missing.length) throw new Error(`Missing macro series: ${missing.join(', ')}. Run npm run history:macro first.`);
  const rows = featureRows(loadResearchRows(db), seriesByKey);
  const definitions = {
    yen5dPct: '日圓兌美元5日變化；正值代表日圓轉弱',
    dollarBroad5dPct: '廣義美元指數5日變化',
    us2y5dDelta: '美國2年債殖利率5日變化',
    curve10y2y: '美國10年減2年殖利率曲線',
    real10y5dDelta: '美國10年實質利率5日變化',
    fedFunds20dDelta: '有效聯邦基金利率20個觀測值變化',
    highYieldSpread5dDelta: '美國高收益債信用利差5日變化',
    vix5dPct: 'VIX 5日變化',
    renminbi5dPct: '人民幣兌美元5日變化；正值代表人民幣轉弱',
    oil5dPct: 'WTI原油5日變化',
    goldPreviousReturnPct: '最近已收盤黃金期貨單日報酬（研究代理）',
    copperFuturesPreviousReturnPct: '最近已收盤銅期貨單日報酬（研究代理）',
    copper3mPctLagged: '全球銅價3個月變化；保守延後45日使用',
  };
  const studies = Object.fromEntries(Object.keys(definitions).map((field) => [field, study(rows, field)]));
  const report = {
    generatedAt: new Date().toISOString(),
    version: 'V2.10.0-candidate-research',
    timingRule: 'Taiwan trade date T only uses macro observations dated strictly before T.',
    purpose: 'Environment, volatility, gap and veto research. No factor receives a dashboard score from this exploratory pass.',
    definitions,
    studies,
    decisionRule: 'Only consider promotion when direction or risk lift is economically meaningful and keeps the same sign in the final 30% time split.',
  };
  fs.writeFileSync(path.join(config.reportsPath, 'macro-factor-candidates.json'), `${JSON.stringify(report, null, 2)}\n`);
  const lines = ['# V2.10 貨幣、利率與信用環境候選因子', '', `產生時間：${report.generatedAt}`, '',
    '- 僅使用台灣交易日前已知資料。', '- 本輪是環境與風險研究，不直接產生多空分數。',
    '- 後30%時間切片若效果消失或反轉，維持觀察，不加入首頁。', '',
    '| 因子 | 樣本 | 高值區日內波動倍數 | 後30%倍數 | 高值減低值平均報酬 | 後30%報酬差 |',
    '|---|---:|---:|---:|---:|---:|'];
  const f = (n, d = 2) => finite(n) ? Number(n).toFixed(d) : '—';
  for (const [field, result] of Object.entries(studies)) {
    lines.push(`| ${definitions[field]} | ${result.all.base.samples} | ${f(result.all.highVolatilityLift)} | ${f(result.late30.highVolatilityLift)} | ${f(result.all.highMinusLowReturnPct, 3)}% | ${f(result.late30.highMinusLowReturnPct, 3)}% |`);
  }
  lines.push('', '## 下一步', '', '先檢查穩定的風險放大或禁止交易效果；利率決策事件因樣本稀少，另以事件研究處理，不與每日因子混合。');
  fs.writeFileSync(path.join(config.reportsPath, 'V2_10_MACRO_FACTOR_CANDIDATES.md'), `${lines.join('\n')}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}

import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);

function finite(value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); }
function average(values) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function percentile(values, probability) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function pearson(pairs) {
  if (pairs.length < 3) return null;
  const xs = pairs.map((row) => row.x); const ys = pairs.map((row) => row.y);
  const mx = average(xs); const my = average(ys);
  const numerator = pairs.reduce((sum, row) => sum + (row.x - mx) * (row.y - my), 0);
  const denominator = Math.sqrt(
    xs.reduce((sum, value) => sum + (value - mx) ** 2, 0)
    * ys.reduce((sum, value) => sum + (value - my) ** 2, 0),
  );
  return denominator ? numerator / denominator : null;
}
function seriesStudy(rows, field) {
  const valid = rows.filter((row) => finite(row[field]) && finite(row.sameDayReturnPct));
  const values = valid.map((row) => Number(row[field]));
  const cutoff = percentile(values, 0.75);
  const baseAbsoluteMovePct = average(valid.map((row) => Math.abs(Number(row.sameDayReturnPct))));
  const upper = valid.filter((row) => Number(row[field]) >= cutoff);
  const upperAbsoluteMovePct = average(upper.map((row) => Math.abs(Number(row.sameDayReturnPct))));
  return {
    samples: valid.length,
    firstTradeDate: valid[0]?.tradeDate ?? null,
    lastTradeDate: valid.at(-1)?.tradeDate ?? null,
    level75Pct: cutoff,
    pearsonLevelVsAbsoluteSameDayReturn: pearson(valid.map((row) => ({ x: Number(row[field]), y: Math.abs(Number(row.sameDayReturnPct)) }))),
    baseAverageAbsoluteSameDayReturnPct: baseAbsoluteMovePct,
    upperQuartileSamples: upper.length,
    upperQuartileAverageAbsoluteSameDayReturnPct: upperAbsoluteMovePct,
    upperQuartileMoveLift: baseAbsoluteMovePct ? upperAbsoluteMovePct / baseAbsoluteMovePct : null,
  };
}

try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db);
  const report = {
    generatedAt: new Date().toISOString(),
    timingRule: 'For Taiwan trade date T, use only the latest macro observation with observation_date < T.',
    purpose: 'Environment and risk filtering; not a direct long/short signal.',
    series: {
      VIXCLS: seriesStudy(rows, 'fredVix'),
      DGS10: seriesStudy(rows, 'us10yYield'),
    },
    nextDecision: 'Do not add score weights yet. First extend features to changes/trends and validate with time-separated large-move and tail-risk targets.',
  };
  const f = (value, digits = 3) => value == null ? '—' : Number(value).toFixed(digits);
  const markdown = `# V2.8 總體環境層：第一階段可行性報告

產生時間：${report.generatedAt}

## 已完成

- 建立總體序列、匯入批次與觀測值三層資料表。
- 匯入 VIX（VIXCLS）與美國 10 年債殖利率（DGS10）各 811 筆官方 FRED 日資料。
- 台灣交易日只使用日期嚴格早於該日的最近觀測值，避免把尚未可得的美國資料放進回測。
- 先檢驗「環境值是否與台指日盤絕對波動有關」，沒有把它硬轉成多空訊號。

## 初步結果

| 因子 | 可用樣本 | 75百分位 | 與日盤絕對報酬相關 | 全體平均絕對報酬 | 高因子環境平均 | 波動提升倍數 |
|---|---:|---:|---:|---:|---:|---:|
| VIX | ${report.series.VIXCLS.samples} | ${f(report.series.VIXCLS.level75Pct, 2)} | ${f(report.series.VIXCLS.pearsonLevelVsAbsoluteSameDayReturn)} | ${f(report.series.VIXCLS.baseAverageAbsoluteSameDayReturnPct)}% | ${f(report.series.VIXCLS.upperQuartileAverageAbsoluteSameDayReturnPct)}% | ${f(report.series.VIXCLS.upperQuartileMoveLift, 2)} |
| 美國10年債殖利率 | ${report.series.DGS10.samples} | ${f(report.series.DGS10.level75Pct, 2)}% | ${f(report.series.DGS10.pearsonLevelVsAbsoluteSameDayReturn)} | ${f(report.series.DGS10.baseAverageAbsoluteSameDayReturnPct)}% | ${f(report.series.DGS10.upperQuartileAverageAbsoluteSameDayReturnPct)}% | ${f(report.series.DGS10.upperQuartileMoveLift, 2)} |

## 判讀

- 這只是單因子層級的第一輪可行性檢查，不能據此下單。
- VIX 應定位為風險偏好與波動環境；殖利率應先研究「變化速度與趨勢」，而不是只看絕對水準。
- 下一階段才加入 VIX 1／5／20 日變化、殖利率變化、SOX／Nasdaq 中期趨勢與美元台幣趨勢，並用時間切割驗證大行情、尾端 MAE 與禁做環境。
- 在因子通過樣本外檢驗以前，首頁不顯示假精確的總體環境評分。
`;
  fs.writeFileSync(path.join(config.reportsPath, 'macro-environment-feasibility.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(config.reportsPath, 'V2_8_MACRO_ENVIRONMENT_REPORT.md'), markdown);
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}

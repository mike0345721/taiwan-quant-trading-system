import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const finite = (value) => value !== null && value !== undefined && Number.isFinite(Number(value));
const average = (values) => values.length ? values.reduce((sum, value) => sum + Number(value), 0) / values.length : null;
function percentile(values, probability) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability; const lower = Math.floor(position); const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function pearson(rows, xKey, yKey) {
  const pairs = rows.filter((row) => finite(row[xKey]) && finite(row[yKey]));
  if (pairs.length < 3) return { samples: pairs.length, value: null };
  const mx = average(pairs.map((row) => row[xKey])); const my = average(pairs.map((row) => row[yKey]));
  const numerator = pairs.reduce((sum, row) => sum + (row[xKey] - mx) * (row[yKey] - my), 0);
  const denominator = Math.sqrt(
    pairs.reduce((sum, row) => sum + (row[xKey] - mx) ** 2, 0)
    * pairs.reduce((sum, row) => sum + (row[yKey] - my) ** 2, 0),
  );
  return { samples: pairs.length, value: denominator ? numerator / denominator : null };
}
function group(rows, predicate) {
  const selected = rows.filter((row) => predicate(row) && finite(row.nextAbsReturnPct));
  return {
    samples: selected.length,
    averageNextReturnPct: average(selected.map((row) => row.nextReturnPct)),
    averageNextAbsoluteReturnPct: average(selected.map((row) => row.nextAbsReturnPct)),
    nextDownPct: selected.length ? selected.filter((row) => row.nextReturnPct < 0).length / selected.length * 100 : null,
  };
}

try {
  applyMigrations(db, config.migrationsPath);
  const source = db.prepare(`SELECT v.*,
      f.contract AS tx_contract, f.open AS tx_open, f.high AS tx_high, f.low AS tx_low, f.close AS tx_close
    FROM volatility_relative_daily v
    JOIN futures_contract_daily f ON f.trade_date=v.trade_date AND f.product='TX' AND f.session='一般' AND f.is_active=1
    ORDER BY v.trade_date`).all();
  const rows = source.map((row, index) => {
    const next = source[index + 1]; const sameContract = next?.tx_contract === row.tx_contract;
    const sameDayReturnPct = (Number(row.tx_close) / Number(row.tx_open) - 1) * 100;
    const nextReturnPct = sameContract ? (Number(next.tx_close) / Number(next.tx_open) - 1) * 100 : null;
    return {
      ...row,
      sameDayReturnPct,
      sameDayAbsReturnPct: Math.abs(sameDayReturnPct),
      nextTradeDate: sameContract ? next.trade_date : null,
      nextReturnPct,
      nextAbsReturnPct: nextReturnPct == null ? null : Math.abs(nextReturnPct),
    };
  });
  const analyzable = rows.filter((row) => finite(row.nextAbsReturnPct));
  const baseNextAbs = average(analyzable.map((row) => row.nextAbsReturnPct));
  const ratio75 = percentile(analyzable.map((row) => row.vix_ratio), 0.75);
  const tvix75 = percentile(analyzable.map((row) => row.taiwan_vix_close), 0.75);
  const developmentEnd = Math.floor(analyzable.length * 0.7);
  const development = analyzable.slice(0, developmentEnd); const holdout = analyzable.slice(developmentEnd);
  const developmentRatio75 = percentile(development.map((row) => row.vix_ratio), 0.75);
  const developmentTvix75 = percentile(development.map((row) => row.taiwan_vix_close), 0.75);
  const holdoutBase = group(holdout, () => true);
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'exploratory_small_sample',
    timing: 'TAIWAN VIX is the TAIFEX 13:45 closing one-minute average. U.S. VIX is the latest FRED observation strictly before the Taiwan trade date.',
    coverage: { first: rows[0]?.trade_date, last: rows.at(-1)?.trade_date, alignedDays: rows.length, nextDayOutcomes: analyzable.length },
    latestObservation: rows.length ? {
      tradeDate: rows.at(-1).trade_date,
      taiwanVix: rows.at(-1).taiwan_vix_close,
      knownUsVix: rows.at(-1).us_vix_known,
      usSourceDate: rows.at(-1).us_vix_source_date,
      ratio: rows.at(-1).vix_ratio,
      spread: rows.at(-1).vix_spread,
    } : null,
    levels: {
      taiwanVixAverage: average(rows.map((row) => row.taiwan_vix_close)),
      usVixKnownAverage: average(rows.map((row) => row.us_vix_known)),
      ratioAverage: average(rows.map((row) => row.vix_ratio)),
      spreadAverage: average(rows.map((row) => row.vix_spread)),
    },
    correlations: {
      levelsTaiwanVsKnownUs: pearson(rows, 'taiwan_vix_close', 'us_vix_known'),
      changesTaiwanVsKnownUs: pearson(rows, 'taiwan_vix_change_1d', 'us_vix_change_1d'),
      concurrentTaiwanChangeVsTxReturn: pearson(rows, 'taiwan_vix_change_1d', 'sameDayReturnPct'),
      taiwanLevelVsNextAbsoluteMove: pearson(analyzable, 'taiwan_vix_close', 'nextAbsReturnPct'),
      ratioVsNextAbsoluteMove: pearson(analyzable, 'vix_ratio', 'nextAbsReturnPct'),
      spreadVsNextAbsoluteMove: pearson(analyzable, 'vix_spread', 'nextAbsReturnPct'),
      divergenceVsNextAbsoluteMove: pearson(analyzable, 'change_divergence', 'nextAbsReturnPct'),
    },
    descriptiveGroups: {
      all: group(analyzable, () => true),
      ratioUpperQuartile: { threshold: ratio75, ...group(analyzable, (row) => row.vix_ratio >= ratio75) },
      taiwanVixUpperQuartile: { threshold: tvix75, ...group(analyzable, (row) => row.taiwan_vix_close >= tvix75) },
      taiwanSpecificFear: group(analyzable, (row) => row.taiwan_vix_change_1d > 0 && row.us_vix_change_1d <= 0),
      jointFearRise: group(analyzable, (row) => row.taiwan_vix_change_1d > 0 && row.us_vix_change_1d > 0),
    },
    chronologicalCheck: {
      developmentDays: development.length,
      holdoutDays: holdout.length,
      developmentRatio75,
      developmentTvix75,
      holdoutAll: holdoutBase,
      holdoutHighRatio: group(holdout, (row) => row.vix_ratio >= developmentRatio75),
      holdoutHighTaiwanVix: group(holdout, (row) => row.taiwan_vix_close >= developmentTvix75),
    },
    warning: 'Public free TAIFEX closing history currently covers only the current and prior three months. Results are descriptive and must not be converted into a score or order rule.',
  };
  const lift = (groupResult, base) => base?.averageNextAbsoluteReturnPct ? groupResult.averageNextAbsoluteReturnPct / base.averageNextAbsoluteReturnPct : null;
  report.descriptiveGroups.ratioUpperQuartile.nextAbsoluteMoveLift = lift(report.descriptiveGroups.ratioUpperQuartile, report.descriptiveGroups.all);
  report.descriptiveGroups.taiwanVixUpperQuartile.nextAbsoluteMoveLift = lift(report.descriptiveGroups.taiwanVixUpperQuartile, report.descriptiveGroups.all);
  report.chronologicalCheck.holdoutHighRatio.nextAbsoluteMoveLift = lift(report.chronologicalCheck.holdoutHighRatio, holdoutBase);
  report.chronologicalCheck.holdoutHighTaiwanVix.nextAbsoluteMoveLift = lift(report.chronologicalCheck.holdoutHighTaiwanVix, holdoutBase);

  const f = (value, digits = 3) => value == null ? '—' : Number(value).toFixed(digits);
  const markdown = `# V2.9 臺灣VIX／美股VIX相對關係研究

產生時間：${report.generatedAt}

## 研究定位

TAIWAN VIX與美股VIX都衡量約30天預期波動，但標的市場、交易時間、選擇權供需及假期結構不同。比率或價差只能表示「臺灣相對波動風險溢價」，不能直接解讀成看多或看空。

本研究使用臺灣13:45收盤前1分鐘平均VIX，搭配當時已知、日期早於臺灣交易日的最近美股VIX；沒有使用尚未發生的同日美股收盤。

## 資料限制

- 公開免費TAIFEX收盤資料只有目前及前三個月。
- 對齊日數：${report.coverage.alignedDays}日；具下一交易日結果：${report.coverage.nextDayOutcomes}日。
- 目前只能列為小樣本探索，不能加入首頁分數或操作建議。

## 水準與關係

最新完整對齊日（${report.latestObservation?.tradeDate || '—'}）：臺灣VIX ${f(report.latestObservation?.taiwanVix, 2)}、當時已知美股VIX ${f(report.latestObservation?.knownUsVix, 2)}（${report.latestObservation?.usSourceDate || '—'}）、比率 ${f(report.latestObservation?.ratio, 2)}、價差 ${f(report.latestObservation?.spread, 2)}。這是壓力觀察值，不代表方向。

| 指標 | 結果 |
|---|---:|
| 臺灣VIX平均 | ${f(report.levels.taiwanVixAverage, 2)} |
| 當時已知美股VIX平均 | ${f(report.levels.usVixKnownAverage, 2)} |
| 臺灣／美股VIX平均比率 | ${f(report.levels.ratioAverage, 2)} |
| 臺灣－美股VIX平均價差 | ${f(report.levels.spreadAverage, 2)} |
| 兩者水準相關 | ${f(report.correlations.levelsTaiwanVsKnownUs.value)} |
| 兩者日變化相關 | ${f(report.correlations.changesTaiwanVsKnownUs.value)} |
| 臺灣VIX變化與當日台指報酬相關 | ${f(report.correlations.concurrentTaiwanChangeVsTxReturn.value)} |

最後一項是同時發生的風險反應，不是可成交的預測訊號。

## 對下一日波動的探索

| 條件 | 樣本 | 下一日平均絕對報酬 | 相對全體倍數 | 下一日下跌比例 |
|---|---:|---:|---:|---:|
| 全部 | ${report.descriptiveGroups.all.samples} | ${f(report.descriptiveGroups.all.averageNextAbsoluteReturnPct)}% | 1.00 | ${f(report.descriptiveGroups.all.nextDownPct, 1)}% |
| VIX比率前25% | ${report.descriptiveGroups.ratioUpperQuartile.samples} | ${f(report.descriptiveGroups.ratioUpperQuartile.averageNextAbsoluteReturnPct)}% | ${f(report.descriptiveGroups.ratioUpperQuartile.nextAbsoluteMoveLift, 2)} | ${f(report.descriptiveGroups.ratioUpperQuartile.nextDownPct, 1)}% |
| 臺灣VIX前25% | ${report.descriptiveGroups.taiwanVixUpperQuartile.samples} | ${f(report.descriptiveGroups.taiwanVixUpperQuartile.averageNextAbsoluteReturnPct)}% | ${f(report.descriptiveGroups.taiwanVixUpperQuartile.nextAbsoluteMoveLift, 2)} | ${f(report.descriptiveGroups.taiwanVixUpperQuartile.nextDownPct, 1)}% |
| 臺灣VIX升、美股VIX降 | ${report.descriptiveGroups.taiwanSpecificFear.samples} | ${f(report.descriptiveGroups.taiwanSpecificFear.averageNextAbsoluteReturnPct)}% | — | ${f(report.descriptiveGroups.taiwanSpecificFear.nextDownPct, 1)}% |
| 兩地VIX同步上升 | ${report.descriptiveGroups.jointFearRise.samples} | ${f(report.descriptiveGroups.jointFearRise.averageNextAbsoluteReturnPct)}% | — | ${f(report.descriptiveGroups.jointFearRise.nextDownPct, 1)}% |

## 時間切割檢查

- 前70%共${report.chronologicalCheck.developmentDays}日，只用這段決定門檻。
- 後30%共${report.chronologicalCheck.holdoutDays}日。
- 後段高相對VIX的波動倍數：${f(report.chronologicalCheck.holdoutHighRatio.nextAbsoluteMoveLift, 2)}。
- 後段高臺灣VIX的波動倍數：${f(report.chronologicalCheck.holdoutHighTaiwanVix.nextAbsoluteMoveLift, 2)}。

樣本仍太少，時間切割只用來防止全樣本自我說服，不代表正式樣本外通過。

## 第一階段結論

1. 相對VIX較適合作為「臺灣特有風險是否升溫」與部位縮減條件，不適合直接決定多空。
2. 臺灣VIX上升通常與台指當日下跌同時發生，但13:45才完成，不能回頭假裝在開盤已知。
3. 下一步需要至少1至3年官方歷史，才研究比率Z-score、背離持續天數、領先落後及與MAE尾端風險的關係。
4. 在長期資料取得前，本因子維持「觀察中」，不進入正式評分。
`;
  fs.writeFileSync(path.join(config.reportsPath, 'vix-relative-research.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(config.reportsPath, 'V2_9_VIX_RELATIVE_REPORT.md'), markdown);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }

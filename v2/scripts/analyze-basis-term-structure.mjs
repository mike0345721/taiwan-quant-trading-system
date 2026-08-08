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
function summarize(rows) {
  const selected = rows.filter((row) => finite(row.nextDayReturnPct));
  return {
    samples: selected.length,
    averageNextDayReturnPct: average(selected.map((row) => row.nextDayReturnPct)),
    nextDayUpPct: selected.length ? selected.filter((row) => row.nextDayReturnPct > 0).length / selected.length * 100 : null,
    averageNextDayAbsoluteMovePct: average(selected.map((row) => row.nextDayAbsReturnPct)),
    averageNextCloseToClosePct: average(selected.filter((row) => finite(row.nextCloseToClosePct)).map((row) => row.nextCloseToClosePct)),
  };
}
function featureStudy(rows, key) {
  const available = rows.filter((row) => finite(row[key]) && finite(row.nextDayReturnPct));
  const developmentEnd = Math.floor(available.length * 0.7);
  const development = available.slice(0, developmentEnd); const holdout = available.slice(developmentEnd);
  const q25 = percentile(development.map((row) => row[key]), 0.25);
  const q75 = percentile(development.map((row) => row[key]), 0.75);
  const devLow = summarize(development.filter((row) => row[key] <= q25));
  const devHigh = summarize(development.filter((row) => row[key] >= q75));
  const holdoutAll = summarize(holdout);
  const holdoutLow = summarize(holdout.filter((row) => row[key] <= q25));
  const holdoutHigh = summarize(holdout.filter((row) => row[key] >= q75));
  const developmentSeparation = (devHigh.nextDayUpPct ?? 0) - (devLow.nextDayUpPct ?? 0);
  const holdoutSeparation = (holdoutHigh.nextDayUpPct ?? 0) - (holdoutLow.nextDayUpPct ?? 0);
  const consistent = Math.sign(developmentSeparation) === Math.sign(holdoutSeparation);
  const minExtremeSamples = Math.min(holdoutLow.samples, holdoutHigh.samples);
  return {
    samples: available.length,
    developmentDays: development.length,
    holdoutDays: holdout.length,
    thresholdsFromDevelopment: { q25, q75 },
    correlations: {
      nextDirection: pearson(available, key, 'nextDayReturnPct'),
      nextAbsoluteMove: pearson(available, key, 'nextDayAbsReturnPct'),
    },
    development: { low: devLow, high: devHigh },
    holdout: { all: holdoutAll, low: holdoutLow, high: holdoutHigh },
    validation: {
      directionConsistent: consistent,
      developmentHighMinusLowUpPctPoints: developmentSeparation,
      holdoutHighMinusLowUpPctPoints: holdoutSeparation,
      minimumHoldoutExtremeSamples: minExtremeSamples,
      scoreEligible: consistent && Math.abs(holdoutSeparation) >= 10 && minExtremeSamples >= 15,
    },
  };
}

try {
  applyMigrations(db, config.migrationsPath);
  const source = db.prepare(`SELECT b.*, f.open AS tx_open, f.close AS tx_close,
      v.value AS taiwan_vix
    FROM basis_term_structure_daily b
    JOIN futures_contract_daily f
      ON f.trade_date=b.trade_date AND f.product='TX' AND f.contract=b.near_contract AND f.is_active=1
    LEFT JOIN macro_observations v ON v.series_key='TAIWANVIX' AND v.observation_date=b.trade_date
    ORDER BY b.trade_date`).all();
  const rows = source.map((row, index) => {
    const next = source[index + 1];
    const comparable = next && next.near_contract === row.near_contract;
    const nextDayReturnPct = comparable ? (Number(next.tx_close) / Number(next.tx_open) - 1) * 100 : null;
    return {
      ...row,
      nextTradeDate: comparable ? next.trade_date : null,
      nextDayReturnPct,
      nextDayAbsReturnPct: nextDayReturnPct == null ? null : Math.abs(nextDayReturnPct),
      nextCloseToClosePct: comparable ? (Number(next.tx_close) / Number(row.tx_close) - 1) * 100 : null,
      absTermChangeZ60: finite(row.term_change_z60) ? Math.abs(Number(row.term_change_z60)) : null,
      absBasisLevelZ60: finite(row.basis_level_z60) ? Math.abs(Number(row.basis_level_z60)) : null,
    };
  }).filter((row) => !row.rollover_risk);
  const features = {
    termSpreadLevel: featureStudy(rows, 'term_spread_bps'),
    termChange1d: featureStudy(rows, 'term_change_1d_bps'),
    termChange5d: featureStudy(rows, 'term_change_5d_bps'),
    termChangeZ60: featureStudy(rows, 'term_change_z60'),
    closeBasisLevel: featureStudy(rows, 'close_basis_bps'),
    basisChange1d: featureStudy(rows, 'basis_change_1d_bps'),
    basisChange5d: featureStudy(rows, 'basis_change_5d_bps'),
    basisLevelZ60: featureStudy(rows, 'basis_level_z60'),
  };
  const vixRows = rows.filter((row) => finite(row.taiwan_vix));
  const vix75 = percentile(vixRows.map((row) => row.taiwan_vix), 0.75);
  const report = {
    generatedAt: new Date().toISOString(),
    status: 'research_only',
    timing: 'Signals use day-session closing data. The primary outcome is the following comparable contract day-session open-to-close return.',
    coverage: {
      first: rows[0]?.trade_date,
      last: rows.at(-1)?.trade_date,
      futuresStructureDays: rows.length,
      closeBasisDays: rows.filter((row) => finite(row.close_basis_bps)).length,
      taiwanVixMatchedDays: vixRows.length,
    },
    exclusions: 'Rows within two calendar days of monthly expiry and outcomes crossing an active-contract rollover are excluded.',
    features,
    vixRelationship: {
      warning: 'TAIWAN VIX free public history is a small recent sample; these results are descriptive only.',
      upperQuartileThreshold: vix75,
      termLevelVsVix: pearson(vixRows, 'term_spread_bps', 'taiwan_vix'),
      termChangeVsVix: pearson(vixRows, 'term_change_1d_bps', 'taiwan_vix'),
      basisLevelVsVix: pearson(vixRows, 'close_basis_bps', 'taiwan_vix'),
      basisChangeVsVix: pearson(vixRows, 'basis_change_1d_bps', 'taiwan_vix'),
      highVix: summarize(vixRows.filter((row) => row.taiwan_vix >= vix75)),
      lowerVix: summarize(vixRows.filter((row) => row.taiwan_vix < vix75)),
    },
  };
  const eligible = Object.entries(features).filter(([, study]) => study.validation.scoreEligible).map(([key]) => key);
  report.scoreDecision = {
    eligibleFeatures: eligible,
    productionWeight: 0,
    decision: eligible.length
      ? '部分候選通過最低門檻，但在重複走勢驗證與增量價值測試完成前，正式評分仍為0。'
      : '沒有特徵通過最低時間序列驗證門檻；目前只顯示資訊，正式評分權重為0。',
    proposedDisplay: 'Show close-basis proxy, near/next spread, 1-day change, expiry warning and VIX regime. Do not label raw positive/negative values as bullish or bearish.',
  };
  const f = (value, digits = 3) => value == null ? '—' : Number(value).toFixed(digits);
  const lines = Object.entries(features).map(([key, study]) =>
    `| ${key} | ${study.samples} | ${f(study.correlations.nextDirection.value)} | ${f(study.holdout.low.nextDayUpPct, 1)}% (${study.holdout.low.samples}) | ${f(study.holdout.high.nextDayUpPct, 1)}% (${study.holdout.high.samples}) | ${f(study.validation.holdoutHighMinusLowUpPctPoints, 1)} | ${study.validation.directionConsistent ? '是' : '否'} | ${study.validation.scoreEligible ? '候選' : '不納入'} |`).join('\n');
  const markdown = `# V2.9.1 期現貨基差與近遠月價差研究

產生時間：${report.generatedAt}

## 結論

這兩組價差有資訊價值，但原始正負號不能直接翻譯成多空。近遠月價差會受利率、預期股息、到期月份與轉倉影響；本系統的日線期現貨基差又存在現貨與期貨收盤時間不同的限制。因此本階段以變化量、歷史異常程度與波動環境做研究，不把「正價差＝看多」寫進評分。

目前正式評分權重：**0**。${report.scoreDecision.decision}

## 資料與防止假訊號

- 近遠月結構：${report.coverage.futuresStructureDays} 日，${report.coverage.first} 至 ${report.coverage.last}
- 收盤基差代理：${report.coverage.closeBasisDays} 日
- 可同時比對 TAIWAN VIX：${report.coverage.taiwanVixMatchedDays} 日（小樣本）
- 排除到期前兩個日曆日；次日結果若跨越主力契約換月也不計算。
- 門檻只由前 70% 時間序列決定，再測後 30%，避免用未來資料決定分界。

## 次日日盤方向檢驗

低組／高組的上漲率是依開發期第 25／75 百分位切分；括號內為後 30% 樣本數。

| 特徵 | 全樣本 | 與次日報酬相關 | 低組上漲率 | 高組上漲率 | 高減低百分點 | 前後方向一致 | 評分 |
|---|---:|---:|---:|---:|---:|---|---|
${lines}

## 與 TAIWAN VIX 的關係

| 關係 | 樣本 | 相關係數 |
|---|---:|---:|
| 近遠月價差水準 vs TAIWAN VIX | ${report.vixRelationship.termLevelVsVix.samples} | ${f(report.vixRelationship.termLevelVsVix.value)} |
| 近遠月價差日變化 vs TAIWAN VIX | ${report.vixRelationship.termChangeVsVix.samples} | ${f(report.vixRelationship.termChangeVsVix.value)} |
| 收盤基差代理 vs TAIWAN VIX | ${report.vixRelationship.basisLevelVsVix.samples} | ${f(report.vixRelationship.basisLevelVsVix.value)} |
| 基差日變化 vs TAIWAN VIX | ${report.vixRelationship.basisChangeVsVix.samples} | ${f(report.vixRelationship.basisChangeVsVix.value)} |

這裡只有最近數月資料，只能用來產生研究假設，不能據此加分或下單。

## 面板建議

1. 首頁增加「期限結構」卡，但標示為環境資訊，不併入總分。
2. 顯示近月、次月、價差點數、價差 1 日變化、收盤基差代理、距結算日與 TAIWAN VIX。
3. 判讀用「擴大／收斂／歷史異常／換月失真風險」，不直接用紅綠多空。
4. 未來取得同時點現貨與期貨、股息預估及利率後，才建立理論基差偏離值；再用滾動樣本外測試決定是否給 5% 以內的環境分數。
`;
  fs.writeFileSync(path.join(config.reportsPath, 'basis-term-structure-research.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(config.reportsPath, 'V2_9_1_BASIS_TERM_STRUCTURE_REPORT.md'), markdown);
  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}

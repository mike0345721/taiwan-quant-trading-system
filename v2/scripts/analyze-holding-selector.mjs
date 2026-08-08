import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { evaluateHoldout, loadResearchRows, strategyDefinitions } from '../src/backtest-engine.mjs';
import { nestedHoldingStudy } from '../src/holding-selector.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db);
  const strategies = strategyDefinitions().filter((item) => ['foreign_futures_price_oi', 'foreign_futures_price_oi_h2'].includes(item.key));
  const assumptions = { costPoints: 8, quantileLow: 0.30, quantileHigh: 0.70, finalHoldoutPct: 0.20,
    outerMinTrainDays: 160, outerTestWindowDays: 20, innerMinTrainDays: 100, innerHoldoutPct: 0.25,
    selectionRules: { minimumTrades: 10, minimumProfitFactor: 1.05, reliabilityTrades: 30,
      drawdownPenaltyWeight: 0.25, tailMaePenaltyWeight: 0.10, minimumUtility: 0 } };
  const study = nestedHoldingStudy(rows, strategies, assumptions);
  const fixed = Object.fromEntries(strategies.map((strategy) => [strategy.key, evaluateHoldout(rows, strategy, { ...assumptions, holdoutPct: 0.20, minTrainDays: 100 }).metrics]));
  const report = { generatedAt: new Date().toISOString(), version: '2.9.4', researchRows: rows.length, strategies, ...study, fixedFinalHoldoutBenchmarks: fixed,
    status: 'research_only', caveat: '同一最終保留期已在先前版本被多次檢視，因此此結果不是全新未觸碰樣本；未來須以前推新資料確認。' };
  const f = (value, digits = 2) => value == null ? '—' : Number(value).toFixed(digits);
  const counts = Object.entries(report.development.folds.reduce((acc, fold) => ({ ...acc, [fold.choice]: (acc[fold.choice] || 0) + 1 }), {}));
  const markdown = `# V2.9.4 風險調整巢狀持有期研究

產生時間：${report.generatedAt}

## 結論

- 每一個外層測試窗開始前，只用更早的訓練資料，在內層驗證中選擇持有1日、2日或不交易。
- 先要求交易至少10筆、PF至少1.05且淨點數為正，再以平均淨點數乘樣本可靠度，扣除每筆回撤25%與尾端MAE 10%作排名；效用不為正即不交易。
- 外層選擇次數：${counts.map(([key, value]) => `${key} ${value}次`).join('、') || '無'}。
- 最終保留期選擇：${report.finalHoldout.choice}；交易 ${report.finalHoldout.metrics.trades} 筆，PF ${f(report.finalHoldout.metrics.profitFactor)}，淨點數 ${f(report.finalHoldout.metrics.totalNetPoints, 0)}。
- ${report.caveat}

## 固定持有期最終保留期比較

| 方法 | 交易數 | PF | 淨點數 | 最大回撤 | 平均MAE |
|---|---:|---:|---:|---:|---:|
${strategies.map((strategy) => { const m = fixed[strategy.key]; return `| ${strategy.holdingDays}日固定 | ${m.trades} | ${f(m.profitFactor)} | ${f(m.totalNetPoints, 0)} | ${f(m.maxDrawdownPoints, 0)} | ${f(m.averageMaePoints, 1)} |`; }).join('\n')}

## 防止偷看未來

- 持有期只由內層歷史區間選出。
- 外層測試窗及最終保留期不參與門檻或持有期選擇。
- 交易訊號在當日收盤資料完成後產生，進場仍採下一交易日日盤開盤。
`;
  fs.writeFileSync(path.join(config.reportsPath, 'holding-selector.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(config.reportsPath, 'V2_9_4_HOLDING_SELECTOR_REPORT.md'), markdown);
  console.log(JSON.stringify({ generatedAt: report.generatedAt, researchRows: rows.length, development: report.development.metrics, choices: counts,
    finalHoldout: { choice: report.finalHoldout.choice, reason: report.finalHoldout.reason, metrics: report.finalHoldout.metrics },
    fixedFinalHoldoutBenchmarks: fixed, caveat: report.caveat }, null, 2));
} finally { db.close(); }

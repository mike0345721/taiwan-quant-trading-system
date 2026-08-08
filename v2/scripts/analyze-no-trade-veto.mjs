import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { evaluateHoldout, loadResearchRows, strategyDefinitions, walkForward } from '../src/backtest-engine.mjs';
import { analyzeNoTradeVeto } from '../src/no-trade-veto.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
const assumptions = { minTrainDays: 100, testWindowDays: 20, costPoints: 8, holdoutPct: 0.20, quantileLow: 0.30, quantileHigh: 0.70, executionModelVersion: '2.0.0-fixed-contract-mae-mfe' };
try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db); const split = Math.max(assumptions.minTrainDays, Math.floor(rows.length * (1 - assumptions.holdoutPct)));
  const developmentRows = rows.slice(0, split);
  const strategy = strategyDefinitions().find((item) => item.key === 'foreign_futures_price_oi_h2');
  const development = walkForward(developmentRows, strategy, assumptions);
  const holdout = evaluateHoldout(rows, strategy, assumptions);
  const analysis = analyzeNoTradeVeto(development.daily, holdout.daily);
  const report = {
    generatedAt: new Date().toISOString(), version: '2.9.2', baseStrategy: strategy,
    assumptions: { ...assumptions, informationAvailableAt: 'after_current_close', thresholdPolicy: 'development_only', operationalStatus: 'research_only' },
    ...analysis,
  };
  const f = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits);
  const rowsMd = report.studies.map((study) => `| ${study.label} | ${study.holdout.vetoed.trades} | ${study.holdout.all.profitFactor == null ? '—' : f(study.holdout.all.profitFactor, 2)} | ${study.holdout.kept.profitFactor == null ? '—' : f(study.holdout.kept.profitFactor, 2)} | ${f(study.holdout.all.mae10PctPoints)} | ${f(study.holdout.kept.mae10PctPoints)} | ${study.evidence.verdict} |`).join('\n');
  const candidates = report.studies.filter((study) => study.evidence.verdict === 'candidate_only').map((study) => study.label);
  const markdown = `# V2.9.2 不交易否決層研究\n\n產生時間：${report.generatedAt}\n\n## 結論\n\n- 研究目標是先排除容易出現較差風險路徑的環境，不是提升表面方向命中率。\n- 所有分位門檻只使用開發期計算，再套用最終保留期；沒有用保留期挑門檻。\n- 第一階段候選：${candidates.length ? candidates.join('、') : '沒有條件通過最低候選門檻'}。\n- 即使標為候選，也不會自動加入首頁或實際交易，須增加樣本與滾動驗證。\n\n## 最終保留期結果\n\n| 否決條件 | 被排除交易 | 原始PF | 保留後PF | 原始最差10% MAE | 保留後最差10% MAE | 判定 |\n|---|---:|---:|---:|---:|---:|---|\n${rowsMd}\n\n## 門檻（僅由開發期產生）\n\n- ATR20 Q75：${f(report.thresholds.atr20DevelopmentQ75)} 點\n- 前一可得美國 VIX Q75：${f(report.thresholds.previousUsVixDevelopmentQ75, 2)}\n- 外資現貨5日絕對值中位數：${f(report.thresholds.foreignSpot5dAbsoluteMedian, 1)} 億\n\n## 限制\n\n- ${report.limitation}\n- 日K只能知道高低點，不能知道盤中先後順序。\n- 目前基準策略仍是研究候選，不是已核准交易策略。\n`;
  fs.mkdirSync(config.reportsPath, { recursive: true });
  fs.writeFileSync(path.join(config.reportsPath, 'no-trade-veto.json'), `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(path.join(config.reportsPath, 'V2_9_2_NO_TRADE_VETO_REPORT.md'), markdown);
  console.log(JSON.stringify({ generatedAt: report.generatedAt, sample: report.sample, thresholds: report.thresholds, studies: report.studies.map(({ key, holdout, evidence }) => ({ key, holdout, evidence })) }, null, 2));
} finally { db.close(); }


import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { evaluateHoldout, loadResearchRows, strategyDefinitions, walkForward } from '../src/backtest-engine.mjs';
import { alignDailySeries, matchedLongDrift, movingBlockBootstrapDifference } from '../src/paired-bootstrap.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db); const split = Math.floor(rows.length * 0.8);
  const assumptions = { costPoints: 8, quantileLow: 0.30, quantileHigh: 0.70, minTrainDays: 160, testWindowDays: 20, holdoutPct: 0.20 };
  const definitions = strategyDefinitions();
  const families = ['chip_incremental_h2', 'chip_incremental_h3'].map((family) => {
    const strategies = definitions.filter((item) => item.researchFamily === family && ['full_candidate', 'benchmark', 'ablation'].includes(item.researchRole));
    const candidate = strategies.find((item) => item.researchRole === 'full_candidate');
    const development = Object.fromEntries(strategies.map((strategy) => [strategy.key, walkForward(rows.slice(0, split), strategy, assumptions).daily]));
    const holdout = Object.fromEntries(strategies.map((strategy) => [strategy.key, evaluateHoldout(rows, strategy, assumptions).daily]));
    const compare = (series, period) => {
      const withDrift = { ...series, matched_long_drift: matchedLongDrift(series[candidate.key], assumptions.costPoints) };
      const aligned = alignDailySeries(withDrift);
      return {
        period, firstDate: aligned[0]?.tradeDate || null, lastDate: aligned.at(-1)?.tradeDate || null, commonDays: aligned.length,
        comparisons: Object.keys(withDrift).filter((key) => key !== candidate.key).map((key, index) => ({
          candidateKey: candidate.key, comparatorKey: key,
          ...movingBlockBootstrapDifference(aligned, candidate.key, key, { iterations: 2_000, blockSize: 5, seed: 20260714 + index }),
        })),
      };
    };
    return { family, holdingDays: candidate.holdingDays, strategyKeys: strategies.map((item) => item.key), development: compare(development, 'development_walk_forward'), holdout: compare(holdout, 'final_holdout') };
  });
  const report = { generatedAt: new Date().toISOString(), version: '2.9.4', researchRows: rows.length, status: 'research_only',
    method: 'All strategies use identical test dates. Five-day moving-block bootstrap is applied to daily net-point differences; matched long drift uses the candidate entry/exit opportunities but forces long direction.', families,
    decision: 'Only a positive 95% lower bound is treated as paired incremental support. Reused holdout remains non-pristine and requires new forward confirmation.' };
  fs.writeFileSync(path.join(config.reportsPath, 'paired-incremental.json'), `${JSON.stringify(report, null, 2)}\n`);
  const f = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits);
  const lines = families.flatMap((family) => [family.development, family.holdout].flatMap((period) => period.comparisons.map((item) =>
    `| ${family.holdingDays}日 | ${period.period} | ${item.comparatorKey} | ${item.days} | ${f(item.observedTotalDifference, 0)} | ${f(item.ci95[0], 0)}～${f(item.ci95[1], 0)} | ${f(item.probabilityPositive * 100, 1)}% | ${item.supported ? '支持' : '不支持'} |`)));
  const markdown = `# V2.9.4 共同日期配對增量檢驗\n\n產生時間：${report.generatedAt}\n\n${report.decision}\n\n| 持有 | 區間 | 比較基準 | 共同日 | 候選淨點差 | 95%區間 | 大於0機率 | 判定 |\n|---:|---|---|---:|---:|---:|---:|---|\n${lines.join('\n')}\n\n## 限制\n\n- Bootstrap單位是每日淨點數差，保留5日區塊以降低序列相依造成的假精準。\n- matched_long_drift只在候選實際交易機會上強制做多，用來檢查結果是否只是長期上漲漂移。\n- 最終留出區已在舊版本檢視過，不能再稱為全新樣本。\n`;
  fs.writeFileSync(path.join(config.reportsPath, 'V2_9_4_PAIRED_INCREMENTAL_REPORT.md'), markdown);
  console.log(JSON.stringify({ generatedAt: report.generatedAt, families }, null, 2));
} finally { db.close(); }

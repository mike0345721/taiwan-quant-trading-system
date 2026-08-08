import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const reports = path.join(root, 'reports');
const baselinePath = path.join(reports, 'oi-research-baseline-pre-v3.3.json');
const read = (name) => JSON.parse(fs.readFileSync(path.join(reports, name), 'utf8'));
const round = (value, digits = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;

function snapshot() {
  const backtest = read('latest-backtest.json');
  const targets = read('multi-target-research.json');
  return {
    generatedAt: new Date().toISOString(),
    sourceGeneratedAt: { backtest: backtest.generatedAt, targets: targets.generatedAt },
    researchRows: backtest.researchRows,
    oiStrategies: backtest.strategies.filter((item) => item.key.includes('price_oi')).map((item) => ({
      key: item.key, gate: item.gate,
      development: {
        trades: item.metrics?.trades, profitFactor: round(item.metrics?.profitFactor),
        totalNetPoints: round(item.metrics?.totalNetPoints), maxDrawdownPoints: round(item.metrics?.maxDrawdownPoints),
      },
      holdout: {
        trades: item.holdout?.metrics?.trades, profitFactor: round(item.holdout?.metrics?.profitFactor),
        totalNetPoints: round(item.holdout?.metrics?.totalNetPoints), maxDrawdownPoints: round(item.holdout?.metrics?.maxDrawdownPoints),
      },
    })),
    targets: targets.studies.map((item) => {
      const noOi = item.ablations?.find((entry) => entry.excludedGroup === 'oi');
      return {
        key: item.key, verdict: item.verdict,
        holdout: { samples: item.holdout?.samples, auc: round(item.holdout?.auc), lift: round(item.holdout?.lift) },
        withoutOi: noOi ? { auc: round(noOi.auc), lift: round(noOi.lift), aucChangeVsFull: round(noOi.aucChangeVsFull), liftChangeVsFull: round(noOi.liftChangeVsFull) } : null,
      };
    }),
  };
}

if (process.argv.includes('--capture-baseline')) {
  if (!fs.existsSync(baselinePath)) fs.writeFileSync(baselinePath, `${JSON.stringify(snapshot(), null, 2)}\n`, 'utf8');
  console.log(`Baseline ready: ${baselinePath}`);
  process.exit(0);
}
if (!fs.existsSync(baselinePath)) throw new Error('Run with --capture-baseline before rerunning research.');
const baseline = JSON.parse(fs.readFileSync(baselinePath, 'utf8'));
const current = snapshot();
const beforeStrategies = new Map(baseline.oiStrategies.map((item) => [item.key, item]));
const beforeTargets = new Map(baseline.targets.map((item) => [item.key, item]));
const comparison = {
  generatedAt: new Date().toISOString(),
  definitionChange: 'mixed COALESCE(total_market_oi, near_contract_oi) -> near_contract_oi only; rollover and contract-change deltas excluded',
  rows: { before: baseline.researchRows, after: current.researchRows },
  oiStrategies: current.oiStrategies.map((after) => {
    const before = beforeStrategies.get(after.key);
    return { key: after.key, before, after, holdoutProfitFactorChange: round(after.holdout.profitFactor - before?.holdout?.profitFactor), holdoutTradesChange: after.holdout.trades - (before?.holdout?.trades || 0) };
  }),
  targets: current.targets.map((after) => {
    const before = beforeTargets.get(after.key);
    return { key: after.key, before, after, aucChange: round(after.holdout.auc - before?.holdout?.auc), liftChange: round(after.holdout.lift - before?.holdout?.lift) };
  }),
  conclusion: 'This is a data-definition correction audit, not proof of a tradable edge. Any material change means the old result must not be compared without noting the OI definition.',
};
fs.writeFileSync(path.join(reports, 'oi-research-impact-v3.3.json'), `${JSON.stringify(comparison, null, 2)}\n`, 'utf8');
const lines = [
  '# V3.3 OI 口徑修正研究影響', '',
  `產生時間：${comparison.generatedAt}`, '',
  '## 修正', '',
  '- 研究 OI 固定使用台指近月契約未平倉量。',
  '- 全市場 OI 保留為不同欄位，不再以 COALESCE 混入近月序列。',
  '- 結算轉倉窗與契約更換日不計算 OI 變化量。', '',
  '## OI 策略前後比較', '',
  '| 策略 | 舊樣本 | 新樣本 | 舊樣本外 PF | 新樣本外 PF | PF 變化 |',
  '|---|---:|---:|---:|---:|---:|',
  ...comparison.oiStrategies.map((item) => `| ${item.key} | ${item.before?.holdout?.trades ?? '-'} | ${item.after.holdout.trades ?? '-'} | ${item.before?.holdout?.profitFactor ?? '-'} | ${item.after.holdout.profitFactor ?? '-'} | ${item.holdoutProfitFactorChange ?? '-'} |`),
  '', '## 解讀', '',
  '- 這份比較回答「資料口徑修正後，舊研究改變多少」，不是證明策略有效。',
  '- 樣本外結果、折疊穩定性與成本測試仍必須同時通過，才可進入模擬交易。',
];
fs.writeFileSync(path.join(reports, 'V3_3_OI_RESEARCH_IMPACT.md'), `${lines.join('\n')}\n`, 'utf8');
console.log(JSON.stringify({ output: 'oi-research-impact-v3.3.json', strategies: comparison.oiStrategies.length, targets: comparison.targets.length }, null, 2));

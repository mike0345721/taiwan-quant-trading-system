import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';

const config = v2Config();
const input = path.join(config.reportsPath, 'latest-backtest.json');
const backtest = JSON.parse(fs.readFileSync(input, 'utf8'));

const selectedKeys = [
  'foreign_futures_price_oi_h2',
  'foreign_price_oi_no_highvol_h2',
  'foreign_futures_price_oi_h3',
  'foreign_price_oi_no_highvol_h3',
];

function riskSummary(metrics) {
  return {
    trades: metrics?.trades ?? 0,
    profitFactor: metrics?.profitFactor ?? null,
    totalNetPoints: metrics?.totalNetPoints ?? 0,
    maxDrawdownPoints: metrics?.maxDrawdownPoints ?? 0,
    averageMaePoints: metrics?.averageMaePoints ?? null,
    mae10PctPoints: metrics?.mae10PctPoints ?? null,
    worstMaePoints: metrics?.worstMaePoints ?? null,
    averageMfePoints: metrics?.averageMfePoints ?? null,
    mfe90PctPoints: metrics?.mfe90PctPoints ?? null,
    averageMfeMaeRatio: metrics?.averageMfeMaeRatio ?? null,
  };
}

const studies = selectedKeys.map((key) => {
  const strategy = backtest.strategies.find((item) => item.key === key);
  if (!strategy) throw new Error(`Missing strategy in latest backtest: ${key}`);
  return {
    key,
    label: strategy.label,
    gate: strategy.gate,
    development: riskSummary(strategy.metrics),
    holdout: riskSummary(strategy.holdout?.metrics),
  };
});

const report = {
  generatedAt: new Date().toISOString(),
  sourceGeneratedAt: backtest.generatedAt,
  executionModelVersion: backtest.assumptions?.executionModelVersion,
  definitions: {
    mae: '持有期間相對進場價的最大不利走勢；多單用最低價、空單用最高價。數值越負，途中風險越大。',
    mfe: '持有期間相對進場價的最大有利走勢；數值越高，代表曾經可取得的順向空間越大。',
    mae10Pct: '最差10%交易的MAE分位界線，用來估計尾端停損風險，不是建議停損點。',
    limitation: '目前為日K高低價路徑，無法知道盤中先碰高點或低點；不可直接據此最佳化停損停利。',
  },
  studies,
};

const f = (value, digits = 1) => value == null ? '—' : Number(value).toFixed(digits);
const rows = studies.flatMap((study) => [
  `| ${study.label} | 開發期 | ${study.development.trades} | ${f(study.development.profitFactor, 2)} | ${f(study.development.averageMaePoints)} | ${f(study.development.mae10PctPoints)} | ${f(study.development.worstMaePoints)} | ${f(study.development.averageMfePoints)} |`,
  `| ${study.label} | 最終保留期 | ${study.holdout.trades} | ${f(study.holdout.profitFactor, 2)} | ${f(study.holdout.averageMaePoints)} | ${f(study.holdout.mae10PctPoints)} | ${f(study.holdout.worstMaePoints)} | ${f(study.holdout.averageMfePoints)} |`,
]);

const markdown = `# V2.7 MAE／MFE 風險路徑報告

產生時間：${report.generatedAt}  
回測來源：${report.sourceGeneratedAt}  
執行模型：${report.executionModelVersion}

## 結論

- V2.7 已把「最後賺或賠多少」擴充成「持有途中最多先承受多少逆風、曾出現多少順風」。
- 高波動過濾後的保留期數字雖較漂亮，但 H2 只有 11 筆、H3 只有 10 筆，仍屬樣本不足，不能當成正式交易規則。
- H2 完整條件保留期的平均 MAE 約 ${f(studies[0].holdout.averageMaePoints)} 點，最差 10% 界線約 ${f(studies[0].holdout.mae10PctPoints)} 點；這說明多日持有可能承受很大的途中逆向波動。
- 此階段最重要的用途是辨識「不適合持有」的環境，而不是從少量樣本倒推出完美停損。

## 指標定義

- **MAE**：最大不利走勢，越負代表途中風險越大。
- **MFE**：最大有利走勢，越高代表曾經出現的順向空間越大。
- **MAE 最差 10%**：尾端風險界線，不是建議停損點。
- 目前只使用日 K 高低價，無法知道當天先碰高或先碰低。

## 核心結果

| 條件 | 區間 | 交易數 | PF | 平均 MAE | 最差10% MAE | 最差 MAE | 平均 MFE |
|---|---|---:|---:|---:|---:|---:|---:|
${rows.join('\n')}

## 專業判讀

1. 勝率或 PF 不能單獨回答「實際上能不能抱住」；MAE 顯示策略途中可能需要承受的壓力。
2. 高波動過濾目前有改善跡象，但也大幅減少交易數，須增加歷史樣本並做分段驗證。
3. 下一步應把 MAE／MFE 依市場狀態、方向、多空衝突程度分組，先找出尾端風險明顯較差的禁做環境。
4. 在取得 5 分鐘資料前，不進行精細停損最佳化，以免日 K 路徑順序不明造成假精準。
`;

fs.mkdirSync(config.reportsPath, { recursive: true });
fs.writeFileSync(path.join(config.reportsPath, 'excursion-risk.json'), `${JSON.stringify(report, null, 2)}\n`);
fs.writeFileSync(path.join(config.reportsPath, 'V2_7_EXCURSION_RISK_REPORT.md'), markdown);
console.log(JSON.stringify(report, null, 2));

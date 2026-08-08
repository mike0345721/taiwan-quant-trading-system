import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { analyzeTargetFeasibility } from '../src/target-feasibility.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  const report = analyzeTargetFeasibility(loadResearchRows(db));
  const backtestPath = path.join(config.reportsPath, 'latest-backtest.json');
  if (fs.existsSync(backtestPath)) {
    const backtest = JSON.parse(fs.readFileSync(backtestPath, 'utf8'));
    const find = (key) => backtest.strategies?.find((row) => row.key === key);
    report.currentEvidence = {
      fullH2: find('foreign_futures_price_oi_h2') || null,
      fullH3: find('foreign_futures_price_oi_h3') || null,
      noHighVolH2: find('foreign_price_oi_no_highvol_h2') || null,
      noHighVolH3: find('foreign_price_oi_no_highvol_h3') || null,
    };
  }
  report.scoreArchitecture = {
    principle: '分開輸出方向、環境、風險與可交易性；未驗證前不合成單一勝率分數',
    outputs: [
      { key: 'direction', range: '-100..100', meaning: '只表示偏多或偏空強度' },
      { key: 'trendEnvironment', range: '0..100', meaning: '較像趨勢環境的機率／分位' },
      { key: 'volatilityRisk', range: '0..100', meaning: '未來大波動與逆向波動風險' },
      { key: 'gapRisk', range: '0..100', meaning: '隔夜缺口風險' },
      { key: 'tradeability', range: '0..100', meaning: '扣除衝突、資料不足與高風險後是否值得交易' },
    ],
    controls: ['同一群高度相關因子只能取得一次群組加成', '風險否決優先於方向加分', '權重只在訓練折估計並在下一折驗證', '分數必須校準成實際樣本與報酬分布'],
  };
  fs.mkdirSync(config.reportsPath, { recursive: true });
  const output = path.join(config.reportsPath, 'target-feasibility.json');
  fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  console.log(`Target feasibility report: ${output}`);
  console.log(`Rows: ${report.sourceRows}; H1/H2/H3 samples: ${report.horizons[1].samples}/${report.horizons[2].samples}/${report.horizons[3].samples}`);
} finally { db.close(); }


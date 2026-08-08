import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { compareMirrorTrades } from '../src/mirror-backtest.mjs';

const config = v2Config(); const db = openDatabase(config.databasePath);
const reportPath = path.join(config.reportsPath, 'latest-backtest.json');
const source = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
const round = (value, digits = 3) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
const compact = (metrics) => Object.fromEntries(Object.entries(metrics).map(([key, value]) => [key, round(value)]));

try {
  const studies = source.strategies.map((strategy) => {
    const rows = db.prepare(`SELECT signal, gross_points AS grossPoints, cost_points AS costPoints, feature_snapshot_json AS snapshot
      FROM backtest_daily_results WHERE run_id=? ORDER BY trade_date`).all(strategy.runId)
      .map((row) => ({ ...row, split: JSON.parse(row.snapshot || '{}').split }));
    const development = compareMirrorTrades(rows.filter((row) => row.split === 'walk_forward'));
    const holdout = compareMirrorTrades(rows.filter((row) => row.split === 'final_holdout'));
    const samplesEnough = holdout.original.trades >= 15;
    const originalConsistent = development.original.profitFactor > 1 && development.mirror.profitFactor < 1
      && holdout.original.profitFactor > 1.15 && holdout.mirror.profitFactor < 0.85;
    const mirrorHoldout = holdout.mirror.profitFactor > 1.20 && holdout.original.profitFactor < 0.90;
    const mirrorConsistent = development.mirror.profitFactor > 1 && development.original.profitFactor < 1 && mirrorHoldout;
    const verdict = !samplesEnough ? 'insufficient_sample'
      : originalConsistent ? 'original_direction_supported'
        : mirrorConsistent ? 'contrarian_candidate'
          : mirrorHoldout ? 'holdout_only_contrarian'
            : 'inconclusive';
    return { key: strategy.key, label: strategy.label, gate: strategy.gate, samplesEnough, verdict,
      development: { original: compact(development.original), mirror: compact(development.mirror) },
      holdout: { original: compact(holdout.original), mirror: compact(holdout.mirror) } };
  });
  const report = {
    version: '3.3.0-mirror-diagnostic', generatedAt: new Date().toISOString(),
    methodology: 'Use the exact same active dates, entry/exit prices, holding periods and costs from the latest backtest; multiply every non-zero signal by -1. Thresholds and samples are not reselected.',
    caveat: 'Mirror results are diagnostics. A weak original does not authorize promoting its inverse without a new preregistered forward test.',
    counts: Object.fromEntries(['original_direction_supported', 'contrarian_candidate', 'holdout_only_contrarian', 'inconclusive', 'insufficient_sample'].map((key) => [key, studies.filter((item) => item.verdict === key).length])),
    studies,
  };
  fs.writeFileSync(path.join(config.reportsPath, 'mirror-backtest.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const eligible = studies.filter((item) => item.samplesEnough).sort((a, b) => (b.holdout.mirror.profitFactor || 0) - (a.holdout.mirror.profitFactor || 0));
  const lines = ['# 鏡像反向回測報告', '', `產生時間：${report.generatedAt}`, '',
    '## 方法', '', '- 完全沿用原策略的訊號日、進出場、持有天數與每筆 8 點成本。', '- 唯一改動是多空方向完全反轉。', '- 樣本外少於 15 筆只列資料，不作判斷。', '- 反向候選必須開發期與樣本外都呈現反向優於正向；只在樣本外翻轉者標為期間不穩定。', '',
    '## 樣本外比較', '', '| 策略 | 筆數 | 正向 PF | 反向 PF | 正向淨點 | 反向淨點 | 判讀 |', '|---|---:|---:|---:|---:|---:|---|',
    ...eligible.map((item) => `| ${item.label} | ${item.holdout.original.trades} | ${item.holdout.original.profitFactor ?? '-'} | ${item.holdout.mirror.profitFactor ?? '-'} | ${item.holdout.original.totalNetPoints} | ${item.holdout.mirror.totalNetPoints} | ${item.verdict} |`),
    '', '## 使用限制', '', '- 反向結果只用來辨認訊號可能是趨勢延續、均值回歸或沒有方向能力。', '- 若反向較好，仍須另立規格並以前推新資料驗證，不能直接採用。'];
  fs.writeFileSync(path.join(config.reportsPath, 'MIRROR_BACKTEST_REPORT.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ studies: studies.length, eligible: eligible.length, counts: report.counts }, null, 2));
} finally { db.close(); }

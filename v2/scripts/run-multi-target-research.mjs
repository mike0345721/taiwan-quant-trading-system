import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { runMultiTargetResearch } from '../src/multi-target-research.mjs';

function pct(value) { return Number.isFinite(Number(value)) ? `${(Number(value) * 100).toFixed(1)}%` : '—'; }
function num(value, digits = 2) { return Number.isFinite(Number(value)) ? Number(value).toFixed(digits) : '—'; }
function verdict(value) { return ({ supported_first_stage: '第一階段支持', preliminary_signal: '初步有增益', insufficient_holdout: '留出樣本不足', inverse_or_failed: '反向或失效', not_stable: '跨區間不穩定' })[value] || value; }

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  const report = runMultiTargetResearch(loadResearchRows(db));
  fs.mkdirSync(config.reportsPath, { recursive: true });
  fs.writeFileSync(path.join(config.reportsPath, 'multi-target-research.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = [
    '# V2.6.2 多目標等權群組研究報告', '',
    `產生時間：${report.generatedAt}`, '',
    '## 研究規則', '',
    '- 目標：未來大行情、盤後預測隔夜跳空、開盤前即時跳空風險、2／3日趨勢效率。',
    '- 因子分成價格、外資籌碼、市場OI、選擇權及海外風險五群，每群最多一票。',
    '- 所有極端門檻只使用當時訓練資料的分位數；最後20%資料完全留出。',
    '- 權重固定等權，不依結果調參；跨合約路徑已排除。', '',
    '## 結果', '',
    '| 目標 | 滾動樣本 | 滾動AUC | 滾動Lift | 留出樣本 | 留出AUC | 留出Lift | 判定 |',
    '|---|---:|---:|---:|---:|---:|---:|---|',
    ...report.studies.map((row) => `| ${row.label} | ${row.development.samples} | ${num(row.development.auc)} | ${num(row.development.lift)} | ${row.holdout.samples} | ${num(row.holdout.auc)} | ${num(row.holdout.lift)} | ${verdict(row.verdict)} |`),
    '', 'AUC 0.5約等於沒有排序能力；Lift 1.0表示被列為高風險的樣本，其命中率與全體基準相同。', '',
    '## 最終留出區塊抽樣95%區間', '',
    '| 目標 | AUC 95%區間 | Lift 95%區間 |',
    '|---|---:|---:|',
    ...report.studies.map((row) => `| ${row.label} | ${num(row.holdout.confidence?.auc95?.[0])}～${num(row.holdout.confidence?.auc95?.[1])} | ${num(row.holdout.confidence?.lift95?.[0])}～${num(row.holdout.confidence?.lift95?.[1])} |`),
    '', '區間使用5日區塊、500次重抽樣，保留短期時間相依性；區間跨過AUC 0.5或Lift 1.0時，仍不可視為已證實。', '',
    '## 目前結論', '',
    '- 1日大行情、盤後預測隔夜跳空、開盤前即時跳空風險與2日大行情，在開發及留出區均有正向增益，且留出AUC與Lift的95%區間下緣仍高於無效基準，列為第一階段支持。',
    '- 3日大行情只有點估計為正，AUC區間仍跨過0.5，只列初步線索。',
    '- 2／3日趨勢效率沒有穩定辨識力；3日版本明顯失效，本輪停止調整。',
    '- 消融顯示目前風險辨識主要來自價格風險，跳空另受海外群組幫助，2日大行情亦有市場OI與海外線索；外資籌碼與選擇權群組尚未證明提供增量價值。', '',
    '## 留出區命中率', '',
    '| 目標 | 基準率 | 高分組命中率 | 召回率 | 正向折數 |',
    '|---|---:|---:|---:|---:|',
    ...report.studies.map((row) => `| ${row.label} | ${pct(row.holdout.baseRate)} | ${pct(row.holdout.precision)} | ${pct(row.holdout.recall)} | ${row.positiveFolds}/${row.totalFolds} |`),
    '', '## 留出區逐群消融', '',
    '| 目標 | 移除後AUC下降最多 | AUC變化 | 移除後Lift變化 |',
    '|---|---|---:|---:|',
    ...report.studies.map((row) => { const worst = [...row.ablations].sort((a, b) => a.aucChangeVsFull - b.aucChangeVsFull)[0]; return `| ${row.label} | ${worst?.excludedGroup || '—'} | ${num(worst?.aucChangeVsFull, 3)} | ${num(worst?.liftChangeVsFull, 3)} |`; }),
    '', '群組名稱：price價格風險、chip外資籌碼、oi市場OI、option選擇權、global海外風險。移除後變好代表該群目前可能是雜訊，不可因因子數量多就給更多分。',
    '', '## 限制', '',
    '- 這是風險分類研究，不是方向策略績效，也沒有計算停損、部位大小或實際損益。',
    '- 尚未接入歷史VIX、美債殖利率、出口、外銷訂單、工業生產及景氣發布版本。',
    '- 趨勢／震盪只有日資料路徑近似，不能替代5分鐘盤型。',
    '- 現有多日方向回測仍須補上固定契約或明確轉倉成本，完成前不可進入模擬交易。',
    '', '## 研究停止點', '',
    '本輪到此停止，不調整權重、不增加條件。只有開發與留出同時達到預先門檻者才列初步線索；其他結果保留作否證。',
  ];
  fs.writeFileSync(path.join(config.reportsPath, 'V2_6_2_MULTI_TARGET_REPORT.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(`Multi-target studies: ${report.studies.length}`);
  for (const row of report.studies) console.log(`${row.key}: dev AUC ${num(row.development.auc)} lift ${num(row.development.lift)}; holdout AUC ${num(row.holdout.auc)} lift ${num(row.holdout.lift)}; ${row.verdict}`);
} finally { db.close(); }

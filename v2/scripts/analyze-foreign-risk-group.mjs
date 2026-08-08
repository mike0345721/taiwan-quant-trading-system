import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { buildForeignRiskGroup } from '../src/foreign-risk-group.mjs';
import { classifyLargeMoveEvents } from '../src/reverse-event-study.mjs';

const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const round = (value, digits = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;
function summarize(rows, baseRate) {
  const groups = [0, 1, 2, 3].map((count) => {
    const selected = rows.filter((row) => row.activeCount === count);
    const falls = selected.filter((row) => row.nextEventType === 'large_fall').length;
    return { activeCount: count, samples: selected.length, largeFalls: falls,
      largeFallRate: selected.length ? round(falls / selected.length) : null,
      liftVsBase: selected.length && baseRate ? round((falls / selected.length) / baseRate) : null,
      averageNextDayReturnPct: round(mean(selected.map((row) => row.nextDayReturnPct))) };
  });
  const alert = rows.filter((row) => row.activeCount >= 2); const alertFalls = alert.filter((row) => row.nextEventType === 'large_fall').length;
  return { groups, alert: { samples: alert.length, largeFalls: alertFalls,
    largeFallRate: alert.length ? round(alertFalls / alert.length) : null,
    liftVsBase: alert.length && baseRate ? round((alertFalls / alert.length) / baseRate) : null,
    averageNextDayReturnPct: round(mean(alert.map((row) => row.nextDayReturnPct))) } };
}

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  const rows = loadResearchRows(db); const events = classifyLargeMoveEvents(rows, { startDate: '2023-07-14' });
  const eventByDate = new Map(events.map((item) => [item.row.tradeDate, item.type]));
  const evaluated = [];
  for (let index = 160; index < rows.length - 1; index += 1) {
    const current = rows[index]; const next = rows[index + 1];
    if (current.txContract !== next.txContract) continue;
    const group = buildForeignRiskGroup(rows.slice(0, index), current);
    if (!group.available) continue;
    evaluated.push({ signalDate: current.tradeDate, targetDate: next.tradeDate, activeCount: group.activeCount,
      nextEventType: eventByDate.get(next.tradeDate) || null, nextDayReturnPct: next.sameDayReturnPct });
  }
  const baseFalls = evaluated.filter((row) => row.nextEventType === 'large_fall').length;
  const baseRate = evaluated.length ? baseFalls / evaluated.length : null;
  const split = Math.floor(evaluated.length * 0.8);
  const report = {
    version: '3.4.0', generatedAt: new Date().toISOString(),
    methodology: 'Past-only 30/70 percentile thresholds. Three correlated foreign features collapse into one group; alert requires at least two. Outcome is next Taiwan day large-fall classification.',
    samples: evaluated.length, baseLargeFalls: baseFalls, baseLargeFallRate: round(baseRate),
    development: summarize(evaluated.slice(0, split), baseRate), holdout: summarize(evaluated.slice(split), baseRate),
    current: buildForeignRiskGroup(rows.slice(0, -1), rows.at(-1)),
    caveat: 'Historical holdout has already been inspected and is not a fresh forward sample. This group remains a risk filter, not an entry signal.',
  };
  fs.writeFileSync(path.join(config.reportsPath, 'foreign-risk-group-v3.4.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const lines = ['# V3.4 外資大跌風險群組', '', `樣本：${report.samples}｜次日大跌基準率：${round(baseRate * 100, 2)}%`, '',
    '三個組成只合併為一組：外資期貨5日淨部位轉差、外資3日累積加空、外資現貨5日賣超。成立2項才警戒。', '',
    '## 最終樣本外', '', '| 成立項數 | 樣本 | 次日大跌 | 大跌率 | 相對基準 | 次日日盤平均 |', '|---:|---:|---:|---:|---:|---:|',
    ...report.holdout.groups.map((item) => `| ${item.activeCount} | ${item.samples} | ${item.largeFalls} | ${item.largeFallRate == null ? '-' : round(item.largeFallRate * 100, 2) + '%'} | ${item.liftVsBase ?? '-'}x | ${item.averageNextDayReturnPct ?? '-'}% |`), '',
    `2項以上合併：${report.holdout.alert.samples}筆，大跌率${report.holdout.alert.largeFallRate == null ? '-' : round(report.holdout.alert.largeFallRate * 100, 2) + '%'}，相對基準${report.holdout.alert.liftVsBase ?? '-'}x。`, '',
    '此結果是風險環境研究，不代表成立後應直接做空。'];
  fs.writeFileSync(path.join(config.reportsPath, 'V3_4_FOREIGN_RISK_GROUP.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ samples: report.samples, baseRate: report.baseLargeFallRate, holdout: report.holdout.alert, current: report.current }, null, 2));
} finally { db.close(); }

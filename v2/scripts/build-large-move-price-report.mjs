import fs from 'node:fs';
import path from 'node:path';
import { v2Config } from '../src/config.mjs';
import { openDatabase } from '../src/db.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { analyzeReverseEvents, classifyLargeMoveEvents } from '../src/reverse-event-study.mjs';

const FEATURES = {
  foreignSpot: '外資現貨單日', foreignSpot3d: '外資現貨3日', foreignSpot5d: '外資現貨5日',
  foreignFuturesDelta1d: '外資期貨淨部位1日變化', foreignFuturesDelta5d: '外資期貨淨部位5日變化',
  foreignShortDelta1d: '外資空單1日變化', foreignShortDelta3d: '外資空單3日變化',
  marketOiDelta1d: '近月OI 1日變化', marketOiDelta3d: '近月OI 3日變化',
  marginBalanceDelta1dE: '融資餘額1日變化', marginBalanceDelta5dE: '融資餘額5日變化',
  optionPc: '主力契約OI P/C', maxPainDistanceChange: 'Max Pain距離變化',
  soxReturnPct: '費半前一晚報酬', ndxReturnPct: 'Nasdaq-100前一晚報酬', usdtwdReturnPct: '美元台幣前期報酬', fredVix: '美國VIX',
};
const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
function pearson(pairs) {
  if (pairs.length < 20) return null;
  const xs = pairs.map((item) => item[0]); const ys = pairs.map((item) => item[1]);
  const mx = mean(xs); const my = mean(ys);
  const numerator = pairs.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const dx = Math.sqrt(xs.reduce((sum, x) => sum + (x - mx) ** 2, 0));
  const dy = Math.sqrt(ys.reduce((sum, y) => sum + (y - my) ** 2, 0));
  return dx && dy ? numerator / (dx * dy) : null;
}
const round = (value, digits = 4) => Number.isFinite(Number(value)) ? Number(Number(value).toFixed(digits)) : null;

const config = v2Config(); const db = openDatabase(config.databasePath);
try {
  const rows = loadResearchRows(db); const startDate = '2023-07-14';
  const classified = classifyLargeMoveEvents(rows, { startDate });
  const eventStudy = analyzeReverseEvents(rows, { startDate, windows: [1, 3, 5] });
  const correlations = [];
  for (const [feature, label] of Object.entries(FEATURES)) {
    for (const lag of [1, 3, 5]) {
      const allPairs = []; const risePairs = []; const fallPairs = [];
      for (const item of classified) {
        const prior = classified[item.index - lag]?.row;
        if (!prior || !finite(prior[feature]) || !finite(item.row.sameDayReturnPct)) continue;
        const pair = [Number(prior[feature]), Number(item.row.sameDayReturnPct)];
        allPairs.push(pair); if (item.type === 'large_rise') risePairs.push(pair); if (item.type === 'large_fall') fallPairs.push(pair);
      }
      const candidateRise = eventStudy.studies.find((item) => item.eventType === 'large_rise' && item.precursorDays === lag && item.feature === feature);
      const candidateFall = eventStudy.studies.find((item) => item.eventType === 'large_fall' && item.precursorDays === lag && item.feature === feature);
      correlations.push({ feature, label, lag, samples: allPairs.length, priceCorrelation: round(pearson(allPairs)),
        largeRiseCorrelation: round(pearson(risePairs)), largeFallCorrelation: round(pearson(fallPairs)),
        riseEffect: round(candidateRise?.standardizedDifference), riseStatus: candidateRise?.status,
        fallEffect: round(candidateFall?.standardizedDifference), fallStatus: candidateFall?.status });
    }
  }
  const candidateRows = eventStudy.candidates.map((item) => ({ ...item, label: FEATURES[item.feature] || item.feature,
    priceCorrelation: correlations.find((entry) => entry.feature === item.feature && entry.lag === item.precursorDays)?.priceCorrelation ?? null }));
  const report = {
    version: '3.3.0-price-relationship', generatedAt: new Date().toISOString(),
    eventDefinition: eventStudy.methodology.eventThreshold, period: { firstDate: eventStudy.firstDate, lastDate: eventStudy.lastDate, rows: eventStudy.sourceRows },
    eventCounts: eventStudy.eventCounts,
    interpretation: { correlation: 'Pearson correlation between the lagged feature and the later event-day open-to-close return.', effect: 'Standardized difference versus a same-regime non-event control. Positive means higher before the event; negative means lower.' },
    candidateRows, correlations,
  };
  fs.writeFileSync(path.join(config.reportsPath, 'large-move-price-relationship.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  const falls = candidateRows.filter((item) => item.eventType === 'large_fall').slice(0, 12);
  const rises = candidateRows.filter((item) => item.eventType === 'large_rise').slice(0, 12);
  const rowText = (item) => `| ${item.precursorDays}日 | ${item.label} | ${round(item.eventMean, 2)} | ${round(item.controlMean, 2)} | ${round(item.standardizedDifference, 2)} | ${item.priceCorrelation ?? '-'} |`;
  const lines = ['# 台指大漲大跌前兆與價格關係報告', '', `期間：${eventStudy.firstDate}～${eventStudy.lastDate}｜大漲 ${eventStudy.eventCounts.large_rise} 次｜大跌 ${eventStudy.eventCounts.large_fall} 次｜大區間 ${eventStudy.eventCounts.large_range} 次`, '',
    '## 方法', '', `- 大行情定義：${eventStudy.methodology.eventThreshold}`, '- 前兆分別取事件前1、3、5個交易日。', '- 效果值是與相同市場狀態的一般日比較；絕對值0.35以上且前後半期同方向才列候選。', '- 價格相關係數是前兆數值與之後事件日日盤開收報酬的線性關係，不代表因果。', '',
    '## 大跌前候選跡象', '', '| 提前 | 因子 | 大跌前平均 | 一般日平均 | 效果值 | 全樣本價格相關 |', '|---|---|---:|---:|---:|---:|', ...falls.map(rowText), '',
    '## 大漲前候選跡象', '', '| 提前 | 因子 | 大漲前平均 | 一般日平均 | 效果值 | 全樣本價格相關 |', '|---|---|---:|---:|---:|---:|', ...rises.map(rowText), '',
    '## 專業解讀原則', '', '- 候選跡象是風險環境提示，不是單獨進場訊號。', '- 若效果值大但價格相關接近0，代表它可能只在極端事件前有辨識力，不適合預測每日漲跌。', '- 同一因子在大漲與大跌都出現時，更可能是波動放大訊號，而非方向訊號。', '- 下一步必須把候選規則固定後做walk-forward與全新前推驗證。'];
  fs.writeFileSync(path.join(config.reportsPath, 'LARGE_MOVE_PRICE_RELATIONSHIP_REPORT.md'), `${lines.join('\n')}\n`, 'utf8');
  console.log(JSON.stringify({ events: eventStudy.eventCounts, candidates: candidateRows.length, correlations: correlations.length }, null, 2));
} finally { db.close(); }

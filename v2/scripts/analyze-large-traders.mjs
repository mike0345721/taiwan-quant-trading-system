import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const db = new DatabaseSync(path.join(root, 'data', 'research-v2.sqlite'), { readOnly: true });

function finite(value) { if (value == null || value === '') return null; const number = Number(value); return Number.isFinite(number) ? number : null; }
function difference(left, right) { const a = finite(left); const b = finite(right); return a == null || b == null ? null : a - b; }
function average(values) { const clean = values.filter((value) => value != null); return clean.length ? clean.reduce((a, b) => a + b, 0) / clean.length : null; }
function quantile(values, q) {
  const clean = values.filter((value) => value != null).sort((a, b) => a - b);
  if (!clean.length) return null;
  const index = (clean.length - 1) * q; const lower = Math.floor(index); const upper = Math.ceil(index);
  return clean[lower] + (clean[upper] - clean[lower]) * (index - lower);
}
function correlation(pairs) {
  const clean = pairs.filter(([x, y]) => x != null && y != null);
  if (clean.length < 3) return null;
  const mx = average(clean.map(([x]) => x)); const my = average(clean.map(([, y]) => y));
  const numerator = clean.reduce((sum, [x, y]) => sum + (x - mx) * (y - my), 0);
  const denominator = Math.sqrt(clean.reduce((sum, [x]) => sum + (x - mx) ** 2, 0) * clean.reduce((sum, [, y]) => sum + (y - my) ** 2, 0));
  return denominator ? numerator / denominator : null;
}
function round(value, digits = 4) { return value == null ? null : Number(value.toFixed(digits)); }

const raw = db.prepare(`SELECT a.trade_date,
  a.top5_long, a.top5_short, a.top10_long, a.top10_short,
  a.top5_long_specific, a.top5_short_specific, a.top10_long_specific, a.top10_short_specific,
  a.market_open_interest,
  n.top5_long AS near_top5_long, n.top5_short AS near_top5_short,
  n.top10_long AS near_top10_long, n.top10_short AS near_top10_short,
  n.market_open_interest AS near_market_oi,
  m.tx_close, m.tx_change_pct,
  f.open AS tx_open, f.high AS tx_high, f.low AS tx_low, f.close AS active_close,
  o.rollover_risk, o.days_to_near_expiry
FROM large_trader_futures_daily a
LEFT JOIN large_trader_futures_daily n ON n.trade_date=a.trade_date AND n.expiry_scope='near_month'
LEFT JOIN market_daily m ON m.trade_date=a.trade_date
LEFT JOIN futures_contract_daily f ON f.trade_date=a.trade_date AND f.product='TX' AND f.is_active=1
LEFT JOIN futures_oi_daily o ON o.trade_date=a.trade_date
WHERE a.expiry_scope='all_contracts'
GROUP BY a.trade_date ORDER BY a.trade_date`).all();

const rows = raw.map((row) => ({
  ...row,
  top5Net: difference(row.top5_long, row.top5_short),
  top10Net: difference(row.top10_long, row.top10_short),
  top5SpecificNet: difference(row.top5_long_specific, row.top5_short_specific),
  top10SpecificNet: difference(row.top10_long_specific, row.top10_short_specific),
  nearTop5Net: difference(row.near_top5_long, row.near_top5_short),
  nearTop10Net: difference(row.near_top10_long, row.near_top10_short),
  nearOiShare: row.market_open_interest ? finite(row.near_market_oi) / finite(row.market_open_interest) : null,
  currentReturn: finite(row.tx_change_pct),
}));

for (let index = 0; index < rows.length; index += 1) {
  const row = rows[index]; const previous = rows[index - 1]; const next = rows[index + 1]; const third = rows[index + 3];
  for (const key of ['top5Net', 'top10Net', 'top5SpecificNet', 'top10SpecificNet', 'nearTop5Net', 'nearTop10Net']) {
    row[`${key}Delta1`] = previous ? difference(row[key], previous[key]) : null;
    row[`${key}Delta5`] = index >= 5 ? difference(row[key], rows[index - 5][key]) : null;
  }
  row.nextOpenCloseReturn = next?.tx_open && next?.active_close ? (next.active_close - next.tx_open) / next.tx_open * 100 : null;
  row.nextAbsOpenCloseReturn = row.nextOpenCloseReturn == null ? null : Math.abs(row.nextOpenCloseReturn);
  row.nextCloseReturn = next?.tx_close && row.tx_close ? (next.tx_close - row.tx_close) / row.tx_close * 100 : null;
  row.forward3CloseReturn = third?.tx_close && row.tx_close ? (third.tx_close - row.tx_close) / row.tx_close * 100 : null;
} 

const features = ['top5Net', 'top10Net', 'top5SpecificNet', 'top10SpecificNet', 'top5NetDelta1', 'top10NetDelta1', 'top5SpecificNetDelta1', 'top10SpecificNetDelta1', 'nearTop5NetDelta1', 'nearTop10NetDelta1', 'nearOiShare'];
const correlations = features.map((feature) => ({
  feature,
  sample: rows.filter((row) => row[feature] != null && row.nextOpenCloseReturn != null).length,
  nextOpenClose: round(correlation(rows.map((row) => [row[feature], row.nextOpenCloseReturn]))),
  nextAbsoluteMove: round(correlation(rows.map((row) => [row[feature], row.nextAbsOpenCloseReturn]))),
  forward3Close: round(correlation(rows.map((row) => [row[feature], row.forward3CloseReturn]))),
}));

const extremeStudies = features.filter((feature) => feature.includes('Delta1')).map((feature) => {
  const values = rows.map((row) => row[feature]); const low = quantile(values, 0.1); const high = quantile(values, 0.9);
  const summarize = (selected) => ({
    sample: selected.length,
    nextOpenCloseAvgPct: round(average(selected.map((row) => row.nextOpenCloseReturn))),
    nextUpRatePct: round(average(selected.map((row) => row.nextOpenCloseReturn == null ? null : row.nextOpenCloseReturn > 0 ? 100 : 0)), 2),
    nextAbsMoveAvgPct: round(average(selected.map((row) => row.nextAbsOpenCloseReturn))),
    forward3CloseAvgPct: round(average(selected.map((row) => row.forward3CloseReturn))),
  });
  return { feature, lowThreshold: low, highThreshold: high, low: summarize(rows.filter((row) => row[feature] <= low)), high: summarize(rows.filter((row) => row[feature] >= high)) };
});

function regimeSummary(selected) {
  return {
    sample: selected.length,
    nextOpenCloseAvgPct: round(average(selected.map((row) => row.nextOpenCloseReturn))),
    nextAbsMoveAvgPct: round(average(selected.map((row) => row.nextAbsOpenCloseReturn))),
    top5DeltaCorrelation: round(correlation(selected.map((row) => [row.top5NetDelta1, row.nextOpenCloseReturn]))),
    specificTop5DeltaCorrelation: round(correlation(selected.map((row) => [row.top5SpecificNetDelta1, row.nextOpenCloseReturn]))),
  };
}

const report = {
  generatedAt: new Date().toISOString(),
  definition: 'TAIFEX TX + MTX/4 + TMF/20; specific values are only specific institutional investors within the ranked accounts',
  coverage: { rows: rows.length, firstDate: rows[0]?.trade_date, lastDate: rows.at(-1)?.trade_date, withNextOpenClose: rows.filter((row) => row.nextOpenCloseReturn != null).length },
  correlations,
  extremeStudies,
  rolloverComparison: {
    rollover: regimeSummary(rows.filter((row) => row.rollover_risk === 1)),
    ordinary: regimeSummary(rows.filter((row) => row.rollover_risk !== 1)),
  },
  latest: rows.at(-1),
  cautions: [
    'Open interest is balanced market-wide; ranked-account net positions describe concentration, not new net contracts created from nothing.',
    'Specific institutional values include foreign institutions and are not a domestic-only measure.',
    'All signals are post-close data and may only be used from the next tradable session.',
  ],
};

fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports', 'latest-large-trader-research.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
db.close();

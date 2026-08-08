import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const root = path.resolve(import.meta.dirname, '..');
const reports = path.join(root, 'reports');
const gate = JSON.parse(fs.readFileSync(path.join(reports, 'v3-6-2-collection-audit.json'), 'utf8'));
if (gate.gates?.researchReady !== true || gate.gates?.timingAuditPassed !== true) {
  throw new Error('V3.6.2 research gate is closed.');
}

const db = new DatabaseSync(path.join(root, 'data', 'research-v2.sqlite'), { readOnly: true });
const COST = 8;
const HOLDOUT_PCT = 0.20;
const ITERATIONS = 2_000;
const BLOCK = 5;
const SEED = 20260716;

const finite = (value) => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
const mean = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
const quantile = (values, q) => {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * q;
  const lo = Math.floor(position); const hi = Math.ceil(position);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (position - lo);
};
const round = (value, digits = 4) => finite(value) ? Number(Number(value).toFixed(digits)) : null;

function rng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function bootstrapDifference(rows, selector, outcome, iterations = ITERATIONS, seed = SEED) {
  const random = rng(seed);
  const observed = difference(rows, selector, outcome);
  const draws = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const sampled = [];
    while (sampled.length < rows.length) {
      const start = Math.floor(random() * Math.max(1, rows.length - BLOCK + 1));
      sampled.push(...rows.slice(start, start + BLOCK));
    }
    const value = difference(sampled.slice(0, rows.length), selector, outcome);
    if (finite(value)) draws.push(value);
  }
  draws.sort((a, b) => a - b);
  const probabilityPositive = draws.length ? draws.filter((value) => value > 0).length / draws.length : null;
  return {
    observed: round(observed),
    ci95: [round(quantile(draws, 0.025)), round(quantile(draws, 0.975))],
    probabilityPositive: round(probabilityPositive),
    pRaw: finite(probabilityPositive) ? round(2 * Math.min(probabilityPositive, 1 - probabilityPositive), 6) : null,
  };
}

function difference(rows, selector, outcome) {
  const high = rows.filter((row) => selector(row) === 1 && finite(row[outcome])).map((row) => Number(row[outcome]));
  const low = rows.filter((row) => selector(row) === -1 && finite(row[outcome])).map((row) => Number(row[outcome]));
  return high.length && low.length ? mean(high) - mean(low) : null;
}

function summarizeTrades(rows, direction) {
  const trades = rows.map((row) => {
    const gross = direction * row.bucket * Number(row.nextPoints);
    return { ...row, signal: direction * row.bucket, gross, net: gross - COST };
  });
  const wins = trades.filter((row) => row.net > 0);
  const losses = trades.filter((row) => row.net < 0);
  const grossProfit = wins.reduce((sum, row) => sum + row.net, 0);
  const grossLoss = Math.abs(losses.reduce((sum, row) => sum + row.net, 0));
  let equity = 0; let peak = 0; let maxDrawdown = 0;
  for (const row of trades) { equity += row.net; peak = Math.max(peak, equity); maxDrawdown = Math.max(maxDrawdown, peak - equity); }
  return {
    trades: trades.length,
    longTrades: trades.filter((row) => row.signal > 0).length,
    shortTrades: trades.filter((row) => row.signal < 0).length,
    winRatePct: trades.length ? round(wins.length / trades.length * 100, 2) : null,
    averageNetPoints: round(mean(trades.map((row) => row.net)), 2),
    totalNetPoints: round(trades.reduce((sum, row) => sum + row.net, 0), 2),
    profitFactor: grossLoss ? round(grossProfit / grossLoss, 3) : null,
    maxDrawdownPoints: round(maxDrawdown, 2),
  };
}

function holm(items, key) {
  const valid = items.filter((item) => finite(item[key])).sort((a, b) => a[key] - b[key]);
  let running = 0;
  for (let index = 0; index < valid.length; index += 1) {
    running = Math.max(running, Math.min(1, valid[index][key] * (valid.length - index)));
    valid[index][`${key}Holm`] = round(running, 6);
  }
}

const futures = db.prepare(`SELECT trade_date, contract, open, high, low, close
  FROM futures_contract_daily WHERE product='TX' AND is_active=1
  ORDER BY trade_date`).all();
const byDate = new Map(futures.map((row, index) => [row.trade_date, { ...row, index }]));

function outcomes(tradeDate) {
  const current = byDate.get(tradeDate);
  if (!current) return null;
  const next = futures[current.index + 1];
  const third = futures[current.index + 3];
  if (!next || next.contract !== current.contract) return null;
  return {
    nextDate: next.trade_date,
    nextPoints: Number(next.close) - Number(next.open),
    nextAbsPoints: Math.abs(Number(next.close) - Number(next.open)),
    nextGapPoints: Number(next.open) - Number(current.close),
    h3Points: third && third.contract === current.contract ? Number(third.close) - Number(next.open) : null,
  };
}

const weekly = db.prepare(`SELECT trade_date, atm_iv, skew_25d, iv_rv_spread,
    ROW_NUMBER() OVER (PARTITION BY trade_date ORDER BY days_to_expiry, contract) AS rn
  FROM option_volatility_daily
  WHERE contract_type='weekly' AND days_to_expiry > 0 AND atm_iv IS NOT NULL`).all().filter((row) => row.rn === 1);
const term = db.prepare(`SELECT trade_date, monthly_minus_weekly_iv FROM option_volatility_term_daily`).all();
const lending = db.prepare(`SELECT trade_date, lending_balance, short_sale_balance
  FROM securities_lending_daily WHERE symbol='__TWSE_COMMON_STOCKS__' ORDER BY trade_date`).all();
const breadth = db.prepare(`SELECT trade_date, market, advance, decline
  FROM market_breadth_history_daily ORDER BY trade_date, market`).all();

const featuresByDate = new Map();
const put = (date, key, value) => {
  if (!featuresByDate.has(date)) featuresByDate.set(date, {});
  featuresByDate.get(date)[key] = finite(value) ? Number(value) : null;
};
for (const row of weekly) {
  put(row.trade_date, 'weeklyAtmIv', row.atm_iv);
  put(row.trade_date, 'weeklySkew25d', row.skew_25d);
  put(row.trade_date, 'weeklyIvRv', row.iv_rv_spread);
}
for (const row of term) put(row.trade_date, 'ivTermSpread', row.monthly_minus_weekly_iv);
for (let index = 0; index < lending.length; index += 1) {
  const row = lending[index]; const prior = lending[index - 5];
  put(row.trade_date, 'lendingBalanceChange5dPct', prior && Number(prior.lending_balance) !== 0 ? (Number(row.lending_balance) / Number(prior.lending_balance) - 1) * 100 : null);
  put(row.trade_date, 'shortSaleBalanceChange5dPct', prior && Number(prior.short_sale_balance) !== 0 ? (Number(row.short_sale_balance) / Number(prior.short_sale_balance) - 1) * 100 : null);
}
for (const row of breadth) {
  const denominator = Number(row.advance) + Number(row.decline);
  put(row.trade_date, row.market === 'TWSE' ? 'twseBreadth' : 'tpexBreadth', denominator ? (Number(row.advance) - Number(row.decline)) / denominator : null);
}

const definitions = [
  { stage: 'R4', key: 'weeklyAtmIv', label: '近週 ATM IV', family: 'option_volatility' },
  { stage: 'R4', key: 'weeklySkew25d', label: '近週 25D Skew', family: 'option_volatility' },
  { stage: 'R4', key: 'weeklyIvRv', label: '近週 IV-RV', family: 'option_volatility' },
  { stage: 'R4', key: 'ivTermSpread', label: '月選減週選 IV 期限差', family: 'option_term_structure' },
  { stage: 'R6', key: 'lendingBalanceChange5dPct', label: '借券餘額 5 日變化率', family: 'securities_lending' },
  { stage: 'R6', key: 'shortSaleBalanceChange5dPct', label: '借券賣出餘額 5 日變化率', family: 'securities_lending' },
  { stage: 'R6', key: 'twseBreadth', label: '上市市場廣度', family: 'market_breadth' },
  { stage: 'R6', key: 'tpexBreadth', label: '上櫃市場廣度', family: 'market_breadth' },
];

const studies = definitions.map((definition, featureIndex) => {
  const rows = [...featuresByDate.entries()].map(([tradeDate, values]) => ({ tradeDate, value: values[definition.key], ...outcomes(tradeDate) }))
    .filter((row) => finite(row.value) && finite(row.nextPoints)).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const split = Math.floor(rows.length * (1 - HOLDOUT_PCT));
  const development = rows.slice(0, split); const holdout = rows.slice(split);
  const low = quantile(development.map((row) => row.value), 0.25);
  const high = quantile(development.map((row) => row.value), 0.75);
  const assign = (row) => row.value <= low ? -1 : row.value >= high ? 1 : 0;
  const devTails = development.map((row) => ({ ...row, bucket: assign(row) })).filter((row) => row.bucket);
  const holdTails = holdout.map((row) => ({ ...row, bucket: assign(row) })).filter((row) => row.bucket);
  const directionalDev = bootstrapDifference(development, assign, 'nextPoints', ITERATIONS, SEED + featureIndex * 2);
  const directionalHoldout = bootstrapDifference(holdout, assign, 'nextPoints', ITERATIONS, SEED + featureIndex * 2 + 1);
  const riskDev = bootstrapDifference(development, assign, 'nextAbsPoints', ITERATIONS, SEED + 100 + featureIndex * 2);
  const riskHoldout = bootstrapDifference(holdout, assign, 'nextAbsPoints', ITERATIONS, SEED + 101 + featureIndex * 2);
  const direction = directionalDev.observed > 0 ? 1 : directionalDev.observed < 0 ? -1 : 0;
  const strategy = summarizeTrades(holdTails, direction || 1);
  const mirror = summarizeTrades(holdTails, -(direction || 1));
  const support = directionalDev.observed * directionalHoldout.observed > 0;
  const riskSupport = riskDev.observed * riskHoldout.observed > 0;
  return {
    ...definition,
    sourceRows: rows.length,
    firstDate: rows[0]?.tradeDate || null,
    lastDate: rows.at(-1)?.tradeDate || null,
    splitDate: holdout[0]?.tradeDate || null,
    thresholdsFromDevelopmentOnly: { low: round(low, 6), high: round(high, 6) },
    samples: { development: development.length, developmentTails: devTails.length, holdout: holdout.length, holdoutTails: holdTails.length },
    directional: { development: directionalDev, holdout: directionalHoldout, sameSign: support, strategy, mirror },
    risk: { development: riskDev, holdout: riskHoldout, sameSign: riskSupport },
    preliminaryLevel: support && holdTails.length >= 100 ? 3 : riskSupport && holdTails.length >= 60 ? 2 : holdTails.length >= 30 ? 1 : 0,
    preliminaryVerdict: holdTails.length < 30 ? 'insufficient_data' : support ? 'direction_observation_not_minimum_100' : riskSupport ? 'risk_observation' : 'not_supported',
  };
});

holm(studies.map((item) => item.directional.holdout), 'pRaw');
holm(studies.map((item) => item.risk.holdout), 'pRaw');
for (const item of studies) {
  item.directional.holdout.holmPassed = finite(item.directional.holdout.pRawHolm) && item.directional.holdout.pRawHolm <= 0.05;
  item.risk.holdout.holmPassed = finite(item.risk.holdout.pRawHolm) && item.risk.holdout.pRawHolm <= 0.05;
  if (!item.directional.holdout.holmPassed && item.preliminaryLevel === 3) item.preliminaryLevel = 1;
  if (!item.risk.holdout.holmPassed && item.preliminaryLevel === 2) item.preliminaryLevel = 1;
}

const specification = {
  version: '3.6.2-extended-1.0.0',
  gateRequired: true,
  holdoutPct: HOLDOUT_PCT,
  thresholds: 'development q25/q75 only',
  entry: 'next regular-session open',
  exit: 'same regular-session close',
  costPoints: COST,
  missingValues: 'excluded, never zero-filled',
  bootstrap: { iterations: ITERATIONS, blockDays: BLOCK },
  multiplicity: 'Holm within directional and risk outcomes',
  features: definitions,
};
const specificationSha256 = crypto.createHash('sha256').update(JSON.stringify(specification)).digest('hex');
const report = {
  generatedAt: new Date().toISOString(),
  researchReady: true,
  specification,
  specificationSha256,
  limitations: [
    'Calculated IV and Skew are research estimates from official settlement/close quotes, not official TAIFEX published IV.',
    'Daily data cannot establish intraday ordering.',
    'The final 20% is a reused historical holdout and is not pristine forward evidence.',
    'No missing value is converted to zero.',
  ],
  studies,
};
fs.writeFileSync(path.join(reports, 'v3-6-2-extended-factor-research.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const fmt = (value, digits = 2) => finite(value) ? Number(value).toFixed(digits) : '—';
const rowsMd = studies.map((item) => `| ${item.stage} | ${item.label} | ${item.samples.holdoutTails} | ${fmt(item.directional.holdout.observed)} | ${fmt(item.directional.holdout.ci95[0])}～${fmt(item.directional.holdout.ci95[1])} | ${fmt(item.directional.strategy.profitFactor)} | ${fmt(item.directional.mirror.profitFactor)} | ${fmt(item.risk.holdout.observed)} | ${item.directional.holdout.holmPassed || item.risk.holdout.holmPassed ? '通過校正' : item.preliminaryVerdict} |`).join('\n');
const markdown = `# V3.6.2 擴充因子正式研究\n\n產生時間：${report.generatedAt}\n\n規格 SHA-256：\`${specificationSha256}\`\n\n所有門檻只取開發期 Q25／Q75，訊號於下一日盤開盤才可使用，扣 8 點成本，缺值不補 0。正向策略與鏡像反向同時列出。\n\n| 階段 | 因子 | 留出尾端樣本 | 高減低隔日點數 | 95%區間 | 正向PF | 反向PF | 高減低絕對波動 | 判定 |\n|---|---|---:|---:|---:|---:|---:|---:|---|\n${rowsMd}\n\n## 限制\n\n${report.limitations.map((item) => `- ${item}`).join('\n')}\n`;
fs.writeFileSync(path.join(reports, 'V3_6_2_EXTENDED_FACTOR_RESEARCH.md'), markdown, 'utf8');
console.log(JSON.stringify({ specificationSha256, studies: studies.map((item) => ({ key: item.key, samples: item.samples, verdict: item.preliminaryVerdict, level: item.preliminaryLevel, directionalHoldout: item.directional.holdout, riskHoldout: item.risk.holdout, strategy: item.directional.strategy, mirror: item.directional.mirror })) }, null, 2));
db.close();

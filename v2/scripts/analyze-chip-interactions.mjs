import fs from 'node:fs';
import path from 'node:path';
import { openDatabase, applyMigrations } from '../src/db.mjs';
import { v2Config } from '../src/config.mjs';
import { loadResearchRows } from '../src/backtest-engine.mjs';

const config = v2Config();
const db = openDatabase(config.databasePath);
const COST_POINTS = 4;

function finite(value) { return value !== null && value !== undefined && Number.isFinite(Number(value)); }
function mean(values) { const v = values.filter(finite).map(Number); return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null; }
function quantile(values, q) {
  const sorted = values.filter(finite).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const p = (sorted.length - 1) * q; const lo = Math.floor(p); const hi = Math.ceil(p);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (p - lo);
}
function tailSignal(value, thresholds) {
  if (!finite(value)) return 0;
  if (Number(value) >= thresholds.magnitude) return 1;
  if (Number(value) <= -thresholds.magnitude) return -1;
  return 0;
}

function calibrate(rows) {
  const thresholds = {};
  for (const key of ['foreignSpot', 'foreignFuturesDelta1d', 'trustFuturesDelta1d', 'dealerFuturesDelta1d']) {
    thresholds[key] = { magnitude: quantile(rows.map((r) => finite(r[key]) ? Math.abs(Number(r[key])) : null), 0.7) };
  }
  return thresholds;
}

function signals(row, t) {
  const spot = tailSignal(row.foreignSpot, t.foreignSpot);
  const futures = tailSignal(row.foreignFuturesDelta1d, t.foreignFuturesDelta1d);
  const trust = tailSignal(row.trustFuturesDelta1d, t.trustFuturesDelta1d);
  const dealer = tailSignal(row.dealerFuturesDelta1d, t.dealerFuturesDelta1d);
  const fx = finite(row.usdtwdReturnPct) ? (Number(row.usdtwdReturnPct) < 0 ? 1 : Number(row.usdtwdReturnPct) > 0 ? -1 : 0) : 0;
  const wallDirection = finite(row.callWallMove1d) && finite(row.putWallMove1d)
    && Math.sign(Number(row.callWallMove1d)) === Math.sign(Number(row.putWallMove1d))
    ? Math.sign(Number(row.callWallMove1d)) : 0;
  const wallOiConfirmed = wallDirection > 0
    ? finite(row.putWallOiDelta1d) && Number(row.putWallOiDelta1d) > 0
    : wallDirection < 0 ? finite(row.callWallOiDelta1d) && Number(row.callWallOiDelta1d) > 0 : false;
  return {
    foreign_spot_only: spot,
    foreign_futures_only: futures,
    spot_fx: spot && spot === fx ? spot : 0,
    spot_futures: spot && spot === futures ? spot : 0,
    spot_futures_fx: spot && spot === futures && spot === fx ? spot : 0,
    foreign_trust: futures && futures === trust ? futures : 0,
    all_institutions: futures && futures === trust && futures === dealer ? futures : 0,
    wall_move_oi: wallDirection && wallOiConfirmed ? wallDirection : 0,
  };
}

function trades(rows, thresholds, key) {
  return rows.flatMap((row) => {
    const signal = signals(row, thresholds)[key];
    if (!signal || !finite(row.nextTxOpen) || !finite(row.nextTxClose)) return [];
    const grossPoints = signal * (Number(row.nextTxClose) - Number(row.nextTxOpen));
    return [{ tradeDate: row.nextTradeDate, signalDate: row.tradeDate, signal, regime: row.regime, grossPoints, netPoints: grossPoints - COST_POINTS }];
  });
}

function metrics(rows) {
  const wins = rows.filter((r) => r.netPoints > 0); const losses = rows.filter((r) => r.netPoints < 0);
  const grossProfit = wins.reduce((s, r) => s + r.netPoints, 0);
  const grossLoss = Math.abs(losses.reduce((s, r) => s + r.netPoints, 0));
  return {
    trades: rows.length,
    winRate: rows.length ? wins.length / rows.length : null,
    averageNetPoints: mean(rows.map((r) => r.netPoints)),
    totalNetPoints: rows.reduce((s, r) => s + r.netPoints, 0),
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
  };
}

try {
  applyMigrations(db, config.migrationsPath);
  const rows = loadResearchRows(db);
  const split = Math.floor(rows.length * 0.7);
  const train = rows.slice(0, split); const late = rows.slice(split);
  const thresholds = calibrate(train);
  const labels = {
    foreign_spot_only: '外資現貨極端流量基準',
    foreign_futures_only: '外資期貨單日極端變化基準',
    spot_fx: '外資現貨極端流量＋美元台幣確認',
    spot_futures: '外資現貨＋外資期貨同步',
    spot_futures_fx: '外資現貨＋期貨＋匯率三重確認',
    foreign_trust: '外資與投信期貨動作同步',
    all_institutions: '外資、投信、自營商期貨動作同步',
    wall_move_oi: 'Call／Put牆同向移動＋防守牆OI增加',
  };
  const studies = {};
  for (const key of Object.keys(labels)) {
    const allTrades = trades(rows, thresholds, key); const lateTrades = trades(late, thresholds, key);
    studies[key] = {
      label: labels[key], all: metrics(allTrades), late30: metrics(lateTrades),
      lateByRegime: Object.fromEntries(['bull', 'bear', 'range', 'high_vol'].map((regime) => [regime, metrics(lateTrades.filter((r) => r.regime === regime))])),
      verdict: lateTrades.length < 30 ? 'insufficient_holdout'
        : metrics(lateTrades).profitFactor > 1.1 && metrics(lateTrades).averageNetPoints > 0 ? 'candidate_for_incremental_test' : 'not_supported',
    };
  }
  const report = {
    generatedAt: new Date().toISOString(), version: 'V2.10.0',
    timing: 'Signal-day post-close data enters at the next regular-session open and exits at that close.',
    costPointsPerTrade: COST_POINTS, trainingRows: train.length, late30Rows: late.length,
    thresholds, studies,
    warning: 'First-stage interaction screen only. Candidates must beat their simpler component on matched dates before scoring.',
  };
  fs.writeFileSync(path.join(config.reportsPath, 'chip-interaction-candidates.json'), `${JSON.stringify(report, null, 2)}\n`);
  const f = (n, d = 2) => finite(n) ? Number(n).toFixed(d) : '—';
  const md = ['# V2.10 籌碼交互作用第一輪', '', `產生時間：${report.generatedAt}`, '',
    '- 訊號使用盤後資料，下一交易日日盤開盤進、收盤出。', `- 每筆先扣${COST_POINTS}點成本。`, '- 後30%少於30筆不升級。', '',
    '| 組合 | 全樣本筆數 | 全樣本PF | 後30%筆數 | 後30% PF | 後30%平均點數 | 判定 |', '|---|---:|---:|---:|---:|---:|---|'];
  for (const study of Object.values(studies)) md.push(`| ${study.label} | ${study.all.trades} | ${f(study.all.profitFactor)} | ${study.late30.trades} | ${f(study.late30.profitFactor)} | ${f(study.late30.averageNetPoints)} | ${study.verdict} |`);
  fs.writeFileSync(path.join(config.reportsPath, 'V2_10_CHIP_INTERACTIONS.md'), `${md.join('\n')}\n`);
  console.log(JSON.stringify(report, null, 2));
} finally { db.close(); }

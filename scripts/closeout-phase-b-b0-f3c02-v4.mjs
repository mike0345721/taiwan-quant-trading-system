import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { jcsNfc, sha256Hex } from '../src/phase-b-b0-v4-core.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'data', 'research', 'phase-b-b0-f3c02', 'run-2026-08-02-v4');
const read = (name) => JSON.parse(fs.readFileSync(path.join(dir, name), 'utf8'));
const hashFile = (file) => sha256Hex(fs.readFileSync(file));
const digest = (value) => sha256Hex(Buffer.from(jcsNfc(value), 'utf8'));
function atomic(name, payload) {
  const file = path.join(dir, name);
  const bytes = Buffer.from(jcsNfc(payload), 'utf8');
  if (fs.existsSync(file)) {
    if (hashFile(file) !== sha256Hex(bytes)) throw new Error(`output_mismatch:${name}`);
    return;
  }
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, bytes, { flag: 'wx' });
  fs.renameSync(temporary, file);
}
function stats(records) {
  const t0 = records.filter((row) => row.s0TradeState === 'TRADE').map((row) => row.s0TradePnl);
  const t1 = records.filter((row) => row.s1TradeState === 'TRADE').map((row) => row.s1TradePnl);
  const sum = (values) => values.reduce((total, value) => total + value, 0);
  return {
    sessions: records.length,
    s0Trades: t0.length,
    s1Trades: t1.length,
    s0Net: sum(records.map((row) => row.s0DailyPnl)),
    s1Net: sum(records.map((row) => row.s1DailyPnl)),
    incrementalNet: sum(records.map((row) => row.incrementalDailyPnl)),
    retention: t0.length
      ? { state: 'AVAILABLE', value: t1.length / t0.length, reasonCode: null }
      : { state: 'UNAVAILABLE', value: null, reasonCode: 'NO_S0_TRADES_IN_DIAGNOSTIC_STRATUM' },
  };
}
function groups(records, key) {
  return [...new Set(records.map((row) => row[key] ?? 'UNAVAILABLE'))]
    .sort()
    .map((value) => ({ value, ...stats(records.filter((row) => (row[key] ?? 'UNAVAILABLE') === value)) }));
}

const paired = read('PAIRED_UNIVERSE_MANIFEST.json').paired;
const primary = read('PRIMARY_ENDPOINTS.json');
const bootstrap = read('BOOTSTRAP_PRIMARY_ENDPOINTS.json');
const permutation = read('NEGATIVE_CONTROL_SCORE_PERMUTATION.json');
const random = read('NEGATIVE_CONTROL_RANDOM_FEATURE.json');
const vetoed = paired.filter((row) => row.vetoApplied);
const increments = vetoed.map((row) => row.incrementalDailyPnl);
const positives = increments.filter((value) => value > 0).sort((a, b) => b - a);
const positiveTotal = positives.reduce((total, value) => total + value, 0);
const concentration = {
  vetoCount: vetoed.length,
  avoidedLoss: increments.filter((value) => value > 0).reduce((total, value) => total + value, 0),
  missedProfit: -increments.filter((value) => value < 0).reduce((total, value) => total + value, 0),
  top1PositiveContribution: positiveTotal ? positives.slice(0, 1).reduce((total, value) => total + value, 0) / positiveTotal : null,
  top3PositiveContribution: positiveTotal ? positives.slice(0, 3).reduce((total, value) => total + value, 0) / positiveTotal : null,
  top5PositiveContribution: positiveTotal ? positives.slice(0, 5).reduce((total, value) => total + value, 0) / positiveTotal : null,
};
atomic('VETO_LEDGER.json', { schemaVersion: 'b0-veto-ledger-v1', rows: vetoed, logicalHash: digest(vetoed) });
atomic('INCREMENTAL_CONCENTRATION.json', { schemaVersion: 'b0-incremental-concentration-v1', ...concentration });
const viewIds = ['GROSS', 'OPTIMISTIC_1_TICK_PER_SIDE', 'BASE_2_TICKS_PER_SIDE', 'CONSERVATIVE_3_TICKS_PER_SIDE', 'SEVERE_STRESS_5_TICKS_PER_SIDE'];
const costViews = viewIds.map((viewId) => ({
  ...stats(paired.map((row) => ({
    ...row,
    s0DailyPnl: row.costViews[viewId].s0DailyPnl,
    s1DailyPnl: row.costViews[viewId].s1DailyPnl,
    incrementalDailyPnl: row.costViews[viewId].incrementalDailyPnl,
    s0TradePnl: row.s0TradeState === 'TRADE' ? row.costViews[viewId].s0DailyPnl : null,
    s1TradePnl: row.s1TradeState === 'TRADE' ? row.costViews[viewId].s1DailyPnl : null,
  }))),
  viewId,
}));
atomic('FIVE_COST_VIEWS_B0.json', { schemaVersion: 'b0-five-cost-views-v1', primaryView: 'BASE_2_TICKS_PER_SIDE', views: costViews });
atomic('STRATIFIED_DIAGNOSTICS.json', {
  schemaVersion: 'b0-stratified-diagnostics-v1',
  byFold: groups(paired, 'foldId'),
  byDirection: groups(paired, 'originalT0Direction'),
  bySettlement: groups(paired, 'settlementClass'),
  byRoll: groups(paired, 'rollSession'),
  byMonth: groups(paired.map((row) => ({ ...row, month: row.tradeDate.slice(0, 7) })), 'month'),
});
const traded = paired.filter((row) => row.s0TradeState === 'TRADE');
atomic('SECONDARY_DIAGNOSTICS.json', {
  schemaVersion: 'b0-secondary-diagnostics-v1',
  falseBreakout: {
    availableCount: traded.filter((row) => typeof row.falseBreakout === 'boolean').length,
    originalRate: traded.filter((row) => row.falseBreakout === true).length / traded.filter((row) => typeof row.falseBreakout === 'boolean').length,
    vetoedRate: vetoed.filter((row) => row.falseBreakout === true).length / Math.max(1, vetoed.filter((row) => typeof row.falseBreakout === 'boolean').length),
  },
  maeMfe: {
    originalMaeMean: traded.filter((row) => Number.isFinite(row.maePoints)).reduce((total, row) => total + row.maePoints, 0) / Math.max(1, traded.filter((row) => Number.isFinite(row.maePoints)).length),
    originalMfeMean: traded.filter((row) => Number.isFinite(row.mfePoints)).reduce((total, row) => total + row.mfePoints, 0) / Math.max(1, traded.filter((row) => Number.isFinite(row.mfePoints)).length),
  },
  diagnosticOnly: true,
});

const failures = [];
if (primary.observed.tradeRetention < 0.6) failures.push('TRADE_RETENTION_BELOW_0_60');
if (primary.observed.ddImprovement < 0.1) failures.push('DD_IMPROVEMENT_BELOW_0_10');
if (primary.observed.es10Improvement < 0.1) failures.push('ES10_IMPROVEMENT_BELOW_0_10');
if (primary.observed.expectancyChange < -0.05) failures.push('EXPECTANCY_NONINFERIORITY_FAIL');
if (primary.observed.s1PF - primary.observed.s0PF < -0.05) failures.push('PF_NONINFERIORITY_FAIL');
if (!bootstrap.results.every((result) => result.pass)) failures.push('PRIMARY_BOOTSTRAP_HOLM_FAIL');
if (!permutation.pass) failures.push('SCORE_PERMUTATION_CONTROL_FAIL');
if (!random.pass) failures.push('RANDOM_FEATURE_CONTROL_FAIL');
const final = {
  schemaVersion: 'b0-f3c02-final-decision-v1',
  status: failures.length ? 'REJECTED' : 'F4_HISTORICAL_INCREMENTAL_CANDIDATE',
  failures,
  evaluationStatus: failures.length ? 'FAIL' : 'PENDING',
  promotionEligible: false,
  signalEligible: false,
  paperEligible: false,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
atomic('FINAL_B0_DECISION.json', final);

const filesBefore = fs.readdirSync(dir)
  .filter((name) => fs.statSync(path.join(dir, name)).isFile() && name !== 'OUTPUT_MANIFEST.json' && name !== 'B0_CLOSEOUT_REPORT.md')
  .sort()
  .map((name) => ({ name, sha256: hashFile(path.join(dir, name)), bytes: fs.statSync(path.join(dir, name)).size }));
atomic('OUTPUT_MANIFEST.json', { schemaVersion: 'b0-output-manifest-v1', runId: 'run-2026-08-02-v4', files: filesBefore, aggregateLogicalHash: digest(filesBefore) });
const report = `# PHASE B B0 F3C02 CLOSEOUT\n\n最終研究判定：**${final.status}**。\n\n樣本：${primary.pairedSessions} 個 Paired Sessions；原始 T0 交易 ${primary.s0PairedOriginalTrades} 筆；套用 Veto 後交易 ${primary.observed.s1TradeCount} 筆；Retention=${(primary.observed.tradeRetention * 100).toFixed(2)}%。\n\n- DD Improvement: ${primary.observed.ddImprovement}\n- ES10 Improvement: ${primary.observed.es10Improvement}\n- Expectancy Change: ${primary.observed.expectancyChange}\n- PF Difference: ${primary.observed.s1PF - primary.observed.s0PF}\n- Permutation Control: ${permutation.pass ? 'PASS' : 'FAIL'}\n- Random Feature Control: ${random.pass ? 'PASS' : 'FAIL'}\n\n否決原因：${failures.join('、')}。\n\n本結果不得晉升為 F4、Signal、策略或交易用途。formalWeight=0、researchOnly=true、executionAuthorized=false。\n`;
const reportPath = path.join(dir, 'B0_CLOSEOUT_REPORT.md');
if (!fs.existsSync(reportPath)) fs.writeFileSync(reportPath, report, { encoding: 'utf8', flag: 'wx' });
process.stdout.write(`${JSON.stringify(final, null, 2)}\n`);

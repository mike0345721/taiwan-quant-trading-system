import { hashJson } from './t0-data-replay-gate.mjs';

export const FORMAL_COST_VIEWS = Object.freeze([
  ['GROSS', 'GROSS_0_TICKS_PER_SIDE'],
  ['OPTIMISTIC_1_TICK_PER_SIDE', 'OPTIMISTIC_1_TICK_PER_SIDE'],
  ['BASE_2_TICKS_PER_SIDE', 'BASE_2_TICKS_PER_SIDE'],
  ['CONSERVATIVE_3_TICKS_PER_SIDE', 'CONSERVATIVE_3_TICKS_PER_SIDE'],
  ['SEVERE_STRESS_5_TICKS_PER_SIDE', 'SEVERE_STRESS_5_TICKS_PER_SIDE'],
]);

function finite(values) { return values.filter(Number.isFinite); }
function sum(values) { return finite(values).reduce((total, value) => total + value, 0); }
function average(values) { const rows = finite(values); return rows.length ? sum(rows) / rows.length : null; }
function median(values) { const rows = finite(values).sort((a, b) => a - b); if (!rows.length) return null; const mid = Math.floor(rows.length / 2); return rows.length % 2 ? rows[mid] : (rows[mid - 1] + rows[mid]) / 2; }
function quantile(values, p) { const rows = finite(values).sort((a, b) => a - b); if (!rows.length) return null; const at = (rows.length - 1) * p; const low = Math.floor(at); const high = Math.ceil(at); return rows[low] + (rows[high] - rows[low]) * (at - low); }

function distribution(values) {
  const rows = finite(values);
  return { count: rows.length, mean: average(rows), median: median(rows), p25: quantile(rows, 0.25), p75: quantile(rows, 0.75), min: rows.length ? Math.min(...rows) : null, max: rows.length ? Math.max(...rows) : null };
}

function categorical(values) {
  const counts = {};
  for (const value of values.filter((item) => item !== null && item !== undefined)) counts[value] = (counts[value] || 0) + 1;
  return Object.fromEntries(Object.entries(counts).sort(([a], [b]) => a.localeCompare(b)));
}

function taipeiClock(isoTimestamp) {
  if (!isoTimestamp || !Number.isFinite(Date.parse(isoTimestamp))) return null;
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(isoTimestamp));
}

function costOf(result, internalId) { return result.costViews?.find((view) => view.viewId === internalId) || null; }

function profitFactor(pnls) {
  const positive = sum(pnls.filter((value) => value > 0));
  const negative = Math.abs(sum(pnls.filter((value) => value < 0)));
  if (negative === 0) return positive > 0 ? null : null;
  return positive / negative;
}

function drawdown(trades, internalId) {
  let equity = 0;
  let peak = 0;
  let peakDate = null;
  let worst = 0;
  let startDate = null;
  let endDate = null;
  for (const result of trades) {
    equity += costOf(result, internalId).netPnl;
    if (equity > peak) { peak = equity; peakDate = result.tradeDate; }
    const current = equity - peak;
    if (current < worst) { worst = current; startDate = peakDate; endDate = result.tradeDate; }
  }
  return { maximumDrawdown: worst, drawdownStartDate: startDate, drawdownEndDate: endDate };
}

function maxConsecutiveLosses(pnls) {
  let current = 0;
  let maximum = 0;
  for (const value of pnls) { current = value < 0 ? current + 1 : 0; maximum = Math.max(maximum, current); }
  return maximum;
}

function concentration(trades, internalId) {
  const rows = trades.map((result) => ({ tradeDate: result.tradeDate, pnl: costOf(result, internalId).netPnl })).sort((a, b) => b.pnl - a.pnl || a.tradeDate.localeCompare(b.tradeDate));
  const positiveTotal = sum(rows.filter((row) => row.pnl > 0).map((row) => row.pnl));
  const total = sum(rows.map((row) => row.pnl));
  const removed = {};
  for (const count of [1, 3, 5]) {
    const kept = rows.slice(Math.min(count, rows.length));
    const pnls = kept.map((row) => row.pnl);
    removed[`top${count}`] = { removedDates: rows.slice(0, count).map((row) => row.tradeDate), netPnl: sum(pnls), expectancy: average(pnls), profitFactor: profitFactor(pnls) };
  }
  const contribution = (count) => positiveTotal > 0 ? sum(rows.slice(0, count).filter((row) => row.pnl > 0).map((row) => row.pnl)) / positiveTotal : null;
  return { totalNetPnl: total, positivePnlDenominator: positiveTotal, top1Contribution: contribution(1), top3Contribution: contribution(3), top5Contribution: contribution(5), removedTopResults: removed };
}

function monthDistribution(trades, internalId) {
  const grouped = new Map();
  for (const result of trades) { const month = result.tradeDate.slice(0, 7); const rows = grouped.get(month) || []; rows.push(costOf(result, internalId).netPnl); grouped.set(month, rows); }
  return Object.fromEntries([...grouped].sort(([a], [b]) => a.localeCompare(b)).map(([month, pnls]) => [month, { tradeCount: pnls.length, netPnl: sum(pnls), expectancy: average(pnls), profitFactor: profitFactor(pnls), winRate: pnls.length ? pnls.filter((value) => value > 0).length / pnls.length : null }]));
}

function filterStratum(results, stratum) {
  const rules = {
    ALL: () => true,
    LONG: (row) => row.tradeState === 'TRADE' && row.breakoutDirection === 'LONG',
    SHORT: (row) => row.tradeState === 'TRADE' && row.breakoutDirection === 'SHORT',
    NON_SETTLEMENT: (row) => row.settlementClass === 'NORMAL_SESSION',
    SETTLEMENT: (row) => row.settlementClass?.startsWith('SETTLEMENT_'),
    SETTLEMENT_FINAL_CONTRACT: (row) => row.settlementClass === 'SETTLEMENT_FINAL_CONTRACT',
    SETTLEMENT_NON_FINAL_CONTRACT: (row) => row.settlementClass === 'SETTLEMENT_NON_FINAL_CONTRACT',
    ROLL: (row) => row.rollSession === true,
    NON_ROLL: (row) => row.rollSession !== true,
  };
  return results.filter(rules[stratum]);
}

export function buildCostViewMetrics(results, internalId, publicId, stratum = 'ALL') {
  const sessions = filterStratum(results, stratum);
  const trades = sessions.filter((row) => row.tradeState === 'TRADE');
  const costs = trades.map((row) => costOf(row, internalId));
  if (costs.some((row) => !row)) throw new Error(`FORMAL_SUMMARY_COST_VIEW_MISSING:${internalId}`);
  const net = costs.map((row) => row.netPnl);
  const wins = net.filter((value) => value > 0);
  const losses = net.filter((value) => value < 0);
  const holdingMinutes = trades.map((row) => (Date.parse(row.exitAt) - Date.parse(row.entryAt)) / 60_000);
  const falseBreakoutAvailable = trades.filter((row) => typeof row.falseBreakout?.falseBreakout === 'boolean');
  const metrics = {
    costViewId: publicId, internalCostViewId: internalId, stratum,
    sessionCount: sessions.length, researchEligibleSessionCount: sessions.filter((row) => row.tradeState !== 'NO_SAMPLE').length,
    tradeCount: trades.length, noTradeCount: sessions.filter((row) => row.tradeState === 'NO_TRADE').length, noSampleCount: sessions.filter((row) => row.tradeState === 'NO_SAMPLE').length,
    interpretationState: trades.length < 20 ? 'DESCRIPTIVE_ONLY' : 'FULL_SAMPLE_METRICS',
    grossPnl: sum(costs.map((row) => row.grossPnl)), netPnl: sum(net), expectancyPerTrade: average(net),
    averagePerEligibleSession: sessions.filter((row) => row.tradeState !== 'NO_SAMPLE').length ? sum(net) / sessions.filter((row) => row.tradeState !== 'NO_SAMPLE').length : null,
    profitFactor: profitFactor(net), winRate: trades.length ? wins.length / trades.length : null,
    averageWin: average(wins), averageLoss: average(losses), payoffRatio: losses.length && wins.length ? average(wins) / Math.abs(average(losses)) : null,
    ...drawdown(trades, internalId), maximumConsecutiveLosses: maxConsecutiveLosses(net),
    maePoints: distribution(trades.map((row) => row.maePoints)), mfePoints: distribution(trades.map((row) => row.mfePoints)),
    maeR: distribution(trades.map((row) => row.maeR)), mfeR: distribution(trades.map((row) => row.mfeR)),
    falseBreakoutCount: falseBreakoutAvailable.filter((row) => row.falseBreakout.falseBreakout === true).length,
    falseBreakoutUnavailableCount: trades.length - falseBreakoutAvailable.length,
    falseBreakoutRate: falseBreakoutAvailable.length ? falseBreakoutAvailable.filter((row) => row.falseBreakout.falseBreakout === true).length / falseBreakoutAvailable.length : null,
    holdingTimeMinutes: distribution(holdingMinutes), entryTimeDistribution: categorical(trades.map((row) => taipeiClock(row.entryAt))),
    exitReasonDistribution: categorical(trades.map((row) => row.exitReason)), openingRangeWidthPoints: distribution(sessions.map((row) => Number.isFinite(row.orHigh) && Number.isFinite(row.orLow) ? row.orHigh - row.orLow : null)),
    pnlConcentration: concentration(trades, internalId), monthDistribution: monthDistribution(trades, internalId),
  };
  metrics.metricsHash = hashJson(metrics);
  return metrics;
}

export function buildFormalSummary(results) {
  const ordered = [...results].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const strata = ['ALL', 'LONG', 'SHORT', 'NON_SETTLEMENT', 'SETTLEMENT', 'SETTLEMENT_FINAL_CONTRACT', 'SETTLEMENT_NON_FINAL_CONTRACT', 'ROLL', 'NON_ROLL'];
  const costViews = Object.fromEntries(FORMAL_COST_VIEWS.map(([internalId, publicId]) => [publicId, Object.fromEntries(strata.map((stratum) => [stratum, buildCostViewMetrics(ordered, internalId, publicId, stratum)]))]));
  const trades = ordered.filter((row) => row.tradeState === 'TRADE');
  const noTrades = ordered.filter((row) => row.tradeState === 'NO_TRADE');
  const summary = {
    schemaVersion: 't0-h0-formal-summary-v1', summaryType: 'PRE_REGISTERED_FORMAL_H0_DESCRIPTIVE_EVALUATION',
    primaryCostView: 'BASE_2_TICKS_PER_SIDE',
    counts: {
      manifestSessionCount: 137, processedSessionCount: ordered.length,
      researchEligibleSessionCount: trades.length + noTrades.length,
      tradeCount: trades.length, noTradeCount: noTrades.length, noSampleCount: ordered.filter((row) => row.tradeState === 'NO_SAMPLE').length,
      longCount: trades.filter((row) => row.breakoutDirection === 'LONG').length,
      shortCount: trades.filter((row) => row.breakoutDirection === 'SHORT').length,
      stopExitCount: trades.filter((row) => row.exitReason === 'STOP_EXIT').length,
      timeExitCount: trades.filter((row) => row.exitReason === 'TIME_EXIT').length,
      entryGapThroughStopCount: noTrades.filter((row) => row.noTradeReason === 'ENTRY_GAP_THROUGH_STOP').length,
      falseBreakoutCount: trades.filter((row) => row.falseBreakout?.falseBreakout === true).length,
      falseBreakoutUnavailableCount: trades.filter((row) => typeof row.falseBreakout?.falseBreakout !== 'boolean').length,
      naturalTickReplayCount: ordered.filter((row) => row.replayResolution === 'TICK_REPLAY_PASS').length,
      ohlcFallbackCount: ordered.filter((row) => row.replayResolution !== 'TICK_REPLAY_PASS').length,
    },
    noTradeReasonDistribution: categorical(noTrades.map((row) => row.noTradeReason)),
    exitReasonDistribution: categorical(trades.map((row) => row.exitReason)),
    costViews,
    settlementEvidence: 'DESCRIPTIVE_ONLY', diagnosticWarningOnly: true, promotionGate: false,
    edgeEvaluation: 'DESCRIPTIVE_ONLY_NOT_A_PROMOTION_DECISION', formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  summary.summaryHash = hashJson(summary);
  return summary;
}

export function buildNaturalEventAudit(results) {
  const stop = results.filter((row) => row.tradeState === 'TRADE' && row.exitReason === 'STOP_EXIT');
  const gapThrough = stop.filter((row) => row.eventAudit?.gapThroughStop === true);
  const entryGap = results.filter((row) => row.noTradeReason === 'ENTRY_GAP_THROUGH_STOP');
  const ambiguous = results.filter((row) => row.eventAudit?.ambiguousSequence === true);
  const pick = (rows, count) => rows.slice(0, count).map((row) => ({
    tradeDate: row.tradeDate, contractCode: row.contractCode, direction: row.breakoutDirection || row.eventAudit?.auditDirection || null,
    entryAt: row.entryAt || row.eventAudit?.entryCandidateTick?.exchangeTimestamp || null,
    entryReferencePrice: row.entryReferencePrice ?? row.eventAudit?.entryCandidateTick?.price ?? null,
    stopPrice: row.initialStopPrice ?? null, firstTriggerTick: row.eventAudit?.firstTriggerTick || null,
    exitAt: row.exitAt || null, exitReferencePrice: row.exitReferencePrice ?? null,
    eventOrderingBasis: row.eventAudit?.eventOrderingBasis || row.eventSequencePolicy || null,
    replayResolution: row.replayResolution, outputHash: row.outputHash || null,
  }));
  return {
    schemaVersion: 't0-natural-event-audit-v1',
    firstFiveStopExits: { requested: 5, actual: Math.min(5, stop.length), totalAvailable: stop.length, events: pick(stop, 5) },
    firstThreeGapThroughStops: { requested: 3, actual: Math.min(3, gapThrough.length), totalAvailable: gapThrough.length, events: pick(gapThrough, 3) },
    firstThreeEntryGapThroughStops: { requested: 3, actual: Math.min(3, entryGap.length), totalAvailable: entryGap.length, events: pick(entryGap, 3) },
    firstThreeAmbiguousSequence: { requested: 3, actual: Math.min(3, ambiguous.length), totalAvailable: ambiguous.length, events: pick(ambiguous, 3) },
    diagnosticOnly: true, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

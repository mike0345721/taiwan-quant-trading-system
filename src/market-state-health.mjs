import { stableDigest } from './phase-a-canonical.mjs';

const AXES = Object.freeze({
  trend: ['TREND_UP', 'TREND_DOWN', 'RANGE', 'UNCLEAR'],
  direction: ['BULLISH', 'BEARISH', 'NEUTRAL', 'CONFLICT', 'UNAVAILABLE'],
  volatility: ['LOW', 'NORMAL', 'HIGH', 'UNAVAILABLE'],
  risk: ['NORMAL', 'ELEVATED', 'HIGH_RISK', 'UNAVAILABLE'],
  globalAlignment: ['TAILWIND', 'HEADWIND', 'MIXED', 'UNAVAILABLE'],
});

function sortedRecords(records) {
  return [...records].sort((a, b) => String(a?.tradeDate || '').localeCompare(String(b?.tradeDate || '')));
}

function increment(target, key, amount = 1) {
  target[key] = (target[key] || 0) + amount;
}

function round(value, digits = 6) {
  if (!Number.isFinite(value)) return null;
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function stateCounts(records, axis, allowed) {
  const counts = Object.fromEntries(allowed.map((state) => [state, 0]));
  for (const record of records) {
    const state = record?.state?.[axis];
    if (typeof state === 'string') increment(counts, state);
  }
  return counts;
}

function transitionReport(records, axis) {
  const matrix = {};
  let total = 0;
  let stay = 0;
  let change = 0;
  for (let index = 1; index < records.length; index += 1) {
    const from = records[index - 1]?.state?.[axis];
    const to = records[index]?.state?.[axis];
    if (typeof from !== 'string' || typeof to !== 'string') continue;
    if (!matrix[from]) matrix[from] = {};
    increment(matrix[from], to);
    total += 1;
    if (from === to) stay += 1;
    else change += 1;
  }
  return {
    total,
    stay,
    change,
    stayRate: total ? round(stay / total) : null,
    changeRate: total ? round(change / total) : null,
    matrix,
  };
}

function runLengthReport(records, axis) {
  const runs = [];
  let current = null;
  for (const record of records) {
    const state = record?.state?.[axis];
    if (typeof state !== 'string') continue;
    if (current && current.state === state) {
      current.length += 1;
      current.endTradeDate = record.tradeDate || null;
      continue;
    }
    current = {
      state,
      length: 1,
      startTradeDate: record.tradeDate || null,
      endTradeDate: record.tradeDate || null,
    };
    runs.push(current);
  }

  const byState = {};
  const buckets = { '1': 0, '2': 0, '3': 0, '4': 0, '5_PLUS': 0 };
  for (const run of runs) {
    const bucket = run.length >= 5 ? '5_PLUS' : String(run.length);
    increment(buckets, bucket);
    if (!byState[run.state]) byState[run.state] = { runs: 0, observations: 0, longestRun: 0, meanRunLength: null };
    byState[run.state].runs += 1;
    byState[run.state].observations += run.length;
    byState[run.state].longestRun = Math.max(byState[run.state].longestRun, run.length);
  }
  for (const value of Object.values(byState)) {
    value.meanRunLength = value.runs ? round(value.observations / value.runs) : null;
  }

  return {
    totalRuns: runs.length,
    longestRun: runs.reduce((max, run) => Math.max(max, run.length), 0),
    lengthBuckets: buckets,
    byState,
  };
}

function evidenceCoverage(records) {
  const accepted = {};
  const unavailable = {};
  for (const record of records) {
    for (const item of record?.evidence || []) if (item?.key) increment(accepted, item.key);
    for (const item of record?.unavailable || []) if (item?.key) increment(unavailable, item.key);
  }
  return { accepted, unavailable };
}

function unavailableReasonDecomposition(records) {
  const byReason = {};
  const byKeyAndReason = {};
  const inputQualityStates = {};
  for (const record of records) {
    for (const item of record?.unavailable || []) {
      const reason = item?.reason || 'UNKNOWN';
      increment(byReason, reason);
      if (item?.key) increment(byKeyAndReason, `${item.key}:${reason}`);
      for (const factor of item?.factors || []) {
        if (factor?.qualityState) increment(inputQualityStates, factor.qualityState);
      }
    }
  }
  return { byReason, byKeyAndReason, inputQualityStates };
}

function conflictDecomposition(records) {
  const byType = {};
  const directionVotePatterns = {};
  for (const record of records) {
    for (const conflict of record?.conflicts || []) {
      const type = conflict?.type || 'UNKNOWN';
      increment(byType, type);
      if (type === 'DIRECTION_BLOCK_CONFLICT' && Array.isArray(conflict.votes)) {
        const pattern = conflict.votes
          .map((vote) => `${vote.block}=${vote.state}`)
          .sort()
          .join('|') || 'NO_VOTES';
        increment(directionVotePatterns, pattern);
      }
    }
  }
  return { byType, directionVotePatterns };
}

function trendUnclearDecomposition(records) {
  const contexts = {};
  for (const record of records) {
    if (record?.state?.trend !== 'UNCLEAR') continue;
    const local = (record.evidence || []).find((item) => item?.key === 'localPricePersistence');
    const breadth = (record.evidence || []).find((item) => item?.key === 'twseBreadth');
    const localTrend = local?.trend || 'LOCAL_UNAVAILABLE';
    const breadthDirection = breadth?.direction || 'BREADTH_UNAVAILABLE';
    increment(contexts, `${localTrend}|${breadthDirection}`);
  }
  return contexts;
}

function axisHealth(records, axis, allowed) {
  const counts = stateCounts(records, axis, allowed);
  return {
    counts,
    observedStates: allowed.filter((state) => (counts[state] || 0) > 0),
    unobservedStates: allowed.filter((state) => (counts[state] || 0) === 0),
    transitions: transitionReport(records, axis),
    runs: runLengthReport(records, axis),
  };
}

export function analyzeMarketStateHealth(inputRecords = []) {
  const records = sortedRecords(inputRecords);
  const axes = {};
  for (const [axis, allowed] of Object.entries(AXES)) axes[axis] = axisHealth(records, axis, allowed);

  const report = {
    schemaVersion: 'market-state-v1-health-check-v0',
    records: records.length,
    firstTradeDate: records[0]?.tradeDate || null,
    lastTradeDate: records.at(-1)?.tradeDate || null,
    axes,
    evidenceCoverage: evidenceCoverage(records),
    unavailableReasons: unavailableReasonDecomposition(records),
    conflicts: conflictDecomposition(records),
    trendUnclearContexts: trendUnclearDecomposition(records),
    outcomeFieldsConsumed: [],
    thresholdOptimizationPerformed: false,
    descriptiveOnly: true,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };

  return {
    ...report,
    healthDigest: stableDigest(report),
  };
}

import { stableDigest } from './phase-a-canonical.mjs';
import {
  MARKET_STATE_OUTCOME_CONTRACT_V1,
  first60mContinuation,
  sampleInterpretation,
  sessionExcursions,
  trendRangeStructure,
} from './market-state-outcome-contract.mjs';

export const CRU18_AXES = Object.freeze(['trend', 'direction', 'volatility', 'globalAlignment', 'riskResearchContext']);
export const CRU18_OUTCOMES = Object.freeze([
  'LARGE_MOVE_CONTINUOUS',
  'DOWNSIDE_EXCURSION',
  'TREND_RANGE_STRUCTURE',
  'FIRST60M_CONTINUATION',
  'OPENING_GAP',
]);

const PRIMARY = Object.freeze({
  direction: ['BULLISH', 'BEARISH'], trend: ['TREND_UP', 'TREND_DOWN'],
  volatility: ['HIGH', 'LOW'], globalAlignment: ['TAILWIND', 'HEADWIND'],
  riskResearchContext: ['ELEVATED', 'NORMAL'],
});

const FIELDS = Object.freeze({
  LARGE_MOVE_CONTINUOUS: ['upExcursionBps', 'downExcursionBps', 'maxExcursionBps', 'sessionReturnBps'],
  DOWNSIDE_EXCURSION: ['downsideExcursionBps', 'closeRecoveryFromLowBps'],
  TREND_RANGE_STRUCTURE: ['sessionReturnBps', 'closeLocation', 'pathEfficiency'],
  FIRST60M_CONTINUATION: ['openingLegBps', 'continuationRawBps', 'total60mBps', 'continuationInOpeningDirectionBps'],
  OPENING_GAP: ['gapPoints', 'gapBps'],
});

function finite(value) { return Number.isFinite(Number(value)); }
function mean(values) { return values.reduce((sum, value) => sum + value, 0) / values.length; }
function quantile(sorted, probability) {
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * probability;
  const lower = Math.floor(position); const upper = Math.ceil(position);
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}
function stats(values) {
  const numbers = values.map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  const n = numbers.length;
  if (!n) return { n: 0, interpretation: 'DO_NOT_INTERPRET' };
  const average = mean(numbers);
  const variance = n > 1 ? numbers.reduce((sum, value) => sum + (value - average) ** 2, 0) / (n - 1) : 0;
  const result = { n, interpretation: sampleInterpretation(n), mean: average, median: quantile(numbers, 0.5) };
  if (n >= 30) Object.assign(result, { standardDeviation: Math.sqrt(variance), q25: quantile(numbers, 0.25), q75: quantile(numbers, 0.75) });
  return result;
}

function mulberry32(seed) {
  let value = seed >>> 0;
  return () => { value += 0x6D2B79F5; let t = value; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function bootstrapDifference(a, b, seed, iterations = 2000) {
  const random = mulberry32(seed);
  const draws = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    const left = Array.from({ length: a.length }, () => a[Math.floor(random() * a.length)]);
    const right = Array.from({ length: b.length }, () => b[Math.floor(random() * b.length)]);
    draws.push(mean(left) - mean(right));
  }
  draws.sort((x, y) => x - y);
  return { lower95: quantile(draws, 0.025), upper95: quantile(draws, 0.975), iterations, seed };
}

function priceAtOrAfter(ticks, iso) { return ticks.find((tick) => tick.exchangeTimestamp >= iso)?.price ?? null; }
function availableOutcomeBase(session, tickRead) {
  return {
    tradeDate: session.tradeDate, sessionId: session.sessionId, session: 'DAY',
    actualContractCode: session.actualReplayContractCode,
    settlementClass: session.settlementClass, rollSession: session.rollSession,
    sourceLineage: { sourceClass: tickRead.source.sourceClass, sourceFile: tickRead.source.zipPath?.split(/[\\/]/).at(-1) || null, sourceHash: tickRead.source.zipSha256 || null },
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

export async function buildOutcomeRows({ sessions, readTicks }) {
  const rows = [];
  for (const session of [...sessions].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))) {
    const tickRead = await readTicks(session);
    const base = availableOutcomeBase(session, tickRead);
    if (tickRead.sourceState !== 'AVAILABLE' || !tickRead.ticks?.length) {
      for (const family of CRU18_OUTCOMES) rows.push({ ...base, outcomeFamily: family, outcomeState: 'UNAVAILABLE', unavailableReason: 'NATURAL_TICK_SOURCE_UNAVAILABLE', values: null, availableAt: null });
      continue;
    }
    const ticks = tickRead.ticks;
    const open = ticks[0].price; const close = ticks.at(-1).price;
    const high = Math.max(...ticks.map((tick) => tick.price)); const low = Math.min(...ticks.map((tick) => tick.price));
    const sessionAvailableAt = ticks.at(-1).exchangeTimestamp;
    const path = [open, ...tickRead.bars.map((bar) => bar.close)];
    if (path.at(-1) !== close) path.push(close);
    const excursion = sessionExcursions({ sessionOpen: open, sessionHigh: high, sessionLow: low, sessionClose: close });
    rows.push({ ...base, outcomeFamily: 'LARGE_MOVE_CONTINUOUS', outcomeState: 'AVAILABLE', unavailableReason: null, values: Object.fromEntries(FIELDS.LARGE_MOVE_CONTINUOUS.map((field) => [field, excursion[field]])), availableAt: sessionAvailableAt });
    rows.push({ ...base, outcomeFamily: 'DOWNSIDE_EXCURSION', outcomeState: 'AVAILABLE', unavailableReason: null, values: Object.fromEntries(FIELDS.DOWNSIDE_EXCURSION.map((field) => [field, excursion[field]])), availableAt: sessionAvailableAt });
    const structure = trendRangeStructure({ sessionOpen: open, sessionHigh: high, sessionLow: low, sessionClose: close, path });
    rows.push({ ...base, outcomeFamily: 'TREND_RANGE_STRUCTURE', outcomeState: finite(structure.closeLocation) && finite(structure.pathEfficiency) ? 'AVAILABLE' : 'UNAVAILABLE', unavailableReason: finite(structure.closeLocation) && finite(structure.pathEfficiency) ? null : 'DEGENERATE_SESSION_PATH', values: structure, availableAt: sessionAvailableAt });
    const p0900 = priceAtOrAfter(ticks, `${session.tradeDate}T01:00:00.000Z`);
    const p0945 = priceAtOrAfter(ticks, `${session.tradeDate}T01:45:00.000Z`);
    if (finite(p0900) && finite(p0945)) {
      const continuation = first60mContinuation({ p0845: open, p0900, p0945 });
      rows.push({ ...base, outcomeFamily: 'FIRST60M_CONTINUATION', outcomeState: 'AVAILABLE', unavailableReason: continuation.unavailableReason, values: continuation, availableAt: ticks.find((tick) => tick.exchangeTimestamp >= `${session.tradeDate}T01:45:00.000Z`)?.exchangeTimestamp || null });
    } else rows.push({ ...base, outcomeFamily: 'FIRST60M_CONTINUATION', outcomeState: 'UNAVAILABLE', unavailableReason: 'FIRST60M_BOUNDARY_PRICE_UNAVAILABLE', values: null, availableAt: null });
    rows.push({ ...base, outcomeFamily: 'OPENING_GAP', outcomeState: 'UNAVAILABLE', unavailableReason: 'PRIOR_NIGHT_CLOSE_SAME_CONTRACT_NOT_GOVERNED', values: null, availableAt: null });
  }
  return rows;
}

export function buildAlignmentManifest({ marketStateRecords, outcomeRows, marketStateDigest, outcomeDigest }) {
  const stateByDate = new Map(marketStateRecords.map((row) => [row.tradeDate, row]));
  const aligned = outcomeRows.map((outcome) => {
    const state = stateByDate.get(outcome.tradeDate) || null;
    const reason = !state ? 'MARKET_STATE_UNAVAILABLE' : outcome.outcomeState !== 'AVAILABLE' ? outcome.unavailableReason : null;
    return {
      tradeDate: outcome.tradeDate, sessionId: outcome.sessionId, session: outcome.session,
      actualContractCode: outcome.actualContractCode, outcomeFamily: outcome.outcomeFamily,
      alignmentState: reason ? 'UNAVAILABLE' : 'ALIGNED', unavailableReason: reason,
      marketStateDigest, marketStateVersion: state?.schemaVersion || null,
      outcomeSourceLineage: outcome.sourceLineage, outcomeDigest, marketStateAvailableAt: state?.decisionAt || null,
      outcomeAvailableAt: outcome.availableAt, values: reason ? null : outcome.values,
      axes: state ? { trend: state.state.trend, direction: state.state.direction, volatility: state.state.volatility, globalAlignment: state.state.globalAlignment, riskResearchContext: state.riskResearchContext } : null,
    };
  });
  const families = Object.fromEntries(CRU18_OUTCOMES.map((family) => {
    const rows = aligned.filter((row) => row.outcomeFamily === family);
    const reasons = {};
    for (const row of rows.filter((item) => item.alignmentState !== 'ALIGNED')) reasons[row.unavailableReason] = (reasons[row.unavailableReason] || 0) + 1;
    return [family, { marketStateRecords: marketStateRecords.length, legalOutcomeRows: rows.filter((row) => row.alignmentState === 'ALIGNED').length, intersectionRows: rows.filter((row) => row.alignmentState === 'ALIGNED').length, unavailableRows: rows.filter((row) => row.alignmentState !== 'ALIGNED').length, unavailableReasonCounts: reasons }];
  }));
  return { schemaVersion: 'cru18-alignment-manifest-v1', families, rows: aligned, formalWeight: 0, researchOnly: true, executionAuthorized: false };
}

export function analyzeSingleAxisLinkage(alignment) {
  const available = alignment.rows.filter((row) => row.alignmentState === 'ALIGNED');
  const sampleTables = {}; const outcomeTables = {}; const primaryContrasts = {}; const axisConclusions = {};
  for (const axis of CRU18_AXES) {
    const states = [...new Set(available.map((row) => row.axes[axis]))].sort();
    sampleTables[axis] = Object.fromEntries(states.map((state) => [state, new Set(available.filter((row) => row.axes[axis] === state).map((row) => row.tradeDate)).size]));
    outcomeTables[axis] = {};
    for (const family of CRU18_OUTCOMES) {
      outcomeTables[axis][family] = {};
      for (const state of states) {
        const rows = available.filter((row) => row.outcomeFamily === family && row.axes[axis] === state);
        outcomeTables[axis][family][state] = Object.fromEntries(FIELDS[family].map((field) => [field, stats(rows.map((row) => row.values?.[field]))]));
      }
    }
    const [leftState, rightState] = PRIMARY[axis]; const contrasts = [];
    for (const family of CRU18_OUTCOMES) for (const field of FIELDS[family]) {
      const left = available.filter((row) => row.outcomeFamily === family && row.axes[axis] === leftState).map((row) => Number(row.values?.[field])).filter(Number.isFinite);
      const right = available.filter((row) => row.outcomeFamily === family && row.axes[axis] === rightState).map((row) => Number(row.values?.[field])).filter(Number.isFinite);
      const legal = left.length >= 30 && right.length >= 30;
      contrasts.push({ family, field, leftState, rightState, leftN: left.length, rightN: right.length, effectSizeMeanDifference: legal ? mean(left) - mean(right) : null, confidenceInterval95: legal ? bootstrapDifference(left, right, 20260809 + contrasts.length) : null, interpretation: legal ? 'DESCRIPTIVE_ONLY_NOT_EDGE' : 'INSUFFICIENT_SAMPLE' });
    }
    primaryContrasts[axis] = contrasts;
    const legal = contrasts.filter((row) => row.confidenceInterval95);
    axisConclusions[axis] = !legal.length ? 'INSUFFICIENT_SAMPLE'
      : legal.some((row) => row.confidenceInterval95.lower95 > 0 || row.confidenceInterval95.upper95 < 0) ? 'DESCRIPTIVE_DIFFERENCE_PRESENT'
        : legal.some((row) => row.effectSizeMeanDifference !== 0) ? 'WEAK_DESCRIPTIVE_DIFFERENCE' : 'NO_INFORMATION_SIGNAL';
  }
  return { schemaVersion: 'cru18-single-axis-linkage-v1', sampleTables, outcomeTables, primaryContrasts, axisConclusions, multiAxisSearchPerformed: false, binaryThresholdOptimizationPerformed: false, pnlAnalysisPerformed: false, pfAnalysisPerformed: false, sharpeAnalysisPerformed: false, marketStateRetuningPerformed: false, formalWeight: 0, researchOnly: true, executionAuthorized: false };
}

export function buildCru18Bundle({ marketStateRecords, outcomeRows }) {
  const marketStateDigest = stableDigest(marketStateRecords); const outcomeDigest = stableDigest(outcomeRows);
  const alignment = buildAlignmentManifest({ marketStateRecords, outcomeRows, marketStateDigest, outcomeDigest });
  const linkage = analyzeSingleAxisLinkage(alignment);
  const futureDataViolations = marketStateRecords.reduce((total, row) => total
    + (row.unavailable || []).filter((item) => ['FUTURE_EVIDENCE', 'AVAILABLE_AT_VIOLATION'].includes(item.reason)).length, 0);
  const bundle = { contract: MARKET_STATE_OUTCOME_CONTRACT_V1.schemaVersion, marketStateDigest, outcomeDigest, alignment, linkage, futureDataViolations, formalWeight: 0, researchOnly: true, executionAuthorized: false };
  return { ...bundle, linkageDigest: stableDigest(bundle) };
}

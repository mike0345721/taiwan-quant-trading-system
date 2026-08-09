function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

export const MARKET_STATE_OUTCOME_CONTRACT_V1 = deepFreeze({
  schemaVersion: 'market-state-outcome-contract-v1',
  ownerApproved: true,
  ownerApprovalDate: '2026-08-09',
  primaryAnalysis: 'CONTINUOUS_FIRST',
  linkageMode: 'SINGLE_AXIS_ONLY',
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  frozenMarketStateAxes: ['trend', 'direction', 'volatility', 'globalAlignment'],
  riskHandling: {
    sourceField: 'riskResearchContext',
    linkageField: 'riskResearchContext',
    canonicalProductRiskState: false,
    elevatedCanonicalized: false,
  },
  samplePolicy: {
    noInterpretBelow: 20,
    descriptiveOnlyBelow: 30,
    effectSizeAndCiMinimum: 30,
    tradingEdgeClaimAuthorized: false,
  },
  forbidden: [
    'MULTI_AXIS_CARTESIAN_SEARCH',
    'PNL_ANALYSIS',
    'PF_ANALYSIS',
    'SHARPE_ANALYSIS',
    'OUTCOME_THRESHOLD_OPTIMIZATION',
    'MARKET_STATE_RETUNING_AFTER_OUTCOME_EXPOSURE',
    'CONTINUOUS_SERIES_AS_ACTUAL_CONTRACT_OUTCOME',
  ],
  outcomes: {
    openingGap: {
      status: 'PARTIAL',
      primaryFields: ['gapPoints', 'gapBps'],
      binaryThresholdAuthorized: false,
      requiresSameActualContract: true,
      unavailableOnContractMismatch: 'ROLL_TRANSITION',
      observation: 'PRIOR_NIGHT_CLOSE_TO_DAY_OPEN',
    },
    largeMoveContinuous: {
      status: 'AVAILABLE_137_STRICT_SESSIONS',
      primaryFields: ['upExcursionBps', 'downExcursionBps', 'maxExcursionBps', 'sessionReturnBps'],
      binaryThresholdAuthorized: false,
      observation: 'DAY_SESSION_0845_1345',
    },
    downsideExcursion: {
      status: 'AVAILABLE_137_STRICT_SESSIONS',
      primaryFields: ['downsideExcursionBps', 'closeRecoveryFromLowBps'],
      binaryThresholdAuthorized: false,
      observation: 'DAY_SESSION_0845_1345',
    },
    trendRangeStructure: {
      status: 'AVAILABLE_137_STRICT_SESSIONS',
      primaryFields: ['sessionReturnBps', 'closeLocation', 'pathEfficiency'],
      binaryThresholdAuthorized: false,
      observation: 'DAY_SESSION_0845_1345',
      reuseGovernedFiveMinutePath: true,
      pathMustStartAtSessionOpen: true,
      pathMustEndAtSessionClose: true,
    },
    first60mContinuation: {
      status: 'AVAILABLE_137_STRICT_SESSIONS',
      primaryFields: ['openingLegBps', 'continuationRawBps', 'total60mBps', 'continuationInOpeningDirectionBps'],
      binaryThresholdAuthorized: false,
      observation: 'DAY_SESSION_0845_0945',
      flatOpeningLegUnavailableReason: 'FLAT_OPENING_LEG',
    },
  },
});

function finitePositive(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new Error(`OUTCOME_PRICE_INVALID:${name}`);
  return number;
}

export function returnBps(startPrice, endPrice) {
  const start = finitePositive(startPrice, 'startPrice');
  const end = finitePositive(endPrice, 'endPrice');
  return 10000 * (end - start) / start;
}

export function openingGapContinuous({ priorNightClose, dayOpen }) {
  const prior = finitePositive(priorNightClose, 'priorNightClose');
  const open = finitePositive(dayOpen, 'dayOpen');
  return {
    gapPoints: open - prior,
    gapBps: 10000 * (open - prior) / prior,
  };
}

export function sessionExcursions({ sessionOpen, sessionHigh, sessionLow, sessionClose }) {
  const open = finitePositive(sessionOpen, 'sessionOpen');
  const high = finitePositive(sessionHigh, 'sessionHigh');
  const low = finitePositive(sessionLow, 'sessionLow');
  const close = finitePositive(sessionClose, 'sessionClose');
  if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) {
    throw new Error('OUTCOME_SESSION_OHLC_INCONSISTENT');
  }
  const upExcursionBps = 10000 * (high - open) / open;
  const downExcursionBps = 10000 * (open - low) / open;
  return {
    upExcursionBps,
    downExcursionBps,
    maxExcursionBps: Math.max(upExcursionBps, downExcursionBps),
    sessionReturnBps: 10000 * (close - open) / open,
    downsideExcursionBps: downExcursionBps,
    closeRecoveryFromLowBps: 10000 * (close - low) / open,
  };
}

export function trendRangeStructure({ sessionOpen, sessionHigh, sessionLow, sessionClose, path }) {
  const open = finitePositive(sessionOpen, 'sessionOpen');
  const high = finitePositive(sessionHigh, 'sessionHigh');
  const low = finitePositive(sessionLow, 'sessionLow');
  const close = finitePositive(sessionClose, 'sessionClose');
  if (high < Math.max(open, low, close) || low > Math.min(open, high, close)) {
    throw new Error('OUTCOME_SESSION_OHLC_INCONSISTENT');
  }
  if (!Array.isArray(path) || path.length < 2) throw new Error('OUTCOME_PATH_INCOMPLETE');
  const nodes = path.map((value, index) => finitePositive(value, `path[${index}]`));
  if (nodes[0] !== open || nodes.at(-1) !== close) throw new Error('OUTCOME_PATH_BOUNDARY_MISMATCH');
  let travelled = 0;
  for (let index = 1; index < nodes.length; index += 1) travelled += Math.abs(nodes[index] - nodes[index - 1]);
  return {
    sessionReturnBps: 10000 * (close - open) / open,
    closeLocation: high > low ? (close - low) / (high - low) : null,
    pathEfficiency: travelled > 0 ? Math.abs(close - open) / travelled : null,
  };
}

export function first60mContinuation({ p0845, p0900, p0945 }) {
  const start = finitePositive(p0845, 'p0845');
  const mid = finitePositive(p0900, 'p0900');
  const end = finitePositive(p0945, 'p0945');
  const openingLegBps = 10000 * (mid - start) / start;
  const continuationRawBps = 10000 * (end - mid) / start;
  const total60mBps = 10000 * (end - start) / start;
  return {
    openingLegBps,
    continuationRawBps,
    total60mBps,
    continuationInOpeningDirectionBps: mid === start ? null : Math.sign(mid - start) * continuationRawBps,
    unavailableReason: mid === start ? 'FLAT_OPENING_LEG' : null,
  };
}

export function sampleInterpretation(sampleSize) {
  const n = Number(sampleSize);
  if (!Number.isInteger(n) || n < 0) throw new Error('OUTCOME_SAMPLE_SIZE_INVALID');
  if (n < 20) return 'DO_NOT_INTERPRET';
  if (n < 30) return 'DESCRIPTIVE_ONLY';
  return 'EFFECT_SIZE_AND_CI_ALLOWED';
}

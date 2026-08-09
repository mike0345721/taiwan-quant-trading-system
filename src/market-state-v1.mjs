const DIRECTION_BLOCKS = new Set(['localPrice', 'breadth', 'futuresPositioning', 'institutional']);
const VOLATILITY_BLOCKS = new Set(['localPrice', 'options']);
const RISK_BLOCKS = new Set(['options', 'globalFx', 'eventRisk']);

function parseTime(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertBoundary(input) {
  if (input?.executionAuthorized !== false) throw new Error('MARKET_STATE_EXECUTION_MUST_BE_FALSE');
  if (input?.researchOnly !== true) throw new Error('MARKET_STATE_RESEARCH_ONLY_REQUIRED');
}

function eligibleEvidence(evidence, decisionAt) {
  const decisionMs = parseTime(decisionAt);
  if (decisionMs == null) throw new Error('MARKET_STATE_DECISION_AT_INVALID');
  const accepted = [];
  const unavailable = [];
  for (const item of Array.isArray(evidence) ? evidence : []) {
    const availableMs = parseTime(item?.availableAt);
    if (availableMs == null) {
      unavailable.push({ key: item?.key || null, reason: 'AVAILABLE_AT_INVALID' });
      continue;
    }
    if (availableMs > decisionMs) {
      unavailable.push({ key: item?.key || null, reason: 'FUTURE_EVIDENCE' });
      continue;
    }
    if (item?.qualityStatus === 'INVALID' || item?.qualityStatus === 'STALE') {
      unavailable.push({ key: item?.key || null, reason: `QUALITY_${item.qualityStatus}` });
      continue;
    }
    accepted.push(item);
  }
  return { accepted, unavailable };
}

function groupByBlock(evidence) {
  const blocks = new Map();
  for (const item of evidence) {
    if (!blocks.has(item.block)) blocks.set(item.block, []);
    blocks.get(item.block).push(item);
  }
  return blocks;
}

function majorityLabel(items, field, allowed) {
  const counts = new Map(allowed.map((label) => [label, 0]));
  for (const item of items) {
    const value = item?.[field];
    if (counts.has(value)) counts.set(value, counts.get(value) + 1);
  }
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (!ranked.length || ranked[0][1] === 0) return 'UNAVAILABLE';
  if (ranked.length > 1 && ranked[0][1] === ranked[1][1]) return 'CONFLICT';
  return ranked[0][0];
}

function deriveDirection(blocks) {
  const votes = [];
  for (const [block, items] of blocks.entries()) {
    if (!DIRECTION_BLOCKS.has(block)) continue;
    const blockState = majorityLabel(items, 'direction', ['BULLISH', 'BEARISH', 'NEUTRAL']);
    if (blockState !== 'UNAVAILABLE' && blockState !== 'CONFLICT') votes.push({ block, state: blockState });
    else if (blockState === 'CONFLICT') votes.push({ block, state: 'CONFLICT' });
  }
  const usable = votes.filter((vote) => vote.state !== 'CONFLICT');
  if (usable.length < 2) return { state: 'UNAVAILABLE', votes };
  const bullish = usable.filter((vote) => vote.state === 'BULLISH').length;
  const bearish = usable.filter((vote) => vote.state === 'BEARISH').length;
  if (bullish >= 2 && bearish === 0) return { state: 'BULLISH', votes };
  if (bearish >= 2 && bullish === 0) return { state: 'BEARISH', votes };
  // CONFLICT is reserved for genuine opposing directional evidence.
  if (bullish > 0 && bearish > 0) return { state: 'CONFLICT', votes };
  // A lone directional block surrounded by neutral evidence is insufficient conviction,
  // not directional conflict. This matches the V1 semantic contract and is outcome-blind.
  return { state: 'NEUTRAL', votes };
}

function deriveTrend(blocks) {
  const local = blocks.get('localPrice') || [];
  const breadth = blocks.get('breadth') || [];
  const localTrend = majorityLabel(local, 'trend', ['TREND_UP', 'TREND_DOWN', 'RANGE', 'UNCLEAR']);
  const breadthDirection = majorityLabel(breadth, 'direction', ['BULLISH', 'BEARISH', 'NEUTRAL']);
  if (localTrend === 'TREND_UP' && breadthDirection !== 'BEARISH') return 'TREND_UP';
  if (localTrend === 'TREND_DOWN' && breadthDirection !== 'BULLISH') return 'TREND_DOWN';
  if (localTrend === 'RANGE' && ['NEUTRAL', 'UNAVAILABLE'].includes(breadthDirection)) return 'RANGE';
  // Historical V1 local-price evidence intentionally labels sign disagreement as UNCLEAR.
  // When that lack of local persistence is accompanied by neutral breadth, classify the
  // top-level descriptive state as RANGE. This is a pre-specified semantic rule, not a
  // performance-tuned threshold.
  if (localTrend === 'UNCLEAR' && breadthDirection === 'NEUTRAL') return 'RANGE';
  return 'UNCLEAR';
}

function deriveVolatility(blocks) {
  const values = [];
  for (const [block, items] of blocks.entries()) {
    if (!VOLATILITY_BLOCKS.has(block)) continue;
    for (const item of items) if (['LOW', 'NORMAL', 'HIGH'].includes(item?.volatility)) values.push(item.volatility);
  }
  if (!values.length) return 'UNAVAILABLE';
  if (values.includes('HIGH')) return 'HIGH';
  if (values.every((value) => value === 'LOW')) return 'LOW';
  return 'NORMAL';
}

function deriveRiskStates(blocks) {
  const stress = [];
  let hardRisk = false;
  for (const [block, items] of blocks.entries()) {
    if (!RISK_BLOCKS.has(block)) continue;
    for (const item of items) {
      if (item?.hardRisk === true) hardRisk = true;
      if (['ELEVATED', 'HIGH_RISK'].includes(item?.risk)) stress.push(item.risk);
    }
  }
  if (hardRisk || stress.includes('HIGH_RISK')) {
    return { risk: 'HIGH_RISK', riskResearchContext: 'HIGH_RISK' };
  }
  const criticalPresent = [...RISK_BLOCKS].some((block) => (blocks.get(block) || []).length > 0);
  if (!criticalPresent) return { risk: 'UNAVAILABLE', riskResearchContext: 'UNAVAILABLE' };
  return {
    risk: 'NORMAL',
    riskResearchContext: stress.length ? 'ELEVATED' : 'NORMAL',
  };
}

function deriveGlobalAlignment(blocks) {
  const items = blocks.get('globalFx') || [];
  const signals = items.map((item) => item?.globalAlignment).filter((value) => ['TAILWIND', 'HEADWIND', 'NEUTRAL'].includes(value));
  if (!signals.length) return 'UNAVAILABLE';
  const tailwind = signals.filter((value) => value === 'TAILWIND').length;
  const headwind = signals.filter((value) => value === 'HEADWIND').length;
  if (tailwind > 0 && headwind > 0) return 'MIXED';
  if (tailwind > 0) return 'TAILWIND';
  if (headwind > 0) return 'HEADWIND';
  return 'MIXED';
}

export function classifyPastOnlyPercentile(current, priorValues, { minimumHistory = 60 } = {}) {
  if (!Number.isFinite(Number(current))) return { percentile: null, bucket: 'UNAVAILABLE', sampleSize: 0 };
  const values = (Array.isArray(priorValues) ? priorValues : []).map(Number).filter(Number.isFinite);
  if (values.length < minimumHistory) return { percentile: null, bucket: 'UNAVAILABLE', sampleSize: values.length };
  const percentile = values.filter((value) => value <= Number(current)).length / values.length;
  let bucket = 'NEUTRAL';
  if (percentile >= 0.8) bucket = 'EXTREME_POSITIVE';
  else if (percentile >= 0.6) bucket = 'POSITIVE';
  else if (percentile <= 0.2) bucket = 'EXTREME_NEGATIVE';
  else if (percentile <= 0.4) bucket = 'NEGATIVE';
  return { percentile, bucket, sampleSize: values.length };
}

export function evaluatePremarketMarketState(input = {}) {
  assertBoundary(input);
  const { accepted, unavailable } = eligibleEvidence(input.evidence, input.decisionAt);
  const blocks = groupByBlock(accepted);
  const direction = deriveDirection(blocks);
  const riskStates = deriveRiskStates(blocks);
  const state = {
    trend: deriveTrend(blocks),
    direction: direction.state,
    volatility: deriveVolatility(blocks),
    risk: riskStates.risk,
    globalAlignment: deriveGlobalAlignment(blocks),
  };
  const conflicts = [];
  if (direction.state === 'CONFLICT') conflicts.push({ type: 'DIRECTION_BLOCK_CONFLICT', votes: direction.votes });
  if (state.globalAlignment === 'MIXED') conflicts.push({ type: 'GLOBAL_ALIGNMENT_MIXED' });
  return {
    schemaVersion: 'market-state-v1-premarket-evaluator-v0',
    tradeDate: input.tradeDate || null,
    decisionAt: input.decisionAt,
    state,
    riskResearchContext: riskStates.riskResearchContext,
    blocks: Object.fromEntries([...blocks.entries()]),
    evidence: accepted,
    conflicts,
    unavailable,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

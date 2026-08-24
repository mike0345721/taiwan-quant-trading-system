const RANKINGS = Object.freeze(['abs10', 'positive25', 'negative25']);
const LIVE_FRESHNESS_MS = 10_000;

function finite(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function iso(value) {
  if (!value || Number.isNaN(Date.parse(value))) return null;
  return new Date(value).toISOString();
}

function taipeiParts(now) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type) => parts.find((part) => part.type === type)?.value;
  return {
    tradeDate: `${value('year')}-${value('month')}-${value('day')}`,
    weekday: value('weekday'),
    minute: Number(value('hour')) * 60 + Number(value('minute')),
  };
}

function normalizeEntry(entry = {}) {
  return Object.freeze({
    code: typeof entry.code === 'string' ? entry.code : null,
    price: finite(entry.price),
    reference: finite(entry.reference),
    priceChange: finite(entry.priceChange),
    pctChange: finite(entry.pctChange),
    points: finite(entry.points),
  });
}

function normalizeIndustryEntry(entry = {}) {
  return Object.freeze({
    category: typeof entry.category === 'string' ? entry.category : null,
    points: finite(entry.points),
  });
}

function rankRows(rows, mode) {
  return Object.freeze([...rows].sort((left, right) => {
    if (mode === 'positive') return (right.points ?? -Infinity) - (left.points ?? -Infinity);
    if (mode === 'negative') return (left.points ?? Infinity) - (right.points ?? Infinity);
    return Math.abs(right.points ?? 0) - Math.abs(left.points ?? 0);
  }));
}

function pointsSum(rows) {
  return rows.every((row) => row.points != null)
    ? rows.reduce((sum, row) => sum + row.points, 0) : null;
}

function normalizeRanking(raw, ranking) {
  if (!raw || raw.simtrade === true || raw.ranking !== ranking || raw.indexCode !== 'IX0001') return null;
  const entries = Object.freeze((Array.isArray(raw.entries) ? raw.entries : []).map(normalizeEntry));
  return Object.freeze({
    recordType: raw.recordType || 'IX0001_INDEX_CONTRIBUTION_RAW',
    ranking,
    tradeDate: raw.tradeDate || null,
    session: raw.session === 'DAY' ? 'DAY' : 'DAY',
    eventTime: iso(raw.eventTime),
    receivedAt: iso(raw.receivedAt),
    availableAt: iso(raw.availableAt),
    qualityStatus: raw.qualityStatus || 'QUALITY_INSUFFICIENT',
    qualityReasons: Object.freeze(Array.isArray(raw.qualityReasons) ? [...raw.qualityReasons] : []),
    rawPayloadHash: /^[a-f0-9]{64}$/.test(raw.rawPayloadHash || '') ? raw.rawPayloadHash : null,
    entries,
    pointsSum: pointsSum(entries),
    simtrade: false,
    promotionState: 'NOT_PROMOTED',
  });
}

function normalizeIndustry(raw) {
  if (!raw || raw.simtrade === true || raw.indexCode !== 'IX0001') return null;
  const entries = Object.freeze((Array.isArray(raw.entries) ? raw.entries : []).map(normalizeIndustryEntry));
  return Object.freeze({
    recordType: raw.recordType || 'IX0001_INDUSTRY_CONTRIBUTION_RAW',
    tradeDate: raw.tradeDate || null,
    session: 'DAY',
    eventTime: iso(raw.eventTime),
    receivedAt: iso(raw.receivedAt),
    availableAt: iso(raw.availableAt),
    qualityStatus: raw.qualityStatus || 'QUALITY_INSUFFICIENT',
    qualityReasons: Object.freeze(Array.isArray(raw.qualityReasons) ? [...raw.qualityReasons] : []),
    rawPayloadHash: /^[a-f0-9]{64}$/.test(raw.rawPayloadHash || '') ? raw.rawPayloadHash : null,
    indexClose: finite(raw.indexClose),
    indexPriceChange: finite(raw.indexPriceChange),
    industryPointsSum: finite(raw.industryPointsSum),
    industryInvariantDelta: finite(raw.industryInvariantDelta),
    industryInvariantTolerance: finite(raw.industryInvariantTolerance),
    entries,
    simtrade: false,
    promotionState: 'NOT_PROMOTED',
  });
}

function healthRecord(sourceId, sourceType, source, state, subscriptionState) {
  const available = Boolean(source) || ['RESTORED', 'DEFAULT_OFF'].includes(subscriptionState);
  return Object.freeze({
    sourceId,
    sourceType,
    sourceAvailability: available ? 'SOURCE_AVAILABLE' : 'SOURCE_MISSING',
    subscriptionState: subscriptionState || 'UNKNOWN',
    tradeDate: source?.tradeDate || null,
    session: 'DAY',
    availableAt: source?.availableAt || null,
    freshnessState: source && state === 'LIVE' ? 'LIVE'
      : source && state === 'SESSION_CLOSED' ? 'SESSION_CLOSED' : 'UNAVAILABLE',
    quality: source?.qualityStatus || 'UNAVAILABLE',
    simtradeState: source ? 'LIVE_MATCHING' : 'NO_LIVE_EVENT',
    reconnectState: 'USES_EXISTING_SINGLE_BRIDGE',
    restorationState: subscriptionState === 'RESTORED' ? 'RESTORED'
      : subscriptionState === 'DEFAULT_OFF' ? 'NOT_REQUESTED' : 'PENDING',
    promotionState: 'NOT_PROMOTED',
  });
}

export function buildIndexLeadership(raw = {}, {
  now = new Date(),
  indexSubscriptionState = 'UNKNOWN',
  industrySubscriptionState = 'UNKNOWN',
} = {}) {
  const rankings = Object.fromEntries(RANKINGS.map((ranking) => [ranking, normalizeRanking(raw?.indexContribution?.[ranking], ranking)]));
  const industry = normalizeIndustry(raw?.industryContribution);
  const all = RANKINGS.flatMap((ranking) => rankings[ranking]?.entries || []);
  const positiveSource = rankings.positive25?.entries || all.filter((row) => (row.points ?? 0) > 0);
  const negativeSource = rankings.negative25?.entries || all.filter((row) => (row.points ?? 0) < 0);
  const absoluteSource = rankings.abs10?.entries || all;
  const latestAvailableAt = [
    ...RANKINGS.map((ranking) => rankings[ranking]?.availableAt), industry?.availableAt,
  ].filter(Boolean).sort().at(-1) || null;
  const sourceTradeDate = [
    ...RANKINGS.map((ranking) => rankings[ranking]?.tradeDate), industry?.tradeDate,
  ].filter(Boolean).sort().at(-1) || null;
  const hasLiveData = Boolean(all.length || industry?.entries?.length);
  const clock = taipeiParts(now);
  const ageMs = latestAvailableAt ? now.getTime() - Date.parse(latestAvailableAt) : Infinity;
  const marketOpen = !['Sat', 'Sun'].includes(clock.weekday) && clock.minute >= 540 && clock.minute <= 815;
  const futureViolation = ageMs < -1_000;
  const live = hasLiveData && !futureViolation && marketOpen && sourceTradeDate === clock.tradeDate
    && ageMs <= LIVE_FRESHNESS_MS;
  const state = live ? 'LIVE' : hasLiveData && !futureViolation ? 'SESSION_CLOSED' : 'UNAVAILABLE';
  const sourceMode = live ? 'LIVE_RAW' : state === 'SESSION_CLOSED' ? 'EOD_CONTEXT' : 'UNAVAILABLE';
  const topPositive = rankRows(positiveSource.filter((row) => (row.points ?? 0) > 0), 'positive').slice(0, 10);
  const topNegative = rankRows(negativeSource.filter((row) => (row.points ?? 0) < 0), 'negative').slice(0, 10);
  const topAbsolute = rankRows(absoluteSource.filter((row) => row.points != null), 'absolute').slice(0, 10);
  const industryRows = rankRows(industry?.entries || [], 'absolute');
  const complete = RANKINGS.every((ranking) => Boolean(rankings[ranking])) && Boolean(industry);
  const quality = [
    ...RANKINGS.map((ranking) => rankings[ranking]?.qualityStatus).filter(Boolean),
    industry?.qualityStatus,
  ].filter(Boolean).every((value) => value === 'PASS') && complete ? 'PASS' : 'QUALITY_INSUFFICIENT';
  const indexSource = rankings.abs10 || rankings.positive25 || rankings.negative25;
  return Object.freeze({
    schemaVersion: 'ix0001-leadership-view-v1', indexCode: 'IX0001', session: 'DAY',
    runtimeActivationState: raw?.collectionEnabled === true ? 'ENABLED' : 'DEFAULT_OFF',
    state, sourceMode, sourceTradeDate, lastAvailableAt: latestAvailableAt,
    freshnessState: state === 'LIVE' ? 'LIVE' : state === 'SESSION_CLOSED' ? 'SESSION_CLOSED' : 'UNAVAILABLE',
    quality, reasonCode: futureViolation ? 'IX0001_FUTURE_DATA_VIOLATION'
      : !hasLiveData ? 'LIVE_DAY_EVENT_ACCEPTANCE_PENDING'
        : state === 'SESSION_CLOSED' ? 'CURRENT_SESSION_NOT_TWSE_DAY' : null,
    indexLeadership: Object.freeze({ rankings: Object.freeze(rankings), topPositive, topNegative, topAbsolute,
      positivePointsSum: pointsSum(topPositive), negativePointsSum: pointsSum(topNegative), absolutePointsSum: pointsSum(topAbsolute) }),
    industryLeadership: Object.freeze({ source: industry, rows: industryRows,
      pointsSum: industry?.industryPointsSum ?? pointsSum(industryRows), indexPriceChange: industry?.indexPriceChange ?? null,
      invariantDelta: industry?.industryInvariantDelta ?? null, invariantTolerance: industry?.industryInvariantTolerance ?? null }),
    dataHealth: Object.freeze({
      ix0001IndexContribution: healthRecord('ix0001IndexContribution', 'SHIOAJI_IX0001_INDEX_CONTRIBUTION', indexSource, state, indexSubscriptionState),
      ix0001IndustryContribution: healthRecord('ix0001IndustryContribution', 'SHIOAJI_IX0001_INDUSTRY_CONTRIBUTION', industry, state, industrySubscriptionState),
    }),
    simulatedMatchingPresent: Boolean(
      Object.keys(raw?.simulatedMatching?.indexContribution || {}).length || raw?.simulatedMatching?.industryContribution
    ),
    concepts: Object.freeze({ REALTIME_INDEX_CONTRIBUTION: 'AVAILABLE', HISTORICAL_EFFECTIVE_WEIGHTS: 'SOURCE_GAP' }),
    LEADERSHIP_DESCRIPTIVE_ONLY: true, NOT_PROMOTED: true, NOT_A_TRADING_SIGNAL: true,
    recommendation: false, systemDirectionalSignal: false, formalWeight: 0, researchOnly: true,
    executionAuthorized: false, orderRoutesEnabled: false,
  });
}

export function leadershipCopyAllowlist(leadership) {
  return Object.freeze({
    indexLeadership: leadership?.indexLeadership || null,
    industryLeadership: leadership?.industryLeadership || null,
    leadershipSource: Object.freeze({
      indexCode: 'IX0001', session: 'DAY', state: leadership?.state || 'UNAVAILABLE',
      sourceMode: leadership?.sourceMode || 'UNAVAILABLE', sourceTradeDate: leadership?.sourceTradeDate || null,
      lastAvailableAt: leadership?.lastAvailableAt || null, quality: leadership?.quality || 'QUALITY_INSUFFICIENT',
    }),
    LEADERSHIP_DESCRIPTIVE_ONLY: true, NOT_PROMOTED: true, NOT_A_TRADING_SIGNAL: true,
  });
}

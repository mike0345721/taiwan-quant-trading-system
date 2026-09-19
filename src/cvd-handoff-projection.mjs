import { SAFETY, stableJson } from './cvd-observation-core.mjs';
import { FRAMES } from './cvd-chart-projection.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';

const equal = (a, b) => stableJson(a) === stableJson(b);
const finite = Number.isFinite;
const hash = x => /^[a-f0-9]{64}$/.test(x || '');
const usableLineage = l => l && /^sha256:[a-f0-9]{64}$/.test(l.sourceLedgerIdentity || '')
  && Number.isSafeInteger(l.cutoffLedgerOrdinal) && l.cutoffLedgerOrdinal > 0 && hash(l.cutoffRecordHash)
  && l.availabilityLineageStatus === 'USABLE' && finite(l.availableAtMs) && timestampMs(l.availableAt) === l.availableAtMs;

// Session endpoints are observed lawful prices, never claimed exchange open/close.
// All price inputs come from the hash-verified C canonical prefix, not a new raw reader.
export function handoffSide(loaded, events, calendar, timeframe) {
  const r = loaded.relationships[timeframe], chart = loaded.charts[timeframe], c = r?.current;
  const side = { evidenceKind: r?.evidenceKind ?? null, generationHash: r?.generationHash ?? null,
    semanticHash: r?.semanticHash ?? null, sourceCutoff: r?.sourceCutoff ?? null,
    timeframe, identity: c?.identity ?? null, segment: c?.segment ?? null, lineage: c?.lineage ?? null,
    relationship: c?.relationship ?? { code: 'UNAVAILABLE' }, evidence: c?.current ?? null,
    cumulativeCvd: c?.cumulativeCvd ?? null, firstPrice: null, lastPrice: null, sessionContext: null,
    captureCompleteness: 'UNPROVEN', endpointScope: 'OBSERVED_FRAGMENT_FIRST_LAST', reason: null };
  const refuse = reason => ({ ...side, reason });
  if (!FRAMES.includes(timeframe) || !r || !chart || r.timeframe !== timeframe || chart.timeframe !== timeframe
    || r.generationHash !== chart.generationHash || r.semanticHash !== chart.semanticHash || !equal(r.sourceCutoff, chart.cutoff)
    || !equal(c?.identity, chart.identity) || Object.entries(SAFETY).some(([k,v]) => r[k] !== v || chart[k] !== v)) return refuse('SIDE_BINDING_INVALID');
  if (!usableLineage(c?.lineage)) return refuse('SIDE_LINEAGE_UNAVAILABLE');
  if (chart.segments.length !== 1 || chart.segmentIndex !== 0 || c.segment !== 0 || chart.segments[0].clockInvalid
    || chart.segments[0].terminalInvalid || chart.display.boundaryAtCutoff || !c.current) return refuse('SINGLE_LAWFUL_SEGMENT_REQUIRED');
  if (!/^TXF[A-L]\d$/.test(c.identity?.[0] || '') || !c.identity?.[3]) return refuse('TX_IDENTITY_UNAVAILABLE');
  let context;
  try {
    context = classifyTxChartSession(c.anchorEventTime, calendar);
    const origin = classifyTxChartSession(chart.origin.eventTime, calendar);
    if (context.sessionId !== origin.sessionId || context.session !== c.identity[2] || context.tradeDate !== c.identity[1]) return refuse('SESSION_CONTEXT_MISMATCH');
  } catch { return refuse('GOVERNED_SESSION_UNAVAILABLE'); }
  side.sessionContext = context;
  const points = new Map(r.observations.map(o => [o.lineage.cutoffLedgerOrdinal, o]));
  let previousTime = -Infinity;
  for (const e of events) {
    if (e.kind !== 'futures_tick' || e.ledgerOrdinal > c.lineage.cutoffLedgerOrdinal) continue;
    const o = points.get(e.ledgerOrdinal);
    if (!o || o.segment !== c.segment || !equal(o.identity,c.identity) || o.lineage.cutoffRecordHash !== e.recordHash
      || e.sourceLedgerIdentity !== c.lineage.sourceLedgerIdentity || !usableLineage(o.lineage)
      || e.identityStatus !== 'USABLE' || e.product !== 'TX' || e.availableMs > c.lineage.availableAtMs) continue;
    const raw = e.payload?.price ?? e.payload?.close, rawVolume = e.payload?.executedVolume ?? e.payload?.volume;
    const price = raw == null || raw === '' ? null : Number(raw), volume = rawVolume == null || rawVolume === '' ? null : Number(rawVolume);
    if (!finite(price) || price <= 0 || !finite(volume) || volume <= 0 || !finite(e.eventMs) || e.availableMs < e.eventMs) continue;
    let session;
    try { session = classifyTxChartSession(e.eventTime, calendar); } catch { continue; }
    if (session.sessionId !== context.sessionId || e.eventMs < Date.parse(context.sessionStart) || e.eventMs > Date.parse(context.sessionEnd)) continue;
    if (e.eventMs < previousTime) return refuse('PRICE_PHYSICAL_TIME_REGRESSION');
    previousTime = e.eventMs;
    const endpoint = { price, eventTime: e.eventTime, eventMs: e.eventMs, lineage: o.lineage };
    side.firstPrice ??= endpoint; side.lastPrice = endpoint;
  }
  return side;
}

export function proveHandoffPair(prior, current, calendar) {
  if (!prior || !current) return { state: 'NOT_COMPARABLE', reason: 'SESSION_SIDE_MISSING' };
  if (prior.reason || current.reason) return { state: 'NOT_COMPARABLE', reason: prior.reason ? 'PRIOR_' + prior.reason : 'CURRENT_' + current.reason };
  if (prior.evidenceKind !== current.evidenceKind) return { state: 'NOT_COMPARABLE', reason: 'REAL_SYNTHETIC_MIX_REFUSED' };
  if (prior.identity[0] !== current.identity[0]) return { state: 'NOT_COMPARABLE', reason: 'ACTUAL_CONTRACT_NOT_COMPARABLE' };
  const p = prior.sessionContext, c = current.sessionContext;
  let lawful = false, kind = null;
  try {
    // Reuse the existing resolver for calendar-D afternoon; no new next-trade-date rule.
    if (p.session === 'NIGHT' && c.session === 'DAY') {
      const expectedNight = classifyTxChartSession(p.sessionStart, calendar);
      lawful = expectedNight.tradeDate === c.tradeDate && p.tradeDate === c.tradeDate && Date.parse(p.sessionEnd) < Date.parse(c.sessionStart);
      kind = 'NIGHT_TO_DAY';
    } else if (p.session === 'DAY' && c.session === 'NIGHT') {
      const expectedNight = classifyTxChartSession(p.tradeDate + 'T15:00:00+08:00', calendar);
      lawful = expectedNight.sessionId === c.sessionId && expectedNight.tradeDate === c.tradeDate;
      kind = 'DAY_TO_NEXT_NIGHT';
    }
  } catch { return { state: 'NOT_COMPARABLE', reason: 'GOVERNED_ADJACENCY_UNAVAILABLE' }; }
  if (!lawful) return { state: 'NOT_COMPARABLE', reason: 'SESSIONS_NOT_GOVERNED_ADJACENT' };
  if (prior.lineage.availableAtMs > current.lineage.availableAtMs) return { state: 'NOT_COMPARABLE', reason: 'PRIOR_NOT_AVAILABLE_AT_CURRENT_CUTOFF' };
  return { state: 'COMPARABLE', reason: null, kind, calendarFileHash: calendar.fileHash,
    closedMarketGap: { start: p.sessionEnd, end: c.sessionStart, interpolation: false, cvd: null, volume: null, pressure: null, pathEfficiency: null } };
}

function cleanDirection(side) {
  const e = side.evidence;
  if (!['ALIGNED','ALIGNED_BUT_WEAKENING'].includes(side.relationship.code) || !e?.complete || e.status === 'UNAVAILABLE'
    || e.quality?.status !== 'READY' || e.pressure?.classifiedCoverage !== 1 || e.parity !== 'EXACT'
    || !finite(e.deltaCvd) || !finite(e.response?.displacementPoints) || !e.deltaCvd || !e.response.displacementPoints
    || e.deltaCvd !== e.pressure.netAggressiveFlowProxy || Math.sign(e.deltaCvd) !== Math.sign(e.response.displacementPoints)) return null;
  return Math.sign(e.deltaCvd);
}

export function classifyHandoff(prior, current, pairing, gap) {
  if (pairing.state !== 'COMPARABLE' || gap.state !== 'AVAILABLE') return { code: 'UNAVAILABLE', reason: pairing.reason || gap.reason };
  const p = cleanDirection(prior), c = cleanDirection(current);
  // Frozen precedence: takeover > opening rejection > weakening > continuation.
  if (p && c === -p) return { code: 'OPPOSITE_TAKEOVER', reason: 'CLEAN_OPPOSITE_CURRENT_DIRECTION' };
  if (p && Math.sign(gap.points) === -p) return { code: 'PRIOR_SESSION_REJECTED', reason: 'OPPOSITE_OBSERVED_OPENING_PRICE_GAP' };
  if (p && c === p) return { code: current.relationship.code === 'ALIGNED_BUT_WEAKENING' ? 'CONFIRMED_BUT_WEAKENING' : 'CONFIRMED_CONTINUATION', reason: 'SAME_CLEAN_DIRECTION' };
  return { code: 'UNCONFIRMED_OR_CONFLICT', reason: 'PARTIAL_QUALITY_COVERAGE_OR_RELATIONSHIP_LIMITED' };
}

export function buildCvdHandoffProjection(priorLoaded, currentLoaded, priorEvents, currentEvents, calendar, timeframe = '1m') {
  const prior = priorLoaded ? handoffSide(priorLoaded, priorEvents, calendar, timeframe) : null;
  const current = handoffSide(currentLoaded, currentEvents, calendar, timeframe);
  const pairing = proveHandoffPair(prior, current, calendar);
  let gap = { state: 'UNAVAILABLE', points: null, reason: pairing.reason, scope: 'OBSERVED_FRAGMENT_ENDPOINT_PRICES_ONLY' };
  if (pairing.state === 'COMPARABLE') {
    const p = prior.lastPrice, c = current.firstPrice;
    const reason = !p ? 'PRIOR_LAWFUL_PRICE_MISSING' : !c ? 'CURRENT_LAWFUL_PRICE_MISSING'
      : p.lineage.availableAtMs > current.lineage.availableAtMs ? 'PRIOR_PRICE_NOT_AVAILABLE_AT_CURRENT_CUTOFF'
        : p.eventMs >= c.eventMs ? 'PRICE_ENDPOINT_ORDER_INVALID' : null;
    gap = { ...gap, state: reason ? 'UNAVAILABLE' : 'AVAILABLE', reason, points: reason ? null : c.price - p.price };
  }
  const result = { schemaVersion: 'cru54-handoff-v1', ...SAFETY, timeframe,
    generationHash: current.generationHash, semanticHash: current.semanticHash, sourceCutoff: current.sourceCutoff,
    evidenceKind: prior?.evidenceKind === current.evidenceKind ? current.evidenceKind : prior ? 'MIXED_INPUT_REFUSED' : current.evidenceKind,
    availableAt: current.lineage?.availableAt ?? null, prior, current, pairing, gap,
    handoff: classifyHandoff(prior, current, pairing, gap),
    method: { pressureIndependentVote: false, crossGapCvdArithmetic: false, crossGapPath: false, closedGapInterpolation: false, formalDirectionPromoted: false } };
  if (Buffer.byteLength(JSON.stringify(result)) > 128 * 1024) throw Error('HANDOFF_RESPONSE_BUDGET');
  return result;
}

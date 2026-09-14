import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { timestampMs } from './tx-intraday-pressure-path-efficiency.mjs';
import { buildTxObservedFlowWindow } from './tx-intraday-research-snapshot.mjs';
import { CRU44_WINDOW_REGISTRY } from './cru44-multi-window-observed-flow.mjs';

export const RELATIONSHIP_LIMITS = Object.freeze({ snapshots: 1024, canonicalEvents: 25000, frameBytes: 2 * 1024 * 1024, transitions: 256 });
const windows = Object.fromEntries(Object.values(CRU44_WINDOW_REGISTRY).map(w => [w.key, w.windowMs]));
const identity = e => [e.actualContract, e.tradeDate, e.session, e.continuityEpoch];
const equal = (a, b) => stableJson(a) === stableJson(b);
const finite = Number.isFinite;
const fail = reason => { throw Error(reason); };
const lineage = e => ({ sourceLedgerIdentity: e.sourceLedgerIdentity, cutoffLedgerOrdinal: e.ledgerOrdinal, cutoffRecordHash: e.recordHash, availableAt: e.availableAt, availableAtMs: e.availableMs, availabilityLineageStatus: e.availabilityLineageStatus });

export function compareEqualWindow(current, previous) {
  if (!finite(current) || !finite(previous)) return '前窗不可比較';
  if (current !== 0 && previous !== 0 && Math.sign(current) !== Math.sign(previous)) return '方向翻轉';
  return Math.abs(current) > Math.abs(previous) ? '較前窗放大' : Math.abs(current) < Math.abs(previous) ? '較前窗縮小' : '持平';
}

// One executed-flow family. Pressure is corroborating parity, never another vote.
export function classifyRelationship(current, previous) {
  if (!current || current.status === 'UNAVAILABLE') return { code: 'UNAVAILABLE', descriptiveCode: null, reason: current?.reason || 'WINDOW_UNAVAILABLE' };
  const flow = current.deltaCvd, response = current.response?.displacementPoints;
  const descriptiveCode = !finite(flow) || !finite(response) || flow === 0 ? null
    : response === 0 ? 'PRESSURE_RESPONSE_MISMATCH'
      : Math.sign(flow) === Math.sign(response) ? 'ALIGNED' : 'OPPOSITE_DIVERGENCE';
  const limited = !current.complete || current.pressure?.classifiedCoverage !== 1
    || current.quality?.status !== 'READY' || !descriptiveCode;
  if (limited) return { code: 'MIXED_OR_QUALITY_LIMITED', descriptiveCode, reason: current.reason || 'QUALITY_OR_EVIDENCE_LIMITED' };
  const priorLawful = previous?.complete && previous.status !== 'UNAVAILABLE' && previous.quality?.status === 'READY';
  const weakening = descriptiveCode === 'ALIGNED' && priorLawful && finite(previous.deltaCvd)
    && Math.sign(previous.deltaCvd) === Math.sign(flow)
    && Math.sign(previous.response.displacementPoints) === Math.sign(response)
    && (Math.abs(flow) < Math.abs(previous.deltaCvd)
      || Math.abs(response) < Math.abs(previous.response.displacementPoints)
      || current.pathEfficiency.value < previous.pathEfficiency.value);
  return { code: weakening ? 'ALIGNED_BUT_WEAKENING' : descriptiveCode, descriptiveCode, reason: weakening ? 'PRIOR_EQUAL_WINDOW_DETERIORATION' : 'SAME_CUTOFF_DESCRIPTIVE_RELATIONSHIP' };
}

function windowEvidence(events, points, cutoff, segment, windowMs, previous = false) {
  const upper = cutoff.eventMs - (previous ? windowMs : 0), lower = upper - windowMs;
  const first = points[0], originEventMs = timestampMs(first.eventTime), originAvailableMs = timestampMs(first.availableAt);
  const requiredSpanMs = previous ? windowMs * 2 : windowMs;
  const observedSpanMs = Math.max(0, Math.min(cutoff.eventMs - originEventMs, cutoff.availableMs - originAvailableMs));
  const complete = observedSpanMs >= requiredSpanMs;
  const descriptor = { ...cutoff, eventMs: upper }; // Evaluation bound only, never a fabricated event/decision.
  const selected = points.filter(p => p.ledgerOrdinal <= cutoff.ledgerOrdinal && timestampMs(p.eventTime) > lower && timestampMs(p.eventTime) <= upper);
  const publicWindow = buildTxObservedFlowWindow(events, descriptor, { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 }, windowMs).public;
  const result = { status: complete ? 'OBSERVED_WINDOW' : 'PARTIAL', complete,
    reason: complete ? publicWindow.unavailableReason : 'WINDOW_INCOMPLETE', windowMs, lowerExclusiveMs: lower, upperInclusiveMs: upper,
    observedSpanMs: Math.min(observedSpanMs, requiredSpanMs), requiredSpanMs, originEventMs, originAvailableMs,
    baseline: previous ? 'PREVIOUS_EQUAL_WINDOW_AS_OF_CURRENT_CUTOFF' : 'CURRENT_WINDOW_AS_OF_CUTOFF',
    lineage: lineage(cutoff), identity: segment.identity, segment: first.segment,
    deltaCvd: null, observedVolume: publicWindow.pressure.totalExecutedVolume ?? null,
    unknownVolume: publicWindow.pressure.unknownVolume ?? null, pressure: publicWindow.pressure,
    response: publicWindow.response, pathEfficiency: publicWindow.pathEfficiency, quality: publicWindow.quality,
    parity: 'UNAVAILABLE', captureCompleteness: 'UNPROVEN', sessionStartProven: false };
  if (!selected.length) return { ...result, status: 'UNAVAILABLE', reason: 'NO_OBSERVED_TICKS_IN_WINDOW' };
  let delta = 0, classified = 0;
  for (const p of selected) {
    const i = points.indexOf(p), prior = i ? points[i - 1] : null;
    // Null due solely to no classified history is not invalid evidence; all-UNKNOWN still returns null below.
    if ((p.value == null && p.reason !== 'NO_CLASSIFIED_VOLUME') || (prior?.value == null && prior?.reason !== 'NO_CLASSIFIED_VOLUME' && prior))
      return { ...result, status: 'UNAVAILABLE', reason: 'ACCEPTED_CVD_NULL_GAP' };
    const currentClassified = p.buyProxyVolume + p.sellProxyVolume, priorClassified = prior ? prior.buyProxyVolume + prior.sellProxyVolume : 0;
    classified += currentClassified - priorClassified;
    delta += (p.buyProxyVolume - p.sellProxyVolume) - (prior ? prior.buyProxyVolume - prior.sellProxyVolume : 0);
  }
  if (!classified) return { ...result, reason: 'NO_CLASSIFIED_VOLUME' };
  if (!finite(publicWindow.pressure.netAggressiveFlowProxy)) return { ...result, status: 'UNAVAILABLE', reason: publicWindow.pressure.unavailableReason || 'PRESSURE_UNAVAILABLE' };
  if (delta !== publicWindow.pressure.netAggressiveFlowProxy) fail('RELATIONSHIP_CVD_PRESSURE_PARITY_MISMATCH');
  return { ...result, deltaCvd: delta, parity: 'EXACT', reason: result.reason || 'CAPTURE_COMPLETENESS_UNPROVEN' };
}

export function collapseRelationshipTimeline(observations) {
  const events = []; let prior = null;
  for (const o of observations) {
    if (!finite(o.lineage.availableAtMs) || o.lineage.availabilityLineageStatus !== 'USABLE') { prior = null; continue; }
    if (!prior || prior.segment !== o.segment) { prior = o; continue; }
    if (o.relationship.code !== prior.relationship.code) {
      events.push({ segment: o.segment, identity: o.identity, from: prior.relationship.code, to: o.relationship.code,
        decisionTime: o.lineage.availableAt, time: o.lineage.availableAtMs / 1000, lineage: o.lineage, anchorEventTime: o.anchorEventTime });
    }
    prior = o;
  }
  if (events.length > RELATIONSHIP_LIMITS.transitions) fail('RELATIONSHIP_TRANSITION_BUDGET');
  return events;
}

export function mapRelationshipMarkers(timeline, bars, segments, windowMs, displayedIdentity = null) {
  const markers = []; const occupied = new Set();
  for (const event of timeline) {
    if (displayedIdentity && !equal(event.identity.slice(0, 3), displayedIdentity.slice(0, 3))) continue;
    if (['UNAVAILABLE', 'MIXED_OR_QUALITY_LIMITED'].includes(event.from) || ['UNAVAILABLE', 'MIXED_OR_QUALITY_LIMITED'].includes(event.to)) continue;
    const segment = segments[event.segment];
    const start = timestampMs(segment.startAvailableAt) / 1000, end = timestampMs(segment.availableAt) / 1000;
    const bar = bars.find(b => b.time >= event.time && b.time >= start && b.time + windowMs / 1000 <= end
      && equal([b.actualContract, b.tradeDate, b.session], event.identity.slice(0, 3))
      && !segments.some((other, i) => i !== event.segment && timestampMs(other.startAvailableAt) / 1000 < b.time + windowMs / 1000 && timestampMs(other.availableAt) / 1000 >= b.time));
    if (bar && !occupied.has(bar.time)) { occupied.add(bar.time); markers.push({ ...event, time: bar.time, placement: 'FIRST_ELIGIBLE_BAR_START_NOT_BEFORE_AVAILABLE_AT' }); }
  }
  return markers;
}

export function buildCvdRelationshipProjection(generation, canonicalEvents, chart, timeframe = '1m') {
  const s = generation?.result?.semantic, windowMs = windows[timeframe];
  if (!windowMs) fail('RELATIONSHIP_WINDOW_INVALID');
  if (!s || generation.result.semanticHash !== digest(stableJson(s)) || Object.entries(SAFETY).some(([k, v]) => s[k] !== v)) fail('RELATIONSHIP_SEMANTIC_INVALID');
  if (chart.generationHash !== generation.generationHash || chart.semanticHash !== generation.result.semanticHash || chart.timeframe !== timeframe) fail('RELATIONSHIP_CHART_IDENTITY_MISMATCH');
  if (s.series.length > RELATIONSHIP_LIMITS.snapshots || canonicalEvents.length > RELATIONSHIP_LIMITS.canonicalEvents) fail('RELATIONSHIP_PREPARATION_BUDGET');
  let ordinal = 0;
  for (const e of canonicalEvents) {
    if (e.ledgerOrdinal <= ordinal || e.ledgerOrdinal > s.cutoffLedgerOrdinal || e.sourceLedgerIdentity !== s.sourceLedgerIdentity) fail('RELATIONSHIP_CANONICAL_PREFIX_INVALID');
    ordinal = e.ledgerOrdinal;
  }
  const observations = [];
  for (const point of s.series) {
    const cutoff = canonicalEvents.find(e => e.ledgerOrdinal === point.ledgerOrdinal), segment = s.segments[point.segment];
    if (!cutoff || cutoff.kind !== 'futures_tick' || cutoff.recordHash !== point.recordHash || !equal(identity(cutoff), segment.identity)
      || cutoff.availableAt !== point.availableAt || cutoff.eventTime !== point.eventTime) fail('RELATIONSHIP_CUTOFF_IDENTITY_MISMATCH');
    const base = { segment: point.segment, identity: segment.identity, anchorEventTime: cutoff.eventTime, anchorEventMs: cutoff.eventMs,
      lineage: lineage(cutoff), cumulativeCvd: point.value, current: null, previous: null,
      comparisons: { volume: '前窗不可比較', deltaCvd: '前窗不可比較', response: '前窗不可比較', path: '前窗不可比較' } };
    if (cutoff.identityStatus !== 'USABLE' || cutoff.availabilityLineageStatus !== 'USABLE' || !finite(cutoff.availableMs) || !finite(cutoff.eventMs)) {
      observations.push({ ...base, relationship: { code: 'UNAVAILABLE', descriptiveCode: null, reason: 'CUTOFF_LINEAGE_UNUSABLE' } }); continue;
    }
    const points = s.series.filter(p => p.segment === point.segment && p.ledgerOrdinal <= point.ledgerOrdinal);
    // Segment ordinal fence also prevents A -> B -> A pooling within an unchanged canonical epoch.
    let lowerOrdinal = s.segments[point.segment - 1]?.lastOrdinal ?? 0;
    for (const e of canonicalEvents) if (e.ledgerOrdinal < segment.startOrdinal && e.ledgerOrdinal > lowerOrdinal && !equal(identity(e), segment.identity)) lowerOrdinal = e.ledgerOrdinal;
    const events = canonicalEvents.filter(e => e.ledgerOrdinal > lowerOrdinal && e.ledgerOrdinal <= cutoff.ledgerOrdinal
      && e.availableMs <= cutoff.availableMs && equal(identity(e), segment.identity));
    const current = windowEvidence(events, points, cutoff, segment, windowMs), previous = windowEvidence(events, points, cutoff, segment, windowMs, true);
    const priorComparable = current.complete && previous.complete && current.status !== 'UNAVAILABLE' && previous.status !== 'UNAVAILABLE';
    const comparisons = priorComparable ? { volume: compareEqualWindow(current.observedVolume, previous.observedVolume), deltaCvd: compareEqualWindow(current.deltaCvd, previous.deltaCvd),
      response: compareEqualWindow(current.response.displacementPoints, previous.response.displacementPoints), path: compareEqualWindow(current.pathEfficiency.value, previous.pathEfficiency.value) } : base.comparisons;
    observations.push({ ...base, current, previous, comparisons, relationship: classifyRelationship(current, previous) });
  }
  const timeline = collapseRelationshipTimeline(observations), last = observations.at(-1);
  const currentValid = last && (s.value != null || s.currentReason === 'NO_CLASSIFIED_VOLUME') && equal(last.identity, s.activeIdentity) && !chart.display.boundaryAtCutoff;
  const current = currentValid ? last : { ...last, relationship: { code: 'UNAVAILABLE', descriptiveCode: null, reason: s.currentReason || 'NO_LAWFUL_CUTOFF' }, current: null, previous: null,
    cumulativeCvd: null, comparisons: { volume: '前窗不可比較', deltaCvd: '前窗不可比較', response: '前窗不可比較', path: '前窗不可比較' } };
  const result = { schemaVersion: 'cru54-relationship-v1', ...SAFETY, timeframe, windowMs, generationHash: generation.generationHash,
    evidenceKind: generation.sourceBinding?.path?.replaceAll('\\','/').includes('/data/cru54-private/fixtures/') ? 'SYNTHETIC_FIXTURE' : 'GOVERNED_FRAGMENT',
    semanticHash: generation.result.semanticHash, sourceMode: 'PINNED_HISTORICAL_GENERATION', sourceCutoff: chart.cutoff,
    current, observations: observations.map(o => ({ segment: o.segment, identity: o.identity, lineage: o.lineage,
      anchorEventTime: o.anchorEventTime, cumulativeCvd: o.cumulativeCvd, relationship: o.relationship,
      deltaCvd: o.current?.deltaCvd ?? null, complete: o.current?.complete ?? false,
      observedSpanMs: o.current?.observedSpanMs ?? null, requiredSpanMs: windowMs })),
    timeline, markers: mapRelationshipMarkers(timeline, chart.bars, s.segments, windowMs, s.activeIdentity),
    history: { scope: 'OBSERVED_FRAGMENT', snapshotCount: observations.length, maxSnapshots: RELATIONSHIP_LIMITS.snapshots, initialStateIsTransition: false },
    method: { decisionClock: 'CUTOFF_AVAILABLE_AT', windowClock: 'CUTOFF_EVENT_TIME', cvd: 'ACCEPTED_PER_PHYSICAL_CUMULATIVE_DIFFERENCES', pressureIndependentVote: false,
      captureCompleteness: 'UNPROVEN', formalDirectionPromoted: false },
  };
  if (Buffer.byteLength(JSON.stringify(result)) > RELATIONSHIP_LIMITS.frameBytes) fail('RELATIONSHIP_RESPONSE_BUDGET');
  return result;
}

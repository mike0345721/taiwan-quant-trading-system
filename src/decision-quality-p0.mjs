// CRU-21 Decision Quality P0. Observation gates; never creates a trading signal.
import { isStructureEligible } from './structural-eligibility.mjs';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const span = (row, current) => Math.abs(row.price - current);
const states = Object.freeze({ TESTING: 4, BREAKING: 3, APPROACHING: 2, ACCEPTED: 1,
  REJECTED: 1, RECLAIMED: 1, LOST: 1, MONITORING: 0 });
const band = value => value === 'PRIMARY' ? 2 : value === 'SECONDARY' ? 1 : 0;
const compactBackground = (row, price) => row ? Object.freeze({
  id: row.id, family: row.family, label: row.label, price: row.price,
  distancePoints: span(row, price), qualityStatus: row.qualityStatus,
  role: 'BACKGROUND_NOT_CURRENT_TEST',
}) : null;

/** Current relevance is not historic importance. Never promote a blocked or distant level. */
export function evaluateLiveFocus(levels, { currentPrice, zonePoints } = {}) {
  const radius = finite(zonePoints) && zonePoints > 0 ? 2 * zonePoints : null;
  const rows = Array.isArray(levels) ? levels : [];
  if (!finite(currentPrice) || currentPrice <= 0 || !radius) return Object.freeze({
    schemaVersion: 'decision-focus-p0-v1', state: 'UNAVAILABLE', reasonCode: 'FOCUS_INPUT_INVALID',
    currentPrice: finite(currentPrice) ? currentPrice : null, zonePoints: radius == null ? null : zonePoints,
    activityRadiusPoints: radius, activeNodeId: null, nearestBackground: null,
    nearbyEligibleCount: 0, nearbyBlockedCount: 0, observationOnly: true,
  });
  const lawful = rows.filter(row => finite(row?.price) && row.price > 0 && isStructureEligible(row));
  const nearby = lawful.filter(row => span(row, currentPrice) <= radius && row.importanceBand !== 'CONTEXT');
  const nearbyBlocked = rows.filter(row => finite(row?.price) && span(row, currentPrice) <= radius
    && !isStructureEligible(row));
  // A close but quality-restricted VWAP must not displace a lawful reference.
  const selected = [...nearby].sort((a, b) => (states[b.state] ?? 0) - (states[a.state] ?? 0)
    || band(b.importanceBand) - band(a.importanceBand)
    || (b.basis?.confluence?.count || 0) - (a.basis?.confluence?.count || 0)
    || (b.basis?.reaction?.meaningfulReactionCount || 0) - (a.basis?.reaction?.meaningfulReactionCount || 0)
    || span(a, currentPrice) - span(b, currentPrice))[0] || null;
  const background = [...lawful].filter(row => row.id !== selected?.id)
    .sort((a, b) => span(a, currentPrice) - span(b, currentPrice))[0] || null;
  return Object.freeze({
    schemaVersion: 'decision-focus-p0-v1',
    state: selected ? 'ACTIVE_REFERENCE' : 'NO_ACTIVE_REFERENCE',
    reasonCode: selected ? null : nearbyBlocked.length ? 'NEAR_REFERENCE_QUALITY_BLOCKED' : 'NO_NEAR_ELIGIBLE_LEVEL',
    currentPrice, zonePoints, activityRadiusPoints: radius,
    activeNodeId: selected?.id || null, activeNodeState: selected?.state || null,
    nearestBackground: compactBackground(background, currentPrice),
    nearbyEligibleCount: nearby.length, nearbyBlockedCount: nearbyBlocked.length,
    proximityDoesNotProveTest: true, observationOnly: true,
  });
}

/** Keep original arithmetic; explicitly disallow reinterpreting it as an entry at current price. */
export function evaluateConditionalRrApplicability(rr, {
  currentPrice, confirmationThreshold, invalidationThreshold, targetPrice, direction, zonePoints,
} = {}) {
  const ok = rr?.state === 'AVAILABLE' && finite(rr.ratio) && rr.ratio > 0
    && finite(currentPrice) && finite(confirmationThreshold) && finite(invalidationThreshold)
    && finite(targetPrice) && finite(zonePoints) && zonePoints > 0
    && ['LONG', 'SHORT'].includes(direction);
  if (!ok) return Object.freeze({
    schemaVersion: 'rr-current-applicability-p0-v1', state: 'UNAVAILABLE',
    reasonCode: 'CONDITIONAL_RR_OR_PRICE_UNAVAILABLE', confirmationReferencePrice: null,
    currentPrice: finite(currentPrice) ? currentPrice : null, gapFromConfirmationPoints: null,
    observationZonePoints: finite(zonePoints) ? zonePoints : null,
    currentEntryRr: null, entryAuthorized: false, recommendation: false,
  });
  const gap = currentPrice - confirmationThreshold;
  const targetReached = direction === 'LONG' ? currentPrice >= targetPrice : currentPrice <= targetPrice;
  const detached = Math.abs(gap) > zonePoints;
  const state = targetReached ? 'TARGET_REACHED_OR_PASSED'
    : detached ? 'REFERENCE_PRICE_DISLOCATED' : 'NEAR_REFERENCE_UNCONFIRMED';
  return Object.freeze({
    schemaVersion: 'rr-current-applicability-p0-v1', state,
    reasonCode: targetReached ? 'TARGET_NO_LONGER_AHEAD' : detached ? 'CURRENT_PRICE_NOT_CONFIRMATION_PRICE'
      : 'PRICE_AND_FLOW_CONTINUITY_NOT_CONFIRMED',
    confirmationReferencePrice: confirmationThreshold, currentPrice,
    gapFromConfirmationPoints: gap, observationZonePoints: zonePoints,
    currentEntryRr: null, entryAuthorized: false, recommendation: false,
  });
}

/** Report evidence capabilities, not a direction or a price/flow confirmation. */
export function evaluateDecisionEvidenceGate({ chartQuality, sourceGeometry, flow, focus, snapshotTime } = {}) {
  const priceRelationAllowed = chartQuality === 'PASS' || sourceGeometry === true;
  const currentMs = Date.parse(snapshotTime), flowMs = Date.parse(flow?.availableAt);
  const flowFresh = Number.isFinite(currentMs) && Number.isFinite(flowMs)
    && flowMs <= currentMs && currentMs - flowMs <= 120000;
  const flowQualified = flowFresh && flow?.sourceState === 'LIVE' && ['PASS', 'READY'].includes(flow?.quality)
    && finite(flow?.pressure60) && finite(flow?.response60);
  const reasons = [];
  if (!priceRelationAllowed) reasons.push('PRICE_SOURCE_QUALITY_NOT_VERIFIED');
  if (!flowQualified) reasons.push('FLOW_QUALITY_OR_COVERAGE_INSUFFICIENT');
  if (focus?.state !== 'ACTIVE_REFERENCE') reasons.push('NO_ACTIVE_PRICE_REFERENCE');
  return Object.freeze({
    schemaVersion: 'decision-evidence-gate-p0-v1',
    priceRelationAllowed, pressureResponseDescriptionAllowed: flowQualified,
    priceAcceptanceConfirmed: false, directionConfirmed: false,
    actionableRrAllowed: false, executionAuthorized: false, orderRoutesEnabled: false,
    reasonCodes: Object.freeze(reasons), observationOnly: true,
  });
}

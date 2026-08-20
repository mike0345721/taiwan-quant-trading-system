import {
  createDw4EvidenceObservation,
  summarizeDw4Evidence,
} from './dw4-evidence-conflict-monitor.mjs';

export const DW4_DASHBOARD_FAMILIES = Object.freeze([
  'PRICE_STRUCTURE',
  'PARTICIPATION_BREADTH',
  'FUTURES_INSTITUTIONAL',
  'OPTIONS_CONTEXT',
  'GLOBAL_FX',
]);

const FAMILY_SOURCES = Object.freeze({
  PRICE_STRUCTURE: Object.freeze(['chartBar']),
  PARTICIPATION_BREADTH: Object.freeze(['breadth']),
  FUTURES_INSTITUTIONAL: Object.freeze(['futuresPositioning', 'cashInstitutional', 'futuresMarket']),
  OPTIONS_CONTEXT: Object.freeze(['txoLiveChainRaw', 'optionsEod']),
  GLOBAL_FX: Object.freeze(['marketOverview', 'taiwanVix']),
});

function itemById(dataHealth, sourceId) {
  return (dataHealth?.items || []).find((item) => item.sourceId === sourceId) || null;
}

function selectFamilyItem(dataHealth, family) {
  const candidates = FAMILY_SOURCES[family].map((sourceId) => itemById(dataHealth, sourceId)).filter(Boolean);
  return candidates.find((item) => item.freshnessState !== 'UNAVAILABLE') || candidates[0] || null;
}

function availabilityState(item) {
  if (!item || item.sourceAvailability === 'SOURCE_MISSING' || item.freshnessState === 'UNAVAILABLE') return 'UNAVAILABLE';
  if (item.freshnessState === 'STALE') return 'STALE';
  return item.availableAt ? 'AVAILABLE' : 'UNAVAILABLE';
}

function qualityState(item) {
  if (!item) return 'UNKNOWN';
  if (item.quality === 'PASS' && item.readinessState === 'READY') return 'PASS';
  if (item.quality === 'UNAVAILABLE' && item.sourceAvailability === 'SOURCE_MISSING') return 'UNKNOWN';
  return 'QUALITY_INSUFFICIENT';
}

function promotionState(family, item) {
  if (family === 'PARTICIPATION_BREADTH' && item?.readinessState === 'RAW_VALIDATED_CANDIDATE') return 'RAW_ONLY';
  if (family === 'OPTIONS_CONTEXT' && item?.sourceId === 'txoLiveChainRaw') return 'RAW_ONLY';
  return 'NOT_PROMOTED';
}

function reasonsFor(item, availability, quality, promotion) {
  const reasons = [];
  if (!item) reasons.push('SOURCE_GAP');
  if (item?.reason) reasons.push(item.reason);
  if (availability === 'UNAVAILABLE' && item && !item.availableAt) reasons.push('AVAILABLE_AT_UNAVAILABLE');
  if (quality === 'QUALITY_INSUFFICIENT' && !item?.reason) reasons.push('QUALITY_CONTRACT_NOT_SATISFIED');
  if (quality === 'UNKNOWN') reasons.push('QUALITY_UNKNOWN');
  if (promotion !== 'ELIGIBLE') reasons.push(promotion === 'RAW_ONLY' ? 'RAW_ONLY_NOT_PROMOTED' : 'DW4_EVIDENCE_NOT_PROMOTED');
  return [...new Set(reasons)];
}

function observationForFamily(dataHealth, family) {
  const item = selectFamilyItem(dataHealth, family);
  const availability = availabilityState(item);
  const quality = qualityState(item);
  const promotion = promotionState(family, item);
  const eventTime = availability === 'AVAILABLE' ? (item.exchangeTimestamp || item.availableAt) : null;
  const availableAt = availability === 'AVAILABLE' ? item.availableAt : null;
  return createDw4EvidenceObservation({
    evidenceId: `dashboard:${family}`,
    family,
    directionState: 'NOT_ELIGIBLE',
    availabilityState: availability,
    qualityState: quality,
    promotionState: promotion,
    eventTime,
    availableAt,
    sourceId: item?.sourceId || FAMILY_SOURCES[family][0],
    qualityReasons: reasonsFor(item, availability, quality, promotion),
    detail: Object.freeze({
      freshnessState: item?.freshnessState || 'UNAVAILABLE',
      sourceAvailability: item?.sourceAvailability || 'SOURCE_MISSING',
      readinessState: item?.readinessState || 'QUALITY_INSUFFICIENT',
      sourceType: item?.sourceType || null,
      actualContract: item?.actualContract || null,
      session: item?.session || null,
    }),
  });
}

export function buildDashboardDw4Evidence(dataHealth, { observations = null, snapshotBlocked = false } = {}) {
  const evidence = observations || DW4_DASHBOARD_FAMILIES.map((family) => observationForFamily(dataHealth, family));
  return summarizeDw4Evidence(evidence, {
    expectedEvidenceFamilies: DW4_DASHBOARD_FAMILIES,
    snapshotBlocked,
  });
}

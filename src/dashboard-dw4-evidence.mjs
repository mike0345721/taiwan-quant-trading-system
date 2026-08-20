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

function finite(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function descriptiveValue(label, rawValue, { unit = null, sourceMode = null } = {}) {
  if (rawValue == null || rawValue === '') return null;
  const normalized = typeof rawValue === 'number' ? finite(rawValue) : rawValue;
  if (normalized == null) return null;
  return Object.freeze({ label, value: normalized, unit, sourceMode });
}

function wallStrike(wall) {
  if (wall == null) return null;
  return finite(typeof wall === 'object' ? wall.strike : wall);
}

function directBreadthValues(data = {}) {
  const listed = data.listed || {};
  const otc = data.otc || {};
  const direct = [
    descriptiveValue('上漲家數', data.raise_count ?? data.raiseCount),
    descriptiveValue('下跌家數', data.fall_count ?? data.fallCount),
    descriptiveValue('平盤家數', data.flat_count ?? data.flatCount),
    descriptiveValue('漲停家數', data.limit_up_count ?? data.limitUpCount),
    descriptiveValue('跌停家數', data.limit_down_count ?? data.limitDownCount),
  ].filter(Boolean);
  if (direct.length) return direct;
  return [
    descriptiveValue('上市上漲／下跌／平盤', [listed.advance, listed.decline, listed.unchanged].every((item) => finite(item) != null)
      ? `${listed.advance} / ${listed.decline} / ${listed.unchanged}` : null, { sourceMode: 'BATCH' }),
    descriptiveValue('上櫃上漲／下跌／平盤', [otc.advance, otc.decline, otc.unchanged].every((item) => finite(item) != null)
      ? `${otc.advance} / ${otc.decline} / ${otc.unchanged}` : null, { sourceMode: 'BATCH' }),
    descriptiveValue('上市漲停／跌停', [listed.limitUp, listed.limitDown].every((item) => finite(item) != null)
      ? `${listed.limitUp} / ${listed.limitDown}` : null, { sourceMode: 'BATCH' }),
    descriptiveValue('上櫃漲停／跌停', [otc.limitUp, otc.limitDown].every((item) => finite(item) != null)
      ? `${otc.limitUp} / ${otc.limitDown}` : null, { sourceMode: 'BATCH' }),
  ].filter(Boolean);
}

function descriptiveValues(family, snapshot = {}, chart = null, dataHealth = null) {
  const values = [];
  if (family === 'PRICE_STRUCTURE') {
    values.push(
      descriptiveValue('TX 最新成交', finite(chart?.lastPrice), { sourceMode: 'LIVE_OR_REPLAY' }),
      descriptiveValue(`${chart?.levels?.vwap?.vwapSession || chart?.session || 'Session'} VWAP`, chart?.levels?.vwap?.availability === 'AVAILABLE' ? finite(chart.levels.vwap.value) : null, { sourceMode: 'SESSION_ONLY' }),
      descriptiveValue('OR 高／低', chart?.openingRange?.status === 'READY' ? `${chart.openingRange.high} / ${chart.openingRange.low}` : null, { sourceMode: 'DAY_0845_0900' }),
      descriptiveValue('實際契約', chart?.actualContract || snapshot?.futuresMarket?.data?.txDay?.contract),
      descriptiveValue('交易時段', chart?.session || snapshot?.futuresMarket?.data?.txDay?.session),
    );
  } else if (family === 'PARTICIPATION_BREADTH') {
    values.push(...directBreadthValues(snapshot?.marketBreadth?.data));
  } else if (family === 'FUTURES_INSTITUTIONAL') {
    const futures = snapshot?.futuresInstitutional?.data || {};
    const cash = snapshot?.spotInstitutional?.data || {};
    values.push(
      descriptiveValue('外資期貨淨部位', finite(futures.foreignNet), { sourceMode: 'EOD' }),
      descriptiveValue('外資期貨單日變化', finite(futures.foreignNetDelta), { sourceMode: 'EOD' }),
      descriptiveValue('投信期貨淨部位', finite(futures.trustNet), { sourceMode: 'EOD' }),
      descriptiveValue('自營商期貨淨部位', finite(futures.dealerNet), { sourceMode: 'EOD' }),
      descriptiveValue('外資現貨淨額', finite(cash.foreignNetE), { unit: '億元', sourceMode: 'EOD' }),
    );
  } else if (family === 'OPTIONS_CONTEXT') {
    const options = snapshot?.options?.data || {};
    const live = itemById(dataHealth, 'txoLiveChainRaw');
    values.push(
      descriptiveValue('EOD OI P/C Ratio', finite(options.oiPcRatio), { sourceMode: 'EOD' }),
      descriptiveValue('Call Wall', wallStrike(options.callWall), { sourceMode: 'EOD' }),
      descriptiveValue('Put Wall', wallStrike(options.putWall), { sourceMode: 'EOD' }),
      descriptiveValue('Max Pain', finite(options.maxPain), { sourceMode: 'EOD' }),
      descriptiveValue('TXO 即時鏈', live ? `${live.freshnessState || 'UNAVAILABLE'} / RAW_ONLY` : null, { sourceMode: 'LIVE_RAW' }),
    );
  } else if (family === 'GLOBAL_FX') {
    const global = snapshot?.marketOverview?.data || {};
    const ndx = global.ndx?.changePct ?? global.ndxReturn ?? global.ndxProxy ?? null;
    values.push(
      descriptiveValue('VIX', finite(global.vix), { sourceMode: 'EOD_OR_DELAYED' }),
      descriptiveValue('USD/TWD', finite(global.usdtwd), { sourceMode: 'EOD_OR_DELAYED' }),
      descriptiveValue('NDX Proxy', finite(ndx), { sourceMode: 'PROXY_ONLY' }),
    );
  }
  return Object.freeze(values.filter(Boolean));
}

function observationForFamily(dataHealth, family, snapshot, chart) {
  const item = selectFamilyItem(dataHealth, family);
  const availability = availabilityState(item);
  const quality = qualityState(item);
  const promotion = promotionState(family, item);
  const eventTime = availability === 'AVAILABLE' ? (item.exchangeTimestamp || item.availableAt) : null;
  const availableAt = availability === 'AVAILABLE' ? item.availableAt : null;
  const descriptive = descriptiveValues(family, snapshot, chart, dataHealth);
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
      descriptiveStatus: descriptive.length ? 'AVAILABLE' : 'UNAVAILABLE',
      descriptiveValues: descriptive,
      descriptiveUse: 'DESCRIPTIVE_ONLY_NOT_DIRECTIONAL_EVIDENCE',
      identityWarning: family === 'GLOBAL_FX' ? 'NDX_PROXY != TRUE_NQ' : null,
    }),
  });
}

export function buildDashboardDw4Evidence(dataHealth, {
  observations = null, snapshotBlocked = false, snapshot = {}, chart = null,
} = {}) {
  const evidence = observations || DW4_DASHBOARD_FAMILIES.map((family) => observationForFamily(dataHealth, family, snapshot, chart));
  return summarizeDw4Evidence(evidence, {
    expectedEvidenceFamilies: DW4_DASHBOARD_FAMILIES,
    snapshotBlocked,
  });
}

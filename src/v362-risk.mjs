const SOURCE_LABELS = Object.freeze({
  calculated_option_volatility: '選擇權 ATM IV／Skew',
  twse_securities_lending: '借券資料',
  twse_market_breadth: '上市市場廣度',
  tpex_market_breadth: '上櫃市場廣度',
  taifex_futures_market_oi: '期貨市場 OI',
  taifex_option_institutional: '選擇權法人',
  taifex_option_large_trader: '選擇權大額交易人',
  twse_spot_institutional_final: '現貨法人終值',
  taifex_futures_institutional_dealer: '自營商期貨',
  taifex_futures_institutional_investment_trust: '投信期貨',
});

const TRACKED_SOURCES = Object.keys(SOURCE_LABELS);

function finite(value) {
  if (typeof value !== 'number' && typeof value !== 'string') return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function classifyV362Risk(input = {}) {
  const vix = finite(input.vix);
  const vix5dPct = finite(input.vix5dPct);
  const vixThreshold = finite(input.vixThreshold);
  const atmIv = finite(input.atmIv);
  const atmHigh = finite(input.atmHigh);
  const skew = finite(input.skew);
  const skewHigh = finite(input.skewHigh);
  const foreign5d = finite(input.foreign5d);
  const foreignThreshold = finite(input.foreignThreshold);
  const shortAdd1d = finite(input.shortAdd1d);
  const shortAddThreshold = finite(input.shortAddThreshold);

  const vixHigh = (vix5dPct != null && vix5dPct >= 10) || (vix != null && vixThreshold != null && vix >= vixThreshold);
  const vixMedium = !vixHigh && vix5dPct != null && vix5dPct > 0;
  const atmAlert = atmIv != null && atmHigh != null && atmIv >= atmHigh;
  const skewAlert = skew != null && skewHigh != null && skew >= skewHigh;
  const optionAlert = atmAlert || skewAlert;
  const vixEvaluable = vix5dPct != null || (vix != null && vixThreshold != null);
  const optionEvaluable = (atmIv != null && atmHigh != null) || (skew != null && skewHigh != null);
  const level = !vixEvaluable && !optionEvaluable ? 'unknown' : (vixHigh || optionAlert ? 'high' : (vixMedium ? 'medium' : 'low'));

  let foreignDirection = 'unknown';
  if (foreign5d != null && foreignThreshold != null) {
    foreignDirection = foreign5d <= -foreignThreshold ? 'bearish_watch'
      : foreign5d >= foreignThreshold ? 'bullish_watch' : 'neutral';
  }
  let shortAlert = 'unknown';
  if (shortAdd1d != null && shortAddThreshold != null) {
    shortAlert = shortAdd1d >= shortAddThreshold ? 'high_add'
      : shortAdd1d > 0 ? 'small_add' : shortAdd1d < 0 ? 'reduced' : 'flat';
  }

  return {
    level,
    vixLevel: vixHigh ? 'high' : vixMedium ? 'medium' : vixEvaluable ? 'low' : 'unknown',
    optionLevel: optionAlert ? 'high' : optionEvaluable ? 'normal' : 'unknown',
    atmAlert,
    skewAlert,
    foreignDirection,
    shortAlert,
  };
}

function studyThreshold(report, key) {
  return report?.studies?.find((item) => item.key === key)?.thresholdsFromDevelopmentOnly || null;
}

function sourceFreshness(db, marketDate) {
  const placeholders = TRACKED_SOURCES.map(() => '?').join(',');
  const rows = db.prepare(`
    SELECT dataset_key AS datasetKey,
      MAX(CASE WHEN collection_status='success' THEN trade_date END) AS latestDate
    FROM research_input_registry_daily
    WHERE dataset_key IN (${placeholders})
    GROUP BY dataset_key
  `).all(...TRACKED_SOURCES);
  const byKey = new Map(rows.map((row) => [row.datasetKey, row.latestDate]));
  const sources = TRACKED_SOURCES.map((key) => ({
    key,
    label: SOURCE_LABELS[key],
    latestDate: byKey.get(key) || null,
    pending: !byKey.get(key) || (marketDate && byKey.get(key) < marketDate),
  }));
  return { sources, pending: sources.filter((item) => item.pending) };
}

export function buildV362RiskSummary(db, { v3 = {}, extendedReport = null, finalReport = null, auditReport = null } = {}) {
  // Anchor freshness to the core market date, not to the slower IV table.
  // Otherwise a one-day IV delay incorrectly moves the whole dashboard back and
  // hides the fact that option volatility is still pending.
  const marketDate = db.prepare('SELECT MAX(trade_date) AS date FROM market_daily WHERE tx_close IS NOT NULL').get()?.date || null;
  const vixRows = db.prepare(`
    SELECT observation_date AS date, value
    FROM macro_observations WHERE series_key='VIXCLS'
    ORDER BY observation_date DESC LIMIT 6
  `).all();
  const vix = finite(vixRows[0]?.value);
  const vix5dBase = finite(vixRows[5]?.value);
  const vix5dPct = vix != null && vix5dBase ? ((vix / vix5dBase) - 1) * 100 : null;
  const option = db.prepare(`
    SELECT trade_date AS tradeDate, contract, expiry_date AS expiryDate,
      days_to_expiry AS daysToExpiry, atm_iv AS atmIv, skew_25d AS skew25d,
      iv_rv_spread AS ivRvSpread, quality_status AS qualityStatus
    FROM option_volatility_daily
    WHERE trade_date=(SELECT MAX(trade_date) FROM option_volatility_daily)
      AND contract_type='weekly' AND days_to_expiry>0
    ORDER BY days_to_expiry, contract LIMIT 1
  `).get() || null;
  const atmThreshold = studyThreshold(extendedReport, 'weeklyAtmIv');
  const skewThreshold = studyThreshold(extendedReport, 'weeklySkew25d');
  const foreignRows = marketDate ? db.prepare(`
    SELECT m.trade_date AS tradeDate, f.foreign_net AS foreignNet, f.foreign_short AS foreignShort
    FROM (
      SELECT trade_date FROM market_daily WHERE trade_date<=? AND tx_close IS NOT NULL
      ORDER BY trade_date DESC LIMIT 6
    ) AS m LEFT JOIN futures_positions_daily AS f ON f.trade_date=m.trade_date
    ORDER BY m.trade_date DESC
  `).all(marketDate) : [];
  const latestForeign = finite(foreignRows[0]?.foreignNet);
  const previousForeign = finite(foreignRows[5]?.foreignNet);
  const foreign5d = latestForeign != null && previousForeign != null ? latestForeign - previousForeign : null;
  const latestShort = finite(foreignRows[0]?.foreignShort);
  const previousShort = finite(foreignRows[1]?.foreignShort);
  const shortAdd1d = latestShort != null && previousShort != null ? latestShort - previousShort : null;
  const classification = classifyV362Risk({
    vix,
    vix5dPct,
    vixThreshold: v3?.thresholds?.vix70,
    atmIv: option?.atmIv,
    atmHigh: atmThreshold?.high,
    skew: option?.skew25d,
    skewHigh: skewThreshold?.high,
    foreign5d,
    foreignThreshold: v3?.thresholds?.foreignAbs70,
    shortAdd1d,
    shortAddThreshold: v3?.thresholds?.shortAdd70,
  });
  const freshness = sourceFreshness(db, marketDate);
  const recommendation = classification.level === 'high'
    ? '縮小部位、禁止追價'
    : classification.level === 'medium'
      ? '等待價格確認、降低槓桿'
      : classification.level === 'low'
        ? '風險未升高，仍須價格確認'
        : '資料不足，暫停採取方向部位';

  return {
    available: Boolean(marketDate),
    generatedAt: new Date().toISOString(),
    dataDate: marketDate,
    direction: '中性',
    riskDirection: v3?.direction?.votes?.length ? v3.direction.bias : '無明顯方向風險',
    directionStatus: v3?.direction?.status || 'candidate_only',
    volatilityRisk: classification.level,
    recommendation,
    vix: { value: vix, dataDate: vixRows[0]?.date || null, change5dPct: vix5dPct, level: classification.vixLevel },
    options: {
      tradeDate: option?.tradeDate || null,
      contract: option?.contract || null,
      expiryDate: option?.expiryDate || null,
      atmIv: finite(option?.atmIv),
      skew25d: finite(option?.skew25d),
      ivRvSpread: finite(option?.ivRvSpread),
      atmHigh: finite(atmThreshold?.high),
      skewHigh: finite(skewThreshold?.high),
      atmAlert: classification.atmAlert,
      skewAlert: classification.skewAlert,
      level: classification.optionLevel,
      calculated: true,
    },
    foreignFutures: {
      delta5d: foreign5d,
      absoluteThreshold: finite(v3?.thresholds?.foreignAbs70),
      direction: classification.foreignDirection,
      shortAdd1d,
      shortAddThreshold: finite(v3?.thresholds?.shortAdd70),
      shortAlert: classification.shortAlert,
    },
    priceConfirmation: { required: true, status: 'pending' },
    evidence: {
      level: finite(finalReport?.decision?.highestEvidence) || 0,
      label: finalReport?.decision?.highestEvidenceLabel || 'not_available',
      liveEligible: Boolean(finalReport?.decision?.liveOrSimulationEligible),
      interpretation: '風險候選，非下單訊號',
    },
    dataQuality: {
      researchReady: Boolean(auditReport?.gates?.researchReady),
      timingAuditPassed: Boolean(auditReport?.gates?.timingAuditPassed),
      latestBySource: freshness.sources,
      pending: freshness.pending,
    },
  };
}

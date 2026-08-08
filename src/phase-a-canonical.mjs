import crypto from 'node:crypto';

const LOCAL_DAY_END = '23:59:59+08:00';
const DECISION_TIME = '08:30:00+08:00';
const US_CLOSE_TIME = '06:00:00+08:00';

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function numberOrNull(value) {
  return finite(value) ? Number(value) : null;
}

function isoTaipei(date, time) {
  return `${date}T${time}`;
}

function nextCalendarDate(date) {
  const cursor = new Date(`${date}T00:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() + 1);
  return cursor.toISOString().slice(0, 10);
}

function sign(value) {
  if (!finite(value) || Number(value) === 0) return 0;
  return Number(value) > 0 ? 1 : -1;
}

function normalizedBalance(positive, negative) {
  if (!finite(positive) || !finite(negative)) return null;
  const denominator = Number(positive) + Number(negative);
  return denominator > 0 ? (Number(positive) - Number(negative)) / denominator : null;
}

function indexBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) result.set(keyFn(row), row);
  return result;
}

function groupBy(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function latestBefore(rows, decisionTradeDate, key = 'trade_date') {
  let selected = null;
  for (const row of rows) {
    if (row[key] >= decisionTradeDate) continue;
    if (!selected || row[key] > selected[key]) selected = row;
  }
  return selected;
}

function selectOptionContract(rows, sourceTradeDate, decisionTradeDate) {
  return rows
    .filter((row) => row.trade_date === sourceTradeDate
      && row.expiry_date >= decisionTradeDate)
    .sort((left, right) => left.expiry_date.localeCompare(right.expiry_date)
      || Number(right.call_volume || 0) + Number(right.put_volume || 0)
        - Number(left.call_volume || 0) - Number(left.put_volume || 0)
      || left.contract.localeCompare(right.contract))[0] || null;
}

function selectOptionVolatility(rows, sourceTradeDate, decisionTradeDate) {
  return rows
    .filter((row) => row.trade_date === sourceTradeDate
      && row.expiry_date >= decisionTradeDate
      && finite(row.atm_iv))
    .sort((left, right) => left.expiry_date.localeCompare(right.expiry_date)
      || Number(right.observations || 0) - Number(left.observations || 0)
      || left.contract.localeCompare(right.contract))[0] || null;
}

function sourceResult({
  value,
  sourceTradeDate,
  availableAt,
  sourceTable,
  sourceContract = null,
  qualityState = null,
  qualityReason = null,
  formula,
}) {
  const numeric = numberOrNull(value);
  return {
    value: numeric,
    sourceTradeDate,
    availableAt,
    sourceTable,
    sourceContract,
    qualityState: qualityState || (numeric === null ? 'MISSING_VALUE' : 'PASS'),
    qualityReason: qualityReason || (numeric === null ? 'source_value_missing' : null),
    formula,
  };
}

function localDailyResult(value, sourceTradeDate, sourceTable, formula, sourceContract = null) {
  return sourceResult({
    value,
    sourceTradeDate,
    availableAt: isoTaipei(sourceTradeDate, LOCAL_DAY_END),
    sourceTable,
    sourceContract,
    formula,
  });
}

function deriveBaseValue({
  factorId,
  decisionTradeDate,
  priorTradeDate,
  data,
}) {
  const market = data.marketByDate.get(priorTradeDate) || null;
  const spot = data.spotByDate.get(priorTradeDate) || null;
  const futures = data.futuresByDate.get(priorTradeDate) || null;
  const futuresOi = data.futuresOiByDate.get(priorTradeDate) || null;
  const large = data.largeAllByDate.get(priorTradeDate) || null;
  const basis = data.basisByDate.get(priorTradeDate) || null;
  const optionTerm = data.optionTermByDate.get(priorTradeDate) || null;

  const simple = {
    cash_foreign_net: [spot?.foreign_net_e, 'spot_institutional_daily', 'foreign_net_e'],
    cash_trust_net: [spot?.trust_net_e, 'spot_institutional_daily', 'trust_net_e'],
    cash_dealer_proprietary_net: [spot?.dealer_proprietary_net_e, 'spot_institutional_daily', 'dealer_proprietary_net_e'],
    cash_dealer_hedge_net: [spot?.dealer_hedge_net_e, 'spot_institutional_daily', 'dealer_hedge_net_e'],
    cash_dealer_total_net: [spot?.dealer_total_net_e, 'spot_institutional_daily', 'dealer_total_net_e'],
    cash_institutional_total: [spot?.institutional_total_e, 'spot_institutional_daily', 'institutional_total_e'],
    futures_foreign_long: [futures?.foreign_long, 'futures_positions_daily', 'foreign_long'],
    futures_foreign_short: [futures?.foreign_short, 'futures_positions_daily', 'foreign_short'],
    futures_foreign_net: [futures?.foreign_net, 'futures_positions_daily', 'foreign_net'],
    futures_dealer_net: [futures?.dealer_net, 'futures_positions_daily', 'dealer_net'],
    futures_trust_net: [futures?.trust_net, 'futures_positions_daily', 'trust_net'],
    near_contract_oi: [futuresOi?.near_contract_oi, 'futures_oi_daily', 'near_contract_oi'],
    near_scope_market_oi: [futuresOi?.near_scope_market_oi, 'futures_oi_daily', 'near_scope_market_oi'],
    all_contracts_market_oi: [futuresOi?.all_contracts_market_oi, 'futures_oi_daily', 'all_contracts_market_oi'],
    days_to_near_expiry: [futuresOi?.days_to_near_expiry, 'futures_oi_daily', 'days_to_near_expiry'],
    rollover_risk: [futuresOi?.rollover_risk, 'futures_oi_daily', 'rollover_risk'],
    contract_changed: [futuresOi?.contract_changed, 'futures_oi_daily', 'contract_changed'],
    top5_long: [large?.top5_long, 'large_trader_futures_daily', 'top5_long(all_contracts)'],
    top10_long: [large?.top10_long, 'large_trader_futures_daily', 'top10_long(all_contracts)'],
    top5_short: [large?.top5_short, 'large_trader_futures_daily', 'top5_short(all_contracts)'],
    top10_short: [large?.top10_short, 'large_trader_futures_daily', 'top10_short(all_contracts)'],
    market_open_interest: [large?.market_open_interest, 'large_trader_futures_daily', 'market_open_interest(all_contracts)'],
    term_spread_bps: [basis?.term_spread_bps, 'basis_term_structure_daily', 'term_spread_bps'],
    term_change_1d_bps: [basis?.term_change_1d_bps, 'basis_term_structure_daily', 'term_change_1d_bps'],
    term_change_5d_bps: [basis?.term_change_5d_bps, 'basis_term_structure_daily', 'term_change_5d_bps'],
    term_change_z60: [basis?.term_change_z60, 'basis_term_structure_daily', 'term_change_z60'],
    close_basis_bps: [basis?.close_basis_bps, 'basis_term_structure_daily', 'close_basis_bps'],
    basis_change_1d_bps: [basis?.basis_change_1d_bps, 'basis_term_structure_daily', 'basis_change_1d_bps'],
    basis_change_5d_bps: [basis?.basis_change_5d_bps, 'basis_term_structure_daily', 'basis_change_5d_bps'],
    basis_level_z60: [basis?.basis_level_z60, 'basis_term_structure_daily', 'basis_level_z60'],
    weekly_atm_iv: [optionTerm?.weekly_atm_iv, 'option_volatility_term_daily', 'weekly_atm_iv'],
    monthly_atm_iv: [optionTerm?.monthly_atm_iv, 'option_volatility_term_daily', 'monthly_atm_iv'],
    monthly_minus_weekly_iv: [optionTerm?.monthly_minus_weekly_iv, 'option_volatility_term_daily', 'monthly_minus_weekly_iv'],
    price_twii_return: [market?.twii_change_pct, 'market_daily', 'twii_change_pct'],
    price_tx_return: [market?.tx_change_pct, 'market_daily', 'tx_change_pct'],
    price_tx_volume: [market?.tx_volume, 'market_daily', 'tx_volume'],
    price_tx_open_interest: [market?.tx_open_interest, 'market_daily', 'tx_open_interest'],
  };
  if (simple[factorId]) {
    const [value, table, formula] = simple[factorId];
    const contract = table === 'futures_oi_daily'
      ? futuresOi?.near_contract || null
      : table === 'basis_term_structure_daily'
        ? basis?.near_contract || null
        : table === 'market_daily'
          ? market?.tx_contract || null
          : null;
    return localDailyResult(value, priorTradeDate, table, formula, contract);
  }

  if (factorId === 'cash_participant_alignment') {
    const values = [spot?.foreign_net_e, spot?.trust_net_e, spot?.dealer_total_net_e];
    const value = values.every(finite)
      ? values.map(sign).reduce((sum, item) => sum + item, 0) / values.length
      : null;
    return localDailyResult(
      value,
      priorTradeDate,
      'spot_institutional_daily',
      'mean(sign(foreign_net_e), sign(trust_net_e), sign(dealer_total_net_e))',
    );
  }

  const breadthFormulas = {
    breadth_listed_advance_decline: [market?.listed_advance, market?.listed_decline, 'listed_advance', 'listed_decline'],
    breadth_otc_advance_decline: [market?.otc_advance, market?.otc_decline, 'otc_advance', 'otc_decline'],
    breadth_listed_limit_balance: [market?.listed_limit_up, market?.listed_limit_down, 'listed_limit_up', 'listed_limit_down'],
    breadth_otc_limit_balance: [market?.otc_limit_up, market?.otc_limit_down, 'otc_limit_up', 'otc_limit_down'],
  };
  if (breadthFormulas[factorId]) {
    const [positive, negative, positiveName, negativeName] = breadthFormulas[factorId];
    return localDailyResult(
      normalizedBalance(positive, negative),
      priorTradeDate,
      'market_daily',
      `(${positiveName}-${negativeName})/(${positiveName}+${negativeName})`,
    );
  }

  const option = selectOptionContract(data.optionsRows, priorTradeDate, decisionTradeDate);
  const optionMap = {
    options_volume_pc_ratio: [option?.volume_pc_ratio, 'volume_pc_ratio'],
    options_oi_pc_ratio: [option?.oi_pc_ratio, 'oi_pc_ratio'],
    options_call_oi: [option?.call_oi, 'call_oi'],
    options_put_oi: [option?.put_oi, 'put_oi'],
    options_days_to_expiry: [option?.days_to_expiry, 'days_to_expiry'],
  };
  if (optionMap[factorId]) {
    const [value, formula] = optionMap[factorId];
    return localDailyResult(value, priorTradeDate, 'options_contract_daily', formula, option?.contract || null);
  }
  if (factorId === 'options_max_pain_distance') {
    const value = option && finite(option.max_pain) && finite(market?.tx_close)
      ? (Number(option.max_pain) - Number(market.tx_close)) / Number(market.tx_close)
      : null;
    return localDailyResult(
      value,
      priorTradeDate,
      'options_contract_daily+market_daily',
      '(max_pain-tx_close)/tx_close',
      option?.contract || null,
    );
  }
  if (factorId === 'options_wall_asymmetry') {
    const value = option && finite(option.call_wall_strike)
      && finite(option.put_wall_strike) && finite(market?.tx_close)
      ? (Number(option.call_wall_strike) + Number(option.put_wall_strike)
        - 2 * Number(market.tx_close)) / Number(market.tx_close)
      : null;
    return localDailyResult(
      value,
      priorTradeDate,
      'options_contract_daily+market_daily',
      '(call_wall+put_wall-2*tx_close)/tx_close',
      option?.contract || null,
    );
  }

  const volatility = selectOptionVolatility(data.optionVolRows, priorTradeDate, decisionTradeDate);
  const volatilityMap = {
    realized_vol_20d: [volatility?.realized_vol_20d, 'realized_vol_20d'],
    atm_iv: [volatility?.atm_iv, 'atm_iv'],
    put_25d_iv: [volatility?.put_25d_iv, 'put_25d_iv'],
    call_25d_iv: [volatility?.call_25d_iv, 'call_25d_iv'],
    skew_25d: [volatility?.skew_25d, 'skew_25d'],
    iv_rv_spread: [volatility?.iv_rv_spread, 'iv_rv_spread'],
  };
  if (volatilityMap[factorId]) {
    const [value, formula] = volatilityMap[factorId];
    return sourceResult({
      value,
      sourceTradeDate: priorTradeDate,
      availableAt: volatility?.available_at || isoTaipei(priorTradeDate, LOCAL_DAY_END),
      sourceTable: 'option_volatility_daily',
      sourceContract: volatility?.contract || null,
      qualityState: volatility?.quality_status === 'calculated_complete' ? null : 'SOURCE_QUALITY_WARNING',
      qualityReason: volatility?.quality_status === 'calculated_complete'
        ? null
        : `quality_status=${volatility?.quality_status || 'missing'}`,
      formula,
    });
  }

  const crossSymbols = {
    cross_ndx_return: 'NDX',
    cross_sox_return: 'SOX',
    cross_usdtwd_return: 'USDTWD',
    cross_gold_return: 'GOLD',
    cross_copper_return: 'COPPER',
  };
  if (crossSymbols[factorId]) {
    const symbol = crossSymbols[factorId];
    const row = latestBefore(data.globalBySymbol.get(symbol) || [], decisionTradeDate);
    const sourceTradeDate = row?.trade_date || priorTradeDate;
    return sourceResult({
      value: row?.return_pct,
      sourceTradeDate,
      availableAt: isoTaipei(nextCalendarDate(sourceTradeDate), US_CLOSE_TIME),
      sourceTable: 'global_market_daily',
      sourceContract: symbol,
      formula: `latest ${symbol}.return_pct with source trade_date < Taiwan decision trade date`,
    });
  }

  if (data.macroSeries.has(factorId)) {
    const row = latestBefore(data.macroSeries.get(factorId), decisionTradeDate, 'observation_date');
    return sourceResult({
      value: null,
      sourceTradeDate: row?.observation_date || null,
      availableAt: null,
      sourceTable: 'macro_observations',
      sourceContract: factorId,
      qualityState: 'BLOCKED_AVAILABLE_AT',
      qualityReason: 'source has observation_date but no release/retrieval timestamp',
      formula: `${factorId} blocked until vintage-aware publication timestamp exists`,
    });
  }

  return sourceResult({
    value: null,
    sourceTradeDate: priorTradeDate,
    availableAt: null,
    sourceTable: 'unknown',
    qualityState: 'UNMAPPED_FACTOR',
    qualityReason: `no canonical formula for ${factorId}`,
    formula: null,
  });
}

function transformMode(factorId) {
  if (factorId.startsWith('cash_')) return 'SUM';
  if (factorId.startsWith('cross_') && factorId.endsWith('_return')) return 'SUM';
  if (factorId === 'price_twii_return' || factorId === 'price_tx_return') return 'SUM';
  if (factorId.startsWith('breadth_')) return 'SUM';
  return 'CHANGE';
}

function distinctSourceHistory(rows, currentIndex) {
  const seen = new Set();
  const result = [];
  for (let index = currentIndex; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.value === null || !row.sourceTradeDate || seen.has(row.sourceTradeDate)) continue;
    seen.add(row.sourceTradeDate);
    result.push(row);
  }
  return result;
}

function deriveTransform(baseRows, currentIndex, transform, factorId) {
  const current = baseRows[currentIndex];
  if (transform === 'raw') return { ...current, transformFormula: 'raw' };
  if (current.value === null || current.qualityState !== 'PASS') {
    return {
      ...current,
      value: null,
      qualityState: current.qualityState === 'PASS' ? 'MISSING_TRANSFORM_INPUT' : current.qualityState,
      qualityReason: current.qualityReason || 'current value unavailable',
      transformFormula: transform,
    };
  }
  const history = distinctSourceHistory(baseRows, currentIndex);
  if (transform === 'delta_1d') {
    if (history.length < 2) {
      return { ...current, value: null, qualityState: 'WARMUP', qualityReason: 'requires 2 distinct source dates', transformFormula: 'current-previous' };
    }
    return { ...current, value: history[0].value - history[1].value, transformFormula: 'current-previous distinct source date' };
  }
  const match = /^sum_or_change_(3|5)d$/.exec(transform);
  if (match) {
    const window = Number(match[1]);
    if (history.length < window) {
      return { ...current, value: null, qualityState: 'WARMUP', qualityReason: `requires ${window} distinct source dates`, transformFormula: transform };
    }
    const values = history.slice(0, window).map((row) => row.value);
    const mode = transformMode(factorId);
    return {
      ...current,
      value: mode === 'SUM'
        ? values.reduce((sum, value) => sum + value, 0)
        : values[0] - values[values.length - 1],
      transformFormula: mode === 'SUM'
        ? `sum current ${window} distinct source observations`
        : `current minus ${window - 1}-observation lag`,
    };
  }
  if (transform === 'past_only_z60') {
    const past = history.slice(1, 61);
    if (past.length < 60) {
      return { ...current, value: null, qualityState: 'WARMUP', qualityReason: 'requires 60 prior distinct source dates', transformFormula: 'zscore against prior 60 only' };
    }
    const mean = past.reduce((sum, row) => sum + row.value, 0) / past.length;
    const variance = past.reduce((sum, row) => sum + (row.value - mean) ** 2, 0) / past.length;
    const standardDeviation = Math.sqrt(variance);
    return {
      ...current,
      value: standardDeviation > 0 ? (current.value - mean) / standardDeviation : null,
      qualityState: standardDeviation > 0 ? 'PASS' : 'ZERO_VARIANCE',
      qualityReason: standardDeviation > 0 ? null : 'prior 60 observations have zero variance',
      transformFormula: '(current-mean(prior 60))/sd(prior 60), current excluded',
    };
  }
  return {
    ...current,
    value: null,
    qualityState: 'UNKNOWN_TRANSFORM',
    qualityReason: transform,
    transformFormula: transform,
  };
}

export function prepareCanonicalData(raw) {
  return {
    marketRows: raw.marketRows,
    marketByDate: indexBy(raw.marketRows, (row) => row.trade_date),
    spotByDate: indexBy(raw.spotRows, (row) => row.trade_date),
    futuresByDate: indexBy(raw.futuresRows, (row) => row.trade_date),
    futuresOiByDate: indexBy(raw.futuresOiRows, (row) => row.trade_date),
    largeAllByDate: indexBy(
      raw.largeRows.filter((row) => row.expiry_scope === 'all_contracts'),
      (row) => row.trade_date,
    ),
    basisByDate: indexBy(raw.basisRows, (row) => row.trade_date),
    optionTermByDate: indexBy(raw.optionTermRows, (row) => row.trade_date),
    optionsRows: raw.optionsRows,
    optionVolRows: raw.optionVolRows,
    globalBySymbol: groupBy(raw.globalRows, (row) => row.symbol),
    macroSeries: groupBy(raw.macroRows, (row) => row.series_key),
  };
}

export function factorDefinitions(featureSpec) {
  const result = [];
  for (const group of featureSpec.groups) {
    for (const feature of group.baseFeatures || []) {
      for (const transform of feature.transforms || ['raw']) {
        result.push({
          factorId: transform === 'raw' ? feature.factorId : `${feature.factorId}__${transform}`,
          baseFactorId: feature.factorId,
          factorGroup: group.factorGroup,
          transform,
          sourceTable: group.sourceTable,
        });
      }
    }
    for (const source of group.additionalSources || []) {
      for (const factorId of source.factorIds || []) {
        result.push({
          factorId,
          baseFactorId: factorId,
          factorGroup: group.factorGroup,
          transform: 'raw',
          sourceTable: source.table,
        });
      }
    }
  }
  return result;
}

export function buildCanonicalFeatureRows(raw, featureSpec) {
  const data = prepareCanonicalData(raw);
  const definitions = factorDefinitions(featureSpec);
  const tradeDates = data.marketRows.map((row) => row.trade_date).sort();
  const decisions = tradeDates.slice(1).map((decisionTradeDate, index) => ({
    decisionTradeDate,
    priorTradeDate: tradeDates[index],
    decisionAt: isoTaipei(decisionTradeDate, DECISION_TIME),
  }));
  const rows = [];

  for (const definition of definitions) {
    const baseRows = decisions.map((decision) => ({
      factorId: definition.baseFactorId,
      baseFactorId: definition.baseFactorId,
      factorGroup: definition.factorGroup,
      transform: 'raw',
      decisionTradeDate: decision.decisionTradeDate,
      decisionAt: decision.decisionAt,
      ...deriveBaseValue({
        factorId: definition.baseFactorId,
        decisionTradeDate: decision.decisionTradeDate,
        priorTradeDate: decision.priorTradeDate,
        data,
      }),
    }));
    for (let index = 0; index < baseRows.length; index += 1) {
      const transformed = deriveTransform(baseRows, index, definition.transform, definition.baseFactorId);
      const timeViolation = transformed.availableAt
        && Date.parse(transformed.availableAt) >= Date.parse(transformed.decisionAt);
      rows.push({
        ...transformed,
        factorId: definition.factorId,
        transform: definition.transform,
        value: timeViolation ? null : transformed.value,
        qualityState: timeViolation ? 'AVAILABLE_AT_VIOLATION' : transformed.qualityState,
        qualityReason: timeViolation
          ? `${transformed.availableAt} is not before ${transformed.decisionAt}`
          : transformed.qualityReason,
      });
    }
  }
  return rows.sort((left, right) => left.decisionTradeDate.localeCompare(right.decisionTradeDate)
    || left.factorId.localeCompare(right.factorId));
}

export function stableDigest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function summarizeCanonicalQuality(rows, definitions) {
  const byFactor = groupBy(rows, (row) => row.factorId);
  const factors = definitions.map((definition) => {
    const factorRows = byFactor.get(definition.factorId) || [];
    const counts = {};
    for (const row of factorRows) counts[row.qualityState] = (counts[row.qualityState] || 0) + 1;
    const valid = factorRows.filter((row) => row.qualityState === 'PASS' && row.value !== null).length;
    const violations = counts.AVAILABLE_AT_VIOLATION || 0;
    const blocked = (counts.BLOCKED_AVAILABLE_AT || 0) + (counts.UNMAPPED_FACTOR || 0);
    const eligible = violations === 0 && blocked === 0 && valid > 0;
    return {
      ...definition,
      observations: factorRows.length,
      validObservations: valid,
      coveragePct: factorRows.length ? Number((valid / factorRows.length * 100).toFixed(4)) : 0,
      qualityCounts: counts,
      qualityState: eligible ? 'PASS' : blocked > 0 ? 'BLOCKED' : 'FAIL',
      qualityReason: violations > 0
        ? 'available_at_violation'
        : blocked > 0
          ? 'availability_or_mapping_untrusted'
          : valid === 0
            ? 'no_valid_observations'
            : null,
    };
  });
  return factors;
}

export function auditDuplicateKeys(raw) {
  const checks = [
    ['market_daily', raw.marketRows, (row) => row.trade_date],
    ['spot_institutional_daily', raw.spotRows, (row) => row.trade_date],
    ['futures_positions_daily', raw.futuresRows, (row) => row.trade_date],
    ['futures_oi_daily', raw.futuresOiRows, (row) => row.trade_date],
    ['large_trader_futures_daily', raw.largeRows, (row) => `${row.trade_date}:${row.expiry_scope}`],
    ['basis_term_structure_daily', raw.basisRows, (row) => row.trade_date],
    ['options_contract_daily', raw.optionsRows, (row) => `${row.trade_date}:${row.contract}`],
    ['option_volatility_daily', raw.optionVolRows, (row) => `${row.trade_date}:${row.contract}`],
    ['option_volatility_term_daily', raw.optionTermRows, (row) => row.trade_date],
    ['global_market_daily', raw.globalRows, (row) => `${row.symbol}:${row.trade_date}`],
    ['macro_observations', raw.macroRows, (row) => `${row.series_key}:${row.observation_date}`],
  ];
  return checks.map(([table, tableRows, keyFn]) => {
    const keys = new Set();
    let duplicates = 0;
    for (const row of tableRows) {
      const key = keyFn(row);
      if (keys.has(key)) duplicates += 1;
      keys.add(key);
    }
    return { table, rows: tableRows.length, uniqueKeys: keys.size, duplicateKeys: duplicates };
  });
}


import { classifyPastOnlyPercentile, evaluatePremarketMarketState } from './market-state-v1.mjs';

const PERCENTILE_LOOKBACK = 252;
const PERCENTILE_MIN_HISTORY = 60;

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function maxIso(...values) {
  const valid = values.filter((value) => typeof value === 'string' && Number.isFinite(Date.parse(value)));
  return valid.length ? valid.sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1) : null;
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

function rowMap(rows) {
  return new Map(rows.map((row) => [row.factorId, row]));
}

function isUsable(row) {
  return Boolean(row)
    && row.qualityState === 'PASS'
    && finite(row.value)
    && typeof row.availableAt === 'string'
    && Number.isFinite(Date.parse(row.availableAt));
}

function trace(row) {
  if (!row) return null;
  return {
    factorId: row.factorId,
    rawValue: finite(row.value) ? Number(row.value) : null,
    sourceTradeDate: row.sourceTradeDate ?? null,
    availableAt: row.availableAt ?? null,
    sourceTable: row.sourceTable ?? null,
    sourceContract: row.sourceContract ?? null,
    formula: row.formula ?? row.transformFormula ?? null,
    qualityState: row.qualityState ?? null,
    qualityReason: row.qualityReason ?? null,
  };
}

function unavailable(key, rows, fallbackReason = 'EVIDENCE_UNAVAILABLE') {
  const candidates = (Array.isArray(rows) ? rows : [rows]).filter(Boolean);
  const firstBad = candidates.find((row) => !isUsable(row));
  return {
    key,
    reason: firstBad?.qualityState || fallbackReason,
    qualityReason: firstBad?.qualityReason || null,
    factors: candidates.map(trace),
  };
}

function priorDistinctValues(history, currentRow) {
  if (!currentRow) return [];
  const rows = history.get(currentRow.factorId) || [];
  const seenSources = new Set();
  const values = [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.decisionTradeDate >= currentRow.decisionTradeDate) continue;
    if (!isUsable(row)) continue;
    const sourceKey = row.sourceTradeDate || row.decisionTradeDate;
    if (seenSources.has(sourceKey)) continue;
    seenSources.add(sourceKey);
    values.push(Number(row.value));
    if (values.length >= PERCENTILE_LOOKBACK) break;
  }
  return values;
}

function percentileContext(history, row) {
  if (!isUsable(row)) return { percentile: null, bucket: 'UNAVAILABLE', sampleSize: 0 };
  return classifyPastOnlyPercentile(Number(row.value), priorDistinctValues(history, row), {
    minimumHistory: PERCENTILE_MIN_HISTORY,
  });
}

function previousDistinctUsableRow(history, currentRow) {
  if (!currentRow) return null;
  const rows = history.get(currentRow.factorId) || [];
  const seenSources = new Set();
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const row = rows[index];
    if (row.decisionTradeDate >= currentRow.decisionTradeDate || !isUsable(row)) continue;
    const sourceKey = row.sourceTradeDate || row.decisionTradeDate;
    if (seenSources.has(sourceKey)) continue;
    seenSources.add(sourceKey);
    return row;
  }
  return null;
}

function sameContractOiDelta(history, currentRow) {
  if (!isUsable(currentRow)) return { state: 'CURRENT_UNAVAILABLE', previous: null, delta: null };
  if (!currentRow.sourceContract) return { state: 'CURRENT_CONTRACT_UNAVAILABLE', previous: null, delta: null };
  const previous = previousDistinctUsableRow(history, currentRow);
  if (!previous) return { state: 'NO_VALID_PREVIOUS', previous: null, delta: null };
  if (!previous.sourceContract) return { state: 'PREVIOUS_CONTRACT_UNAVAILABLE', previous, delta: null };
  if (previous.sourceContract !== currentRow.sourceContract) {
    return { state: 'CONTRACT_MISMATCH', previous, delta: null };
  }
  return { state: 'PASS', previous, delta: Number(currentRow.value) - Number(previous.value) };
}

function directionFromPercentile(context) {
  if (['EXTREME_POSITIVE', 'POSITIVE'].includes(context.bucket)) return 'BULLISH';
  if (['EXTREME_NEGATIVE', 'NEGATIVE'].includes(context.bucket)) return 'BEARISH';
  if (context.bucket === 'NEUTRAL') return 'NEUTRAL';
  return undefined;
}

function contextLabel(context) {
  return {
    percentile: context.percentile,
    percentileBucket: context.bucket,
    percentileSampleSize: context.sampleSize,
  };
}

function buildLocalPrice(map, evidence, unavailableRows) {
  const twii5 = map.get('price_twii_return__sum_or_change_5d');
  const tx5 = map.get('price_tx_return__sum_or_change_5d');
  if (!isUsable(twii5) || !isUsable(tx5)) {
    unavailableRows.push(unavailable('localPricePersistence', [twii5, tx5]));
    return;
  }
  const twii = Number(twii5.value);
  const tx = Number(tx5.value);
  let direction = 'NEUTRAL';
  let trend = 'UNCLEAR';
  if (twii > 0 && tx > 0) {
    direction = 'BULLISH';
    trend = 'TREND_UP';
  } else if (twii < 0 && tx < 0) {
    direction = 'BEARISH';
    trend = 'TREND_DOWN';
  }
  evidence.push({
    key: 'localPricePersistence',
    block: 'localPrice',
    direction,
    trend,
    qualityStatus: 'VALID',
    availableAt: maxIso(twii5.availableAt, tx5.availableAt),
    source: 'phase-a-canonical:market_daily',
    interpretation: 'TAIEX and TX five-observation return context; same-block evidence is not double-counted',
    inputs: [trace(twii5), trace(tx5)],
  });
}

function buildBreadth(map, evidence, unavailableRows) {
  const breadth = map.get('breadth_listed_advance_decline');
  if (!isUsable(breadth)) {
    unavailableRows.push(unavailable('twseBreadth', breadth));
    return;
  }
  const balance = Number(breadth.value);
  const direction = balance >= 0.2 ? 'BULLISH' : balance <= -0.2 ? 'BEARISH' : 'NEUTRAL';
  evidence.push({
    key: 'twseBreadth',
    block: 'breadth',
    direction,
    qualityStatus: 'VALID',
    availableAt: breadth.availableAt,
    source: 'phase-a-canonical:market_daily',
    interpretation: 'normalized advance/decline balance; +0.20/-0.20 equals 60%/40% breadth-ratio draft cutoffs',
    inputs: [trace(breadth)],
  });
}

function buildInstitutional(map, history, evidence, unavailableRows) {
  const foreign = map.get('cash_foreign_net');
  if (!isUsable(foreign)) {
    unavailableRows.push(unavailable('foreignCashFlow', foreign));
    return;
  }
  const context = percentileContext(history, foreign);
  evidence.push({
    key: 'foreignCashFlow',
    block: 'institutional',
    direction: directionFromPercentile(context),
    qualityStatus: context.bucket === 'UNAVAILABLE' ? 'PARTIAL' : 'VALID',
    availableAt: foreign.availableAt,
    source: 'phase-a-canonical:spot_institutional_daily',
    interpretation: 'foreign cash flow normalized only against distinct past source dates',
    ...contextLabel(context),
    inputs: [trace(foreign)],
  });
}

function buildFuturesPositioning(map, history, evidence, unavailableRows) {
  const txReturn = map.get('price_tx_return');
  const nearContractOi = map.get('near_contract_oi');
  const contractChanged = map.get('contract_changed');
  const rolloverRisk = map.get('rollover_risk');
  const basis = map.get('close_basis_bps');
  const rollover = (isUsable(contractChanged) && Number(contractChanged.value) !== 0)
    || (isUsable(rolloverRisk) && Number(rolloverRisk.value) !== 0);
  const oiDelta = sameContractOiDelta(history, nearContractOi);

  if (rollover) {
    evidence.push({
      key: 'rolloverQuality',
      block: 'eventRisk',
      risk: 'ELEVATED',
      qualityStatus: 'VALID',
      availableAt: maxIso(contractChanged?.availableAt, rolloverRisk?.availableAt),
      source: 'phase-a-canonical:futures_oi_daily',
      interpretation: 'rollover/contract-change rows do not receive a directional OI vote',
      inputs: [trace(contractChanged), trace(rolloverRisk)].filter(Boolean),
    });
    unavailableRows.push({
      ...unavailable('priceOiJointContext', [txReturn, nearContractOi]),
      reason: 'ROLLOVER_OR_CONTRACT_CHANGED',
      productScope: 'TX_MTX_TMF_EQUIVALENT',
      currentContract: nearContractOi?.sourceContract || null,
      previousContract: oiDelta.previous?.sourceContract || null,
    });
  } else if (isUsable(txReturn) && oiDelta.state === 'PASS') {
    const price = Number(txReturn.value);
    const oi = Number(oiDelta.delta);
    let direction = 'NEUTRAL';
    let positioning = 'NO_DIRECTIONAL_BUILD';
    if (price > 0 && oi > 0) {
      direction = 'BULLISH';
      positioning = 'LONG_BUILD_CANDIDATE';
    } else if (price < 0 && oi > 0) {
      direction = 'BEARISH';
      positioning = 'SHORT_BUILD_CANDIDATE';
    } else if (price > 0 && oi < 0) {
      positioning = 'SHORT_COVER_CANDIDATE';
    } else if (price < 0 && oi < 0) {
      positioning = 'LONG_LIQUIDATION_CANDIDATE';
    }
    evidence.push({
      key: 'priceOiJointContext',
      block: 'futuresPositioning',
      direction,
      qualityStatus: 'VALID',
      availableAt: maxIso(txReturn.availableAt, nearContractOi.availableAt, oiDelta.previous.availableAt),
      source: 'phase-a-canonical:futures_oi_daily:near_contract_oi:TX_MTX_TMF_EQUIVALENT',
      productScope: 'TX_MTX_TMF_EQUIVALENT',
      currentContract: nearContractOi.sourceContract,
      previousContract: oiDelta.previous.sourceContract,
      oiDelta,
      positioning,
      interpretation: 'price/OI quadrant is descriptive and does not prove participant identity',
      inputs: [trace(txReturn), trace(nearContractOi), trace(oiDelta.previous)],
    });
  } else {
    unavailableRows.push({
      ...unavailable('priceOiJointContext', [txReturn, nearContractOi]),
      reason: rollover ? 'ROLLOVER_OR_CONTRACT_CHANGED' : oiDelta.state,
      productScope: 'TX_MTX_TMF_EQUIVALENT',
      currentContract: nearContractOi?.sourceContract || null,
      previousContract: oiDelta.previous?.sourceContract || null,
    });
  }

  if (isUsable(basis)) {
    const context = percentileContext(history, basis);
    evidence.push({
      key: 'closeBasisContext',
      block: 'futuresPositioning',
      qualityStatus: context.bucket === 'UNAVAILABLE' ? 'PARTIAL' : 'VALID',
      availableAt: basis.availableAt,
      source: 'phase-a-canonical:basis_term_structure_daily',
      interpretation: 'basis percentile is descriptive only and receives no direct direction vote in V1',
      ...contextLabel(context),
      inputs: [trace(basis)],
    });
  } else {
    unavailableRows.push(unavailable('closeBasisContext', basis));
  }
}

function buildOptions(map, history, evidence, unavailableRows) {
  const atm = map.get('atm_iv');
  if (isUsable(atm)) {
    const context = percentileContext(history, atm);
    const volatility = context.percentile == null
      ? undefined
      : context.percentile >= 0.8 ? 'HIGH' : context.percentile <= 0.2 ? 'LOW' : 'NORMAL';
    evidence.push({
      key: 'atmIvContext',
      block: 'options',
      volatility,
      risk: context.percentile != null && context.percentile >= 0.8 ? 'ELEVATED' : undefined,
      qualityStatus: context.bucket === 'UNAVAILABLE' ? 'PARTIAL' : 'VALID',
      availableAt: atm.availableAt,
      source: 'phase-a-canonical:option_volatility_daily',
      interpretation: 'ATM IV affects volatility/risk only, never Taiwan direction directly',
      ...contextLabel(context),
      inputs: [trace(atm)],
    });
  } else {
    unavailableRows.push(unavailable('atmIvContext', atm));
  }

  const skew = map.get('skew_25d');
  if (isUsable(skew)) {
    const context = percentileContext(history, skew);
    evidence.push({
      key: 'skew25dContext',
      block: 'options',
      risk: context.percentile != null && context.percentile >= 0.8 ? 'ELEVATED' : undefined,
      qualityStatus: context.bucket === 'UNAVAILABLE' ? 'PARTIAL' : 'VALID',
      availableAt: skew.availableAt,
      source: 'phase-a-canonical:option_volatility_daily',
      interpretation: '25D skew is tail-risk context and does not reverse Direction State',
      ...contextLabel(context),
      inputs: [trace(skew)],
    });
  } else {
    unavailableRows.push(unavailable('skew25dContext', skew));
  }

  for (const [key, factorId] of [
    ['optionsOiPcr', 'options_oi_pc_ratio'],
    ['optionsVolumePcr', 'options_volume_pc_ratio'],
  ]) {
    const row = map.get(factorId);
    if (!isUsable(row)) {
      unavailableRows.push(unavailable(key, row));
      continue;
    }
    const context = percentileContext(history, row);
    evidence.push({
      key,
      block: 'options',
      qualityStatus: context.bucket === 'UNAVAILABLE' ? 'PARTIAL' : 'VALID',
      availableAt: row.availableAt,
      source: 'phase-a-canonical:options_contract_daily',
      interpretation: 'PCR is emitted as relative context only; no fixed bullish/bearish vote is authorized',
      ...contextLabel(context),
      inputs: [trace(row)],
    });
  }

  const callOi = map.get('options_call_oi');
  const putOi = map.get('options_put_oi');
  if (isUsable(callOi) && isUsable(putOi)) {
    evidence.push({
      key: 'optionsOiStructure',
      block: 'options',
      qualityStatus: 'VALID',
      availableAt: maxIso(callOi.availableAt, putOi.availableAt),
      source: 'phase-a-canonical:options_contract_daily',
      interpretation: 'raw contract Call/Put OI totals only; no new concentration score is invented',
      callOi: Number(callOi.value),
      putOi: Number(putOi.value),
      inputs: [trace(callOi), trace(putOi)],
    });
  } else {
    unavailableRows.push(unavailable('optionsOiStructure', [callOi, putOi]));
  }
}

function buildGlobalFx(map, evidence, unavailableRows) {
  const ndx = map.get('cross_ndx_return');
  const sox = map.get('cross_sox_return');
  if (isUsable(ndx) && isUsable(sox)) {
    const ndxValue = Number(ndx.value);
    const soxValue = Number(sox.value);
    const alignment = ndxValue > 0 && soxValue > 0
      ? 'TAILWIND'
      : ndxValue < 0 && soxValue < 0
        ? 'HEADWIND'
        : 'NEUTRAL';
    evidence.push({
      key: 'usGrowthBlock',
      block: 'globalFx',
      globalAlignment: alignment,
      qualityStatus: 'VALID',
      availableAt: maxIso(ndx.availableAt, sox.availableAt),
      source: 'phase-a-canonical:global_market_daily',
      interpretation: 'NDX_PROXY and SOX are one correlated US-growth block, not two independent votes',
      inputs: [
        { ...trace(ndx), label: 'NDX_PROXY' },
        { ...trace(sox), label: 'SOX' },
      ],
    });
  } else {
    unavailableRows.push(unavailable('usGrowthBlock', [ndx, sox]));
  }

  const fx = map.get('cross_usdtwd_return');
  if (isUsable(fx)) {
    evidence.push({
      key: 'usdTwdContext',
      block: 'globalFx',
      globalAlignment: Number(fx.value) > 0 ? 'HEADWIND' : Number(fx.value) < 0 ? 'TAILWIND' : 'NEUTRAL',
      qualityStatus: 'VALID',
      availableAt: fx.availableAt,
      source: 'phase-a-canonical:global_market_daily',
      interpretation: 'USD/TWD rising is a candidate TWD-weakness headwind, not a proven causal signal',
      inputs: [trace(fx)],
    });
  } else {
    unavailableRows.push(unavailable('usdTwdContext', fx));
  }

  const vix = map.get('VIXCLS');
  if (!isUsable(vix)) {
    unavailableRows.push(unavailable('vixContext', vix, 'BLOCKED_AVAILABLE_AT'));
  }
}

export function buildHistoricalMarketStateRecords(canonicalRows = []) {
  const sorted = [...canonicalRows].sort((a, b) => a.decisionTradeDate.localeCompare(b.decisionTradeDate)
    || a.factorId.localeCompare(b.factorId));
  const byDate = groupBy(sorted, (row) => row.decisionTradeDate);
  const history = groupBy(sorted, (row) => row.factorId);
  const records = [];

  for (const tradeDate of [...byDate.keys()].sort()) {
    const rows = byDate.get(tradeDate) || [];
    const map = rowMap(rows);
    const decisionAt = rows.find((row) => typeof row.decisionAt === 'string')?.decisionAt || null;
    if (!decisionAt) continue;
    const evidence = [];
    const unavailableRows = [];

    buildLocalPrice(map, evidence, unavailableRows);
    buildBreadth(map, evidence, unavailableRows);
    buildInstitutional(map, history, evidence, unavailableRows);
    buildFuturesPositioning(map, history, evidence, unavailableRows);
    buildOptions(map, history, evidence, unavailableRows);
    buildGlobalFx(map, evidence, unavailableRows);

    const evaluated = evaluatePremarketMarketState({
      tradeDate,
      decisionAt,
      evidence,
      researchOnly: true,
      executionAuthorized: false,
    });
    records.push({
      ...evaluated,
      schemaVersion: 'market-state-v1-historical-dry-run-v0',
      unavailable: [...evaluated.unavailable, ...unavailableRows],
      evidenceTraceVersion: 'phase-a-canonical-reuse-v1',
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    });
  }
  return records;
}

export function summarizeHistoricalMarketState(records = []) {
  const stateCounts = {
    trend: {},
    direction: {},
    volatility: {},
    risk: {},
    riskResearchContext: {},
    globalAlignment: {},
  };
  const evidenceCoverage = {};
  let futureDataViolations = 0;
  for (const record of records) {
    for (const axis of Object.keys(stateCounts)) {
      const value = axis === 'riskResearchContext'
        ? record.riskResearchContext ?? 'UNAVAILABLE'
        : record.state?.[axis] ?? 'UNAVAILABLE';
      stateCounts[axis][value] = (stateCounts[axis][value] || 0) + 1;
    }
    for (const item of record.evidence || []) {
      evidenceCoverage[item.key] = (evidenceCoverage[item.key] || 0) + 1;
    }
    for (const item of record.unavailable || []) {
      if (['FUTURE_EVIDENCE', 'AVAILABLE_AT_VIOLATION'].includes(item.reason)) futureDataViolations += 1;
    }
  }
  return {
    schemaVersion: 'market-state-v1-historical-summary-v0',
    records: records.length,
    firstTradeDate: records[0]?.tradeDate || null,
    lastTradeDate: records.at(-1)?.tradeDate || null,
    stateCounts,
    evidenceCoverage,
    futureDataViolations,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

const finite = (value) => {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const round = (value, digits = 1) => value == null ? null : Number(value.toFixed(digits));

function aggregateStrikes(strikes = []) {
  const byStrike = new Map();
  for (const row of strikes) {
    const strike = finite(row?.strike);
    if (strike == null) continue;
    const current = byStrike.get(strike) || { strike, callOi: 0, putOi: 0 };
    current.callOi += Math.max(0, finite(row?.callOi) || 0);
    current.putOi += Math.max(0, finite(row?.putOi) || 0);
    byStrike.set(strike, current);
  }
  return [...byStrike.values()].sort((a, b) => a.strike - b.strike);
}

function weightedQuantile(rows, field, quantile) {
  const valid = rows.filter((row) => finite(row[field]) > 0);
  const total = valid.reduce((sum, row) => sum + Number(row[field]), 0);
  if (!total) return null;
  const target = total * quantile;
  let cumulative = 0;
  for (const row of valid) {
    cumulative += Number(row[field]);
    if (cumulative >= target) return row.strike;
  }
  return valid.at(-1)?.strike ?? null;
}

function centralRange(rows, field, coverage) {
  const total = rows.reduce((sum, row) => sum + Math.max(0, finite(row[field]) || 0), 0);
  if (!total) return null;
  const tail = (1 - coverage) / 2;
  const low = weightedQuantile(rows, field, tail);
  const high = weightedQuantile(rows, field, 1 - tail);
  if (low == null || high == null) return null;
  const covered = rows
    .filter((row) => row.strike >= low && row.strike <= high)
    .reduce((sum, row) => sum + Math.max(0, finite(row[field]) || 0), 0);
  return {
    coveragePct: Math.round(coverage * 100),
    low,
    high,
    coveredOi: covered,
    actualCoveragePct: round(covered / total * 100, 1),
  };
}

function distributionStats(rows, field) {
  const weighted = rows
    .map((row) => ({ strike: row.strike, weight: Math.max(0, finite(row[field]) || 0) }))
    .filter((row) => row.weight > 0);
  const totalOi = weighted.reduce((sum, row) => sum + row.weight, 0);
  if (!totalOi) {
    return {
      available: false,
      totalOi: 0,
      weightedMean: null,
      weightedMedian: null,
      ranges: {},
    };
  }
  const weightedMean = weighted.reduce((sum, row) => sum + row.strike * row.weight, 0) / totalOi;
  return {
    available: true,
    totalOi,
    weightedMean: round(weightedMean, 1),
    weightedMedian: weightedQuantile(rows, field, 0.5),
    ranges: Object.fromEntries([0.5, 0.7, 0.9].map((coverage) => [
      String(Math.round(coverage * 100)),
      centralRange(rows, field, coverage),
    ])),
  };
}

function strikeStep(rows) {
  const differences = rows.slice(1)
    .map((row, index) => row.strike - rows[index].strike)
    .filter((value) => value > 0);
  return differences.length ? Math.min(...differences) : null;
}

function calculateMaxPain(rows) {
  if (!rows.length) return null;
  let best = null;
  let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of rows) {
    let pain = 0;
    for (const row of rows) {
      pain += Math.max(0, candidate.strike - row.strike) * row.callOi;
      pain += Math.max(0, row.strike - candidate.strike) * row.putOi;
    }
    if (pain < minimum) {
      minimum = pain;
      best = candidate.strike;
    }
  }
  return best;
}

function maxWall(rows, field) {
  return rows.reduce((best, row) => {
    const openInterest = Math.max(0, finite(row[field]) || 0);
    return !best || openInterest > best.openInterest ? { strike: row.strike, openInterest } : best;
  }, null);
}

function snapshotDate(snapshot) {
  return snapshot?.options?.dataDate
    || snapshot?.options?.data?.tradeDate
    || snapshot?.asOfDate
    || null;
}

function referencePrice(snapshot) {
  return finite(snapshot?.futuresMarket?.data?.txDay?.close)
    ?? finite(snapshot?.marketOverview?.data?.twii?.price);
}

function normalizePoint(snapshot, contractCode) {
  const options = snapshot?.options?.data || {};
  const contract = (options.contracts || []).find((row) => row?.contract === contractCode);
  const strikes = aggregateStrikes(contract?.strikes || []);
  if (!contract || !strikes.length) return null;
  const callWall = contract.callWall || maxWall(strikes, 'callOi');
  const putWall = contract.putWall || maxWall(strikes, 'putOi');
  return {
    tradeDate: snapshotDate(snapshot),
    contract: contractCode,
    contractType: contract.type || options.contractType || null,
    expiryDate: contract.expiryDate || options.expiryDate || null,
    daysToExpiry: finite(contract.daysToExpiry) ?? finite(options.daysToExpiry),
    referencePrice: referencePrice(snapshot),
    callOi: finite(contract.callOi) ?? strikes.reduce((sum, row) => sum + row.callOi, 0),
    putOi: finite(contract.putOi) ?? strikes.reduce((sum, row) => sum + row.putOi, 0),
    callWall: callWall ? { strike: finite(callWall.strike), openInterest: finite(callWall.openInterest) } : null,
    putWall: putWall ? { strike: finite(putWall.strike), openInterest: finite(putWall.openInterest) } : null,
    maxPain: finite(contract.maxPain) ?? finite(options.maxPain) ?? calculateMaxPain(strikes),
    strikes,
  };
}

function sameContractPoints(snapshot, history, contractCode) {
  const byDate = new Map();
  for (const row of [...history, snapshot]) {
    if (!row || (row.dataMode && row.dataMode !== 'live')) continue;
    const point = normalizePoint(row, contractCode);
    if (point?.tradeDate) byDate.set(point.tradeDate, point);
  }
  return [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

function wallState({ side, current, previous, points, reference, step }) {
  const key = side === 'call' ? 'callWall' : 'putWall';
  const oiField = side === 'call' ? 'callOi' : 'putOi';
  const wall = current[key];
  if (wall?.strike == null) return { available: false, side };
  let stabilityDays = 0;
  for (let index = points.length - 1; index >= 0; index -= 1) {
    if (points[index]?.[key]?.strike !== wall.strike) break;
    stabilityDays += 1;
  }
  const previousWall = previous?.[key] || null;
  const previousAtStrike = previous?.strikes?.find((row) => row.strike === wall.strike);
  const distance = reference == null ? null : wall.strike - reference;
  const tolerance = (step || 100) / 2;
  const referenceState = distance == null
    ? 'unknown'
    : Math.abs(distance) <= tolerance
      ? 'near_wall'
      : distance > 0 ? 'reference_below_wall' : 'reference_above_wall';
  const movement = previousWall?.strike == null ? null : wall.strike - previousWall.strike;
  return {
    available: true,
    side,
    strike: wall.strike,
    openInterest: wall.openInterest,
    sharePct: round(wall.openInterest / Math.max(1, side === 'call' ? current.callOi : current.putOi) * 100, 1),
    movement,
    movementState: movement == null ? 'insufficient_history' : movement > 0 ? 'moved_up' : movement < 0 ? 'moved_down' : 'unchanged',
    stabilityDays,
    oiDeltaAtStrike: previousAtStrike ? wall.openInterest - previousAtStrike[oiField] : null,
    distanceFromReference: distance,
    referenceState,
  };
}

function balanceZone(callStats, putStats, combinedStats) {
  const callRange = callStats.ranges['50'];
  const putRange = putStats.ranges['50'];
  let low = null;
  let high = null;
  let method = 'combined_oi_central_50';
  if (callRange && putRange) {
    const overlapLow = Math.max(callRange.low, putRange.low);
    const overlapHigh = Math.min(callRange.high, putRange.high);
    if (overlapLow <= overlapHigh) {
      low = overlapLow;
      high = overlapHigh;
      method = 'call_put_central_50_overlap';
    } else {
      low = Math.min(callStats.weightedMedian, putStats.weightedMedian);
      high = Math.max(callStats.weightedMedian, putStats.weightedMedian);
      method = 'call_put_weighted_median_gap';
    }
  } else if (combinedStats.ranges['50']) {
    low = combinedStats.ranges['50'].low;
    high = combinedStats.ranges['50'].high;
  }
  return {
    available: low != null && high != null,
    version: 'dealer-balance-zone-0.1.0-oi-only',
    scope: 'oi_only',
    low,
    high,
    center: low != null && high != null ? round((low + high) / 2, 1) : null,
    method,
    includedComponents: ['oi_balance'],
    missingComponents: ['delta_neutral_scenario', 'gamma_center_scenario'],
    meaning: '公開OI結構的透明平衡區，不是真實莊家成交成本',
  };
}

function maxPainContext(current, previous, reference, step) {
  const maxPain = current.maxPain;
  const distance = maxPain == null || reference == null ? null : reference - maxPain;
  const absoluteDistance = distance == null ? null : Math.abs(distance);
  const unit = step || 100;
  const proximity = absoluteDistance == null ? 'unknown'
    : absoluteDistance <= unit ? 'near'
      : absoluteDistance <= unit * 3 ? 'moderate' : 'far';
  const days = current.daysToExpiry;
  const expiryPhase = days == null ? 'unknown'
    : days <= 0 ? 'expiry_day'
      : days <= 2 ? 'near_expiry'
        : days <= 7 ? 'within_week' : 'later';
  return {
    value: maxPain,
    distanceFromReference: distance,
    absoluteDistance,
    movement: previous?.maxPain == null || maxPain == null ? null : maxPain - previous.maxPain,
    proximity,
    daysToExpiry: days,
    expiryPhase,
    meaning: '結算損益結構參考，不是價格必到目標',
  };
}

function unavailable(reason) {
  return {
    available: false,
    version: 'transparent-dealer-map-0.1.0-eod',
    state: 'insufficient_data',
    reason,
    researchOnly: true,
    executionAuthorized: false,
    safeguards: {
      dealerPositionObserved: false,
      dealerCostObserved: false,
      greeksIncluded: false,
      publicOiOnly: true,
      orderEndpointPresent: false,
    },
  };
}

export function buildDealerMap({ snapshot, history = [] } = {}) {
  const options = snapshot?.options?.data || {};
  const contractCode = options.contract;
  if (!contractCode) return unavailable('沒有可用的主力選擇權契約');
  const current = normalizePoint(snapshot, contractCode);
  if (!current) return unavailable('主力契約沒有可驗證的逐履約價OI');
  const points = sameContractPoints(snapshot, history, contractCode);
  const previous = points.at(-2) || null;
  const rows = current.strikes.map((row) => ({ ...row, combinedOi: row.callOi + row.putOi }));
  const call = distributionStats(rows, 'callOi');
  const put = distributionStats(rows, 'putOi');
  const combined = distributionStats(rows, 'combinedOi');
  const step = strikeStep(rows);
  const reference = current.referencePrice;
  const zones = [50, 70, 90].map((coveragePct) => combined.ranges[String(coveragePct)]).filter(Boolean);
  const warnings = [];
  if (points.length < 2) warnings.push('同契約歷史不足2日，牆位移動與OI增減暫不可比較');
  if (reference == null) warnings.push('缺少台指期或加權指數參考價');
  if (current.daysToExpiry != null && current.daysToExpiry <= 0) warnings.push('本契約為到期日資料，下一契約須重新累積');
  return {
    available: true,
    version: 'transparent-dealer-map-0.1.0-eod',
    state: warnings.length ? 'available_with_warnings' : 'available',
    tradeDate: current.tradeDate,
    contract: contractCode,
    contractType: current.contractType,
    expiryDate: current.expiryDate,
    daysToExpiry: current.daysToExpiry,
    referencePrice: reference,
    strikeStep: step,
    strikeCount: rows.length,
    sameContractDays: points.length,
    updateMode: 'end_of_day',
    scoreMeaning: '市場結構描述，不是勝率、方向機率或真實Dealer部位',
    oiCenters: { call, put, combined },
    structureZones: zones,
    balanceZone: balanceZone(call, put, combined),
    walls: {
      call: wallState({ side: 'call', current, previous, points, reference, step }),
      put: wallState({ side: 'put', current, previous, points, reference, step }),
    },
    maxPain: maxPainContext(current, previous, reference, step),
    history: points.slice(-15).map((point) => ({
      tradeDate: point.tradeDate,
      referencePrice: point.referencePrice,
      callOi: point.callOi,
      putOi: point.putOi,
      callWallStrike: point.callWall?.strike ?? null,
      callWallOi: point.callWall?.openInterest ?? null,
      putWallStrike: point.putWall?.strike ?? null,
      putWallOi: point.putWall?.openInterest ?? null,
      maxPain: point.maxPain,
    })),
    warnings,
    researchOnly: true,
    executionAuthorized: false,
    safeguards: {
      dealerPositionObserved: false,
      dealerCostObserved: false,
      greeksIncluded: false,
      deltaNeutralAvailable: false,
      gammaCenterAvailable: false,
      publicOiOnly: true,
      orderEndpointPresent: false,
    },
  };
}


import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const ENGINE_VERSION = 'V3.8.1-engineering-strategy-events-v1';
const PROTOCOL_VERSION = 'V3.8.0-frozen-2026-07-18';
const EXPECTED_DAY_BARS = 60;
const TARGET_R = 1.5;
const COST_POINTS = Object.freeze([4, 8, 16]);
const HORIZONS = Object.freeze([
  { minutes: 30, bars: 6 },
  { minutes: 60, bars: 12 },
  { minutes: 120, bars: 24 },
]);
const STRATEGIES = Object.freeze({
  ORB: 'opening_range_breakout',
  VWAP: 'vwap_pullback_continuation',
  FAKE: 'opening_range_false_break_reversion',
});

const PROTOCOL_RULES = Object.freeze({
  product: 'TX',
  session: 'day',
  timeframe: '5m',
  openingRangeBarIndexes: [0, 1, 2],
  signalAtCompletedBarClose: true,
  entryAtNextBarOpen: true,
  targetR: TARGET_R,
  horizonsMinutes: HORIZONS.map((item) => item.minutes),
  sameBarDoubleTouch: 'stop_first',
  costsRoundTripPoints: COST_POINTS,
  crossSessionAllowed: false,
  crossContractAllowed: false,
  vwapDefinition: 'bar_typical_price_vwap_v1',
});

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function number(value) { return finite(value) ? Number(value) : null; }

function addMinutes(timestamp, minutes) {
  const value = Date.parse(timestamp);
  return Number.isNaN(value) ? null : new Date(value + minutes * 60_000).toISOString();
}

function stableHash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function eventId(candidate) {
  return `ise_${stableHash([
    ENGINE_VERSION,
    candidate.tradeDate,
    candidate.contract,
    candidate.strategy,
    candidate.direction,
    candidate.signalTimestamp,
  ]).slice(0, 24)}`;
}

function signalSnapshot(row, previousRow, openingRangeHigh, openingRangeLow) {
  return {
    barIndex: row.barIndex,
    open: number(row.open),
    high: number(row.high),
    low: number(row.low),
    close: number(row.close),
    volume: number(row.volume),
    openingRangeHigh,
    openingRangeLow,
    vwapProxyHlc3: number(row.vwapProxyHlc3),
    vwapSlopePoints: finite(row.vwapProxyHlc3) && finite(previousRow?.vwapProxyHlc3)
      ? Number(row.vwapProxyHlc3) - Number(previousRow.vwapProxyHlc3)
      : null,
    rvol20SameSlot: row.rvol20Ready === true ? number(row.rvol20SameSlot) : null,
    rvol20SampleDays: number(row.rvol20SampleDays),
    rvol20Ready: row.rvol20Ready === true,
    volumeFilterApplied: false,
  };
}

function makeCandidate(rows, strategy, direction, signalIndex, initialStop, details = {}) {
  const row = rows[signalIndex];
  const openingRangeHigh = Math.max(...rows.slice(0, 3).map((item) => Number(item.high)));
  const openingRangeLow = Math.min(...rows.slice(0, 3).map((item) => Number(item.low)));
  return {
    strategy,
    direction,
    tradeDate: row.tradeDate,
    contract: row.contract,
    session: row.session,
    signalIndex,
    signalTimestamp: row.timestamp,
    signalAvailableAt: row.featureAvailableAt || addMinutes(row.timestamp, 5),
    initialStop,
    signalFeatures: signalSnapshot(row, rows[signalIndex - 1], openingRangeHigh, openingRangeLow),
    details,
  };
}

function detectOpeningRangeBreakouts(rows) {
  const candidates = [];
  const rangeHigh = Math.max(...rows.slice(0, 3).map((row) => Number(row.high)));
  const rangeLow = Math.min(...rows.slice(0, 3).map((row) => Number(row.low)));
  for (let index = 3; index < rows.length; index += 1) {
    const row = rows[index];
    if (Number(row.close) > rangeHigh) {
      candidates.push(makeCandidate(rows, STRATEGIES.ORB, 'long', index, Math.min(Number(row.low), rangeHigh), {
        rule: 'completed_bar_close_strictly_above_opening_range',
      }));
    }
    if (Number(row.close) < rangeLow) {
      candidates.push(makeCandidate(rows, STRATEGIES.ORB, 'short', index, Math.max(Number(row.high), rangeLow), {
        rule: 'completed_bar_close_strictly_below_opening_range',
      }));
    }
  }
  return candidates;
}

function detectVwapPullbacks(rows) {
  const candidates = [];
  const rangeHigh = Math.max(...rows.slice(0, 3).map((row) => Number(row.high)));
  const rangeLow = Math.min(...rows.slice(0, 3).map((row) => Number(row.low)));
  let priorLongBreakoutIndex = null;
  let priorShortBreakoutIndex = null;
  for (let index = 3; index < rows.length; index += 1) {
    const row = rows[index];
    const previous = rows[index - 1];
    const vwap = number(row.vwapProxyHlc3);
    const previousVwap = number(previous?.vwapProxyHlc3);
    if (priorLongBreakoutIndex !== null && finite(vwap) && finite(previousVwap)
      && vwap > previousVwap && Number(row.low) <= vwap && Number(row.close) > vwap) {
      candidates.push(makeCandidate(rows, STRATEGIES.VWAP, 'long', index, Number(row.low), {
        rule: 'prior_long_orb_positive_vwap_slope_touch_and_reclaim',
        prerequisiteBreakoutIndex: priorLongBreakoutIndex,
      }));
    }
    if (priorShortBreakoutIndex !== null && finite(vwap) && finite(previousVwap)
      && vwap < previousVwap && Number(row.high) >= vwap && Number(row.close) < vwap) {
      candidates.push(makeCandidate(rows, STRATEGIES.VWAP, 'short', index, Number(row.high), {
        rule: 'prior_short_orb_negative_vwap_slope_touch_and_reject',
        prerequisiteBreakoutIndex: priorShortBreakoutIndex,
      }));
    }
    if (priorLongBreakoutIndex === null && Number(row.close) > rangeHigh) priorLongBreakoutIndex = index;
    if (priorShortBreakoutIndex === null && Number(row.close) < rangeLow) priorShortBreakoutIndex = index;
  }
  return candidates;
}

function detectFalseBreakouts(rows) {
  const candidates = [];
  const rangeHigh = Math.max(...rows.slice(0, 3).map((row) => Number(row.high)));
  const rangeLow = Math.min(...rows.slice(0, 3).map((row) => Number(row.low)));
  let upper = null;
  let lower = null;
  let upperArmed = true;
  let lowerArmed = true;

  for (let index = 3; index < rows.length; index += 1) {
    const row = rows[index];
    const insideRange = Number(row.close) >= rangeLow && Number(row.close) <= rangeHigh;

    if (upper) {
      upper.extreme = Math.max(upper.extreme, Number(row.high));
      const barsAfterBreakout = index - upper.startIndex;
      if (barsAfterBreakout >= 1 && barsAfterBreakout <= 3 && insideRange) {
        candidates.push(makeCandidate(rows, STRATEGIES.FAKE, 'short', index, upper.extreme, {
          rule: 'upper_breakout_returned_inside_within_three_completed_bars',
          breakoutIndex: upper.startIndex,
          barsAfterBreakout,
        }));
        upper = null;
        upperArmed = true;
      } else if (barsAfterBreakout >= 3) {
        upper = null;
        upperArmed = Number(row.close) <= rangeHigh;
      }
    } else if (upperArmed && Number(row.high) > rangeHigh) {
      upper = { startIndex: index, extreme: Number(row.high) };
      upperArmed = false;
    } else if (Number(row.close) <= rangeHigh) {
      upperArmed = true;
    }

    if (lower) {
      lower.extreme = Math.min(lower.extreme, Number(row.low));
      const barsAfterBreakout = index - lower.startIndex;
      if (barsAfterBreakout >= 1 && barsAfterBreakout <= 3 && insideRange) {
        candidates.push(makeCandidate(rows, STRATEGIES.FAKE, 'long', index, lower.extreme, {
          rule: 'lower_breakout_returned_inside_within_three_completed_bars',
          breakoutIndex: lower.startIndex,
          barsAfterBreakout,
        }));
        lower = null;
        lowerArmed = true;
      } else if (barsAfterBreakout >= 3) {
        lower = null;
        lowerArmed = Number(row.close) >= rangeLow;
      }
    } else if (lowerArmed && Number(row.low) < rangeLow) {
      lower = { startIndex: index, extreme: Number(row.low) };
      lowerArmed = false;
    } else if (Number(row.close) >= rangeLow) {
      lowerArmed = true;
    }
  }
  return candidates;
}

export function detectIntradayStrategyCandidates(rows) {
  return [
    ...detectOpeningRangeBreakouts(rows),
    ...detectVwapPullbacks(rows),
    ...detectFalseBreakouts(rows),
  ].sort((a, b) => a.signalIndex - b.signalIndex
    || a.strategy.localeCompare(b.strategy)
    || a.direction.localeCompare(b.direction));
}

function barrierTouch(bar, direction, stopPrice, targetPrice) {
  const stopHit = direction === 'long' ? Number(bar.low) <= stopPrice : Number(bar.high) >= stopPrice;
  const targetHit = direction === 'long' ? Number(bar.high) >= targetPrice : Number(bar.low) <= targetPrice;
  if (stopHit) return { exitReason: 'stop', exitPrice: stopPrice, sameBarDoubleTouch: targetHit };
  if (targetHit) return { exitReason: 'target', exitPrice: targetPrice, sameBarDoubleTouch: false };
  return null;
}

function evaluateHorizon(event, rows, horizon) {
  const endIndex = event.entryBarIndex + horizon.bars - 1;
  const base = {
    schemaVersion: '1.0.0',
    engineVersion: ENGINE_VERSION,
    eventId: event.eventId,
    tradeDate: event.tradeDate,
    contract: event.contract,
    session: event.session,
    strategy: event.strategy,
    direction: event.direction,
    horizonMinutes: horizon.minutes,
    researchOnly: true,
    executionAuthorized: false,
  };
  if (endIndex >= rows.length) {
    return {
      ...base,
      state: 'unavailable',
      reason: 'session_boundary_insufficient_bars',
      outcomeAvailableAt: null,
      exitTimestamp: null,
      exitBarIndex: null,
      exitReason: null,
      exitPrice: null,
      heldBars: null,
      heldMinutes: null,
      sameBarDoubleTouch: null,
      pathHigh: null,
      pathLow: null,
      mfePoints: null,
      maePoints: null,
      mfeR: null,
      maeR: null,
      grossPoints: null,
      grossR: null,
      costScenarios: COST_POINTS.map((roundTripCostPoints) => ({
        roundTripCostPoints,
        netPoints: null,
        netR: null,
      })),
    };
  }

  let touched = null;
  let exitIndex = endIndex;
  for (let index = event.entryBarIndex; index <= endIndex; index += 1) {
    touched = barrierTouch(rows[index], event.direction, event.initialStop, event.targetPrice);
    if (touched) {
      exitIndex = index;
      break;
    }
  }
  const exitPrice = touched?.exitPrice ?? Number(rows[endIndex].close);
  const pathBars = rows.slice(event.entryBarIndex, exitIndex + 1);
  const pathHigh = Math.max(...pathBars.map((bar) => Number(bar.high)));
  const pathLow = Math.min(...pathBars.map((bar) => Number(bar.low)));
  const mfePoints = Math.max(0, event.direction === 'long' ? pathHigh - event.entryPrice : event.entryPrice - pathLow);
  const maePoints = Math.min(0, event.direction === 'long' ? pathLow - event.entryPrice : event.entryPrice - pathHigh);
  const grossPoints = event.direction === 'long'
    ? exitPrice - event.entryPrice
    : event.entryPrice - exitPrice;
  return {
    ...base,
    state: 'complete',
    reason: null,
    outcomeAvailableAt: addMinutes(rows[exitIndex].timestamp, 5),
    exitTimestamp: rows[exitIndex].timestamp,
    exitBarIndex: exitIndex,
    exitReason: touched?.exitReason || 'time_limit',
    exitPrice,
    heldBars: exitIndex - event.entryBarIndex + 1,
    heldMinutes: (exitIndex - event.entryBarIndex + 1) * 5,
    sameBarDoubleTouch: touched?.sameBarDoubleTouch || false,
    pathHigh,
    pathLow,
    mfePoints,
    maePoints,
    mfeR: mfePoints / event.riskPoints,
    maeR: maePoints / event.riskPoints,
    grossPoints,
    grossR: grossPoints / event.riskPoints,
    costScenarios: COST_POINTS.map((roundTripCostPoints) => ({
      roundTripCostPoints,
      netPoints: grossPoints - roundTripCostPoints,
      netR: (grossPoints - roundTripCostPoints) / event.riskPoints,
    })),
  };
}

function firstResolutionIndex(event, rows) {
  const finalIndex = Math.min(rows.length - 1, event.entryBarIndex + HORIZONS.at(-1).bars - 1);
  for (let index = event.entryBarIndex; index <= finalIndex; index += 1) {
    if (barrierTouch(rows[index], event.direction, event.initialStop, event.targetPrice)) return index;
  }
  return finalIndex;
}

function materializeCandidate(candidate, rows, active) {
  const id = eventId(candidate);
  const base = {
    schemaVersion: '1.0.0',
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    protocolFingerprintSha256: stableHash(PROTOCOL_RULES),
    eventId: id,
    tradeDate: candidate.tradeDate,
    contract: candidate.contract,
    session: candidate.session,
    strategy: candidate.strategy,
    direction: candidate.direction,
    signalTimestamp: candidate.signalTimestamp,
    signalAvailableAt: candidate.signalAvailableAt,
    signalBarIndex: candidate.signalIndex,
    signalFeatures: candidate.signalFeatures,
    details: candidate.details,
    researchOnly: true,
    executionAuthorized: false,
  };

  if (active && candidate.signalIndex < active.activeUntilIndex) {
    return {
      event: {
        ...base,
        state: 'not_entered',
        reason: 'single_strategy_direction_event_still_active',
        blockedByEventId: active.eventId,
        entryTimestamp: null,
        entryBarIndex: null,
        entryPrice: null,
        initialStop: candidate.initialStop,
        targetPrice: null,
        riskPoints: null,
      },
      outcomes: [],
      active,
    };
  }

  const entryBarIndex = candidate.signalIndex + 1;
  if (entryBarIndex >= rows.length) {
    return {
      event: {
        ...base,
        state: 'cancelled',
        reason: 'no_next_bar_open_before_session_boundary',
        blockedByEventId: null,
        entryTimestamp: null,
        entryBarIndex: null,
        entryPrice: null,
        initialStop: candidate.initialStop,
        targetPrice: null,
        riskPoints: null,
      },
      outcomes: [],
      active: null,
    };
  }

  const entryPrice = Number(rows[entryBarIndex].open);
  const stopOnCorrectSide = candidate.direction === 'long'
    ? candidate.initialStop < entryPrice
    : candidate.initialStop > entryPrice;
  const riskPoints = Math.abs(entryPrice - candidate.initialStop);
  if (!finite(riskPoints) || riskPoints <= 0 || !stopOnCorrectSide) {
    return {
      event: {
        ...base,
        state: 'cancelled',
        reason: !stopOnCorrectSide ? 'next_open_gapped_through_initial_stop' : 'non_positive_initial_risk',
        blockedByEventId: null,
        entryTimestamp: rows[entryBarIndex].timestamp,
        entryBarIndex,
        entryPrice,
        initialStop: candidate.initialStop,
        targetPrice: null,
        riskPoints: null,
      },
      outcomes: [],
      active: null,
    };
  }

  const targetPrice = candidate.direction === 'long'
    ? entryPrice + TARGET_R * riskPoints
    : entryPrice - TARGET_R * riskPoints;
  const event = {
    ...base,
    state: 'triggered',
    reason: null,
    blockedByEventId: null,
    entryRule: 'next_complete_5m_bar_open_after_signal',
    entryTimestamp: rows[entryBarIndex].timestamp,
    entryAvailableAt: rows[entryBarIndex].timestamp,
    entryBarIndex,
    entryPrice,
    initialStop: candidate.initialStop,
    targetPrice,
    riskPoints,
  };
  const outcomes = HORIZONS.map((horizon) => evaluateHorizon(event, rows, horizon));
  return {
    event,
    outcomes,
    active: { eventId: id, activeUntilIndex: firstResolutionIndex(event, rows) },
  };
}

function validateFeatureDay(rows) {
  const errors = [];
  if (rows.length !== EXPECTED_DAY_BARS) errors.push('bar_count_not_60');
  const first = rows[0];
  if (!first || first.product !== 'TX') errors.push('product_not_TX');
  if (!first || first.session !== 'day') errors.push('session_not_day');
  if (!first || first.timeframe !== '5m') errors.push('timeframe_not_5m');
  if (!first?.contract) errors.push('contract_missing');
  rows.forEach((row, index) => {
    if (row.barIndex !== index) errors.push(`bar_${index}_index_mismatch`);
    if (row.tradeDate !== first?.tradeDate) errors.push(`bar_${index}_trade_date_mismatch`);
    if (row.contract !== first?.contract) errors.push(`bar_${index}_contract_mismatch`);
    if (row.session !== 'day') errors.push(`bar_${index}_session_not_day`);
    if (row.timeframe !== '5m') errors.push(`bar_${index}_timeframe_not_5m`);
    if (row.researchOnly !== true || row.executionAuthorized !== false) errors.push(`bar_${index}_research_boundary_missing`);
    if (!String(row.sourceAuditState || '').startsWith('passed')) errors.push(`bar_${index}_source_audit_not_passed`);
    for (const key of ['open', 'high', 'low', 'close', 'volume', 'vwapProxyHlc3']) {
      if (!finite(row[key])) errors.push(`bar_${index}_${key}_missing`);
    }
    if (['open', 'high', 'low', 'close'].some((key) => Number(row[key]) <= 0)) errors.push(`bar_${index}_price_not_positive`);
    if (Number(row.volume) < 0) errors.push(`bar_${index}_volume_negative`);
    if (Number(row.high) < Math.max(Number(row.open), Number(row.close), Number(row.low))
      || Number(row.low) > Math.min(Number(row.open), Number(row.close), Number(row.high))) {
      errors.push(`bar_${index}_ohlc_invalid`);
    }
    const timestampMs = Date.parse(row.timestamp);
    const availableMs = Date.parse(row.featureAvailableAt);
    if (Number.isNaN(timestampMs) || Number.isNaN(availableMs) || availableMs !== timestampMs + 5 * 60_000) {
      errors.push(`bar_${index}_availability_invalid`);
    }
    if (index > 0 && Date.parse(row.timestamp) <= Date.parse(rows[index - 1].timestamp)) errors.push(`bar_${index}_not_in_order`);
  });
  return [...new Set(errors)];
}

function groupDays(barFeatures) {
  const groups = new Map();
  for (const row of barFeatures) {
    if (row?.rowType !== 'bar_feature') continue;
    const key = `${row.tradeDate}|${row.contract}|${row.session}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.values()]
    .map((rows) => rows.sort((a, b) => a.barIndex - b.barIndex))
    .sort((a, b) => String(a[0]?.tradeDate).localeCompare(String(b[0]?.tradeDate)));
}

function countsBy(rows, key) {
  return rows.reduce((result, row) => {
    const value = row[key] ?? 'unknown';
    result[value] = (result[value] || 0) + 1;
    return result;
  }, {});
}

export function evaluateIntradayStrategies(barFeatures, sourceQuality = null) {
  const includedDays = [];
  const excludedDays = [];
  for (const rows of groupDays(barFeatures)) {
    const errors = validateFeatureDay(rows);
    const identity = { tradeDate: rows[0]?.tradeDate || null, contract: rows[0]?.contract || null };
    if (errors.length) excludedDays.push({ ...identity, errors });
    else includedDays.push(rows);
  }

  const events = [];
  const outcomes = [];
  for (const rows of includedDays) {
    const candidates = detectIntradayStrategyCandidates(rows);
    const activeByStrategyDirection = new Map();
    for (const candidate of candidates) {
      const key = `${candidate.strategy}|${candidate.direction}`;
      const built = materializeCandidate(candidate, rows, activeByStrategyDirection.get(key) || null);
      events.push(built.event);
      outcomes.push(...built.outcomes);
      if (built.event.state === 'triggered') activeByStrategyDirection.set(key, built.active);
    }
  }

  const uniqueDays = includedDays.length;
  const currentDateRange = {
    first: includedDays[0]?.[0]?.tradeDate || null,
    last: includedDays.at(-1)?.[0]?.tradeDate || null,
  };
  const completeOutcomes = outcomes.filter((row) => row.state === 'complete');
  const unavailableOutcomes = outcomes.filter((row) => row.state === 'unavailable');
  const triggeredEvents = events.filter((row) => row.state === 'triggered');
  const eventById = new Map(events.map((row) => [row.eventId, row]));
  const eventIds = events.map((row) => row.eventId);
  const outcomeKeys = outcomes.map((row) => `${row.eventId}|${row.horizonMinutes}`);
  const auditErrors = [];
  if (new Set(eventIds).size !== eventIds.length) auditErrors.push('duplicate_event_id');
  if (new Set(outcomeKeys).size !== outcomeKeys.length) auditErrors.push('duplicate_event_horizon');
  if (outcomes.length !== triggeredEvents.length * HORIZONS.length) auditErrors.push('triggered_event_outcome_count_mismatch');
  if (triggeredEvents.some((row) => row.entryBarIndex !== row.signalBarIndex + 1)) auditErrors.push('entry_not_next_bar');
  if (events.some((row) => row.executionAuthorized !== false || row.researchOnly !== true)) auditErrors.push('event_research_boundary_missing');
  if (outcomes.some((row) => row.executionAuthorized !== false || row.researchOnly !== true)) auditErrors.push('outcome_research_boundary_missing');
  if (events.some((row) => Object.keys(row.signalFeatures || {}).some((key) => /future|horizon|label|outcome/i.test(key)))) {
    auditErrors.push('future_key_in_signal_features');
  }
  if (outcomes.some((row) => {
    const event = eventById.get(row.eventId);
    return !event || event.tradeDate !== row.tradeDate || event.contract !== row.contract || event.session !== row.session;
  })) auditErrors.push('event_outcome_boundary_mismatch');
  if (completeOutcomes.some((row) => row.sameBarDoubleTouch === true && row.exitReason !== 'stop')) {
    auditErrors.push('same_bar_double_touch_not_stopped_first');
  }
  if (unavailableOutcomes.some((row) => row.exitPrice !== null || row.grossPoints !== null
    || row.mfePoints !== null || row.maePoints !== null
    || row.costScenarios.some((item) => item.netPoints !== null || item.netR !== null))) {
    auditErrors.push('unavailable_horizon_not_null');
  }
  const formalResearchReady = uniqueDays >= 120 && sourceQuality?.gates?.formalResearchReady === true;
  const deterministicInputAsOf = sourceQuality?.inputAsOf
    || barFeatures.map((row) => row.featureAvailableAt).filter(Boolean).sort().at(-1)
    || null;
  const summary = {
    schemaVersion: '1.0.0',
    engineVersion: ENGINE_VERSION,
    protocolVersion: PROTOCOL_VERSION,
    protocolFingerprintSha256: stableHash(PROTOCOL_RULES),
    generatedAt: deterministicInputAsOf,
    inputFingerprintSha256: stableHash(barFeatures.map((row) => [
      row.tradeDate, row.contract, row.barIndex, row.timestamp,
      row.open, row.high, row.low, row.close, row.volume,
      row.vwapProxyHlc3, row.rvol20SameSlot,
    ])),
    dateRange: currentDateRange,
    researchOnly: true,
    executionAuthorized: false,
    performanceClaimAuthorized: false,
    classification: 'engineering_and_descriptive_event_replay_only',
    counts: {
      includedDays: uniqueDays,
      excludedDays: excludedDays.length,
      candidateEvents: events.length,
      triggeredEvents: triggeredEvents.length,
      cancelledEvents: events.filter((row) => row.state === 'cancelled').length,
      notEnteredEvents: events.filter((row) => row.state === 'not_entered').length,
      completeOutcomes: completeOutcomes.length,
      unavailableOutcomes: unavailableOutcomes.length,
      eventState: countsBy(events, 'state'),
      strategy: countsBy(events, 'strategy'),
      direction: countsBy(events, 'direction'),
      outcomeExitReason: countsBy(completeOutcomes, 'exitReason'),
    },
    excludedDays,
    sampleGate: {
      observedCompleteTradingDays: uniqueDays,
      requiredFormalTradingDays: 120,
      shortfallTradingDays: Math.max(0, 120 - uniqueDays),
      sourceFormalResearchReady: sourceQuality?.gates?.formalResearchReady === true,
      formalResearchReady,
      engineeringValidationOnly: !formalResearchReady,
      aggregatePerformanceStatisticsSuppressed: !formalResearchReady,
    },
    lookaheadAndBoundaryAudit: {
      signalUsesCompletedBarOnly: true,
      entryUsesNextBarOpen: true,
      eventAndOutcomeRowsSeparated: true,
      sameBarDoubleTouchStopsFirst: true,
      insufficientHorizonRemainsNull: unavailableOutcomes.every((row) => row.exitPrice === null && row.grossPoints === null),
      singleActiveEventPerStrategyDirection: true,
      crossSessionAllowed: false,
      crossContractAllowed: false,
      volumeFilterApplied: false,
      errors: auditErrors,
      passed: auditErrors.length === 0,
    },
    fixedRules: PROTOCOL_RULES,
    warnings: [
      ...(uniqueDays < 120 ? [`Only ${uniqueDays} audited complete trading days are available; at least 120 are required before formal strategy research.`] : []),
      'No win rate, profit factor, expectancy, optimization, ranking or trading recommendation is authorized by this engineering run.',
      'The VWAP input is a 5-minute HLC3-by-volume approximation, not exact tick VWAP.',
      'General volume and 20-day same-time RVOL are descriptive fields only; they do not gate entries in this price-only baseline.',
      'No broker credential, order route, live execution or position-management capability is present.',
    ],
  };
  return { events, outcomes, summary };
}

function ndjson(rows) {
  return rows.length ? `${rows.map((row) => JSON.stringify(row)).join('\n')}\n` : '';
}

function atomicWrite(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content, 'utf8');
  fs.renameSync(temporary, filePath);
}

export function writeIntradayStrategyEngineeringReport(outputDir, report) {
  const files = {
    events: path.join(outputDir, 'strategy-events.ndjson'),
    outcomes: path.join(outputDir, 'strategy-outcomes.ndjson'),
    summary: path.join(outputDir, 'strategy-engineering-summary.json'),
  };
  atomicWrite(files.events, ndjson(report.events));
  atomicWrite(files.outcomes, ndjson(report.outcomes));
  atomicWrite(files.summary, `${JSON.stringify(report.summary, null, 2)}\n`);
  return files;
}

export const intradayStrategyEngineConstants = Object.freeze({
  engineVersion: ENGINE_VERSION,
  protocolVersion: PROTOCOL_VERSION,
  protocolRules: PROTOCOL_RULES,
  strategies: STRATEGIES,
  horizons: HORIZONS,
  costPoints: COST_POINTS,
});

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { predictRidge } from './intraday-factor-impact.mjs';

const TAIPEI_OFFSET = '+08:00';
const DAY_SESSION_START_MINUTES = 8 * 60 + 45;
const PREDICTION_MINUTES = 9 * 60;
const OUTCOME_MINUTES = 10 * 60;
const MONTH_CODES = Object.freeze({
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6,
  G: 7, H: 8, I: 9, J: 10, K: 11, L: 12,
});

export const FORWARD_ATTEMPT_STATUS = Object.freeze({
  ACCEPTED: 'ACCEPTED',
  REJECTED_INCOMPLETE: 'REJECTED_INCOMPLETE',
  REJECTED_DATA_QUALITY: 'REJECTED_DATA_QUALITY',
  REJECTED_OPERATIONAL: 'REJECTED_OPERATIONAL',
  CORE_FAILURE: 'CORE_FAILURE',
});

export function classifyForwardAttempt({
  accepted = false,
  reason = null,
  details = {},
} = {}) {
  if (accepted) return FORWARD_ATTEMPT_STATUS.ACCEPTED;

  if (reason === 'final_engineering_gate_failed') {
    if (details.registryAudit?.ok === false
      || Number(details.sourceAudit?.executionBoundaryErrors) > 0
      || (details.health
        && (details.health.executionAuthorized !== false
          || details.health.orderRoutesEnabled !== false))) {
      return FORWARD_ATTEMPT_STATUS.CORE_FAILURE;
    }
    if (Number(details.sourceAudit?.invalidLines) > 0
      || Number(details.sourceAudit?.hashFailures) > 0
      || Number(details.sourceAudit?.sequenceGaps) > 0
      || Number(details.sourceAudit?.duplicates) > 0
      || Number(details.sourceAudit?.txTargetWindowClockSkewEvents) > 0) {
      return FORWARD_ATTEMPT_STATUS.REJECTED_DATA_QUALITY;
    }
    if (!details.health
      || details.health.ok !== true
      || Number(details.health?.callbackErrors) > 0
      || Number(details.health?.dropped) > 0
      || Number(details.health?.writerErrors) > 0
      || details.health?.sessionDown === true) {
      return FORWARD_ATTEMPT_STATUS.REJECTED_OPERATIONAL;
    }
    if (Number(details.predictions) !== 12 || Number(details.outcomes) !== 12) {
      return FORWARD_ATTEMPT_STATUS.REJECTED_INCOMPLETE;
    }
    return FORWARD_ATTEMPT_STATUS.REJECTED_DATA_QUALITY;
  }

  if (reason === 'operations_exception') {
    const message = String(details.errorMessage ?? '');
    if (/forward_registry_invalid|frozen_(spec|models)|execution_boundary/i.test(message)) {
      return FORWARD_ATTEMPT_STATUS.CORE_FAILURE;
    }
    return FORWARD_ATTEMPT_STATUS.REJECTED_OPERATIONAL;
  }

  if ([
    'prediction_operational_health_failed',
    'outcome_operational_health_failed',
    'before_earliest_eligible_trade_date',
  ].includes(reason)) {
    return FORWARD_ATTEMPT_STATUS.REJECTED_OPERATIONAL;
  }

  if ([
    'observer_started_after_day_session_open',
    'prediction_deadline_missed',
    'opening_window_coverage_failed',
    'outcome_window_coverage_failed',
    'observer_timeout',
  ].includes(reason)) {
    return FORWARD_ATTEMPT_STATUS.REJECTED_INCOMPLETE;
  }

  return FORWARD_ATTEMPT_STATUS.REJECTED_DATA_QUALITY;
}

function finite(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function safeReturn(end, start) {
  if (!finite(end) || !finite(start) || Number(start) === 0) return null;
  return Number(end) / Number(start) - 1;
}

function sampleStandardDeviation(values) {
  const clean = values.filter(finite).map(Number);
  if (clean.length < 2) return null;
  const average = clean.reduce((sum, value) => sum + value, 0) / clean.length;
  return Math.sqrt(clean.reduce((sum, value) => sum + (value - average) ** 2, 0)
    / (clean.length - 1));
}

function clipProbability(value) {
  return Math.min(1, Math.max(0, Number(value)));
}

function withoutRecordHash(record) {
  const { recordHash: _recordHash, ...payload } = record;
  return payload;
}

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function registryRecordHash(record) {
  return sha256(JSON.stringify(withoutRecordHash(record)));
}

export function readForwardRegistry(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
}

function registryIdentity(record) {
  if (record.idempotencyKey) return record.idempotencyKey;
  return [
    record.eventType,
    record.tradeDate,
    record.modelKey,
    record.reason,
  ].filter(Boolean).join(':');
}

export function auditForwardRegistry(records) {
  const errors = [];
  const identities = new Set();
  const predictionHashes = new Set();
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    const expectedPrevious = index === 0 ? null : records[index - 1].recordHash;
    if ((record.previousRecordHash ?? null) !== expectedPrevious) {
      errors.push(`previous_hash_mismatch:${index + 1}`);
    }
    if (record.recordHash !== registryRecordHash(record)) {
      errors.push(`record_hash_mismatch:${index + 1}`);
    }
    if (index >= 2 && Number(record.registrySequence) !== index + 1) {
      errors.push(`registry_sequence_mismatch:${index + 1}`);
    }
    if (record.executionAuthorized !== false || record.researchOnly !== true) {
      errors.push(`execution_boundary_invalid:${index + 1}`);
    }
    const identity = registryIdentity(record);
    if (identity && identities.has(identity)) errors.push(`duplicate_identity:${identity}`);
    if (identity) identities.add(identity);
    if (record.eventType === 'prediction') predictionHashes.add(record.recordHash);
    if (record.eventType === 'outcome') {
      if (!predictionHashes.has(record.predictionRecordHash)) {
        errors.push(`outcome_prediction_link_missing:${record.modelKey}`);
      }
      if (!(Date.parse(record.recordedAt) >= Date.parse(record.targetAvailableAt))) {
        errors.push(`outcome_before_target_available:${record.modelKey}`);
      }
    }
    if (record.eventType === 'prediction'
      && !(Date.parse(record.recordedAt) < Date.parse(record.targetAvailableAt))) {
      errors.push(`prediction_not_before_target:${record.modelKey}`);
    }
  }
  return {
    ok: errors.length === 0,
    records: records.length,
    latestSequence: records.length,
    latestHash: records.at(-1)?.recordHash ?? null,
    errors,
    researchOnly: true,
    executionAuthorized: false,
  };
}

export function appendForwardRegistryRecord(filePath, input) {
  const records = readForwardRegistry(filePath);
  const audit = auditForwardRegistry(records);
  if (!audit.ok) throw new Error(`existing_forward_registry_invalid:${audit.errors.join(',')}`);
  const existing = input.idempotencyKey
    ? records.find((record) => record.idempotencyKey === input.idempotencyKey)
    : null;
  if (existing) return { appended: false, record: existing, audit };
  const record = {
    schemaVersion: 'v3.10-restricted-forward-registry-v1',
    ...input,
    registrySequence: records.length + 1,
    previousRecordHash: records.at(-1)?.recordHash ?? null,
    researchOnly: true,
    executionAuthorized: false,
  };
  record.recordHash = registryRecordHash(record);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  return {
    appended: true,
    record,
    audit: auditForwardRegistry([...records, record]),
  };
}

export function contractMonthFromLiveCode(code, tradeDate) {
  const match = String(code || '').match(/^TXF([A-L])(\d)$/);
  if (!match) return null;
  const tradeYear = Number(String(tradeDate).slice(0, 4));
  let year = Math.floor(tradeYear / 10) * 10 + Number(match[2]);
  if (year < tradeYear - 5) year += 10;
  if (year > tradeYear + 5) year -= 10;
  return `${year}${String(MONTH_CODES[match[1]]).padStart(2, '0')}`;
}

function openingPathEfficiency(bars) {
  const [first, second, third] = bars;
  const path = Math.abs(Number(first.close) - Number(first.open))
    + Math.abs(Number(second.close) - Number(first.close))
    + Math.abs(Number(third.close) - Number(second.close));
  return path === 0 ? 0 : Math.abs(Number(third.close) - Number(first.open)) / path;
}

export function buildForwardFeatureRow({
  tradeDate,
  liveContract,
  openingBars,
  historicalDays,
  rawFactors,
  rankHistory,
}) {
  if (!Array.isArray(openingBars) || openingBars.length !== 3) {
    throw new Error('opening_bars_incomplete');
  }
  const priorDays = [...historicalDays]
    .filter((day) => day?.session === 'day' && day?.timeframe === '5m'
      && Array.isArray(day.bars) && day.bars.length === 60 && day.tradeDate < tradeDate)
    .sort((left, right) => left.tradeDate.localeCompare(right.tradeDate));
  const previous = priorDays.at(-1);
  const priorSix = priorDays.slice(-6);
  const normalizedContract = contractMonthFromLiveCode(liveContract, tradeDate);
  const samePriorContract = Boolean(previous && normalizedContract
    && String(previous.contract) === normalizedContract);
  const sixDaySameContract = priorSix.length === 6
    && priorSix.every((day) => String(day.contract) === normalizedContract);
  const priorReturns = priorDays.slice(-20).map(
    (day) => safeReturn(day.bars.at(-1).close, day.bars[0].open),
  );
  const openingHigh = Math.max(...openingBars.map((bar) => Number(bar.high)));
  const openingLow = Math.min(...openingBars.map((bar) => Number(bar.low)));
  const anchorClose = Number(openingBars[2].close);
  const previousHigh = previous
    ? Math.max(...previous.bars.map((bar) => Number(bar.high))) : null;
  const previousLow = previous
    ? Math.min(...previous.bars.map((bar) => Number(bar.low))) : null;
  const previousRange = previousHigh === null || previousLow === null
    ? null : previousHigh - previousLow;
  const rank = (key, value) => {
    const history = rankHistory.map((row) => row[key]).filter(finite).map(Number);
    if (!finite(value) || history.length < 20) return null;
    const below = history.filter((item) => item < Number(value)).length;
    const equal = history.filter((item) => item === Number(value)).length;
    return (below + 0.5 * equal) / history.length;
  };
  const row = {
    schemaVersion: 'v3.10-restricted-forward-feature-v1',
    tradeDate,
    contract: normalizedContract,
    liveContract,
    decisionAvailableAt: `${tradeDate}T09:00:00${TAIPEI_OFFSET}`,
    factorSourceDate: rawFactors.factorSourceDate,
    gapReturn: samePriorContract
      ? safeReturn(openingBars[0].open, previous.bars.at(-1).close) : null,
    prior5dMomentum: sixDaySameContract
      ? safeReturn(priorSix.at(-1).bars.at(-1).close, priorSix[0].bars.at(-1).close)
      : null,
    openingReturn: safeReturn(anchorClose, openingBars[0].open),
    priorRv20: priorReturns.length === 20 ? sampleStandardDeviation(priorReturns) : null,
    openingRangeLocation: openingHigh === openingLow
      ? 0.5 : (anchorClose - openingLow) / (openingHigh - openingLow),
    previousSessionRange: previous && Number(previous.bars.at(-1).close) !== 0
      ? previousRange / Number(previous.bars.at(-1).close) : null,
    openingLocationPrevRange: samePriorContract && previousHigh !== previousLow
      ? (Number(openingBars[0].open) - previousLow) / (previousHigh - previousLow) : null,
    openingPathEfficiency: openingPathEfficiency(openingBars),
    termSpreadBps: rawFactors.termSpreadBps,
    skew25d: rawFactors.skew25d,
    marketOiDeltaPct: rawFactors.marketOiDeltaPct,
  };
  row.termSpreadBpsPastRank = rank('termSpreadBps', row.termSpreadBps);
  row.skew25dPastRank = rank('skew25d', row.skew25d);
  row.marketOiDeltaPctPastRank = rank('marketOiDeltaPct', row.marketOiDeltaPct);
  row.priorRv20PastRank = rank('priorRv20', row.priorRv20);
  row.h1PriceTermInteraction = finite(row.prior5dMomentum)
    && finite(row.termSpreadBpsPastRank)
    ? Number(row.prior5dMomentum) * (Number(row.termSpreadBpsPastRank) - 0.5) : null;
  row.h2VolSkewInteraction = finite(row.priorRv20PastRank) && finite(row.skew25dPastRank)
    ? Number(row.priorRv20PastRank) * Number(row.skew25dPastRank) : null;
  row.h3TrendOiInteraction = finite(row.openingReturn)
    && finite(row.marketOiDeltaPctPastRank)
    ? Math.abs(Number(row.openingReturn)) * Number(row.marketOiDeltaPctPastRank) : null;
  row.researchOnly = true;
  row.executionAuthorized = false;
  return row;
}

export function predictFrozenModels(artifact, row) {
  return artifact.models.map((model) => {
    const variants = {};
    for (const key of ['priceModel', 'factorModel', 'interactionModel']) {
      const prediction = predictRidge(model[key], row);
      if (!finite(prediction)) throw new Error(`prediction_input_missing:${model.hypothesisId}:${model.targetName}:${key}`);
      variants[key.replace('Model', '')] = clipProbability(prediction);
    }
    return {
      modelKey: `${model.hypothesisId}:${model.targetName}`,
      hypothesisId: model.hypothesisId,
      targetName: model.targetName,
      primaryTarget: model.primaryTarget,
      eventThreshold: model.eventThreshold,
      predictions: variants,
    };
  });
}

export function tickMinuteOfDay(record) {
  const time = String(record?.payload?.time || record?.payload?.datetime || '').match(
    /(?:T|\b)(\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?/,
  );
  if (!time) return null;
  return Number(time[1]) * 60 + Number(time[2]) + Number(time[3]) / 60;
}

export function isEligibleTxTick(record, tradeDate) {
  const minute = tickMinuteOfDay(record);
  return record?.kind === 'futures_tick'
    && record?.payload?._product_family === 'TX'
    && record?.payload?.date === tradeDate
    && record?.duplicate === false
    && Number(record?.sequenceGap || 0) === 0
    && record?.payload?.simtrade !== true
    && finite(record?.payload?.close)
    && finite(record?.payload?.volume)
    && finite(minute)
    && minute >= DAY_SESSION_START_MINUTES
    && minute < OUTCOME_MINUTES;
}

export function aggregateForwardBars(ticks) {
  const bars = new Map();
  for (const record of ticks) {
    const minute = tickMinuteOfDay(record);
    const index = Math.floor((minute - DAY_SESSION_START_MINUTES) / 5);
    if (index < 0 || index >= 15) continue;
    const price = Number(record.payload.close);
    const volume = Number(record.payload.volume);
    const existing = bars.get(index);
    if (!existing) {
      bars.set(index, {
        barIndex: index,
        open: price,
        high: price,
        low: price,
        close: price,
        volume,
        firstExchangeTimestamp: record.exchangeTimestamp,
        lastExchangeTimestamp: record.exchangeTimestamp,
      });
    } else {
      existing.high = Math.max(existing.high, price);
      existing.low = Math.min(existing.low, price);
      existing.close = price;
      existing.volume += volume;
      existing.lastExchangeTimestamp = record.exchangeTimestamp;
    }
  }
  return [...bars.entries()].sort((left, right) => left[0] - right[0]).map(([, bar]) => bar);
}

export function calculateForwardSeverities(bars) {
  if (!Array.isArray(bars) || bars.length < 15
    || bars.slice(0, 15).some((bar, index) => bar.barIndex !== index)) {
    throw new Error('outcome_bars_incomplete');
  }
  const anchor = Number(bars[2].close);
  const future = bars.slice(3, 15);
  const futureClose = Number(future.at(-1).close);
  const high = Math.max(...future.map((bar) => Number(bar.high)));
  const low = Math.min(...future.map((bar) => Number(bar.low)));
  let prior = anchor;
  let sumSquares = 0;
  for (const bar of future) {
    const close = Number(bar.close);
    if (!(prior > 0) || !(close > 0)) throw new Error('outcome_price_invalid');
    sumSquares += Math.log(close / prior) ** 2;
    prior = close;
  }
  const mfe = safeReturn(high, anchor);
  const mae = safeReturn(low, anchor);
  return {
    largeMove60Severity: Math.abs(safeReturn(futureClose, anchor)),
    downsideTail60Severity: Math.abs(Math.min(0, mae)),
    extremeExcursion60Severity: Math.max(Math.max(0, mfe), Math.abs(Math.min(0, mae))),
    volatilityExpansion60Severity: Math.sqrt(sumSquares),
    anchorPrice: anchor,
    targetClose: futureClose,
    targetAvailableAtExchange: bars[14].lastExchangeTimestamp,
  };
}

export function resolveFrozenOutcomes(artifact, severities) {
  return artifact.models.map((model) => {
    const severity = severities[model.severityKey];
    if (!finite(severity)) throw new Error(`outcome_severity_missing:${model.severityKey}`);
    return {
      modelKey: `${model.hypothesisId}:${model.targetName}`,
      hypothesisId: model.hypothesisId,
      targetName: model.targetName,
      severityKey: model.severityKey,
      severity,
      eventThreshold: model.eventThreshold,
      actualEvent: Number(severity) >= Number(model.eventThreshold) ? 1 : 0,
    };
  });
}

export const FORWARD_OPERATION_TIMES = Object.freeze({
  daySessionStartMinutes: DAY_SESSION_START_MINUTES,
  predictionMinutes: PREDICTION_MINUTES,
  outcomeMinutes: OUTCOME_MINUTES,
});

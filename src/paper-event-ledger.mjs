import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const PAPER_EVENT_TYPES = Object.freeze(['candidate', 'trigger', 'cancel', 'exit', 'outcome']);

export const PAPER_EVENT_SPECIFICATION = Object.freeze({
  schemaVersion: '3.8.0-paper-event-v1',
  version: 'v3.8.0-paper-ledger.1',
  protocolReference: 'V3_8_0_FROZEN_INTRADAY_PROTOCOL.md',
  product: 'TX',
  timeframe: '5m',
  allowedSources: ['historical_replay'],
  allowedSetupKeys: [
    'opening_range_breakout',
    'vwap_pullback_continuation',
    'opening_range_false_break_reversion',
  ],
  costAssumptions: {
    unit: 'index_points',
    roundTripScenariosPoints: [4, 8, 16],
    totalRoundTripPoints: 8,
    status: 'frozen_research_placeholder_until_broker_fee_is_confirmed',
  },
  horizonsMinutes: [30, 60, 120],
  stopR: 1,
  targetR: 1.5,
  entryRule: 'completed_signal_bar_then_next_bar_open',
  sameBarDoubleTouchRule: 'stop_first_conservative',
  crossSessionAllowed: false,
  researchOnly: true,
  executionAuthorized: false,
});

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

function hash(value) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

function withoutRecordHash(record) {
  const { recordHash: _recordHash, ...body } = record;
  return body;
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function positive(value) {
  return finite(value) && Number(value) > 0;
}

function timestamp(value) {
  const parsed = Date.parse(value);
  return Number.isNaN(parsed) ? null : parsed;
}

function requireText(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function assertTransition(eventType, prior) {
  if (!prior) {
    if (eventType !== 'candidate') throw new Error('PAPER_EVENT_CANDIDATE_REQUIRED');
    return;
  }
  const allowed = {
    candidate: new Set(['trigger', 'cancel']),
    trigger: new Set(['exit']),
    exit: new Set(['outcome']),
    cancel: new Set(),
    outcome: new Set(),
  };
  if (!allowed[prior.eventType]?.has(eventType)) throw new Error('PAPER_EVENT_TRANSITION_INVALID');
}

export function paperSpecificationHash(specification = PAPER_EVENT_SPECIFICATION) {
  return hash(specification);
}

export function paperCostAssumptionHash(specification = PAPER_EVENT_SPECIFICATION) {
  return hash(specification.costAssumptions);
}

export function readPaperEventLedger(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function loadOfficialReplayEvidence(archiveDir, { tradeDate, session, cursor }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('PAPER_EVENT_TRADE_DATE_INVALID');
  if (!['day', 'night'].includes(session)) throw new Error('PAPER_EVENT_SESSION_INVALID');
  const sourcePath = path.join(archiveDir, `${tradeDate}-${session}.json`);
  const auditPath = path.join(archiveDir, `${tradeDate}-audit.json`);
  if (!fs.existsSync(sourcePath)) throw new Error('PAPER_EVENT_REPLAY_SOURCE_MISSING');
  if (!fs.existsSync(auditPath)) throw new Error('PAPER_EVENT_AUDIT_MISSING');
  const source = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));
  const audit = JSON.parse(fs.readFileSync(auditPath, 'utf8'));
  const selectedCursor = Number.parseInt(cursor, 10);
  if (!Number.isInteger(selectedCursor) || selectedCursor < 1 || selectedCursor > (source.bars?.length || 0)) {
    throw new Error('PAPER_EVENT_CURSOR_INVALID');
  }
  return { source, audit, cursor: selectedCursor, observedThrough: source.bars[selectedCursor - 1]?.timestamp || null };
}

export function validatePaperEvidence(input, evidence, now = new Date()) {
  if (!evidence?.source || !evidence?.audit) throw new Error('PAPER_EVENT_EVIDENCE_REQUIRED');
  const { source, audit } = evidence;
  if (input.executionAuthorized === true || source.executionAuthorized === true || audit.executionAuthorized !== false) {
    throw new Error('PAPER_EVENT_EXECUTION_FORBIDDEN');
  }
  if (input.mock === true || input.dataMode === 'mock' || source.source === 'mock' || source.mock === true) {
    throw new Error('PAPER_EVENT_MOCK_FORBIDDEN');
  }
  if (!PAPER_EVENT_SPECIFICATION.allowedSources.includes(source.source)) throw new Error('PAPER_EVENT_SOURCE_NOT_ALLOWED');
  if (!String(audit.state || '').startsWith('passed')) throw new Error('PAPER_EVENT_AUDIT_NOT_PASSED');
  if (source.product !== PAPER_EVENT_SPECIFICATION.product || source.timeframe !== PAPER_EVENT_SPECIFICATION.timeframe) {
    throw new Error('PAPER_EVENT_SOURCE_SCOPE_INVALID');
  }
  if (source.tradeDate !== input.tradeDate || audit.tradeDate !== input.tradeDate) throw new Error('PAPER_EVENT_EVIDENCE_DATE_MISMATCH');
  if (source.contract !== input.contract || audit.contract !== input.contract) throw new Error('PAPER_EVENT_EVIDENCE_CONTRACT_MISMATCH');
  if (source.session !== input.session) throw new Error('PAPER_EVENT_EVIDENCE_SESSION_MISMATCH');
  if (!Number.isInteger(evidence.cursor) || evidence.cursor < 1 || evidence.cursor > (source.bars?.length || 0)) {
    throw new Error('PAPER_EVENT_CURSOR_INVALID');
  }
  const observedThrough = source.bars[evidence.cursor - 1]?.timestamp;
  const virtualMs = timestamp(input.virtualTime);
  const observedMs = timestamp(observedThrough);
  if (virtualMs === null) throw new Error('PAPER_EVENT_VIRTUAL_TIME_INVALID');
  if (observedMs === null) throw new Error('PAPER_EVENT_OBSERVED_TIME_INVALID');
  if (virtualMs !== observedMs) throw new Error('PAPER_EVENT_VIRTUAL_TIME_MUST_MATCH_CURSOR');
  if (virtualMs > now.getTime()) throw new Error('PAPER_EVENT_FUTURE_TIME_FORBIDDEN');
  return {
    source: source.source,
    provider: source.provider || null,
    auditState: audit.state,
    auditExecutionAuthorized: false,
    auditGeneratedAt: audit.generatedAt || null,
    auditHash: hash(audit),
    sourceHash: hash(source),
    cursor: evidence.cursor,
    observedThrough,
    totalBars: source.bars.length,
  };
}

function validateCandidateInput(input, specification) {
  if (!specification.allowedSetupKeys.includes(input.setupKey)) throw new Error('PAPER_EVENT_SETUP_NOT_FROZEN');
  if (!['long', 'short'].includes(input.direction)) throw new Error('PAPER_EVENT_DIRECTION_INVALID');
  requireText(input.thesis, 'PAPER_EVENT_THESIS_REQUIRED');
  requireText(input.triggerCondition, 'PAPER_EVENT_TRIGGER_CONDITION_REQUIRED');
  requireText(input.invalidationCondition, 'PAPER_EVENT_INVALIDATION_CONDITION_REQUIRED');
  if (!positive(input.intendedStopPoints)) throw new Error('PAPER_EVENT_STOP_POINTS_INVALID');
  if (Number(input.intendedTargetR) !== Number(specification.targetR)) throw new Error('PAPER_EVENT_TARGET_R_NOT_FROZEN');
  if (!specification.horizonsMinutes.includes(Number(input.horizonMinutes))) throw new Error('PAPER_EVENT_HORIZON_NOT_FROZEN');
}

function validatePricePlan(input, direction, specification) {
  if (![input.entryPrice, input.stopPrice, input.targetPrice].every(positive)) throw new Error('PAPER_EVENT_TRIGGER_PRICE_INVALID');
  const entry = Number(input.entryPrice);
  const stop = Number(input.stopPrice);
  const target = Number(input.targetPrice);
  if (direction === 'long' && !(stop < entry && target > entry)) throw new Error('PAPER_EVENT_LONG_PRICE_PLAN_INVALID');
  if (direction === 'short' && !(stop > entry && target < entry)) throw new Error('PAPER_EVENT_SHORT_PRICE_PLAN_INVALID');
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (Math.abs(reward / risk - specification.targetR) > 1e-10) throw new Error('PAPER_EVENT_REWARD_RISK_NOT_FROZEN');
}

function outcomeFields(input, candidateEvents, specification, evidence) {
  const candidate = candidateEvents[0];
  const trigger = candidateEvents.find((row) => row.eventType === 'trigger');
  const exit = candidateEvents.find((row) => row.eventType === 'exit');
  if (!trigger || !exit) throw new Error('PAPER_EVENT_OUTCOME_PATH_INCOMPLETE');
  const entry = Number(trigger.entryPrice);
  const exitPrice = Number(exit.exitPrice);
  const firstBarIndex = Number(trigger.dataEvidence?.cursor) - 1;
  const lastBarIndex = Number(exit.dataEvidence?.cursor) - 1;
  const pathBars = evidence.source?.bars?.slice(firstBarIndex, lastBarIndex + 1) || [];
  if (!pathBars.length || pathBars.some((bar) => !positive(bar.high) || !positive(bar.low))) throw new Error('PAPER_EVENT_OUTCOME_RANGE_INVALID');
  const high = Math.max(...pathBars.map((bar) => Number(bar.high)));
  const low = Math.min(...pathBars.map((bar) => Number(bar.low)));
  if (high < Math.max(entry, exitPrice) || low > Math.min(entry, exitPrice) || high < low) {
    throw new Error('PAPER_EVENT_OUTCOME_OHLC_INVALID');
  }
  const directionSign = candidate.direction === 'long' ? 1 : -1;
  const grossPoints = directionSign * (exitPrice - entry);
  // Excursions are measured from entry and include zero: a path that never
  // trades adversely has MAE 0, not a positive MAE; likewise MFE cannot be
  // negative merely because every observed price stayed on the losing side.
  const mfePoints = Math.max(0, candidate.direction === 'long' ? high - entry : entry - low);
  const maePoints = Math.min(0, candidate.direction === 'long' ? low - entry : entry - high);
  const costPoints = Number(specification.costAssumptions.totalRoundTripPoints);
  const stopRiskPoints = Math.abs(entry - Number(trigger.stopPrice));
  const bothTouched = pathBars.some((bar) => Number(bar.high) >= Math.max(Number(trigger.stopPrice), Number(trigger.targetPrice))
    && Number(bar.low) <= Math.min(Number(trigger.stopPrice), Number(trigger.targetPrice)));
  if (bothTouched && (exitPrice !== Number(trigger.stopPrice) || exit.exitReason !== 'same_bar_double_touch_stop_first')) {
    throw new Error('PAPER_EVENT_SAME_BAR_DOUBLE_TOUCH_MUST_STOP');
  }
  return {
    pathHigh: high,
    pathLow: low,
    grossPoints,
    costPoints,
    netPoints: grossPoints - costPoints,
    netPointsByCost: Object.fromEntries(specification.costAssumptions.roundTripScenariosPoints.map((cost) => [String(cost), grossPoints - Number(cost)])),
    maePoints,
    mfePoints,
    netR: stopRiskPoints > 0 ? (grossPoints - costPoints) / stopRiskPoints : null,
    sameBarDoubleTouch: bothTouched,
  };
}

export function createPaperEvent(input, evidence, existingRecords = [], { now = new Date(), specification = PAPER_EVENT_SPECIFICATION } = {}) {
  if (!PAPER_EVENT_TYPES.includes(input?.eventType)) throw new Error('PAPER_EVENT_TYPE_INVALID');
  const candidateId = requireText(input.candidateId, 'PAPER_EVENT_CANDIDATE_ID_REQUIRED');
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{2,79}$/.test(candidateId)) throw new Error('PAPER_EVENT_CANDIDATE_ID_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate || '')) throw new Error('PAPER_EVENT_TRADE_DATE_INVALID');
  if (!/^[0-9]{6}$/.test(input.contract || '')) throw new Error('PAPER_EVENT_CONTRACT_INVALID');
  if (!['day', 'night'].includes(input.session)) throw new Error('PAPER_EVENT_SESSION_INVALID');
  if (input.executionAuthorized === true) throw new Error('PAPER_EVENT_EXECUTION_FORBIDDEN');

  const existingAudit = auditPaperEventLedger(existingRecords, { now, specification });
  if (!existingAudit.ok) throw new Error(`PAPER_EVENT_EXISTING_LEDGER_INVALID:${existingAudit.errors.join(',')}`);
  const candidateEvents = existingRecords.filter((row) => row.candidateId === candidateId);
  const prior = candidateEvents.at(-1) || null;
  assertTransition(input.eventType, prior);
  if (prior) {
    for (const field of ['tradeDate', 'contract', 'session']) {
      if (input[field] !== prior[field]) throw new Error(`PAPER_EVENT_${field.toUpperCase()}_CHANGED`);
    }
    if (timestamp(input.virtualTime) < timestamp(prior.virtualTime)) throw new Error('PAPER_EVENT_VIRTUAL_TIME_REVERSED');
  }
  const dataEvidence = validatePaperEvidence(input, evidence, now);
  const candidate = candidateEvents[0] || input;
  let detail = {};
  if (input.eventType === 'candidate') {
    validateCandidateInput(input, specification);
    detail = {
      setupKey: input.setupKey,
      direction: input.direction,
      thesis: input.thesis.trim(),
      triggerCondition: input.triggerCondition.trim(),
      invalidationCondition: input.invalidationCondition.trim(),
      intendedStopPoints: Number(input.intendedStopPoints),
      intendedTargetR: Number(input.intendedTargetR),
    };
  } else if (input.eventType === 'trigger') {
    validatePricePlan(input, candidate.direction, specification);
    if (Number(evidence.cursor) !== Number(prior.dataEvidence?.cursor) + 1) throw new Error('PAPER_EVENT_TRIGGER_MUST_USE_NEXT_BAR');
    const nextOpen = Number(evidence.source?.bars?.[evidence.cursor - 1]?.open);
    if (!finite(nextOpen) || Number(input.entryPrice) !== nextOpen) throw new Error('PAPER_EVENT_ENTRY_MUST_EQUAL_NEXT_BAR_OPEN');
    detail = { entryPrice: Number(input.entryPrice), stopPrice: Number(input.stopPrice), targetPrice: Number(input.targetPrice) };
  } else if (input.eventType === 'cancel') {
    detail = { cancelReason: requireText(input.cancelReason, 'PAPER_EVENT_CANCEL_REASON_REQUIRED') };
  } else if (input.eventType === 'exit') {
    if (!positive(input.exitPrice)) throw new Error('PAPER_EVENT_EXIT_PRICE_INVALID');
    detail = { exitPrice: Number(input.exitPrice), exitReason: requireText(input.exitReason, 'PAPER_EVENT_EXIT_REASON_REQUIRED') };
  } else {
    detail = { ...outcomeFields(input, candidateEvents, specification, evidence), outcomeNote: typeof input.outcomeNote === 'string' ? input.outcomeNote.trim() : '' };
  }

  const previousRecordHash = existingRecords.at(-1)?.recordHash || null;
  const record = {
    schemaVersion: specification.schemaVersion,
    specificationVersion: specification.version,
    protocolReference: specification.protocolReference,
    specificationHash: paperSpecificationHash(specification),
    costAssumptionHash: paperCostAssumptionHash(specification),
    eventId: `${candidateId}:${candidateEvents.length + 1}`,
    candidateId,
    sequence: candidateEvents.length + 1,
    eventType: input.eventType,
    recordedAt: now.toISOString(),
    tradeDate: input.tradeDate,
    contract: input.contract,
    session: input.session,
    virtualTime: input.virtualTime,
    setupKey: candidate.setupKey,
    direction: candidate.direction,
    horizonMinutes: Number(candidate.horizonMinutes),
    costAssumptions: specification.costAssumptions,
    dataEvidence,
    ...detail,
    previousRecordHash,
    researchOnly: true,
    executionAuthorized: false,
  };
  record.recordHash = hash(record);
  return record;
}

export function auditPaperEventLedger(records, { now = new Date(), specification = PAPER_EVENT_SPECIFICATION } = {}) {
  const errors = [];
  const priorByCandidate = new Map();
  const expectedSpecHash = paperSpecificationHash(specification);
  const expectedCostHash = paperCostAssumptionHash(specification);
  let previousRecordHash = null;
  for (const [index, record] of records.entries()) {
    const prefix = `row_${index + 1}`;
    if (record.specificationHash !== expectedSpecHash) errors.push(`${prefix}_specification_hash_mismatch`);
    if (record.costAssumptionHash !== expectedCostHash || hash(record.costAssumptions) !== expectedCostHash) errors.push(`${prefix}_cost_hash_mismatch`);
    if (record.previousRecordHash !== previousRecordHash) errors.push(`${prefix}_chain_previous_mismatch`);
    if (record.recordHash !== hash(withoutRecordHash(record))) errors.push(`${prefix}_record_hash_mismatch`);
    if (record.executionAuthorized !== false) errors.push(`${prefix}_execution_forbidden`);
    if (record.researchOnly !== true) errors.push(`${prefix}_research_only_missing`);
    if (record.dataEvidence?.source === 'mock' || !specification.allowedSources.includes(record.dataEvidence?.source)) errors.push(`${prefix}_source_forbidden`);
    if (!String(record.dataEvidence?.auditState || '').startsWith('passed')) errors.push(`${prefix}_audit_not_passed`);
    if (record.dataEvidence?.auditExecutionAuthorized !== false) errors.push(`${prefix}_audit_execution_boundary_missing`);
    const virtualMs = timestamp(record.virtualTime);
    const observedMs = timestamp(record.dataEvidence?.observedThrough);
    if (virtualMs === null || observedMs === null || virtualMs !== observedMs) errors.push(`${prefix}_virtual_clock_invalid`);
    if (virtualMs !== null && virtualMs > now.getTime()) errors.push(`${prefix}_future_time_forbidden`);
    const prior = priorByCandidate.get(record.candidateId) || null;
    try { assertTransition(record.eventType, prior); } catch { errors.push(`${prefix}_transition_invalid`); }
    if (prior && record.sequence !== prior.sequence + 1) errors.push(`${prefix}_sequence_invalid`);
    if (!prior && record.sequence !== 1) errors.push(`${prefix}_sequence_invalid`);
    if (prior && timestamp(record.virtualTime) < timestamp(prior.virtualTime)) errors.push(`${prefix}_virtual_time_reversed`);
    if (record.eventType === 'outcome') {
      if (!finite(record.maePoints) || Number(record.maePoints) > 0) errors.push(`${prefix}_mae_invalid`);
      if (!finite(record.mfePoints) || Number(record.mfePoints) < 0) errors.push(`${prefix}_mfe_invalid`);
      if (![record.grossPoints, record.costPoints, record.netPoints].every(finite)) errors.push(`${prefix}_outcome_metrics_missing`);
    }
    priorByCandidate.set(record.candidateId, record);
    previousRecordHash = record.recordHash;
  }
  return { ok: errors.length === 0, records: records.length, candidates: priorByCandidate.size, errors: [...new Set(errors)] };
}

export function appendPaperEvent(filePath, input, evidence, options = {}) {
  const existing = readPaperEventLedger(filePath);
  const record = createPaperEvent(input, evidence, existing, options);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(record)}\n`, { encoding: 'utf8', flag: 'a' });
  return { appended: 1, total: existing.length + 1, record };
}

import fs from 'node:fs';
import path from 'node:path';
import {
  appendForwardShadowRecord,
  auditForwardShadowLedger,
  createMissedSessionRecord,
  createOutcomeRecord,
  createStateRecord,
  digest,
  stableJson,
  stableJsonLine,
  validateCollectorMode,
} from './market-state-forward-shadow.mjs';
import { evaluatePremarketMarketState } from './market-state-v1.mjs';

const AUTHORIZATION = Object.freeze({ formalWeight: 0, researchOnly: true, executionAuthorized: false });
const REQUIRED_LAYOUT = Object.freeze(['official-records', 'outcomes', 'checksums', 'daily-status', 'logs']);

function parseTimestamp(value, code) {
  const parsed = Date.parse(value);
  if (!value || Number.isNaN(parsed)) throw new Error(code);
  return parsed;
}

function validateRuntimeRoot(runtimeRoot) {
  const resolved = path.resolve(runtimeRoot || '');
  if (/^[cC]:[\\/]/.test(resolved)) throw new Error('FORWARD_SHADOW_C_DRIVE_RUNTIME_FORBIDDEN');
  if (!/^[dD]:[\\/]/.test(resolved)) throw new Error('FORWARD_SHADOW_PRIMARY_STORAGE_MUST_BE_D_DRIVE');
  const normalized = resolved.replaceAll('/', '\\').toLowerCase();
  if (!normalized.includes('\\data\\market-state\\forward-shadow')) {
    throw new Error('FORWARD_SHADOW_RUNTIME_ROOT_OUTSIDE_GOVERNED_PATH');
  }
  return resolved;
}

function validateRunId(runId) {
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(runId || '')) throw new Error('FORWARD_SHADOW_RUN_ID_INVALID');
  return runId;
}

export function runtimePaths(runtimeRoot, runId) {
  const root = path.join(validateRuntimeRoot(runtimeRoot), validateRunId(runId));
  return Object.freeze({
    root,
    candidateManifest: path.join(root, 'launch-manifest-candidate.json'),
    candidateLedger: path.join(root, 'candidate-ledger.ndjson'),
    lock: path.join(root, '.observer.lock'),
    officialRecords: path.join(root, 'official-records'),
    outcomes: path.join(root, 'outcomes'),
    checksums: path.join(root, 'checksums'),
    dailyStatus: path.join(root, 'daily-status'),
    logs: path.join(root, 'logs'),
  });
}

export function ensureRuntimeLayout(runtimeRoot, runId) {
  const paths = runtimePaths(runtimeRoot, runId);
  fs.mkdirSync(paths.root, { recursive: true });
  for (const directory of REQUIRED_LAYOUT) fs.mkdirSync(path.join(paths.root, directory), { recursive: true });
  return paths;
}

export function readForwardShadowLedger(ledgerPath) {
  if (!fs.existsSync(ledgerPath)) return [];
  const body = fs.readFileSync(ledgerPath, 'utf8');
  if (!body.trim()) return [];
  const records = body.trimEnd().split(/\r?\n/).map((line) => JSON.parse(line));
  const audit = auditForwardShadowLedger(records);
  if (!audit.ok) throw new Error(`FORWARD_SHADOW_LEDGER_INVALID:${audit.errors.join(',')}`);
  return records;
}

function withObserverLock(paths, operation) {
  let handle;
  try {
    handle = fs.openSync(paths.lock, 'wx');
  } catch (error) {
    if (error?.code === 'EEXIST') throw new Error('FORWARD_SHADOW_DUPLICATE_START');
    throw error;
  }
  try {
    return operation();
  } finally {
    fs.closeSync(handle);
    fs.unlinkSync(paths.lock);
  }
}

function appendCandidateRecord(paths, record, existingRecords) {
  const duplicate = existingRecords.find((item) => item.idempotencyKey === record.idempotencyKey);
  if (duplicate) {
    if (duplicate.recordHash !== record.recordHash) throw new Error('FORWARD_SHADOW_IDEMPOTENCY_CONFLICT');
    return { record: duplicate, writeStatus: 'UNCHANGED', ledgerHash: auditForwardShadowLedger(existingRecords).ledgerHash };
  }
  const next = appendForwardShadowRecord(existingRecords, record);
  fs.appendFileSync(paths.candidateLedger, stableJsonLine(record), { encoding: 'utf8' });
  const audit = auditForwardShadowLedger(readForwardShadowLedger(paths.candidateLedger));
  if (!audit.ok) throw new Error('FORWARD_SHADOW_POST_APPEND_AUDIT_FAILED');
  const ledgerChecksum = digest(fs.readFileSync(paths.candidateLedger));
  const checksumPath = path.join(paths.checksums, `${String(record.sequence).padStart(6, '0')}-${record.recordHash}.json`);
  fs.writeFileSync(checksumPath, stableJson({
    schemaVersion: 'market-state-forward-shadow-checksum-v1',
    sequence: record.sequence,
    recordHash: record.recordHash,
    ledgerHash: audit.ledgerHash,
    ledgerChecksum,
    officialEvidenceWritten: false,
    executionAuthorized: false,
  }), { encoding: 'utf8', flag: 'wx' });
  return { record, writeStatus: 'APPENDED', ledgerHash: audit.ledgerHash, ledgerChecksum, records: next };
}

function writeStatus(paths, tradeDate, payload) {
  const target = path.join(paths.dailyStatus, `${tradeDate}.json`);
  const content = stableJson(payload);
  if (fs.existsSync(target)) {
    const existing = fs.readFileSync(target, 'utf8');
    if (existing !== content) throw new Error('FORWARD_SHADOW_DAILY_STATUS_CONFLICT');
    return 'UNCHANGED';
  }
  fs.writeFileSync(target, content, { encoding: 'utf8', flag: 'wx' });
  return 'CREATED';
}

function authorization(input = {}) {
  if (input.executionAuthorized !== false || input.researchOnly !== true || input.formalWeight !== 0) {
    throw new Error('FORWARD_SHADOW_AUTHORIZATION_BOUNDARY');
  }
  return AUTHORIZATION;
}

function stateSnapshot(evaluation) {
  return {
    trend: evaluation.state.trend,
    direction: evaluation.state.direction,
    volatility: evaluation.state.volatility,
    globalAlignment: evaluation.state.globalAlignment,
    riskResearchContext: evaluation.riskResearchContext,
  };
}

export function runDailyStatePhase(input) {
  const collector = validateCollectorMode(input.mode);
  authorization(input);
  if (input.mode === 'NOT_ACTIVE') {
    return { status: 'NOT_ACTIVE', collector, officialEvidenceWritten: false, executionAuthorized: false };
  }
  const paths = ensureRuntimeLayout(input.runtimeRoot, input.runId);
  return withObserverLock(paths, () => {
    const records = readForwardShadowLedger(paths.candidateLedger);
    const priorOfficial = records.find((record) => ['STATE', 'SESSION_STATUS'].includes(record.recordType)
      && record.tradeDate === input.tradeDate);
    if (priorOfficial) {
      return {
        status: 'UNCHANGED',
        record: priorOfficial,
        ledgerHash: auditForwardShadowLedger(records).ledgerHash,
        officialEvidenceWritten: false,
        executionAuthorized: false,
      };
    }
    if (input.officialTradingDay !== true) {
      return { status: 'NON_TRADING_DAY', officialEvidenceWritten: false, executionAuthorized: false };
    }
    const now = parseTimestamp(input.now, 'FORWARD_SHADOW_NOW_INVALID');
    const observationStart = parseTimestamp(input.outcomeObservationStartAt, 'FORWARD_SHADOW_OBSERVATION_START_INVALID');
    let record;
    let lifecycle;
    if (now >= observationStart || (!input.marketStateInput && !input.marketStateEvaluation)) {
      record = createMissedSessionRecord({
        tradeDate: input.tradeDate,
        sessionId: input.sessionId,
        scheduledAt: input.scheduledAt,
        recordedAt: input.now,
        missedReason: now >= observationStart ? 'LATE_START_AFTER_OBSERVATION' : 'NO_LEGAL_PREMARKET_SNAPSHOT',
        ...AUTHORIZATION,
      }, records);
      lifecycle = ['PRECHECK', 'TRADING_DAY_CHECK', 'INPUT_AVAILABILITY_CHECK', 'APPEND_SESSION_STATUS'];
    } else {
      const evaluation = input.marketStateEvaluation || evaluatePremarketMarketState(input.marketStateInput);
      const decisionAt = input.marketStateEvaluation?.decisionAt || input.marketStateInput.decisionAt;
      const qualityStatus = input.qualityStatus || 'CLEAN';
      record = createStateRecord({
        tradeDate: input.tradeDate,
        sessionId: input.sessionId,
        decisionAt,
        availableAt: input.availableAt,
        recordedAt: input.now,
        outcomeObservationStartAt: input.outcomeObservationStartAt,
        evaluator: input.evaluator,
        axisStateSnapshot: stateSnapshot(evaluation),
        selectedShadowAxes: ['direction', 'globalAlignment'],
        evidenceLineage: input.evidenceLineage || [],
        sourceTimestamps: input.sourceTimestamps || {},
        sourceHashes: input.sourceHashes || {},
        qualityStatus,
        unavailableReason: qualityStatus === 'CLEAN' ? null : input.unavailableReason,
        ...AUTHORIZATION,
      }, records);
      lifecycle = ['PRECHECK', 'TRADING_DAY_CHECK', 'INPUT_AVAILABILITY_CHECK', 'MARKET_STATE_EVALUATION', 'LEGAL_FREEZE', 'APPEND_STATE'];
    }
    const appended = appendCandidateRecord(paths, record, records);
    const status = {
      schemaVersion: 'market-state-forward-shadow-daily-status-v1',
      tradeDate: input.tradeDate,
      mode: input.mode,
      lifecycle,
      recordType: record.recordType,
      qualityStatus: record.qualityStatus,
      writeStatus: appended.writeStatus,
      ledgerHash: appended.ledgerHash,
      collectorActive: false,
      officialEvidenceWritten: false,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    };
    writeStatus(paths, input.tradeDate, status);
    return { status: 'STATE_PHASE_COMPLETE', paths, record, dailyStatus: status, ...appended, officialEvidenceWritten: false, executionAuthorized: false };
  });
}

export function runDailyOutcomePhase(input) {
  validateCollectorMode(input.mode);
  authorization(input);
  if (input.mode === 'NOT_ACTIVE') return { status: 'NOT_ACTIVE', officialEvidenceWritten: false, executionAuthorized: false };
  const paths = ensureRuntimeLayout(input.runtimeRoot, input.runId);
  return withObserverLock(paths, () => {
    const records = readForwardShadowLedger(paths.candidateLedger);
    const state = records.find((record) => record.recordType === 'STATE' && record.tradeDate === input.tradeDate);
    if (!state) throw new Error('FORWARD_SHADOW_STATE_RECORD_NOT_FOUND');
    const prior = records.find((record) => record.recordType === 'OUTCOME' && record.stateRecordHash === state.recordHash);
    if (prior) return { status: 'UNCHANGED', record: prior, ledgerHash: auditForwardShadowLedger(records).ledgerHash, officialEvidenceWritten: false, executionAuthorized: false };
    const outcome = createOutcomeRecord({ ...input.outcome, stateRecordHash: state.recordHash, ...AUTHORIZATION }, records);
    const appended = appendCandidateRecord(paths, outcome, records);
    const outcomePath = path.join(paths.outcomes, `${input.tradeDate}.json`);
    const body = stableJson(outcome);
    if (fs.existsSync(outcomePath) && fs.readFileSync(outcomePath, 'utf8') !== body) throw new Error('FORWARD_SHADOW_OUTCOME_FILE_CONFLICT');
    if (!fs.existsSync(outcomePath)) fs.writeFileSync(outcomePath, body, { encoding: 'utf8', flag: 'wx' });
    return { status: 'OUTCOME_PHASE_COMPLETE', paths, record: outcome, ...appended, officialEvidenceWritten: false, executionAuthorized: false };
  });
}

export function verifyRuntimeEvidence(runtimeRoot, runId) {
  const paths = runtimePaths(runtimeRoot, runId);
  const records = readForwardShadowLedger(paths.candidateLedger);
  const audit = auditForwardShadowLedger(records);
  return {
    ...audit,
    runId,
    runtimeRoot: paths.root,
    ledgerChecksum: fs.existsSync(paths.candidateLedger) ? digest(fs.readFileSync(paths.candidateLedger)) : null,
    officialEvidenceWritten: false,
    executionAuthorized: false,
  };
}

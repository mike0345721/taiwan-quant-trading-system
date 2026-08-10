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
  validateOwnerLaunchApprovalArtifact,
  validateReadyForLaunchManifest,
  validateCollectorMode,
} from './market-state-forward-shadow.mjs';
import { evaluatePremarketMarketState } from './market-state-v1.mjs';
import { replicateOperationalSecondCopy, writeImmutableLaunchManifest } from './market-state-forward-shadow-backup.mjs';

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
    officialLedger: path.join(root, 'official-ledger.ndjson'),
    launchManifest: path.join(root, 'launch-manifest.json'),
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

function appendRuntimeRecord(paths, ledgerPath, record, existingRecords, evidenceClass, governance = {}) {
  const duplicate = existingRecords.find((item) => item.idempotencyKey === record.idempotencyKey);
  if (duplicate) {
    if (duplicate.recordHash !== record.recordHash) throw new Error('FORWARD_SHADOW_IDEMPOTENCY_CONFLICT');
    return { record: duplicate, writeStatus: 'UNCHANGED', ledgerHash: auditForwardShadowLedger(existingRecords).ledgerHash };
  }
  const next = appendForwardShadowRecord(existingRecords, record);
  fs.appendFileSync(ledgerPath, stableJsonLine(record), { encoding: 'utf8' });
  const audit = auditForwardShadowLedger(readForwardShadowLedger(ledgerPath));
  if (!audit.ok) throw new Error('FORWARD_SHADOW_POST_APPEND_AUDIT_FAILED');
  const ledgerChecksum = digest(fs.readFileSync(ledgerPath));
  const checksumPath = path.join(paths.checksums, `${evidenceClass.toLowerCase()}-${String(record.sequence).padStart(6, '0')}-${record.recordHash}.json`);
  fs.writeFileSync(checksumPath, stableJson({
    schemaVersion: 'market-state-forward-shadow-checksum-v1',
    sequence: record.sequence,
    recordHash: record.recordHash,
    ledgerHash: audit.ledgerHash,
    ledgerChecksum,
    evidenceClass,
    officialEvidenceWritten: evidenceClass === 'OFFICIAL_FORWARD',
    executionAuthorized: false,
  }), { encoding: 'utf8', flag: 'wx' });
  if (evidenceClass === 'OFFICIAL_FORWARD') {
    const officialPath = path.join(paths.officialRecords, `${String(record.sequence).padStart(6, '0')}-${record.tradeDate}-${record.recordType.toLowerCase()}.json`);
    fs.writeFileSync(officialPath, stableJson({
      schemaVersion: 'market-state-forward-shadow-official-record-envelope-v1',
      evidenceClass,
      manifestHash: governance.manifestHash,
      approvalArtifactHash: governance.approvalArtifactHash,
      record,
      officialEvidenceWritten: true,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    }), { encoding: 'utf8', flag: 'wx' });
  }
  return { record, writeStatus: 'APPENDED', ledgerHash: audit.ledgerHash, ledgerChecksum, records: next };
}

function writeStatus(paths, tradeDate, evidenceClass, phase, payload) {
  const target = path.join(paths.dailyStatus, `${evidenceClass.toLowerCase()}-${tradeDate}-${phase.toLowerCase()}.json`);
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

function assertPriorStateCompatible(input, prior) {
  if (prior.recordType !== 'STATE' || (!input.marketStateInput && !input.marketStateEvaluation)) return;
  const evaluation = input.marketStateEvaluation || evaluatePremarketMarketState(input.marketStateInput);
  const proposed = {
    decisionAt: input.marketStateEvaluation?.decisionAt || input.marketStateInput.decisionAt,
    availableAt: input.availableAt,
    outcomeObservationStartAt: input.outcomeObservationStartAt,
    evaluator: input.evaluator,
    axisStateSnapshot: stateSnapshot(evaluation),
    evidenceLineage: input.evidenceLineage || [],
    sourceHashes: input.sourceHashes || {},
    qualityStatus: input.qualityStatus || 'CLEAN',
    unavailableReason: (input.qualityStatus || 'CLEAN') === 'CLEAN' ? null : input.unavailableReason,
  };
  const existing = Object.fromEntries(Object.keys(proposed).map((key) => [key, prior[key]]));
  if (digest(proposed) !== digest(existing)) throw new Error('FORWARD_SHADOW_DUPLICATE_OFFICIAL_TRADE_DATE_CONFLICT');
}

function samePath(left, right) {
  return path.resolve(left).replaceAll('/', '\\').toLowerCase() === path.resolve(right).replaceAll('/', '\\').toLowerCase();
}

export function validateOfficialLaunchContext(input, paths = runtimePaths(input.runtimeRoot, input.runId)) {
  if (!input.launchManifest || !input.ownerApprovalArtifact) throw new Error('FORWARD_SHADOW_OWNER_APPROVAL_REQUIRED');
  validateReadyForLaunchManifest(input.launchManifest);
  validateOwnerLaunchApprovalArtifact(input.ownerApprovalArtifact, input.launchManifest);
  if (input.currentMainCommit !== input.launchManifest.finalMainCommit) throw new Error('FORWARD_SHADOW_FINAL_MAIN_COMMIT_MISMATCH');
  if (input.runId !== input.launchManifest.runId || !samePath(paths.root, input.launchManifest.runtimeRoot)) {
    throw new Error('FORWARD_SHADOW_RUNTIME_IDENTITY_MISMATCH');
  }
  if (input.secondaryBackupRoot && !samePath(input.secondaryBackupRoot, input.launchManifest.secondaryBackupRoot)) {
    throw new Error('FORWARD_SHADOW_SECONDARY_BACKUP_ROOT_MISMATCH');
  }
  if ((input.tradeDate || '').localeCompare(input.launchManifest.officialStartTradeDate) < 0) {
    throw new Error('FORWARD_SHADOW_BEFORE_OFFICIAL_START_DATE');
  }
  for (const [key, manifestKey] of [
    ['evaluator', 'evaluator'],
    ['outcomeContract', 'outcomeContract'],
    ['linkageContract', 'linkageContract'],
    ['frozenForwardGate', 'frozenForwardGate'],
    ['tradingCalendar', 'tradingCalendar'],
  ]) {
    if (input.actualArtifactHashes?.[key] !== input.launchManifest[manifestKey].sha256) {
      throw new Error(`FORWARD_SHADOW_${key.toUpperCase()}_HASH_MISMATCH`);
    }
  }
  return Object.freeze({
    evidenceClass: 'OFFICIAL_FORWARD',
    ledgerPath: paths.officialLedger,
    manifestHash: input.launchManifest.manifestHash,
    approvalArtifactHash: input.ownerApprovalArtifact.approvalArtifactHash,
    officialEvidenceWritten: true,
    executionAuthorized: false,
  });
}

function resolveRunContext(input, paths) {
  if (input.mode === 'FORWARD_SHADOW') {
    const official = validateOfficialLaunchContext(input, paths);
    writeImmutableLaunchManifest(paths.root, input.launchManifest);
    validateCollectorMode(input.mode, { ownerApprovalValidated: true });
    return official;
  }
  validateCollectorMode(input.mode);
  return Object.freeze({
    evidenceClass: 'CANDIDATE_TEST',
    ledgerPath: paths.candidateLedger,
    manifestHash: null,
    approvalArtifactHash: null,
    officialEvidenceWritten: false,
    executionAuthorized: false,
  });
}

function backupOfficialEvidence(input, paths, runContext, phase) {
  if (runContext.evidenceClass !== 'OFFICIAL_FORWARD') return Object.freeze({ status: 'NOT_APPLICABLE_CANDIDATE' });
  try {
    return replicateOperationalSecondCopy({ primaryRunRoot: paths.root, backupRoot: input.secondaryBackupRoot || input.launchManifest.secondaryBackupRoot, runId: input.runId });
  } catch (error) {
    const failurePath = path.join(paths.logs, `backup-failure-${input.tradeDate}-${phase.toLowerCase()}.json`);
    const payload = stableJson({ schemaVersion: 'market-state-forward-shadow-backup-failure-v1', tradeDate: input.tradeDate, phase, error: error.message, primaryEvidencePreserved: true, executionAuthorized: false });
    if (!fs.existsSync(failurePath)) fs.writeFileSync(failurePath, payload, { encoding: 'utf8', flag: 'wx' });
    throw new Error(`FORWARD_SHADOW_BACKUP_FAILED:${error.message}`);
  }
}

export function runDailyStatePhase(input) {
  authorization(input);
  if (input.mode === 'NOT_ACTIVE') {
    const collector = validateCollectorMode(input.mode);
    return { status: 'NOT_ACTIVE', collector, officialEvidenceWritten: false, executionAuthorized: false };
  }
  const paths = ensureRuntimeLayout(input.runtimeRoot, input.runId);
  const runContext = resolveRunContext(input, paths);
  return withObserverLock(paths, () => {
    const records = readForwardShadowLedger(runContext.ledgerPath);
    const priorOfficial = records.find((record) => ['STATE', 'SESSION_STATUS'].includes(record.recordType)
      && record.tradeDate === input.tradeDate);
    if (priorOfficial) {
      assertPriorStateCompatible(input, priorOfficial);
      const backup = backupOfficialEvidence(input, paths, runContext, 'STATE');
      return {
        status: 'UNCHANGED',
        record: priorOfficial,
        ledgerHash: auditForwardShadowLedger(records).ledgerHash,
        officialEvidenceWritten: runContext.officialEvidenceWritten,
        backup,
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
    const appended = appendRuntimeRecord(paths, runContext.ledgerPath, record, records, runContext.evidenceClass, runContext);
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
      evidenceClass: runContext.evidenceClass,
      officialEvidenceWritten: runContext.officialEvidenceWritten,
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    };
    writeStatus(paths, input.tradeDate, runContext.evidenceClass, 'STATE', status);
    const backup = backupOfficialEvidence(input, paths, runContext, 'STATE');
    return { status: 'STATE_PHASE_COMPLETE', paths, record, dailyStatus: status, ...appended, backup, officialEvidenceWritten: runContext.officialEvidenceWritten, executionAuthorized: false };
  });
}

export function runDailyOutcomePhase(input) {
  authorization(input);
  if (input.mode === 'NOT_ACTIVE') return { status: 'NOT_ACTIVE', officialEvidenceWritten: false, executionAuthorized: false };
  if (input.officialTradingDay === false) return { status: 'NON_TRADING_DAY', officialEvidenceWritten: false, executionAuthorized: false };
  const paths = ensureRuntimeLayout(input.runtimeRoot, input.runId);
  const runContext = resolveRunContext(input, paths);
  return withObserverLock(paths, () => {
    const records = readForwardShadowLedger(runContext.ledgerPath);
    const state = records.find((record) => record.recordType === 'STATE' && record.tradeDate === input.tradeDate);
    if (!state) throw new Error('FORWARD_SHADOW_STATE_RECORD_NOT_FOUND');
    const prior = records.find((record) => record.recordType === 'OUTCOME' && record.stateRecordHash === state.recordHash);
    if (prior) {
      const backup = backupOfficialEvidence(input, paths, runContext, 'OUTCOME');
      return { status: 'UNCHANGED', record: prior, ledgerHash: auditForwardShadowLedger(records).ledgerHash, dailyLifecycleStatus: 'DAILY_COMPLETE', backup, officialEvidenceWritten: runContext.officialEvidenceWritten, executionAuthorized: false };
    }
    if (input.outcomeCollection?.state === 'UNAVAILABLE') {
      const status = {
        schemaVersion: 'market-state-forward-shadow-daily-status-v1',
        tradeDate: input.tradeDate,
        mode: input.mode,
        lifecycle: ['WAIT_OUTCOME_AVAILABILITY', 'OUTCOME_UNAVAILABLE', 'AUDIT_RECONCILIATION'],
        recordType: 'OUTCOME_STATUS',
        qualityStatus: 'UNAVAILABLE',
        unavailableReason: input.outcomeCollection.unavailableReason,
        stateRecordHash: state.recordHash,
        evidenceClass: runContext.evidenceClass,
        officialEvidenceWritten: false,
        dailyLifecycleStatus: 'INCOMPLETE_OUTCOME_UNAVAILABLE',
        formalWeight: 0,
        researchOnly: true,
        executionAuthorized: false,
      };
      const writeStatusResult = writeStatus(paths, input.tradeDate, runContext.evidenceClass, 'OUTCOME', status);
      const backup = backupOfficialEvidence(input, paths, runContext, 'OUTCOME');
      return { status: 'OUTCOME_UNAVAILABLE', dailyStatus: status, writeStatus: writeStatusResult, dailyLifecycleStatus: 'INCOMPLETE_OUTCOME_UNAVAILABLE', backup, officialEvidenceWritten: false, executionAuthorized: false };
    }
    const outcome = createOutcomeRecord({ ...input.outcome, stateRecordHash: state.recordHash, ...AUTHORIZATION }, records);
    const appended = appendRuntimeRecord(paths, runContext.ledgerPath, outcome, records, runContext.evidenceClass, runContext);
    const outcomePath = path.join(paths.outcomes, `${input.tradeDate}.json`);
    const body = stableJson(outcome);
    if (fs.existsSync(outcomePath) && fs.readFileSync(outcomePath, 'utf8') !== body) throw new Error('FORWARD_SHADOW_OUTCOME_FILE_CONFLICT');
    if (!fs.existsSync(outcomePath)) fs.writeFileSync(outcomePath, body, { encoding: 'utf8', flag: 'wx' });
    const status = {
      schemaVersion: 'market-state-forward-shadow-daily-status-v1',
      tradeDate: input.tradeDate,
      mode: input.mode,
      lifecycle: ['WAIT_OUTCOME_AVAILABILITY', 'APPEND_OUTCOME', 'AUDIT_RECONCILIATION', 'DAILY_COMPLETE'],
      recordType: 'OUTCOME',
      qualityStatus: 'COMPLETE',
      stateRecordHash: state.recordHash,
      outcomeRecordHash: outcome.recordHash,
      ledgerHash: appended.ledgerHash,
      evidenceClass: runContext.evidenceClass,
      officialEvidenceWritten: runContext.officialEvidenceWritten,
      dailyLifecycleStatus: 'DAILY_COMPLETE',
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
    };
    writeStatus(paths, input.tradeDate, runContext.evidenceClass, 'OUTCOME', status);
    const backup = backupOfficialEvidence(input, paths, runContext, 'OUTCOME');
    return { status: 'OUTCOME_PHASE_COMPLETE', paths, record: outcome, dailyStatus: status, dailyLifecycleStatus: 'DAILY_COMPLETE', ...appended, backup, officialEvidenceWritten: runContext.officialEvidenceWritten, executionAuthorized: false };
  });
}

export function verifyRuntimeEvidence(runtimeRoot, runId, { official = false } = {}) {
  const paths = runtimePaths(runtimeRoot, runId);
  const ledgerPath = official ? paths.officialLedger : paths.candidateLedger;
  const records = readForwardShadowLedger(ledgerPath);
  const audit = auditForwardShadowLedger(records);
  return {
    ...audit,
    runId,
    runtimeRoot: paths.root,
    ledgerChecksum: fs.existsSync(ledgerPath) ? digest(fs.readFileSync(ledgerPath)) : null,
    officialEvidenceWritten: official && records.length > 0,
    executionAuthorized: false,
  };
}

export function buildObserverReport(result, extras = {}) {
  return Object.freeze({
    ...result,
    ...extras,
    collectorActive: false,
    officialEvidenceWritten: result?.officialEvidenceWritten === true,
    executionAuthorized: false,
  });
}

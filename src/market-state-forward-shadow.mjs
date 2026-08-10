import crypto from 'node:crypto';

export const FORWARD_SHADOW_SCHEMA_VERSION = 'market-state-forward-shadow-v1';
export const FORWARD_SHADOW_SELECTED_AXES = Object.freeze(['direction', 'globalAlignment']);
export const FORWARD_SHADOW_RECORD_STATES = Object.freeze(['CLEAN', 'UNAVAILABLE', 'STALE', 'MISSED', 'REJECTED']);
export const FORWARD_SHADOW_COLLECTOR_MODES = Object.freeze(['DRY_RUN', 'NOT_ACTIVE', 'MANUAL_TEST', 'TEST_FIXTURE', 'FORWARD_SHADOW']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function stableJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function stableJsonLine(value) {
  return `${JSON.stringify(canonical(value))}\n`;
}

export function digest(value) {
  const body = typeof value === 'string' || Buffer.isBuffer(value) || value instanceof Uint8Array
    ? value
    : JSON.stringify(canonical(value));
  return crypto.createHash('sha256').update(body).digest('hex');
}

function parseTimestamp(value, errorCode) {
  const parsed = Date.parse(value);
  if (!value || Number.isNaN(parsed)) throw new Error(errorCode);
  return parsed;
}

function requireText(value, errorCode) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(errorCode);
  return value.trim();
}

function requireHash(value, errorCode) {
  if (!/^[a-f0-9]{64}$/.test(value || '')) throw new Error(errorCode);
  return value;
}

function validateAuthorization(value) {
  if (value?.formalWeight !== 0 || value?.researchOnly !== true || value?.executionAuthorized !== false) {
    throw new Error('FORWARD_SHADOW_AUTHORIZATION_BOUNDARY');
  }
}

function validateAxes(axes) {
  if (JSON.stringify(axes) !== JSON.stringify(FORWARD_SHADOW_SELECTED_AXES)) {
    throw new Error('FORWARD_SHADOW_SELECTED_AXES_NOT_FROZEN');
  }
}

export function createLaunchManifestCandidate(input) {
  validateAuthorization(input);
  validateAxes(input.selectedAxes);
  if (input.launchStatus !== 'NOT_ACTIVE') throw new Error('FORWARD_SHADOW_LAUNCH_MUST_BE_NOT_ACTIVE');
  if (input.candidateStartTradeDate !== null && input.candidateStartTradeDate !== 'PENDING') {
    throw new Error('FORWARD_SHADOW_START_DATE_MUST_BE_PENDING');
  }
  const manifest = {
    schemaVersion: 'market-state-forward-shadow-launch-candidate-v1',
    baselineMainCommit: requireText(input.baselineMainCommit, 'FORWARD_SHADOW_BASELINE_COMMIT_REQUIRED'),
    finalMainCommit: null,
    evaluator: input.evaluator,
    outcomeContract: input.outcomeContract,
    linkageContract: input.linkageContract,
    frozenForwardGate: input.frozenForwardGate,
    selectedAxes: [...input.selectedAxes],
    collectorMode: 'NOT_ACTIVE',
    schedulerMode: 'NOT_ACTIVE',
    formalSchedulerEnabled: false,
    candidateStartTradeDate: null,
    launchStatus: 'NOT_ACTIVE',
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  for (const reference of ['evaluator', 'outcomeContract', 'linkageContract', 'frozenForwardGate']) {
    requireText(manifest[reference]?.version, `FORWARD_SHADOW_${reference.toUpperCase()}_VERSION_REQUIRED`);
    if (!/^[a-f0-9]{64}$/.test(manifest[reference]?.sha256 || '')) {
      throw new Error(`FORWARD_SHADOW_${reference.toUpperCase()}_HASH_REQUIRED`);
    }
  }
  return Object.freeze({ ...manifest, manifestHash: digest(manifest) });
}

export function createReadyForLaunchManifest(input) {
  validateAuthorization(input);
  validateAxes(input.selectedAxes);
  const finalMainCommit = requireText(input.finalMainCommit, 'FORWARD_SHADOW_FINAL_MAIN_COMMIT_REQUIRED');
  if (!/^[a-f0-9]{40}$/.test(finalMainCommit)) throw new Error('FORWARD_SHADOW_FINAL_MAIN_COMMIT_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.officialStartTradeDate || '')) {
    throw new Error('FORWARD_SHADOW_OFFICIAL_START_TRADE_DATE_INVALID');
  }
  const runtimeRoot = requireText(input.runtimeRoot, 'FORWARD_SHADOW_RUNTIME_ROOT_REQUIRED');
  if (/^[cC]:[\\/]/.test(runtimeRoot)) throw new Error('FORWARD_SHADOW_C_DRIVE_RUNTIME_FORBIDDEN');
  const runId = requireText(input.runId, 'FORWARD_SHADOW_RUN_ID_REQUIRED');
  if (!/^[a-z0-9][a-z0-9._-]{2,79}$/i.test(runId)) throw new Error('FORWARD_SHADOW_RUN_ID_INVALID');
  const secondaryBackupRoot = requireText(input.secondaryBackupRoot, 'FORWARD_SHADOW_SECONDARY_BACKUP_ROOT_REQUIRED');
  if (!/^[dD]:[\\/]/.test(secondaryBackupRoot)) throw new Error('FORWARD_SHADOW_SECONDARY_BACKUP_MUST_BE_D_DRIVE');
  const manifest = {
    schemaVersion: 'market-state-forward-shadow-launch-ready-v1',
    finalMainCommit,
    officialStartTradeDate: input.officialStartTradeDate,
    schedulerTime: requireText(input.schedulerTime, 'FORWARD_SHADOW_SCHEDULER_TIME_REQUIRED'),
    outcomeSchedulerTime: requireText(input.outcomeSchedulerTime, 'FORWARD_SHADOW_OUTCOME_SCHEDULER_TIME_REQUIRED'),
    runtimeRoot,
    runId,
    evaluator: input.evaluator,
    outcomeContract: input.outcomeContract,
    linkageContract: input.linkageContract,
    frozenForwardGate: input.frozenForwardGate,
    tradingCalendar: input.tradingCalendar,
    secondaryBackupRoot,
    secondaryBackupClass: 'OPERATIONAL_SECOND_COPY_NOT_DISASTER_RESILIENT',
    selectedAxes: [...input.selectedAxes],
    launchStatus: 'READY_FOR_LAUNCH',
    ownerLaunchApprovalRequired: true,
    collectorActive: false,
    formalSchedulerEnabled: false,
    officialEvidenceWritten: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  for (const reference of ['evaluator', 'outcomeContract', 'linkageContract', 'frozenForwardGate', 'tradingCalendar']) {
    requireText(manifest[reference]?.version, `FORWARD_SHADOW_${reference.toUpperCase()}_VERSION_REQUIRED`);
    requireHash(manifest[reference]?.sha256, `FORWARD_SHADOW_${reference.toUpperCase()}_HASH_REQUIRED`);
  }
  return Object.freeze({ ...manifest, manifestHash: digest(manifest) });
}

function withoutHash(value, hashField) {
  const { [hashField]: _hash, ...body } = value || {};
  return body;
}

export function validateReadyForLaunchManifest(manifest) {
  validateAuthorization(manifest);
  validateAxes(manifest.selectedAxes);
  if (manifest.schemaVersion !== 'market-state-forward-shadow-launch-ready-v1') throw new Error('FORWARD_SHADOW_READY_MANIFEST_SCHEMA_INVALID');
  if (manifest.launchStatus !== 'READY_FOR_LAUNCH') throw new Error('FORWARD_SHADOW_READY_MANIFEST_STATUS_INVALID');
  if (manifest.collectorActive !== false || manifest.formalSchedulerEnabled !== false || manifest.officialEvidenceWritten !== false) {
    throw new Error('FORWARD_SHADOW_READY_MANIFEST_ALREADY_ACTIVE');
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.finalMainCommit || '')) throw new Error('FORWARD_SHADOW_FINAL_MAIN_COMMIT_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.officialStartTradeDate || '')) throw new Error('FORWARD_SHADOW_OFFICIAL_START_TRADE_DATE_INVALID');
  requireText(manifest.schedulerTime, 'FORWARD_SHADOW_SCHEDULER_TIME_REQUIRED');
  requireText(manifest.outcomeSchedulerTime, 'FORWARD_SHADOW_OUTCOME_SCHEDULER_TIME_REQUIRED');
  requireText(manifest.runtimeRoot, 'FORWARD_SHADOW_RUNTIME_ROOT_REQUIRED');
  requireText(manifest.runId, 'FORWARD_SHADOW_RUN_ID_REQUIRED');
  requireText(manifest.secondaryBackupRoot, 'FORWARD_SHADOW_SECONDARY_BACKUP_ROOT_REQUIRED');
  if (manifest.secondaryBackupClass !== 'OPERATIONAL_SECOND_COPY_NOT_DISASTER_RESILIENT') throw new Error('FORWARD_SHADOW_SECONDARY_BACKUP_CLASS_INVALID');
  for (const reference of ['evaluator', 'outcomeContract', 'linkageContract', 'frozenForwardGate', 'tradingCalendar']) {
    requireText(manifest[reference]?.version, `FORWARD_SHADOW_${reference.toUpperCase()}_VERSION_REQUIRED`);
    requireHash(manifest[reference]?.sha256, `FORWARD_SHADOW_${reference.toUpperCase()}_HASH_REQUIRED`);
  }
  requireHash(manifest.manifestHash, 'FORWARD_SHADOW_READY_MANIFEST_HASH_REQUIRED');
  if (digest(withoutHash(manifest, 'manifestHash')) !== manifest.manifestHash) throw new Error('FORWARD_SHADOW_READY_MANIFEST_HASH_MISMATCH');
  return Object.freeze({ valid: true, manifestHash: manifest.manifestHash, executionAuthorized: false });
}

export function createOwnerLaunchApprovalArtifact(input) {
  validateAuthorization(input);
  const artifact = {
    schemaVersion: 'market-state-forward-shadow-owner-launch-approval-v1',
    approvalStatus: 'APPROVED',
    ownerDecisionReference: requireText(input.ownerDecisionReference, 'FORWARD_SHADOW_OWNER_DECISION_REFERENCE_REQUIRED'),
    approvedAt: requireText(input.approvedAt, 'FORWARD_SHADOW_OWNER_APPROVED_AT_REQUIRED'),
    manifestHash: requireHash(input.manifestHash, 'FORWARD_SHADOW_OWNER_MANIFEST_HASH_REQUIRED'),
    finalMainCommit: requireText(input.finalMainCommit, 'FORWARD_SHADOW_FINAL_MAIN_COMMIT_REQUIRED'),
    officialStartTradeDate: requireText(input.officialStartTradeDate, 'FORWARD_SHADOW_OFFICIAL_START_TRADE_DATE_INVALID'),
    schedulerTime: requireText(input.schedulerTime, 'FORWARD_SHADOW_SCHEDULER_TIME_REQUIRED'),
    outcomeSchedulerTime: requireText(input.outcomeSchedulerTime, 'FORWARD_SHADOW_OUTCOME_SCHEDULER_TIME_REQUIRED'),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  parseTimestamp(artifact.approvedAt, 'FORWARD_SHADOW_OWNER_APPROVED_AT_INVALID');
  if (!/^[a-f0-9]{40}$/.test(artifact.finalMainCommit)) throw new Error('FORWARD_SHADOW_FINAL_MAIN_COMMIT_INVALID');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(artifact.officialStartTradeDate)) throw new Error('FORWARD_SHADOW_OFFICIAL_START_TRADE_DATE_INVALID');
  return Object.freeze({ ...artifact, approvalArtifactHash: digest(artifact) });
}

export function validateOwnerLaunchApprovalArtifact(approval, manifest) {
  validateReadyForLaunchManifest(manifest);
  validateAuthorization(approval);
  if (approval.schemaVersion !== 'market-state-forward-shadow-owner-launch-approval-v1' || approval.approvalStatus !== 'APPROVED') {
    throw new Error('FORWARD_SHADOW_OWNER_APPROVAL_INVALID');
  }
  requireText(approval.ownerDecisionReference, 'FORWARD_SHADOW_OWNER_DECISION_REFERENCE_REQUIRED');
  parseTimestamp(approval.approvedAt, 'FORWARD_SHADOW_OWNER_APPROVED_AT_INVALID');
  requireHash(approval.approvalArtifactHash, 'FORWARD_SHADOW_OWNER_APPROVAL_HASH_REQUIRED');
  if (digest(withoutHash(approval, 'approvalArtifactHash')) !== approval.approvalArtifactHash) {
    throw new Error('FORWARD_SHADOW_OWNER_APPROVAL_HASH_MISMATCH');
  }
  if (approval.manifestHash !== manifest.manifestHash) throw new Error('FORWARD_SHADOW_APPROVAL_MANIFEST_HASH_MISMATCH');
  if (approval.finalMainCommit !== manifest.finalMainCommit) throw new Error('FORWARD_SHADOW_APPROVAL_FINAL_MAIN_COMMIT_MISMATCH');
  if (approval.officialStartTradeDate !== manifest.officialStartTradeDate) throw new Error('FORWARD_SHADOW_APPROVAL_START_DATE_MISMATCH');
  if (approval.schedulerTime !== manifest.schedulerTime) throw new Error('FORWARD_SHADOW_APPROVAL_SCHEDULER_TIME_MISMATCH');
  if (approval.outcomeSchedulerTime !== manifest.outcomeSchedulerTime) throw new Error('FORWARD_SHADOW_APPROVAL_OUTCOME_SCHEDULER_TIME_MISMATCH');
  return Object.freeze({ valid: true, approvalArtifactHash: approval.approvalArtifactHash, executionAuthorized: false });
}

function recordBody(record) {
  const { recordHash: _recordHash, ...body } = record;
  return body;
}

function baseRecord(existingRecords, input, recordType) {
  validateAuthorization(input);
  const sequence = existingRecords.length + 1;
  return {
    schemaVersion: FORWARD_SHADOW_SCHEMA_VERSION,
    recordType,
    sequence,
    previousHash: existingRecords.at(-1)?.recordHash || null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

export function createStateRecord(input, existingRecords = []) {
  const existingAudit = auditForwardShadowLedger(existingRecords);
  if (!existingAudit.ok) throw new Error(`FORWARD_SHADOW_EXISTING_LEDGER_INVALID:${existingAudit.errors.join(',')}`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate || '')) throw new Error('FORWARD_SHADOW_TRADE_DATE_INVALID');
  if (existingRecords.some((record) => ['STATE', 'SESSION_STATUS'].includes(record.recordType) && record.tradeDate === input.tradeDate)) {
    throw new Error('FORWARD_SHADOW_DUPLICATE_OFFICIAL_TRADE_DATE');
  }
  validateAxes(input.selectedShadowAxes);
  if (!FORWARD_SHADOW_RECORD_STATES.includes(input.qualityStatus)) throw new Error('FORWARD_SHADOW_QUALITY_STATUS_INVALID');
  if (input.qualityStatus === 'MISSED') throw new Error('FORWARD_SHADOW_MISSED_REQUIRES_SESSION_STATUS');
  const decisionAt = parseTimestamp(input.decisionAt, 'FORWARD_SHADOW_DECISION_AT_INVALID');
  const availableAt = parseTimestamp(input.availableAt, 'FORWARD_SHADOW_AVAILABLE_AT_INVALID');
  const recordedAt = parseTimestamp(input.recordedAt, 'FORWARD_SHADOW_RECORDED_AT_INVALID');
  const observationStartAt = parseTimestamp(input.outcomeObservationStartAt, 'FORWARD_SHADOW_OBSERVATION_START_INVALID');
  if (availableAt > decisionAt) throw new Error('FORWARD_SHADOW_FUTURE_DATA_VIOLATION');
  if (decisionAt >= observationStartAt) throw new Error('FORWARD_SHADOW_TEMPORAL_ALIGNMENT_VIOLATION');
  if (recordedAt < availableAt) throw new Error('FORWARD_SHADOW_RECORDED_BEFORE_AVAILABLE');
  const evidenceLineage = Array.isArray(input.evidenceLineage) ? input.evidenceLineage : [];
  for (const item of evidenceLineage) {
    const sourceAvailableAt = parseTimestamp(item.availableAt, 'FORWARD_SHADOW_EVIDENCE_AVAILABLE_AT_INVALID');
    if (sourceAvailableAt > decisionAt) throw new Error('FORWARD_SHADOW_FUTURE_DATA_VIOLATION');
    requireHash(item.sourceHash, 'FORWARD_SHADOW_SOURCE_HASH_REQUIRED');
  }
  if (input.qualityStatus === 'CLEAN' && input.unavailableReason) throw new Error('FORWARD_SHADOW_CLEAN_WITH_UNAVAILABLE_REASON');
  if (input.qualityStatus !== 'CLEAN' && !input.unavailableReason) throw new Error('FORWARD_SHADOW_UNAVAILABLE_REASON_REQUIRED');
  if (input.retroactiveBackfill === true) throw new Error('FORWARD_SHADOW_RETROACTIVE_BACKFILL_FORBIDDEN');

  const base = baseRecord(existingRecords, input, 'STATE');
  const record = {
    ...base,
    tradeDate: input.tradeDate,
    sessionId: requireText(input.sessionId, 'FORWARD_SHADOW_SESSION_ID_REQUIRED'),
    decisionAt: input.decisionAt,
    availableAt: input.availableAt,
    recordedAt: input.recordedAt,
    outcomeObservationStartAt: input.outcomeObservationStartAt,
    evaluator: input.evaluator,
    axisStateSnapshot: input.axisStateSnapshot,
    selectedShadowAxes: [...input.selectedShadowAxes],
    evidenceLineage,
    sourceTimestamps: input.sourceTimestamps || {},
    sourceHashes: input.sourceHashes || {},
    qualityStatus: input.qualityStatus,
    unavailableReason: input.unavailableReason || null,
    staleState: input.staleState || (input.qualityStatus === 'STALE' ? 'STALE' : 'NOT_STALE'),
    missingState: input.missingState || (input.qualityStatus === 'UNAVAILABLE' ? 'MISSING' : 'NOT_MISSING'),
    idempotencyKey: `MARKET_STATE:${input.tradeDate}:${input.sessionId}`,
  };
  record.recordHash = digest(recordBody(record));
  return Object.freeze(record);
}

export function createMissedSessionRecord(input, existingRecords = []) {
  const existingAudit = auditForwardShadowLedger(existingRecords);
  if (!existingAudit.ok) throw new Error(`FORWARD_SHADOW_EXISTING_LEDGER_INVALID:${existingAudit.errors.join(',')}`);
  validateAuthorization(input);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.tradeDate || '')) throw new Error('FORWARD_SHADOW_TRADE_DATE_INVALID');
  if (existingRecords.some((record) => ['STATE', 'SESSION_STATUS'].includes(record.recordType) && record.tradeDate === input.tradeDate)) {
    throw new Error('FORWARD_SHADOW_DUPLICATE_OFFICIAL_TRADE_DATE');
  }
  parseTimestamp(input.scheduledAt, 'FORWARD_SHADOW_SCHEDULED_AT_INVALID');
  parseTimestamp(input.recordedAt, 'FORWARD_SHADOW_RECORDED_AT_INVALID');
  if (input.retroactiveBackfill === true) throw new Error('FORWARD_SHADOW_RETROACTIVE_BACKFILL_FORBIDDEN');
  const base = baseRecord(existingRecords, input, 'SESSION_STATUS');
  const record = {
    ...base,
    tradeDate: input.tradeDate,
    sessionId: requireText(input.sessionId, 'FORWARD_SHADOW_SESSION_ID_REQUIRED'),
    scheduledAt: input.scheduledAt,
    recordedAt: input.recordedAt,
    qualityStatus: 'MISSED',
    missedReason: requireText(input.missedReason, 'FORWARD_SHADOW_MISSED_REASON_REQUIRED'),
    idempotencyKey: `MARKET_STATE_MISSED:${input.tradeDate}:${input.sessionId}`,
  };
  record.recordHash = digest(recordBody(record));
  return Object.freeze(record);
}

export function createOutcomeRecord(input, existingRecords = []) {
  const existingAudit = auditForwardShadowLedger(existingRecords);
  if (!existingAudit.ok) throw new Error(`FORWARD_SHADOW_EXISTING_LEDGER_INVALID:${existingAudit.errors.join(',')}`);
  validateAuthorization(input);
  const referencedRecord = existingRecords.find((record) => record.recordHash === input.stateRecordHash);
  if (referencedRecord?.recordType === 'SESSION_STATUS') throw new Error('FORWARD_SHADOW_RETROACTIVE_BACKFILL_FORBIDDEN');
  const stateRecord = referencedRecord?.recordType === 'STATE' ? referencedRecord : null;
  if (!stateRecord) throw new Error('FORWARD_SHADOW_STATE_RECORD_NOT_FOUND');
  if (existingRecords.some((record) => record.recordType === 'OUTCOME' && record.stateRecordHash === input.stateRecordHash)) {
    throw new Error('FORWARD_SHADOW_DUPLICATE_OUTCOME');
  }
  if (stateRecord.recordHash !== digest(recordBody(stateRecord))) throw new Error('FORWARD_SHADOW_STATE_MUTATION');
  if (['MISSED', 'REJECTED'].includes(stateRecord.qualityStatus)) {
    throw new Error('FORWARD_SHADOW_RETROACTIVE_BACKFILL_FORBIDDEN');
  }
  const outcomeAvailableAt = parseTimestamp(input.outcomeAvailableAt, 'FORWARD_SHADOW_OUTCOME_AVAILABLE_AT_INVALID');
  if (outcomeAvailableAt < parseTimestamp(stateRecord.outcomeObservationStartAt, 'FORWARD_SHADOW_OBSERVATION_START_INVALID')) {
    throw new Error('FORWARD_SHADOW_OUTCOME_AVAILABLE_BEFORE_OBSERVATION');
  }
  const base = baseRecord(existingRecords, input, 'OUTCOME');
  const record = {
    ...base,
    tradeDate: stateRecord.tradeDate,
    sessionId: stateRecord.sessionId,
    stateRecordHash: stateRecord.recordHash,
    outcomeContract: input.outcomeContract,
    outcomeAvailableAt: input.outcomeAvailableAt,
    actualContract: requireText(input.actualContract, 'FORWARD_SHADOW_ACTUAL_CONTRACT_REQUIRED'),
    sessionReturnBps: Number(input.sessionReturnBps),
    outcomeSourceLineage: input.outcomeSourceLineage,
    outcomeSourceHash: requireText(input.outcomeSourceHash, 'FORWARD_SHADOW_OUTCOME_SOURCE_HASH_REQUIRED'),
    idempotencyKey: `MARKET_STATE_OUTCOME:${stateRecord.tradeDate}:${stateRecord.sessionId}:${stateRecord.recordHash}`,
  };
  if (!Number.isFinite(record.sessionReturnBps)) throw new Error('FORWARD_SHADOW_SESSION_RETURN_INVALID');
  requireHash(input.outcomeContract?.sha256, 'FORWARD_SHADOW_OUTCOME_CONTRACT_HASH_REQUIRED');
  requireHash(record.outcomeSourceHash, 'FORWARD_SHADOW_OUTCOME_SOURCE_HASH_REQUIRED');
  record.recordHash = digest(recordBody(record));
  return Object.freeze(record);
}

export function appendForwardShadowRecord(records, record) {
  const expected = record.recordType === 'STATE'
    ? createStateRecord(record, records)
    : record.recordType === 'SESSION_STATUS'
      ? createMissedSessionRecord(record, records)
      : createOutcomeRecord(record, records);
  if (expected.recordHash !== record.recordHash) throw new Error('FORWARD_SHADOW_RECORD_HASH_MISMATCH');
  return [...records, record];
}

export function auditForwardShadowLedger(records = []) {
  const errors = [];
  const officialDates = new Set();
  const stateDates = new Set();
  const missedDates = new Set();
  const stateHashes = new Set();
  const outcomeStateHashes = new Set();
  let previousHash = null;
  records.forEach((record, index) => {
    if (record.sequence !== index + 1) errors.push(`SEQUENCE_MISMATCH:${index + 1}`);
    if (record.previousHash !== previousHash) errors.push(`HASH_CHAIN_BREAK:${index + 1}`);
    if (record.recordHash !== digest(recordBody(record))) errors.push(`RECORD_HASH_MISMATCH:${index + 1}`);
    if (record.executionAuthorized !== false || record.researchOnly !== true || record.formalWeight !== 0) {
      errors.push(`AUTHORIZATION_BOUNDARY:${index + 1}`);
    }
    if (record.recordType === 'STATE') {
      if (officialDates.has(record.tradeDate)) errors.push(`DUPLICATE_OFFICIAL_TRADE_DATE:${record.tradeDate}`);
      officialDates.add(record.tradeDate);
      stateDates.add(record.tradeDate);
      stateHashes.add(record.recordHash);
    } else if (record.recordType === 'SESSION_STATUS') {
      if (officialDates.has(record.tradeDate)) errors.push(`DUPLICATE_OFFICIAL_TRADE_DATE:${record.tradeDate}`);
      officialDates.add(record.tradeDate);
      missedDates.add(record.tradeDate);
      if (record.qualityStatus !== 'MISSED') errors.push(`SESSION_STATUS_NOT_MISSED:${index + 1}`);
    } else if (record.recordType === 'OUTCOME') {
      if (!stateHashes.has(record.stateRecordHash)) errors.push(`OUTCOME_STATE_REFERENCE_INVALID:${index + 1}`);
      if (outcomeStateHashes.has(record.stateRecordHash)) errors.push(`DUPLICATE_OUTCOME:${record.stateRecordHash}`);
      outcomeStateHashes.add(record.stateRecordHash);
    } else errors.push(`RECORD_TYPE_INVALID:${index + 1}`);
    previousHash = record.recordHash;
  });
  return {
    ok: errors.length === 0,
    errors,
    recordCount: records.length,
    officialRecordCount: officialDates.size,
    stateRecordCount: stateDates.size,
    missedSessionRecordCount: missedDates.size,
    outcomeRecordCount: outcomeStateHashes.size,
    cleanStateRecordCount: records.filter((record) => record.recordType === 'STATE' && record.qualityStatus === 'CLEAN').length,
    ledgerHash: digest(records),
    executionAuthorized: false,
  };
}

export function validateCollectorMode(mode, { ownerApprovalValidated = false } = {}) {
  if (!FORWARD_SHADOW_COLLECTOR_MODES.includes(mode)) throw new Error('FORWARD_SHADOW_COLLECTOR_MODE_FORBIDDEN');
  if (mode === 'FORWARD_SHADOW' && ownerApprovalValidated !== true) throw new Error('FORWARD_SHADOW_OWNER_APPROVAL_REQUIRED');
  return {
    mode,
    active: mode === 'FORWARD_SHADOW',
    officialEvidenceWritten: false,
    executionAuthorized: false,
  };
}

import fs from 'node:fs/promises';
import path from 'node:path';

export const CRU34_STATUS_RETRY_POLICY = Object.freeze({
  maxAttempts: 6,
  delaysMs: Object.freeze([25, 50, 100, 200, 400]),
  maxTotalDelayMs: 775,
  retryableCodes: Object.freeze(['EPERM', 'EBUSY', 'EACCES']),
});

const retryableCodes = new Set(CRU34_STATUS_RETRY_POLICY.retryableCodes);

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function operationError(error, operation) {
  const wrapped = new Error(String(error?.message || error || 'CRU34_IO_FAILED'), { cause: error });
  wrapped.name = error?.name || 'Error';
  wrapped.code = error?.code || 'UNKNOWN';
  wrapped.cru34Operation = operation;
  return wrapped;
}

export class Cru34StatusPublicationError extends Error {
  constructor(error, { attempts, targetPath, tempPath, retryDelaysMs }) {
    super('CRU34_STATUS_PUBLICATION_FAILED', { cause: error });
    this.name = 'Cru34StatusPublicationError';
    this.code = error?.code || 'UNKNOWN';
    this.operation = error?.cru34Operation || 'UNKNOWN';
    this.attempts = attempts;
    this.targetPath = targetPath;
    this.tempPath = tempPath;
    this.retryDelaysMs = Object.freeze([...retryDelaysMs]);
  }
}

export async function publishCru34Status({
  targetPath,
  tempPath,
  document,
  io = fs,
  sleep = wait,
} = {}) {
  if (!targetPath || !tempPath || !document) throw new Error('CRU34_STATUS_PUBLISH_CONFIG_INVALID');
  const retryDelaysMs = [];
  let lastError = null;
  for (let attempt = 1; attempt <= CRU34_STATUS_RETRY_POLICY.maxAttempts; attempt += 1) {
    try {
      try { await io.mkdir(path.dirname(targetPath), { recursive: true }); }
      catch (error) { throw operationError(error, 'MKDIR_STATUS_PARENT'); }
      try { await io.writeFile(tempPath, `${JSON.stringify(document)}\n`, 'utf8'); }
      catch (error) { throw operationError(error, 'WRITE_STATUS_TEMP'); }
      try { await io.rename(tempPath, targetPath); }
      catch (error) { throw operationError(error, 'RENAME_STATUS_TEMP'); }
      return Object.freeze({
        attempts: attempt,
        retryDelaysMs: Object.freeze([...retryDelaysMs]),
        recoveredCode: lastError?.code || null,
        recoveredOperation: lastError?.cru34Operation || null,
      });
    } catch (error) {
      lastError = error;
      if (!retryableCodes.has(error?.code) || attempt === CRU34_STATUS_RETRY_POLICY.maxAttempts) break;
      const delayMs = CRU34_STATUS_RETRY_POLICY.delaysMs[attempt - 1];
      retryDelaysMs.push(delayMs);
      await sleep(delayMs);
    }
  }
  throw new Cru34StatusPublicationError(lastError, {
    attempts: retryDelaysMs.length + 1,
    targetPath,
    tempPath,
    retryDelaysMs,
  });
}

export function cru34ErrorEvidence(error) {
  return Object.freeze({
    operation: error?.operation || error?.cru34Operation || 'RUN_PROJECTION',
    code: error?.code || error?.cause?.code || 'ERROR',
    attempts: Number.isInteger(error?.attempts) ? error.attempts : 1,
    retryDelaysMs: Array.isArray(error?.retryDelaysMs) ? [...error.retryDelaysMs] : [],
    reason: String(error?.message || 'LIVE_PROJECTION_FAILED').slice(0, 256),
  });
}

export async function appendCru34Incident({ incidentPath, record, io = fs } = {}) {
  try {
    if (!incidentPath || !record) throw new Error('CRU34_INCIDENT_CONFIG_INVALID');
    await io.mkdir(path.dirname(incidentPath), { recursive: true });
    await io.appendFile(incidentPath, `${JSON.stringify(record)}\n`, 'utf8');
    return Object.freeze({ written: true, error: null });
  } catch (error) {
    return Object.freeze({ written: false, error: cru34ErrorEvidence(operationError(error, 'APPEND_INCIDENT')) });
  }
}

export function isCru34IntegrityFailure(error) {
  return /(?:LEDGER|CHECKPOINT|HASH|SEMANTIC|SAFETY|SOURCE_IDENTITY|ANCHOR)/.test(String(error?.message || ''));
}

export function isCru34ControlledFatal(error) {
  if (isCru34IntegrityFailure(error)) return true;
  if (!(error instanceof Cru34StatusPublicationError)) return false;
  return error.code === 'EACCES' || !retryableCodes.has(error.code);
}

export async function handleCru34RunFailure({ error, recordIncident, writeUnavailable } = {}) {
  if (!error || typeof recordIncident !== 'function' || typeof writeUnavailable !== 'function') {
    throw new Error('CRU34_FAILURE_HANDLER_CONFIG_INVALID');
  }
  const evidence = cru34ErrorEvidence(error);
  try { await recordIncident(error, { result: 'PRIMARY_FAILURE_CAPTURED', originalCode: null }); }
  catch { /* the protected stderr/incident adapter owns its own diagnostic fallback */ }
  let fallbackPublished = false;
  let fallbackFatal = false;
  try {
    await writeUnavailable(evidence.reason);
    fallbackPublished = true;
  } catch (fallbackError) {
    fallbackFatal = isCru34ControlledFatal(fallbackError);
    try {
      await recordIncident(fallbackError, {
        result: 'STATUS_FALLBACK_FAILED_OLD_STATUS_PRESERVED',
        originalCode: evidence.code,
      });
    } catch { /* never replace or rethrow the original failure */ }
  }
  return Object.freeze({
    original: evidence,
    fallbackPublished,
    fatal: isCru34ControlledFatal(error) || fallbackFatal,
  });
}

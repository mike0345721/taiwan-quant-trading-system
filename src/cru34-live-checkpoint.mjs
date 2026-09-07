import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CRU34_LIVE_CHECKPOINT_VERSION = 'cru34-live-checkpoint-v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

export function cru34LiveCanonicalJson(value) {
  return JSON.stringify(stable(value));
}

export function cru34LiveHash(value) {
  return crypto.createHash('sha256').update(cru34LiveCanonicalJson(value)).digest('hex');
}

function safetyValid(value) {
  return value?.formalWeight === 0 && value?.researchOnly === true
    && value?.executionAuthorized === false && value?.orderRoutesEnabled === false;
}

export function validateCru34LiveCheckpoint(value) {
  if (!value || value.schemaVersion !== CRU34_LIVE_CHECKPOINT_VERSION) {
    throw new Error('CRU43_CHECKPOINT_SCHEMA_INVALID');
  }
  const { checkpointHash, ...body } = value;
  if (!/^[a-f0-9]{64}$/.test(checkpointHash || '') || cru34LiveHash(body) !== checkpointHash) {
    throw new Error('CRU43_CHECKPOINT_HASH_INVALID');
  }
  if (!safetyValid(body)) throw new Error('CRU43_CHECKPOINT_SAFETY_INVALID');
  if (!/^sha256:[a-f0-9]{64}$/.test(body.sourceLedgerIdentity || '')) {
    throw new Error('CRU43_CHECKPOINT_SOURCE_IDENTITY_INVALID');
  }
  if (!Number.isInteger(body.lastVerifiedLedgerOrdinal) || body.lastVerifiedLedgerOrdinal < 1
      || !Number.isInteger(body.lastVerifiedStartByteOffset) || body.lastVerifiedStartByteOffset < 0
      || !Number.isInteger(body.lastVerifiedEndByteOffset)
      || body.lastVerifiedEndByteOffset <= body.lastVerifiedStartByteOffset
      || !/^[a-f0-9]{64}$/.test(body.lastVerifiedRecordHash || '')) {
    throw new Error('CRU43_CHECKPOINT_ANCHOR_INVALID');
  }
  if (!Array.isArray(body.rollingCanonicalEvents) || body.rollingCanonicalEvents.length > 250_000) {
    throw new Error('CRU43_CHECKPOINT_ROLLING_STATE_INVALID');
  }
  return Object.freeze(value);
}

export function buildCru34LiveCheckpoint(body) {
  const { checkpointHash: ignoredHash, schemaVersion: ignoredSchema, ...cleanBody } = body || {};
  const checkpoint = {
    schemaVersion: CRU34_LIVE_CHECKPOINT_VERSION,
    ...cleanBody,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  return validateCru34LiveCheckpoint(Object.freeze({
    ...checkpoint,
    checkpointHash: cru34LiveHash(checkpoint),
  }));
}

export function writeCru34LiveCheckpoint(filePath, checkpoint) {
  validateCru34LiveCheckpoint(checkpoint);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  const bytes = `${cru34LiveCanonicalJson(checkpoint)}\n`;
  const fd = fs.openSync(temp, 'wx');
  try {
    fs.writeFileSync(fd, bytes, 'utf8');
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  fs.renameSync(temp, filePath);
  try {
    const directoryFd = fs.openSync(path.dirname(filePath), 'r');
    try { fs.fsyncSync(directoryFd); } finally { fs.closeSync(directoryFd); }
  } catch (error) {
    if (!['EINVAL', 'EPERM', 'EACCES'].includes(error?.code)) throw error;
  }
  return validateCru34LiveCheckpoint(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

export function readCru34LiveCheckpoint(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return null;
  return validateCru34LiveCheckpoint(JSON.parse(fs.readFileSync(filePath, 'utf8')));
}

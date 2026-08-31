import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const CRU34_SNAPSHOT_CONTRACT_VERSION = 'cru34-snapshot-contract-v1';
export const CRU34_ARTIFACT_SCHEMA_VERSION = 'cru34-snapshot-artifact-v1';
export const CRU34_SOURCE_MODE_HISTORICAL = 'HISTORICAL';
export const CRU34_MAX_ARTIFACT_BYTES = 4 * 1024 * 1024;
export const CRU34_MAX_DIRECTORY_ENTRIES = 4_096;
export const CRU34_MAX_SELECTION_CANDIDATES = 128;

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_SELECTION_PATTERN = /^([a-f0-9]{24})\.([0-9]{16})\.([a-f0-9]{64})\.json$/;

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
  }
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

export function stableCru34ArtifactJson(value) {
  return `${JSON.stringify(canonicalValue(value), null, 2)}\n`;
}

export function cru34ArtifactSha256(value) {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(String(value), 'utf8');
  return crypto.createHash('sha256').update(bytes).digest('hex');
}

function digestCanonical(value) {
  return cru34ArtifactSha256(stableCru34ArtifactJson(value));
}

function requiredText(value, code) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(code);
  return value.trim();
}

function requiredIso(value, code) {
  const text = requiredText(value, code);
  if (!Number.isFinite(Date.parse(text))) throw new Error(code);
  return text;
}

function requiredOrdinal(value, code) {
  if (!Number.isInteger(value) || value < 1) throw new Error(code);
  return value;
}

function requiredSha256(value, code) {
  const text = requiredText(value, code).toLowerCase();
  if (!SHA256_PATTERN.test(text)) throw new Error(code);
  return text;
}

function requiredObject(value, code) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(code);
  return value;
}

function requiredOwn(object, key, code) {
  if (!Object.hasOwn(object, key)) throw new Error(code);
  return object[key];
}

function requiredNullableFinite(object, key, code) {
  const value = requiredOwn(object, key, code);
  if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw new Error(code);
  return value;
}

function requiredStringArray(value, code, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)
      || value.some((entry) => typeof entry !== 'string' || !entry.trim())) {
    throw new Error(code);
  }
  return value;
}

function validateWindow(window, expectedWindowMs) {
  requiredObject(window, 'CRU36_CONTRACT_WINDOW_INVALID');
  if (window.windowMs !== expectedWindowMs) throw new Error('CRU36_CONTRACT_WINDOW_INVALID');
  requiredText(window.status, 'CRU36_CONTRACT_WINDOW_STATUS_REQUIRED');
  requiredOwn(window, 'unavailableReason', 'CRU36_CONTRACT_WINDOW_REASON_REQUIRED');
  if (!Array.isArray(window.supportingEvidence) || !Array.isArray(window.contraryEvidence)) {
    throw new Error('CRU36_CONTRACT_EVIDENCE_INVALID');
  }

  const pressure = requiredObject(window.pressure, 'CRU36_CONTRACT_PRESSURE_INVALID');
  for (const key of ['status', 'direction', 'relativeIntensity', 'controlObservationState']) {
    requiredText(pressure[key], 'CRU36_CONTRACT_PRESSURE_INVALID');
  }
  requiredOwn(pressure, 'unavailableReason', 'CRU36_CONTRACT_PRESSURE_INVALID');
  requiredNullableFinite(pressure, 'pressureRatio', 'CRU36_CONTRACT_PRESSURE_INVALID');
  requiredNullableFinite(pressure, 'classifiedCoverage', 'CRU36_CONTRACT_PRESSURE_INVALID');

  const response = requiredObject(window.response, 'CRU36_CONTRACT_RESPONSE_INVALID');
  requiredText(response.status, 'CRU36_CONTRACT_RESPONSE_INVALID');
  requiredText(response.directionRelation, 'CRU36_CONTRACT_RESPONSE_INVALID');
  requiredNullableFinite(response, 'displacementPoints', 'CRU36_CONTRACT_RESPONSE_INVALID');
  requiredNullableFinite(response, 'displacementTicks', 'CRU36_CONTRACT_RESPONSE_INVALID');

  const pathEfficiency = requiredObject(window.pathEfficiency, 'CRU36_CONTRACT_PATH_INVALID');
  requiredText(pathEfficiency.status, 'CRU36_CONTRACT_PATH_INVALID');
  requiredOwn(pathEfficiency, 'unavailableReason', 'CRU36_CONTRACT_PATH_INVALID');
  requiredNullableFinite(pathEfficiency, 'value', 'CRU36_CONTRACT_PATH_INVALID');

  const quality = requiredObject(window.quality, 'CRU36_CONTRACT_QUALITY_INVALID');
  requiredText(quality.status, 'CRU36_CONTRACT_QUALITY_INVALID');
  requiredStringArray(quality.reasons, 'CRU36_CONTRACT_QUALITY_INVALID');
}

function assertSafety(value, code = 'CRU36_ARTIFACT_SAFETY_INVALID') {
  if (value?.formalWeight !== 0 || value?.researchOnly !== true
      || value?.executionAuthorized !== false || value?.orderRoutesEnabled !== false) {
    throw new Error(code);
  }
}

function containsForbiddenKey(value) {
  if (Array.isArray(value)) return value.some(containsForbiddenKey);
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, nested]) => (
    key === 'usedEvents' || key === 'credentials' || key === 'accountId'
      || key === 'accountIdentifier' || key === 'sourcePath' || containsForbiddenKey(nested)
  ));
}

function validateSemanticPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('CRU36_SEMANTIC_PAYLOAD_INVALID');
  }
  if (payload.schemaVersion !== CRU34_SNAPSHOT_CONTRACT_VERSION) {
    throw new Error('CRU36_CONTRACT_SCHEMA_UNSUPPORTED');
  }
  if (payload.sourceMode !== CRU34_SOURCE_MODE_HISTORICAL) {
    throw new Error('CRU36_SOURCE_MODE_INVALID');
  }
  requiredText(payload.instrument, 'CRU36_INSTRUMENT_REQUIRED');
  requiredText(payload.actualContract, 'CRU36_ACTUAL_CONTRACT_REQUIRED');
  requiredText(payload.tradeDate, 'CRU36_TRADE_DATE_REQUIRED');
  requiredText(payload.session, 'CRU36_SESSION_REQUIRED');
  requiredText(payload.continuityEpoch, 'CRU36_CONTINUITY_EPOCH_REQUIRED');
  requiredIso(payload.availableAt, 'CRU36_AVAILABLE_AT_REQUIRED');
  requiredOrdinal(payload.cutoffLedgerOrdinal, 'CRU36_CUTOFF_ORDINAL_REQUIRED');
  requiredText(payload.cutoffRecordHash, 'CRU36_CUTOFF_HASH_REQUIRED');
  requiredOrdinal(payload.maxUsedLedgerOrdinal, 'CRU36_MAX_USED_ORDINAL_REQUIRED');
  requiredText(payload.maxUsedRecordHash, 'CRU36_MAX_USED_HASH_REQUIRED');
  const sourceIdentity = requiredText(payload.sourceLedgerIdentity, 'CRU36_SOURCE_IDENTITY_REQUIRED');
  if (!/^sha256:[a-f0-9]{64}$/.test(sourceIdentity)) throw new Error('CRU36_SOURCE_IDENTITY_INVALID');
  if (!payload.primary60s || !payload.context300s || !payload.pressure
      || !payload.response || !payload.pathEfficiency || !payload.quality
      || !Array.isArray(payload.qualityReasons) || !payload.promotionState
      || !payload.methodology || !Array.isArray(payload.limitations)) {
    throw new Error('CRU36_CONTRACT_STRUCTURE_INVALID');
  }
  validateWindow(payload.primary60s, 60_000);
  validateWindow(payload.context300s, 300_000);
  requiredStringArray(payload.qualityReasons, 'CRU36_CONTRACT_QUALITY_INVALID');
  const quality = requiredObject(payload.quality, 'CRU36_CONTRACT_QUALITY_INVALID');
  requiredText(quality.status, 'CRU36_CONTRACT_QUALITY_INVALID');
  requiredStringArray(quality.reasons, 'CRU36_CONTRACT_QUALITY_INVALID');
  for (const key of [
    'classifiedCoveragePrimary60s', 'classifiedCoverageContext300s',
    'bestQuoteMatchedCoveragePrimary60s', 'bestQuoteMatchedCoverageContext300s',
    'classificationConflictRatePrimary60s', 'classificationConflictRateContext300s',
  ]) {
    requiredNullableFinite(quality, key, 'CRU36_CONTRACT_QUALITY_INVALID');
  }
  const promotion = requiredObject(payload.promotionState, 'CRU36_CONTRACT_PROMOTION_INVALID');
  for (const key of ['relativeIntensity', 'controlObservationState', 'absorption', 'marketState']) {
    requiredText(promotion[key], 'CRU36_CONTRACT_PROMOTION_INVALID');
  }
  const methodology = requiredObject(payload.methodology, 'CRU36_CONTRACT_METHODOLOGY_INVALID');
  for (const key of ['pressure', 'response', 'pathEfficiency', 'observationOrder', 'availableAt', 'inputPrefix']) {
    requiredText(methodology[key], 'CRU36_CONTRACT_METHODOLOGY_INVALID');
  }
  requiredStringArray(payload.limitations, 'CRU36_CONTRACT_LIMITATIONS_INVALID', { allowEmpty: false });
  const coherent = digestCanonical(payload.pressure.primary60s) === digestCanonical(payload.primary60s.pressure)
    && digestCanonical(payload.pressure.context300s) === digestCanonical(payload.context300s.pressure)
    && digestCanonical(payload.response.primary60s) === digestCanonical(payload.primary60s.response)
    && digestCanonical(payload.response.context300s) === digestCanonical(payload.context300s.response)
    && digestCanonical(payload.pathEfficiency.primary60s) === digestCanonical(payload.primary60s.pathEfficiency)
    && digestCanonical(payload.pathEfficiency.context300s) === digestCanonical(payload.context300s.pathEfficiency)
    && digestCanonical(payload.qualityReasons) === digestCanonical(payload.quality.reasons);
  if (!coherent) throw new Error('CRU36_CONTRACT_VIEW_INCONSISTENT');
  if (payload.cutoffLedgerOrdinal < payload.maxUsedLedgerOrdinal) {
    throw new Error('CRU36_LINEAGE_ORDINAL_INVALID');
  }
  if (payload.cutoffLedgerOrdinal === payload.maxUsedLedgerOrdinal
      && payload.cutoffRecordHash !== payload.maxUsedRecordHash) {
    throw new Error('CRU36_LINEAGE_HASH_CONTRADICTION');
  }
  assertSafety(payload);
  if (containsForbiddenKey(payload)) throw new Error('CRU36_FORBIDDEN_RAW_OR_PRIVATE_FIELD');
  return payload;
}

export function buildCru34HistoricalSemanticPayload(snapshot) {
  if (snapshot?.schemaVersion !== 'cru34-tx-intraday-research-snapshot-v1') {
    throw new Error('CRU36_CRU34_SNAPSHOT_SCHEMA_UNSUPPORTED');
  }
  if (snapshot.status === 'UNAVAILABLE') {
    const reason = String(snapshot.unavailableReason || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '_');
    const prefix = String(snapshot.lineage?.inputPrefixStatus || 'UNKNOWN').replace(/[^A-Z0-9_]/g, '_');
    throw new Error(`CRU36_CRU34_SNAPSHOT_UNAVAILABLE:${reason}:${prefix}`);
  }
  assertSafety(snapshot, 'CRU36_CRU34_SNAPSHOT_SAFETY_INVALID');
  const identity = snapshot.identity || {};
  const lineage = snapshot.lineage || {};
  const primary60s = snapshot.windows?.primary60s;
  const context300s = snapshot.windows?.context300s;
  const payload = {
    schemaVersion: CRU34_SNAPSHOT_CONTRACT_VERSION,
    sourceMode: CRU34_SOURCE_MODE_HISTORICAL,
    instrument: identity.instrument,
    actualContract: identity.actualContract,
    tradeDate: identity.tradeDate,
    session: identity.session,
    continuityEpoch: identity.continuityEpoch,
    availableAt: lineage.availableAt,
    cutoffLedgerOrdinal: lineage.cutoffLedgerOrdinal,
    cutoffRecordHash: lineage.cutoffRecordHash,
    maxUsedLedgerOrdinal: lineage.maxUsedLedgerOrdinal,
    maxUsedRecordHash: lineage.maxUsedRecordHash,
    sourceLedgerIdentity: lineage.sourceLedgerIdentity,
    primary60s,
    context300s,
    pressure: {
      primary60s: primary60s?.pressure,
      context300s: context300s?.pressure,
    },
    response: {
      primary60s: primary60s?.response,
      context300s: context300s?.response,
    },
    pathEfficiency: {
      primary60s: primary60s?.pathEfficiency,
      context300s: context300s?.pathEfficiency,
    },
    quality: snapshot.quality,
    qualityReasons: snapshot.quality?.reasons || [],
    promotionState: snapshot.promotionState,
    methodology: snapshot.methodology,
    limitations: snapshot.limitations,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  const canonical = canonicalValue(payload);
  validateSemanticPayload(canonical);
  return deepFreeze(canonical);
}

function identityMaterial(semanticPayload, semanticContentHash) {
  return {
    artifactSchemaVersion: CRU34_ARTIFACT_SCHEMA_VERSION,
    contractSchemaVersion: semanticPayload.schemaVersion,
    sourceMode: semanticPayload.sourceMode,
    instrument: semanticPayload.instrument,
    actualContract: semanticPayload.actualContract,
    tradeDate: semanticPayload.tradeDate,
    session: semanticPayload.session,
    continuityEpoch: semanticPayload.continuityEpoch,
    cutoffLedgerOrdinal: semanticPayload.cutoffLedgerOrdinal,
    cutoffRecordHash: semanticPayload.cutoffRecordHash,
    sourceLedgerIdentity: semanticPayload.sourceLedgerIdentity,
    semanticContentHash,
  };
}

function artifactIdentityFor(semanticPayload, semanticContentHash) {
  return `cru34-historical-${digestCanonical(identityMaterial(semanticPayload, semanticContentHash))}`;
}

function selectionIdentity(semanticPayload) {
  return {
    schemaVersion: semanticPayload.schemaVersion,
    actualContract: semanticPayload.actualContract,
    tradeDate: semanticPayload.tradeDate,
    session: semanticPayload.session,
    continuityEpoch: semanticPayload.continuityEpoch,
    sourceLedgerIdentity: semanticPayload.sourceLedgerIdentity,
  };
}

export function cru34SelectionKey(identity) {
  const normalized = {
    schemaVersion: requiredText(identity?.schemaVersion, 'CRU36_SELECTOR_SCHEMA_REQUIRED'),
    actualContract: requiredText(identity?.actualContract, 'CRU36_SELECTOR_CONTRACT_REQUIRED'),
    tradeDate: requiredText(identity?.tradeDate, 'CRU36_SELECTOR_TRADE_DATE_REQUIRED'),
    session: requiredText(identity?.session, 'CRU36_SELECTOR_SESSION_REQUIRED'),
    continuityEpoch: requiredText(identity?.continuityEpoch, 'CRU36_SELECTOR_EPOCH_REQUIRED'),
    sourceLedgerIdentity: requiredText(identity?.sourceLedgerIdentity, 'CRU36_SELECTOR_SOURCE_REQUIRED'),
  };
  if (normalized.schemaVersion !== CRU34_SNAPSHOT_CONTRACT_VERSION) {
    throw new Error('CRU36_SELECTOR_SCHEMA_UNSUPPORTED');
  }
  if (!/^sha256:[a-f0-9]{64}$/.test(normalized.sourceLedgerIdentity)) {
    throw new Error('CRU36_SELECTOR_SOURCE_INVALID');
  }
  return digestCanonical(normalized).slice(0, 24);
}

export function cru34ArtifactFileName(artifact) {
  const selectionKey = cru34SelectionKey(selectionIdentity(artifact.semanticPayload));
  const ordinal = String(artifact.semanticPayload.cutoffLedgerOrdinal).padStart(16, '0');
  const identityDigest = artifact.artifactIdentity.replace(/^cru34-historical-/, '');
  return `${selectionKey}.${ordinal}.${identityDigest}.json`;
}

export function buildCru34SnapshotArtifact(semanticPayload, {
  materializedAt = new Date().toISOString(),
  writerVersion = CRU34_ARTIFACT_SCHEMA_VERSION,
  sourceLedgerSha256,
  sourceLedgerByteSize,
  sourcePrefixRecordCount,
  sourcePrefixByteSize,
} = {}) {
  validateSemanticPayload(semanticPayload);
  const sourceSha = requiredSha256(sourceLedgerSha256, 'CRU36_SOURCE_SHA256_REQUIRED');
  if (semanticPayload.sourceLedgerIdentity !== `sha256:${sourceSha}`) {
    throw new Error('CRU36_SOURCE_IDENTITY_SHA_MISMATCH');
  }
  if (!Number.isInteger(sourceLedgerByteSize) || sourceLedgerByteSize < 1
      || !Number.isInteger(sourcePrefixRecordCount) || sourcePrefixRecordCount < 1
      || !Number.isInteger(sourcePrefixByteSize) || sourcePrefixByteSize < 1) {
    throw new Error('CRU36_SOURCE_SCALE_INVALID');
  }
  if (sourcePrefixRecordCount !== semanticPayload.cutoffLedgerOrdinal
      || sourcePrefixByteSize > sourceLedgerByteSize) {
    throw new Error('CRU36_SOURCE_SCALE_LINEAGE_MISMATCH');
  }
  const semanticContentHash = digestCanonical(semanticPayload);
  const artifactIdentity = artifactIdentityFor(semanticPayload, semanticContentHash);
  const withoutHash = {
    artifactSchemaVersion: CRU34_ARTIFACT_SCHEMA_VERSION,
    artifactIdentity,
    semanticContentHash,
    semanticPayload,
    operationalEnvelope: {
      materializedAt: requiredIso(materializedAt, 'CRU36_MATERIALIZED_AT_INVALID'),
      writerVersion: requiredText(writerVersion, 'CRU36_WRITER_VERSION_REQUIRED'),
      sourceLedgerSha256: sourceSha,
      sourceLedgerByteSize,
      sourcePrefixRecordCount,
      sourcePrefixByteSize,
    },
  };
  const artifactHash = digestCanonical(withoutHash);
  return deepFreeze(canonicalValue({ ...withoutHash, artifactHash }));
}

export function validateCru34SnapshotArtifact(artifact, { fileName = null } = {}) {
  if (!artifact || typeof artifact !== 'object' || Array.isArray(artifact)) {
    throw new Error('CRU36_ARTIFACT_STRUCTURE_INVALID');
  }
  if (artifact.artifactSchemaVersion !== CRU34_ARTIFACT_SCHEMA_VERSION) {
    throw new Error('CRU36_ARTIFACT_SCHEMA_UNSUPPORTED');
  }
  validateSemanticPayload(artifact.semanticPayload);
  const semanticContentHash = requiredSha256(
    artifact.semanticContentHash,
    'CRU36_SEMANTIC_HASH_INVALID',
  );
  if (digestCanonical(artifact.semanticPayload) !== semanticContentHash) {
    throw new Error('CRU36_SEMANTIC_HASH_MISMATCH');
  }
  const expectedIdentity = artifactIdentityFor(artifact.semanticPayload, semanticContentHash);
  if (artifact.artifactIdentity !== expectedIdentity) throw new Error('CRU36_ARTIFACT_IDENTITY_MISMATCH');
  const envelope = artifact.operationalEnvelope;
  requiredIso(envelope?.materializedAt, 'CRU36_MATERIALIZED_AT_INVALID');
  requiredText(envelope?.writerVersion, 'CRU36_WRITER_VERSION_REQUIRED');
  const sourceSha = requiredSha256(envelope?.sourceLedgerSha256, 'CRU36_SOURCE_SHA256_REQUIRED');
  if (artifact.semanticPayload.sourceLedgerIdentity !== `sha256:${sourceSha}`) {
    throw new Error('CRU36_SOURCE_IDENTITY_SHA_MISMATCH');
  }
  if (!Number.isInteger(envelope?.sourceLedgerByteSize) || envelope.sourceLedgerByteSize < 1
      || !Number.isInteger(envelope?.sourcePrefixRecordCount) || envelope.sourcePrefixRecordCount < 1
      || !Number.isInteger(envelope?.sourcePrefixByteSize) || envelope.sourcePrefixByteSize < 1) {
    throw new Error('CRU36_SOURCE_SCALE_INVALID');
  }
  if (envelope.sourcePrefixRecordCount !== artifact.semanticPayload.cutoffLedgerOrdinal
      || envelope.sourcePrefixByteSize > envelope.sourceLedgerByteSize) {
    throw new Error('CRU36_SOURCE_SCALE_LINEAGE_MISMATCH');
  }
  const artifactHash = requiredSha256(artifact.artifactHash, 'CRU36_ARTIFACT_HASH_INVALID');
  const { artifactHash: ignored, ...withoutHash } = artifact;
  if (digestCanonical(withoutHash) !== artifactHash) throw new Error('CRU36_ARTIFACT_HASH_MISMATCH');
  if (fileName && cru34ArtifactFileName(artifact) !== fileName) {
    throw new Error('CRU36_ARTIFACT_FILENAME_IDENTITY_MISMATCH');
  }
  if (containsForbiddenKey(artifact)) throw new Error('CRU36_FORBIDDEN_RAW_OR_PRIVATE_FIELD');
  return artifact;
}

function readValidatedArtifactFile(filePath, { expectedFileName = path.basename(filePath) } = {}) {
  const stat = fs.statSync(filePath);
  if (!stat.isFile()) throw new Error('CRU36_ARTIFACT_NOT_FILE');
  if (stat.size < 1 || stat.size > CRU34_MAX_ARTIFACT_BYTES) {
    throw new Error('CRU36_ARTIFACT_SIZE_INVALID');
  }
  const bytes = fs.readFileSync(filePath);
  let artifact;
  try {
    artifact = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw new Error('CRU36_ARTIFACT_JSON_INVALID');
  }
  validateCru34SnapshotArtifact(artifact, { fileName: expectedFileName });
  return Object.freeze({ artifact: deepFreeze(artifact), bytes });
}

function removeTempIfPresent(tempPath) {
  try {
    if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
  } catch {
    // Preserve the primary failure; selection ignores non-json temporary files.
  }
}

export function writeCru34SnapshotArtifact(artifactRoot, artifact) {
  validateCru34SnapshotArtifact(artifact);
  const root = path.resolve(requiredText(artifactRoot, 'CRU36_ARTIFACT_ROOT_REQUIRED'));
  fs.mkdirSync(root, { recursive: true });
  const fileName = cru34ArtifactFileName(artifact);
  const filePath = path.join(root, fileName);
  const bytes = Buffer.from(stableCru34ArtifactJson(artifact), 'utf8');
  if (bytes.length > CRU34_MAX_ARTIFACT_BYTES) throw new Error('CRU36_ARTIFACT_SIZE_INVALID');

  if (fs.existsSync(filePath)) {
    const existing = readValidatedArtifactFile(filePath).artifact;
    if (existing.artifactIdentity !== artifact.artifactIdentity
        || existing.semanticContentHash !== artifact.semanticContentHash) {
      throw new Error('CRU36_IMMUTABLE_ARTIFACT_CONFLICT');
    }
    return Object.freeze({ filePath, fileName, artifact: existing, reused: true, byteSize: fs.statSync(filePath).size });
  }

  const tempPath = path.join(root, `.${fileName}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = fs.openSync(tempPath, 'wx', 0o600);
    fs.writeFileSync(handle, bytes);
    fs.fsyncSync(handle);
    fs.closeSync(handle);
    handle = null;
    readValidatedArtifactFile(tempPath, { expectedFileName: fileName });
    try {
      fs.linkSync(tempPath, filePath);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      const existing = readValidatedArtifactFile(filePath).artifact;
      if (existing.artifactIdentity !== artifact.artifactIdentity
          || existing.semanticContentHash !== artifact.semanticContentHash) {
        throw new Error('CRU36_IMMUTABLE_ARTIFACT_CONFLICT');
      }
      removeTempIfPresent(tempPath);
      return Object.freeze({ filePath, fileName, artifact: existing, reused: true, byteSize: fs.statSync(filePath).size });
    }
    removeTempIfPresent(tempPath);
    const accepted = readValidatedArtifactFile(filePath).artifact;
    return Object.freeze({ filePath, fileName, artifact: accepted, reused: false, byteSize: bytes.length });
  } catch (error) {
    if (handle != null) fs.closeSync(handle);
    removeTempIfPresent(tempPath);
    throw error;
  }
}

function unavailable(reason, details = {}) {
  return Object.freeze({
    truthState: 'UNAVAILABLE',
    unavailableReason: reason,
    snapshot: null,
    ...details,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

function publicSnapshot(artifact, truthState) {
  return Object.freeze({
    ...artifact.semanticPayload,
    materializedAt: artifact.operationalEnvelope.materializedAt,
    artifactIdentity: artifact.artifactIdentity,
    semanticContentHash: artifact.semanticContentHash,
    artifactHash: artifact.artifactHash,
    truthState,
  });
}

function reasonForReadError(error) {
  const code = String(error?.message || 'CRU36_ARTIFACT_INVALID');
  if (code === 'CRU36_ARTIFACT_JSON_INVALID') return 'ARTIFACT_CORRUPT_JSON';
  if (code === 'CRU36_ARTIFACT_SCHEMA_UNSUPPORTED' || code === 'CRU36_CONTRACT_SCHEMA_UNSUPPORTED') {
    return 'ARTIFACT_SCHEMA_UNSUPPORTED';
  }
  if (code.includes('SEMANTIC_HASH')) return 'SEMANTIC_CONTENT_HASH_INVALID';
  if (code.includes('ARTIFACT_HASH')) return 'ARTIFACT_HASH_INVALID';
  if (code.includes('SOURCE_IDENTITY') || code.includes('SOURCE_SHA')) return 'SOURCE_IDENTITY_INVALID';
  if (code.includes('HASH')) return 'ARTIFACT_HASH_INVALID';
  if (code.includes('IDENTITY') || code.includes('FILENAME')) return 'ARTIFACT_IDENTITY_INVALID';
  if (code.includes('SIZE')) return 'ARTIFACT_SIZE_INVALID';
  return 'ARTIFACT_INVALID';
}

export function readCru34SnapshotArtifact({ artifactPath, expectedIdentity = null, freshnessCutoff = null } = {}) {
  if (!artifactPath || !fs.existsSync(artifactPath)) return unavailable('ARTIFACT_MISSING');
  let artifact;
  try {
    artifact = readValidatedArtifactFile(path.resolve(artifactPath)).artifact;
  } catch (error) {
    return unavailable(reasonForReadError(error));
  }
  if (expectedIdentity) {
    const actual = selectionIdentity(artifact.semanticPayload);
    for (const key of [
      'schemaVersion', 'actualContract', 'tradeDate', 'session', 'continuityEpoch',
      'sourceLedgerIdentity',
    ]) {
      if (actual[key] !== expectedIdentity[key]) return unavailable('ARTIFACT_IDENTITY_MISMATCH');
    }
  }
  let truthState = 'HISTORICAL';
  if (freshnessCutoff != null) {
    let cutoff;
    try {
      cutoff = Date.parse(requiredIso(freshnessCutoff, 'CRU36_FRESHNESS_CUTOFF_INVALID'));
    } catch {
      return unavailable('FRESHNESS_CUTOFF_INVALID');
    }
    if (Date.parse(artifact.semanticPayload.availableAt) < cutoff) truthState = 'STALE';
  }
  return Object.freeze({
    truthState,
    unavailableReason: null,
    snapshot: publicSnapshot(artifact, truthState),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function selectCru34SnapshotArtifact({ artifactRoot, selector, freshnessCutoff = null } = {}) {
  let root;
  let selectionKey;
  try {
    root = path.resolve(requiredText(artifactRoot, 'CRU36_ARTIFACT_ROOT_REQUIRED'));
    selectionKey = cru34SelectionKey(selector);
  } catch (error) {
    if (String(error?.message || '').includes('SCHEMA')) return unavailable('ARTIFACT_SCHEMA_UNSUPPORTED');
    return unavailable('ARTIFACT_IDENTITY_INVALID');
  }
  if (!fs.existsSync(root)) return unavailable('ARTIFACT_ROOT_MISSING');
  const candidates = [];
  let directory;
  try {
    directory = fs.opendirSync(root);
    let entryCount = 0;
    let entry;
    while ((entry = directory.readSync()) !== null) {
      entryCount += 1;
      if (entryCount > CRU34_MAX_DIRECTORY_ENTRIES) {
        return unavailable('ARTIFACT_DIRECTORY_ENTRY_LIMIT_EXCEEDED');
      }
      if (!entry.isFile() || !entry.name.startsWith(`${selectionKey}.`) || !entry.name.endsWith('.json')) {
        continue;
      }
      const match = SAFE_SELECTION_PATTERN.exec(entry.name);
      candidates.push(match ? { name: entry.name, ordinal: Number(match[2]) } : { name: entry.name, ordinal: -1 });
      if (candidates.length > CRU34_MAX_SELECTION_CANDIDATES) {
        return unavailable('ARTIFACT_SELECTION_CANDIDATE_LIMIT_EXCEEDED');
      }
    }
  } catch {
    return unavailable('ARTIFACT_ROOT_UNREADABLE');
  } finally {
    try { directory?.closeSync(); } catch { /* fail-closed result already determined */ }
  }
  candidates.sort((left, right) => right.ordinal - left.ordinal || right.name.localeCompare(left.name));
  if (!candidates.length) return unavailable('ARTIFACT_NOT_FOUND_FOR_IDENTITY');
  const newest = candidates[0];
  if (newest.ordinal < 1) return unavailable('ARTIFACT_FILENAME_INVALID');
  return readCru34SnapshotArtifact({
    artifactPath: path.join(root, newest.name),
    expectedIdentity: selector,
    freshnessCutoff,
  });
}

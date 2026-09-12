import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { readCru34SnapshotArtifact, CRU34_MAX_ARTIFACT_BYTES } from './cru34-snapshot-artifact.mjs';
import { readCru34LiveSnapshot } from './dashboard-observed-flow.mjs';

const WINDOWS = Object.freeze({ primary60s: '1m', context300s: '5m', window900s: '15m', window1800s: '30m', window3600s: '1h', window14400s: '4h' });
const hash = (bytes) => crypto.createHash('sha256').update(bytes).digest('hex');
const finiteTime = (value) => typeof value === 'string' && Number.isFinite(Date.parse(value));

function summarizeWindow(value, label, cutoffValidated, sourceTruthState = 'HISTORICAL') {
  const evidence = value?.evidence || (value?.pressure ? value : null);
  const pressure = evidence?.pressure?.status || 'UNKNOWN';
  const response = evidence?.response?.status || 'UNKNOWN';
  const pathEfficiency = evidence?.pathEfficiency?.status || 'UNKNOWN';
  const known = [pressure, response, pathEfficiency].every((status) => status !== 'UNKNOWN');
  return {
    window: label,
    truthState: value?.truthState || (evidence ? sourceTruthState : 'UNKNOWN'),
    status: evidence?.status || (value?.truthState === 'WARMING_UP' ? 'WARMING_UP' : 'UNKNOWN'),
    pressure, response, pathEfficiency,
    researchEligibility: !cutoffValidated ? 'UNKNOWN'
      : value?.truthState === 'WARMING_UP' ? 'NOT_READY'
        : !known ? 'UNKNOWN'
          : [pressure, response, pathEfficiency].every((status) => status === 'READY') ? 'READY' : 'NOT_READY',
    reasonCodes: [...new Set([
      value?.unavailableReason, evidence?.unavailableReason,
      evidence?.pressure?.unavailableReason, evidence?.response?.unavailableReason,
      evidence?.pathEfficiency?.unavailableReason, ...(evidence?.quality?.reasons || []),
    ].filter((value) => typeof value === 'string'))],
  };
}

function cutoffMatches(snapshot, liveEvidence) {
  // These proofs must come from the acceptance reader's verified immutable ledger prefix.
  // A file's calendar date or an unbound worker checkpoint is never a source proof.
  return (liveEvidence?.derivedCutoffProofs || []).some((proof) => proof.verified === true
    && ['sourceLedgerIdentity', 'cutoffLedgerOrdinal', 'cutoffRecordHash', 'tradeDate', 'session', 'actualContract', 'availableAt']
      .every((key) => proof[key] === snapshot[key]));
}

/** Read supplied existing projections only. Does not produce projections or read runtime status/locks. */
export function readDailyDerivedEvidence({ artifactPaths = [], tradeDate, sessions = ['DAY', 'NIGHT'], generatedAt, liveEvidence = null } = {}) {
  if (!Array.isArray(artifactPaths) || artifactPaths.length > 128) throw new Error('DERIVED_ARTIFACT_SELECTION_LIMIT');
  if (!finiteTime(generatedAt)) throw new Error('DERIVED_GENERATED_AT_INVALID');
  const requestedSessions = new Set(Array.isArray(sessions) ? sessions : Object.keys(sessions || {}));
  const entries = [];
  const unavailableArtifacts = [];

  for (const artifactPath of [...new Set(artifactPaths.map((item) => path.resolve(item)))].sort()) {
    const file = path.basename(artifactPath);
    let bytes;
    let parsed;
    try {
      const stat = fs.statSync(artifactPath);
      if (!stat.isFile() || stat.size < 1 || stat.size > CRU34_MAX_ARTIFACT_BYTES) throw new Error('ARTIFACT_SIZE_INVALID');
      bytes = fs.readFileSync(artifactPath);
      if (bytes.length !== stat.size) throw new Error('ARTIFACT_CHANGED_DURING_READ');
      parsed = JSON.parse(bytes.toString('utf8'));
    } catch {
      unavailableArtifacts.push({ file, reasonCode: 'DERIVED_ARTIFACT_UNREADABLE', state: 'UNKNOWN' });
      continue;
    }
    const historical = parsed.artifactSchemaVersion === 'cru34-snapshot-artifact-v1';
    const result = historical
      ? readCru34SnapshotArtifact({ artifactPath })
      : readCru34LiveSnapshot({ snapshotPath: artifactPath, now: new Date(generatedAt) });
    // Both existing readers reopen the file. Bind their validation to exactly the bytes identified here.
    let sameBytes = false;
    try { sameBytes = hash(bytes) === hash(fs.readFileSync(artifactPath)); } catch { /* unknown */ }
    if (!result.snapshot || !sameBytes || result.snapshot.semanticContentHash !== parsed.semanticContentHash) {
      unavailableArtifacts.push({ file, reasonCode: sameBytes ? result.unavailableReason || 'DERIVED_VALIDATION_FAILED' : 'DERIVED_ARTIFACT_CHANGED_DURING_READ', state: 'UNKNOWN' });
      continue;
    }
    const snapshot = result.snapshot;
    if (snapshot.tradeDate !== tradeDate || !requestedSessions.has(snapshot.session)) continue;
    const artifactGeneratedAt = historical ? parsed.operationalEnvelope.materializedAt : parsed.observedAt;
    if (!finiteTime(snapshot.availableAt) || !finiteTime(artifactGeneratedAt)
        || Date.parse(snapshot.availableAt) > Date.parse(artifactGeneratedAt)
        || Date.parse(artifactGeneratedAt) > Date.parse(generatedAt)) {
      unavailableArtifacts.push({ file, reasonCode: 'DERIVED_OUTSIDE_IMMUTABLE_CUTOFF', state: 'UNKNOWN' });
      continue;
    }
    const identityComplete = Boolean(snapshot.actualContract && snapshot.continuityEpoch
      && /^sha256:[a-f0-9]{64}$/.test(snapshot.sourceLedgerIdentity || '')
      && Number.isInteger(snapshot.cutoffLedgerOrdinal) && snapshot.cutoffLedgerOrdinal > 0
      && typeof snapshot.cutoffRecordHash === 'string' && snapshot.cutoffRecordHash.length > 0);
    // Live envelopes retain their current semantics. Their operational hash is persistence evidence,
    // but does not prove frozen historical semantics or bind a source prefix.
    const cutoffValidated = historical && identityComplete && cutoffMatches(snapshot, liveEvidence);
    const windows = Object.fromEntries(Object.entries(WINDOWS).map(([key, label]) => [key, summarizeWindow(snapshot[key], label, cutoffValidated, result.truthState)]));
    const states = Object.values(windows).map((item) => item.researchEligibility);
    const researchEligibility = !cutoffValidated ? 'UNKNOWN'
      : states.includes('NOT_READY') ? 'NOT_READY'
        : states.every((state) => state === 'READY') ? 'READY'
          : states.includes('READY') ? 'READY_WITH_LIMITATION' : 'UNKNOWN';
    const reasonCodes = [
      ...(!historical ? ['LIVE_ARTIFACT_IMMUTABILITY_UNPROVEN'] : []),
      ...(!cutoffValidated ? ['DERIVED_SOURCE_CUTOFF_UNVERIFIED'] : []),
      ...Object.values(windows).flatMap((item) => item.reasonCodes),
    ];

    entries.push({
      tradeDate: snapshot.tradeDate, session: snapshot.session, actualContract: snapshot.actualContract || null,
      continuityEpoch: snapshot.continuityEpoch || null,
      availableAt: snapshot.availableAt, generatedAt: artifactGeneratedAt,
      firstReceivedAt: snapshot.availableAt, lastReceivedAt: snapshot.availableAt,
      captureState: 'PASS', persistenceState: 'PASS', integrityState: cutoffValidated ? 'PASS' : 'UNKNOWN',
      cutoffValidated, researchEligibility, evidenceStrength: 'DERIVED_ARTIFACT',
      bytes: bytes.length, recordCount: 1, windows, reasonCodes: [...new Set(reasonCodes)],
      sourceArtifactIdentity: {
        type: historical ? 'validated-historical-projection' : 'validated-live-projection-scan-bytes',
        file, sha256: hash(bytes), artifactHash: parsed.artifactHash || parsed.snapshotHash,
        semanticContentHash: parsed.semanticContentHash,
        sourceLedgerIdentity: snapshot.sourceLedgerIdentity,
        cutoffLedgerOrdinal: snapshot.cutoffLedgerOrdinal, cutoffRecordHash: snapshot.cutoffRecordHash,
      },
    });
  }
  const selectedEntries = [];
  for (const session of [...requestedSessions].sort()) {
    const candidates = entries.filter((entry) => entry.session === session)
      .sort((a, b) => Date.parse(b.generatedAt) - Date.parse(a.generatedAt)
        || a.sourceArtifactIdentity.sha256.localeCompare(b.sourceArtifactIdentity.sha256));
    if (!candidates.length) continue;
    const newest = candidates[0];
    const tied = candidates.filter((entry) => Date.parse(entry.generatedAt) === Date.parse(newest.generatedAt));
    if (new Set(tied.map((entry) => entry.sourceArtifactIdentity.semanticContentHash)).size > 1) {
      unavailableArtifacts.push({ session, files: tied.map((entry) => entry.sourceArtifactIdentity.file), reasonCode: 'DERIVED_ARTIFACT_SELECTION_AMBIGUOUS', state: 'UNKNOWN' });
      continue;
    }
    selectedEntries.push(newest);
  }
  return { entries: selectedEntries, unavailableArtifacts,
    artifactBytes: selectedEntries.length ? selectedEntries.reduce((total, entry) => total + entry.bytes, 0) : null };
}



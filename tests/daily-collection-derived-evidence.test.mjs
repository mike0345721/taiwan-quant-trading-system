import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { readDailyDerivedEvidence } from '../src/daily-collection-derived-evidence.mjs';
import { buildTxIntradayResearchSnapshot } from '../src/tx-intraday-research-snapshot.mjs';
import { buildCru34HistoricalSemanticPayload, buildCru34SnapshotArtifact, cru34ArtifactFileName, stableCru34ArtifactJson } from '../src/cru34-snapshot-artifact.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'daily-derived-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let previousHash = 'GENESIS';
  const records = [1, 11, 21].map((second, index) => {
    const eventTime = `2026-09-09T09:00:${String(second).padStart(2, '0')}.000+08:00`;
    const recordHash = `tick-${index}`;
    const record = {
      kind: 'futures_tick', code: 'TXFI6', product: 'TXFI6', receivedAt: eventTime,
      exchangeTimestamp: eventTime, previousHash, recordHash, duplicate: false,
      formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false,
      payload: { code: 'TXFI6', productFamily: 'TX', actualContract: 'TXFI6', eventTime, datetime: eventTime,
        tradeDate: '2026-09-09', session: 'DAY', simtrade: false, price: 100 + index, close: 100 + index,
        executedVolume: 1, volume: 1, tick_type: 1 },
    };
    previousHash = recordHash;
    return record;
  });
  const sourceLedgerSha256 = 'a'.repeat(64);
  const snapshot = buildTxIntradayResearchSnapshot(records, {
    sourceLedgerIdentity: `sha256:${sourceLedgerSha256}`, instrumentProfile: { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 }, cutoffLedgerOrdinal: 3,
  });
  const semanticPayload = buildCru34HistoricalSemanticPayload(snapshot, { tickSize: 1 });
  const artifact = buildCru34SnapshotArtifact(semanticPayload, {
    materializedAt: '2026-09-10T00:00:00.000Z', sourceLedgerSha256,
    sourceLedgerByteSize: 1000, sourcePrefixRecordCount: 3, sourcePrefixByteSize: 1000,
  });
  const artifactPath = path.join(root, cru34ArtifactFileName(artifact));
  fs.writeFileSync(artifactPath, stableCru34ArtifactJson(artifact));
  const proof = { verified: true, ...Object.fromEntries(['sourceLedgerIdentity', 'cutoffLedgerOrdinal', 'cutoffRecordHash', 'tradeDate', 'session', 'actualContract', 'availableAt'].map((key) => [key, semanticPayload[key]])) };
  const options = { artifactPaths: [artifactPath], tradeDate: '2026-09-09', sessions: ['DAY'], generatedAt: '2026-09-12T00:00:00.000Z' };
  return { artifactPath, artifact, options, proof };
}

test('validated historical persistence does not imply source cutoff or research eligibility', (t) => {
  const { artifactPath, options } = fixture(t);
  const before = fs.readFileSync(artifactPath);
  const result = readDailyDerivedEvidence(options);
  assert.equal(result.entries.length, 1);
  assert.equal(result.entries[0].persistenceState, 'PASS');
  assert.equal(result.entries[0].cutoffValidated, false);
  assert.equal(result.entries[0].researchEligibility, 'UNKNOWN');
  assert.equal(result.entries[0].sourceArtifactIdentity.sha256, crypto.createHash('sha256').update(before).digest('hex'));
  assert.deepEqual(fs.readFileSync(artifactPath), before);
});

test('exact verified cutoff permits independent window status mapping, missing extended windows stay unknown', (t) => {
  const { options, proof } = fixture(t);
  const { entries: [entry] } = readDailyDerivedEvidence({ ...options, liveEvidence: { derivedCutoffProofs: [proof] } });
  assert.equal(entry.cutoffValidated, true);
  assert.equal(entry.integrityState, 'PASS');
  assert.equal(entry.windows.primary60s.pressure, 'READY');
  assert.equal(entry.windows.primary60s.response, 'READY');
  assert.equal(entry.windows.primary60s.pathEfficiency, 'READY');
  assert.equal(entry.windows.primary60s.researchEligibility, 'READY');
  assert.equal(entry.windows.window14400s.researchEligibility, 'UNKNOWN');
  assert.equal(entry.researchEligibility, 'READY_WITH_LIMITATION');
});

test('wrong source record or session cannot prove the derived cutoff', (t) => {
  const { options, proof } = fixture(t);
  for (const incorrect of [{ cutoffRecordHash: 'wrong' }, { session: 'NIGHT' }, { availableAt: '2026-09-09T01:01:00Z' }, { verified: false }]) {
    const { entries: [entry] } = readDailyDerivedEvidence({ ...options, liveEvidence: { derivedCutoffProofs: [{ ...proof, ...incorrect }] } });
    assert.equal(entry.cutoffValidated, false);
    assert.equal(entry.researchEligibility, 'UNKNOWN');
  }
});

test('selection uses semantic trade date and session and respects report cutoff', (t) => {
  const { options } = fixture(t);
  assert.equal(readDailyDerivedEvidence({ ...options, tradeDate: '2026-09-10' }).entries.length, 0);
  assert.equal(readDailyDerivedEvidence({ ...options, sessions: ['NIGHT'] }).entries.length, 0);
  const future = readDailyDerivedEvidence({ ...options, generatedAt: '2026-09-09T12:00:00Z' });
  assert.equal(future.entries.length, 0);
  assert.equal(future.unavailableArtifacts[0].reasonCode, 'DERIVED_OUTSIDE_IMMUTABLE_CUTOFF');
});

test('corrupt content and unsupported or missing artifacts remain unknown without promoting evidence', (t) => {
  const { options, artifact, artifactPath } = fixture(t);
  fs.writeFileSync(artifactPath, JSON.stringify({ ...artifact, semanticContentHash: 'f'.repeat(64) }));
  const invalid = readDailyDerivedEvidence(options);
  assert.equal(invalid.entries.length, 0);
  assert.equal(invalid.unavailableArtifacts[0].state, 'UNKNOWN');
  fs.unlinkSync(artifactPath);
  assert.equal(readDailyDerivedEvidence(options).unavailableArtifacts[0].reasonCode, 'DERIVED_ARTIFACT_UNREADABLE');
  assert.deepEqual(readDailyDerivedEvidence({ ...options, artifactPaths: [] }), { entries: [], unavailableArtifacts: [], artifactBytes: null });
});

test('duplicate paths produce only one derived row for a session', (t) => {
  const { options } = fixture(t);
  const result = readDailyDerivedEvidence({ ...options, artifactPaths: [...options.artifactPaths, ...options.artifactPaths] });
  assert.equal(result.entries.length, 1);
  assert.equal(result.artifactBytes, result.entries[0].bytes);
});

test('conflicting artifacts at the same latest generation time remain ambiguous', (t) => {
  const { options, artifact, artifactPath } = fixture(t);
  const conflict = buildCru34SnapshotArtifact({ ...artifact.semanticPayload, actualContract: 'TXFJ6' }, artifact.operationalEnvelope);
  const secondPath = path.join(path.dirname(artifactPath), cru34ArtifactFileName(conflict));
  fs.writeFileSync(secondPath, stableCru34ArtifactJson(conflict));
  const result = readDailyDerivedEvidence({ ...options, artifactPaths: [artifactPath, secondPath] });
  assert.equal(result.entries.length, 0);
  assert.equal(result.artifactBytes, null);
  assert.equal(result.unavailableArtifacts[0].reasonCode, 'DERIVED_ARTIFACT_SELECTION_AMBIGUOUS');
});

test('materialization generation time determines selection within a session', (t) => {
  const first = fixture(t);
  const second = fixture(t);
  const newer = buildCru34SnapshotArtifact(second.artifact.semanticPayload, {
    ...second.artifact.operationalEnvelope, materializedAt: '2026-09-11T00:00:00Z',
  });
  fs.writeFileSync(second.artifactPath, stableCru34ArtifactJson(newer));
  const paths = [first.artifactPath, second.artifactPath];
  const forward = readDailyDerivedEvidence({ ...first.options, artifactPaths: paths });
  const backward = readDailyDerivedEvidence({ ...first.options, artifactPaths: [...paths].reverse() });
  assert.deepEqual(forward, backward);
  assert.equal(forward.entries.length, 1);
  assert.equal(forward.entries[0].generatedAt, '2026-09-11T00:00:00Z');
});

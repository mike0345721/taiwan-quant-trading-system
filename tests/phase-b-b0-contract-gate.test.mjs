import assert from 'node:assert/strict';
import test from 'node:test';

import { canonicalJson, contractCompleteness, sha256Buffer } from '../src/phase-b-b0-contract-gate.mjs';

test('canonical JSON and logical hash are deterministic across object key order', () => {
  const left = { z: 1, a: { y: 2, b: 3 } };
  const right = { a: { b: 3, y: 2 }, z: 1 };
  assert.equal(canonicalJson(left), canonicalJson(right));
  assert.equal(sha256Buffer(canonicalJson(left)), sha256Buffer(canonicalJson(right)));
});

test('contract gate hard-fails when PRNG and random-feature semantics are not frozen', () => {
  const result = contractCompleteness({
    THRESHOLD: { quantileMethod: 'Q', tieMethod: 'T', scorePrecision: 'P', nullHandling: 'N' },
    BOOTSTRAP_INFERENCE: {},
    NEGATIVE_CONTROL_EXACT: { withinFoldScorePermutation: {}, randomFeatureControl: {} },
  });
  assert.equal(result.status, 'HARD_FAIL');
  assert.equal(result.executable, false);
  assert.ok(result.issues.some((item) => item.field === 'prngAlgorithm'));
  assert.ok(result.issues.some((item) => item.field === 'randomFeatureControl.generationAlgorithm'));
});

test('contract gate passes only after all execution semantics are explicit', () => {
  const result = contractCompleteness({
    THRESHOLD: { quantileMethod: 'Q', tieMethod: 'T', scorePrecision: 'P', nullHandling: 'N' },
    BOOTSTRAP_INFERENCE: {
      prngAlgorithm: 'A', hashToSeedMapping: 'B', canonicalSerialization: 'C',
      numericPrecision: 'D', unavailableRepresentation: 'E',
    },
    NEGATIVE_CONTROL_EXACT: {
      withinFoldScorePermutation: { algorithm: 'A', hashToSeedMapping: 'B' },
      randomFeatureControl: { generationAlgorithm: 'A', distribution: 'B', hashToSeedMapping: 'C' },
    },
  });
  assert.equal(result.status, 'PASS');
  assert.equal(result.issueCount, 0);
});


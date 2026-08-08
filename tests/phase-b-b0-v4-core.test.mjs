import assert from 'node:assert/strict';
import test from 'node:test';

import {
  fisherYates, jcsNfc, makeSeedMaterial, rngFromSeedMaterial,
  typedAvailable, typedUnavailable, validateTypedNumber,
} from '../src/phase-b-b0-v4-core.mjs';

const material = makeSeedMaterial({ freezeHash: 'test-freeze', purpose: 'KNOWN_ANSWER', streamId: 'VECTOR' });

test('RFC8785-compatible NFC golden vector', () => {
  assert.equal(jcsNfc({ z: 'e\u0301', a: -0, arr: [3, 2, 1] }), '{"a":0,"arr":[3,2,1],"z":"é"}');
});

test('xoshiro256** known-answer vector and hash-to-seed', () => {
  const { rng, seedHash } = rngFromSeedMaterial(material);
  assert.equal(seedHash, '5dcc72fcabdcbf9662f070729475af9a188f1de45edc2183248c4890d1ead7d5');
  assert.deepEqual(Array.from({ length: 5 }, () => rng.nextUint64().toString(16).padStart(16, '0')), [
    '21e2120c57ef0d2f', '3e42d990ccdb14fb', '0220e0c0b629e380', '9cf53066c31ad54a', '9d39cfcebc30850e',
  ]);
});

test('Fisher-Yates known-answer vector uses unbiased drawIndex', () => {
  const { rng } = rngFromSeedMaterial(material);
  assert.deepEqual(fisherYates([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], rng), [3, 8, 6, 7, 1, 2, 9, 0, 4, 5]);
});

test('typed unavailable schema rejects bare or invalid values', () => {
  assert.equal(validateTypedNumber(typedAvailable(1.25)), true);
  assert.equal(validateTypedNumber(typedUnavailable('MISSING_SCORE')), true);
  assert.equal(validateTypedNumber(null), false);
  assert.equal(validateTypedNumber({ state: 'UNAVAILABLE', value: null, reasonCode: null }), false);
  assert.throws(() => typedAvailable(Number.NaN));
});


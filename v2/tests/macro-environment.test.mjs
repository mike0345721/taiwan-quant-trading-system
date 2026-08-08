import test from 'node:test';
import assert from 'node:assert/strict';
import { parseFredCsv, latestStrictlyBefore } from '../src/macro-environment.mjs';

test('FRED parser skips missing values and accepts observation_date header', () => {
  const rows = parseFredCsv('observation_date,VIXCLS\n2026-07-01,16.2\n2026-07-02,.\n2026-07-03,18.4\n', 'VIXCLS');
  assert.deepEqual(rows, [
    { observationDate: '2026-07-01', value: 16.2 },
    { observationDate: '2026-07-03', value: 18.4 },
  ]);
});

test('macro as-of lookup never consumes the Taiwan trade date itself', () => {
  const observations = [
    { observationDate: '2026-07-01', value: 16.2 },
    { observationDate: '2026-07-02', value: 17.1 },
  ];
  assert.deepEqual(latestStrictlyBefore(observations, '2026-07-02'), observations[0]);
  assert.equal(latestStrictlyBefore(observations, '2026-07-01'), null);
});

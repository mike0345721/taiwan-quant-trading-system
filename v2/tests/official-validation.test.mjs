import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { officialCachePath } from '../src/official-validation.mjs';

test('official validation resolves caches created by each collector', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-v2-cache-'));
  const dataDir = path.join(root, 'data');
  const officialDir = path.join(dataDir, 'official-cache');
  fs.mkdirSync(officialDir, { recursive: true });

  const cases = [
    ['futures', 'official-cache', 'futures-2026-07-01-2026-07-16.csv.gz'],
    ['domestic_institutional_positions', 'domestic-institution-cache', '2026-07-01-2026-07-16.csv.gz'],
    ['option_institutional_positions', 'option-institution-cache', '2026-07-01-2026-07-16.csv.gz'],
    ['option_large_traders', 'option-large-trader-cache', '2026-07-01-2026-07-16.csv.gz'],
    ['twse_spot_institutional_final', 'twse-institution-cache', '2026-07-01.json.gz'],
  ];

  try {
    for (const [dataset, folder, name] of cases) {
      const expected = path.join(dataDir, folder, name);
      fs.mkdirSync(path.dirname(expected), { recursive: true });
      fs.writeFileSync(expected, 'cache');
      assert.equal(officialCachePath(officialDir, {
        dataset, period_start: '2026-07-01', period_end: '2026-07-16',
      }), expected);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const script = fileURLToPath(new URL('../scripts/summarize-cru55-performance.mjs', import.meta.url));

test('performance summary retains failed DOM coverage and excludes post-deadline recovery', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru55-summary-boundary-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('cru55-summary-boundary-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const json = (name, value) => fs.writeFileSync(path.join(root, name), JSON.stringify(value));
  const ndjson = (name, rows) => fs.writeFileSync(path.join(root, name), rows.map(JSON.stringify).join('\n') + '\n');
  json('experiment.json', { head: 'FIXTURE_ONLY', mode: 'cold', initialOrdinal: 0 });
  ndjson('observations.ndjson', [
    { at: 100, kind: 'start' },
    { at: 1000, appendAt: 1000, kind: 'append', fromOrdinal: 1, ordinal: 1 },
    { at: 2000, kind: 'api', ordinal: 1, artifactHash: 'fixture-artifact' },
    { at: 3000, kind: 'end' },
  ]);
  ndjson('browser-observations.ndjson', [
    { at: 50, kind: 'browser-observation', artifact: 'fixture-artifact' },
    { at: 500, kind: 'browser-event', event: 'metadata' },
    { at: 2500, kind: 'browser-observation', error: 'true', artifact: null },
    { at: 4000, kind: 'browser-observation', artifact: 'fixture-artifact' },
  ]);
  const output = path.join(root, 'summary.json');
  execFileSync(process.execPath, [script, root, output], { windowsHide: true });
  const result = JSON.parse(fs.readFileSync(output, 'utf8'));
  assert.equal(result.latency.unpublished, 0);
  assert.equal(result.browser.observations, 1);
  assert.equal(result.browser.metadataEvents, 1);
  assert.equal(result.browser.excludedOutsideMeasurement, 2);
  assert.equal(result.browser.unpublished, 1);
  assert.equal(result.browser.allQuantilesDefined, false);
  assert.equal(result.browser.successfulOnlyMs.p95, null);
});

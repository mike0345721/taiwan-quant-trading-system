import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (...parts) => fs.readFileSync(path.join(root, ...parts), 'utf8');

test('production and frozen preview share the Trader Terminal renderer and CSS', () => {
  const production = read('public', 'index.html');
  const preview = read('public-preview', 'index.html');
  for (const asset of ['trader-terminal-shell.css', 'trader-terminal-shell.js']) {
    assert.match(production, new RegExp(asset.replace('.', '\\.')));
    assert.match(preview, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(preview, /PREVIEW · NOT MAIN/);
  assert.match(preview, /FROZEN GOVERNED SNAPSHOT · NOT LIVE MARKET DATA/);
});

test('isolated preview runner accepts an explicit read-only chart bundle path', () => {
  const runner = read('scripts', 'run-dw2-public-preview.mjs');
  assert.match(runner, /--lightweight-charts/);
  assert.match(runner, /PUBLIC_PREVIEW_LIGHTWEIGHT_CHARTS_MISSING/);
});

test('Trader Terminal shell provides hierarchy, chart expansion, palette and detail drawer', () => {
  const shell = read('public', 'trader-terminal-shell.js');
  const styles = read('public', 'trader-terminal-shell.css');
  for (const token of ['tt-summary-line', 'tt-primary-grid', 'tt-tier-one-grid', 'tt-tier-two-grid', 'tt-tier-three-grid', 'tt-drawer']) {
    assert.match(shell, new RegExp(token));
  }
  assert.match(shell, /red-up/);
  assert.match(shell, /green-up/);
  assert.match(shell, /is-chart-expanded/);
  assert.match(styles, /--trust-live/);
  assert.match(styles, /--candle-up/);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /calc\(100vh - 170px\)/);
});

test('UI-1 renders only governed descriptive states and suppresses repetitive chart markers', () => {
  const app = read('public', 'app.js');
  assert.match(app, /tt-summary-strength', 'RESEARCH_PENDING'/);
  assert.match(app, /tt-trend-direction', 'Direction · RESEARCH_PENDING'/);
  assert.match(app, /時段高\|時段低\|VWAP/);
  assert.match(app, /typeof value === 'boolean'/);
  assert.doesNotMatch(read('public', 'trader-terminal-shell.js'), /executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/);
});

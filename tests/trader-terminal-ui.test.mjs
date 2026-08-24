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
  const previewApp = read('public-preview', 'app.js');
  for (const asset of ['trader-terminal-shell.css', 'trader-terminal-shell.js']) {
    assert.match(production, new RegExp(asset.replace('.', '\\.')));
    assert.match(preview, new RegExp(asset.replace('.', '\\.')));
  }
  assert.match(preview, /PREVIEW · NOT MAIN/);
  assert.match(preview, /FROZEN GOVERNED SNAPSHOT/);
  assert.match(preview, /NOT LIVE MARKET DATA/);
  assert.match(previewApp, /SIMULATED UI FIXTURE/);
  assert.match(previewApp, /NOT MARKET DATA/);
  assert.match(previewApp, /FOR VISUAL REVIEW ONLY/);
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
  assert.match(shell, /價格結構/);
  assert.match(shell, /tt-empty-track/);
  assert.match(shell, /tt-ring/);
  assert.match(shell, /tt-participation-bar/);
  assert.match(shell, /tt-global-tiles/);
  assert.match(shell, /tt-contribution-placeholder/);
  assert.match(styles, /--trust-live/);
  assert.match(styles, /--candle-up/);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /height:\s*350px/);
  assert.match(styles, /height:\s*182px/);
});

test('UI-1 renders only governed descriptive states and suppresses repetitive chart markers', () => {
  const app = read('public', 'app.js');
  assert.match(app, /tt-summary-strength', 'RESEARCH_PENDING'/);
  assert.match(app, /tt-trend-direction', '—'/);
  assert.match(app, /tt-trend-price-track', 'RESEARCH_PENDING'/);
  assert.match(app, /時段高\|時段低\|VWAP/);
  assert.match(app, /typeof value === 'boolean'/);
  assert.doesNotMatch(read('public', 'trader-terminal-shell.js'), /executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/);
});

test('isolated fixture is explicit, local, and excluded from evidence copy', () => {
  const production = read('public', 'app.js');
  const preview = read('public-preview', 'app.js');
  assert.match(preview, /SIMULATED_UI_FIXTURE/);
  assert.match(preview, /SIM-TX/);
  assert.match(preview, /if \(previewMode !== 'governed'\) return/);
  assert.match(preview, /copyButton\.disabled = fixture/);
  assert.doesNotMatch(production, /SIMULATED_UI_FIXTURE|SIM-TX|模擬 A 公司/);
  assert.doesNotMatch(preview, /fetch\([^\n]+method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});

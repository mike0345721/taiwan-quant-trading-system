import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (...segments) => fs.readFileSync(new URL(`../${segments.join('/')}`, import.meta.url), 'utf8');
const html = read('public', 'index.html');
const app = read('public', 'app.js');
const styles = read('public', 'styles.css');
const terminalStyles = read('public', 'trader-terminal-shell.css');

test('production source boots with workspace as the only initially active page', () => {
  assert.equal((html.match(/\bis-active-page\b/g) || []).length, 1);
  assert.match(html, /id="decision-workspace"[^>]*class="[^"]*is-active-page[^"]*"[^>]*data-page="workspace"/);
  assert.match(app, /normalizeDashboardPageFragments\(\);\s*setDashboardPage\('workspace', \{ scroll: false \}\);/);
  assert.match(app, /group\.dataset\.page = page/);
  assert.match(app, /group\.querySelectorAll\(`\[data-page=/);
  assert.match(app, /node\.removeAttribute\('data-page'\)/);
});

test('dashboard-only shell is fluid while login keeps the legacy width contract', () => {
  assert.match(styles, /\.app-shell \{ width: min\(1500px, calc\(100% - 32px\)\)/);
  assert.match(styles, /\.app-shell\.is-dashboard-shell \{ width: min\(2400px, calc\(100% - 32px\)\)/);
  assert.match(app, /is-dashboard-shell', view === 'dashboard-view'/);
});

test('expanded chart has a definite bounded owner and no recursive min-height contract', () => {
  assert.match(terminalStyles, /--tt-expanded-chart-height: clamp\(560px, calc\(100dvh - 96px\), 960px\)/);
  assert.match(terminalStyles, /is-chart-expanded \.tt-primary-grid \{[^}]*height: var\(--tt-expanded-chart-height\)/s);
  assert.match(terminalStyles, /is-chart-expanded \.tt-primary-grid > \.dw-price-region \{ height: 100%; min-height: 0; \}/);
  assert.match(terminalStyles, /is-chart-expanded \.tt-primary-grid \.dw-chart-canvas \{ height: 100%; min-height: 0; \}/);
  assert.doesNotMatch(terminalStyles, /is-chart-expanded[^}]*min-height:\s*calc\(100vh/s);
});

test('global app status is compact and runtime identity is progressively disclosed in Data Health', () => {
  assert.match(html, /<header class="topbar" aria-label="Global App Bar">/);
  assert.doesNotMatch(html, /TW MARKET INTELLIGENCE/);
  const healthStart = html.indexOf('id="dw-data-health-panel"');
  const runtimeStart = html.indexOf('id="dw-global-strip"');
  assert.ok(healthStart >= 0 && runtimeStart > healthStart);
  for (const id of ['dw-global-mode', 'dw-global-readiness', 'dw-global-trust', 'dw-runtime-version']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
});

test('Global Context tiles render governed descriptive values and label family-level trust explicitly', () => {
  assert.match(app, /function renderGlobalTiles\(evidence\)/);
  assert.match(app, /descriptiveValues\.slice\(0, 6\)/);
  assert.match(app, /tile\.hidden = !entry/);
  assert.match(app, /dw4DescriptiveValue\(entry\)/);
  assert.match(app, /cardKey === 'global' \? 'FAMILY ' : ''/);
  assert.match(app, /renderGlobalTiles\(dw4FamilyEvidence\(contract, 'GLOBAL_FX'\)\)/);
  assert.doesNotMatch(app, /place_order|update_order|cancel_order/);
});

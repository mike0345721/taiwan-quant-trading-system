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
  for (const token of [
    'tt-terminal-nav', 'tt-terminal-layout', 'tt-terminal-topbar', 'tt-summary-line', 'tt-primary-grid',
    'tt-tier-one-grid', 'tt-tier-two-grid', 'tt-tier-three-grid', 'tt-drawer',
  ]) {
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
  assert.match(shell, /tt-global-tile/);
  assert.match(shell, /tt-global-change-row/);
  assert.match(shell, /LATEST VALUE ONLY/);
  assert.match(shell, /tt-contribution-placeholder/);
  assert.match(shell, /tt-health-layout/);
  assert.match(shell, /tt-gpt-visual/);
  assert.match(shell, /tt-level-toggle/);
  assert.match(shell, /tt-futures-oi-change/);
  assert.match(shell, /tt-contribution-net/);
  assert.match(shell, /tt-mini-series/);
  assert.match(shell, /最大反向證據？/);
  assert.match(shell, /多單 thesis 何時失效？/);
  assert.match(shell, /aria-disabled/);
  assert.match(shell, /button\.disabled = index !== 0/);
  assert.match(shell, /shell\.returnFocus = trigger/);
  assert.match(shell, /returnFocus\?\.isConnected/);
  assert.match(shell, /event\.key !== 'Tab'/);
  assert.match(shell, /aria-labelledby/);
  assert.match(shell, /index <= 6/);
  assert.match(shell, /正貢獻 TOP 5/);
  assert.match(shell, /負貢獻 TOP 5/);
  assert.match(shell, /index <= 5/);
  assert.match(styles, /--trust-live/);
  assert.match(styles, /--candle-up/);
  assert.match(styles, /--tt-space-md/);
  assert.match(styles, /--tt-font-card-title/);
  assert.match(styles, /--tt-border-card/);
  assert.match(styles, /--tt-global-positive/);
  assert.match(styles, /--tt-global-negative/);
  assert.match(styles, /--tt-global-chart-height/);
  assert.match(styles, /\.tt-global-tile\.is-positive/);
  assert.match(styles, /\.tt-global-tile\.is-negative/);
  assert.match(styles, /\.tt-global-change-row \{ display: grid/);
  assert.match(styles, /overflow-x:\s*clip/);
  assert.match(styles, /height:\s*clamp\(360px,\s*42vh,\s*470px\)/);
  assert.match(styles, /height:\s*clamp\(268px,\s*25vh,\s*280px\)/);
  assert.match(styles, /height:\s*clamp\(205px,\s*20vh,\s*220px\)/);
  assert.match(styles, /grid-template-columns:\s*64px/);
});

test('Trader Terminal formal typography has an 11px floor', () => {
  const styles = read('public', 'trader-terminal-shell.css');
  const explicitSizes = [...styles.matchAll(/font-size:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  const tokenSizes = [...styles.matchAll(/--tt-font-[\w-]+:\s*(\d+(?:\.\d+)?)px/g)].map((match) => Number(match[1]));
  const shorthandSizes = [...styles.matchAll(/font:\s*(?:\d+\s+)?(\d+(?:\.\d+)?)px\//g)].map((match) => Number(match[1]));
  assert.ok(explicitSizes.length > 0 && tokenSizes.length > 0 && shorthandSizes.length > 0);
  assert.deepEqual([...explicitSizes, ...tokenSizes, ...shorthandSizes].filter((size) => size < 11), []);
  assert.match(styles, /--tt-font-card-title:\s*15px/);
  assert.match(styles, /--tt-font-number-md:\s*14px/);
  assert.match(styles, /\.tt-main-answer[^}]*font-size:\s*clamp\(18px,/);
});

test('Trader Terminal wires only governed descriptive values and preserves unavailable reasons', () => {
  const app = read('public', 'app.js');
  const terminalSource = app.slice(app.indexOf('function terminalUnavailable'), app.indexOf('function leadershipRow'));
  assert.match(app, /tt-summary-strength', 'RESEARCH_PENDING'/);
  assert.match(app, /tt-trend-direction', 'RESEARCH_PENDING'/);
  assert.match(app, /tt-trend-price-track', 'RESEARCH_PENDING'/);
  assert.match(terminalSource, /levels\?\.previousClose/);
  assert.match(terminalSource, /txDay\.openInterest/);
  assert.match(terminalSource, /derived\?\.market\?\.basis/);
  assert.match(terminalSource, /futuresPositioning\.foreignNet/);
  assert.match(terminalSource, /futuresPositioning\.dealerNet/);
  assert.match(terminalSource, /futuresPositioning\.trustNet/);
  assert.match(terminalSource, /options\.callWall\?\.strike/);
  assert.match(terminalSource, /options\.putWall\?\.strike/);
  assert.match(terminalSource, /options\.maxPain/);
  assert.match(terminalSource, /terminalBreadthCounts/);
  assert.match(terminalSource, /terminalHealthSummary/);
  assert.match(terminalSource, /ACTUAL_CONTRACT_MISMATCH/);
  assert.match(terminalSource, /TRADE_DATE_OR_SOURCE_MISMATCH/);
  assert.match(terminalSource, /DERIVATION_NOT_IMPLEMENTED/);
  assert.match(terminalSource, /BREAKDOWN_NOT_IMPLEMENTED/);
  assert.doesNotMatch(terminalSource, /tt-top-(?:change|oi|basis)',\s*'UNAVAILABLE'/);
  assert.match(app, /show-optional-levels/);
  assert.match(app, /const hasDayLevels =/);
  assert.match(app, /trader-terminal:levels/);
  assert.match(app, /ΔVWAP/);
  assert.match(app, /時段高\|時段低\|VWAP/);
  assert.match(app, /typeof value === 'boolean'/);
  assert.doesNotMatch(read('public', 'trader-terminal-shell.js'), /executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/);
});

test('Trader Terminal breadth normalization preserves zero and rejects partial input', () => {
  const app = read('public', 'app.js');
  const finiteSource = app.match(/function finiteNumber\(value\) \{[\s\S]*?\n\}/)?.[0];
  const breadthStart = app.indexOf('function terminalBreadthCounts');
  const breadthEnd = app.indexOf('function renderTerminalEvidenceCard', breadthStart);
  const breadthSource = app.slice(breadthStart, breadthEnd).trim();
  assert.ok(finiteSource);
  assert.ok(breadthStart >= 0 && breadthEnd > breadthStart);
  const counts = Function(`${finiteSource}\n${breadthSource}\nreturn terminalBreadthCounts;`)();
  assert.deepEqual(counts({ raise_count: 10, flat_count: 0, fall_count: 5 }), { up: 10, flat: 0, down: 5 });
  assert.deepEqual(counts({
    listed: { advance: 6, unchanged: 1, decline: 3 },
    otc: { advance: 4, unchanged: 0, decline: 2 },
  }), { up: 10, flat: 1, down: 5 });
  assert.equal(counts({ listed: { advance: 6, decline: 3 }, otc: { advance: 4, unchanged: 0, decline: 2 } }), null);
  assert.equal(counts(null), null);
});

test('isolated fixture is explicit, local, and excluded from evidence copy', () => {
  const production = read('public', 'app.js');
  const preview = read('public-preview', 'app.js');
  assert.match(preview, /SIMULATED_UI_FIXTURE/);
  assert.match(preview, /SIM-TX/);
  assert.match(preview, /if \(previewMode !== 'governed'/);
  assert.match(preview, /copyButton\.disabled = fixture/);
  assert.match(preview, /setSeries\('tt-breadth-series'/);
  assert.match(preview, /setSeries\('tt-risk-series'/);
  assert.match(preview, /tt-global-series-/);
  assert.match(preview, /node\.textContent = fixture \? 'SIMULATED' : 'LATEST VALUE ONLY'/);
  assert.match(preview, /\['VIX', '19\.82', '-2\.04%'/);
  assert.match(preview, /change\.startsWith\('-'\) \? 'negative' : 'positive'/);
  assert.match(preview, /FIXTURE · DISABLED/);
  assert.match(preview, /if \(\$\('decision-workspace'\)\?\.classList\.contains\('show-optional-levels'\)\)/);
  assert.doesNotMatch(production, /SIMULATED_UI_FIXTURE|SIM-TX|模擬 A 公司/);
  assert.doesNotMatch(preview, /fetch\([^\n]+method:\s*'(?:POST|PUT|PATCH|DELETE)'/);
});

test('preview mode transitions reject stale chart loads and gate evidence copy', () => {
  const preview = read('public-preview', 'app.js');
  assert.match(preview, /previewRequestGeneration/);
  assert.match(preview, /generation !== previewRequestGeneration/);
  assert.match(preview, /requestedMode !== previewMode/);
  assert.match(preview, /governedCopyReady = false/);
  assert.match(preview, /governedCopyReady = requestedMode === 'governed'/);
  assert.match(preview, /activeChart\?\.source === 'SIMULATED_UI_FIXTURE'/);
  assert.match(preview, /setTrust\('trend', 'RESEARCH_PENDING'\)/);
});

test('Leadership presentation preserves missing points instead of coercing them to zero', () => {
  const app = read('public', 'app.js');
  const finiteSource = app.match(/function finiteNumber\(value\) \{[\s\S]*?\n\}/)?.[0];
  assert.ok(finiteSource);
  const normalize = Function(`return (${finiteSource})`)();
  for (const value of [null, undefined, '', '   ', true, false, 'not-a-number', Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(normalize(value), null);
  }
  assert.equal(normalize('12.5'), 12.5);
  assert.equal(normalize(-3), -3);
  const leadershipSource = app.slice(app.indexOf('function leadershipRow'), app.indexOf('function renderIndexLeadership'));
  assert.match(leadershipSource, /const points = finiteNumber\(row\?\.points\)/);
  assert.doesNotMatch(leadershipSource, /(?:^|[^A-Za-z])Number\(row\?\.points\)/);
});

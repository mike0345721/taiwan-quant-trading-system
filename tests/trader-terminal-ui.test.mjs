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
  assert.match(shell, /trader-terminal-candle-palette/);
  assert.match(shell, /document\.documentElement\.dataset\.marketPalette/);
  assert.match(shell, /--market-up-soft/);
  assert.match(shell, /market-palette-select/);
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
  assert.match(shell, /COPY SNAPSHOT · LOADING/);
  assert.match(shell, /Manual copy only · no direct GPT API/);
  assert.match(shell, /copyBody\?\.parentElement === node/);
  assert.match(shell, /tt-fixture-only/);
  assert.match(shell, /tierOne\.append\(pulse, observedFlow\)/);
  assert.match(shell, /tt-primary-market-surface/);
  assert.match(shell, /Price Structure · Primary/);
  assert.match(shell, /tierTwo\.append\(leadership, futures, options, breadth, conflict\)/);
  assert.match(shell, /研究觀測 · 非交易訊號/);
  assert.match(shell, /focus\.querySelector\('\.dw-decision-bar'\), trend/);
  assert.match(shell, /aria-disabled/);
  assert.match(shell, /button\.disabled = index !== 0/);
  assert.match(shell, /shell\.returnFocus = trigger/);
  assert.match(shell, /returnFocus\?\.isConnected/);
  assert.match(shell, /event\.key !== 'Tab'/);
  assert.match(shell, /const modeSwitch = heading\.querySelector\('\.dw-mode-switch'\)/);
  assert.match(shell, /if \(modeSwitch\) status\.append\(modeSwitch\)/);
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
  assert.match(styles, /grid-template-columns:\s*minmax\(0, 1\.7fr\) minmax\(680px, \.95fr\)/);
  assert.match(styles, /height:\s*clamp\(440px,\s*48vh,\s*540px\)/);
  assert.match(styles, /\.tt-primary-market-surface/);
  assert.match(styles, /min-height:\s*clamp\(268px,\s*25vh,\s*280px\)/);
  assert.match(styles, /height:\s*clamp\(205px,\s*20vh,\s*220px\)/);
  assert.match(styles, /grid-template-columns:\s*64px/);
  assert.match(styles, /@media \(max-width: 1600px\) \{[\s\S]*?\.tt-terminal-topbar \{ gap: 8px; \}/);
  assert.match(styles, /\.tt-terminal-topbar \{[\s\S]*?flex-wrap: wrap;/);
  assert.match(styles, /\.tt-top-details \{[^}]*flex: 0 0 auto;/);
  assert.match(styles, /grid-template-rows: auto minmax\(205px, 1fr\) auto/);
  assert.match(styles, /\.dw-chart-header \{[^}]*grid-template-rows: auto auto auto/);
  assert.match(styles, /\.dw-flow-window-strip button \{[\s\S]*?grid-template-columns: auto minmax\(34px, 1fr\) auto/);
  assert.match(styles, /\.dw-flow-mini-bar \{[^}]*height: 9px/);
  assert.match(styles, /grid-template-columns: repeat\(4, 1fr\) minmax\(3px, \.45fr\) repeat\(4, 1fr\)/);
  assert.match(styles, /\.dw-flow-mini-bar i\.is-level-4/);
  assert.match(styles, /\.dw-pressure-segments i\.is-level-1/);
  assert.match(styles, /\.dw-flow-metric-energy\.is-positive i \{[^}]*linear-gradient/);
  assert.match(styles, /\.dw-flow-metric-energy\.is-negative i \{[^}]*linear-gradient/);
  const narrowObservedFlowRules = styles.match(/@media \(max-width: 1380px\) \{([\s\S]*?)\n\}/)?.[1] || '';
  assert.doesNotMatch(narrowObservedFlowRules, /\.dw-observed-flow-trust\s*\{[^}]*grid-template-columns:\s*1fr/);
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
  assert.match(terminalSource, /CONTRACT_IDENTITY_INCOMPLETE/);
  assert.match(terminalSource, /chart\?\.contractMonth/);
  assert.match(terminalSource, /chartContractMonth === snapshotContractMonth/);
  assert.doesNotMatch(terminalSource, /chartContract === snapshotContract/);
  assert.match(terminalSource, /TRADE_DATE_OR_SOURCE_MISMATCH/);
  assert.match(terminalSource, /DERIVATION_NOT_IMPLEMENTED/);
  assert.match(terminalSource, /BREAKDOWN_NOT_IMPLEMENTED/);
  assert.match(terminalSource, /COPY SNAPSHOT · READY/);
  assert.match(terminalSource, /COPY_CONTEXT_UNAVAILABLE/);
  assert.match(terminalSource, /function renderTerminalDashboardFailure/);
  assert.match(terminalSource, /DASHBOARD_API_UNAVAILABLE/);
  assert.match(app, /root\.setAttribute\('data-dashboard-load-state', 'UNAVAILABLE'\)/);
  assert.match(app, /button\.disabled = true/);
  assert.doesNotMatch(terminalSource, /tt-top-(?:change|oi|basis)',\s*'UNAVAILABLE'/);
  assert.match(app, /terminalRoot\?\.setAttribute\('data-dashboard-load-state', 'LOADING'\)/);
  assert.match(app, /terminalRoot\?\.setAttribute\('data-dashboard-load-state', 'READY'\)/);
  assert.match(app, /reportDashboardLoadError\(error, 'POST_LOGIN_DASHBOARD_LOAD'\)/);
  assert.match(app, /Copy context UNAVAILABLE/);
  assert.match(app, /INDEX_LEADERSHIP_API_UNAVAILABLE/);
  assert.match(app, /terminalWrite\('tt-health-main', health, \{ reason: 'DATA_HEALTH_UNAVAILABLE'/);
  assert.match(app, /terminalWrite\('tt-futures-tx', lastPrice == null \? null : fmt\(lastPrice\)/);
  assert.match(read('public', 'index.html'), /id="dw-event-risk-state">RESEARCH_PENDING</);
  assert.match(read('public', 'index.html'), /data-terminal-card="observed-flow"/);
  assert.match(read('public', 'index.html'), /台指期多時間成交力道/);
  assert.match(read('public', 'index.html'), /data-flow-window="tradingDay"/);
  assert.match(read('public', 'index.html'), /class="dw-flow-selected-results"/);
  assert.match(read('public', 'index.html'), /<span>成交壓力<\/span>/);
  assert.match(read('public', 'index.html'), /<span>價格反應<\/span>/);
  assert.match(read('public', 'index.html'), /<span>路徑效率<\/span>/);
  assert.match(read('public', 'index.html'), /<span>分類覆蓋率<\/span>/);
  assert.match(read('public', 'index.html'), /查看證據 \/ Detail/);
  assert.match(read('public', 'index.html'), /id="market-palette-select"/);
  assert.match(read('public', 'index.html'), /台股（紅漲綠跌）/);
  assert.match(read('public', 'index.html'), /國際（綠漲紅跌）/);
  assert.match(read('public', 'app.js'), /Math\.min\(4, Math\.ceil\(Math\.abs\(ratio\) \* 4\)\)/);
  assert.match(read('public', 'app.js'), /index < 9/);
  assert.equal((read('public', 'index.html').match(/查看證據 \/ Detail/g) || []).length, 1);
  assert.doesNotMatch(read('public', 'index.html'), /<details class="dw-flow-selected-evidence"/);
  assert.match(read('public', 'index.html'), /id="dw-flow-response-energy"/);
  assert.match(read('public', 'index.html'), /id="dw-flow-path-energy"/);
  assert.match(read('public', 'app.js'), /dw-flow-path-energy[\s\S]*?tone: 'neutral'/);
  assert.match(read('public', 'app.js'), /dw-flow-coverage-energy[\s\S]*?tone: 'neutral'/);
  assert.match(read('public', 'index.html'), /id="dw-flow-selected-reason-code"/);
  assert.match(read('public', 'index.html'), /id="dw-flow-selected-summary"/);
  assert.match(read('public', 'index.html'), /id="dw-observed-flow-truth"/);
  assert.match(app, /function renderObservedFlow\(flow\)/);
  assert.match(app, /HISTORICAL: '歷史資料｜非目前盤勢'/);
  assert.match(app, /PENDING_CRU44/);
  assert.match(app, /CHART_TO_FLOW_WINDOW/);
  assert.match(app, /FLOW_TO_CHART_TIMEFRAME/);
  assert.match(app, /\['ArrowLeft', 'ArrowRight', 'Home', 'End'\]/);
  assert.match(app, /button\.tabIndex = selected \? 0 : -1/);
  assert.match(app, /Data Trust \$\{observedFlowStateLabel\(value\.sourceState\)\}/);
  assert.doesNotMatch(app, /`60 秒 \$\{observedFlowCoverage/);
  assert.match(app, /pressureRatio === null/);
  assert.match(app, /PRESSURE_CLASSIFIED_COVERAGE_INCOMPLETE/);
  assert.match(app, /renderObservedFlow\(workspace\?\.observedFlow\)/);
  assert.match(app, /\$\('refresh-button'\)\.addEventListener\('click',[\s\S]*?catch \(error\) \{\s*reportDashboardLoadError\(error, 'DASHBOARD_REFRESH'\);/);
  assert.match(app, /show-optional-levels/);
  assert.match(app, /const hasDayLevels =/);
  assert.match(app, /trader-terminal:levels/);
  assert.match(app, /距 VWAP/);
  assert.match(app, /function txChartRuntimeReason\(\)/);
  assert.match(app, /CHART_RUNTIME_API_MISMATCH/);
  assert.match(app, /visibleRenderReady/);
  assert.match(app, /requestId !== state\.txChartRequestId \|\| timeframe !== state\.txChartTimeframe/);
  assert.match(app, /state\.txChartPendingFit = state\.txChartPendingFit \|\| fit/);
  assert.match(app, /目前／收盤/);
  assert.match(app, /完整 開/);
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

test('Trader Terminal grouped health fails closed when any expected source is not reported', () => {
  const app = read('public', 'app.js');
  const helpersStart = app.indexOf('function terminalHealthItem');
  const helpersEnd = app.indexOf('function terminalBreadthCounts', helpersStart);
  const helpers = app.slice(helpersStart, helpersEnd).trim();
  assert.ok(helpersStart >= 0 && helpersEnd > helpersStart);
  const summarize = Function(`${helpers}\nreturn terminalHealthSummary;`)();
  const result = summarize({
    snapshot: {
      dataHealth: {
        items: [{
          sourceId: 'futuresMarket', sourceAvailability: 'SOURCE_AVAILABLE',
          readinessState: 'READY', freshnessState: 'FRESH', availableAt: '2026-08-28T05:45:00.000Z',
        }],
      },
    },
  }, ['futuresMarket', 'txTick']);
  assert.deepEqual(result, {
    value: null,
    reason: 'SOURCE_NOT_REPORTED',
    title: 'missing=txTick | futuresMarket · FRESH · 2026-08-28T05:45:00.000Z',
  });
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
  assert.doesNotMatch(preview, /setText\(`tt-\$\{key\}-main`, 'UNAVAILABLE'\)/);
});

test('Owner review launcher reuses local prerequisites without enabling mock or execution paths', () => {
  const launcher = read('scripts', 'start-cru31-owner-review.ps1');
  assert.match(launcher, /NODE_ENV = 'production'/);
  assert.match(launcher, /MOCK_DATA = '0'/);
  assert.match(launcher, /COOKIE_SECURE = '0'/);
  assert.match(launcher, /REFRESH_INTERVAL_SECONDS = '0'/);
  assert.match(launcher, /ItemType Junction/);
  assert.match(launcher, /git -c "safe\.directory=\$project" -C \$project rev-parse HEAD/);
  assert.doesNotMatch(launcher, /safe\.directory=\*|config\s+--global/);
  assert.match(launcher, /Press Ctrl\+C/);
  assert.doesNotMatch(launcher, /shioaji|broker|order|executionAuthorized\s*=\s*true|orderRoutesEnabled\s*=\s*true/i);
});

test('CRU-35 owner review launcher requires one governed historical artifact and fails closed', () => {
  const launcher = read('scripts', 'start-cru35-owner-review.ps1');
  const guide = read('docs', 'product', 'CRU_35_OWNER_BROWSER_REVIEW_GUIDE.md');
  assert.match(launcher, /\[Parameter\(Mandatory = \$true\)\]\s*\[string\]\$ArtifactPath/);
  assert.match(launcher, /CRU34_SNAPSHOT_ARTIFACT_PATH = \$artifact/);
  assert.match(launcher, /loadDashboardObservedFlow/);
  assert.match(launcher, /\['HISTORICAL','STALE'\]\.includes/);
  assert.match(launcher, /NODE_ENV = 'production'/);
  assert.match(launcher, /MOCK_DATA = '0'/);
  assert.match(launcher, /REFRESH_INTERVAL_SECONDS = '0'/);
  assert.match(launcher, /safe\.directory=\$project/);
  assert.doesNotMatch(launcher, /safe\.directory=\*|config\s+--global/);
  assert.match(guide, /QUALITY_INSUFFICIENT/);
  assert.match(guide, /NOT PROMOTED/);
  assert.match(guide, /1920, 1680, 1536, 1440, and 1366/);
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

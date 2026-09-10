import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('DW-2 exposes seven timeframes, governed chart context and TradingView attribution', () => {
  for (const timeframe of ['1m', '5m', '15m', '30m', '1h', '4h', '1D']) {
    assert.match(html, new RegExp(`data-chart-timeframe="${timeframe}"`));
  }
  for (const id of ['dw-chart-canvas', 'dw-chart-session', 'dw-chart-contract', 'dw-chart-crosshair', 'dw-prior-levels', 'dw-session-levels']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  assert.match(html, /Charts by/);
  assert.match(html, /https:\/\/www\.tradingview\.com\//);
  assert.match(html, /\/vendor\/lightweight-charts\.js/);
});

test('timeframe switching updates chart only and preserves Decision Summary/Data Health state', () => {
  assert.match(app, /function selectChartTimeframe\(timeframe\)[\s\S]*state\.txChartTimeframe = timeframe/);
  assert.match(app, /selectChartTimeframe\(button\.dataset\.chartTimeframe\)|selectChartTimeframe\(timeframe\)/);
  assert.match(app, /loadTxDecisionChart\(\{ fit: true \}\)/);
  const switchBlock = app.slice(app.indexOf("document.querySelectorAll('[data-chart-timeframe]')"), app.indexOf("document.querySelectorAll('[data-review-intent]')"));
  assert.doesNotMatch(switchBlock, /loadDashboard|renderDecisionWorkspace|location\.reload/);
  assert.match(app, /state\.txChartSeries\.candle\.update/);
  assert.match(app, /\['READY', 'FORMING', 'QUALITY_INSUFFICIENT'\]\.includes/);
  assert.match(app, /setInterval[\s\S]*loadTxDecisionChart/);
  const chartLoader = app.slice(app.indexOf('async function loadTxDecisionChart'), app.indexOf('async function reportCru46BrowserRuntimeProof'));
  assert.ok(
    chartLoader.indexOf('if (state.txChartLoading)') < chartLoader.indexOf('const requestId = ++state.txChartRequestId'),
    'same-window refresh while a slow request is active must not invalidate the in-flight response',
  );
  assert.match(chartLoader, /requestId !== state\.txChartRequestId \|\| timeframe !== state\.txChartTimeframe/);
  assert.match(app, /subscribeCrosshairMove/);
  assert.match(app, /UNAVAILABLE_AT_SELECTED_TIME/);
  assert.match(app, /OR H/);
});

test('server exposes authenticated read-only chart data and local open-source bundle without order routes', () => {
  assert.match(server, /pathname === '\/api\/v1\/tx-chart'/);
  assert.match(server, /lightweight-charts\.standalone\.production\.js/);
  assert.doesNotMatch(server, /place_order|cancel_order|update_order/);
  assert.match(app, /READ ONLY/);
});

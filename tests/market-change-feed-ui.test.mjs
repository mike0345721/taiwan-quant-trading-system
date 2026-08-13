import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('What Changed uses Chinese-first result, evidence and technical-detail layers', () => {
  for (const id of ['dw-changed-title', 'dw-change-status', 'dw-change-latest', 'dw-evidence-timeline', 'dw-evidence-cards']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /完成 5 分鐘證據/);
  assert.match(html, /證據時間軸/);
  assert.match(html, /證據詳情/);
  assert.match(html, /dw-change-trust/);
  assert.match(app, /latestGroupsFirst/);
  assert.match(app, /dw-evidence-technical/);
  assert.match(app, /function renderMarketChangeFeed/);
  assert.match(app, /event\.sourceFacts\?\.previous/);
  assert.match(app, /event\.sourceFacts\?\.current/);
  assert.match(app, /event\.qualityReasons\.join/);
});

test('Market Change Feed is independent from chart timeframe and markers remain 5m-only', () => {
  assert.match(server, /marketChangeFeed = Object\.freeze/);
  assert.match(server, /chartMarkersFromEvents\(feed\.events, chart\)/);
  assert.doesNotMatch(server, /const feedSource = timeframe === '5m'/);
  assert.match(app, /marketChangeMarkerData\(state\.marketChangeFeed, payload\?\.timeframe\)/);
  assert.match(app, /if \(timeframe !== '5m'\) return \[\]/);
  assert.match(app, /createSeriesMarkers/);
  const dw3Render = app.slice(app.indexOf('function marketChangeMarkerData'), app.indexOf('function renderTxDecisionChart'));
  assert.doesNotMatch(dw3Render, /positive|negative|bullish|bearish/);
  assert.doesNotMatch(server, /place_order|update_order|cancel_order/);
});

test('authenticated API exposes read-only Market Change Feed without new mutation route', () => {
  assert.match(server, /pathname === '\/api\/v1\/market-changes'/);
  assert.match(server, /buildMarketChangeFeed/);
  assert.match(server, /url\.searchParams\.get\('mode'\) === 'REPLAY'/);
  assert.match(server, /req\.method === 'GET' && pathname === '\/api\/v1\/market-changes'/);
});

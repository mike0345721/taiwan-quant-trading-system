import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');

test('What Changed, Evidence Timeline and Evidence Cards are first-class DW-3 UI regions', () => {
  for (const id of ['dw-changed-title', 'dw-change-status', 'dw-change-latest', 'dw-evidence-timeline', 'dw-evidence-cards']) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /完成 5 分鐘證據/);
  assert.match(html, /Evidence Timeline/);
  assert.match(html, /Evidence Cards/);
  assert.match(app, /function renderMarketChangeFeed/);
  assert.match(app, /event\.sourceFacts\?\.previous/);
  assert.match(app, /event\.sourceFacts\?\.current/);
  assert.match(app, /event\.qualityReasons\.join/);
});

test('chart markers and Timeline consume the same marketChangeFeed events', () => {
  assert.match(server, /marketChangeFeed: feed/);
  assert.match(server, /chartMarkersFromEvents\(feed\.events, chart\)/);
  assert.match(app, /payload\?\.marketChangeFeed/);
  assert.match(app, /payload\?\.markers/);
  assert.match(app, /createSeriesMarkers/);
  assert.doesNotMatch(server, /place_order|update_order|cancel_order/);
});

test('authenticated API exposes read-only Market Change Feed without new mutation route', () => {
  assert.match(server, /pathname === '\/api\/v1\/market-changes'/);
  assert.match(server, /buildMarketChangeFeed/);
  assert.match(server, /url\.searchParams\.get\('mode'\) === 'REPLAY'/);
  assert.match(server, /req\.method === 'GET' && pathname === '\/api\/v1\/market-changes'/);
});

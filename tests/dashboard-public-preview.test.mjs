import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { buildTxDecisionChart } from '../src/dashboard-tx-chart.mjs';
import {
  PUBLIC_PREVIEW_TIMEFRAMES,
  createPublicPreviewServer,
  createPublicPreviewSnapshot,
  loadPublicPreviewArtifact,
  previewSha256,
  sanitizePreviewChart,
  scanPublicPreviewPayload,
  stablePreviewJson,
  writePublicPreviewSnapshot,
} from '../src/dashboard-public-preview.mjs';

const calendar = loadGovernedTradingCalendar(new URL('../config/taifex-official-calendar-2026.json', import.meta.url));
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tick(timestamp, close, volume = 1) {
  return {
    kind: 'futures_tick', product: 'TXFH6', receivedAt: `${timestamp}+08:00`, exchangeTimestamp: timestamp,
    duplicate: false, sequenceGap: 0, executionAuthorized: false, orderRoutesEnabled: false,
    payload: { datetime: timestamp, close: String(close), volume, simtrade: false, _product_family: 'TX', _target_code: 'TXFH6' },
  };
}

function fixtureCharts() {
  const rows = [
    tick('2026-08-11T15:00:01.000', 100, 2), tick('2026-08-12T04:59:59.000', 101, 3),
    tick('2026-08-12T08:45:01.000', 102, 4), tick('2026-08-12T08:59:59.000', 104, 5),
    tick('2026-08-12T09:00:01.000', 103, 2), tick('2026-08-12T13:44:59.000', 105, 2),
  ];
  return Object.fromEntries(PUBLIC_PREVIEW_TIMEFRAMES.map((timeframe) => [timeframe,
    buildTxDecisionChart(rows, {
      calendar, timeframe, mode: 'REPLAY', tradeDate: '2026-08-12',
      session: timeframe === '1D' ? null : 'DAY', asOf: '2026-08-12T13:45:00+08:00',
    }),
  ]));
}

function artifact(root) {
  const snapshot = createPublicPreviewSnapshot({
    charts: fixtureCharts(),
    generatedAt: '2026-08-12T13:45:00+08:00',
    previewIdentity: { branch: 'codex/trader-terminal-ui-1', commit: 'abc1234' },
  });
  const files = writePublicPreviewSnapshot(root, snapshot);
  return { snapshot, files };
}

test('frozen preview snapshot and manifest are deterministic, allowlisted and immutable', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-public-'));
  try {
    const first = artifact(root);
    const second = artifact(root);
    assert.equal(first.files.snapshotFileHash, second.files.snapshotFileHash);
    assert.equal(first.files.manifestFileHash, second.files.manifestFileHash);
    assert.equal(first.snapshot.PREVIEW_DATA_MODE, 'FROZEN_SNAPSHOT');
    assert.equal(first.snapshot.executionAuthorized, false);
    assert.equal(first.snapshot.orderRoutesEnabled, false);
    assert.equal(first.snapshot.previewIdentity.branch, 'codex/trader-terminal-ui-1');
    assert.equal(first.snapshot.workspace.decisionSummary.posture, 'MANUAL_REVIEW_ONLY');
    assert.deepEqual(first.snapshot.workspace.leadershipSubscription, { subscriptionState: 'DEFAULT_OFF', restorationState: 'NOT_REQUESTED' });
    assert.equal(first.snapshot.charts['1D'].source, 'FROZEN_SNAPSHOT');
    assert.equal(first.snapshot.charts['1D'].sourceLedgerIdentity, undefined);
    assert.equal(scanPublicPreviewPayload(first.snapshot).length, 0);
    const loaded = loadPublicPreviewArtifact(first.files.manifestPath);
    assert.equal(loaded.snapshot.snapshotId, first.snapshot.snapshotId);
    assert.equal(previewSha256(stablePreviewJson(first.snapshot)), first.files.snapshotFileHash);
    const original = fs.readFileSync(first.files.snapshotPath, 'utf8');
    fs.writeFileSync(first.files.snapshotPath, original.replace('FROZEN_SNAPSHOT', 'TAMPERED'));
    assert.throws(() => loadPublicPreviewArtifact(first.files.manifestPath), /SNAPSHOT_FILE_HASH_INVALID/);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('preview numeric normalization preserves missing and invalid values as null', () => {
  const chart = sanitizePreviewChart({
    lastPrice: null,
    bars: [{ time: '2026-08-12T08:45:00+08:00', open: '', high: undefined, low: false, close: '101.5', volume: 'invalid' }],
    vwap: [{ time: '2026-08-12T08:45:00+08:00', value: '' }],
    openingRange: { high: false, low: null },
    levels: { vwap: { availability: 'UNAVAILABLE', value: '' } },
  });
  assert.equal(chart.lastPrice, null);
  assert.deepEqual([chart.bars[0].open, chart.bars[0].high, chart.bars[0].low, chart.bars[0].close, chart.bars[0].volume], [null, null, null, 101.5, null]);
  assert.equal(chart.vwap[0].value, null);
  assert.equal(chart.openingRange.high, null);
  assert.equal(chart.levels.vwap.value, null);
});

test('public adapter is default-off, loopback-only and fail-closed for missing artifacts', () => {
  assert.throws(() => createPublicPreviewServer(), /PUBLIC_PREVIEW_MODE_NOT_ENABLED/);
  assert.throws(() => createPublicPreviewServer({ publicPreviewMode: true, host: '0.0.0.0', port: 8798 }), /HOST_MUST_BE_LOOPBACK/);
  assert.throws(() => createPublicPreviewServer({ publicPreviewMode: true, host: '127.0.0.1', port: 8787 }), /PORT_NOT_APPROVED/);
  assert.throws(() => loadPublicPreviewArtifact(path.join(os.tmpdir(), 'missing-preview-manifest.json')), /MANIFEST_MISSING/);
});

test('public HTTP surface allows only frozen GET routes and rejects every mutation/private route', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dw2-public-http-'));
  const staticRoot = path.join(root, 'static');
  const sharedRoot = path.join(root, 'shared');
  fs.mkdirSync(staticRoot, { recursive: true });
  fs.mkdirSync(sharedRoot, { recursive: true });
  for (const name of ['index.html', 'app.js', 'styles.css']) fs.writeFileSync(path.join(staticRoot, name), name === 'index.html' ? '<!doctype html><title>preview</title>' : '/* preview */');
  for (const name of ['styles.css', 'trader-terminal-shell.css', 'trader-terminal-shell.js']) fs.writeFileSync(path.join(sharedRoot, name), '/* shared */');
  const vendor = path.join(root, 'lightweight.js'); fs.writeFileSync(vendor, 'globalThis.LightweightCharts={}');
  const files = artifact(path.join(root, 'artifact')).files;
  const preview = createPublicPreviewServer({ manifestPath: files.manifestPath, publicDir: staticRoot, sharedPublicDir: sharedRoot, lightweightChartsPath: vendor, publicPreviewMode: true });
  await new Promise((resolve) => preview.server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${preview.server.address().port}`;
  try {
    for (const route of ['/', '/healthz', '/assets/dashboard-styles.css', '/assets/trader-terminal-shell.css', '/assets/trader-terminal-shell.js', '/api/public-preview/workspace', ...PUBLIC_PREVIEW_TIMEFRAMES.map((timeframe) => `/api/public-preview/tx-chart?timeframe=${timeframe}`)]) {
      const response = await fetch(`${origin}${route}`);
      assert.equal(response.status, 200, route);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('x-robots-tag'), 'noindex, nofollow');
      assert.equal(response.headers.get('set-cookie'), null);
      assert.equal(scanPublicPreviewPayload(await response.text()).length, 0);
    }
    assert.equal((await fetch(`${origin}/api/public-preview/tx-chart?timeframe=../../data/live-events`)).status, 400);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const response = await fetch(`${origin}/api/public-preview/workspace`, { method });
      assert.equal(response.status, 405, method);
      assert.equal((await response.json()).error, 'READ_ONLY_PREVIEW');
    }
    for (const route of ['/api/v1/data', '/api/v2/decision-journal', '/api/forward-shadow', '/raw-ledger', '/sqlite', '/env', '/debug', '/../../.env']) {
      assert.equal((await fetch(`${origin}${route}`)).status, 404, route);
    }
  } finally {
    await new Promise((resolve) => preview.server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('public frontend uses only public preview APIs, has seven timeframes and preserves read-only labels', () => {
  const html = fs.readFileSync(path.join(projectRoot, 'public-preview', 'index.html'), 'utf8');
  const app = fs.readFileSync(path.join(projectRoot, 'public-preview', 'app.js'), 'utf8');
  assert.match(html, /PREVIEW · NOT MAIN/);
  assert.match(html, /FROZEN GOVERNED SNAPSHOT · NOT LIVE MARKET DATA/);
  assert.match(html, /READ ONLY/);
  assert.match(html, /NOT A TRADING SIGNAL/);
  assert.match(html, /MANUAL_REVIEW_ONLY/);
  assert.doesNotMatch(html, /NO_TRADE/);
  assert.match(html, /trader-terminal-shell\.css/);
  assert.match(html, /trader-terminal-shell\.js/);
  assert.match(app, /api\/public-preview\/workspace/);
  assert.match(app, /api\/public-preview\/tx-chart/);
  assert.match(app, /\['1m','5m','15m','30m','1h','4h','1D'\]/);
  assert.match(app, /function chartEpoch[\s\S]*Date\.parse/);
  assert.match(app, /time:\s*chartEpoch\(bar\.time\)/);
  assert.doesNotMatch(app, /\/api\/v[12]\//);
  assert.doesNotMatch(app, /decision-journal|daily-update|forward-shadow/i);
  assert.match(app, /navigator\.clipboard\.writeText/);
  assert.match(app, /TraderTerminalShell\?\.mount/);
});

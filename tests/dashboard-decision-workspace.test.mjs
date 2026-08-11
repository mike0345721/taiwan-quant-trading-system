import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildDecisionWorkspace,
  copyForChatGpt,
  createDecisionSnapshot,
  validateDecisionSnapshot,
} from '../src/dashboard-decision-workspace.mjs';
import { appendDecisionJournal, auditDecisionJournal, readDecisionJournal } from '../src/decision-journal.mjs';

const root = path.resolve('data/decision-workspace/dw1-test-fixtures');
const now = new Date('2026-08-12T00:20:00.000Z');

function health() {
  return {
    schemaVersion: 'dashboard-data-health-v1', generatedAt: now.toISOString(), overall: 'UNAVAILABLE',
    staleCount: 0, unavailableCount: 2, counts: {},
    items: [
      { sourceId: 'forwardShadowRuntime', freshnessState: 'UNAVAILABLE', reason: 'RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD', availableAt: null },
      { sourceId: 'futuresMarket', freshnessState: 'FRESH', reason: null, availableAt: '2026-08-11T14:00:00.000Z' },
    ],
    formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

function sourceSnapshot() {
  return {
    dataMode: 'live', generatedAt: '2026-08-11T14:00:00.000Z',
    futuresMarket: { ok: true, fetchedAt: '2026-08-11T14:00:00.000Z', data: { txDay: { contract: '202608', close: 22500, session: 'DAY' } } },
    marketBreadth: { ok: false }, options: { ok: false }, marketOverview: { ok: false },
  };
}

test.beforeEach(() => fs.rmSync(root, { recursive: true, force: true }));
test.after(() => fs.rmSync(root, { recursive: true, force: true }));

test('decision snapshot is deterministic, hashable and preserves unavailable values', () => {
  const input = { snapshot: sourceSnapshot(), dataHealth: health(), snapshotTime: now.toISOString() };
  const first = createDecisionSnapshot(input);
  const second = createDecisionSnapshot(input);
  assert.deepEqual(first, second);
  assert.equal(validateDecisionSnapshot(first).valid, true);
  assert.equal(first.OR.value, null);
  assert.equal(first.OR.reason, 'DERIVATION_NOT_IMPLEMENTED');
  assert.equal(first.marketState.direction, 'UNAVAILABLE');
  assert.equal(first.executionAuthorized, false);
});

test('snapshot rejects evidence that was not available at decision time', () => {
  const futureHealth = health();
  futureHealth.items[1].availableAt = '2026-08-12T00:21:00.000Z';
  assert.throws(() => createDecisionSnapshot({ snapshot: sourceSnapshot(), dataHealth: futureHealth, snapshotTime: now.toISOString() }), /FUTURE_EVIDENCE/);
});

test('workspace makes NO_TRADE first class and never promotes legacy scores', () => {
  const workspace = buildDecisionWorkspace({ snapshot: sourceSnapshot(), dataHealth: health(), now });
  assert.equal(workspace.decisionSummary.posture, 'NO_TRADE');
  assert.equal(workspace.decisionSummary.readiness, 'NOT_READY');
  assert.equal(workspace.decisionSummary.direction, 'UNAVAILABLE');
  assert.equal(workspace.priceChartSlot.status, 'NOT_IMPLEMENTED');
  assert.equal(workspace.policies.directGptApi, false);
});

test('copy for ChatGPT includes immutable identity and discussion-only boundary', () => {
  const snapshot = createDecisionSnapshot({ snapshot: sourceSnapshot(), dataHealth: health(), snapshotTime: now.toISOString() });
  const text = copyForChatGpt(snapshot, '最大反向證據？');
  assert.match(text, /DISCUSSION CONTEXT — NOT A TRADING SIGNAL/);
  assert.match(text, new RegExp(snapshot.snapshotHash));
  assert.match(text, /RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD/);
});

test('manual decision journal is isolated, append-only and snapshot immutable', () => {
  const filePath = path.join(root, 'journal.ndjson');
  const snapshot = createDecisionSnapshot({ snapshot: sourceSnapshot(), dataHealth: health(), snapshotTime: now.toISOString() });
  const first = appendDecisionJournal(filePath, { intent: 'NO_TRADE', reason: 'data unavailable', snapshot }, { now });
  const second = appendDecisionJournal(filePath, { intent: 'LONG_INTENT', setup: 'wait only', snapshot }, { now: new Date(now.getTime() + 1_000) });
  const rows = readDecisionJournal(filePath);
  assert.equal(rows.length, 2);
  assert.equal(second.previousHash, first.recordHash);
  assert.equal(auditDecisionJournal([...rows].reverse()).ok, true);
  assert.equal(rows[0].snapshot.snapshotHash, snapshot.snapshotHash);
  assert.equal(rows[0].executionAuthorized, false);
  assert.throws(() => appendDecisionJournal(path.resolve('data/market-state/forward-shadow/journal.ndjson'), { intent: 'NO_TRADE', snapshot }), /FORWARD_SHADOW_PATH_FORBIDDEN/);
});

test('DW-1 UI exposes required shell without direct GPT or order routes', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const id of [
    'decision-workspace', 'dw-global-strip', 'dw-posture', 'dw-readiness', 'dw-no-trade-reason',
    'dw-price-title', 'dw-against-title', 'dw-changed-title', 'dw-data-health-panel', 'dw-ask-gpt',
    'dw-lock-snapshot', 'dw-copy-chatgpt', 'dw-journal-form', 'dw-review-mode',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /COPY MODE · NOT A TRADING SIGNAL/);
  assert.match(html, /LONG_INTENT/);
  assert.match(html, /SHORT_INTENT/);
  assert.match(html, /NO_TRADE/);
  assert.doesNotMatch(app, /place_order|update_order|cancel_order/);
});

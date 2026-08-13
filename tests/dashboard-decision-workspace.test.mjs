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
  assert.equal(workspace.priceChartSlot.status, 'UNAVAILABLE');
  assert.equal(workspace.policies.directGptApi, false);
});

test('DW-2 chart facts populate snapshot without changing NO_TRADE or Market State', () => {
  const chart = {
    status: 'READY', timeframe: '5m', session: 'DAY', actualContract: 'TXFH6', lastPrice: 22510,
    availableAt: '2026-08-12T00:19:59.000Z', source: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK', qualityStatus: 'PASS',
    openingRange: { status: 'READY', high: 22520, low: 22480, source: 'FROZEN_T0_DAY_OPENING_RANGE_0845_0900', availableAt: '2026-08-12T00:19:00.000Z' },
    levels: { vwap: { availability: 'AVAILABLE', value: 22501.5, source: 'SESSION_EXACT_TX_TICK_VWAP', availableAt: '2026-08-12T00:19:59.000Z' } },
  };
  const workspace = buildDecisionWorkspace({ snapshot: sourceSnapshot(), dataHealth: health(), chart, now });
  assert.equal(workspace.priceChartSlot.status, 'READY');
  assert.equal(workspace.priceChartSlot.actualContract, 'TXFH6');
  assert.equal(workspace.snapshot.price.value, 22510);
  assert.deepEqual(workspace.snapshot.OR.value, { high: 22520, low: 22480 });
  assert.equal(workspace.snapshot.VWAP.value, 22501.5);
  assert.equal(workspace.decisionSummary.posture, 'NO_TRADE');
  assert.equal(workspace.decisionSummary.direction, 'UNAVAILABLE');
});

test('DW-3 Market Change Feed is exposed through workspace without changing decision posture', () => {
  const marketChangeFeed = {
    schemaVersion: 'market-change-feed-v1', status: 'AVAILABLE', engineAvailability: 'AVAILABLE',
    dataTrust: { status: 'QUALITY_INSUFFICIENT', reasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'] }, observationCount: 2, eventCount: 1,
    events: [{ eventId: 'event-1', eventType: 'VWAP_CROSS_UP' }],
    latestFirst: [{ eventId: 'event-1', eventType: 'VWAP_CROSS_UP' }],
    futureDataViolations: 0, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  const workspace = buildDecisionWorkspace({ snapshot: sourceSnapshot(), dataHealth: health(), marketChangeFeed, now });
  assert.equal(workspace.whatChanged.status, 'AVAILABLE');
  assert.equal(workspace.whatChanged.dataTrust.status, 'QUALITY_INSUFFICIENT');
  assert.equal(workspace.whatChanged.observationCadence, 'COMPLETED_5M_ONLY');
  assert.equal(workspace.whatChanged.events[0].eventType, 'VWAP_CROSS_UP');
  assert.equal(workspace.decisionSummary.posture, 'NO_TRADE');
  assert.equal(workspace.policies.executionAuthorized, false);
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

test('DW-1 presents Chinese-first decision copy while retaining engineering codes in technical detail', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  for (const copy of [
    '交易準備度', '價格結構', '決策價格圖', '反向檢查', '反向證據', '支持證據',
    '缺失證據', '最近發生什麼變化？', '人工決策紀錄', '手動決策日誌', '鎖定快照',
    '複製給 ChatGPT', '儲存決策紀錄', '盤中', '回顧',
  ]) assert.match(html, new RegExp(copy));
  assert.match(app, /DERIVATION_NOT_IMPLEMENTED: '尚未實作'/);
  assert.match(app, /CONTRARY_EVIDENCE_DERIVATION_NOT_IMPLEMENTED: '反向證據目前無法計算'/);
  assert.match(app, /RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD: 'Runtime 狀態目前無法取得'/);
  assert.match(app, /技術詳情：\$\{item\.sourceAvailability\}/);
});

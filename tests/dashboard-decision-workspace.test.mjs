import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  buildCurrentMarketFactSummary,
  buildDecisionWorkspace,
  copyForChatGpt,
  createDecisionSnapshot,
  validateDecisionSnapshot,
} from '../src/dashboard-decision-workspace.mjs';
import { appendDecisionJournal, auditDecisionJournal, readDecisionJournal } from '../src/decision-journal.mjs';
import { createDw4EvidenceObservation } from '../src/dw4-evidence-conflict-monitor.mjs';

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
    dataMode: 'live', asOfDate: '2026-08-12', generatedAt: '2026-08-11T14:00:00.000Z',
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
  assert.equal(first.orderRoutesEnabled, false);
  assert.equal(first.tradeDate, '2026-08-12');
  assert.equal(first.recommendation, false);
  assert.equal(first.systemDirectionalSignal, false);
});

test('snapshot rejects evidence that was not available at decision time', () => {
  const futureHealth = health();
  futureHealth.items[1].availableAt = '2026-08-12T00:21:00.000Z';
  assert.throws(() => createDecisionSnapshot({ snapshot: sourceSnapshot(), dataHealth: futureHealth, snapshotTime: now.toISOString() }), /FUTURE_EVIDENCE/);
});

test('workspace is manual-review-only and never emits a system trade direction', () => {
  const workspace = buildDecisionWorkspace({ snapshot: sourceSnapshot(), dataHealth: health(), now });
  assert.equal(workspace.decisionSummary.posture, 'MANUAL_REVIEW_ONLY');
  assert.equal(workspace.decisionSummary.rawPosture, 'NO_TRADE');
  assert.equal(workspace.decisionSummary.systemDirectionalSignal, false);
  assert.equal(workspace.decisionSummary.readiness, 'NOT_READY');
  assert.equal(workspace.decisionSummary.direction, 'UNAVAILABLE');
  assert.equal(workspace.priceChartSlot.status, 'UNAVAILABLE');
  assert.equal(workspace.policies.directGptApi, false);
  assert.equal(workspace.forwardShadowStatus.status, 'UNKNOWN');
  assert.equal(workspace.forwardShadowStatus.reasonCode, 'UNKNOWN_INSUFFICIENT_EVIDENCE');
});

test('DW-2 chart facts populate snapshot and decision explanation without changing Market State', () => {
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
  assert.equal(workspace.decisionSummary.posture, 'MANUAL_REVIEW_ONLY');
  assert.equal(workspace.decisionSummary.direction, 'UNAVAILABLE');
  assert.match(workspace.decisionSummary.explanation, /TX 價格/);
  assert.match(workspace.decisionSummary.explanation, /Opening Range/);
  assert.match(workspace.decisionSummary.explanation, /VWAP/);
  assert.doesNotMatch(workspace.decisionSummary.explanation, /OR、VWAP.*尚未/);
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
  assert.equal(workspace.decisionSummary.posture, 'MANUAL_REVIEW_ONLY');
  assert.equal(workspace.policies.executionAuthorized, false);
});

test('current-market fact summary is deterministic, governed-input-only and never a recommendation', () => {
  const feed = {
    presentationGroupsLatestFirst: [{
      presentationType: 'SESSION_EXTREME_STREAK', headline: '本時段再創新高 × 3', evidenceCount: 3,
      descriptiveContext: { previousExtreme: 22500, newExtreme: 22508, absoluteExtension: 8, streakCount: 3 },
      events: [
        { eventId: 'event-1', eventType: 'NEW_SESSION_HIGH', headline: '本時段再創新高' },
        { eventId: 'event-2', eventType: 'NEW_SESSION_HIGH', headline: '本時段再創新高' },
        { eventId: 'event-3', eventType: 'NEW_SESSION_HIGH', headline: '本時段再創新高' },
      ],
    }],
  };
  const evidence = { eligibleEvidenceFamilies: [], coverageState: 'PARTIAL', dataTrustState: 'QUALITY_INSUFFICIENT' };
  const first = buildCurrentMarketFactSummary(feed, evidence);
  const second = buildCurrentMarketFactSummary(structuredClone(feed), structuredClone(evidence));
  assert.deepEqual(first, second);
  assert.match(first.priceStructureFact, /本時段再創新高 × 3/);
  assert.match(first.priceStructureFact, /22,500.*22,508/);
  assert.match(first.evidenceEligibilityFact, /沒有符合方向彙總資格/);
  assert.deepEqual(first.sourceEventIds, ['event-1', 'event-2', 'event-3']);
  assert.equal(first.recommendation, false);
  assert.doesNotMatch(`${first.priceStructureFact} ${first.evidenceEligibilityFact}`, /\bBUY\b|\bSELL\b|\bLong\b|\bShort\b|信心|分數/i);
});

test('current-market fact summary fails closed when no governed event is available', () => {
  const summary = buildCurrentMarketFactSummary(null, null);
  assert.equal(summary.priceStructureFact, '目前沒有新的 governed 盤中結構事件。');
  assert.equal(summary.coverageState, 'INSUFFICIENT');
  assert.equal(summary.dataTrustState, 'BLOCKED');
  assert.deepEqual(summary.sourceEventIds, []);
});

test('copy for ChatGPT includes immutable identity and discussion-only boundary', () => {
  const snapshot = createDecisionSnapshot({ snapshot: sourceSnapshot(), dataHealth: health(), snapshotTime: now.toISOString() });
  const text = copyForChatGpt(snapshot, '最大反向證據？');
  assert.match(text, /DISCUSSION CONTEXT — NOT A TRADING SIGNAL/);
  assert.match(text, new RegExp(snapshot.snapshotHash));
  assert.match(text, /RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD/);
  assert.match(text, /DW-4: conflict=NO_DIRECTIONAL_EVIDENCE; coverage=INSUFFICIENT; dataTrust=BLOCKED/);
  assert.match(text, /Trade Date: 2026-08-12/);
  assert.match(text, /recommendation=false; systemDirectionalSignal=false; formalWeight=0; researchOnly=true; executionAuthorized=false; orderRoutesEnabled=false/);
  assert.match(text, /USER QUESTION: 最大反向證據？$/);
});

test('Copy for ChatGPT preserves descriptive values and separates them from directional eligibility', () => {
  const rich = sourceSnapshot();
  rich.marketBreadth = { ok: true, fetchedAt: '2026-08-11T14:00:00.000Z', data: { listed: { advance: 500, decline: 300, unchanged: 100, limitUp: 12, limitDown: 2 } } };
  rich.options = { ok: true, fetchedAt: '2026-08-11T14:00:00.000Z', data: { contract: 'TXO202608', oiPcRatio: 1.2, callWall: { strike: 23000 }, putWall: { strike: 22000 }, maxPain: 22500 } };
  rich.marketOverview = { ok: true, fetchedAt: '2026-08-11T14:00:00.000Z', data: { vix: 18.2, usdtwd: 30.5, ndxProxy: 0.7 } };
  rich.futuresInstitutional = { ok: true, fetchedAt: '2026-08-11T14:00:00.000Z', data: { foreignNet: -12345 } };
  const richHealth = health();
  richHealth.items.push(
    { sourceId: 'chartBar', sourceAvailability: 'SOURCE_AVAILABLE', freshnessState: 'FRESH', quality: 'PASS', readinessState: 'READY', exchangeTimestamp: '2026-08-12T00:15:00.000Z', availableAt: '2026-08-12T00:16:00.000Z' },
    { sourceId: 'breadth', sourceAvailability: 'SOURCE_AVAILABLE', freshnessState: 'FRESH', quality: 'PASS', readinessState: 'RAW_VALIDATED_CANDIDATE', exchangeTimestamp: '2026-08-11T14:00:00.000Z', availableAt: '2026-08-11T14:00:00.000Z' },
    { sourceId: 'futuresPositioning', sourceAvailability: 'SOURCE_AVAILABLE', freshnessState: 'FRESH', quality: 'PASS', readinessState: 'READY', exchangeTimestamp: '2026-08-11T14:00:00.000Z', availableAt: '2026-08-11T14:00:00.000Z' },
    { sourceId: 'optionsEod', sourceAvailability: 'SOURCE_AVAILABLE', freshnessState: 'FRESH', quality: 'PASS', readinessState: 'READY', exchangeTimestamp: '2026-08-11T14:00:00.000Z', availableAt: '2026-08-11T14:00:00.000Z' },
    { sourceId: 'marketOverview', sourceAvailability: 'SOURCE_AVAILABLE', freshnessState: 'FRESH', quality: 'PASS', readinessState: 'READY', exchangeTimestamp: '2026-08-11T14:00:00.000Z', availableAt: '2026-08-11T14:00:00.000Z' },
  );
  const chart = {
    status: 'READY', session: 'DAY', actualContract: 'TXFH6', lastPrice: 22510,
    availableAt: '2026-08-12T00:16:00.000Z',
    openingRange: { status: 'READY', high: 22520, low: 22480, availableAt: '2026-08-12T00:15:00.000Z' },
    levels: { vwap: { availability: 'AVAILABLE', value: 22501.5, vwapSession: 'DAY', availableAt: '2026-08-12T00:16:00.000Z' } },
  };
  const workspace = buildDecisionWorkspace({ snapshot: rich, dataHealth: richHealth, chart, now });
  const price = workspace.evidenceConflict.evidence.find((item) => item.family === 'PRICE_STRUCTURE');
  const options = workspace.evidenceConflict.evidence.find((item) => item.family === 'OPTIONS_CONTEXT');
  assert.equal(price.availabilityState, 'AVAILABLE');
  assert.equal(price.promotionState, 'NOT_PROMOTED');
  assert.equal(price.directionState, 'NOT_ELIGIBLE');
  assert.equal(price.detail.descriptiveValues.some((item) => item.label === 'TX 最新成交' && item.value === 22510), true);
  assert.equal(options.detail.descriptiveValues.some((item) => item.label === 'EOD OI P/C Ratio' && item.value === 1.2), true);
  assert.match(workspace.chatGptCopy, /Descriptive family values \(display only; not directional evidence\)/);
  assert.match(workspace.chatGptCopy, /directionalEligible=false/);
  assert.doesNotMatch(JSON.stringify(workspace.evidenceConflict), /\bBUY\b|\bSELL\b/);
});

test('DW-4 mixed eligible evidence remains separate from quality and coverage', () => {
  const eligible = (family, directionState) => createDw4EvidenceObservation({
    evidenceId: `fixture:${family}`, family, directionState, availabilityState: 'AVAILABLE', qualityState: 'PASS',
    promotionState: 'ELIGIBLE', eventTime: '2026-08-12T00:15:00.000Z', availableAt: '2026-08-12T00:16:00.000Z', sourceId: `fixture-${family}`,
  });
  const price = createDw4EvidenceObservation({
    evidenceId: 'fixture:PRICE_STRUCTURE', family: 'PRICE_STRUCTURE', directionState: 'NOT_ELIGIBLE',
    availabilityState: 'AVAILABLE', qualityState: 'QUALITY_INSUFFICIENT', promotionState: 'ELIGIBLE',
    eventTime: '2026-08-12T00:15:00.000Z', availableAt: '2026-08-12T00:16:00.000Z', sourceId: 'fixture-price',
    qualityReasons: ['TIMESTAMP_LINEAGE_INSUFFICIENT'],
  });
  const workspace = buildDecisionWorkspace({
    snapshot: sourceSnapshot(), dataHealth: health(), now,
    dw4EvidenceObservations: [
      price,
      eligible('PARTICIPATION_BREADTH', 'SUPPORTS_UP'),
      eligible('FUTURES_INSTITUTIONAL', 'SUPPORTS_UP'),
      eligible('OPTIONS_CONTEXT', 'SUPPORTS_UP'),
      eligible('GLOBAL_FX', 'SUPPORTS_DOWN'),
    ],
  });
  assert.equal(workspace.evidenceConflict.conflictState, 'MIXED');
  assert.equal(workspace.evidenceConflict.coverageState, 'PARTIAL');
  assert.equal(workspace.evidenceConflict.dataTrustState, 'QUALITY_INSUFFICIENT');
  assert.equal(workspace.decisionSummary.readiness, 'DEGRADED');
  assert.deepEqual(workspace.evidenceConflict.qualityExcludedFamilies, ['PRICE_STRUCTURE']);
  assert.match(workspace.chatGptCopy, /conflict=MIXED; coverage=PARTIAL; dataTrust=QUALITY_INSUFFICIENT/);
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
    'dw-conflict-state', 'dw-coverage-state', 'dw-trust-state', 'dw-family-grid',
    'dw-now-price-fact', 'dw-now-evidence-fact', 'dw-now-trust-fact',
    'dw-conflict-state-raw', 'dw-coverage-state-raw', 'dw-trust-state-raw',
  ]) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /COPY MODE · NOT A TRADING SIGNAL/);
  assert.match(html, /LONG_INTENT/);
  assert.match(html, /SHORT_INTENT/);
  assert.match(html, /NO_TRADE/);
  assert.match(html, /僅供人工判讀/);
  assert.match(html, /id="dw-global-posture"/);
  assert.match(html, /id="dw-global-trust"/);
  assert.doesNotMatch(html, /<h3 id="dw-posture">NO_TRADE<\/h3>/);
  for (const label of ['即時／重播', 'EOD／延遲', '批次', '本時段', '代理資料', '即時原始資料']) {
    assert.match(app, new RegExp(label));
  }
  assert.doesNotMatch(app, /EOD_OR_DELAYED:\s*['"]即時/);
  assert.doesNotMatch(app, /place_order|update_order|cancel_order/);
});

test('formal dashboard wiring carries posture, five evidence families and complete ChatGPT copy', () => {
  const server = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(server, /return buildDecisionWorkspace\(\{ snapshot, dataHealth, runtimeTruth, chart, marketChangeFeed \}\)/);
  assert.match(server, /decisionWorkspacePayload\(clientSnapshot, servicePayload\)/);
  assert.match(app, /decision\.posture === 'MANUAL_REVIEW_ONLY' \? '僅供人工判讀'/);
  assert.match(app, /renderDw4Evidence\(workspace\?\.evidenceConflict\)/);
  assert.match(app, /renderMarketPulse\(workspace/);
  const workspace = buildDecisionWorkspace({ snapshot: sourceSnapshot(), dataHealth: health(), now });
  assert.equal(workspace.evidenceConflict.evidence.length, 5);
  assert.deepEqual(workspace.evidenceConflict.evidence.map((item) => item.family), [
    'PRICE_STRUCTURE', 'PARTICIPATION_BREADTH', 'FUTURES_INSTITUTIONAL', 'OPTIONS_CONTEXT', 'GLOBAL_FX',
  ]);
  assert.equal(workspace.decisionSummary.posture, 'MANUAL_REVIEW_ONLY');
  for (const required of [
    'Trade Date:', 'DW-4: conflict=', 'Eligible evidence:', 'Excluded evidence:',
    'Recent governed changes:', 'Current governed fact summary:', 'recommendation=false', 'orderRoutesEnabled=false',
  ]) assert.match(workspace.chatGptCopy, new RegExp(required));
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

test('final trader UX keeps event hierarchy, source modes and raw contracts visibly separated', () => {
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  const styles = fs.readFileSync(new URL('../public/styles.css', import.meta.url), 'utf8');
  assert.match(html, /現在市場發生什麼？/);
  assert.match(html, /原始三軸 contract/);
  assert.match(app, /presentationGroupsLatestFirst/);
  assert.match(app, /主要價格結構/);
  assert.match(app, /時段高低延伸/);
  assert.match(app, /資料品質事件/);
  assert.match(app, /原始 sourceMode/);
  for (const selector of ['is-primary-structure', 'is-secondary-structure', 'is-data-trust', 'dw-source-mode', 'dw-now-summary']) {
    assert.match(styles, new RegExp(selector));
  }
  assert.match(html, /BLOCKED 只代表彙總不可用，不是禁止交易/);
  assert.match(html, /id="side-nav-toggle"/);
  assert.match(html, /Market Pulse/);
  assert.match(html, /Evidence Detail｜五項證據/);
  assert.match(styles, /grid-template-columns: minmax\(0, 2\.25fr\) minmax\(300px, \.85fr\)/);
  assert.match(styles, /workspace-layout\.is-nav-collapsed/);
  assert.match(app, /localStorage\.setItem\(sidebarPreferenceKey/);
  assert.match(app, /is-capability-limited/);
  assert.doesNotMatch(app, /place_order|update_order|cancel_order/);
});

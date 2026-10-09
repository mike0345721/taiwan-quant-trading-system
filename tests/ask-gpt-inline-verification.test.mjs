// Sanitized synthetic evidence only. All inference/transport/store operations are
// injected; no credentials, raw ledger, running dashboard or model requests.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { randomUUID } from 'node:crypto';
import { CONTENT_SCHEMA, DECISION_HEADINGS, verifyAnalysisContent, analysisContentContract, verifiedReceiptText } from '../src/ask-gpt-inline-verification.mjs';
import { buildInlineContext } from '../src/ask-gpt-inline-context.mjs';
import { createDecisionSnapshot } from '../src/dashboard-decision-workspace.mjs';
import { buildDecisionLevelWatch } from '../src/decision-level-watch.mjs';
import { buildDashboardObservedFlow } from '../src/dashboard-observed-flow.mjs';
import { InlineAssistant } from '../src/ask-gpt-inline-service.mjs';
import { readAnalysisStream } from '../src/chatgpt-plan-inference.mjs';

test.before(() => { globalThis.fetch = () => { throw Error('REAL_NETWORK_FORBIDDEN'); }; });
const now = Date.parse('2026-10-09T02:00:00Z');
const stamp = new Date(now).toISOString();
function snapshot(price = 49046, vwap = 48981.43164262448) {
  const node = { id: 'VWAP', family: 'VWAP', price: vwap, state: 'MONITORING', qualityStatus: 'PASS', availableAt: stamp };
  const side = { state: 'WAIT_CONFIRMATION', flowConfirmationState: 'UNAVAILABLE', confirmationThreshold: null, invalidationThreshold: null, target: null, rr: { state: 'UNAVAILABLE', ratio: null, riskPoints: null, rewardPoints: null } };
  return createDecisionSnapshot({
    snapshotTime: stamp, dataHealth: { items: [], overall: 'PARTIAL', unavailableCount: 0, staleCount: 0 },
    chart: { lastPrice: price, source: 'SYNTHETIC_ONLY', availableAt: stamp, tradeDate: '2026-10-09', actualContract: 'TXFJ6', session: 'DAY', bars: [], levels: { vwap: { availability: 'AVAILABLE', value: vwap, availableAt: stamp, source: 'SYNTHETIC_ONLY' } } },
    levelWatch: { state: 'READY', currentPrice: price, nextWatch: node, levels: [node], scenarioWatch: { directionState: 'BIDIRECTIONAL_WATCH', node, long: { ...side }, short: { ...side } }, formalWeight: 0, researchOnly: true, recommendation: false, systemDirectionalSignal: false, executionAuthorized: false, orderRoutesEnabled: false },
  });
}
const context = () => buildInlineContext(snapshot(), { now }).context;
const answer = (c = context()) => ({
  schema: CONTENT_SCHEMA, directionState: c.levelWatch.scenarioWatch.directionState,
  nodeState: c.levelWatch.scenarioWatch.node.state,
  facts: [{ field: 'price.value', value: c.price.value }, { field: 'VWAP.value', value: Number(c.VWAP.value.toFixed(2)) }],
  comparisons: [{ left: 'price.value', operator: c.price.value > c.VWAP.value ? 'ABOVE' : c.price.value < c.VWAP.value ? 'BELOW' : 'EQUAL', right: 'VWAP.value' }],
});
const verify = (a, c = context()) => verifyAnalysisContent(JSON.stringify(a), c);
const extraFact = (field, value) => ({ ...answer(), facts: [...answer().facts, { field, value }] });

function decisionContext() {
  const c = structuredClone(context());
  c.price.value = 105; c.VWAP.value = 100;
  const node = { id: 'VWAP', state: 'MONITORING', price: 100, qualityStatus: 'PASS', availableAt: stamp,
    why: 'Multiple lawful references converge', basisReasons: ['Independent post-formation tests'] };
  const side = { state: 'WAIT_CONFIRMATION', flowConfirmationState: 'QUALITY_INSUFFICIENT',
    confirmationThreshold: 110, invalidationThreshold: 90,
    target: { price: 130, qualityStatus: 'PASS', importanceBand: 'PRIMARY', why: 'Upper qualified structure' },
    rr: { state: 'AVAILABLE', ratio: 1, riskPoints: 20, rewardPoints: 20 },
    confirm: 'Must sustain above threshold; require aligned price response',
    invalidate: 'Loss of the lower boundary or buying pressure without upward progress' };
  c.levelWatch = { state: 'READY', sourceAvailableAt: stamp,
    nextWatch: { ...node, expectedResponse: 'Acceptance requires sustained departure with aligned pressure' },
    observedFlow: { sourceState: 'LIVE', quality: 'QUALITY_INSUFFICIENT', pressure60: 0.47, response60: -2.7, availableAt: stamp },
    scenarioWatch: { directionState: 'BIDIRECTIONAL_WATCH', node, long: side,
      short: { ...side, confirmationThreshold: 90, invalidationThreshold: 110,
        confirm: 'Must sustain below threshold; require downward response',
        invalidate: 'Reclaim of the upper boundary or selling pressure without downward progress',
        target: { price: 70, qualityStatus: 'PASS', importanceBand: 'PRIMARY', why: 'Lower qualified structure' } } } };
  c.observedFlow = { quality: { status: 'QUALITY_INSUFFICIENT', reason: 'CLASSIFICATION_INCOMPLETE', reasons: ['Incomplete coverage'] } };
  c.dataHealthWarnings = [{ freshness: 'STALE', quality: 'QUALITY_INSUFFICIENT', reasonCode: 'SOURCE_DELAYED', availableAt: stamp }];
  return c;
}

test('B1 minimal claims always render all available decision reasons, both scenarios, quality and ordered headings', () => {
  const c = decisionContext(), a = { ...answer(c), comparisons: [] };
  assert.equal(a.facts.length, 2);
  const { text } = verify(a, c);
  const headings = ['現在怎麼看', '核心決策節點', '多方情境', '空方情境', '觀望條件', '條件式結構 R:R', '現在不要做什麼', '資料限制'];
  assert.deepEqual(DECISION_HEADINGS, headings);
  assert.deepEqual(text.split('\n').filter(line => headings.some(h => line.startsWith(h + '：'))).map(line => line.split('：')[0]), headings);
  for (const value of ['Multiple lawful references converge', 'Independent post-formation tests', 'Acceptance requires sustained departure',
    '多方條件式確認門檻（不代表已成立）：110', '多方條件式失效門檻：90', '空方條件式確認門檻（不代表已成立）：90', '空方條件式失效門檻：110',
    'Must sustain above threshold', 'Must sustain below threshold', 'Loss of the lower boundary', 'Reclaim of the upper boundary',
    '多方條件式結構目標：130', '空方條件式結構目標：70', 'Upper qualified structure', 'Lower qualified structure',
    '多方條件式結構R:R：1', '空方條件式結構R:R：1', '風險距離：20', '報酬距離：20',
    'Flow 品質：品質不足', 'Flow 確認品質：品質不足', '不確定性', 'CLASSIFICATION_INCOMPLETE', 'Incomplete coverage', 'SOURCE_DELAYED', stamp]) assert.ok(text.includes(value), value);
  assert.match(text.split('\n')[0], /Flow 品質：品質不足/);
  assert.doesNotMatch(text, /0\.47|-2\.7/);
  assert.match(text, /持續觀察，尚未進入測試/);
  const all = { ...a, facts: analysisContentContract(c).fields.map(f => ({ field: f.field, value: f.expected })) };
  assert.equal(verify(all, c).text, text, 'model selection cannot omit context content');
});

test('B1 backend why, basis and confirm independently change the answer and are bound on recovery', () => {
  const c = decisionContext(), a = answer(c), result = verify(a, c);
  const receipt = { context: c, contextHash: result.verification.contextHash, text: result.text,
    validatedClaims: a, contentVerification: result.verification };
  assert.equal(verifiedReceiptText(receipt), result.text);
  for (const mutate of [x => { x.levelWatch.scenarioWatch.node.why = 'Changed lawful rationale'; },
    x => { x.levelWatch.scenarioWatch.node.basisReasons = ['Changed independent evidence']; },
    x => { x.levelWatch.scenarioWatch.long.confirm = 'Require sustained retest acceptance'; }]) {
    const changed = structuredClone(c); mutate(changed);
    assert.notEqual(verify(a, changed).text, result.text);
    assert.throws(() => verifiedReceiptText({ ...receipt, context: changed }), /CONTENT_UNVERIFIED_RECEIPT/);
  }
});

test('B1 stale or missing context never revives scenario numerics, reasons or Flow', () => {
  for (const mutate of [c => { c.levelWatch.state = 'UNAVAILABLE'; },
    c => { c.levelWatch.sourceAvailableAt = new Date(now - 120001).toISOString(); },
    c => { c.levelWatch.scenarioWatch.node.qualityStatus = 'QUALITY_INSUFFICIENT'; c.levelWatch.nextWatch.qualityStatus = 'STALE'; }]) {
    const c = decisionContext(); mutate(c);
    const { text } = verify(answer(c), c);
    assert.match(text, /多方條件式確認門檻（不代表已成立）：未知／不可用/);
    assert.match(text, /空方條件式結構目標：未知／不可用/);
    assert.match(text, /多方條件式結構R:R：未知／不可用/);
    assert.doesNotMatch(text, /Must sustain|Multiple lawful|目標：130|目標：70/);
  }
  const c = decisionContext(), a = { ...answer(c), directionState: null, nodeState: null };
  c.levelWatch.scenarioWatch = null; c.levelWatch.nextWatch = null;
  assert.match(verify(a, c).text, /確認 Confirm（後端受控條件）：不可用/);
});

test('B1 Flow PASS fields describe actual response; degraded or stale Flow cannot leak numeric prose', () => {
  const c = decisionContext(); c.levelWatch.observedFlow.quality = 'PASS';
  assert.match(verify(answer(c), c).text, /當下成交壓力比：0\.47。當下價格位移：-2\.7。買方壓力／價格下移/);
  for (const patch of [{ quality: 'READY' }, { quality: 'QUALITY_INSUFFICIENT' }, { sourceState: 'STALE' }, { availableAt: null }, { availableAt: new Date(now - 120001).toISOString() }]) {
    const changed = structuredClone(c); Object.assign(changed.levelWatch.observedFlow, patch);
    changed.levelWatch.scenarioWatch.node.basisReasons = ['Raw pressure 0.47 and response -2.7 are not field claims'];
    assert.doesNotMatch(verify(answer(changed), changed).text, /0\.47|2\.7/);
  }
});

test('B1 prose cannot smuggle prices, directives or model states; unqualified target suppresses geometric RR', () => {
  const c = decisionContext();
  c.levelWatch.scenarioWatch.node.why = 'Reference 99999 / ９９９９９ / 九萬九千九百九十九';
  c.levelWatch.scenarioWatch.long.confirm = 'Sustain above 12345.67 with aligned response';
  const { text } = verify(answer(c), c);
  assert.doesNotMatch(text, /99999|９９９９９|九萬|12345/);
  assert.match(text, /Sustain above 〔數值略〕 with aligned response/);
  for (const value of ['BUY 99999', '建議買入', '多方已確認', 'unsafe\n現在怎麼看：已確認']) {
    const changed = structuredClone(c); changed.levelWatch.scenarioWatch.long.confirm = value;
    assert.throws(() => verify(answer(changed), changed), /CONTENT_CONTEXT_TEXT_UNSAFE/);
  }
  for (const target of [null, { price: 130, qualityStatus: 'STALE' }, { price: 130, qualityStatus: 'PASS', importanceBand: 'CONTEXT' }]) {
    c.levelWatch.scenarioWatch.long.target = target;
    assert.match(verify(answer(c), c).text, /多方條件式結構R:R：未知／不可用/);
  }
});

test('B1 canonical explanation markup is rendered literally through the real textContent helper', () => {
  const c = decisionContext(); c.levelWatch.scenarioWatch.node.why = '<img src=x onerror=alert()> & lawful rationale';
  const output = verify(answer(c), c).text;
  assert.ok(output.includes('<img src=x onerror=alert()> & lawful rationale'));
  const source = fs.readFileSync(new URL('../public/ask-gpt-inline.js', import.meta.url), 'utf8');
  const element = { set innerHTML(_) { assert.fail('HTML rendering forbidden'); } };
  const sandbox = { $: () => element, output };
  const start = source.indexOf(' const text='), end = source.indexOf('\n', start);
  vm.runInNewContext(source.slice(start, end) + '\ntext("ai-answer",output);', sandbox);
  assert.equal(element.textContent, output);
});

test('B1 real deterministic producer conditions retain only their own eligible numeric binding', () => {
  const available = value => ({ availability: 'AVAILABLE', value, availableAt: stamp, qualityStatus: 'PASS', source: 'SYNTHETIC_ONLY' });
  const chart = { actualContract: 'TXFJ6', tradeDate: '2026-10-09', session: 'DAY', availableAt: stamp,
    timeframe: '5m', lastPrice: 100, qualityStatus: 'PASS', openingRange: { status: 'READY' },
    bars: [{ time: '2026-10-09T01:50:00Z', availableAt: '2026-10-09T01:54:59Z', open: 100, high: 105, low: 95, close: 100, qualityStatus: 'PASS' }],
    levels: { vwap: available(100), openingRangeHigh: available(150), openingRangeLow: available(50) } };
  const levelWatch = buildDecisionLevelWatch({ chart, snapshotTime: stamp });
  const snapshot = createDecisionSnapshot({ chart, levelWatch, snapshotTime: stamp,
    dataHealth: { items: [], overall: 'PARTIAL', unavailableCount: 0, staleCount: 0 } });
  const c = buildInlineContext(snapshot, { now }).context;
  const { text } = verify(answer(c), c);
  for (const side of ['long', 'short']) {
    const s = c.levelWatch.scenarioWatch[side];
    assert.equal(s.rr.state, 'AVAILABLE');
    assert.ok(text.includes(s.confirm.replace(/\d+\.00/g, token => String(Number(token)))));
    assert.ok(text.includes(s.invalidate.replace(/\d+\.00/g, token => String(Number(token)))));
  }
  assert.match(text, /目前交易時段成交均價參考/);
  assert.match(text, /預期價格反應 Expected：有效接受/);
  const changed = structuredClone(c);
  changed.levelWatch.scenarioWatch.long.confirm = '價格站上 150 並能維持'; // lawful target, wrong field
  assert.match(verify(answer(changed), changed).text, /確認 Confirm（後端受控條件）：價格站上 〔數值略〕 並能維持/);
});

test('valid conservative field claims preserve WATCH/MONITORING and safe rounding', () => {
  const result = verify(answer());
  assert.match(result.text, /VWAP：48981\.43/);
  assert.match(result.text, /快照價格 49046 高於 VWAP 48981\.43/);
  assert.match(result.text, /雙向觀察，方向未定/);
  assert.match(result.text, /持續觀察，尚未進入測試/);
  assert.match(result.text, /不提供買賣建議/);
  assert.equal(result.verification.status, 'PASSED');
  const c = context();
  assert.equal(result.verification.contextHash, buildInlineContext(snapshot(), { now }).contextHash);
  assert.equal(verify({ ...answer(), facts: [{ field: 'price.value', value: 49046 }, { field: 'VWAP.value', value: c.VWAP.value }] }).verification.status, 'PASSED');
  const pretty = JSON.stringify(answer(), null, 2).replace('49046', '49046.00').replace('48981.43', '48981.4300');
  assert.equal(verifyAnalysisContent(pretty, c).text, result.text);
});

test('sanitized original wrong VWAP, contradictory comparison and state promotion all fail', () => {
  const prose = 'VWAP=49981.43。49046 高於 49981.43。VWAP=49981.43。目前為 active bidirectional TEST，已確認多方。';
  assert.throws(() => verifyAnalysisContent(prose, context()), /CONTENT_FORMAT_INVALID/);
  const bad = answer(); bad.facts[1].value = 49981.43;
  assert.throws(() => verify(bad), /CONTENT_FACT_MISMATCH/);
  const wrongComparison = answer(); wrongComparison.comparisons[0].operator = 'BELOW';
  assert.throws(() => verify(wrongComparison), /CONTENT_COMPARISON_MISMATCH/);
  for (const patch of [{ directionState: 'BIDIRECTIONAL_TEST' }, { nodeState: 'TESTING' }, { directionState: 'LONG_CONFIRMED' }, { directionState: 'SHORT_CONFIRMED' }]) {
    assert.throws(() => verify({ ...answer(), ...patch }), /CONTENT_STATE_MISMATCH/);
  }
  assert.throws(() => verify({ ...bad, directionState: 'BIDIRECTIONAL_TEST', nodeState: 'TESTING' }), /CONTENT_STATE_MISMATCH/);
});

test('numbers are checked by field, never by membership in the context', () => {
  const c = structuredClone(context()); c.OR = { availability: 'AVAILABLE', value: { high: 49981.43, low: 48000 } };
  const bad = answer(c); bad.facts[1].value = 49981.43;
  assert.throws(() => verify(bad, c), /CONTENT_FACT_MISMATCH/);
  const swapped = answer(); [swapped.facts[0].value, swapped.facts[1].value] = [swapped.facts[1].value, swapped.facts[0].value];
  assert.throws(() => verify(swapped), /CONTENT_FACT_MISMATCH/);
});

test('generalized price values, rounding boundaries and exact comparisons do not depend on incident prices', () => {
  for (const [price, vwap] of [[112, 101.23456], [58, 61.9988], [777, 777], [0.001, 0.004], [-15, -12.349], [123456.78, 123000.1234]]) {
    const c = buildInlineContext(snapshot(price, vwap), { now }).context;
    assert.equal(verify(answer(c), c).verification.status, 'PASSED');
    for (const offset of [0.01, -0.01, 1000]) {
      const wrong = answer(c); wrong.facts[1].value = Number((wrong.facts[1].value + offset).toFixed(2));
      assert.throws(() => verify(wrong, c), /CONTENT_FACT_MISMATCH/);
    }
    const wrong = answer(c); wrong.comparisons[0].operator = wrong.comparisons[0].operator === 'ABOVE' ? 'BELOW' : 'ABOVE';
    assert.throws(() => verify(wrong, c), /CONTENT_COMPARISON_MISMATCH/);
  }
  const c = buildInlineContext(snapshot(100.003, 100.004), { now }).context;
  assert.match(verify(answer(c), c).text, /100\.003 低於 VWAP 100\.004/);
  const equal = answer(c); equal.comparisons[0].operator = 'EQUAL';
  assert.throws(() => verify(equal, c), /CONTENT_COMPARISON_MISMATCH/);
});

test('unknown/stale facts cannot become zero, thresholds, targets or recomputed R:R', () => {
  const c = structuredClone(context()); c.VWAP.availability = 'STALE';
  const unknown = answer(c); unknown.facts[1].value = null; unknown.comparisons = [];
  assert.match(verify(unknown, c).text, /VWAP：未知／不可用/);
  for (const value of [0, c.VWAP.value]) {
    unknown.facts[1].value = value;
    assert.throws(() => verify(unknown, c), /CONTENT_FACT_MISMATCH/);
  }
  for (const field of ['confirmationThreshold', 'invalidationThreshold', 'target.price', 'rr.ratio', 'rr.riskPoints', 'rr.rewardPoints']) {
    const name = 'levelWatch.scenarioWatch.long.' + field;
    assert.throws(() => verify(extraFact(name, 100)), /CONTENT_FACT_MISMATCH/);
    assert.match(verify(extraFact(name, null)).text, /未知／不可用/);
  }
  assert.throws(() => verify(extraFact('levelWatch.scenarioWatch.long.state', 'CONFIRMED')), /CONTENT_STATE_MISMATCH/);
  assert.throws(() => verify(extraFact('levelWatch.scenarioWatch.long.flowConfirmationState', 'ALIGNED')), /CONTENT_STATE_MISMATCH/);
});

test('available thresholds/target/R:R keep side attribution and conditional language', () => {
  const c = structuredClone(context());
  Object.assign(c.levelWatch.scenarioWatch.long, { confirmationThreshold: 50000, invalidationThreshold: 49000, target: { price: 51000, qualityStatus: 'PASS', importanceBand: 'STRUCTURAL' }, rr: { state: 'AVAILABLE', ratio: 1, riskPoints: 1000, rewardPoints: 1000 } });
  const a = answer(c);
  for (const [field, value] of [['confirmationThreshold', 50000], ['invalidationThreshold', 49000], ['target.price', 51000], ['rr.ratio', 1]]) a.facts.push({ field: 'levelWatch.scenarioWatch.long.' + field, value });
  assert.match(verify(a, c).text, /多方條件式確認門檻（不代表已成立）：50000/);
  a.facts[2].field = 'levelWatch.scenarioWatch.short.confirmationThreshold';
  assert.throws(() => verify(a, c), /CONTENT_FACT_MISMATCH/);
  c.levelWatch.scenarioWatch.long.rr.state = 'UNAVAILABLE';
  assert.throws(() => verify(extraFact('levelWatch.scenarioWatch.long.rr.ratio', 1), c), /CONTENT_FACT_MISMATCH/);
});

test('ambiguous numbers, free prose, recommendations and unsupported fields are rejected as a whole', () => {
  for (const value of ['48,981.43', '４８９８１．４３', '四萬八千九百八十一', '4.898143e4', 'about 48981', '48981–48982', '48981.43 BUY', true, {}, []]) {
    const a = answer(); a.facts[1].value = value;
    assert.throws(() => verify(a), /CONTENT_FACT_MISMATCH/);
  }
  for (const field of ['VWAP', 'target', 'BUY', 'SELL', 'confidence', '__proto__', 'options.value.callWall']) {
    assert.throws(() => verify(extraFact(field, 49046)), /CONTENT_FIELD_AMBIGUOUS/);
  }
  for (const text of ['BUY', 'SELL', '建議買入', '空方已確認', '若突破 99999 就進場']) {
    assert.throws(() => verify({ ...answer(), explanation: text }), /CONTENT_FORMAT_INVALID/);
    assert.throws(() => verifyAnalysisContent(JSON.stringify(answer()) + '\n' + text, context()), /CONTENT_FORMAT_INVALID/);
  }
  const duplicate = answer(); duplicate.facts.push({ ...duplicate.facts[1] });
  assert.throws(() => verify(duplicate), /CONTENT_FIELD_AMBIGUOUS/);
  assert.throws(() => verify({ ...answer(), facts: answer().facts.slice(0, 1) }), /CONTENT_FORMAT_INVALID/);
  const raw = JSON.stringify(answer());
  assert.throws(() => verifyAnalysisContent(raw.replace('"nodeState":', '"nodeState":"TESTING","nodeState":'), context()), /CONTENT_AMBIGUOUS_ENCODING/);
  assert.throws(() => verifyAnalysisContent(raw.replace('49046', '4.9046e4'), context()), /CONTENT_AMBIGUOUS_ENCODING/);
  assert.throws(() => verifyAnalysisContent(raw.replace('49046', '49046.0000000000001'), context()), /CONTENT_AMBIGUOUS_ENCODING/);
  assert.throws(() => verifyAnalysisContent(raw.replace('"VWAP.value"', '"\\u0056WAP.value"'), context()), /CONTENT_AMBIGUOUS_ENCODING/);
});

test('comparisons require known price fields and never accept naked numbers or unit mixing', () => {
  for (const comparison of [
    { left: 49046, operator: 'ABOVE', right: 49981.43 },
    { left: 'price.value', operator: '高於', right: 'VWAP.value' },
    { left: 'price.value', operator: 'ABOVE', right: 'target' },
    { left: 'price.value', operator: 'ABOVE', right: 'price.value' },
  ]) assert.throws(() => verify({ ...answer(), comparisons: [comparison] }), /CONTENT_COMPARISON_AMBIGUOUS/);
  const a = extraFact('levelWatch.scenarioWatch.long.rr.ratio', null);
  a.comparisons = [{ left: 'price.value', operator: 'ABOVE', right: 'levelWatch.scenarioWatch.long.rr.ratio' }];
  assert.throws(() => verify(a), /CONTENT_COMPARISON_AMBIGUOUS/);
});

test('exact TESTING context can be described without directional confirmation; unknown stays unknown', () => {
  const c = structuredClone(context()); c.levelWatch.scenarioWatch.directionState = 'BIDIRECTIONAL_TEST'; c.levelWatch.scenarioWatch.node.state = 'TESTING';
  assert.match(verify(answer(c), c).text, /雙向測試，方向未定/);
  c.levelWatch.scenarioWatch = null;
  assert.match(verify({ ...answer(), directionState: null, nodeState: null }, c).text, /方向狀態未知/);
});

test('bounded context is deeply frozen and response contract uses only known fields', () => {
  const c = context();
  assert.throws(() => { c.VWAP.value = 49981.43; }, TypeError);
  assert.throws(() => { c.levelWatch.scenarioWatch.node.state = 'TESTING'; }, TypeError);
  const contract = analysisContentContract(c);
  assert.equal(contract.fields.find(f => f.field === 'VWAP.value').expected, c.VWAP.value);
  assert.equal(contract.fields.some(f => /options|cvd|order/i.test(f.field)), false);
});

function fixture(t, output, mode = 'completed') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-content-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  let calls = 0;
  const config = { enabled: true, root, runtimeCommit: 'f80a8f9f596fd560883727f2ddbc6d9cf7e7c75b', now: () => now,
    snapshotProvider: async () => ({ snapshot: snapshot() }), storeFactory: () => ({}), configureTransport: () => {}, minIntervalMs: 0,
    operations: { freshPlanRecord: async () => ({}), planCatalog: async () => [{ slug: 'synthetic' }], analysePlan: async (_a, _m, c, _q, { onText, signal }) => {
      calls++; assert.ok(Object.isFrozen(c.VWAP)); onText('unsafe partial: VWAP 49981.43 BUY');
      if (mode === 'failure') throw Error('unsafe provider message');
      if (mode === 'wait') return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }));
      return { text: output, terminal: 'response.completed', model: 'synthetic-actual', requestId: 'resp_synthetic', usage: { total_tokens: 11 } };
    } },
  };
  const assistant = new InlineAssistant(config);
  t.after(() => assistant.close());
  const body = { requestId: randomUUID(), account: 'a'.repeat(64), model: 'synthetic', question: 'synthetic only', creditsDisabledConfirmed: true };
  return { assistant, config, body, calls: () => calls };
}

test('completed invalid answer fails truthfully, keeps metadata, leaks no text through events/disk/recovery/idempotency', async t => {
  const bad = answer(); bad.facts[1].value = 49981.43;
  const s = fixture(t, JSON.stringify(bad)), events = [];
  const r = await s.assistant.run(s.body, 'test-owner', { onEvent: e => events.push(e) });
  assert.equal(r.phase, 'FAILED'); assert.equal(r.error.code, 'CONTENT_FACT_MISMATCH');
  assert.equal(r.text, ''); assert.equal(r.usable, false);
  assert.equal(r.actualModel, 'synthetic-actual'); assert.equal(r.usage.total_tokens, 11);
  assert.equal(r.terminal, 'response.completed');
  assert.ok(events.every(e => e.type === 'receipt' && e.data.text === '' && e.data.usable === false));
  const disk = fs.readFileSync(s.assistant.file(s.body.requestId), 'utf8');
  assert.doesNotMatch(disk, /49981\.43|unsafe partial|unsafe provider/);
  const recovered = new InlineAssistant(s.config).read(s.body.requestId, 'test-owner');
  assert.equal(recovered.phase, 'FAILED'); assert.equal(recovered.text, '');
  assert.equal((await s.assistant.run(s.body, 'test-owner')).text, ''); assert.equal(s.calls(), 1);
});

test('valid output is published only after verification and survives verified recovery', async t => {
  const s = fixture(t, JSON.stringify(answer())), events = [];
  const r = await s.assistant.run(s.body, 'test-owner', { onEvent: e => events.push(e) });
  assert.equal(r.phase, 'COMPLETED'); assert.equal(r.usable, true);
  assert.equal(r.contentVerification.status, 'PASSED'); assert.equal(r.validatedClaims, undefined);
  assert.ok(events.slice(0, -1).every(e => e.data.text === '' && !e.data.usable));
  assert.equal(events.at(-2).data.phase, 'VERIFYING_CONTENT');
  assert.equal(events.at(-1).data.text, r.text);
  assert.equal(new InlineAssistant(s.config).read(s.body.requestId, 'test-owner').text, r.text);
});

test('every completed semantic failure is persisted as FAILED before it can become usable', async t => {
  const price = answer(); price.facts[1].value = 49981.43;
  const comparison = answer(); comparison.comparisons[0].operator = 'BELOW';
  const state = { ...answer(), directionState: 'BIDIRECTIONAL_TEST', nodeState: 'TESTING' };
  for (const [raw, code] of [
    [JSON.stringify(price), 'CONTENT_FACT_MISMATCH'],
    [JSON.stringify(comparison), 'CONTENT_COMPARISON_MISMATCH'],
    [JSON.stringify(state), 'CONTENT_STATE_MISMATCH'],
    ['VWAP=49981.43。49046 高於 49981.43。VWAP=49981.43。active bidirectional TEST。', 'CONTENT_FORMAT_INVALID'],
  ]) {
    const s = fixture(t, raw), events = [];
    const result = await s.assistant.run(s.body, 'test-owner', { onEvent: e => events.push(e) });
    assert.equal(result.phase, 'FAILED'); assert.equal(result.error.code, code);
    assert.ok(events.every(e => e.data.phase !== 'COMPLETED' && e.data.text === ''));
    const saved = JSON.parse(fs.readFileSync(s.assistant.file(s.body.requestId), 'utf8'));
    assert.equal(saved.phase, 'FAILED'); assert.equal(saved.error.code, code);
    assert.equal(saved.actualModel, 'synthetic-actual'); assert.equal(saved.usage.total_tokens, 11);
    assert.equal(saved.text, ''); assert.equal(saved.validatedClaims, undefined);
  }
});

test('legacy or altered COMPLETED receipts never recover accepted unsafe text', async t => {
  const s = fixture(t, JSON.stringify(answer()));
  await s.assistant.run(s.body, 'test-owner');
  const file = s.assistant.file(s.body.requestId), original = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const change of [
    r => { delete r.contentVerification; delete r.validatedClaims; r.text = 'unsafe legacy'; },
    r => { r.text += '\nBUY 49981.43'; },
    r => { r.context.VWAP.value = 49981.43; },
    r => { r.validatedClaims.nodeState = 'TESTING'; },
    r => { r.contentVerification.contextHash = '0'.repeat(64); },
    r => { r.contentVerification.textHash = '0'.repeat(64); },
    r => { r.contentVerification.scope = 'GENERAL_SEMANTIC_CORRECTNESS'; },
  ]) {
    const changed = structuredClone(original); change(changed); fs.writeFileSync(file, JSON.stringify(changed));
    const before = fs.readFileSync(file, 'utf8');
    const r = new InlineAssistant(s.config).read(s.body.requestId, 'test-owner');
    assert.equal(r.phase, 'FAILED'); assert.equal(r.error.code, 'CONTENT_UNVERIFIED_RECEIPT');
    assert.equal(r.text, ''); assert.equal(r.usable, false);
    assert.equal(fs.readFileSync(file, 'utf8'), before, 'old receipt evidence must not be rewritten');
  }
  for (const phase of ['FAILED', 'CANCELLED', 'TIMED_OUT', 'INTERRUPTED', 'ANALYSING']) {
    const changed = { ...original, phase, text: 'unsafe legacy partial' };
    fs.writeFileSync(file, JSON.stringify(changed));
    const recovered = new InlineAssistant(s.config).read(s.body.requestId, 'test-owner');
    assert.equal(recovered.text, ''); assert.equal(recovered.usable, false);
  }
});

test('failure and cancellation discard partial text even if a provider invokes onText with content', async t => {
  for (const mode of ['failure', 'wait']) {
    const s = fixture(t, '', mode), events = [], controller = new AbortController();
    const task = s.assistant.run(s.body, 'test-owner', { signal: controller.signal, onEvent: e => events.push(e) });
    if (mode === 'wait') { await new Promise(resolve => setImmediate(resolve)); controller.abort(); }
    const r = await task;
    assert.equal(r.phase, mode === 'wait' ? 'CANCELLED' : 'FAILED');
    assert.equal(r.text, ''); assert.ok(events.every(e => e.data.text === ''));
    assert.doesNotMatch(fs.readFileSync(s.assistant.file(s.body.requestId), 'utf8'), /unsafe partial|unsafe provider/);
  }
});

test('inference onText is progress-only; completion still returns private raw data for verification', async () => {
  const observed = [], raw = 'unsafe raw model text';
  const stream = new Response([
    { type: 'response.output_text.delta', delta: raw },
    { type: 'response.completed', response: { status: 'completed', model: 'synthetic', id: 'resp_synthetic' } },
  ].map(e => 'data: ' + JSON.stringify(e) + '\n\n').join('')).body;
  const r = await readAnalysisStream(stream, { onText: (...args) => observed.push(args) });
  assert.deepEqual(observed, [[]]); assert.equal(r.text, raw);
});

test('browser receipt/recovery requires the verification marker; legacy text events cannot render', () => {
  const source = fs.readFileSync(new URL('../public/ask-gpt-inline.js', import.meta.url), 'utf8');
  const nodes = new Map(), node = id => { if (!nodes.has(id)) nodes.set(id, { dataset: {} }); return nodes.get(id); };
  const sandbox = { $: node, text: (id, value) => { node(id).textContent = value; }, feedback() {}, phases: {}, reasonText: x => x, requestId: 'test', finished: false };
  const start = source.indexOf(' function receipt(r){'), end = source.indexOf(' async function recover()', start);
  vm.runInNewContext(source.slice(start, end) + '\nthis.receive=receipt;', sandbox);
  for (const r of [
    { phase: 'ANALYSING' }, { phase: 'FAILED' }, { phase: 'COMPLETED' },
    { phase: 'COMPLETED', usable: true, contentVerification: { status: 'PASSED' } },
  ]) {
    sandbox.receive({ ...r, requestId: 'test', text: 'unsafe text' });
    assert.doesNotMatch(node('ai-answer').textContent, /unsafe/); assert.equal(node('ai-answer').dataset.complete, 'false');
  }
  sandbox.receive({ requestId: 'test', phase: 'COMPLETED', usable: true, contentVerification: { schema: CONTENT_SCHEMA, status: 'PASSED' }, text: 'verified text' });
  assert.equal(node('ai-answer').textContent, 'verified text');
  const lineStart = source.indexOf('  function line(s){'), lineEnd = source.indexOf('\n', lineStart);
  vm.runInNewContext(source.slice(lineStart, lineEnd) + '\nline(JSON.stringify({type:"text",requestId:"test",text:"unsafe stream"}));', sandbox);
  assert.equal(node('ai-answer').textContent, 'verified text');
});


test('independent review P2: old or unverified current price and VWAP never pass as fresh', () => {
  const stale = new Date(now - 120001).toISOString();
  const c = decisionContext();
  c.price.availableAt = stale;
  c.VWAP.availableAt = stale;
  const rows = analysisContentContract(c).fields;
  assert.equal(rows.find(r => r.field === 'price.value').expected, null);
  assert.equal(rows.find(r => r.field === 'VWAP.value').expected, null);
  assert.throws(() => verify(answer(c), c), /CONTENT_FACT_MISMATCH/);
  const valid = { ...answer(c), facts: [
    { field: 'price.value', value: null }, { field: 'VWAP.value', value: null },
  ], comparisons: [] };
  const { text } = verify(valid, c);
  assert.match(text, /快照價格：未知／不可用/);
  assert.match(text, /VWAP：未知／不可用/);
  assert.match(text, /來源時間過期或不可驗證/);
  assert.doesNotMatch(text, /快照價格 105 高於 VWAP 100/);

  const absent = structuredClone(decisionContext());
  absent.price.availableAt = null;
  assert.equal(analysisContentContract(absent).fields.find(r => r.field === 'price.value').expected, null);
  assert.throws(() => verify(answer(absent), absent), /CONTENT_FACT_MISMATCH/);
});

test('independent review P2: eligible RVOL survives canonical answer even if model omits its fact', () => {
  const c = decisionContext();
  c.marketPulse.rvol = { state: 'READY', ratio: 1.75, sourceQualityStatus: 'PASS', sourceAvailableAt: stamp };
  const base = answer(c);
  const text = verify(base, c).text;
  assert.match(text, /完成 K 相對量能（RVOL）：1\.75×/);
  const supplied = { ...base, facts: [...base.facts, { field: 'marketPulse.rvol.ratio', value: 1.75 }] };
  assert.equal(verify(supplied, c).text, text);

  const unavailable = structuredClone(c);
  unavailable.marketPulse.rvol.state = 'UNAVAILABLE';
  const result = verify(answer(unavailable), unavailable).text;
  assert.match(result, /完成 K 相對量能：未知／不可用/);
  assert.doesNotMatch(result, /RVOL）：1\.75×/);
});


test('second independent review P2: V1 verified receipts recover without reviving stale source claims', () => {
  const c = decisionContext(), claims = answer(c);
  const legacy = verifyAnalysisContent(JSON.stringify(claims), c, { renderVersion: 'v1' });
  const updated = verify(claims, c);
  assert.equal(legacy.verification.scope, 'CLOSED_FIELD_CLAIMS_AND_CANONICAL_DECISION_V1');
  assert.equal(updated.verification.scope, 'CLOSED_FIELD_CLAIMS_AND_CANONICAL_DECISION_V3');
  assert.notEqual(legacy.text, updated.text, 'new renderer adds RVOL availability');
  const receipt = {
    context: c, contextHash: legacy.verification.contextHash, text: legacy.text,
    validatedClaims: claims, contentVerification: legacy.verification,
  };
  assert.equal(verifiedReceiptText(receipt), legacy.text);
  assert.throws(() => verifiedReceiptText({ ...receipt, text: legacy.text + ' manipulated' }), /CONTENT_UNVERIFIED_RECEIPT/);
  assert.throws(() => verifiedReceiptText({ ...receipt, contentVerification: { ...legacy.verification, scope: 'CLOSED_FIELD_CLAIMS_ONLY' } }), /CONTENT_UNVERIFIED_RECEIPT/);
  const stale = structuredClone(c);
  stale.price.availableAt = new Date(now - 120001).toISOString();
  assert.throws(() => verifiedReceiptText({ ...receipt, context: stale }), /CONTENT_FACT_MISMATCH/);
});


test('final review P2: a genuine CRU34 READY flow is eligible only when live, identity-bound and fresh', () => {
  const qualifiedWindow = {
    status: 'READY', pressure: { status: 'READY', pressureRatio: 0.47 },
    response: { status: 'READY', displacementPoints: 8 },
    pathEfficiency: { status: 'READY', value: 0.5 },
  };
  const observedFlow = buildDashboardObservedFlow({
    truthState: 'LIVE',
    operational: { checkpointIdentity: 'a'.repeat(64), validUntil: new Date(now + 30000).toISOString() },
    snapshot: { sourceMode: 'LIVE', actualContract: 'TXFJ6', tradeDate: '2026-10-09', session: 'DAY',
      availableAt: stamp, primary60s: qualifiedWindow, context300s: qualifiedWindow,
      quality: { status: 'READY', reasons: [] } },
  });
  const chart = { actualContract: 'TXFJ6', tradeDate: '2026-10-09', session: 'DAY', availableAt: stamp,
    timeframe: '5m', lastPrice: 100, qualityStatus: 'PASS',
    bars: [{ time: '2026-10-09T01:50:00Z', availableAt: '2026-10-09T01:54:59Z',
      open: 100, high: 105, low: 95, close: 100, qualityStatus: 'PASS' }],
    levels: { vwap: { availability: 'AVAILABLE', value: 100, availableAt: stamp,
      source: 'SYNTHETIC_ONLY', qualityStatus: 'PASS' } } };
  const levelWatch = buildDecisionLevelWatch({ chart, observedFlow, snapshotTime: stamp });
  const c = buildInlineContext(createDecisionSnapshot({ chart, observedFlow, levelWatch, snapshotTime: stamp,
    dataHealth: { items: [] } }), { now }).context;
  assert.equal(c.levelWatch.observedFlow.quality, 'READY');
  assert.equal(c.observedFlow.quality.status, 'READY');
  const fields = analysisContentContract(c).fields;
  assert.equal(fields.find(x => x.field === 'levelWatch.observedFlow.pressure60').expected, 0.47);
  assert.equal(fields.find(x => x.field === 'levelWatch.observedFlow.response60').expected, 8);
  const claims = { schema: CONTENT_SCHEMA,
    directionState: c.levelWatch.scenarioWatch?.directionState ?? null,
    nodeState: c.levelWatch.scenarioWatch?.node?.state ?? null,
    facts: fields.slice(0, 2).map(x => ({ field: x.field, value: x.expected })), comparisons: [] };
  const text = verify(claims, c).text;
  assert.match(text, /當下成交壓力比：0\.47/);
  assert.match(text, /當下價格位移：8/);
  assert.doesNotMatch(text, /實際成交／價格反應不可用/);
  for (const patch of [{sourceState:'STALE'}, {quality:'QUALITY_INSUFFICIENT'},
    {availableAt:new Date(now - 120001).toISOString()}]) {
    const x=structuredClone(c);
    Object.assign(x.levelWatch.observedFlow, patch);
    const xs=analysisContentContract(x).fields;
    assert.equal(xs.find(f=>f.field==='levelWatch.observedFlow.pressure60').expected,null);
  }
  const downgraded=structuredClone(c);
  downgraded.observedFlow.quality.status='QUALITY_INSUFFICIENT';
  assert.equal(analysisContentContract(downgraded).fields.find(x=>x.field==='levelWatch.observedFlow.response60').expected,null);
});


test('final review P2: preserve V2 READY-flow receipts under V2 field eligibility', () => {
  const c = decisionContext();
  c.levelWatch.observedFlow.sourceState = 'LIVE';
  c.levelWatch.observedFlow.quality = 'READY';
  c.levelWatch.observedFlow.pressure60 = 0.47;
  c.levelWatch.observedFlow.response60 = 8;
  c.levelWatch.observedFlow.availableAt = stamp;
  c.observedFlow.quality.status = 'READY';
  const claims = answer(c);
  const v2 = verifyAnalysisContent(JSON.stringify(claims), c, {renderVersion:'v2'});
  const v3 = verifyAnalysisContent(JSON.stringify(claims), c);
  assert.equal(v2.verification.scope,'CLOSED_FIELD_CLAIMS_AND_CANONICAL_DECISION_V2');
  assert.equal(v3.verification.scope,'CLOSED_FIELD_CLAIMS_AND_CANONICAL_DECISION_V3');
  assert.doesNotMatch(v2.text,/當下成交壓力比：0\.47/);
  assert.match(v3.text,/當下成交壓力比：0\.47/);
  assert.equal(verifiedReceiptText({context:c,contextHash:v2.verification.contextHash,
    text:v2.text,validatedClaims:claims,contentVerification:v2.verification}),v2.text);
  assert.equal(verifiedReceiptText({context:c,contextHash:v3.verification.contextHash,
    text:v3.text,validatedClaims:claims,contentVerification:v3.verification}),v3.text);
  const illegal = {...claims,facts:[...claims.facts,{field:'levelWatch.observedFlow.pressure60',value:0.47}]};
  assert.throws(()=>verifyAnalysisContent(JSON.stringify(illegal),c,{renderVersion:'v2'}),/CONTENT_FACT_MISMATCH/);
  assert.match(verify(illegal,c).text,/當下成交壓力比：0\.47/);
});

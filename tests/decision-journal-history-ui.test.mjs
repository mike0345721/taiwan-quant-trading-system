import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Read-only saved-record rendering; no browser, socket, account, or live data.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const start = app.indexOf('function renderJournalHistory(');
const end = app.indexOf('\nasync function loadDecisionJournal(', start);
assert.ok(start >= 0 && end > start);
const renderer = app.slice(start, end);

class Node {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.value = ''; }
  set textContent(value) { this.value = String(value); this.children = []; }
  get textContent() { return this.value + this.children.map(child => child.textContent).join(' '); }
  set innerHTML(_) { throw Error('unsafe HTML rendering'); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.value = ''; this.children = children; }
}
const descendants = node => [node, ...node.children.flatMap(descendants)];

function render(entries) {
  const before = JSON.stringify(entries);
  const target = new Node('div');
  const writes = [];
  const context = vm.createContext({
    document: { createElement: tagName => new Node(tagName) },
    $: id => id === 'dw-journal-history' ? target : null,
    timeLabel: value => value || '—',
    api: (...args) => { writes.push(args); throw Error('render must not call API'); },
    fetch: (...args) => { writes.push(args); throw Error('render must not call fetch'); },
    get state() { throw Error('saved records must not read the current workspace'); },
  });
  vm.runInContext(renderer, context);
  context.renderJournalHistory(entries);
  assert.equal(JSON.stringify(entries), before, 'render must preserve immutable records');
  assert.deepEqual(writes, []);
  return target;
}

const entry = () => ({
  recordedAt: '2026-10-27T01:01:00Z', intent: 'NO_TRADE', reason: 'saved observation',
  snapshotHash: 'a'.repeat(64),
  snapshot: {
    snapshotTime: '2026-10-27T01:00:00Z', snapshotHash: 'a'.repeat(64),
    contract: 'SYNTHETIC-OLD', session: 'DAY', tradeDate: '2026-10-27',
    price: { availability: 'AVAILABLE', value: 12345, sourceId: 'fixture', availableAt: '2026-10-27T00:59:59Z' },
    OR: { availability: 'AVAILABLE', value: { high: 12350, low: 12340 } },
    VWAP: { availability: 'AVAILABLE', value: 12342 },
    dataHealth: { overall: 'QUALITY_INSUFFICIENT', items: [{ sourceId: 'txTick', freshnessState: 'STALE', reason: 'SYNTHETIC_SOURCE_EXPIRED' }] },
    marketState: { availability: 'UNAVAILABLE', direction: 'UNAVAILABLE', reason: 'NO_LEGAL_FORWARD_MARKET_STATE_SNAPSHOT' },
  },
});

test('saved journal entries expose their own immutable snapshot in a read-only expandable view', () => {
  const first = entry(), second = entry();
  second.snapshotHash = 'b'.repeat(64); second.snapshot.snapshotHash = second.snapshotHash;
  second.snapshot.contract = 'SYNTHETIC-OTHER'; second.snapshot.price.value = 20000;
  const target = render([first, second]);
  const details = descendants(target).filter(node => node.tagName === 'details' && node.className === 'dw-journal-snapshot');
  assert.equal(details.length, 2, 'each saved record needs its own expandable snapshot');
  assert.ok(details.every(node => node.children.some(child => child.tagName === 'summary')));
  const text = details[0].textContent;
  for (const value of [first.snapshotHash, first.snapshot.snapshotTime, 'SYNTHETIC-OLD', 'DAY', '2026-10-27', '12345', '12350', '12340', '12342', 'QUALITY_INSUFFICIENT', 'SYNTHETIC_SOURCE_EXPIRED']) assert.ok(text.includes(value), value);
  assert.doesNotMatch(text, /SYNTHETIC-OTHER|20000/);
  assert.match(text, /歷史快照/); assert.match(text, /非即時/); assert.match(text, /不代表結果回顧/);
  assert.ok(!descendants(target).some(node => ['form', 'input', 'button', 'textarea'].includes(node.tagName)));
});

test('saved snapshot view keeps missing values unknown, preserves real zero and renders only allowed text', () => {
  const row = entry();
  row.snapshot.price.value = 0; row.snapshot.OR.value = null; row.snapshot.VWAP.value = null;
  row.snapshot.contract = '<img src=x onerror=alert(1)>';
  row.snapshot.privateRoot = 'SYNTHETIC_PRIVATE_DO_NOT_RENDER';
  row.snapshot.sessionToken = 'REDACTED';
  const target = render([row]), text = target.textContent;
  assert.match(text, /價格：0/);
  assert.match(text, /OR 高：不可用/); assert.match(text, /OR 低：不可用/); assert.match(text, /VWAP：不可用/);
  assert.ok(text.includes(row.snapshot.contract));
  assert.doesNotMatch(text, /SYNTHETIC_PRIVATE_DO_NOT_RENDER|REDACTED/);
  assert.ok(!descendants(target).some(node => node.tagName === 'img'));
});

test('historical record without a saved snapshot has an explicit unavailable state', () => {
  const row = entry(); delete row.snapshot;
  const target = render([row]);
  assert.match(target.textContent, /原始快照不可用/);
  assert.ok(target.textContent.includes(row.snapshotHash));
  assert.doesNotMatch(target.textContent, /SYNTHETIC-OLD|12345/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Pure DOM/controller fixtures: no browser, socket, user account or live data.
const app = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
const renderer = app.slice(app.indexOf('function renderJournalHistory('), app.indexOf('\nasync function loadDecisionJournal('));
const loader = app.slice(app.indexOf('async function loadDecisionJournal('), app.indexOf('\nasync function copyToClipboard(', app.indexOf('async function loadDecisionJournal(')));
class Node {
  constructor(tagName) { this.tagName = tagName; this.children = []; this.value = ''; this.events = {}; this.attributes = {}; }
  set textContent(value) { this.text = String(value); this.children = []; }
  get textContent() { return (this.text || '') + this.children.map(child => child.textContent).join(' '); }
  set innerHTML(_) { throw Error('unsafe HTML'); }
  append(...nodes) { this.children.push(...nodes); }
  replaceChildren(...nodes) { this.text = ''; this.children = nodes; }
  addEventListener(type, handler) { this.events[type] = handler; }
  setAttribute(name, value) { this.attributes[name] = value; }
  removeAttribute(name) { delete this.attributes[name]; }
}
const all = node => [node, ...node.children.flatMap(all)];
const decision = () => ({ recordHash: 'a'.repeat(64), snapshotHash: 'b'.repeat(64), recordedAt: '2026-10-27T00:00:00Z',
  intent: 'NO_TRADE', confidence: 'LOW', executionStatus: 'NOT_EXECUTED', reason: 'manual observation',
  snapshot: { snapshotTime: '2026-10-27T00:00:00Z', contract: 'SYNTHETIC', session: 'DAY', tradeDate: '2026-10-27' } });
function harness({ entries = [decision()], outcomes = [], request } = {}) {
  const target = new Node('div'), calls = [], before = JSON.stringify({ entries, outcomes });
  const context = vm.createContext({ document: { createElement: tag => new Node(tag) }, $: () => target,
    timeLabel: value => value || '未知', api: async (route, options) => {
      calls.push({ route, options });
      if (request) return request(route, options);
      return { data: { ...JSON.parse(options.body), snapshotHash: entries[0].snapshotHash,
        recordedAt: '2026-10-27T01:00:00Z', recordHash: 'c'.repeat(64), sequence: outcomes.length + 1 } };
    }, get state() { throw Error('history must not read current market state'); } });
  vm.runInContext(renderer + '\n' + loader, context); context.renderJournalHistory(entries, outcomes);
  const form = all(target).find(node => node.tagName === 'form');
  return { target, form, calls, unchanged: () => assert.equal(JSON.stringify({ entries, outcomes }), before),
    renderAgain: () => context.renderJournalHistory(entries, outcomes),
    load: () => context.loadDecisionJournal(),
    field: name => all(form).find(node => node.name === name),
    submit: () => form.events.submit({ preventDefault() {} }) };
}

test('manual outcome view separates saved confidence and linked append-only history without automatic requests', () => {
  const row = decision();
  const h = harness({ entries: [row], outcomes: [
    { decisionRecordHash: row.recordHash, snapshotHash: row.snapshotHash, recordedAt: '2026-10-27T00:10:00Z',
      executionStatus: 'EXECUTED', thesisStatus: 'FOLLOWED', outcomeNote: 'first manual result' },
    { decisionRecordHash: 'd'.repeat(64), outcomeNote: 'FOREIGN_RESULT_DO_NOT_SHOW' },
  ] });
  assert.ok(h.form, 'a saved decision needs an explicit append-only manual outcome form');
  assert.match(h.target.textContent, /信心.*低/);
  assert.match(h.target.textContent, /原始.*未執行/);
  assert.match(h.target.textContent, /first manual result/);
  assert.doesNotMatch(h.target.textContent, /FOREIGN_RESULT_DO_NOT_SHOW/);
  assert.match(h.target.textContent, /人工.*不.*績效|自行.*不.*績效/);
  assert.deepEqual(h.calls, []); h.unchanged();
});

test('manual outcome is sent only on explicit submit and cannot overwrite the original snapshot', async () => {
  const h = harness(); assert.ok(h.form);
  h.field('executionStatus').value = 'EXECUTED';
  h.field('thesisStatus').value = 'VIOLATED';
  h.field('outcomeNote').value = '<img src=x onerror=alert(1)> manual report';
  await h.submit();
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].route, '/api/v1/decision-journal/outcomes');
  assert.equal(h.calls[0].options.method, 'POST');
  const body = JSON.parse(h.calls[0].options.body);
  assert.deepEqual(body, { decisionRecordHash: 'a'.repeat(64), executionStatus: 'EXECUTED',
    thesisStatus: 'VIOLATED', outcomeNote: '<img src=x onerror=alert(1)> manual report' });
  assert.ok(h.target.textContent.includes(body.outcomeNote));
  assert.ok(!all(h.target).some(node => node.tagName === 'img'));
  assert.match(h.target.textContent, /已追加/); h.unchanged();
});

test('failed or concurrent manual submission preserves input and never automatically retries', async () => {
  let reject;
  const pending = new Promise((_, fail) => { reject = fail; });
  const h = harness({ request: () => pending }); assert.ok(h.form);
  h.field('outcomeNote').value = 'keep this note';
  const first = h.submit(); await h.submit();
  assert.equal(h.calls.length, 1);
  reject(Error('SYNTHETIC_REFUSED')); await first;
  assert.equal(h.calls.length, 1);
  assert.equal(h.field('outcomeNote').value, 'keep this note');
  assert.match(h.target.textContent, /SYNTHETIC_REFUSED/);
  assert.equal(all(h.form).find(node => node.tagName === 'button').disabled, false);
});

test('legacy entries keep unknown personal fields and never invent an outcome or confidence', () => {
  const row = decision(); delete row.confidence; delete row.executionStatus;
  const h = harness({ entries: [row] }); assert.ok(h.form);
  assert.match(h.target.textContent, /信心.*未填/);
  assert.match(h.target.textContent, /原始.*未知/);
  assert.match(h.target.textContent, /未列出人工結果/);
  assert.deepEqual(h.calls, []); h.unchanged();
});

test('bounded history and recovery never claim that an omitted older outcome does not exist', async () => {
  const row = decision(), other = 'd'.repeat(64);
  const latest200 = Array.from({ length: 200 }, (_, i) => ({ decisionRecordHash: other, snapshotHash: 'e'.repeat(64),
    sequence: i + 2, outcomeNote: 'newer result for another decision' }));
  const h = harness({ entries: [row], outcomes: latest200,
    request: async () => ({ data: [row], outcomes: latest200 }) });
  assert.match(h.target.textContent, /近期20筆.*最新200筆/);
  assert.match(h.target.textContent, /不代表從未記錄/);
  assert.doesNotMatch(h.target.textContent, /尚無人工結果/);
  await all(h.form).find(node => node.name === 'recoverOutcome').events.click();
  assert.match(h.target.textContent, /本次查回未列出結果，不表示從未記錄/);
  assert.match(h.target.textContent, /可能不完整/);
  assert.equal(h.calls.length, 1); assert.ok(!h.calls[0].options?.method);
});

test('an empty manual result remains unknown and cannot produce a write', async () => {
  const h = harness(); assert.ok(h.form);
  await h.submit(); assert.deepEqual(h.calls, []);
  assert.match(h.target.textContent, /不會把未知補成結果/);
});

test('an unrelated outcome response cannot be displayed as this decision result', async () => {
  const h = harness({ request: async () => ({ data: { decisionRecordHash: 'd'.repeat(64), snapshotHash: 'b'.repeat(64), outcomeNote: 'FOREIGN_RESULT' } }) });
  h.field('outcomeNote').value = 'retain original input'; await h.submit();
  assert.match(h.target.textContent, /OUTCOME_RESPONSE_IDENTITY_MISMATCH/);
  assert.doesNotMatch(h.target.textContent, /FOREIGN_RESULT/);
  assert.equal(h.field('outcomeNote').value, 'retain original input');
});

test('an uncertain append can be explicitly read back without retrying the write or losing the draft', async () => {
  const row = decision(), saved = { decisionRecordHash: row.recordHash, snapshotHash: row.snapshotHash,
    executionStatus: 'EXECUTED', thesisStatus: 'UNKNOWN', outcomeNote: 'already stored before transport failure', recordedAt: '2026-10-27T01:00:00Z' };
  const h = harness({ request: async (route, options) => {
    if (options?.method === 'POST') throw Error('SYNTHETIC_UNCERTAIN_TRANSPORT');
    return { data: [row], outcomes: [saved] };
  } });
  h.field('outcomeNote').value = 'preserve this draft'; await h.submit();
  assert.match(h.target.textContent, /尚未確認追加結果/);
  const recover = all(h.form).find(node => node.name === 'recoverOutcome'); assert.ok(recover);
  await recover.events.click();
  assert.equal(h.calls.filter(call => call.options?.method === 'POST').length, 1);
  assert.equal(h.calls[1].route, '/api/v1/decision-journal?limit=20');
  assert.ok(h.target.textContent.includes(saved.outcomeNote));
  assert.equal(h.field('outcomeNote').value, 'preserve this draft');
  h.unchanged();
});

test('a late background GET cannot erase an explicitly recovered outcome', async () => {
  let completeOld, reads = 0;
  const old = new Promise(resolve => { completeOld = resolve; });
  const row = decision(), saved = { decisionRecordHash: row.recordHash, snapshotHash: row.snapshotHash,
    executionStatus: 'EXECUTED', thesisStatus: 'UNKNOWN', outcomeNote: 'RECOVERED_CONFIRMED_RESULT', recordedAt: '2026-10-27T01:00:00Z' };
  const h = harness({ request: async () => ++reads === 1 ? old : { data: [row], outcomes: [saved] } });
  const background = h.load();
  await all(h.form).find(node => node.name === 'recoverOutcome').events.click();
  assert.ok(h.target.textContent.includes(saved.outcomeNote));
  completeOld({ data: [row], outcomes: [] }); await background;
  assert.ok(h.target.textContent.includes(saved.outcomeNote));
  assert.equal(h.calls.length, 2); assert.ok(h.calls.every(call => !call.options?.method));
});

test('background history refresh preserves an edited manual outcome until it is explicitly cleared', () => {
  const h = harness(); assert.ok(h.form);
  h.field('outcomeNote').value = 'unfinished observation'; h.field('outcomeNote').events.input();
  h.field('executionStatus').value = 'EXECUTED'; h.field('executionStatus').events.change();
  h.renderAgain();
  assert.equal(all(h.target).find(node => node.tagName === 'form'), h.form);
  assert.equal(h.field('outcomeNote').value, 'unfinished observation');
  assert.equal(h.field('executionStatus').value, 'EXECUTED');
  const clear = all(h.form).find(node => node.type === 'button'); assert.ok(clear);
  clear.events.click();
  assert.equal(h.field('outcomeNote').value, ''); assert.equal(h.field('executionStatus').value, 'UNKNOWN');
  h.renderAgain(); assert.notEqual(all(h.target).find(node => node.tagName === 'form'), h.form);
  assert.deepEqual(h.calls, []);
});

test('background refresh cannot replace an in-flight form or create a duplicate submission', async () => {
  let complete;
  const pending = new Promise(resolve => { complete = resolve; });
  const h = harness({ request: () => pending }); assert.ok(h.form);
  h.field('outcomeNote').value = 'one explicit append';
  const first = h.submit(); h.renderAgain();
  for (const name of ['executionStatus', 'thesisStatus', 'outcomeNote']) assert.equal(h.field(name).disabled, true);
  assert.equal(all(h.target).find(node => node.tagName === 'form'), h.form);
  await h.submit(); assert.equal(h.calls.length, 1);
  complete({ data: { ...JSON.parse(h.calls[0].options.body), snapshotHash: 'b'.repeat(64), recordedAt: '2026-10-27T01:00:00Z' } });
  await first; assert.equal(h.calls.length, 1); assert.match(h.target.textContent, /已追加/);
  for (const name of ['executionStatus', 'thesisStatus', 'outcomeNote']) assert.equal(h.field(name).disabled, false);
});

test('original journal submit carries only the chosen subjective fields with the locked snapshot', async () => {
  const start = app.indexOf("$('dw-journal-form').addEventListener('submit'");
  const end = app.indexOf("document.querySelectorAll('#v2-delta-controls", start);
  assert.ok(start > 0 && end > start);
  let handler; const calls = [], nodes = new Map();
  for (const [id, value] of Object.entries({ 'dw-journal-setup': 'setup', 'dw-journal-reason': 'reason',
    'dw-journal-invalidation': 'invalidation', 'dw-journal-confidence': 'HIGH', 'dw-journal-execution': 'UNKNOWN' })) nodes.set(id, { value });
  nodes.set('dw-journal-form', { addEventListener: (_, fn) => { handler = fn; } });
  nodes.set('dw-journal-submit', { disabled: false });
  const locked = { snapshotHash: 'b'.repeat(64), price: { value: 0 } };
  vm.runInNewContext(app.slice(start, end), { $: id => nodes.get(id),
    state: { journalIntent: 'NO_TRADE', lockedDecisionSnapshot: locked }, dwText() {}, loadDecisionJournal: async () => {},
    api: async (route, options) => { calls.push({ route, body: JSON.parse(options.body) }); return { data: { sequence: 1, recordHash: 'a'.repeat(64) } }; } });
  await handler({ preventDefault() {} });
  assert.equal(calls[0].body.confidence, 'HIGH');
  assert.equal(calls[0].body.executionStatus, 'UNKNOWN');
  assert.deepEqual(calls[0].body.snapshot, locked);
  const html = fs.readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of ['dw-journal-confidence', 'dw-journal-execution']) assert.ok(html.includes(`id="${id}"`));
});

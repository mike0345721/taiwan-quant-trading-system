import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped UI with synthetic transport and DOM only. No sockets,
// browser, credentials, ACL/vault, provider, or running application are used.
const source = fs.readFileSync(new URL('../public/ask-gpt-inline.js', import.meta.url), 'utf8');
const status = () => ({ enabled: true, accounts: [], accountMetadataLoaded: false,
  credentialsLoaded: false, storeState: 'PRESENT_UNVERIFIED', reason: 'ACCOUNT_METADATA_NOT_LOADED',
  runtimeCommit: 'a'.repeat(40), usageRoute: 'CHATGPT_SUBSCRIPTION' });
const account = { key: 'saved-account', label: 'Synthetic saved account', expiresAt: 1,
  planPermission: true, accessReady: false, renewable: true };
const loaded = () => ({ enabled: true, accounts: [account], accountMetadataLoaded: true, reason: null });
const flush = () => new Promise(resolve => setImmediate(resolve));
const submittedId = '11111111-1111-4111-8111-111111111111';
const completed = requestId => ({ requestId, phase: 'COMPLETED', finished: true, usable: true,
  text: 'Verified synthetic answer', updatedAt: '2026-10-29T00:00:00Z',
  contentVerification: { schema: 'ask-gpt-verified-claims-v1', status: 'PASSED' } });
const unfinished = requestId => ({ requestId, phase: 'ANALYSING', finished: false,
  updatedAt: '2026-10-29T00:00:00Z' });
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function streamReceipt(receipt) {
  let sent = false;
  return { ok: true, body: { getReader: () => ({ async read() {
    if (sent) return { done: true };
    sent = true; return { done: false, value: Buffer.from(JSON.stringify({ type: 'receipt', data: receipt }) + '\n') };
  } }) } };
}

function harness({ guest = false, authenticated = true, statusData = status(), statusReplies = [], accountReplies = [], recoveryId = null, recoveryReplies = [], askReplies = [] } = {}) {
  const calls = [], timers = [], opened = [], nodes = new Map();
  class Option { constructor(label, key) { this.textContent = label; this.value = key; } }
  function node(id) {
    if (!nodes.has(id)) nodes.set(id, {
      textContent: '', value: '', disabled: false, checked: false, dataset: {}, open: false,
      children: [], listeners: new Map(), classList: { add() {}, remove() {} },
      setAttribute() {}, removeAttribute() {},
      replaceChildren(...rows) { this.children = rows; this.value = ''; },
      add(row) { this.children.push(row); },
      get selectedOptions() { return this.children.filter(row => row.value === this.value); },
      addEventListener(type, fn) { this.listeners.set(type, fn); },
    });
    return nodes.get(id);
  }
  const response = (data, ok = true) => ({ ok, json: async () => structuredClone(data) });
  const context = vm.createContext({
    document: { documentElement: { dataset: { guestReadOnly: String(guest) } }, getElementById: node, querySelectorAll: () => [] },
    window: { addEventListener() {}, open: (...args) => opened.push(args) },
    location: { port: '18722' }, Option, URL, Date, TextDecoder, AbortController,
    AbortSignal: { timeout: () => ({}) },
    setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    crypto: { randomUUID: () => submittedId },
    sessionStorage: { getItem: () => recoveryId, setItem(key, value) { recoveryId = value; } },
    fetch: async (url, options = {}) => {
      const method = options.method || 'GET'; calls.push({ url, method, options });
      if (url === '/api/session') return response({ authenticated, csrfToken: authenticated ? 'synthetic-csrf' : null });
      if (url === '/api/v1/ask-gpt/status' && method === 'GET') return response({ ok: true, data: statusReplies.length ? await statusReplies.shift() : statusData });
      if (url === '/api/v1/ask-gpt/accounts' && method === 'POST') {
        const result = await accountReplies.shift();
        if (!result) throw Error('unexpected account read');
        return result.error ? response({ ok: false, error: result.error, detail: 'SYNTHETIC_PRIVATE_DETAIL' }, false) : response({ ok: true, data: result });
      }
      if (url.startsWith('/api/v1/ask-gpt/requests/') && method === 'GET') return response({ ok: true, data: recoveryReplies.length ? await recoveryReplies.shift() : {
        requestId: url.split('/').at(-1), phase: 'FAILED', finished: true, updatedAt: '2026-10-27T00:00:00Z', error: { code: 'REQUEST_CANCELLED' },
      } });
      if (url === '/api/v1/ask-gpt/ask' && method === 'POST') {
        const reply = await askReplies.shift();
        if (!reply) throw Error('unexpected analysis request');
        return reply;
      }
      throw Error('unexpected request');
    },
  });
  vm.runInContext(source, context);
  return { calls, timers, opened, node, setAuthenticated(value) { authenticated = value; },
    click: async id => { const action = node(id).listeners.get('click'); assert.ok(action, id); await action(); await flush(); },
    change: async id => { const action = node(id).listeners.get('change'); assert.ok(action, id); await action(); await flush(); },
    retry: async () => { const next = timers.shift(); assert.ok(next); await next.fn(); await flush(); },
    text: () => [...nodes.values()].map(n => n.textContent).join('\n'),
  };
}

test('automatic status and request recovery use GET only and do not claim saved authorization is connected', async () => {
  const h = harness({ recoveryId: 'synthetic-request' }); await flush();
  assert.ok(h.calls.some(c => c.url.endsWith('/status')));
  assert.ok(h.calls.some(c => c.url.endsWith('/requests/synthetic-request')));
  assert.ok(h.calls.every(c => c.method === 'GET'));
  assert.equal(h.node('ai-account').value, ''); assert.equal(h.node('ai-models').disabled, true);
  assert.match(h.node('ai-connection').textContent, /尚未讀取/);
  assert.doesNotMatch(h.node('ai-connection').textContent, /已連線|有效授權|已找到保存的訂閱授權/);
  assert.deepEqual(h.opened, []);
});

for (const lateResult of ['unfinished', 'error']) {
  test(`an older ${lateResult} recovery cannot replace a newer completed read of the same request`, async () => {
    const old = deferred(), id = 'synthetic-request';
    const h = harness({ recoveryId: id, recoveryReplies: [old.promise, completed(id)] }); await flush();
    await h.click('ai-recover');
    assert.equal(h.node('ai-status').dataset.phase, 'COMPLETED');
    if (lateResult === 'error') old.reject(Error('REQUEST_NOT_FOUND'));
    else old.resolve(unfinished(id));
    await flush();
    assert.equal(h.node('ai-status').dataset.phase, 'COMPLETED');
    assert.equal(h.node('ai-answer').dataset.complete, 'true');
    assert.equal(h.node('ai-answer').textContent, 'Verified synthetic answer');
    assert.ok(h.calls.every(c => c.method === 'GET'));
  });

  test(`an older request's ${lateResult} recovery cannot overwrite a newly submitted analysis`, async () => {
    const old = deferred(), id = 'synthetic-old-request';
    const h = harness({ recoveryId: id, recoveryReplies: [old.promise], accountReplies: [loaded()],
      askReplies: [streamReceipt(completed(submittedId))] }); await flush();
    await h.click('ai-refresh');
    h.node('ai-model').value = 'synthetic-model'; h.node('ai-question').value = 'Synthetic question';
    h.node('ai-credits').checked = true; await h.change('ai-credits');
    assert.equal(h.node('ai-submit').disabled, false);
    await h.click('ai-submit');
    assert.equal(h.node('ai-status').dataset.phase, 'COMPLETED');
    assert.match(h.node('ai-receipt').textContent, new RegExp(submittedId));
    if (lateResult === 'error') old.reject(Error('REQUEST_NOT_FOUND'));
    else old.resolve(unfinished(id));
    await flush();
    assert.equal(h.node('ai-status').dataset.phase, 'COMPLETED');
    assert.equal(h.node('ai-answer').dataset.complete, 'true');
    assert.equal(h.node('ai-answer').textContent, 'Verified synthetic answer');
    assert.match(h.node('ai-receipt').textContent, new RegExp(submittedId));
    assert.equal(h.calls.filter(c => c.url.endsWith('/ask')).length, 1);
    assert.ok(h.calls.every(c => c.method === 'GET' || c.url.endsWith('/accounts') || c.url.endsWith('/ask')));
  });
}

test('only the explicit saved-account button reads accounts once without setup, model or OAuth calls', async () => {
  const h = harness({ accountReplies: [loaded()] }); await flush();
  await h.click('ai-refresh');
  const posts = h.calls.filter(c => c.method === 'POST');
  assert.equal(posts.length, 1); assert.equal(posts[0].url, '/api/v1/ask-gpt/accounts');
  assert.deepEqual(JSON.parse(posts[0].options.body), {});
  assert.equal(posts[0].options.headers['X-CSRF-Token'], 'synthetic-csrf');
  assert.equal(h.node('ai-account').value, account.key);
  assert.equal(h.node('ai-models').disabled, false); assert.equal(h.node('ai-submit').disabled, true);
  assert.match(h.node('ai-connection').textContent, /尚未驗證/);
  assert.doesNotMatch(h.node('ai-connection').textContent, /已連線|有效授權/);
  assert.deepEqual(h.opened, []);
});

test('automatic missing, busy, unsafe and unreadable store states remain unavailable without repair or account reads', async () => {
  for (const [storeState, reason, visible] of [
    ['MISSING', 'CREDENTIAL_STORE_MISSING', '不會建立儲存區'],
    ['BUSY', 'CREDENTIAL_STORE_BUSY', '不會自動修復'],
    ['UNSAFE', 'CREDENTIAL_ACL_UNSAFE', '不會修改權限'],
    ['UNREADABLE', 'CREDENTIAL_STORE_UNREADABLE', '不會重建'],
  ]) {
    const h = harness({ statusData: { ...status(), storeState, reason } }); await flush();
    assert.ok(h.node('ai-connection').textContent.includes(visible), reason);
    assert.ok(h.calls.every(c => c.method === 'GET'));
    assert.equal(h.node('ai-account').value, ''); assert.equal(h.node('ai-models').disabled, true);
    assert.deepEqual(h.opened, []);
  }
});

for (const reason of ['CREDENTIAL_STORE_MISSING', 'CREDENTIAL_STORE_BUSY', 'CREDENTIAL_ACL_UNSAFE', 'CREDENTIAL_STORE_UNREADABLE'])
test(`explicit ${reason} failure clears stale choices, preserves question, and retries only on another click`, async () => {
  const h = harness({ accountReplies: [loaded(), { error: reason }, loaded()] }); await flush();
  await h.click('ai-refresh'); h.node('ai-question').value = 'my unsent question';
  h.node('ai-model').value = 'previous-model'; h.node('ai-credits').checked = true;
  await h.click('ai-refresh');
  assert.equal(h.node('ai-account').value, ''); assert.equal(h.node('ai-model').value, '');
  assert.equal(h.node('ai-models').disabled, true); assert.equal(h.node('ai-submit').disabled, true);
  assert.equal(h.node('ai-question').value, 'my unsent question');
  assert.doesNotMatch(h.text(), /SYNTHETIC_PRIVATE_DETAIL|已連線/);
  const before = h.calls.length; await flush(); assert.equal(h.calls.length, before, 'no automatic repair or retry');
  await h.click('ai-refresh'); assert.equal(h.node('ai-account').value, account.key);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 3);
  assert.ok(h.calls.filter(c => c.method === 'POST').every(c => c.url.endsWith('/accounts')));
  assert.deepEqual(h.opened, []);
});

test('expired panel session clears earlier account choices without reading accounts or losing the draft', async () => {
  const h = harness({ accountReplies: [loaded()] }); await flush(); await h.click('ai-refresh');
  h.node('ai-model').value = 'previous-model'; h.node('ai-credits').checked = true;
  h.node('ai-question').value = 'keep this draft'; h.setAuthenticated(false);
  const before = h.calls.length; await h.click('ai-refresh');
  assert.ok(h.calls.slice(before).every(c => c.url === '/api/session' && c.method === 'GET'));
  assert.equal(h.node('ai-account').value, ''); assert.equal(h.node('ai-model').value, '');
  assert.equal(h.node('ai-models').disabled, true); assert.equal(h.node('ai-submit').disabled, true);
  assert.equal(h.node('ai-question').value, 'keep this draft'); assert.deepEqual(h.opened, []);
});

test('late automatic status cannot replace the result of a newer explicit account read', async () => {
  let finishStatus;
  const pendingStatus = new Promise(resolve => { finishStatus = resolve; });
  const h = harness({ statusReplies: [pendingStatus, status()], accountReplies: [loaded()] }); await flush();
  await h.click('ai-refresh');
  assert.equal(h.node('ai-account').value, account.key);
  const text = h.node('ai-connection').textContent;
  finishStatus({ ...status(), storeState: 'UNSAFE', reason: 'CREDENTIAL_ACL_UNSAFE' }); await flush();
  assert.equal(h.node('ai-account').value, account.key);
  assert.equal(h.node('ai-connection').textContent, text);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('late automatic status cannot hide a newer explicit unsafe-store failure', async () => {
  let finishStatus;
  const pendingStatus = new Promise(resolve => { finishStatus = resolve; });
  const h = harness({ statusReplies: [pendingStatus, status()], accountReplies: [{ error: 'CREDENTIAL_ACL_UNSAFE' }] }); await flush();
  await h.click('ai-refresh');
  const text = h.node('ai-connection').textContent;
  assert.match(text, /不會修改權限/);
  finishStatus(status()); await flush();
  assert.equal(h.node('ai-connection').textContent, text);
  assert.equal(h.node('ai-models').disabled, true);
});

test('a current automatic unsafe status invalidates previously loaded choices without another account read', async () => {
  const unsafe = { ...status(), storeState: 'UNSAFE', reason: 'CREDENTIAL_ACL_UNSAFE' };
  const h = harness({ authenticated: false, statusReplies: [status(), unsafe], accountReplies: [loaded()] }); await flush();
  h.setAuthenticated(true); await h.click('ai-refresh'); assert.equal(h.node('ai-account').value, account.key);
  await h.retry();
  assert.equal(h.node('ai-account').value, ''); assert.equal(h.node('ai-models').disabled, true);
  assert.match(h.node('ai-connection').textContent, /不會修改權限/);
  assert.equal(h.calls.filter(c => c.method === 'POST').length, 1);
});

test('unknown status, forged automatic metadata and unknown error text cannot expose details or claim connection', async () => {
  const h = harness({ statusData: { ...status(), reason: 'SYNTHETIC_SECRET_REASON', storeState: 'SYNTHETIC_PRIVATE_STATE',
    accounts: [{ key: 'forged', label: 'SYNTHETIC_SECRET_LABEL' }], runtimeCommit: 'SYNTHETIC_SECRET_VERSION' },
    accountReplies: [{ error: 'SYNTHETIC_SECRET_ERROR' }] }); await flush();
  assert.equal(h.node('ai-account').value, ''); assert.doesNotMatch(h.text(), /SYNTHETIC_SECRET|SYNTHETIC_PRIVATE|已連線/);
  await h.click('ai-refresh');
  assert.doesNotMatch(h.text(), /SYNTHETIC_SECRET|SYNTHETIC_PRIVATE|已連線/);
  assert.equal(h.node('ai-models').disabled, true);
});

test('guest does no AI reads and unauthenticated retries never load accounts or setup', async () => {
  const guest = harness({ guest: true }); await flush(); assert.deepEqual(guest.calls, []);
  const h = harness({ authenticated: false }); await flush();
  await h.click('ai-refresh');
  assert.ok(h.calls.every(c => c.url === '/api/session' && c.method === 'GET'));
  h.setAuthenticated(true); await h.retry();
  assert.ok(h.calls.some(c => c.url.endsWith('/status')));
  assert.ok(h.calls.every(c => c.method === 'GET'));
  assert.equal(h.node('ai-account').value, ''); assert.deepEqual(h.opened, []);
});

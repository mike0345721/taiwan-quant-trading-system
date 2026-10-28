import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createAuthority } from '../scripts/cru21-normal-candidate/prepare.mjs';
import { startFixture, realWindowGate } from '../scripts/cru21-normal-candidate/supervisor.mjs';

const digest = character => character.repeat(64);
function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-supervisor-fixture-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(['authority', 'sourceRoot', 'producerRoot', 'privateRoot'].map(name => {
    const dir = path.join(root, name); fs.mkdirSync(dir); return [name, dir];
  }));
  const raw = createAuthority({ root: dirs.authority, mode: 'ISOLATED_FIXTURE' });
  const ticket = raw.prepare({ approvalId: 'fixture-' + randomUUID(), windowId: randomUUID(),
    helperHashes: { normalGuard: digest('a'), supervisor: digest('b'), prepare: digest('c') },
    binaryHash: digest('d'), bindings: Object.fromEntries(['sourceRoot', 'producerRoot', 'privateRoot'].map(k => [k, dirs[k]])) });
  const observation = { product: ticket.product, clean: true, host: '127.0.0.1', port: 18722,
    dataMode: 'LIVE', normalAuth: true, inlineEnabled: true, guest: false, cru55: false,
    formalRouting: false, privateWritesVerified: true, bindings: ticket.bindings,
    binaryHash: ticket.binaryHash, helperHashes: ticket.helperHashes };
  const events = [];
  const time = { wall: 1800000000000, mono: 1000, broken: false };
  const clock = { wall() { if (time.broken) throw Error('CLOCK_FAILED'); return time.wall; }, mono() { return time.mono; } };
  const owned = new WeakSet(), handles = [], terminated = [];
  const driver = { kind: 'ISOLATED_FIXTURE',
    capabilities: { heldHandle: true, parentDeath: true, hardDeadline: true },
    async spawnFixture(binding) {
      events.push('spawn');
      if (options.spawnThrows) throw Error('SPAWN_FAILED');
      const handle = { binding, exited: false, handleId: randomUUID(), pid: 4242 };
      handles.push(handle); owned.add(handle); return handle;
    },
    owns(handle) { return !options.handleLost && owned.has(handle); },
    describe(handle) { return { handleId: handle.handleId, pid: handle.pid,
      windowId: handle.binding.windowId, head: options.badHandshake ? digest('0').slice(0, 40) : handle.binding.head,
      tree: handle.binding.tree }; },
    exited(handle) { if (!owned.has(handle)) throw Error('NOT_OWNED'); return handle.exited; },
    async terminate(handle, reason) {
      assert.equal(owned.has(handle), true, 'termination must use the original handle object');
      if (options.stopThrows) throw Error('STOP_FAILED');
      terminated.push({ handleId: handle.handleId, pid: handle.pid, reason }); handle.exited = true;
    },
    portFree() { return options.unknownListener ? null : true; },
    async parentLost(handle) { assert.equal(owned.has(handle), true); handle.exited = true; },
  };
  const authority = { consume(...args) {
    events.push('consume');
    const lease = raw.consume(...args); events.push('consumed');
    if (options.consumeDelay) { time.wall += options.consumeDelay; time.mono += options.consumeDelay; }
    const wrapped = { ticket: lease.ticket, intent: lease.intent,
      assertIntact() { if (options.integrityBroken) throw Error('CHANGED'); return lease.assertIntact(); },
      recordLaunch(value) { const result = lease.recordLaunch(value); events.push('launch');
        if (options.launchReceiptUnknown) throw Error('WRITE_RESULT_UNKNOWN'); return result; },
      recordTerminal(value) { events.push('terminal');
        if (options.terminalReceiptUnknown) throw Error('TERMINAL_UNKNOWN'); return lease.recordTerminal(value); },
      markUnknown(value) { events.push('unknown'); return lease.markUnknown(value); },
      release() { events.push('release'); return lease.release(); } };
    if (options.badIntent) wrapped.intent = { ...lease.intent, expiresAtMs: lease.intent.expiresAtMs + 1 };
    return wrapped;
  } };
  const args = { authority, ticket, observation, clock, driver };
  return { args, raw, ticket, observation, events, time, driver, options, handles, terminated, root };
}

test('real window gate never inherits fixture capability or product CI as launch permission', () => {
  const gate = realWindowGate(); assert.equal(gate.allowed, false);
  assert.ok(gate.reasons.includes('WINDOWS_NORMAL_STATUS_READONLY_NOT_VERIFIED'));
  assert.ok(gate.reasons.includes('WINDOWS_HANDLE_AND_PARENT_DEATH_NOT_VERIFIED'));
  assert.ok(Object.isFrozen(gate));
});

test('supervisor ships no real process, socket, PowerShell or application adapter', () => {
  const source = fs.readFileSync(new URL('../scripts/cru21-normal-candidate/supervisor.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /from ['"](?:node:)?(?:child_process|net|http|https|worker_threads)['"]/);
  assert.doesNotMatch(source, /process\.kill\s*\(|execFile\s*\(|Stop-Process|taskkill\.exe|server\.mjs['"]/);
});

test('wrong product version rejects before durable consumption or fixture spawn', async t => {
  const f = fixture(t); f.args.observation = { ...f.observation, product: { ...f.ticket.product, head: '0'.repeat(40) } };
  await assert.rejects(startFixture(f.args)); assert.deepEqual(f.events, []);
});

for (const [name, product] of [
  ['old a4 pair', { head: 'a4afb07f659a13c3b5dbc1510f6894af13fb4b28', tree: 'c05f38aa90e9c1b89cc7c9a314fc029da325ebba' }],
  ['old head with new tree', { head: 'a4afb07f659a13c3b5dbc1510f6894af13fb4b28', tree: 'a2075b623e7045ca64725c02efcb141690b7eb0f' }],
  ['new head with old tree', { head: '807f940e4195153b9c2c83fc2ba0923ec0049203', tree: 'c05f38aa90e9c1b89cc7c9a314fc029da325ebba' }],
]) {
  test(`807 candidate rejects ${name} without consuming or rewriting evidence`, async t => {
    const f = fixture(t);
    const ticketFile = path.join(f.root, 'authority', 'windows', f.ticket.windowId, 'ticket.json');
    const before = fs.readFileSync(ticketFile);
    f.args.observation = { ...f.observation, product: { ...f.ticket.product, ...product } };
    await assert.rejects(startFixture(f.args), { code: 'CANDIDATE_OBSERVATION_INVALID' });
    assert.deepEqual(f.events, []);
    assert.deepEqual(fs.readFileSync(ticketFile), before);
    assert.equal(fs.existsSync(path.join(f.root, 'authority', 'active.guard')), false);
    assert.equal(fs.existsSync(path.join(path.dirname(ticketFile), 'intent.json')), false);
  });
}

test('a real driver or incomplete containment never reaches a fixture spawn', async t => {
  const f = fixture(t); f.driver.kind = 'REAL';
  await assert.rejects(startFixture(f.args), /FIXTURE_DRIVER_REQUIRED/);
  f.driver.kind = 'ISOLATED_FIXTURE'; f.driver.capabilities.parentDeath = false;
  await assert.rejects(startFixture(f.args), /FIXTURE_CONTAINMENT_REQUIRED/);
  assert.deepEqual(f.events, []);
});

test('durable one-time consume occurs before the sole spawn and immutable launch', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  assert.equal(controller.state().phase, 'RUNNING');
  assert.ok(f.events.indexOf('consumed') < f.events.indexOf('spawn'));
  assert.equal(f.events.filter(x => x === 'spawn').length, 1);
  await assert.rejects(startFixture(f.args));
  await controller.stop(); assert.equal(controller.state().phase, 'CLOSED');
  await assert.rejects(startFixture(f.args));
  assert.equal(f.events.filter(x => x === 'spawn').length, 1);
});

test('consume I/O delay counts against the original budget and can prevent every spawn', async t => {
  const f = fixture(t, { consumeDelay: 900000 }), controller = await startFixture(f.args);
  assert.equal(controller.state().phase, 'CLOSED');
  assert.equal(controller.state().reason, 'EXPIRED_BEFORE_START');
  assert.equal(f.handles.length, 0);
  await assert.rejects(startFixture(f.args));
});

for (const variant of ['wall-forward', 'wall-backward-monotonic-expired']) {
  test(`${variant} cannot renew the 15-minute fixture budget`, async t => {
    const f = fixture(t), controller = await startFixture(f.args);
    const deadline = controller.state().expiresAtMs;
    if (variant === 'wall-forward') f.time.wall = deadline;
    else { f.time.wall -= 999999; f.time.mono += 900000; }
    await controller.check(); assert.equal(controller.state().phase, 'CLOSED');
    assert.equal(controller.state().reason, 'DEADLINE'); assert.equal(f.terminated.length, 1);
    assert.equal(controller.state().expiresAtMs, deadline);
  });
}

test('monotonic regression stops instead of creating a fresh elapsed-time baseline', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  f.time.mono -= 1; await controller.check();
  assert.equal(controller.state().phase, 'UNKNOWN');
  assert.equal(controller.state().reason, 'CLOCK_UNVERIFIED');
  assert.equal(f.terminated.length, 1); assert.ok(!f.events.includes('release'));
});

test('changing a consumed deadline is rejected without spawning and never retries', async t => {
  const f = fixture(t, { badIntent: true }), controller = await startFixture(f.args);
  assert.equal(controller.state().phase, 'UNKNOWN'); assert.equal(f.handles.length, 0);
  await assert.rejects(startFixture(f.args));
});

test('a mismatched child handshake only stops the owned fixture handle', async t => {
  const f = fixture(t, { badHandshake: true }), controller = await startFixture(f.args);
  assert.equal(controller.state().phase, 'UNKNOWN');
  assert.equal(f.handles.length, 1); assert.equal(f.terminated.length, 1);
  assert.equal(f.terminated[0].handleId, f.handles[0].handleId);
});

test('PID reuse after original child exit never retargets an unrelated process', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  const unrelated = { pid: f.handles[0].pid, exited: false };
  f.handles[0].exited = true; f.options.unknownListener = true;
  await controller.stop();
  assert.equal(unrelated.exited, false); assert.equal(f.terminated.length, 0);
  assert.equal(controller.state().phase, 'UNKNOWN'); assert.ok(!f.events.includes('release'));
});

test('losing the original handle does not permit PID, port or name fallback', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  f.options.handleLost = true; await controller.stop();
  assert.equal(controller.state().reason, 'OWNED_HANDLE_LOST');
  assert.equal(f.terminated.length, 0); assert.ok(!f.events.includes('release'));
});

test('concurrent cancellation and subsequent checks do not duplicate stop or terminal receipts', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  await Promise.all([controller.stop(), controller.stop(), controller.check()]);
  f.time.mono += 1000000; await controller.check();
  assert.equal(f.terminated.length, 1);
  assert.equal(f.events.filter(x => x === 'terminal').length, 1);
  assert.equal(f.events.filter(x => x === 'release').length, 1);
});

test('simulated parent loss leaves consumed evidence and does not fabricate a closed receipt', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  await controller.simulateParentLoss();
  assert.equal(f.handles[0].exited, true, 'fixture containment closes only its owned child');
  assert.equal(controller.state().phase, 'PARENT_LOST');
  assert.ok(!f.events.includes('terminal')); assert.ok(!f.events.includes('release'));
  await assert.rejects(startFixture(f.args));
});

test('parent loss during an in-flight stop cannot fabricate a surviving-parent terminal receipt', async t => {
  const f = fixture(t);
  const original = f.driver.terminate;
  let completeStop;
  f.driver.terminate = async (...args) => {
    await new Promise(resolve => { completeStop = resolve; });
    return original(...args);
  };
  const controller = await startFixture(f.args);
  const stopping = controller.stop();
  await controller.simulateParentLoss(); completeStop(); await stopping;
  assert.equal(controller.state().phase, 'PARENT_LOST');
  assert.ok(!f.events.includes('terminal')); assert.ok(!f.events.includes('release'));
});

test('a late failed stop cannot write UNKNOWN from a simulated dead parent', async t => {
  const f = fixture(t, { stopThrows: true });
  const original = f.driver.terminate;
  let completeStop;
  f.driver.terminate = async (...args) => { await new Promise(resolve => { completeStop = resolve; }); return original(...args); };
  const controller = await startFixture(f.args), stopping = controller.stop();
  await controller.simulateParentLoss(); completeStop(); await stopping;
  assert.equal(controller.state().phase, 'PARENT_LOST');
  assert.ok(!f.events.includes('unknown')); assert.ok(!f.events.includes('terminal'));
  assert.ok(!f.events.includes('release'));
});

test('clock failure during pending termination cannot certify CLOSED with a stale timestamp', async t => {
  const f = fixture(t);
  const original = f.driver.terminate;
  let completeStop;
  f.driver.terminate = async (...args) => { await new Promise(resolve => { completeStop = resolve; }); return original(...args); };
  const controller = await startFixture(f.args), stopping = controller.stop();
  f.time.broken = true; completeStop(); await stopping;
  assert.equal(f.handles[0].exited, true);
  assert.equal(controller.state().phase, 'UNKNOWN');
  assert.ok(!f.events.includes('release'));
});

test('a stop completing after the fixed deadline is reported as unverified rather than a timely close', async t => {
  const f = fixture(t);
  const original = f.driver.terminate;
  let completeStop;
  f.driver.terminate = async (...args) => { await new Promise(resolve => { completeStop = resolve; }); return original(...args); };
  const controller = await startFixture(f.args), stopping = controller.stop();
  f.time.wall += 900001; f.time.mono += 900001; completeStop(); await stopping;
  assert.equal(controller.state().phase, 'UNKNOWN');
  assert.ok(!f.events.includes('release'));
});

test('unverified termination retains the guard with no alternate control path', async t => {
  const f = fixture(t, { stopThrows: true }), controller = await startFixture(f.args);
  await controller.stop(); assert.equal(controller.state().phase, 'UNKNOWN');
  assert.equal(f.terminated.length, 0); assert.ok(!f.events.includes('release'));
});

test('uncertain launch receipt stops the owned handle and does not repeat an append or spawn', async t => {
  const f = fixture(t, { launchReceiptUnknown: true }), controller = await startFixture(f.args);
  assert.equal(controller.state().phase, 'UNKNOWN'); assert.equal(f.terminated.length, 1);
  assert.equal(f.events.filter(x => x === 'launch').length, 1);
  assert.ok(!f.events.includes('release')); await assert.rejects(startFixture(f.args));
});

test('uncertain terminal receipt never reports a successful close or releases the guard', async t => {
  const f = fixture(t, { terminalReceiptUnknown: true }), controller = await startFixture(f.args);
  await controller.stop(); assert.equal(controller.state().phase, 'UNKNOWN');
  assert.equal(f.handles[0].exited, true); assert.ok(!f.events.includes('release'));
});

test('clock failure after spawn still stops the original child while keeping outcome UNKNOWN', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  f.time.broken = true; await controller.check();
  assert.equal(controller.state().phase, 'UNKNOWN');
  assert.equal(f.handles[0].exited, true); assert.ok(!f.events.includes('release'));
});

test('post-launch integrity failure stops only the original child and retains consumed state', async t => {
  const f = fixture(t), controller = await startFixture(f.args);
  f.options.integrityBroken = true; await controller.check();
  assert.equal(controller.state().phase, 'UNKNOWN'); assert.equal(f.terminated.length, 1);
  assert.ok(!f.events.includes('release'));
});

test('spawn failure is consumed and cannot turn into an automatic restart', async t => {
  const f = fixture(t, { spawnThrows: true }), controller = await startFixture(f.args);
  assert.equal(controller.state().phase, 'UNKNOWN'); assert.equal(f.handles.length, 0);
  await assert.rejects(startFixture(f.args));
  assert.equal(f.events.filter(x => x === 'spawn').length, 1);
});

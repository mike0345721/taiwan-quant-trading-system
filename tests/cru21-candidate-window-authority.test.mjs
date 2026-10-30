import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const modulePath = '../scripts/cru21-normal-candidate/prepare.mjs';
const hashes = { normalGuard: '1'.repeat(64), supervisor: '2'.repeat(64), prepare: '3'.repeat(64) };
function fixture(t) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cru21-authority-test-'));
  t.after(() => fs.rmSync(base, { recursive: true, force: true }));
  for (const name of ['authority', 'source', 'producer', 'private']) fs.mkdirSync(path.join(base, name));
  return { base, root: path.join(base, 'authority'), bindings: { sourceRoot: path.join(base, 'source'), producerRoot: path.join(base, 'producer'), privateRoot: path.join(base, 'private') } };
}
function input(f, extra = {}) { return { approvalId: `fixture-${randomUUID()}`, windowId: randomUUID(), helperHashes: hashes, binaryHash: '4'.repeat(64), bindings: f.bindings, ...extra }; }
const clock = { wallMs: 1_000_000, monoMs: 20_000 };
function windowFile(f, ticket, name) { return path.join(f.root, 'windows', ticket.windowId, `${name}.json`); }
function launchFor(ticket) { return { handleId: randomUUID(), pid: 123, windowId: ticket.windowId, head: ticket.product.head, tree: ticket.product.tree }; }
function closedFor(launch = null) { return { phase: 'CLOSED', reason: 'FIXTURE_COMPLETE', childExited: true, handleId: launch?.handleId ?? null, wallMs: clock.wallMs + 100, monoMs: clock.monoMs + 100, portFree: true }; }

test('fixture authority returns an immutable fixed-version ticket and runtime always holds', async (t) => {
  const { createAuthority } = await import(modulePath);
  const { PRODUCT, runtimeGate, assertObservation } = await import('../scripts/cru21-normal-candidate/normal-guard.mjs');
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f));
  assert.equal(ticket.product.head, '4ae16de9a5af0166744626d44a49cb5bcebed675');
  assert.equal(ticket.product.tree, 'ac2d522e6d42934dbb563599a04df61f56fc9145');
  assert.deepEqual(ticket.product, PRODUCT);
  assert.equal(ticket.runtimeAllowed, false);
  assert.ok(Object.isFrozen(ticket.bindings.sourceRoot));
  const obs = { product: PRODUCT, clean: true, host: '127.0.0.1', port: 18722, dataMode: 'LIVE', normalAuth: true, inlineEnabled: true, guest: false, cru55: false, formalRouting: false, privateWritesVerified: true, bindings: ticket.bindings, helperHashes: ticket.helperHashes, binaryHash: ticket.binaryHash };
  assert.equal(assertObservation(ticket, obs).runtimeAllowed, false);
  assert.equal(runtimeGate().allowed, false);
  for (const [field, value] of [['head', '0'.repeat(40)], ['tree', '0'.repeat(40)], ['branch', 'other'], ['main', '0'.repeat(40)]]) {
    assert.throws(() => assertObservation(ticket, { ...obs, product: { ...PRODUCT, [field]: value } }));
  }
  assert.throws(() => assertObservation(ticket, { ...obs, bindings: { ...ticket.bindings, sourceRoot: ticket.bindings.producerRoot } }));
  assert.throws(() => assertObservation(ticket, { ...obs, binaryHash: '0'.repeat(64) }));
  assert.throws(() => assertObservation(ticket, { ...obs, helperHashes: { ...ticket.helperHashes, supervisor: '0'.repeat(64) } }));
});

test('one approval may prepare only one window, including across authority reopen', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const args = input(f); authority.prepare(args);
  const reopened = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => reopened.prepare({ ...args, windowId: randomUUID() }));
  assert.throws(() => authority.prepare({ ...args, approvalId: 'owner-live-approval' }));
});

test('consume is durable before launch and cannot retry after a prelaunch crash', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock);
  assert.equal(lease.intent.expiresAtMs, clock.wallMs + 900_000);
  assert.equal(lease.intent.durationMs, 900_000);
  assert.throws(() => authority.consume(ticket.windowId, clock));
  assert.throws(() => lease.release());
  const reopened = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => reopened.consume(ticket.windowId, clock));
});

test('global active guard blocks other prepared windows without deleting foreign state', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const a = authority.prepare(input(f)), b = authority.prepare(input(f));
  authority.consume(a.windowId, clock);
  const before = fs.readFileSync(path.join(f.root, 'active.guard'));
  assert.throws(() => authority.consume(b.windowId, clock));
  assert.deepEqual(fs.readFileSync(path.join(f.root, 'active.guard')), before);
});

test('copied ticket and aliased roots cannot create a new authority', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f));
  const copy = path.join(f.base, 'copy'); fs.cpSync(f.root, copy, { recursive: true });
  assert.throws(() => createAuthority({ root: copy, mode: 'ISOLATED_FIXTURE' }));
  const alias = path.join(f.base, 'alias'); fs.symlinkSync(f.root, alias, 'dir');
  assert.throws(() => createAuthority({ root: alias, mode: 'ISOLATED_FIXTURE' }));
  assert.throws(() => authority.prepare(input(f, { bindings: { ...f.bindings, privateRoot: f.bindings.sourceRoot } })));
  assert.ok(ticket.ticketHash);
});

test('unknown guard and receipt mutation fail closed without spawning or rewriting history', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f));
  const guard = path.join(f.root, 'active.guard'); fs.writeFileSync(guard, 'unknown');
  assert.throws(() => authority.consume(ticket.windowId, clock));
  assert.equal(fs.readFileSync(guard, 'utf8'), 'unknown');
});

test('launch and terminal are append-once receipts; release requires proved fixture closure', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock), launch = launchFor(ticket);
  const ticketBytes = fs.readFileSync(windowFile(f, ticket, 'ticket'));
  const intentBytes = fs.readFileSync(windowFile(f, ticket, 'intent'));
  lease.recordLaunch(launch); lease.recordTerminal(closedFor(launch));
  assert.deepEqual(lease.release(), { leaseReleased: true, guardRetained: true, liveReuseAllowed: false });
  assert.equal(fs.existsSync(path.join(f.root, 'active.guard')), true);
  assert.deepEqual(fs.readFileSync(windowFile(f, ticket, 'ticket')), ticketBytes);
  assert.deepEqual(fs.readFileSync(windowFile(f, ticket, 'intent')), intentBytes);
  const launchBytes = fs.readFileSync(windowFile(f, ticket, 'launch'));
  assert.throws(() => lease.recordLaunch(launch));
  assert.deepEqual(fs.readFileSync(windowFile(f, ticket, 'launch')), launchBytes);
  assert.throws(() => authority.consume(ticket.windowId, clock), { code: 'CANDIDATE_ALREADY_CONSUMED' });
  assert.equal(fs.existsSync(path.join(f.root, 'active.guard')), true, 'sealed fixture retains its global guard permanently');
});

test('UNKNOWN never releases and never overwrites its terminal receipt', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock);
  lease.markUnknown({ ...closedFor(), phase: 'CLOSED', reason: 'FIXTURE_UNKNOWN', childExited: false, portFree: null });
  const before = fs.readFileSync(windowFile(f, ticket, 'terminal'));
  assert.equal(JSON.parse(before).phase, 'UNKNOWN');
  assert.throws(() => lease.release());
  assert.throws(() => lease.recordTerminal(closedFor()));
  assert.deepEqual(fs.readFileSync(windowFile(f, ticket, 'terminal')), before);
  assert.equal(fs.existsSync(path.join(f.root, 'active.guard')), true);
});

test('modified ticket, intent, launch and terminal each poison further actions', async (t) => {
  const { createAuthority } = await import(modulePath);
  for (const name of ['ticket', 'intent', 'launch', 'terminal']) {
    const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
    const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock), launch = launchFor(ticket);
    if (['launch', 'terminal'].includes(name)) lease.recordLaunch(launch);
    if (name === 'terminal') lease.recordTerminal(closedFor(launch));
    const file = windowFile(f, ticket, name), old = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file, old.replace('ISOLATED_FIXTURE', 'MUTATED_FIXTURE_'));
    const changed = fs.readFileSync(file);
    assert.throws(() => lease.assertIntact());
    assert.throws(() => lease.release());
    assert.deepEqual(fs.readFileSync(file), changed);
    assert.ok(fs.existsSync(path.join(f.root, 'active.guard')));
  }
});

test('hardlinked or symlinked authority receipts are refused even with matching bytes', async (t) => {
  const { createAuthority } = await import(modulePath);
  for (const aliasKind of ['hardlink', 'symlink']) {
    const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
    const ticket = authority.prepare(input(f));
    const file = windowFile(f, ticket, 'ticket'), alias = path.join(f.base, 'ticket-alias');
    if (aliasKind === 'hardlink') fs.linkSync(file, alias);
    else { fs.renameSync(file, alias); fs.symlinkSync(alias, file); }
    assert.throws(() => authority.consume(ticket.windowId, clock));
    assert.equal(fs.existsSync(path.join(f.root, 'active.guard')), false);
  }
});

test('binding alias and identity replacement reject before intent creation', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const alias = path.join(f.base, 'source-alias'); fs.symlinkSync(f.bindings.sourceRoot, alias, 'dir');
  assert.throws(() => authority.prepare(input(f, { bindings: { ...f.bindings, sourceRoot: alias } })));
  const ticket = authority.prepare(input(f));
  fs.renameSync(f.bindings.sourceRoot, path.join(f.base, 'source-old')); fs.mkdirSync(f.bindings.sourceRoot);
  assert.throws(() => authority.consume(ticket.windowId, clock));
  assert.equal(fs.existsSync(windowFile(f, ticket, 'intent')), false);
});

test('a replaced owned guard remains untouched on release', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock);
  lease.recordTerminal(closedFor());
  const guard = path.join(f.root, 'active.guard'); fs.renameSync(guard, path.join(f.base, 'old-guard'));
  fs.writeFileSync(guard, 'foreign guard');
  assert.throws(() => lease.release());
  assert.equal(fs.readFileSync(guard, 'utf8'), 'foreign guard');
});

test('intent fsync ambiguity preserves consumed bytes and prevents retry across reopen', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), fdFiles = new Map(); let inject = false;
  const io = {
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); fdFiles.set(fd, file); return fd; },
    closeSync(fd) { fdFiles.delete(fd); fs.closeSync(fd); },
    fsyncSync(fd) { fs.fsyncSync(fd); if (inject && String(fdFiles.get(fd)).endsWith('intent.json')) { inject = false; throw Object.assign(new Error('synthetic fsync uncertainty'), { code: 'EIO' }); } },
  };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)); inject = true;
  assert.throws(() => authority.consume(ticket.windowId, clock), { code: 'EIO' });
  assert.ok(fs.existsSync(windowFile(f, ticket, 'intent')));
  assert.ok(fs.existsSync(path.join(f.root, 'active.guard')));
  assert.throws(() => authority.consume(ticket.windowId, clock));
  const reopened = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => reopened.consume(ticket.windowId, clock));
  assert.equal(fs.existsSync(windowFile(f, ticket, 'launch')), false);
});

test('launch or terminal write ambiguity keeps the guard and immutable attempted receipt', async (t) => {
  const { createAuthority } = await import(modulePath);
  for (const name of ['launch', 'terminal']) {
    const f = fixture(t), fdFiles = new Map(); let target = null;
    const io = {
      openSync(file, ...args) { const fd = fs.openSync(file, ...args); fdFiles.set(fd, file); return fd; },
      closeSync(fd) { fdFiles.delete(fd); fs.closeSync(fd); },
      fsyncSync(fd) { fs.fsyncSync(fd); if (target && String(fdFiles.get(fd)).endsWith(`${target}.json`)) { target = null; throw Object.assign(new Error('synthetic receipt uncertainty'), { code: 'EIO' }); } },
    };
    const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
    const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock), launch = launchFor(ticket);
    if (name === 'terminal') lease.recordLaunch(launch);
    target = name;
    assert.throws(() => name === 'launch' ? lease.recordLaunch(launch) : lease.recordTerminal(closedFor(launch)), { code: 'EIO' });
    const before = fs.readFileSync(windowFile(f, ticket, name));
    assert.throws(() => lease.release());
    assert.throws(() => lease.recordTerminal(closedFor(launch)));
    assert.deepEqual(fs.readFileSync(windowFile(f, ticket, name)), before);
    assert.ok(fs.existsSync(path.join(f.root, 'active.guard')));
  }
});

test('simultaneous reentrant consume observes exclusive guard, with one durable intent', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t); let nested = null, authority, secondTicket, nestedCalls = 0;
  const io = { openSync(file, ...args) {
    const fd = fs.openSync(file, ...args);
    if (nested && String(file).endsWith('/active.guard')) { const action = nested; nested = null; action(); }
    return fd;
  } };
  authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const first = authority.prepare(input(f)); secondTicket = authority.prepare(input(f));
  nested = () => { nestedCalls++; assert.throws(() => authority.consume(secondTicket.windowId, clock), { code: 'EEXIST' }); };
  authority.consume(first.windowId, clock);
  assert.equal(nestedCalls, 1);
  assert.ok(fs.existsSync(windowFile(f, first, 'intent')));
  assert.equal(fs.existsSync(windowFile(f, secondTicket, 'intent')), false);
});

test('one governed private fixture root refuses a second authority even with a new window ID', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const args = input(f); authority.prepare(args);
  const marker = path.join(f.bindings.privateRoot, '.cru21-fixture-authority.json'), before = fs.readFileSync(marker);
  const anotherRoot = path.join(f.base, 'another-authority'); fs.mkdirSync(anotherRoot);
  const another = createAuthority({ root: anotherRoot, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => another.prepare({ ...args, windowId: randomUUID() }), { code: 'CANDIDATE_PRIVATE_AUTHORITY_CHANGED' });
  assert.deepEqual(fs.readFileSync(marker), before);
  assert.equal(fs.readdirSync(path.join(anotherRoot, 'windows')).length, 0);
});

test('directory fsync uncertainty after intent write also keeps the one-shot consume blocked', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), fdFiles = new Map(); let armed = false, intentSynced = false;
  const io = {
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); fdFiles.set(fd, file); return fd; },
    closeSync(fd) { fdFiles.delete(fd); fs.closeSync(fd); },
    fsyncSync(fd) {
      fs.fsyncSync(fd);
      if (armed && String(fdFiles.get(fd)).endsWith('intent.json')) intentSynced = true;
      if (intentSynced && fs.fstatSync(fd).isDirectory()) { intentSynced = false; armed = false; throw Object.assign(new Error('synthetic directory fsync uncertainty'), { code: 'EIO' }); }
    },
  };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)); armed = true;
  assert.throws(() => authority.consume(ticket.windowId, clock), { code: 'EIO' });
  assert.ok(fs.existsSync(windowFile(f, ticket, 'intent')));
  assert.ok(fs.existsSync(path.join(f.root, 'active.guard')));
  const reopened = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => reopened.consume(ticket.windowId, clock));
});

test('authority root replacement and changed private marker refuse actions and preserve old guard', async (t) => {
  const { createAuthority } = await import(modulePath);
  for (const change of ['root', 'private-marker']) {
    const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
    const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock);
    let guard = path.join(f.root, 'active.guard');
    if (change === 'root') {
      const oldRoot = path.join(f.base, 'old-authority'); fs.renameSync(f.root, oldRoot); fs.mkdirSync(f.root);
      guard = path.join(oldRoot, 'active.guard');
    } else {
      const marker = path.join(f.bindings.privateRoot, '.cru21-fixture-authority.json');
      fs.writeFileSync(marker, fs.readFileSync(marker, 'utf8').replace('ISOLATED_FIXTURE', 'MODIFIED_FIXTURE'));
    }
    const before = fs.readFileSync(guard);
    assert.throws(() => lease.assertIntact());
    assert.throws(() => lease.release());
    assert.deepEqual(fs.readFileSync(guard), before);
  }
});

test('invalid preparation and unsafe clock values fail without creating claims or intents', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  for (const extra of [{ binaryHash: 'invalid' }, { helperHashes: { ...hashes, prepare: 'bad' } }, { windowId: '../window' }, { runtimeAllowed: true }]) {
    assert.throws(() => authority.prepare(input(f, extra)));
  }
  assert.equal(fs.readdirSync(path.join(f.root, 'approvals')).length, 0);
  const ticket = authority.prepare(input(f));
  for (const times of [{ wallMs: -1, monoMs: 0 }, { wallMs: 0, monoMs: Number.MAX_SAFE_INTEGER }, { ...clock, durationMs: 1 }]) assert.throws(() => authority.consume(ticket.windowId, times));
  assert.equal(fs.existsSync(path.join(f.root, 'active.guard')), false);
  assert.equal(fs.existsSync(windowFile(f, ticket, 'intent')), false);
  assert.throws(() => createAuthority({ root: f.root, mode: 'LIVE' }), { code: 'CANDIDATE_FIXTURE_ONLY' });
});

test('restoring a pre-consume window directory cannot undo authority-wide consumption', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  const ticket = authority.prepare(input(f)), dir = path.dirname(windowFile(f, ticket, 'ticket'));
  const backup = path.join(f.base, 'pre-consume-window'); fs.cpSync(dir, backup, { recursive: true });
  const lease = authority.consume(ticket.windowId, clock);
  lease.recordTerminal(closedFor()); lease.release();
  fs.rmSync(dir, { recursive: true }); fs.cpSync(backup, dir, { recursive: true });
  const reopened = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => reopened.consume(ticket.windowId, clock), { code: 'CANDIDATE_ALREADY_CONSUMED' });
  assert.equal(fs.existsSync(windowFile(f, ticket, 'intent')), false);
});

test('window parent symlink replacement during guard acquisition cannot write into source root', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t); let swap = null;
  const io = { openSync(file, ...args) {
    const fd = fs.openSync(file, ...args);
    if (swap && String(file).endsWith('/active.guard')) { const action = swap; swap = null; action(); }
    return fd;
  } };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)), dir = path.dirname(windowFile(f, ticket, 'ticket'));
  swap = () => { fs.renameSync(dir, path.join(f.base, 'original-window')); fs.symlinkSync(f.bindings.sourceRoot, dir, 'dir'); };
  assert.throws(() => authority.consume(ticket.windowId, clock));
  assert.equal(fs.existsSync(path.join(f.bindings.sourceRoot, 'intent.json')), false);
  assert.equal(fs.existsSync(path.join(f.root, 'active.guard')), true);
});

test('write readback never adopts an identical-byte replacement inode after directory fsync', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), fdFiles = new Map(); let armed = false, guardSynced = false, swapped = false;
  const guard = path.join(f.root, 'active.guard'), original = path.join(f.base, 'original-guard');
  const io = {
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); fdFiles.set(fd, file); return fd; },
    closeSync(fd) { fdFiles.delete(fd); fs.closeSync(fd); },
    fsyncSync(fd) {
      fs.fsyncSync(fd);
      if (armed && String(fdFiles.get(fd)).endsWith('/active.guard')) guardSynced = true;
      if (guardSynced && fs.fstatSync(fd).isDirectory()) {
        guardSynced = false; armed = false; swapped = true;
        fs.renameSync(guard, original); fs.writeFileSync(guard, fs.readFileSync(original));
      }
    },
  };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)); armed = true;
  assert.throws(() => authority.consume(ticket.windowId, clock));
  assert.equal(swapped, true);
  assert.ok(fs.existsSync(original)); assert.ok(fs.existsSync(guard));
  assert.notEqual(fs.statSync(original).ino, fs.statSync(guard).ino);
  assert.deepEqual(fs.readFileSync(original), fs.readFileSync(guard));
});

test('a parent swapped inside the intent open hook cannot redirect receipt bytes to source', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t); let target = null, armed = false, swaps = 0;
  const io = { openSync(file, ...args) {
    if (armed && String(file).endsWith('/intent.json')) {
      armed = false; swaps++;
      fs.renameSync(target, path.join(f.base, 'original-intent-parent'));
      fs.symlinkSync(f.bindings.sourceRoot, target, 'dir');
    }
    return fs.openSync(file, ...args);
  } };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)); target = path.dirname(windowFile(f, ticket, 'ticket')); armed = true;
  assert.throws(() => authority.consume(ticket.windowId, clock));
  assert.equal(swaps, 1);
  assert.deepEqual(fs.readdirSync(f.bindings.sourceRoot), []);
  assert.ok(fs.existsSync(path.join(f.root, 'active.guard')));
});

test('consumption tombstone fsync uncertainty precedes intent and never permits a retry', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t), fdFiles = new Map(); let armed = false;
  const io = {
    openSync(file, ...args) { const fd = fs.openSync(file, ...args); fdFiles.set(fd, file); return fd; },
    closeSync(fd) { fdFiles.delete(fd); fs.closeSync(fd); },
    fsyncSync(fd) {
      fs.fsyncSync(fd);
      if (armed && String(fdFiles.get(fd)).endsWith('.consumed.json')) { armed = false; throw Object.assign(new Error('synthetic consumption durability uncertainty'), { code: 'EIO' }); }
    },
  };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)); armed = true;
  assert.throws(() => authority.consume(ticket.windowId, clock), { code: 'EIO' });
  assert.equal(fs.existsSync(windowFile(f, ticket, 'intent')), false);
  assert.ok(fs.existsSync(path.join(f.root, 'active.guard')));
  const consumed = fs.readdirSync(path.join(f.root, 'approvals')).filter((name) => name.endsWith('.consumed.json'));
  assert.equal(consumed.length, 1);
  const event = JSON.parse(fs.readFileSync(path.join(f.root, 'approvals', consumed[0]), 'utf8'));
  assert.equal(event.ticketHash, ticket.ticketHash);
  assert.equal(event.approvalId, ticket.approvalId);
  assert.equal(event.expiresAtMs, clock.wallMs + 900_000);
  const reopened = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE' });
  assert.throws(() => reopened.consume(ticket.windowId, clock), { code: 'CANDIDATE_ALREADY_CONSUMED' });
});

test('release seals only this lease and never calls unlink or rename on any guard', async (t) => {
  const { createAuthority } = await import(modulePath);
  const f = fixture(t); let unlinkCalls = 0, renameCalls = 0;
  const io = {
    unlinkSync() { unlinkCalls++; throw new Error('unlink forbidden'); },
    renameSync() { renameCalls++; throw new Error('rename forbidden'); },
  };
  const authority = createAuthority({ root: f.root, mode: 'ISOLATED_FIXTURE', io });
  const ticket = authority.prepare(input(f)), lease = authority.consume(ticket.windowId, clock);
  const guard = path.join(f.root, 'active.guard'), guardBytes = fs.readFileSync(guard), guardInode = fs.statSync(guard).ino;
  lease.recordTerminal(closedFor());
  const result = lease.release();
  assert.deepEqual(result, { leaseReleased: true, guardRetained: true, liveReuseAllowed: false });
  assert.ok(Object.isFrozen(result));
  assert.equal(unlinkCalls, 0); assert.equal(renameCalls, 0);
  assert.deepEqual(fs.readFileSync(guard), guardBytes);
  assert.equal(fs.statSync(guard).ino, guardInode);
  const sealed = windowFile(f, ticket, 'lease-sealed'), sealedBytes = fs.readFileSync(sealed);
  assert.equal(JSON.parse(sealedBytes).ticketHash, ticket.ticketHash);
  assert.equal(JSON.parse(sealedBytes).guardRetained, true);
  assert.throws(() => lease.release());
  assert.throws(() => lease.recordTerminal(closedFor()));
  assert.deepEqual(fs.readFileSync(sealed), sealedBytes);
  const other = authority.prepare(input(f));
  assert.throws(() => authority.consume(other.windowId, clock), { code: 'EEXIST' });
  assert.deepEqual(fs.readFileSync(guard), guardBytes);
});

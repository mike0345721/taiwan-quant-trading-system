// Fixed-root fixture authority. This module cannot prepare or launch a real window.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { PRODUCT, DURATION_MS, deepFreeze, runtimeGate } from './normal-guard.mjs';

const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const HASH = /^[a-f0-9]{64}$/;
const ROOT_NAMES = ['sourceRoot', 'producerRoot', 'privateRoot'];
const HELPER_NAMES = ['normalGuard', 'supervisor', 'prepare'];
const TERMINAL_KEYS = ['phase', 'reason', 'childExited', 'handleId', 'wallMs', 'monoMs', 'portFree'];
function fail(code) { throw Object.assign(new Error(code), { code }); }
function insist(condition, code = 'CANDIDATE_STATE_INVALID') { if (!condition) fail(code); }
function exactKeys(value, keys) { return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|'); }
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function sealed(body) { return { ...body, recordHash: hash(body) }; }
function checkSeal(value) { const { recordHash, ...body } = value ?? {}; insist(HASH.test(recordHash) && recordHash === hash(body), 'CANDIDATE_RECEIPT_CHANGED'); return value; }
function contained(parent, child) { const rel = path.relative(parent, child); return rel !== '' && rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel); }
function sameIdentity(a, b) { return a?.path === b?.path && a?.dev === b?.dev && a?.ino === b?.ino; }
function nonnegative(value) { return Number.isSafeInteger(value) && value >= 0; }

export function createAuthority({ root, mode, io = {} } = {}) {
  insist(mode === 'ISOLATED_FIXTURE', 'CANDIDATE_FIXTURE_ONLY');
  // Held-directory access below is deliberately Linux fixture machinery. It is
  // not a Windows implementation and cannot qualify a real candidate window.
  insist(process.platform === 'linux' && fs.existsSync('/proc/self/fd'), 'CANDIDATE_FIXTURE_PLATFORM_UNSUPPORTED');
  // Even with a fault-injected IO adapter, the namespace must be an actual temp fixture.
  const tempRoot = fs.realpathSync(os.tmpdir());
  function directoryIdentity(target) {
    insist(typeof target === 'string' && path.isAbsolute(target), 'CANDIDATE_ROOT_INVALID');
    const resolved = path.resolve(target), stat = fs.lstatSync(resolved), real = fs.realpathSync(resolved);
    insist(stat.isDirectory() && !stat.isSymbolicLink() && real === resolved && contained(tempRoot, real), 'CANDIDATE_ROOT_INVALID');
    // Reject aliases in any component, not only the final path.
    insist(fs.realpathSync(path.dirname(resolved)) === path.dirname(resolved), 'CANDIDATE_ROOT_INVALID');
    return { path: real, dev: stat.dev, ino: stat.ino };
  }
  const rootIdentity = directoryIdentity(root), ops = { ...fs, ...io };
  const markerPath = path.join(rootIdentity.path, 'authority.json');
  const approvalsDir = path.join(rootIdentity.path, 'approvals');
  const windowsDir = path.join(rootIdentity.path, 'windows');
  const guardPath = path.join(rootIdentity.path, 'active.guard');
  const observed = new Map();
  const directories = new Map([[rootIdentity.path, rootIdentity]]);
  let poisoned = false;
  function assertRoot() { insist(!poisoned, 'CANDIDATE_IO_UNCERTAIN'); insist(sameIdentity(rootIdentity, directoryIdentity(rootIdentity.path)), 'CANDIDATE_AUTHORITY_CHANGED'); }
  function statFile(file) { const stat = ops.lstatSync(file); insist(stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1, 'CANDIDATE_FILE_ALIAS'); return stat; }
  function unchanged(a, b) { return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs; }
  function rememberDirectory(identity) {
    const prior = directories.get(identity.path);
    insist(!prior || sameIdentity(prior, identity), 'CANDIDATE_DIRECTORY_CHANGED');
    directories.set(identity.path, identity);
    return identity;
  }
  function assertParent(file) {
    assertRoot();
    const parent = path.dirname(file), expected = directories.get(parent);
    insist(expected && sameIdentity(expected, directoryIdentity(parent)), 'CANDIDATE_DIRECTORY_CHANGED');
    return expected;
  }
  function withParent(file, action) {
    const expected = assertParent(file);
    let fd, primary;
    try {
      fd = ops.openSync(expected.path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
      const held = ops.fstatSync(fd);
      insist(held.isDirectory() && held.dev === expected.dev && held.ino === expected.ino, 'CANDIDATE_DIRECTORY_CHANGED');
      assertParent(file);
      // Every filename resolves relative to the held directory, even if the
      // original namespace is renamed or replaced inside a fault-injected open.
      const result = action(`/proc/self/fd/${fd}/${path.basename(file)}`, fd);
      assertParent(file);
      return result;
    } catch (error) { primary = error; throw error; }
    finally { if (fd !== undefined) try { ops.closeSync(fd); } catch (error) { poisoned = true; if (!primary) throw error; } }
  }
  function readAt(file, anchored) {
    const before = statFile(anchored);
    let fd, raw, held;
    try {
      fd = ops.openSync(anchored, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      held = ops.fstatSync(fd);
      insist(held.isFile() && held.nlink === 1 && unchanged(before, held), 'CANDIDATE_RECEIPT_CHANGED');
      raw = ops.readFileSync(fd, 'utf8');
    } finally { if (fd !== undefined) ops.closeSync(fd); }
    const after = statFile(anchored);
    insist(unchanged(held, after), 'CANDIDATE_RECEIPT_CHANGED');
    const previous = observed.get(file);
    insist(!previous || (previous.raw === raw && unchanged(previous.stat, after)), 'CANDIDATE_RECEIPT_CHANGED');
    let value; try { value = JSON.parse(raw); } catch { fail('CANDIDATE_RECEIPT_CHANGED'); }
    checkSeal(value); observed.set(file, { raw, stat: after });
    return value;
  }
  function readRecord(file) { return withParent(file, (anchored) => readAt(file, anchored)); }
  function syncDir(dir) { return withParent(path.join(dir, '.fixture-sync'), (_anchored, fd) => ops.fsyncSync(fd)); }
  function writeRecord(file, body) {
    const value = sealed(body), raw = `${canonical(value)}\n`;
    try {
      return withParent(file, (anchored, parentFd) => {
        let fd, held;
        try {
          fd = ops.openSync(anchored, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
          const bytes = Buffer.from(raw); let offset = 0;
          while (offset < bytes.length) { const count = ops.writeSync(fd, bytes, offset, bytes.length - offset); insist(count > 0, 'CANDIDATE_IO_UNCERTAIN'); offset += count; }
          ops.fsyncSync(fd);
          held = ops.fstatSync(fd);
          insist(held.isFile() && held.nlink === 1 && unchanged(held, statFile(anchored)), 'CANDIDATE_RECEIPT_CHANGED');
        } finally { if (fd !== undefined) ops.closeSync(fd); }
        ops.fsyncSync(parentFd);
        const reread = readAt(file, anchored), readback = observed.get(file);
        insist(unchanged(held, readback.stat) && readback.raw === raw && canonical(reread) === canonical(value), 'CANDIDATE_RECEIPT_CHANGED');
        return reread;
      });
    } catch (error) {
      // An exclusive write or fsync might already have reached disk. Never remove/retry it.
      if (error.code !== 'EEXIST') poisoned = true;
      throw error;
    }
  }
  function ownedDirectory(dir) {
    if (!ops.existsSync(dir)) { withParent(dir, (anchored) => ops.mkdirSync(anchored, { mode: 0o700 })); syncDir(path.dirname(dir)); }
    const ident = directoryIdentity(dir);
    insist(contained(rootIdentity.path, ident.path), 'CANDIDATE_ROOT_INVALID');
    return rememberDirectory(ident);
  }
  assertRoot();
  let marker;
  if (ops.existsSync(markerPath)) marker = readRecord(markerPath);
  else marker = writeRecord(markerPath, { schema: 'cru21-fixture-authority-v1', mode, runtimeAllowed: false, authorityId: randomUUID(), root: rootIdentity });
  insist(marker.schema === 'cru21-fixture-authority-v1' && marker.mode === mode && marker.runtimeAllowed === false && UUID.test(marker.authorityId) && sameIdentity(marker.root, rootIdentity), 'CANDIDATE_AUTHORITY_CHANGED');
  const authorityId = marker.authorityId;
  const approvalsIdentity = ownedDirectory(approvalsDir), windowsIdentity = ownedDirectory(windowsDir);
  function assertAuthority() {
    assertRoot();
    insist(readRecord(markerPath).recordHash === marker.recordHash, 'CANDIDATE_AUTHORITY_CHANGED');
    insist(sameIdentity(approvalsIdentity, directoryIdentity(approvalsDir)) && sameIdentity(windowsIdentity, directoryIdentity(windowsDir)), 'CANDIDATE_AUTHORITY_CHANGED');
  }
  function bound(body, windowId, ticketHash) { return { ...body, mode, runtimeAllowed: false, authorityId, windowId, ticketHash }; }
  function ticketDirectory(windowId) { insist(UUID.test(windowId), 'CANDIDATE_WINDOW_INVALID'); return path.join(windowsDir, windowId); }
  function checkBindings(bindings) {
    insist(exactKeys(bindings, ROOT_NAMES), 'CANDIDATE_BINDINGS_INVALID');
    const values = Object.fromEntries(ROOT_NAMES.map((name) => [name, directoryIdentity(typeof bindings[name] === 'string' ? bindings[name] : bindings[name]?.path)]));
    const identities = Object.values(values);
    for (const ident of identities) {
      insist(!sameIdentity(ident, rootIdentity) && !contained(rootIdentity.path, ident.path) && !contained(ident.path, rootIdentity.path), 'CANDIDATE_BINDINGS_INVALID');
      for (const other of identities) if (other !== ident) insist(!sameIdentity(ident, other) && !contained(ident.path, other.path), 'CANDIDATE_BINDINGS_INVALID');
      rememberDirectory(ident);
    }
    return values;
  }
  function bindPrivateRoot(bindings, create = false) {
    // This marker exists only in a synthetic tmp private root. It prevents picking
    // a second authority directory for the same governed fixture data namespace.
    const file = path.join(bindings.privateRoot.path, '.cru21-fixture-authority.json');
    let value;
    if (create && !ops.existsSync(file)) value = writeRecord(file, { schema: 'cru21-fixture-private-authority-v1', mode, runtimeAllowed: false, authorityId, authorityRoot: rootIdentity, privateRoot: bindings.privateRoot });
    else value = readRecord(file);
    insist(value.schema === 'cru21-fixture-private-authority-v1' && value.mode === mode && value.runtimeAllowed === false && value.authorityId === authorityId && sameIdentity(value.authorityRoot, rootIdentity) && sameIdentity(value.privateRoot, bindings.privateRoot), 'CANDIDATE_PRIVATE_AUTHORITY_CHANGED');
  }
  function loadTicket(windowId) {
    assertAuthority();
    const dir = ticketDirectory(windowId); rememberDirectory(directoryIdentity(dir));
    const stored = readRecord(path.join(dir, 'ticket.json'));
    const { recordHash, ...ticket } = stored;
    const { ticketHash, ...body } = ticket;
    insist(ticketHash === hash(body) && ticket.schema === 'cru21-candidate-fixture-ticket-v1' && ticket.mode === mode && ticket.runtimeAllowed === false && ticket.durationMs === DURATION_MS && ticket.authorityId === authorityId && ticket.windowId === windowId && sameIdentity(ticket.authorityRoot, rootIdentity), 'CANDIDATE_TICKET_CHANGED');
    insist(canonical(ticket.product) === canonical(PRODUCT), 'CANDIDATE_TICKET_CHANGED');
    insist(canonical(checkBindings(ticket.bindings)) === canonical(ticket.bindings), 'CANDIDATE_BINDINGS_CHANGED');
    bindPrivateRoot(ticket.bindings);
    const claim = readRecord(path.join(approvalsDir, `${hash(ticket.approvalId)}.json`));
    insist(claim.schema === 'cru21-fixture-approval-claim-v1' && claim.authorityId === authorityId && claim.approvalId === ticket.approvalId && claim.windowId === windowId && claim.ticketHash === ticketHash, 'CANDIDATE_TICKET_CHANGED');
    return deepFreeze(ticket);
  }
  function prepare(args) {
    assertAuthority();
    insist(exactKeys(args, ['approvalId', 'windowId', 'helperHashes', 'binaryHash', 'bindings']), 'CANDIDATE_PREPARE_INVALID');
    const { approvalId, windowId, helperHashes, binaryHash } = args;
    insist(typeof approvalId === 'string' && /^fixture-[A-Za-z0-9-]{1,120}$/.test(approvalId), 'CANDIDATE_FIXTURE_ONLY');
    insist(UUID.test(windowId), 'CANDIDATE_WINDOW_INVALID');
    insist(exactKeys(helperHashes, HELPER_NAMES) && Object.values(helperHashes).every((value) => typeof value === 'string' && HASH.test(value)) && typeof binaryHash === 'string' && HASH.test(binaryHash), 'CANDIDATE_HASH_INVALID');
    const bindings = checkBindings(args.bindings);
    bindPrivateRoot(bindings, true);
    const body = { schema: 'cru21-candidate-fixture-ticket-v1', mode, runtimeAllowed: false, authorityId, authorityRoot: rootIdentity, approvalId, windowId, product: PRODUCT, helperHashes: { ...helperHashes }, binaryHash, bindings, durationMs: DURATION_MS };
    const ticket = { ...body, ticketHash: hash(body) };
    // The fixed authority root owns the approval claim, not each caller-selected window.
    writeRecord(path.join(approvalsDir, `${hash(approvalId)}.json`), { schema: 'cru21-fixture-approval-claim-v1', authorityId, mode, runtimeAllowed: false, approvalId, windowId, ticketHash: ticket.ticketHash });
    const dir = ticketDirectory(windowId);
    try { withParent(dir, (anchored) => ops.mkdirSync(anchored, { mode: 0o700 })); rememberDirectory(directoryIdentity(dir)); syncDir(windowsDir); } catch (error) { poisoned = true; throw error; }
    writeRecord(path.join(dir, 'ticket.json'), ticket);
    return loadTicket(windowId);
  }
  function consume(windowId, times) {
    assertAuthority();
    insist(exactKeys(times, ['wallMs', 'monoMs']) && nonnegative(times.wallMs) && nonnegative(times.monoMs) && Number.isSafeInteger(times.wallMs + DURATION_MS) && Number.isSafeInteger(times.monoMs + DURATION_MS), 'CANDIDATE_CLOCK_INVALID');
    const ticket = loadTicket(windowId), dir = ticketDirectory(windowId);
    const tombstonePath = path.join(approvalsDir, `${hash(ticket.approvalId)}.consumed.json`);
    // This permanent authority-wide record survives window-directory rollback.
    // Unknown or damaged tombstones also deny reuse, without rewriting history.
    insist(!ops.existsSync(tombstonePath), 'CANDIDATE_ALREADY_CONSUMED');
    const guard = writeRecord(guardPath, bound({ schema: 'cru21-fixture-active-guard-v1', stamp: randomUUID() }, windowId, ticket.ticketHash));
    const guardIdentity = statFile(guardPath);
    let uncertain = false, released = false, launch = null, terminal = null;
    const deadline = { wallStartMs: times.wallMs, monoStartMs: times.monoMs, expiresAtMs: times.wallMs + DURATION_MS, durationMs: DURATION_MS };
    const tombstone = writeRecord(tombstonePath, bound({ schema: 'cru21-fixture-consumption-v1', approvalId: ticket.approvalId, ...deadline }, windowId, ticket.ticketHash));
    const intent = writeRecord(path.join(dir, 'intent.json'), bound({ schema: 'cru21-fixture-launch-intent-v1', ...deadline }, windowId, ticket.ticketHash));
    function assertIntact() {
      insist(!released && !uncertain, 'CANDIDATE_LEASE_UNCERTAIN');
      insist(loadTicket(windowId).ticketHash === ticket.ticketHash, 'CANDIDATE_TICKET_CHANGED');
      const current = statFile(guardPath), readGuard = readRecord(guardPath);
      insist(current.dev === guardIdentity.dev && current.ino === guardIdentity.ino && readGuard.recordHash === guard.recordHash && readGuard.stamp === guard.stamp, 'CANDIDATE_GUARD_CHANGED');
      insist(readRecord(path.join(dir, 'intent.json')).recordHash === intent.recordHash, 'CANDIDATE_INTENT_CHANGED');
      insist(readRecord(tombstonePath).recordHash === tombstone.recordHash, 'CANDIDATE_CONSUMPTION_CHANGED');
      if (launch) insist(readRecord(path.join(dir, 'launch.json')).recordHash === launch.recordHash, 'CANDIDATE_RECEIPT_CHANGED');
      if (terminal) insist(readRecord(path.join(dir, 'terminal.json')).recordHash === terminal.recordHash, 'CANDIDATE_RECEIPT_CHANGED');
      return true;
    }
    function perform(action) { try { assertIntact(); return action(); } catch (error) { uncertain = true; throw error; } }
    function recordLaunch(event) {
      return perform(() => {
        insist(!launch && !terminal, 'CANDIDATE_ALREADY_RECORDED');
        insist(exactKeys(event, ['handleId', 'pid', 'windowId', 'head', 'tree']) && UUID.test(event.handleId) && Number.isSafeInteger(event.pid) && event.pid > 0 && event.windowId === windowId && event.head === PRODUCT.head && event.tree === PRODUCT.tree, 'CANDIDATE_LAUNCH_INVALID');
        launch = writeRecord(path.join(dir, 'launch.json'), bound({ schema: 'cru21-fixture-launch-v1', ...event }, windowId, ticket.ticketHash));
        return deepFreeze(launch);
      });
    }
    function recordTerminal(event) {
      return perform(() => {
        insist(!terminal, 'CANDIDATE_ALREADY_RECORDED');
        insist(exactKeys(event, TERMINAL_KEYS) && ['CLOSED', 'UNKNOWN'].includes(event.phase) && typeof event.reason === 'string' && /^[\x20-\x7e]{1,160}$/.test(event.reason) && typeof event.childExited === 'boolean' && (event.portFree === null || typeof event.portFree === 'boolean') && (event.wallMs === null || nonnegative(event.wallMs)) && (event.monoMs === null || nonnegative(event.monoMs)), 'CANDIDATE_TERMINAL_INVALID');
        insist(event.handleId === (launch?.handleId ?? null), 'CANDIDATE_HANDLE_INVALID');
        if (event.phase === 'CLOSED') insist(event.childExited === true && event.portFree === true, 'CANDIDATE_CLEANUP_UNVERIFIED');
        terminal = writeRecord(path.join(dir, 'terminal.json'), bound({ schema: 'cru21-fixture-terminal-v1', ...event }, windowId, ticket.ticketHash));
        return deepFreeze(terminal);
      });
    }
    function markUnknown(event) { return recordTerminal({ ...event, phase: 'UNKNOWN' }); }
    function release() {
      return perform(() => {
        insist(terminal?.phase === 'CLOSED' && terminal.childExited === true && terminal.portFree === true, 'CANDIDATE_CLEANUP_UNVERIFIED');
        // There is no atomic compare-and-unlink primitive here. Seal the lease
        // and retain the global guard permanently; never delete or rename it.
        const current = statFile(guardPath), value = readRecord(guardPath);
        insist(current.dev === guardIdentity.dev && current.ino === guardIdentity.ino && value.recordHash === guard.recordHash && value.stamp === guard.stamp, 'CANDIDATE_GUARD_CHANGED');
        const result = { leaseReleased: true, guardRetained: true, liveReuseAllowed: false };
        writeRecord(path.join(dir, 'lease-sealed.json'), bound({ schema: 'cru21-fixture-lease-sealed-v1', terminalHash: terminal.recordHash, guardHash: guard.recordHash, ...result }, windowId, ticket.ticketHash));
        released = true;
        return deepFreeze(result);
      });
    }
    return Object.freeze({ ticket, intent: deepFreeze(intent), assertIntact, recordLaunch, recordTerminal, markUnknown, release });
  }
  return Object.freeze({ prepare, consume });
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  process.stderr.write(`${JSON.stringify(runtimeGate())}\n`);
  process.exitCode = 2;
}

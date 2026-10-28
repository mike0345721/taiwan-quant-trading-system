/** Maintenance revision of the existing normal-candidate supervisor.
 * This module has NO operating-system process, socket, environment or app adapter.
 * It can exercise a held-handle fixture only; it cannot open an acceptance window.
 */
import { assertObservation } from './normal-guard.mjs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const LIMIT_MS = 900000;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
function reject(code) { const error = new Error(code); error.code = code; throw error; }
function number(value) { return Number.isSafeInteger(value) && value >= 0; }

export function realWindowGate() {
  return Object.freeze({ allowed: false, reasons: Object.freeze([
    'REAL_WINDOW_NOT_AUTHORIZED', 'WINDOWS_HANDLE_AND_PARENT_DEATH_NOT_VERIFIED',
    'WINDOWS_NORMAL_STATUS_READONLY_NOT_VERIFIED', 'PRIOR_OPERATION_SCOPE_UNRESOLVED',
  ]) });
}

/** Run the lifecycle with an explicitly synthetic driver and clock.
 * Capability booleans below describe the fixture, not native Windows evidence.
 */
export async function startFixture({ authority, ticket, observation, clock, driver }) {
  if (driver?.kind !== 'ISOLATED_FIXTURE') reject('FIXTURE_DRIVER_REQUIRED');
  const capabilities = driver.capabilities;
  if (!capabilities?.heldHandle || !capabilities?.parentDeath || !capabilities?.hardDeadline)
    reject('FIXTURE_CONTAINMENT_REQUIRED');
  const methods = ['spawnFixture', 'owns', 'describe', 'exited', 'terminate', 'portFree', 'parentLost'];
  for (const name of methods) if (typeof driver[name] !== 'function') reject('FIXTURE_DRIVER_INVALID');
  if (!clock || typeof clock.wall !== 'function' || typeof clock.mono !== 'function') reject('CLOCK_INVALID');
  const wall = clock.wall.bind(clock), mono = clock.mono.bind(clock);
  const sample = () => { const value = { wallMs: wall(), monoMs: mono() };
    if (!number(value.wallMs) || !number(value.monoMs)) reject('CLOCK_INVALID'); return value; };
  assertObservation(ticket, observation);
  const first = sample();
  // Irreversible durable intent precedes every possible spawn.
  const lease = authority.consume(ticket.windowId, first);
  let handle = null, child = null, parentGone = false, finished = false, stopping = null;
  let lastMono = first.monoMs;
  let state = { phase: 'CONSUMED', reason: null, spawned: false, fixtureOnly: true,
    runtimeAllowed: false, windowId: ticket.windowId, expiresAtMs: lease.intent.expiresAtMs };
  const readState = () => structuredClone(state);
  const unknown = (reason, time = null) => {
    if (parentGone) return readState();
    state = { ...state, phase: 'UNKNOWN', reason };
    finished = true;
    try { lease.markUnknown({ phase: 'UNKNOWN', reason, childExited: false,
      handleId: child?.handleId ?? null, wallMs: time?.wallMs ?? null,
      monoMs: time?.monoMs ?? null, portFree: null }); } catch { /* Keep consumed intent and guard. */ }
    return readState();
  };
  const finish = async (reason, forceUnknown = false) => {
    if (finished || parentGone) return readState();
    if (stopping) return stopping;
    stopping = (async () => {
      let time = null, clockUnverified = false;
      try { time = sample(); } catch { clockUnverified = true; }
      let exited = handle === null;
      if (handle !== null) {
        try {
          if (!driver.owns(handle)) return unknown('OWNED_HANDLE_LOST', time);
          if (!driver.exited(handle)) await driver.terminate(handle, reason);
          exited = driver.owns(handle) && driver.exited(handle);
        } catch { return unknown('CHILD_EXIT_UNVERIFIED', time); }
      }
      if (parentGone) return readState();
      if (!exited) return unknown('CHILD_EXIT_UNVERIFIED', time);
      // Completion evidence must describe the time AFTER the awaited stop.
      // A dead parent or a failed/newly regressing clock cannot certify closure.
      try { time = sample(); } catch { clockUnverified = true; }
      if (clockUnverified) return unknown('CLOCK_UNVERIFIED', time);
      if (time.monoMs < lastMono) return unknown('CLOCK_UNVERIFIED', time);
      if (handle !== null && (time.wallMs > lease.intent.expiresAtMs ||
          time.monoMs - lease.intent.monoStartMs > LIMIT_MS))
        return unknown('DEADLINE_EXIT_UNVERIFIED', time);
      if (forceUnknown) return unknown(reason, time);
      let free;
      try { free = handle === null ? true : driver.portFree(handle); }
      catch { return unknown('CANDIDATE_LISTENER_UNVERIFIED', time); }
      if (free !== true) return unknown('CANDIDATE_LISTENER_UNVERIFIED', time);
      try {
        lease.assertIntact();
        lease.recordTerminal({ phase: 'CLOSED', reason, childExited: true,
          handleId: child?.handleId ?? null, wallMs: time.wallMs, monoMs: time.monoMs, portFree: true });
        const closure = lease.release();
        if (closure?.leaseReleased !== true || closure?.guardRetained !== true || closure?.liveReuseAllowed !== false)
          reject('FIXTURE_CLOSURE_SEAL_UNVERIFIED');
      } catch { return unknown('TERMINAL_RECEIPT_UNVERIFIED', time); }
      state = { ...state, phase: 'CLOSED', reason, guardRetained: true, authorityReusable: false };
      finished = true;
      return readState();
    })();
    return stopping;
  };
  const deadlineReason = time => {
    if (time.monoMs < lastMono) return 'MONOTONIC_REGRESSION';
    lastMono = time.monoMs;
    if (time.wallMs >= lease.intent.expiresAtMs || time.monoMs - lease.intent.monoStartMs >= LIMIT_MS)
      return 'DEADLINE';
    return null;
  };
  const controller = Object.freeze({
    state: readState,
    async check() {
      if (finished || parentGone) return readState();
      let time;
      try { lease.assertIntact(); time = sample(); }
      catch { return finish('INTEGRITY_OR_CLOCK_UNVERIFIED', true); }
      const reason = deadlineReason(time);
      if (reason) return finish(reason);
      if (handle !== null) {
        try {
          if (!driver.owns(handle)) return unknown('OWNED_HANDLE_LOST', time);
          if (driver.exited(handle)) return finish('CHILD_EXIT');
        } catch { return unknown('CHILD_EXIT_UNVERIFIED', time); }
      }
      return readState();
    },
    stop: () => finish('CANCELLED'),
    // Explicit fault injection. The dead parent cannot write a closed receipt.
    async simulateParentLoss() {
      if (finished || parentGone) return readState();
      parentGone = true;
      try { if (handle !== null) await driver.parentLost(handle); }
      finally { state = { ...state, phase: 'PARENT_LOST', reason: 'NO_TERMINAL_RECEIPT' }; }
      return readState();
    },
  });
  try {
    assertObservation(lease.ticket, observation);
    if (JSON.stringify(lease.ticket) !== JSON.stringify(ticket)) reject('TICKET_CHANGED');
    const intent = lease.intent;
    if (intent.durationMs !== LIMIT_MS || intent.wallStartMs !== first.wallMs ||
        intent.monoStartMs !== first.monoMs || intent.expiresAtMs !== first.wallMs + LIMIT_MS)
      reject('INTENT_DEADLINE_INVALID');
    lease.assertIntact();
    const time = sample(), reason = deadlineReason(time);
    if (reason) { await finish('EXPIRED_BEFORE_START'); return controller; }
    handle = await driver.spawnFixture(Object.freeze({ windowId: ticket.windowId,
      head: ticket.product.head, tree: ticket.product.tree,
      wallDeadlineMs: intent.expiresAtMs, monoDeadlineMs: first.monoMs + LIMIT_MS }));
    state = { ...state, spawned: true };
    if (!handle || !driver.owns(handle)) return (unknown('SPAWN_HANDLE_UNVERIFIED'), controller);
    child = Object.freeze(structuredClone(driver.describe(handle)));
    if (!uuid.test(child?.handleId ?? '') || !Number.isSafeInteger(child?.pid) || child.pid <= 0 ||
        child.windowId !== ticket.windowId || child.head !== ticket.product.head || child.tree !== ticket.product.tree)
      reject('CHILD_HANDSHAKE_REJECTED');
    lease.recordLaunch({ handleId: child.handleId, pid: child.pid, windowId: ticket.windowId,
      head: child.head, tree: child.tree });
    lease.assertIntact();
    state = { ...state, phase: 'RUNNING' };
    await controller.check();
  } catch (error) {
    // A failed/uncertain launch consumes the ticket and never triggers a retry.
    await finish(error.code ?? 'START_FAILED', true);
  }
  return controller;
}

// Even direct invocation must not be usable as a live launcher.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  process.stderr.write('REAL_WINDOW_HOLD: fixture-only maintenance; no process adapter installed.\n');
  process.exitCode = 2;
}

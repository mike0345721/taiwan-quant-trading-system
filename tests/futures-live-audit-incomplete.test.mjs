import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { evaluateLiveEventAcceptance } from '../src/live-event-ledger.mjs';

// Execute only the actual script's pure acceptance assembly. Its top-level
// readiness reads, ledger audit, network requests and report writes never run.
const script = fs.readFileSync(new URL('../scripts/audit-futures-live-event-ledger.mjs', import.meta.url), 'utf8');
const start = script.indexOf('const requiredKindCounts =');
const end = script.indexOf('\nconst report =', start);
assert.ok(start >= 0 && end > start);
const assembly = script.slice(start, end) + '\nglobalThis.acceptanceResult = acceptance;';
const healthStart = script.indexOf('operationalHealth = {');
const healthEnd = script.indexOf('};', healthStart) + 2;
assert.ok(healthStart >= 0 && healthEnd > healthStart);
const healthProjection = script.slice(healthStart, healthEnd);
const genericScript = fs.readFileSync(new URL('../scripts/audit-live-event-ledger.mjs', import.meta.url), 'utf8');
const genericHealthStart = genericScript.indexOf('operationalHealth = {');
const genericHealthEnd = genericScript.indexOf('};', genericHealthStart) + 2;
assert.ok(genericHealthStart >= 0 && genericHealthEnd > genericHealthStart);
const genericHealthProjection = genericScript.slice(genericHealthStart, genericHealthEnd);
const requiredProducts = ['TXFK6', 'MXFK6', 'TMFK6'];
const healthy = { callbackErrors: 0, dropped: 0, writerErrors: 0, executionAuthorized: false, orderRoutesEnabled: false };
const incomplete = { ok: false, auditState: 'AUDIT_INCOMPLETE', reason: 'ledger_audit_size_limit',
  events: null, latestHash: null, bytes: 3_000_000_000, bytesRead: 0, maxAuditBytes: 64 * 1024 * 1024 };
function assemble(ledgerAudit, operationalHealth = healthy, baseAcceptance = evaluateLiveEventAcceptance(ledgerAudit, { requiredProducts, operationalHealth })) {
  const context = { ledgerAudit, operationalHealth, baseAcceptance, requiredProducts };
  vm.runInNewContext(assembly, context);
  return JSON.parse(JSON.stringify(context.acceptanceResult));
}
function projectHealth(ledgerAudit, health, projection = healthProjection) {
  const context = { ledgerAudit, health, operationalHealth: null };
  vm.runInNewContext(projection, context);
  return context.operationalHealth;
}
function assertUnknownSourceFacts(result) {
  for (const counts of [result.requiredKindCounts, result.postRestartKindCounts]) {
    for (const product of requiredProducts) assert.deepEqual(counts[product], { tick: null, bidAsk: null });
  }
  for (const key of ['ready', 'durationMs', 'maxGapMs', 'clockSkewEvents', 'productStats', 'productKindStats']) assert.equal(result.completedSession[key], null, key);
  for (const key of ['requiredProductDurationMs', 'requiredProductMaxGapMs', 'acceptanceClockSkewEvents', 'globalLedgerClockSkewEvents']) assert.equal(result.evidence[key], null, key);
  for (const key of ['integrity', 'requiredProducts', 'timing', 'tickAndBidAsk', 'cleanCompletedSession', 'postRestartTickAndBidAsk']) assert.equal(result.checks[key], null, key);
  assert.equal(result.reasons.some(reason => /(?:futures_tick_missing|futures_bidask_missing|clean_completed_session_missing)/.test(reason)), false);
  assert.ok(result.pendingReasons.includes('ledger_audit_size_limit'));
  assert.equal(result.passed, false);
}

test('futures wrapper preserves incomplete audit unknowns without inventing missing quote evidence', () => {
  const result = assemble(incomplete);
  assert.equal(result.status, 'PENDING');
  assert.deepEqual(result.reasons, ['ledger_audit_size_limit']);
  assert.equal(result.checks.executionBoundary, true);
  assertUnknownSourceFacts(result);
});

test('futures wrapper retains independent operational failure while quote evidence is unknown', () => {
  const result = assemble(incomplete, { ...healthy, writerErrors: 1 });
  assert.equal(result.status, 'FAIL');
  assert.ok(result.failReasons.includes('writer_error_detected'));
  assertUnknownSourceFacts(result);
});

test('futures wrapper retains execution-boundary failure while quote evidence is unknown', () => {
  for (const operationalHealth of [null, { ...healthy, executionAuthorized: true }, { ...healthy, orderRoutesEnabled: true }]) {
    const result = assemble(incomplete, operationalHealth);
    assert.equal(result.status, 'FAIL');
    assert.ok(result.failReasons.includes('execution_boundary_invalid'));
    assert.notEqual(result.checks.executionBoundary, true);
    assertUnknownSourceFacts(result);
  }
});

test('actual health projection preserves invalid counters through incomplete acceptance assembly', () => {
  for (const value of [undefined, null, '', '0', '1', false, true, NaN, Infinity, -1]) {
    const raw = { ...healthy, callbackErrors: value, dropped: value, writerErrors: value };
    const result = assemble(incomplete, projectHealth(incomplete, raw));
    assert.equal(result.status, 'PENDING', String(value));
    assert.ok(result.pendingReasons.includes('operational_health_evidence_missing'), String(value));
    for (const key of ['callbackErrors', 'dropped', 'writerErrors']) assert.equal(result.checks[key], null, `${key}/${String(value)}`);
    assertUnknownSourceFacts(result);
  }
  const known = assemble(incomplete, projectHealth(incomplete, { ...healthy, dropped: 1 }));
  assert.equal(known.status, 'FAIL'); assert.ok(known.failReasons.includes('queue_drop_detected'));
  assert.equal(known.checks.dropped, false);
  // Preserve the existing normal-audit adapter behavior outside this new state.
  assert.equal(projectHealth({ ok: true }, { ...healthy, dropped: null }).dropped, 0);
});

test('daily audit wrapper actual health projection also preserves unknown counters only in the new incomplete state', () => {
  for (const value of [undefined, null, '', '0', '1', false, true, NaN, Infinity, -1]) {
    const raw = { ...healthy, callbackErrors: value, dropped: value, writerErrors: value };
    const operationalHealth = projectHealth(incomplete, raw, genericHealthProjection);
    const result = evaluateLiveEventAcceptance(incomplete, { operationalHealth });
    assert.equal(result.status, 'PENDING', String(value));
    assert.ok(result.pendingReasons.includes('operational_health_evidence_missing'), String(value));
    for (const key of ['callbackErrors', 'dropped', 'writerErrors']) assert.equal(result.checks[key], null, `${key}/${String(value)}`);
  }
  const operationalHealth = projectHealth(incomplete, { ...healthy, callbackErrors: 1 }, genericHealthProjection);
  const known = evaluateLiveEventAcceptance(incomplete, { operationalHealth });
  assert.equal(known.status, 'FAIL'); assert.ok(known.failReasons.includes('callback_error_detected'));
  assert.equal(known.checks.callbackErrors, false);
  assert.equal(projectHealth({ ok: true }, { ...healthy, dropped: null }, genericHealthProjection).dropped, 0);
});

test('futures wrapper retains the existing completed-small-audit decision and measured counts', () => {
  const kinds = Object.fromEntries(requiredProducts.map(product => [product, { futures_tick: 101, futures_bidask: 20 }]));
  const stats = Object.fromEntries(requiredProducts.map(product => [product, { events: 121,
    firstReceivedAt: '2026-11-03T01:00:00Z', lastReceivedAt: '2026-11-03T01:31:00Z', maxInterEventGapMs: 1000, clockSkewEvents: 0 }]));
  const audit = { ok: true, productKindStats: kinds, postReconnectProductKindStats: kinds,
    latestCompletedReconnectProductStats: stats, latestCompletedReconnectProductKindStats: kinds, regularSessionClockSkewEvents: 0 };
  const base = { status: 'PASS', passed: true, failReasons: [], pendingReasons: [], evidence: {}, checks: { integrity: true } };
  const result = assemble(audit, healthy, base);
  assert.equal(result.status, 'PASS'); assert.equal(result.passed, true);
  assert.deepEqual(result.requiredKindCounts.TXFK6, { tick: 101, bidAsk: 20 });
  assert.equal(result.completedSession.durationMs, 31 * 60_000);
  assert.equal(result.checks.tickAndBidAsk, true); assert.equal(result.checks.cleanCompletedSession, true);
});

test('ordinary audited missing-kind behavior remains explicit outside the new incomplete state', () => {
  const base = { status: 'PENDING', passed: false, failReasons: [], pendingReasons: [], evidence: {}, checks: { integrity: true } };
  const result = assemble({ ok: true }, healthy, base);
  assert.equal(result.status, 'PENDING');
  assert.ok(result.pendingReasons.includes('futures_tick_missing:TXFK6'));
  assert.deepEqual(result.requiredKindCounts.TXFK6, { tick: 0, bidAsk: 0 });
});

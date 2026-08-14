import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  CONTINUITY_REASONS,
  CONTINUITY_STATES,
  CONTINUITY_RETRY_POLICY,
  CONTINUITY_SAFETY,
  acquireContinuityLock,
  buildContinuityStatus,
  classifyBridgeFailure,
  evaluateBridgeContinuity,
  recoveryDecision,
  recoveryBudgetResetEligible,
  writeContinuityStatusAtomic,
} from '../src/shioaji-market-data-continuity.mjs';
import { acquireSupervisorPort, governedMarketSession, runContinuitySupervisor } from '../scripts/run-shioaji-market-data-continuity.mjs';
import { inspectContinuityStatus } from '../scripts/project-status.mjs';
import { buildDataHealthContract } from '../src/dashboard-data-health.mjs';

const subscriptions = [
  { product: 'TX', state: 'RESTORED', quoteTypes: ['Tick', 'BidAsk'], actualContract: 'TXFH6' },
  { product: 'MTX', state: 'RESTORED', quoteTypes: ['Tick', 'BidAsk'], actualContract: 'MXFH6' },
  { product: 'TMF', state: 'RESTORED', quoteTypes: ['Tick', 'BidAsk'], actualContract: 'TMFH6' },
  { product: '2330', state: 'RESTORED', quoteTypes: ['Tick'], actualContract: '2330' },
  { product: 'IX0001', state: 'RESTORED', quoteTypes: ['Quote'], actualContract: 'IX0001' },
];

function health(overrides = {}) {
  return {
    ok: true,
    provider: 'shioaji',
    mode: 'market_data_only',
    executionAuthorized: false,
    orderRoutesEnabled: false,
    bridgeState: 'HEALTHY',
    writerState: 'PASS',
    writerErrors: 0,
    lowDisk: false,
    requiredSubscriptions: subscriptions,
    latestReceivedAt: '2026-08-14T01:00:01.000Z',
    timestampLineageState: 'QUALITY_INSUFFICIENT',
    ...overrides,
  };
}

test('unexpected session termination is precisely detected while unknown exits remain unknown', () => {
  assert.equal(classifyBridgeFailure({ exitCode: 75 }), 'SESSION_TERMINATED');
  assert.equal(classifyBridgeFailure({ exitCode: 77 }), 'AUTH_OR_TOKEN_FAILURE');
  assert.equal(classifyBridgeFailure({ exitCode: 78 }), 'NETWORK_UNAVAILABLE');
  assert.equal(classifyBridgeFailure({ exitCode: 79 }), 'SUBSCRIPTION_RESTORE_FAILED');
  assert.equal(classifyBridgeFailure({ exitCode: 80 }), 'LOGIN_FAILED');
  assert.equal(classifyBridgeFailure({ exitCode: 1 }), 'UNKNOWN_INSUFFICIENT_EVIDENCE');
});

test('bounded state and reason contracts include every Owner-approved continuity outcome', () => {
  for (const state of ['HEALTHY', 'STARTING', 'DEGRADED', 'RECOVERING', 'RECOVERY_FAILED', 'STOPPED_EXPECTED', 'UNAVAILABLE', 'UNKNOWN']) {
    assert.ok(CONTINUITY_STATES.includes(state), state);
  }
  for (const reason of [
    'BRIDGE_NOT_RUNNING', 'BRIDGE_HEALTH_UNAVAILABLE', 'SESSION_TERMINATED', 'LOGIN_FAILED',
    'AUTH_OR_TOKEN_FAILURE', 'NETWORK_UNAVAILABLE', 'SUBSCRIPTION_RESTORE_FAILED',
    'WRITER_UNAVAILABLE', 'PORT_OCCUPIED_HEALTHY', 'PORT_OCCUPIED_UNHEALTHY',
    'DUPLICATE_INSTANCE_DETECTED', 'RECOVERY_BUDGET_EXHAUSTED', 'EXPECTED_STOP',
    'UNKNOWN_INSUFFICIENT_EVIDENCE',
  ]) assert.ok(CONTINUITY_REASONS.includes(reason), reason);
});

test('expected stop never requests a restart', () => {
  assert.deepEqual(recoveryDecision({ expectedStop: true }), { action: 'STOP', state: 'STOPPED_EXPECTED', reasonCode: 'EXPECTED_STOP' });
});

test('candidate runner is default-off and cannot activate without the two-part Owner gate', () => {
  const result = spawnSync(process.execPath, ['scripts/run-shioaji-market-data-continuity.mjs'], {
    cwd: path.dirname(fileURLToPath(new URL('../package.json', import.meta.url))),
    encoding: 'utf8',
    env: { ...process.env, SHIOAJI_CONTINUITY_ACTIVATION_APPROVED: 'false' },
  });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.state, 'NOT_ACTIVE');
  assert.equal(output.executionAuthorized, false);
  assert.equal(output.orderRoutesEnabled, false);
});

test('single-instance lock rejects a live owner and safely replaces a stale lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-lock-'));
  const lockPath = path.join(root, 'supervisor.lock');
  const first = acquireContinuityLock(lockPath, { pid: 111, isProcessAlive: (pid) => pid === 111 });
  assert.throws(() => acquireContinuityLock(lockPath, { pid: 222, isProcessAlive: (pid) => pid === 111 }), /DUPLICATE_INSTANCE_DETECTED/);
  first.release();
  fs.writeFileSync(lockPath, JSON.stringify({ pid: 333 }));
  const replacement = acquireContinuityLock(lockPath, { pid: 444, isProcessAlive: () => false });
  assert.equal(JSON.parse(fs.readFileSync(lockPath, 'utf8')).pid, 444);
  replacement.release();
});

test('OS loopback port guard prevents two supervisors even if filesystem lock races', async () => {
  const first = await acquireSupervisorPort('127.0.0.1', 0);
  await assert.rejects(() => acquireSupervisorPort('127.0.0.1', first.port), /DUPLICATE_INSTANCE_DETECTED/);
  await first.close();
});

test('healthy occupied port is reused and unhealthy occupied port fails closed', () => {
  const healthy = recoveryDecision({ healthPayload: health(), portOccupied: true });
  assert.equal(healthy.action, 'REUSE');
  assert.equal(healthy.reasonCode, 'PORT_OCCUPIED_HEALTHY');
  const unsafe = recoveryDecision({ healthPayload: null, portOccupied: true });
  assert.equal(unsafe.action, 'FAIL_CLOSED');
  assert.equal(unsafe.reasonCode, 'PORT_OCCUPIED_UNHEALTHY');
});

test('bounded retry exposes exact attempts, backoff, exhaustion and cooldown', () => {
  assert.deepEqual(CONTINUITY_RETRY_POLICY.attemptDelaysMs, [0, 5_000, 20_000]);
  assert.equal(CONTINUITY_RETRY_POLICY.maxAttempts, 3);
  assert.equal(CONTINUITY_RETRY_POLICY.cooldownMs, 900_000);
  for (let attemptsUsed = 0; attemptsUsed < 3; attemptsUsed += 1) {
    const decision = recoveryDecision({ healthPayload: null, portOccupied: false, attemptsUsed });
    assert.equal(decision.action, 'START_RECOVERY');
    assert.equal(decision.attempt, attemptsUsed + 1);
  }
  assert.equal(recoveryDecision({ healthPayload: null, attemptsUsed: 3 }).action, 'ENTER_COOLDOWN');
  assert.equal(recoveryDecision({ healthPayload: null, attemptsUsed: 3, cooldownUntil: '2026-08-14T01:15:00Z', now: new Date('2026-08-14T01:05:00Z') }).action, 'WAIT_COOLDOWN');
  assert.equal(recoveryBudgetResetEligible('2026-08-14T01:00:00Z', new Date('2026-08-14T01:04:59Z')), false);
  assert.equal(recoveryBudgetResetEligible('2026-08-14T01:00:00Z', new Date('2026-08-14T01:05:00Z')), true);
});

test('all required subscriptions and writer PASS are required for HEALTHY', () => {
  assert.equal(evaluateBridgeContinuity(health()).state, 'HEALTHY');
  const partial = health({ requiredSubscriptions: subscriptions.map((item) => item.product === 'TMF' ? { ...item, state: 'FAILED' } : item) });
  assert.deepEqual(evaluateBridgeContinuity(partial), {
    state: 'DEGRADED', reasonCode: 'SUBSCRIPTION_RESTORE_FAILED', subscriptionStatus: 'PARTIAL', writerStatus: 'PASS',
    dataTrust: 'QUALITY_INSUFFICIENT', dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
  });
  assert.equal(evaluateBridgeContinuity(health({ writerState: 'FAIL', writerErrors: 1 })).reasonCode, 'WRITER_UNAVAILABLE');
  assert.equal(evaluateBridgeContinuity(null).reasonCode, 'BRIDGE_HEALTH_UNAVAILABLE');
});

test('writer failure on an occupied bridge port fails closed without spawning a restart storm', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-writer-gate-'));
  let spawns = 0;
  let waits = 0;
  const statuses = [];
  await runContinuitySupervisor({
    root,
    healthProbe: async () => health({ writerState: 'FAIL', writerErrors: 1 }),
    occupiedProbe: async () => true,
    bridgeSpawner: () => { spawns += 1; return new EventEmitter(); },
    wait: async () => { waits += 1; },
    onStatus: (status) => statuses.push(status),
    maxCycles: 3,
  });
  assert.equal(spawns, 0);
  assert.equal(waits, 3);
  assert.equal(statuses.length, 3);
  assert.ok(statuses.every((status) => status.state === 'UNAVAILABLE'));
  assert.ok(statuses.every((status) => status.reasonCode === 'PORT_OCCUPIED_UNHEALTHY'));
});

test('auth and network failures are bounded reason codes without raw secrets', () => {
  assert.equal(classifyBridgeFailure({ errorText: 'API key credential rejected token=secret' }), 'AUTH_OR_TOKEN_FAILURE');
  assert.equal(classifyBridgeFailure({ errorText: 'login failed: unauthorized' }), 'LOGIN_FAILED');
  assert.equal(classifyBridgeFailure({ errorText: 'socket network timeout' }), 'NETWORK_UNAVAILABLE');
  const status = JSON.stringify(buildContinuityStatus({ state: 'RECOVERY_FAILED', reasonCode: 'AUTH_OR_TOKEN_FAILURE' }));
  assert.doesNotMatch(status, /token=secret|api.?key credential rejected/i);
});

test('market-closed readiness does not wait for a fake tick', () => {
  const calendar = { tradingDates: new Set(['2026-08-14']), nonTradingDates: new Set(), exceptions: new Map(), payload: {}, fileHash: 'x' };
  const closed = governedMarketSession(new Date('2026-08-14T06:00:00.000Z'), calendar); // 14:00 TPE
  assert.deepEqual(closed, { state: 'SESSION_CLOSED', marketShouldBeActive: false });
  assert.equal(evaluateBridgeContinuity(health({ latestReceivedAt: null }), { marketShouldBeActive: false, recoveryStartedAt: '2026-08-14T05:59:00Z' }).state, 'HEALTHY');
  assert.equal(evaluateBridgeContinuity(health({ latestReceivedAt: null }), { marketShouldBeActive: true, recoveryStartedAt: '2026-08-14T05:59:00Z' }).reasonCode, 'DATA_RESUME_NOT_OBSERVED');
});

test('governed market-open readiness requires post-recovery evidence while non-market hours do not', () => {
  const calendar = { tradingDates: new Set(['2026-08-14']), nonTradingDates: new Set(), exceptions: new Map(), payload: {}, fileHash: 'x' };
  assert.deepEqual(governedMarketSession(new Date('2026-08-14T00:45:00.000Z'), calendar), { state: 'DAY', marketShouldBeActive: true });
  assert.deepEqual(governedMarketSession(new Date('2026-08-14T07:00:00.000Z'), calendar), { state: 'NIGHT', marketShouldBeActive: true });
  const forming = evaluateBridgeContinuity(health({ latestReceivedAt: '2026-08-14T00:44:59.000Z' }), {
    marketShouldBeActive: true,
    recoveryStartedAt: '2026-08-14T00:45:00.000Z',
  });
  assert.equal(forming.state, 'STARTING');
  assert.equal(forming.reasonCode, 'DATA_RESUME_NOT_OBSERVED');
});

test('supervisor recovers through a synthetic child without touching live port or ledger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-supervisor-'));
  let clock = Date.parse('2026-08-14T00:00:00Z');
  let probes = 0;
  let spawns = 0;
  const statuses = [];
  const child = new EventEmitter(); child.killed = false; child.kill = () => { child.killed = true; };
  const before = fs.readdirSync(root);
  await runContinuitySupervisor({
    root,
    now: () => new Date(clock),
    wait: async (milliseconds) => { clock += Math.max(1, milliseconds); },
    healthProbe: async () => { probes += 1; if (probes < 2) throw new Error('offline'); return health({ latestReceivedAt: '2026-08-14T00:00:10Z' }); },
    occupiedProbe: async () => false,
    bridgeSpawner: () => { spawns += 1; return child; },
    onStatus: (status) => statuses.push(status),
    maxCycles: 2,
  });
  assert.equal(spawns, 1);
  assert.ok(statuses.some((status) => status.state === 'RECOVERING'));
  assert.ok(statuses.some((status) => status.state === 'HEALTHY'));
  assert.equal(fs.existsSync(path.join(root, 'data', 'live-events')), false);
  assert.deepEqual(before, []);
});

test('continuity status remains allowlisted, fail-closed and packet-loss uncertainty is preserved', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'continuity-status-'));
  const filePath = path.join(root, 'data', 'runtime', 'shioaji-continuity', 'status.json');
  writeContinuityStatusAtomic(filePath, {
    state: 'DEGRADED', reasonCode: 'SESSION_TERMINATED', requiredSubscriptions: subscriptions,
    writerStatus: 'PASS', dataTrust: 'QUALITY_INSUFFICIENT', secretKey: 'must-not-appear', account: 'must-not-appear',
  });
  const raw = fs.readFileSync(filePath, 'utf8');
  assert.doesNotMatch(raw, /must-not-appear|secretKey|account/);
  const inspected = inspectContinuityStatus(root);
  assert.equal(inspected.state, 'DEGRADED');
  assert.equal(inspected.dataLossCertainty, 'UNKNOWN_NO_NATIVE_SEQUENCE');
  assert.equal(inspected.timestampLineageState, 'QUALITY_INSUFFICIENT');
  assert.equal(JSON.stringify(inspected).includes('secret'), false);
});

test('Dashboard minimal Data Health rendering does not show false green', () => {
  const bridge = {
    connected: false, safetyVerified: true, latestReceivedAt: '2026-08-14T01:00:00Z',
    continuity: { state: 'DEGRADED', reasonCode: 'SESSION_TERMINATED', requiredSubscriptions: subscriptions, writerStatus: 'PASS', dataTrust: 'QUALITY_INSUFFICIENT' },
  };
  const contract = buildDataHealthContract({ snapshot: { sources: {} }, service: { brokerMarketData: bridge }, now: new Date('2026-08-14T01:00:30Z') });
  const continuity = contract.items.find((item) => item.sourceId === 'shioajiContinuity');
  assert.equal(continuity.freshnessState, 'UNAVAILABLE');
  assert.equal(continuity.reason, 'SESSION_TERMINATED');
  assert.equal(continuity.readinessState, 'QUALITY_INSUFFICIENT');
  assert.equal(contract.executionAuthorized, false);
  const connectedButLineageInsufficient = buildDataHealthContract({
    snapshot: { sources: {} },
    service: { brokerMarketData: { ...bridge, connected: true, continuity: { ...bridge.continuity, state: 'HEALTHY' } } },
    now: new Date('2026-08-14T01:00:30Z'),
  }).items.find((item) => item.sourceId === 'shioajiContinuity');
  assert.equal(connectedButLineageInsufficient.readinessState, 'QUALITY_INSUFFICIENT');
  assert.equal(connectedButLineageInsufficient.reason, 'TIMESTAMP_LINEAGE_INSUFFICIENT');
});

test('safety boundary and source contract never create broker or order authority', () => {
  assert.deepEqual(CONTINUITY_SAFETY, {
    formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false, runtimeMode: 'market_data_only',
  });
  const source = [
    fs.readFileSync(new URL('../src/shioaji-market-data-continuity.mjs', import.meta.url), 'utf8'),
    fs.readFileSync(new URL('../scripts/run-shioaji-market-data-continuity.mjs', import.meta.url), 'utf8'),
  ].join('\n');
  assert.doesNotMatch(source, /place_order|cancel_order|api\.place_order|executionAuthorized:\s*true|orderRoutesEnabled:\s*true/);
});

test('bridge health source retains session exit code, subscription and writer evidence without changing callbacks', () => {
  const source = fs.readFileSync(new URL('../broker/shioaji_readonly_bridge.py', import.meta.url), 'utf8');
  assert.match(source, /exit_code = 75/);
  assert.match(source, /raise SystemExit\(76\)/);
  assert.match(source, /"requiredSubscriptions": subscriptions/);
  assert.match(source, /"writerState": writer_state/);
  assert.match(source, /"dataLossCertainty": "UNKNOWN_NO_NATIVE_SEQUENCE"/);
  assert.match(source, /"timestampLineageState": "QUALITY_INSUFFICIENT"/);
  for (const token of ['TXFR1', 'MXFR1', 'TMFR1', '2330', 'IX0001']) assert.match(source, new RegExp(token));
});

test('Chinese-first Dashboard keeps technical reason codes in detail', () => {
  const source = fs.readFileSync(new URL('../public/app.js', import.meta.url), 'utf8');
  assert.match(source, /SESSION_TERMINATED: '行情連線已中斷'/);
  assert.match(source, /Shioaji 即時行情持續性/);
  assert.match(source, /dwHumanize\(item\.reason\).*item\.reason/);
});

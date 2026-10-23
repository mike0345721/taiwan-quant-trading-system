import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import process from 'node:process';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  CONTINUITY_RETRY_POLICY,
  acquireContinuityLock,
  buildContinuityStatus,
  classifyBridgeFailure,
  evaluateBridgeContinuity,
  recoveryBudgetResetEligible,
  recoveryDecision,
  writeContinuityStatusAtomic,
} from '../src/shioaji-market-data-continuity.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { assessTaifexMarketSession } from '../src/taifex-market-operation.mjs';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.dirname(SCRIPT_DIR);
const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

export function acquireSupervisorPort(host = '127.0.0.1', port = 8791) {
  return new Promise((resolve, reject) => {
    const server = net.createServer((socket) => socket.destroy());
    server.once('error', (error) => reject(error?.code === 'EADDRINUSE' ? new Error('DUPLICATE_INSTANCE_DETECTED') : error));
    server.listen(port, host, () => resolve(Object.freeze({
      host,
      port: server.address().port,
      close: () => new Promise((done) => server.close(done)),
    })));
  });
}

export function governedMarketSession(now, calendar) {
  return assessTaifexMarketSession(now, calendar);
}

async function fetchHealth(baseUrl, timeoutMs = 1_200) {
  const response = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(timeoutMs), headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`BRIDGE_HEALTH_HTTP_${response.status}`);
  return response.json();
}

function portOccupied(host, port, timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    const finish = (result) => { socket.destroy(); resolve(result); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

function sanitizedStatus(input) {
  return buildContinuityStatus(input);
}

export async function runContinuitySupervisor({
  root = DEFAULT_ROOT,
  healthBaseUrl = 'http://127.0.0.1:8790',
  host = '127.0.0.1',
  port = 8790,
  now = () => new Date(),
  wait = sleep,
  healthProbe = fetchHealth,
  occupiedProbe = portOccupied,
  bridgeSpawner = null,
  onStatus = () => {},
  stopSignal = { requested: false },
  calendar = null,
  maxCycles = Infinity,
} = {}) {
  const resolvedRoot = path.resolve(root);
  const statusPath = path.join(resolvedRoot, 'data', 'runtime', 'shioaji-continuity', 'status.json');
  const logDirectory = path.join(resolvedRoot, 'data', 'automation-logs');
  fs.mkdirSync(logDirectory, { recursive: true });
  let ownedChild = null;
  let attemptsUsed = 0;
  let cooldownUntil = null;
  let lastHealthyAt = null;
  let healthySince = null;
  let failureDetectedAt = null;
  let recoveryStartedAt = null;
  let bridgeReadyAt = null;
  let subscriptionReadyAt = null;
  let writerReadyAt = null;
  let observedDataResumeAt = null;
  let lastFailureReason = 'BRIDGE_NOT_RUNNING';
  let cycles = 0;
  const emit = (status) => {
    const normalized = writeContinuityStatusAtomic(statusPath, sanitizedStatus({
      ...status, lastHealthyAt, failureDetectedAt, recoveryStartedAt, capturedAt: now().toISOString(),
      bridgeReadyAt, subscriptionReadyAt, writerReadyAt, observedDataResumeAt,
    }));
    onStatus(normalized);
    return normalized;
  };
  const spawnBridge = bridgeSpawner || (() => {
    const stdout = fs.openSync(path.join(logDirectory, 'shioaji-continuity-bridge.log'), 'a');
    const stderr = fs.openSync(path.join(logDirectory, 'shioaji-continuity-bridge-error.log'), 'a');
    try {
      return spawn('python', [path.join(resolvedRoot, 'broker', 'shioaji_readonly_bridge.py')], {
        cwd: resolvedRoot,
        env: { ...process.env, SHIOAJI_CONTINUITY_MANAGED: 'true' },
        windowsHide: true,
        stdio: ['ignore', stdout, stderr],
      });
    } finally {
      fs.closeSync(stdout);
      fs.closeSync(stderr);
    }
  });

  while (!stopSignal.requested && cycles < maxCycles) {
    cycles += 1;
    let healthPayload = null;
    try { healthPayload = await healthProbe(healthBaseUrl); } catch { healthPayload = null; }
    const session = calendar ? governedMarketSession(now(), calendar) : { state: 'UNAVAILABLE', marketShouldBeActive: false };
    const evaluated = evaluateBridgeContinuity(healthPayload, { marketShouldBeActive: false, recoveryStartedAt });
    // An exchange-confirmed closure is not a streaming outage. Never spend a
    // login/recovery attempt on missing Tick/BidAsk while trading is suspended.
    // Preserve the fail-closed unsafe-runtime gate even on market holidays.
    if (session.state === 'MARKET_CLOSED' || (calendar && session.state === 'UNAVAILABLE')) {
      const calendarUnknown = session.state === 'UNAVAILABLE';
      const unsafe = evaluated.reasonCode === 'UNSAFE_RUNTIME_RESPONSE';
      emit({
        state: unsafe || calendarUnknown ? 'UNAVAILABLE' : 'MARKET_CLOSED',
        reasonCode: unsafe ? 'UNSAFE_RUNTIME_RESPONSE'
          : calendarUnknown ? 'CALENDAR_UNVERIFIED' : 'MARKET_CLOSED_EXPECTED',
        recoveryAttempt: attemptsUsed,
        recoveryResult: 'NO_RETRY_EXCHANGE_CALENDAR',
        writerStatus: evaluated.writerStatus,
        requiredSubscriptions: healthPayload?.requiredSubscriptions,
        operatingSession: session,
      });
      await wait(CONTINUITY_RETRY_POLICY.healthPollMs);
      continue;
    }
    if (evaluated.state === 'HEALTHY') {
      const current = now();
      if (recoveryStartedAt) {
        bridgeReadyAt ||= current.toISOString();
        subscriptionReadyAt ||= current.toISOString();
        writerReadyAt ||= current.toISOString();
        const dataEvaluation = evaluateBridgeContinuity(healthPayload, {
          marketShouldBeActive: session.marketShouldBeActive,
          recoveryStartedAt,
        });
        if (dataEvaluation.state === 'STARTING') {
          const graceExpired = current.getTime() - Date.parse(recoveryStartedAt) > CONTINUITY_RETRY_POLICY.marketDataResumeGraceMs;
          emit({
            ...(graceExpired ? { ...dataEvaluation, state: 'DEGRADED' } : dataEvaluation),
            recoveryAttempt: attemptsUsed,
            recoveryResult: graceExpired ? 'DATA_RESUME_NOT_OBSERVED' : 'WAITING_FOR_MARKET_DATA_RESUME',
            requiredSubscriptions: healthPayload?.requiredSubscriptions,
          });
          await wait(CONTINUITY_RETRY_POLICY.healthPollMs);
          continue;
        }
        observedDataResumeAt = healthPayload?.latestReceivedAt || current.toISOString();
      }
      healthySince ||= current.toISOString();
      lastHealthyAt = current.toISOString();
      if (recoveryBudgetResetEligible(healthySince, current)) {
        attemptsUsed = 0;
        cooldownUntil = null;
      }
      recoveryStartedAt = null;
      emit({ ...evaluated, recoveryAttempt: attemptsUsed, recoveryResult: ownedChild ? 'RECOVERED' : 'REUSED_HEALTHY_INSTANCE', requiredSubscriptions: healthPayload?.requiredSubscriptions, writerStatus: 'PASS', observedDataResumeAt: healthPayload?.latestReceivedAt || null });
      await wait(CONTINUITY_RETRY_POLICY.healthPollMs);
      continue;
    }
    if (stopSignal.requested) break;
    healthySince = null;
    failureDetectedAt ||= now().toISOString();
    if (cooldownUntil && Date.parse(cooldownUntil) <= now().getTime()) {
      cooldownUntil = null;
      attemptsUsed = 0;
    }
    if (evaluated.reasonCode && evaluated.reasonCode !== 'BRIDGE_HEALTH_UNAVAILABLE') lastFailureReason = evaluated.reasonCode;
    const occupied = await occupiedProbe(host, port);
    const decision = recoveryDecision({ healthPayload, portOccupied: occupied, attemptsUsed, now: now(), cooldownUntil });
    if (decision.action === 'FAIL_CLOSED') {
      emit({ ...decision, recoveryAttempt: attemptsUsed, recoveryResult: 'FAIL_CLOSED', writerStatus: evaluated.writerStatus });
      await wait(CONTINUITY_RETRY_POLICY.healthPollMs);
      continue;
    }
    if (decision.action === 'ENTER_COOLDOWN' || decision.action === 'WAIT_COOLDOWN') {
      cooldownUntil ||= new Date(now().getTime() + CONTINUITY_RETRY_POLICY.cooldownMs).toISOString();
      emit({ state: 'RECOVERY_FAILED', reasonCode: 'RECOVERY_BUDGET_EXHAUSTED', recoveryAttempt: attemptsUsed, recoveryResult: 'COOLDOWN', writerStatus: evaluated.writerStatus });
      await wait(Math.min(CONTINUITY_RETRY_POLICY.healthPollMs, Math.max(1, Date.parse(cooldownUntil) - now().getTime())));
      continue;
    }
    attemptsUsed = decision.attempt;
    await wait(decision.delayMs);
    if (stopSignal.requested) break;
    recoveryStartedAt ||= now().toISOString();
    emit({ state: 'RECOVERING', reasonCode: lastFailureReason, recoveryAttempt: attemptsUsed, recoveryResult: 'ATTEMPT_STARTED', writerStatus: evaluated.writerStatus });
    try {
      ownedChild = spawnBridge({ attempt: attemptsUsed });
      if (ownedChild && typeof ownedChild.once === 'function') {
        ownedChild.once('exit', (exitCode) => {
          if (Number(exitCode) === 76) stopSignal.requested = true;
          else lastFailureReason = classifyBridgeFailure({ exitCode });
        });
        ownedChild.once('error', (error) => { lastFailureReason = classifyBridgeFailure({ errorText: error?.message }); });
      }
    } catch (error) {
      lastFailureReason = classifyBridgeFailure({ errorText: error?.message });
    }
    const startupDeadline = now().getTime() + CONTINUITY_RETRY_POLICY.startupTimeoutMs;
    while (!stopSignal.requested && now().getTime() < startupDeadline) {
      await wait(CONTINUITY_RETRY_POLICY.healthPollMs);
      try {
        const candidate = await healthProbe(healthBaseUrl);
        const candidateState = evaluateBridgeContinuity(candidate, { marketShouldBeActive: false });
        if (candidateState.state === 'HEALTHY') break;
        if (candidateState.reasonCode) lastFailureReason = candidateState.reasonCode;
      } catch { /* bounded retry loop handles unavailable health */ }
    }
  }

  if (stopSignal.requested) {
    emit({ state: 'STOPPED_EXPECTED', reasonCode: 'EXPECTED_STOP', recoveryAttempt: attemptsUsed, recoveryResult: 'EXPECTED_STOP', writerStatus: 'UNKNOWN' });
    if (ownedChild && !ownedChild.killed) ownedChild.kill('SIGTERM');
  }
  return { statusPath, cycles, expectedStop: stopSignal.requested };
}

async function main() {
  const rootIndex = process.argv.indexOf('--root');
  const root = path.resolve(rootIndex >= 0 ? process.argv[rootIndex + 1] : DEFAULT_ROOT);
  if (!process.argv.includes('--owner-approved-activation') || process.env.SHIOAJI_CONTINUITY_ACTIVATION_APPROVED !== 'true') {
    process.stdout.write(`${JSON.stringify({ state: 'NOT_ACTIVE', reason: 'OWNER_APPROVED_ACTIVATION_REQUIRED', executionAuthorized: false, orderRoutesEnabled: false })}\n`);
    return;
  }
  const lockPath = path.join(root, 'data', 'runtime', 'shioaji-continuity', 'supervisor.lock');
  const portGuard = await acquireSupervisorPort();
  let lock;
  try { lock = acquireContinuityLock(lockPath); } catch (error) { await portGuard.close(); throw error; }
  const stopSignal = { requested: false };
  process.once('SIGINT', () => { stopSignal.requested = true; });
  process.once('SIGTERM', () => { stopSignal.requested = true; });
  const calendarPath = path.join(root, 'config', 'taifex-official-calendar-2026.json');
  const exceptionPath = path.join(root, 'data', 'market-state', 'forward-shadow', 'governance', 'taifex-official-calendar-exception.json');
  const candidateEmergencyClosure = path.join(root, 'config', 'taifex-emergency-closure-20261023.json');
  const evidence = fs.existsSync(exceptionPath) ? exceptionPath
    : fs.existsSync(candidateEmergencyClosure) ? candidateEmergencyClosure : null;
  const calendar = loadGovernedTradingCalendar(calendarPath, evidence);
  try {
    await runContinuitySupervisor({ root, stopSignal, calendar });
  } finally {
    lock.release();
    await portGuard.close();
  }
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) await main();

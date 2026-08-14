import fs from 'node:fs';
import path from 'node:path';

export const CONTINUITY_STATES = Object.freeze([
  'HEALTHY',
  'STARTING',
  'DEGRADED',
  'RECOVERING',
  'RECOVERY_FAILED',
  'STOPPED_EXPECTED',
  'UNAVAILABLE',
  'UNKNOWN',
]);

export const CONTINUITY_REASONS = Object.freeze([
  'BRIDGE_NOT_RUNNING',
  'BRIDGE_HEALTH_UNAVAILABLE',
  'SESSION_TERMINATED',
  'LOGIN_FAILED',
  'TOKEN_OR_AUTH_FAILURE',
  'NETWORK_UNAVAILABLE',
  'SUBSCRIPTION_RESTORE_FAILED',
  'WRITER_UNAVAILABLE',
  'PORT_OCCUPIED_UNHEALTHY',
  'DUPLICATE_INSTANCE_DETECTED',
  'RECOVERY_BUDGET_EXHAUSTED',
  'DATA_RESUME_NOT_OBSERVED',
  'UNSAFE_RUNTIME_RESPONSE',
  'UNKNOWN_INSUFFICIENT_EVIDENCE',
]);

export const CORE_MARKET_DATA_SUBSCRIPTIONS = Object.freeze([
  Object.freeze({ product: 'TX', subscriptionAlias: 'TXFR1', quoteTypes: Object.freeze(['Tick', 'BidAsk']) }),
  Object.freeze({ product: 'MTX', subscriptionAlias: 'MXFR1', quoteTypes: Object.freeze(['Tick', 'BidAsk']) }),
  Object.freeze({ product: 'TMF', subscriptionAlias: 'TMFR1', quoteTypes: Object.freeze(['Tick', 'BidAsk']) }),
  Object.freeze({ product: '2330', subscriptionAlias: '2330', quoteTypes: Object.freeze(['Tick']) }),
  Object.freeze({ product: 'IX0001', subscriptionAlias: 'IX0001', quoteTypes: Object.freeze(['Quote']) }),
]);

export const CONTINUITY_RETRY_POLICY = Object.freeze({
  maxAttempts: 3,
  attemptDelaysMs: Object.freeze([0, 5_000, 20_000]),
  startupTimeoutMs: 30_000,
  healthPollMs: 2_000,
  marketDataResumeGraceMs: 120_000,
  cooldownMs: 15 * 60_000,
  healthyResetMs: 5 * 60_000,
});

export const CONTINUITY_SAFETY = Object.freeze({
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
  runtimeMode: 'market_data_only',
});

function isoOrNull(value) {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : null;
}

function subscriptionMap(value) {
  if (!Array.isArray(value)) return new Map();
  return new Map(value
    .filter((item) => item && typeof item.product === 'string')
    .map((item) => [item.product, item]));
}

function subscriptionsRestored(value) {
  const observed = subscriptionMap(value);
  return CORE_MARKET_DATA_SUBSCRIPTIONS.every((required) => {
    const item = observed.get(required.product);
    if (!item || item.state !== 'RESTORED' || !Array.isArray(item.quoteTypes)) return false;
    return required.quoteTypes.every((quoteType) => item.quoteTypes.includes(quoteType));
  });
}

export function evaluateBridgeContinuity(payload, {
  marketShouldBeActive = false,
  recoveryStartedAt = null,
} = {}) {
  if (!payload || typeof payload !== 'object') {
    return Object.freeze({
      state: 'UNAVAILABLE',
      reasonCode: 'BRIDGE_HEALTH_UNAVAILABLE',
      subscriptionStatus: 'UNKNOWN',
      writerStatus: 'UNKNOWN',
      dataTrust: 'UNAVAILABLE',
      dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    });
  }
  const safe = payload.mode === 'market_data_only'
    && payload.executionAuthorized === false
    && payload.orderRoutesEnabled === false;
  if (!safe) {
    return Object.freeze({
      state: 'UNAVAILABLE',
      reasonCode: 'UNSAFE_RUNTIME_RESPONSE',
      subscriptionStatus: 'UNKNOWN',
      writerStatus: 'UNKNOWN',
      dataTrust: 'UNAVAILABLE',
      dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    });
  }
  const writerStatus = payload.writerState === 'PASS'
    && Number(payload.writerErrors || 0) === 0
    && payload.lowDisk !== true ? 'PASS' : 'FAIL';
  if (payload.sessionDown === true || payload.bridgeState === 'DEGRADED' && payload.reasonCode === 'SESSION_TERMINATED') {
    return Object.freeze({
      state: 'DEGRADED', reasonCode: 'SESSION_TERMINATED', subscriptionStatus: 'UNKNOWN', writerStatus,
      dataTrust: 'QUALITY_INSUFFICIENT', dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    });
  }
  if (writerStatus !== 'PASS') {
    return Object.freeze({
      state: 'DEGRADED', reasonCode: 'WRITER_UNAVAILABLE', subscriptionStatus: 'UNKNOWN', writerStatus,
      dataTrust: 'QUALITY_INSUFFICIENT', dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    });
  }
  const restored = subscriptionsRestored(payload.requiredSubscriptions);
  if (!restored) {
    return Object.freeze({
      state: 'DEGRADED', reasonCode: 'SUBSCRIPTION_RESTORE_FAILED', subscriptionStatus: 'PARTIAL', writerStatus,
      dataTrust: 'QUALITY_INSUFFICIENT', dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    });
  }
  const latestReceivedAt = isoOrNull(payload.latestReceivedAt);
  const recoveryAt = isoOrNull(recoveryStartedAt);
  if (marketShouldBeActive && recoveryAt
      && (!latestReceivedAt || Date.parse(latestReceivedAt) <= Date.parse(recoveryAt))) {
    return Object.freeze({
      state: 'STARTING', reasonCode: 'DATA_RESUME_NOT_OBSERVED', subscriptionStatus: 'RESTORED', writerStatus,
      dataTrust: 'QUALITY_INSUFFICIENT', dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    });
  }
  return Object.freeze({
    state: payload.ok === true ? 'HEALTHY' : 'UNKNOWN',
    reasonCode: payload.ok === true ? null : 'UNKNOWN_INSUFFICIENT_EVIDENCE',
    subscriptionStatus: 'RESTORED',
    writerStatus,
    dataTrust: payload.timestampLineageState === 'PASS' ? 'PASS' : 'QUALITY_INSUFFICIENT',
    dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
  });
}

export function classifyBridgeFailure({ exitCode = null, errorText = '' } = {}) {
  if (Number(exitCode) === 75) return 'SESSION_TERMINATED';
  if (Number(exitCode) === 77) return 'TOKEN_OR_AUTH_FAILURE';
  if (Number(exitCode) === 78) return 'NETWORK_UNAVAILABLE';
  if (Number(exitCode) === 79) return 'SUBSCRIPTION_RESTORE_FAILED';
  if (Number(exitCode) === 80) return 'LOGIN_FAILED';
  const bounded = String(errorText).slice(0, 4_096).toLowerCase();
  if (/api.?key|secret.?key|credential|unauthori[sz]ed|authentication|login failed/.test(bounded)) {
    return /token|api.?key|secret.?key|credential/.test(bounded) ? 'TOKEN_OR_AUTH_FAILURE' : 'LOGIN_FAILED';
  }
  if (/network|connection|dns|timeout|timed out|unreachable|socket/.test(bounded)) return 'NETWORK_UNAVAILABLE';
  return 'UNKNOWN_INSUFFICIENT_EVIDENCE';
}

export function recoveryDecision({
  healthPayload = null,
  portOccupied = false,
  expectedStop = false,
  attemptsUsed = 0,
  now = new Date(),
  cooldownUntil = null,
} = {}) {
  if (expectedStop) return Object.freeze({ action: 'STOP', state: 'STOPPED_EXPECTED', reasonCode: null });
  const evaluated = evaluateBridgeContinuity(healthPayload);
  if (evaluated.state === 'HEALTHY') return Object.freeze({ action: 'REUSE', ...evaluated });
  if (portOccupied) {
    return Object.freeze({ action: 'FAIL_CLOSED', state: 'UNAVAILABLE', reasonCode: 'PORT_OCCUPIED_UNHEALTHY' });
  }
  if (cooldownUntil && Date.parse(cooldownUntil) > now.getTime()) {
    return Object.freeze({ action: 'WAIT_COOLDOWN', state: 'RECOVERY_FAILED', reasonCode: 'RECOVERY_BUDGET_EXHAUSTED' });
  }
  if (attemptsUsed >= CONTINUITY_RETRY_POLICY.maxAttempts) {
    return Object.freeze({ action: 'ENTER_COOLDOWN', state: 'RECOVERY_FAILED', reasonCode: 'RECOVERY_BUDGET_EXHAUSTED' });
  }
  return Object.freeze({
    action: 'START_RECOVERY',
    state: 'RECOVERING',
    reasonCode: evaluated.reasonCode === 'BRIDGE_HEALTH_UNAVAILABLE' ? 'BRIDGE_NOT_RUNNING' : evaluated.reasonCode,
    attempt: attemptsUsed + 1,
    delayMs: CONTINUITY_RETRY_POLICY.attemptDelaysMs[attemptsUsed],
  });
}

export function recoveryBudgetResetEligible(healthySince, now = new Date()) {
  const healthyAt = isoOrNull(healthySince);
  return healthyAt !== null && now.getTime() - Date.parse(healthyAt) >= CONTINUITY_RETRY_POLICY.healthyResetMs;
}

export function buildContinuityStatus(input = {}) {
  const state = CONTINUITY_STATES.includes(input.state) ? input.state : 'UNKNOWN';
  const reasonCode = input.reasonCode == null || CONTINUITY_REASONS.includes(input.reasonCode)
    ? input.reasonCode ?? null : 'UNKNOWN_INSUFFICIENT_EVIDENCE';
  const subscriptionStatus = CORE_MARKET_DATA_SUBSCRIPTIONS.map((required) => {
    const observed = subscriptionMap(input.requiredSubscriptions).get(required.product);
    return Object.freeze({
      product: required.product,
      state: observed?.state === 'RESTORED' ? 'RESTORED' : observed?.state === 'FAILED' ? 'FAILED' : 'UNKNOWN',
      quoteTypes: required.quoteTypes,
      actualContract: typeof observed?.actualContract === 'string' ? observed.actualContract : null,
      lastObservedAt: isoOrNull(observed?.lastObservedAt),
    });
  });
  return Object.freeze({
    schemaVersion: 'shioaji-market-data-continuity-v1',
    capturedAt: isoOrNull(input.capturedAt) || new Date().toISOString(),
    state,
    reasonCode,
    lastHealthyAt: isoOrNull(input.lastHealthyAt),
    failureDetectedAt: isoOrNull(input.failureDetectedAt),
    recoveryStartedAt: isoOrNull(input.recoveryStartedAt),
    bridgeReadyAt: isoOrNull(input.bridgeReadyAt),
    subscriptionReadyAt: isoOrNull(input.subscriptionReadyAt),
    writerReadyAt: isoOrNull(input.writerReadyAt),
    observedDataResumeAt: isoOrNull(input.observedDataResumeAt),
    recoveryAttempt: Math.max(0, Number(input.recoveryAttempt) || 0),
    recoveryLimit: CONTINUITY_RETRY_POLICY.maxAttempts,
    recoveryResult: typeof input.recoveryResult === 'string' ? input.recoveryResult : null,
    requiredSubscriptions: Object.freeze(subscriptionStatus),
    writerStatus: input.writerStatus === 'PASS' ? 'PASS' : input.writerStatus === 'FAIL' ? 'FAIL' : 'UNKNOWN',
    dataTrust: input.dataTrust === 'PASS' ? 'PASS' : input.dataTrust === 'QUALITY_INSUFFICIENT' ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE',
    nativeSequenceAvailability: 'UNAVAILABLE',
    dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
    timestampLineageState: 'QUALITY_INSUFFICIENT',
    retryPolicy: CONTINUITY_RETRY_POLICY,
    ...CONTINUITY_SAFETY,
  });
}

export function writeContinuityStatusAtomic(filePath, status) {
  const normalized = buildContinuityStatus(status);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(normalized, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
  fs.renameSync(temporary, filePath);
  return normalized;
}

export function acquireContinuityLock(filePath, {
  pid = process.pid,
  isProcessAlive = (candidate) => {
    try { process.kill(candidate, 0); return true; } catch { return false; }
  },
} = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const create = () => {
    const descriptor = fs.openSync(filePath, 'wx');
    fs.writeFileSync(descriptor, `${JSON.stringify({ pid, createdAt: new Date().toISOString() })}\n`, 'utf8');
    fs.closeSync(descriptor);
  };
  try {
    create();
  } catch (error) {
    if (error?.code !== 'EEXIST') throw error;
    let ownerPid = null;
    try { ownerPid = Number(JSON.parse(fs.readFileSync(filePath, 'utf8')).pid) || null; } catch { ownerPid = null; }
    if (ownerPid && isProcessAlive(ownerPid)) throw new Error('DUPLICATE_INSTANCE_DETECTED');
    fs.unlinkSync(filePath);
    create();
  }
  let released = false;
  return Object.freeze({
    release() {
      if (released) return;
      released = true;
      try {
        const owner = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (Number(owner.pid) === Number(pid)) fs.unlinkSync(filePath);
      } catch { /* already absent or no longer owned */ }
    },
  });
}

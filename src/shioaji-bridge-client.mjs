const DEFAULT_URL = 'http://127.0.0.1:8790';

async function getJson(path, { baseUrl = DEFAULT_URL, timeoutMs = 1200 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`bridge_http_${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectShioajiBridge(options = {}) {
  const runtime = options?.continuityRuntime?.schemaVersion === 'shioaji-market-data-continuity-v1'
    && options.continuityRuntime.executionAuthorized === false
    && options.continuityRuntime.orderRoutesEnabled === false
    ? options.continuityRuntime : null;
  try {
    const health = await getJson('/health', options);
    const safe = health?.mode === 'market_data_only'
      && health?.executionAuthorized === false
      && health?.orderRoutesEnabled === false;
    const bridgeState = typeof health?.bridgeState === 'string'
      ? health.bridgeState : safe && health?.ok ? 'HEALTHY' : 'UNKNOWN';
    const requiredSubscriptions = Array.isArray(health?.requiredSubscriptions)
      ? health.requiredSubscriptions.map((item) => ({
        product: typeof item?.product === 'string' ? item.product : 'UNKNOWN',
        state: item?.state === 'RESTORED' ? 'RESTORED' : item?.state === 'FAILED' ? 'FAILED' : 'UNKNOWN',
        quoteTypes: Array.isArray(item?.quoteTypes) ? item.quoteTypes.filter((value) => typeof value === 'string') : [],
        actualContract: typeof item?.actualContract === 'string' ? item.actualContract : null,
        lastObservedAt: typeof item?.lastObservedAt === 'string' ? item.lastObservedAt : null,
      })) : [];
    const writerState = health?.writerState === 'PASS'
      ? 'PASS' : health?.writerState === 'FAIL' ? 'FAIL' : Number(health?.writerErrors || 0) === 0 && health?.lowDisk !== true ? 'PASS' : 'FAIL';
    const operationallyHealthy = bridgeState === 'HEALTHY'
      && writerState === 'PASS'
      && (requiredSubscriptions.length === 0 || requiredSubscriptions.every((item) => item.state === 'RESTORED'));
    return {
      connected: Boolean(health?.ok) && safe && operationallyHealthy,
      provider: health?.provider || 'shioaji',
      mode: health?.mode || 'unknown',
      symbolsReceived: Number(health?.symbolsReceived) || 0,
      eventStorage: health?.eventStorage || 'not_reported',
      eventsWritten: Number(health?.eventsWritten) || 0,
      duplicateEvents: Number(health?.duplicateEvents) || 0,
      sequenceGaps: Number(health?.sequenceGaps) || 0,
      clockSkewEvents: Number(health?.clockSkewEvents) || 0,
      latestReceivedAt: health?.latestReceivedAt || null,
      freeBytes: Number(health?.freeBytes) || null,
      lowDisk: Boolean(health?.lowDisk),
      marketSession: health?.marketSession && typeof health.marketSession === 'object'
        ? {
          state: health.marketSession.state || 'unknown',
          isTradingSession: health.marketSession.isTradingSession === true,
          timeZone: health.marketSession.timeZone || 'Asia/Taipei',
        }
        : null,
      continuity: {
        state: typeof runtime?.state === 'string' ? runtime.state : bridgeState,
        reasonCode: typeof runtime?.reasonCode === 'string' ? runtime.reasonCode : typeof health?.reasonCode === 'string' ? health.reasonCode : null,
        lastHealthyAt: typeof runtime?.lastHealthyAt === 'string' ? runtime.lastHealthyAt : typeof health?.lastHealthyAt === 'string' ? health.lastHealthyAt : null,
        bridgeStartedAt: typeof health?.bridgeStartedAt === 'string' ? health.bridgeStartedAt : null,
        requiredSubscriptions: Array.isArray(runtime?.requiredSubscriptions) ? runtime.requiredSubscriptions : requiredSubscriptions,
        writerStatus: runtime?.writerStatus === 'PASS' || runtime?.writerStatus === 'FAIL' ? runtime.writerStatus : writerState,
        recoveryAttempt: Number.isInteger(runtime?.recoveryAttempt) ? runtime.recoveryAttempt : 0,
        recoveryLimit: Number.isInteger(runtime?.recoveryLimit) ? runtime.recoveryLimit : null,
        recoveryResult: typeof runtime?.recoveryResult === 'string' ? runtime.recoveryResult : null,
        dataTrust: runtime?.dataTrust === 'PASS' ? 'PASS' : 'QUALITY_INSUFFICIENT',
        nativeSequenceAvailability: health?.nativeSequenceAvailability === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
        dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
      },
      executionAuthorized: false,
      orderRoutesEnabled: false,
      safetyVerified: safe,
      checkedAt: new Date().toISOString(),
      error: !safe ? 'unsafe_bridge_response' : operationallyHealthy ? null : (health?.reasonCode || 'bridge_degraded'),
    };
  } catch (error) {
    return {
      connected: false,
      provider: 'shioaji',
      mode: 'market_data_only',
      symbolsReceived: 0,
      eventStorage: 'unavailable',
      eventsWritten: 0,
      duplicateEvents: 0,
      sequenceGaps: 0,
      clockSkewEvents: 0,
      latestReceivedAt: null,
      freeBytes: null,
      lowDisk: false,
      marketSession: null,
      continuity: {
        state: typeof runtime?.state === 'string' ? runtime.state : 'UNAVAILABLE',
        reasonCode: typeof runtime?.reasonCode === 'string' ? runtime.reasonCode : 'BRIDGE_HEALTH_UNAVAILABLE',
        lastHealthyAt: typeof runtime?.lastHealthyAt === 'string' ? runtime.lastHealthyAt : null,
        bridgeStartedAt: null,
        requiredSubscriptions: Array.isArray(runtime?.requiredSubscriptions) ? runtime.requiredSubscriptions : [],
        writerStatus: runtime?.writerStatus === 'PASS' || runtime?.writerStatus === 'FAIL' ? runtime.writerStatus : 'UNKNOWN',
        recoveryAttempt: Number.isInteger(runtime?.recoveryAttempt) ? runtime.recoveryAttempt : 0,
        recoveryLimit: Number.isInteger(runtime?.recoveryLimit) ? runtime.recoveryLimit : null,
        recoveryResult: typeof runtime?.recoveryResult === 'string' ? runtime.recoveryResult : null,
        dataTrust: runtime?.dataTrust === 'QUALITY_INSUFFICIENT' ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE',
        nativeSequenceAvailability: 'UNAVAILABLE', dataLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
      },
      executionAuthorized: false,
      orderRoutesEnabled: false,
      safetyVerified: false,
      checkedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? 'bridge_timeout' : 'bridge_unreachable',
    };
  }
}

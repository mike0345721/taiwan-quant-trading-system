import { buildIndexLeadership } from './index-leadership.mjs';

const DEFAULT_URL = 'http://127.0.0.1:8790';
function sanitizeQuoteTypeHealth(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).map(([quoteType, item]) => [quoteType, {
    quoteType,
    subscriptionState: item?.subscriptionState === 'RESTORED' ? 'RESTORED' : item?.subscriptionState === 'FAILED' ? 'FAILED' : 'PENDING',
    deliveryState: typeof item?.deliveryState === 'string' ? item.deliveryState : 'UNKNOWN',
    freshnessState: typeof item?.freshnessState === 'string' ? item.freshnessState : 'UNAVAILABLE',
    subscribedAt: typeof item?.subscribedAt === 'string' ? item.subscribedAt : null,
    lastObservedAt: typeof item?.lastObservedAt === 'string' ? item.lastObservedAt : null,
    lastResubscribeAt: typeof item?.lastResubscribeAt === 'string' ? item.lastResubscribeAt : null,
    resubscribeAttempts: Number(item?.resubscribeAttempts) || 0,
    recoveryState: typeof item?.recoveryState === 'string' ? item.recoveryState : 'UNKNOWN',
  }]));
}

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

export function resolveRequiredSubscriptionActualContract(bridge, product = 'TX') {
  if (!bridge || bridge.safetyVerified !== true) {
    return Object.freeze({ state: 'UNAVAILABLE', reason: 'BRIDGE_SAFETY_NOT_VERIFIED', actualContract: null });
  }
  const subscription = (bridge.requiredSubscriptions || []).find((item) => item?.product === product);
  if (!subscription || subscription.state !== 'RESTORED') {
    return Object.freeze({ state: 'UNAVAILABLE', reason: 'REQUIRED_SUBSCRIPTION_NOT_RESTORED', actualContract: null });
  }
  const actualContract = typeof subscription.actualContract === 'string' ? subscription.actualContract.trim() : '';
  if (!actualContract) {
    return Object.freeze({ state: 'UNAVAILABLE', reason: 'REQUIRED_SUBSCRIPTION_CONTRACT_UNRESOLVED', actualContract: null });
  }
  return Object.freeze({
    state: 'RESOLVED',
    reason: null,
    actualContract,
    source: `SHIOAJI_${subscription.subscriptionAlias || product}_RESOLVED_ACTUAL_CONTRACT`,
  });
}

export async function inspectShioajiBridge(options = {}) {
  const runtime = options?.continuityRuntime?.schemaVersion === 'shioaji-market-data-continuity-v1'
    && options.continuityRuntime.executionAuthorized === false
    && options.continuityRuntime.orderRoutesEnabled === false
    ? options.continuityRuntime : null;
  try {
    const health = await getJson('/health', options);
    const safe = health?.mode === 'market_data_only'
      && health?.formalWeight === 0
      && health?.researchOnly === true
      && health?.executionAuthorized === false
      && health?.orderRoutesEnabled === false;
    const bridgeState = typeof health?.bridgeState === 'string'
      ? health.bridgeState : safe && health?.ok ? 'HEALTHY' : 'UNKNOWN';
    const requiredSubscriptions = Array.isArray(health?.requiredSubscriptions)
      ? health.requiredSubscriptions.map((item) => ({
        product: typeof item?.product === 'string' ? item.product : 'UNKNOWN',
        state: ['RESTORED', 'PARTIAL', 'FAILED', 'PENDING'].includes(item?.state) ? item.state : 'UNKNOWN',
        quoteTypes: Array.isArray(item?.quoteTypes) ? item.quoteTypes.filter((value) => typeof value === 'string') : [],
        actualContract: typeof item?.actualContract === 'string' ? item.actualContract : null,
        lastObservedAt: typeof item?.lastObservedAt === 'string' ? item.lastObservedAt : null,
        quoteTypeHealth: sanitizeQuoteTypeHealth(item?.quoteTypeHealth),
      })) : [];
    const writerState = health?.writerState === 'PASS'
      ? 'PASS' : health?.writerState === 'FAIL' ? 'FAIL' : Number(health?.writerErrors || 0) === 0 && health?.lowDisk !== true ? 'PASS' : 'FAIL';
    const operationallyHealthy = bridgeState === 'HEALTHY'
      && writerState === 'PASS'
      && requiredSubscriptions.length > 0
      && requiredSubscriptions.every((item) => {
        if (item.state !== 'RESTORED') return false;
        if (!['TX', 'MTX', 'TMF'].includes(item.product)) return true;
        return item.quoteTypes.every((quoteType) => {
          const delivery = item.quoteTypeHealth[quoteType]?.deliveryState;
          return delivery === 'LIVE';
        });
      });
    const txoCollection = {
      enabled: health?.txoCollection?.enabled === true,
      collectorState: typeof health?.txoCollection?.collectorState === 'string'
        ? health.txoCollection.collectorState : 'UNKNOWN',
      subscriptionCount: Number(health?.txoCollection?.subscriptionCount) || 0,
      expectedSubscriptionCount: Number(health?.txoCollection?.expectedSubscriptionCount) || 0,
      restoredSubscriptionCount: Number(health?.txoCollection?.restoredSubscriptionCount) || 0,
      lastQuoteAt: typeof health?.txoCollection?.lastQuoteAt === 'string' ? health.txoCollection.lastQuoteAt : null,
      latestEventTime: typeof health?.txoCollection?.latestEventTime === 'string' ? health.txoCollection.latestEventTime : null,
      latestReceivedAt: typeof health?.txoCollection?.latestReceivedAt === 'string' ? health.txoCollection.latestReceivedAt : null,
      writerState: typeof health?.txoCollection?.writerState === 'string' ? health.txoCollection.writerState : 'UNKNOWN',
      queueDepth: Number(health?.txoCollection?.queueDepth) || 0,
      dropped: Number(health?.txoCollection?.dropped) || 0,
      callbackErrors: Number(health?.txoCollection?.callbackErrors) || 0,
      writerErrors: Number(health?.txoCollection?.writerErrors) || 0,
      diskHealth: typeof health?.txoCollection?.diskHealth === 'string' ? health.txoCollection.diskHealth : 'UNKNOWN',
      nativeSequenceAvailability: 'UNAVAILABLE',
      packetLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
      productionActivationApproved: health?.txoCollection?.productionActivationApproved === true,
    };
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
      requiredSubscriptions,
      leadershipHealth: health?.leadership && typeof health.leadership === 'object' ? health.leadership : null,
      txoCollection,
      executionAuthorized: false,
      orderRoutesEnabled: false,
      formalWeight: 0,
      researchOnly: true,
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
      requiredSubscriptions: [],
      leadershipHealth: null,
      txoCollection: {
        enabled: false, collectorState: 'UNAVAILABLE', subscriptionCount: 0,
        expectedSubscriptionCount: 0, restoredSubscriptionCount: 0, lastQuoteAt: null,
        latestEventTime: null, latestReceivedAt: null, writerState: 'UNKNOWN', queueDepth: 0,
        dropped: 0, callbackErrors: 0, writerErrors: 0, diskHealth: 'UNKNOWN',
        nativeSequenceAvailability: 'UNAVAILABLE', packetLossCertainty: 'UNKNOWN_NO_NATIVE_SEQUENCE',
        productionActivationApproved: false,
      },
      executionAuthorized: false,
      orderRoutesEnabled: false,
      formalWeight: 0,
      researchOnly: true,
      safetyVerified: false,
      checkedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? 'bridge_timeout' : 'bridge_unreachable',
    };
  }
}

export async function inspectShioajiLatest(options = {}) {
  try {
    const response = await getJson('/latest', options);
    const data = response?.data && typeof response.data === 'object' ? response.data : null;
    const safe = response?.mode === 'market_data_only'
      && data
      && Object.values(data).every((record) => record?.executionAuthorized === false
        && record?.orderRoutesEnabled === false
        && record?.formalWeight === 0
        && record?.researchOnly === true);
    if (!safe) throw new Error('unsafe_latest_response');
    return Object.freeze({
      state: 'AVAILABLE',
      reason: null,
      data,
      checkedAt: new Date().toISOString(),
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    });
  } catch (error) {
    return Object.freeze({
      state: 'UNAVAILABLE',
      reason: error?.name === 'AbortError' ? 'BRIDGE_LATEST_TIMEOUT' : 'BRIDGE_LATEST_UNAVAILABLE',
      data: null,
      checkedAt: new Date().toISOString(),
      formalWeight: 0,
      researchOnly: true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    });
  }
}

function subscriptionState(bridge, prefix) {
  const rows = bridge?.requiredSubscriptions || bridge?.continuity?.requiredSubscriptions || [];
  const matching = rows.filter((row) => row.product === prefix || row.product?.startsWith(`${prefix}_`));
  return matching.length && matching.every((row) => row.state === 'RESTORED') ? 'RESTORED' : 'UNKNOWN';
}

export async function inspectIx0001Leadership(options = {}) {
  const bridge = options.bridge || await inspectShioajiBridge(options);
  try {
    const response = await getJson('/leadership', options);
    const safe = response?.mode === 'market_data_only'
      && response?.executionAuthorized === false
      && response?.orderRoutesEnabled === false
      && response?.data?.executionAuthorized === false
      && response?.data?.orderRoutesEnabled === false;
    if (!safe) throw new Error('unsafe_leadership_response');
    return buildIndexLeadership(response.data, {
      now: options.now || new Date(),
      indexSubscriptionState: bridge?.leadershipHealth?.ix0001IndexContribution?.subscriptionState || subscriptionState(bridge, 'IX0001_INDEX'),
      industrySubscriptionState: bridge?.leadershipHealth?.ix0001IndustryContribution?.subscriptionState || subscriptionState(bridge, 'IX0001_INDUSTRY'),
    });
  } catch (error) {
    return Object.freeze({
      ...buildIndexLeadership({}, {
        now: options.now || new Date(),
        indexSubscriptionState: bridge?.leadershipHealth?.ix0001IndexContribution?.subscriptionState || subscriptionState(bridge, 'IX0001_INDEX'),
        industrySubscriptionState: bridge?.leadershipHealth?.ix0001IndustryContribution?.subscriptionState || subscriptionState(bridge, 'IX0001_INDUSTRY'),
      }),
      reasonCode: error?.name === 'AbortError' ? 'LEADERSHIP_BRIDGE_TIMEOUT' : 'LEADERSHIP_BRIDGE_UNAVAILABLE',
    });
  }
}

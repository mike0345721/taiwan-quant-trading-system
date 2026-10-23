const SHA = /^[a-f0-9]{40}$/;
export function summarizeReadonlyHealth({ market, bridge, dashboard, expectedHead = null, observedAt = new Date().toISOString() }) {
  const safe = bridge?.mode === 'market_data_only' && bridge?.formalWeight === 0
    && bridge?.researchOnly === true && bridge?.executionAuthorized === false && bridge?.orderRoutesEnabled === false;
  const sourceVerified = Boolean(dashboard?.runtimeIdentityStatus === 'VERIFIED'
    && SHA.test(expectedHead || '') && dashboard.runtimeCommit === expectedHead);
  const problems = [];
  if (!market || market.state === 'UNAVAILABLE') problems.push('CALENDAR_UNVERIFIED');
  if (!bridge) problems.push('BRIDGE_HEALTH_UNAVAILABLE');
  else if (!safe) problems.push('UNSAFE_OR_UNVERIFIED_BRIDGE');
  if (!dashboard) problems.push('DASHBOARD_UNAVAILABLE');
  else if (!sourceVerified) problems.push('DASHBOARD_IDENTITY_UNVERIFIED');
  const closed = market?.state === 'MARKET_CLOSED';
  if (safe && (bridge.writerErrors > 0 || bridge.callbackErrors > 0 || bridge.dropped > 0)) problems.push('BRIDGE_DATA_ERRORS');
  if (safe && market?.marketShouldBeActive && bridge.bridgeState !== 'HEALTHY') problems.push('ACTIVE_SESSION_BRIDGE_DEGRADED');
  return Object.freeze({
    schemaVersion: 'shiheng-readonly-health-v1', observedAt,
    state: problems.length ? 'ATTENTION_REQUIRED' : closed ? 'MARKET_CLOSED_EXPECTED' : 'READONLY_CHECK_COMPLETE',
    market: market || { state: 'UNAVAILABLE', marketShouldBeActive: false },
    quoteExpectation: closed ? 'NO_NEW_QUOTES_EXPECTED' : market?.marketShouldBeActive ? 'FRESH_QUOTES_REQUIRED' : 'NO_ACTIVE_SESSION',
    bridge: { reachable: Boolean(bridge), safetyVerified: safe, reportedState: bridge?.bridgeState ?? null,
      quoteTypeDeliveryState: bridge?.quoteTypeDeliveryState ?? null },
    dashboard: { reachable: Boolean(dashboard), sourceVerified,
      runtimeCommit: SHA.test(dashboard?.runtimeCommit || '') ? dashboard.runtimeCommit : null,
      expectedHead, runtimeReady: dashboard?.runtimeReady === true },
    problems, liveMarketAcceptance: false, positiveEvProven: false,
    actionsTaken: [], retries: 0, brokerLoginAttempts: 0, automaticRestart: false,
    executionAuthorized: false, orderRoutesEnabled: false,
  });
}

export async function readLocalHealth(url, { fetchImpl = fetch, timeoutMs = 2500 } = {}) {
  if (!['http://127.0.0.1:8787/healthz', 'http://127.0.0.1:18722/healthz', 'http://127.0.0.1:8790/health'].includes(url))
    throw Error('HEALTH_ENDPOINT_NOT_ALLOWED');
  try {
    const response = await fetchImpl(url, { method: 'GET', redirect: 'error', signal: AbortSignal.timeout(timeoutMs) });
    if (!response.ok) return null;
    const reader = response.body.getReader();
    let bytes = 0; const chunks = [];
    try {
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        bytes += value.byteLength;
        if (bytes > 1024 * 1024) return null;
        chunks.push(Buffer.from(value));
      }
      const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      return result && typeof result === 'object' && !Array.isArray(result) ? result : null;
    } finally { await reader.cancel().catch(() => {}); }
  } catch { return null; }
}

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
  try {
    const health = await getJson('/health', options);
    const safe = health?.mode === 'market_data_only'
      && health?.executionAuthorized === false
      && health?.orderRoutesEnabled === false;
    return {
      connected: Boolean(health?.ok) && safe,
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
      executionAuthorized: false,
      orderRoutesEnabled: false,
      safetyVerified: safe,
      checkedAt: new Date().toISOString(),
      error: safe ? null : 'unsafe_bridge_response',
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
      executionAuthorized: false,
      orderRoutesEnabled: false,
      safetyVerified: false,
      checkedAt: new Date().toISOString(),
      error: error?.name === 'AbortError' ? 'bridge_timeout' : 'bridge_unreachable',
    };
  }
}

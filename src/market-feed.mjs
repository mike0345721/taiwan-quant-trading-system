const SUPPORTED_EVENT_TYPES = new Set(['tick', 'quote', 'bar']);

function finite(value) { return value !== null && value !== '' && Number.isFinite(Number(value)); }

export function normalizeMarketEvent(event, provider = 'unconfigured') {
  if (!event || typeof event !== 'object') throw new Error('event_required');
  if (!SUPPORTED_EVENT_TYPES.has(event.type)) throw new Error('event_type_invalid');
  if (!event.timestamp || Number.isNaN(Date.parse(event.timestamp))) throw new Error('timestamp_invalid');
  if (!event.product) throw new Error('product_required');
  const normalized = {
    schemaVersion: '1.0.0', provider, type: event.type, product: String(event.product),
    contract: event.contract ? String(event.contract) : null, timestamp: new Date(event.timestamp).toISOString(),
    session: event.session === 'night' ? 'night' : 'day', sequence: finite(event.sequence) ? Number(event.sequence) : null,
  };
  for (const field of ['price', 'volume', 'bid', 'ask', 'open', 'high', 'low', 'close']) if (finite(event[field])) normalized[field] = Number(event[field]);
  return normalized;
}

export function marketFeedReadiness({ replayFrame, brokerConnected = false } = {}) {
  return {
    schemaVersion: '1.0.0', brokerConnected: Boolean(brokerConnected), liveExecutionEnabled: false,
    replayImported: Boolean(replayFrame?.totalBars), replayBars: Number(replayFrame?.totalBars) || 0,
    replayState: replayFrame?.state || 'replay_not_imported',
    safeguards: ['唯讀行情', '歷史重播隔離', '模擬資料禁止進入正式價格確認', '永不授權實單'],
  };
}

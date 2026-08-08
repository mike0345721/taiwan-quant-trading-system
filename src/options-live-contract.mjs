const EVENT_TYPES = new Set(['option_tick', 'option_quote', 'option_greeks']);
const RIGHTS = new Set(['C', 'P']);
const finite = (value) => value !== null && value !== '' && Number.isFinite(Number(value));

function normalizeDepth(levels, side) {
  if (levels == null) return [];
  if (!Array.isArray(levels) || levels.length > 5) throw new Error(`${side}_depth_invalid`);
  return levels.map((level, index) => {
    if (!finite(level?.price) || Number(level.price) < 0 || !finite(level?.size) || Number(level.size) < 0) {
      throw new Error(`${side}_depth_level_invalid`);
    }
    return { level: index + 1, price: Number(level.price), size: Number(level.size) };
  });
}

export function normalizeOptionsLiveEvent(event, provider = 'unconfigured') {
  if (!event || typeof event !== 'object') throw new Error('event_required');
  if (!EVENT_TYPES.has(event.type)) throw new Error('event_type_invalid');
  if (!event.exchangeTimestamp || Number.isNaN(Date.parse(event.exchangeTimestamp))) throw new Error('exchange_timestamp_invalid');
  if (!event.receivedAt || Number.isNaN(Date.parse(event.receivedAt))) throw new Error('received_at_invalid');
  if (!event.contract) throw new Error('contract_required');
  if (!finite(event.strike) || Number(event.strike) <= 0) throw new Error('strike_invalid');
  const right = String(event.right || '').toUpperCase();
  if (!RIGHTS.has(right)) throw new Error('right_invalid');
  const exchangeTimestamp = new Date(event.exchangeTimestamp).toISOString();
  const receivedAt = new Date(event.receivedAt).toISOString();
  const latencyMs = Date.parse(receivedAt) - Date.parse(exchangeTimestamp);
  const normalized = {
    schemaVersion: '1.0.0', provider: String(provider), type: event.type,
    product: 'TXO', contract: String(event.contract), expiry: event.expiry ? String(event.expiry) : null,
    strike: Number(event.strike), right, exchangeTimestamp, receivedAt,
    latencyMs: latencyMs >= 0 ? latencyMs : null,
    sequence: finite(event.sequence) ? Number(event.sequence) : null,
    session: event.session === 'night' ? 'night' : 'day',
    bidDepth: normalizeDepth(event.bidDepth, 'bid'), askDepth: normalizeDepth(event.askDepth, 'ask'),
  };
  for (const key of ['price', 'volume', 'totalVolume', 'openInterest', 'bid', 'ask', 'bidSize', 'askSize',
    'underlyingPrice', 'impliedVolatility', 'delta', 'gamma', 'theta', 'vega']) {
    if (finite(event[key])) normalized[key] = Number(event[key]);
  }
  const hasQuote = finite(normalized.bid) && finite(normalized.ask) && normalized.ask >= normalized.bid;
  const hasGreeks = ['impliedVolatility', 'delta', 'gamma', 'theta', 'vega'].every((key) => finite(normalized[key]));
  normalized.quality = {
    timestampOrderValid: latencyMs >= 0,
    quoteValid: event.type === 'option_quote' ? hasQuote : null,
    greeksComplete: event.type === 'option_greeks' ? hasGreeks : null,
    tradeDirectionAvailable: false,
  };
  normalized.executionAuthorized = false;
  return normalized;
}

export function optionsFeedReadiness({ connected = false, sampleEvents = [], maxLatencyMs = 2_000 } = {}) {
  const valid = sampleEvents.filter((event) => event?.quality?.timestampOrderValid && event.executionAuthorized === false);
  const latencyOk = valid.length > 0 && valid.every((event) => event.latencyMs != null && event.latencyMs <= maxLatencyMs);
  const quoteCount = valid.filter((event) => event.type === 'option_quote' && event.quality.quoteValid).length;
  const greekCount = valid.filter((event) => event.type === 'option_greeks' && event.quality.greeksComplete).length;
  return {
    schemaVersion: '1.0.0', connected: Boolean(connected), eventsChecked: sampleEvents.length,
    validEvents: valid.length, latencyOk, quoteReady: quoteCount > 0, greeksReady: greekCount > 0,
    researchCollectionReady: Boolean(connected) && valid.length > 0 && latencyOk && quoteCount > 0,
    liveExecutionEnabled: false,
    blockers: [
      ...(!connected ? ['broker_not_connected'] : []),
      ...(!valid.length ? ['no_valid_events'] : []),
      ...(valid.length && !latencyOk ? ['latency_or_clock_invalid'] : []),
      ...(!quoteCount ? ['quote_not_verified'] : []),
    ],
  };
}

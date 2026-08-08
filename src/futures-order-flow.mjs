function taipeiTimestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const zoned = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}+08:00`;
  const parsed = Date.parse(zoned);
  return Number.isFinite(parsed) ? parsed : null;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sideFromTickType(value) {
  const tickType = Number(value);
  if (tickType === 1) return 'buy';
  if (tickType === 2) return 'sell';
  return 'unknown';
}

function sideFromBook(price, book) {
  if (!book || !Number.isFinite(price)) return 'unavailable';
  const bid = finiteNumber(book.bid);
  const ask = finiteNumber(book.ask);
  if (bid == null || ask == null || bid > ask) return 'unavailable';
  if (price >= ask) return 'buy';
  if (price <= bid) return 'sell';
  return 'inside_spread';
}

function rightLabel(timestampMs, minutes) {
  const width = minutes * 60_000;
  return new Date(Math.floor(timestampMs / width) * width + width).toISOString();
}

function newBar(timestamp, price) {
  return {
    timestamp,
    open: price,
    high: price,
    low: price,
    close: price,
    volume: 0,
    buyVolume: 0,
    sellVolume: 0,
    unknownVolume: 0,
    cvd: 0,
    quoteBuyVolume: 0,
    quoteSellVolume: 0,
    quoteInsideSpreadVolume: 0,
    quoteUnavailableVolume: 0,
    quoteCvd: 0,
    exactVwap: null,
    quoteMatchedTicks: 0,
    classificationConflicts: 0,
    _priceVolume: 0,
  };
}

function updateBar(bar, tick) {
  bar.high = Math.max(bar.high, tick.price);
  bar.low = Math.min(bar.low, tick.price);
  bar.close = tick.price;
  bar.volume += tick.volume;
  bar._priceVolume += tick.price * tick.volume;
  if (tick.side === 'buy') bar.buyVolume += tick.volume;
  else if (tick.side === 'sell') bar.sellVolume += tick.volume;
  else bar.unknownVolume += tick.volume;
  bar.cvd = bar.buyVolume - bar.sellVolume;
  if (tick.quoteSide === 'buy') bar.quoteBuyVolume += tick.volume;
  else if (tick.quoteSide === 'sell') bar.quoteSellVolume += tick.volume;
  else if (tick.quoteSide === 'inside_spread') bar.quoteInsideSpreadVolume += tick.volume;
  else bar.quoteUnavailableVolume += tick.volume;
  bar.quoteCvd = bar.quoteBuyVolume - bar.quoteSellVolume;
  bar.exactVwap = bar.volume ? bar._priceVolume / bar.volume : null;
  if (tick.quoteSide === 'buy' || tick.quoteSide === 'sell') bar.quoteMatchedTicks += 1;
  if (tick.classificationConflict) bar.classificationConflicts += 1;
}

function finalizeBars(map) {
  return [...map.values()]
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp))
    .map(({ _priceVolume, ...bar }) => bar);
}

export function buildFuturesOrderFlow(records, {
  targetCodes,
  maxQuoteAgeMs = 2_000,
} = {}) {
  if (!Array.isArray(records)) throw new Error('records_required');
  if (!Array.isArray(targetCodes) || !targetCodes.length) throw new Error('target_codes_required');
  const allowed = new Set(targetCodes);
  const books = new Map();
  const products = new Map();

  const getProduct = (code) => {
    if (!products.has(code)) {
      products.set(code, {
        code,
        ticks: 0,
        volume: 0,
        buyVolume: 0,
        sellVolume: 0,
        unknownVolume: 0,
        cvd: 0,
        quoteBuyVolume: 0,
        quoteSellVolume: 0,
        quoteInsideSpreadVolume: 0,
        quoteUnavailableVolume: 0,
        quoteCvd: 0,
        exactVwap: null,
        quoteMatchedTicks: 0,
        classificationConflicts: 0,
        firstExchangeTimestamp: null,
        lastExchangeTimestamp: null,
        _priceVolume: 0,
        _oneMinute: new Map(),
        _fiveMinute: new Map(),
      });
    }
    return products.get(code);
  };

  for (const record of records) {
    if (!allowed.has(record?.product) || record?.duplicate === true) continue;
    if (record.executionAuthorized !== false || record.orderRoutesEnabled !== false) {
      throw new Error('execution_boundary_invalid');
    }
    const payload = record.payload || {};
    if (payload.simtrade === true) continue;
    const exchangeTimestamp = String(
      payload.datetime || record.exchangeTimestamp || '',
    );
    const exchangeMs = taipeiTimestampMs(exchangeTimestamp);
    if (exchangeMs == null) continue;

    if (record.kind === 'futures_bidask') {
      const bid = Array.isArray(payload.bid_price) ? payload.bid_price[0] : null;
      const ask = Array.isArray(payload.ask_price) ? payload.ask_price[0] : null;
      books.set(record.product, { bid, ask, exchangeMs });
      continue;
    }
    if (record.kind !== 'futures_tick') continue;

    const price = finiteNumber(payload.close);
    const volume = finiteNumber(payload.volume);
    if (price == null || volume == null || volume <= 0) continue;
    const side = sideFromTickType(payload.tick_type);
    const latestBook = books.get(record.product);
    const quoteAgeMs = latestBook ? exchangeMs - latestBook.exchangeMs : null;
    const quoteUsable = quoteAgeMs != null
      && quoteAgeMs >= 0
      && quoteAgeMs <= maxQuoteAgeMs;
    const quoteSide = quoteUsable ? sideFromBook(price, latestBook) : 'unavailable';
    const classificationConflict = (side === 'buy' || side === 'sell')
      && (quoteSide === 'buy' || quoteSide === 'sell')
      && side !== quoteSide;
    const tick = { price, volume, side, quoteSide, classificationConflict };
    const product = getProduct(record.product);
    product.ticks += 1;
    product.volume += volume;
    product._priceVolume += price * volume;
    if (side === 'buy') product.buyVolume += volume;
    else if (side === 'sell') product.sellVolume += volume;
    else product.unknownVolume += volume;
    product.cvd = product.buyVolume - product.sellVolume;
    if (quoteSide === 'buy') product.quoteBuyVolume += volume;
    else if (quoteSide === 'sell') product.quoteSellVolume += volume;
    else if (quoteSide === 'inside_spread') product.quoteInsideSpreadVolume += volume;
    else product.quoteUnavailableVolume += volume;
    product.quoteCvd = product.quoteBuyVolume - product.quoteSellVolume;
    product.exactVwap = product.volume ? product._priceVolume / product.volume : null;
    if (quoteSide === 'buy' || quoteSide === 'sell') product.quoteMatchedTicks += 1;
    if (classificationConflict) product.classificationConflicts += 1;
    product.firstExchangeTimestamp ||= exchangeTimestamp;
    product.lastExchangeTimestamp = exchangeTimestamp;

    for (const [minutes, bars] of [
      [1, product._oneMinute],
      [5, product._fiveMinute],
    ]) {
      const label = rightLabel(exchangeMs, minutes);
      if (!bars.has(label)) bars.set(label, newBar(label, price));
      updateBar(bars.get(label), tick);
    }
  }

  return {
    schemaVersion: 'v3.10-futures-order-flow-v1',
    methodology: {
      aggressorSide: 'provider classification from Shioaji TickFOPv1 tick_type: 1=buy, 2=sell, 0=unknown',
      quoteCrossCheck: `latest non-future BidAsk at or before tick, maximum age ${maxQuoteAgeMs}ms`,
      cvd: 'provider-classified buy volume minus sell volume; unknown volume excluded',
      quoteCvd: 'best-quote inferred buy volume minus sell volume; inside-spread and unavailable volume excluded',
      exactVwap: 'sum(tick price * tick volume) / sum(tick volume) over captured non-simulated ticks',
      limitation: 'VWAP is exact for the captured audited stream. Aggressor side remains a provider/book inference, not proof of trader identity or intent.',
    },
    products: Object.fromEntries([...products.entries()].map(([code, product]) => {
      const {
        _priceVolume,
        _oneMinute,
        _fiveMinute,
        ...summary
      } = product;
      return [code, {
        ...summary,
        classifiedVolumeRatio: product.volume
          ? (product.buyVolume + product.sellVolume) / product.volume
          : null,
        quoteClassifiedVolumeRatio: product.volume
          ? (product.quoteBuyVolume + product.quoteSellVolume) / product.volume
          : null,
        classificationConflictRatio: product.quoteMatchedTicks
          ? product.classificationConflicts / product.quoteMatchedTicks
          : null,
        oneMinuteBars: finalizeBars(_oneMinute),
        fiveMinuteBars: finalizeBars(_fiveMinute),
      }];
    })),
    researchOnly: true,
    executionAuthorized: false,
  };
}

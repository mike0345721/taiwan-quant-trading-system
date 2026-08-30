function finitePositive(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function finiteNumber(value) {
  if (value == null || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function sameIdentity(event, anchor) {
  return event.actualContract === anchor.actualContract
    && event.tradeDate === anchor.tradeDate
    && event.session === anchor.session
    && event.continuityEpoch === anchor.continuityEpoch;
}

function eligibleTicks(events, cutoffEvent, windowMs) {
  const lowerExclusive = cutoffEvent.eventMs - windowMs;
  return events.filter((event) => event?.kind === 'futures_tick'
    && event.ledgerOrdinal <= cutoffEvent.ledgerOrdinal
    && sameIdentity(event, cutoffEvent)
    && Number.isFinite(event.eventMs)
    && event.eventMs > lowerExclusive
    && event.eventMs <= cutoffEvent.eventMs);
}

function priceOf(tick) {
  return finitePositive(tick?.payload?.price ?? tick?.payload?.close);
}

function directionRelation(pressureRatio, displacementPoints) {
  if (displacementPoints === 0) return 'FLAT_PRICE';
  if (!Number.isFinite(pressureRatio) || pressureRatio === 0) return 'PRESSURE_UNAVAILABLE';
  return Math.sign(pressureRatio) === Math.sign(displacementPoints)
    ? 'SAME_DIRECTION' : 'OPPOSITE_DIRECTION';
}

function unavailablePath(reason, tickCount, maxGapMs) {
  return Object.freeze({
    status: reason.startsWith('QUALITY_INSUFFICIENT_') ? 'QUALITY_INSUFFICIENT' : 'UNAVAILABLE',
    value: null,
    unavailableReason: reason,
    tickCount,
    maxObservedGapMs: null,
    maxAllowedGapMs: maxGapMs,
  });
}

export function buildPriceResponsePathEfficiencyWindow(events, cutoffEvent, {
  windowMs = 60_000,
  tickSize,
  pressureRatio = null,
  minPathTickCount = 3,
  maxGapMs = 30_000,
} = {}) {
  if (!Array.isArray(events) || cutoffEvent?.kind !== 'futures_tick') {
    throw new Error('CRU34_RESPONSE_WINDOW_INPUT_INVALID');
  }
  if (!(windowMs > 0)) throw new Error('CRU34_RESPONSE_WINDOW_MS_INVALID');
  const legalTickSize = finitePositive(tickSize);
  if (legalTickSize == null) throw new Error('CRU34_TICK_SIZE_REQUIRED');
  if (!Number.isInteger(minPathTickCount) || minPathTickCount < 2) {
    throw new Error('CRU34_MIN_PATH_TICK_COUNT_INVALID');
  }
  if (!(maxGapMs > 0)) throw new Error('CRU34_MAX_GAP_MS_INVALID');

  const ticks = eligibleTicks(events, cutoffEvent, windowMs);
  if (!ticks.length) {
    return Object.freeze({
      status: 'UNAVAILABLE',
      unavailableReason: 'NO_ELIGIBLE_TICKS',
      windowMs,
      tickCount: 0,
      response: Object.freeze({
        status: 'UNAVAILABLE',
        startPrice: null,
        endPrice: null,
        displacementPoints: null,
        displacementTicks: null,
        directionRelation: 'PRESSURE_UNAVAILABLE',
      }),
      pathEfficiency: unavailablePath('INSUFFICIENT_OBSERVATIONS', 0, maxGapMs),
      usedEvents: Object.freeze([]),
    });
  }

  if (ticks.some((tick) => tick.identityStatus !== 'USABLE')) {
    return Object.freeze({
      status: 'QUALITY_INSUFFICIENT',
      unavailableReason: 'TICK_IDENTITY_UNUSABLE',
      windowMs,
      tickCount: ticks.length,
      response: Object.freeze({ status: 'UNAVAILABLE', unavailableReason: 'TICK_IDENTITY_UNUSABLE' }),
      pathEfficiency: unavailablePath('QUALITY_INSUFFICIENT_IDENTITY', ticks.length, maxGapMs),
      usedEvents: Object.freeze(ticks),
    });
  }

  const prices = ticks.map(priceOf);
  if (prices.some((price) => price == null)) {
    return Object.freeze({
      status: 'QUALITY_INSUFFICIENT',
      unavailableReason: 'TICK_PRICE_INVALID',
      windowMs,
      tickCount: ticks.length,
      response: Object.freeze({ status: 'UNAVAILABLE', unavailableReason: 'TICK_PRICE_INVALID' }),
      pathEfficiency: unavailablePath('QUALITY_INSUFFICIENT_PRICE', ticks.length, maxGapMs),
      usedEvents: Object.freeze(ticks),
    });
  }

  const startPrice = prices[0];
  const endPrice = prices.at(-1);
  const displacementPoints = endPrice - startPrice;
  const displacementTicks = displacementPoints / legalTickSize;
  const response = Object.freeze({
    status: 'READY',
    startPrice,
    endPrice,
    displacementPoints,
    displacementTicks,
    directionRelation: directionRelation(finiteNumber(pressureRatio), displacementPoints),
  });

  let pathEfficiency;
  if (ticks.length < minPathTickCount) {
    pathEfficiency = unavailablePath('INSUFFICIENT_OBSERVATIONS', ticks.length, maxGapMs);
  } else {
    let pathLength = 0;
    let maxObservedGapMs = 0;
    let pathReason = null;
    for (let index = 1; index < ticks.length; index += 1) {
      const prior = ticks[index - 1];
      const current = ticks[index];
      if (current.eventMs < prior.eventMs) {
        pathReason = 'QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION';
        break;
      }
      const gapMs = current.eventMs - prior.eventMs;
      maxObservedGapMs = Math.max(maxObservedGapMs, gapMs);
      if (gapMs > maxGapMs) {
        pathReason = 'QUALITY_INSUFFICIENT_LONG_GAP';
        break;
      }
      pathLength += Math.abs(prices[index] - prices[index - 1]);
    }

    if (pathReason) {
      pathEfficiency = Object.freeze({
        ...unavailablePath(pathReason, ticks.length, maxGapMs),
        maxObservedGapMs,
      });
    } else if (pathLength === 0) {
      pathEfficiency = Object.freeze({
        ...unavailablePath('UNAVAILABLE_ZERO_PATH', ticks.length, maxGapMs),
        maxObservedGapMs,
      });
    } else {
      const rawValue = Math.abs(displacementPoints) / pathLength;
      const value = Math.min(1, Math.max(0, rawValue));
      pathEfficiency = Object.freeze({
        status: 'READY',
        value,
        unavailableReason: null,
        tickCount: ticks.length,
        pathLengthPoints: pathLength,
        netDisplacementPoints: Math.abs(displacementPoints),
        maxObservedGapMs,
        maxAllowedGapMs: maxGapMs,
      });
    }
  }

  return Object.freeze({
    status: response.status === 'READY' ? 'READY' : 'QUALITY_INSUFFICIENT',
    unavailableReason: null,
    windowMs,
    tickCount: ticks.length,
    response,
    pathEfficiency,
    usedEvents: Object.freeze(ticks),
  });
}

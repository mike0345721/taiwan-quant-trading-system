const YEAR_MS = 365 * 24 * 60 * 60 * 1_000;

function normalPdf(value) {
  return Math.exp(-0.5 * value * value) / Math.sqrt(2 * Math.PI);
}

function normalCdf(value) {
  const sign = value < 0 ? -1 : 1;
  const x = Math.abs(value) / Math.sqrt(2);
  const t = 1 / (1 + 0.3275911 * x);
  const erf = 1 - (((((1.061405429 * t - 1.453152027) * t)
    + 1.421413741) * t - 0.284496736) * t + 0.254829592)
    * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * erf);
}

function rightName(value) {
  const normalized = String(value || '').trim().toUpperCase();
  if (normalized === 'C' || normalized === 'CALL') return 'call';
  if (normalized === 'P' || normalized === 'PUT') return 'put';
  return null;
}

export function black76Greeks({
  future,
  strike,
  time,
  volatility,
  rate = 0.015,
  right,
}) {
  const optionRight = rightName(right);
  if (!(future > 0 && strike > 0 && time > 0 && volatility > 0) || !optionRight) return null;
  const rootTime = Math.sqrt(time);
  const sigmaRootTime = volatility * rootTime;
  const d1 = (Math.log(future / strike) + 0.5 * volatility * volatility * time)
    / sigmaRootTime;
  const d2 = d1 - sigmaRootTime;
  const discount = Math.exp(-rate * time);
  const price = optionRight === 'call'
    ? discount * (future * normalCdf(d1) - strike * normalCdf(d2))
    : discount * (strike * normalCdf(-d2) - future * normalCdf(-d1));
  const delta = discount * (optionRight === 'call' ? normalCdf(d1) : normalCdf(d1) - 1);
  const gamma = discount * normalPdf(d1) / (future * sigmaRootTime);
  return { price, delta, gamma, d1, d2 };
}

export function impliedVolatilityBlack76({
  price,
  future,
  strike,
  time,
  rate = 0.015,
  right,
}) {
  const optionRight = rightName(right);
  if (!(price > 0 && future > 0 && strike > 0 && time > 0) || !optionRight) return null;
  const discount = Math.exp(-rate * time);
  const intrinsic = discount * Math.max(
    optionRight === 'call' ? future - strike : strike - future,
    0,
  );
  const upperBound = discount * (optionRight === 'call' ? future : strike);
  if (price < intrinsic - 1e-8 || price > upperBound + 1e-8) return null;
  let low = 0.0001;
  let high = 5;
  const highPrice = black76Greeks({
    future, strike, time, volatility: high, rate, right: optionRight,
  })?.price;
  if (highPrice == null || price > highPrice) return null;
  for (let iteration = 0; iteration < 100; iteration += 1) {
    const middle = (low + high) / 2;
    const estimate = black76Greeks({
      future, strike, time, volatility: middle, rate, right: optionRight,
    }).price;
    if (estimate >= price) high = middle;
    else low = middle;
  }
  return (low + high) / 2;
}

export function deriveOptionGreeksProbe({
  checkedAt,
  futurePrice,
  expiry,
  contracts,
  rate = 0.015,
}) {
  const asOfMs = Date.parse(checkedAt);
  const expiryMs = Date.parse(`${expiry}T13:30:00+08:00`);
  const time = Number.isFinite(asOfMs) && Number.isFinite(expiryMs)
    ? (expiryMs - asOfMs) / YEAR_MS
    : null;
  if (!(futurePrice > 0 && time > 0) || !Array.isArray(contracts)) {
    throw new Error('option_greeks_probe_inputs_invalid');
  }
  const observations = contracts.map((contract) => {
    const right = rightName(contract.optionRight);
    const bid = Number(contract.bid);
    const ask = Number(contract.ask);
    const strike = Number(contract.strikePrice);
    const quoteValid = contract.validTwoSidedQuote === true
      && bid > 0 && ask >= bid && strike > 0 && right;
    if (!quoteValid) {
      return {
        code: contract.code,
        strike,
        right,
        status: 'UNKNOWN_INVALID_QUOTE',
        iv: null,
        delta: null,
        gamma: null,
      };
    }
    const mid = (bid + ask) / 2;
    const iv = impliedVolatilityBlack76({
      price: mid, future: futurePrice, strike, time, rate, right,
    });
    const greeks = iv == null ? null : black76Greeks({
      future: futurePrice, strike, time, volatility: iv, rate, right,
    });
    return {
      code: contract.code,
      strike,
      right,
      bid,
      ask,
      mid,
      providerSnapshotTimestamp: contract.timestamp ?? null,
      status: greeks ? 'CALCULATED_TIMESTAMP_PENDING_VALIDATION' : 'UNKNOWN_NO_SOLUTION',
      iv,
      delta: greeks?.delta ?? null,
      gamma: greeks?.gamma ?? null,
      repricingError: greeks ? greeks.price - mid : null,
    };
  });
  return {
    schemaVersion: 'v3.10-live-option-greeks-probe-v1',
    model: 'Black-76',
    calculationVersion: 'black76-mid-r1p5-v1',
    checkedAt,
    expiry,
    futurePrice,
    rate,
    timeYears: time,
    observations,
    calculated: observations.filter((row) => row.iv != null).length,
    timestampGate: 'PENDING_PROVIDER_SNAPSHOT_TS_SEMANTICS',
    formalModelWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

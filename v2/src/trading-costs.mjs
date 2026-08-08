const FUTURES = Object.freeze({
  TX: Object.freeze({ label: '大台 TX', pointValue: 200, commissionPerSide: 30 }),
  MTX: Object.freeze({ label: '小台 MTX', pointValue: 50, commissionPerSide: 17 }),
  TMF: Object.freeze({ label: '微台 TMF', pointValue: 10, commissionPerSide: 12 }),
});

const FUTURES_TAX_RATE = 0.00002;
const OPTION_TAX_RATE = 0.001;
const TXO_POINT_VALUE = 50;

function finiteNumber(value, name) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) throw new Error(`${name}_invalid`);
  return number;
}

export function futuresContract(instrument = 'TMF') {
  const contract = FUTURES[String(instrument).toUpperCase()];
  if (!contract) throw new Error('instrument_invalid');
  return { instrument: String(instrument).toUpperCase(), ...contract };
}

export function calculateFuturesRoundTripCost({
  instrument = 'TMF',
  entryPrice,
  exitPrice = entryPrice,
  commissionPerSide,
  slippagePointsRoundTrip = 2,
} = {}) {
  const contract = futuresContract(instrument);
  const entry = finiteNumber(entryPrice, 'entry_price');
  const exit = finiteNumber(exitPrice, 'exit_price');
  const commission = commissionPerSide == null ? contract.commissionPerSide : finiteNumber(commissionPerSide, 'commission');
  const slippagePoints = finiteNumber(slippagePointsRoundTrip, 'slippage');
  const entryTaxCash = entry * contract.pointValue * FUTURES_TAX_RATE;
  const exitTaxCash = exit * contract.pointValue * FUTURES_TAX_RATE;
  const commissionCash = commission * 2;
  const taxCash = entryTaxCash + exitTaxCash;
  const slippageCash = slippagePoints * contract.pointValue;
  const totalCash = commissionCash + taxCash + slippageCash;
  return {
    kind: 'futures_round_trip',
    instrument: contract.instrument,
    label: contract.label,
    pointValue: contract.pointValue,
    entryPrice: entry,
    exitPrice: exit,
    commissionPerSide: commission,
    commissionCash,
    taxRate: FUTURES_TAX_RATE,
    taxCash,
    slippagePoints,
    slippageCash,
    totalCash,
    totalPoints: totalCash / contract.pointValue,
  };
}

export function calculateOptionRoundTripCost({
  entryPremium,
  exitPremium = entryPremium,
  commissionPerSide = 14,
  slippagePremiumPointsRoundTrip = 1,
} = {}) {
  const entry = finiteNumber(entryPremium, 'entry_premium');
  const exit = finiteNumber(exitPremium, 'exit_premium');
  const commission = finiteNumber(commissionPerSide, 'commission');
  const slippagePoints = finiteNumber(slippagePremiumPointsRoundTrip, 'slippage');
  const taxCash = (entry + exit) * TXO_POINT_VALUE * OPTION_TAX_RATE;
  const commissionCash = commission * 2;
  const slippageCash = slippagePoints * TXO_POINT_VALUE;
  const totalCash = commissionCash + taxCash + slippageCash;
  return {
    kind: 'option_round_trip', instrument: 'TXO', label: '臺指選 TXO', pointValue: TXO_POINT_VALUE,
    entryPremium: entry, exitPremium: exit, commissionPerSide: commission, commissionCash,
    taxRate: OPTION_TAX_RATE, taxCash, slippagePoints, slippageCash, totalCash,
    totalPremiumPoints: totalCash / TXO_POINT_VALUE,
  };
}

export function costScenarios(referencePrice) {
  const price = Number(referencePrice);
  if (!Number.isFinite(price) || price <= 0) return [];
  return Object.keys(FUTURES).map((instrument) => calculateFuturesRoundTripCost({ instrument, entryPrice: price, exitPrice: price }));
}

export const tradingCostDefaults = Object.freeze({
  futuresTaxRate: FUTURES_TAX_RATE,
  optionTaxRate: OPTION_TAX_RATE,
  contracts: FUTURES,
  txo: Object.freeze({ pointValue: TXO_POINT_VALUE, commissionPerSide: 14 }),
});

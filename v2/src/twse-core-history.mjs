function number(value) {
  const cleaned = String(value ?? '').replaceAll(',', '').replace(/<[^>]+>/g, '').trim();
  if (!cleaned) return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function assertDate(payload, expectedDate, label) {
  if (payload?.stat !== 'OK') throw new Error(`${label}: ${payload?.stat || 'invalid response'}`);
  if (expectedDate && String(payload.date) !== String(expectedDate).replaceAll('-', '')) throw new Error(`${label}: response date mismatch`);
}

export function parseTwseIndexPayload(payload, expectedDate = null) {
  assertDate(payload, expectedDate, 'TWSE index');
  const rows = (payload.tables || []).flatMap((table) => table.data || []);
  const row = rows.find((item) => String(item?.[0] || '') === '發行量加權股價指數');
  if (!row) throw new Error('TWSE index: TAIEX row missing');
  const sign = String(row[2] || '').includes('-') ? -1 : 1;
  const change = number(row[3]);
  return { close: number(row[1]), change: change == null ? null : sign * Math.abs(change), changePct: number(row[4]) };
}

export function parseTwseInstitutionPayload(payload, expectedDate = null) {
  assertDate(payload, expectedDate, 'TWSE institutions');
  const result = {
    foreignBuyE: null, foreignSellE: null, foreignNetE: null,
    trustBuyE: null, trustSellE: null, trustNetE: null,
    dealerProprietaryBuyE: null, dealerProprietarySellE: null, dealerProprietaryNetE: null,
    dealerHedgeBuyE: null, dealerHedgeSellE: null, dealerHedgeNetE: null,
  };
  for (const row of payload.data || []) {
    const name = String(row?.[0] || '');
    const buy = number(row?.[1]); const sell = number(row?.[2]); const net = number(row?.[3]);
    if (net == null) continue;
    const values = { buy: buy == null ? null : buy / 1e8, sell: sell == null ? null : sell / 1e8, net: net / 1e8 };
    if (name.startsWith('外資及陸資')) Object.assign(result, { foreignBuyE: values.buy, foreignSellE: values.sell, foreignNetE: values.net });
    else if (name === '投信') Object.assign(result, { trustBuyE: values.buy, trustSellE: values.sell, trustNetE: values.net });
    else if (name.includes('自營商') && name.includes('自行買賣')) Object.assign(result, { dealerProprietaryBuyE: values.buy, dealerProprietarySellE: values.sell, dealerProprietaryNetE: values.net });
    else if (name.includes('自營商') && name.includes('避險')) Object.assign(result, { dealerHedgeBuyE: values.buy, dealerHedgeSellE: values.sell, dealerHedgeNetE: values.net });
  }
  if (result.foreignNetE == null || result.trustNetE == null) throw new Error('TWSE institutions: required rows missing');
  result.dealerTotalNetE = Number(result.dealerProprietaryNetE || 0) + Number(result.dealerHedgeNetE || 0);
  result.institutionalTotalE = result.foreignNetE + result.trustNetE + result.dealerTotalNetE;
  const buyParts = [result.foreignBuyE, result.trustBuyE, result.dealerProprietaryBuyE, result.dealerHedgeBuyE];
  const sellParts = [result.foreignSellE, result.trustSellE, result.dealerProprietarySellE, result.dealerHedgeSellE];
  result.institutionalBuyE = buyParts.every((value) => value != null) ? buyParts.reduce((sum, value) => sum + value, 0) : null;
  result.institutionalSellE = sellParts.every((value) => value != null) ? sellParts.reduce((sum, value) => sum + value, 0) : null;
  return result;
}

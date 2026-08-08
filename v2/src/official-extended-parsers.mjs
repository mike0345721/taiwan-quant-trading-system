import crypto from 'node:crypto';

const number = (value) => {
  const parsed = Number(String(value ?? '').replaceAll(',', '').replace(/<[^>]+>/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
};

export const payloadHash = (payload) => crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex');

export function parseTwseBreadth(payload) {
  const table = (payload?.tables || []).find((item) => item.title === '漲跌證券數合計');
  if (!table) throw new Error('TWSE breadth table missing');
  const parse = (label) => {
    const row = table.data.find((cells) => String(cells[0]).startsWith(label));
    const match = String(row?.[2] ?? '').match(/([\d,]+)(?:\(([\d,]+)\))?/);
    return { count: number(match?.[1]), limit: number(match?.[2]) };
  };
  const advance = parse('上漲'); const decline = parse('下跌'); const unchanged = parse('持平');
  if ([advance.count, decline.count].some((value) => value == null)) throw new Error('TWSE breadth values missing');
  return { advance: advance.count, decline: decline.count, unchanged: unchanged.count,
    limitUp: advance.limit, limitDown: decline.limit, universeScope: 'TWSE_COMMON_STOCK_COLUMN' };
}

export function parseTpexBreadth(payload) {
  const table = payload?.tables?.find((item) => Array.isArray(item.fields) && item.fields.includes('代號') && item.fields.includes('漲跌'));
  if (!table) throw new Error('TPEx daily quotes table missing');
  let advance = 0; let decline = 0; let unchanged = 0; let limitUp = 0; let limitDown = 0;
  for (const cells of table.data || []) {
    const symbol = String(cells[0] || '').trim();
    if (!/^\d{4}$/.test(symbol)) continue;
    const change = number(cells[3]); const close = number(cells[2]);
    if (change == null || close == null) continue;
    if (change > 0) advance += 1; else if (change < 0) decline += 1; else unchanged += 1;
    const previous = close - change;
    if (previous > 0 && change / previous >= 0.095) limitUp += 1;
    if (previous > 0 && change / previous <= -0.095) limitDown += 1;
  }
  if (!advance && !decline) throw new Error('TPEx breadth values missing');
  return { advance, decline, unchanged, limitUp, limitDown,
    universeScope: 'TPEX_FOUR_DIGIT_COMMON_STOCKS', derivation: 'individual_official_quotes_change; limit threshold abs(change/previous)>=9.5%' };
}

export function parseTwseLendingBalance(payload) {
  if (payload?.stat !== 'OK' || !Array.isArray(payload.data)) throw new Error('TWSE lending balance unavailable');
  const totals = { lendingNew: 0, lendingReturn: 0, lendingBalance: 0 };
  for (const cells of payload.data) {
    if (!/^\d{4}$/.test(String(cells[0] || '').trim())) continue;
    totals.lendingNew += number(cells[3]) || 0;
    totals.lendingReturn += number(cells[4]) || 0;
    totals.lendingBalance += number(cells[5]) || 0;
  }
  return totals;
}

export function parseTwseShortLending(payload) {
  if (payload?.stat !== 'OK' || !Array.isArray(payload.data)) throw new Error('TWSE short-lending data unavailable');
  const totals = { shortSaleQuantity: 0, shortSaleBuyback: 0, shortSaleAdjustment: 0, shortSaleBalance: 0, availableToShort: 0 };
  for (const cells of payload.data) {
    if (!/^\d{4}$/.test(String(cells[0] || '').trim())) continue;
    totals.shortSaleQuantity += number(cells[9]) || 0;
    totals.shortSaleBuyback += number(cells[10]) || 0;
    totals.shortSaleAdjustment += number(cells[11]) || 0;
    totals.shortSaleBalance += number(cells[12]) || 0;
    totals.availableToShort += number(cells[13]) || 0;
  }
  return totals;
}

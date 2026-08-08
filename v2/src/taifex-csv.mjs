function numeric(value) {
  const text = String(value ?? '').replaceAll(',', '').replace('%', '').trim();
  if (!text || text === '-') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

function integer(value) {
  const number = numeric(value);
  return number == null ? null : Math.trunc(number);
}

function isoDate(value) {
  const text = String(value || '').trim().replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function parseCsv(text) {
  const rows = [];
  let row = []; let field = ''; let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { field += '"'; index += 1; }
      else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field.trim()); field = '';
    } else if ((char === '\n' || char === '\r') && !quoted) {
      if (char === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field.trim()); field = '';
      if (row.some((item) => item !== '')) rows.push(row);
      row = [];
    } else field += char;
  }
  if (field || row.length) { row.push(field.trim()); rows.push(row); }
  return rows;
}

export function parseFuturesCsv(text) {
  const rows = parseCsv(text);
  if (!rows[0]?.[0]?.includes('交易日期')) throw new Error('TAIFEX futures CSV header not recognized');
  return rows.slice(1).map((cells) => ({
    tradeDate: isoDate(cells[0]), product: String(cells[1] || '').trim(), contract: String(cells[2] || '').trim(),
    open: numeric(cells[3]), high: numeric(cells[4]), low: numeric(cells[5]), close: numeric(cells[6]), change: numeric(cells[7]), changePct: numeric(cells[8]),
    volume: integer(cells[9]), settlement: numeric(cells[10]), openInterest: integer(cells[11]), bestBid: numeric(cells[12]), bestAsk: numeric(cells[13]),
    session: String(cells[17] || '').trim(),
  })).filter((row) => row.tradeDate && row.product === 'TX' && row.contract && row.session === '一般');
}

export function parseOptionsCsv(text) {
  const rows = parseCsv(text);
  if (!rows[0]?.[0]?.includes('交易日期')) throw new Error('TAIFEX options CSV header not recognized');
  return rows.slice(1).map((cells) => ({
    tradeDate: isoDate(cells[0]), product: String(cells[1] || '').trim(), contract: String(cells[2] || '').trim(), strike: numeric(cells[3]),
    right: String(cells[4] || '').trim(), open: numeric(cells[5]), high: numeric(cells[6]), low: numeric(cells[7]), close: numeric(cells[8]),
    volume: integer(cells[9]) || 0, settlement: numeric(cells[10]), openInterest: integer(cells[11]), session: String(cells[17] || '').trim(),
  })).filter((row) => row.tradeDate && row.product === 'TXO' && row.contract && row.strike != null && row.session === '一般' && row.openInterest != null);
}

function nthWeekday(year, month, weekday, occurrence) {
  const date = new Date(Date.UTC(year, month - 1, 1));
  const offset = (weekday - date.getUTCDay() + 7) % 7;
  date.setUTCDate(1 + offset + (occurrence - 1) * 7);
  return date.toISOString().slice(0, 10);
}

export function optionContractType(contract) {
  return /(?:W|F)\d$/i.test(contract) ? 'weekly' : /^\d{6}$/.test(contract) ? 'monthly' : 'other';
}

export function estimatedOptionExpiry(contract) {
  const weekly = String(contract).match(/^(\d{4})(\d{2})(W|F)(\d)$/i);
  if (weekly) return nthWeekday(Number(weekly[1]), Number(weekly[2]), weekly[3].toUpperCase() === 'W' ? 3 : 5, Number(weekly[4]));
  const monthly = String(contract).match(/^(\d{4})(\d{2})$/);
  return monthly ? nthWeekday(Number(monthly[1]), Number(monthly[2]), 3, 3) : null;
}

export function calendarDaysUntil(expiry, tradeDate) {
  if (!expiry || !tradeDate) return null;
  return Math.round((new Date(`${expiry}T00:00:00Z`) - new Date(`${tradeDate}T00:00:00Z`)) / 86_400_000);
}

export function optionStructure(strikes) {
  const rows = [...strikes.values()];
  const topCall = [...rows].sort((a, b) => b.callOi - a.callOi)[0] || null;
  const topPut = [...rows].sort((a, b) => b.putOi - a.putOi)[0] || null;
  let maxPain = null; let minimum = Number.POSITIVE_INFINITY;
  for (const candidate of rows) {
    let pain = 0;
    for (const item of rows) {
      pain += Math.max(0, candidate.strike - item.strike) * item.callOi;
      pain += Math.max(0, item.strike - candidate.strike) * item.putOi;
    }
    if (pain < minimum) { minimum = pain; maxPain = candidate.strike; }
  }
  return {
    callWall: topCall ? { strike: topCall.strike, openInterest: topCall.callOi } : null,
    putWall: topPut ? { strike: topPut.strike, openInterest: topPut.putOi } : null,
    maxPain,
  };
}

export function monthRanges(startDate, endDate) {
  const ranges = [];
  const start = new Date(`${startDate}T00:00:00Z`); const end = new Date(`${endDate}T00:00:00Z`);
  let cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor <= end) {
    const monthStart = new Date(Math.max(cursor.getTime(), start.getTime()));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0));
    ranges.push({ start: monthStart.toISOString().slice(0, 10), end: new Date(Math.min(monthEnd.getTime(), end.getTime())).toISOString().slice(0, 10) });
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return ranges;
}

import { parseCsv } from '../v2/src/taifex-csv.mjs';
import { parseTaifexPositionCsv } from '../v2/src/taifex-position-parser.mjs';

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const USER_AGENT = 'tw-chip-dashboard-v1/1.1 official-fallback';

function numeric(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').replace('%', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function integer(value) {
  const parsed = numeric(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function isoDate(value) {
  const normalized = String(value || '').trim().replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function slash(date) {
  return String(date).replaceAll('-', '/');
}

function dateRange(dates) {
  const sorted = [...dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (!sorted.length) throw new Error('缺少有效查詢日期');
  return { start: sorted[0], end: sorted.at(-1) };
}

async function postOfficial(url, body, { timeoutMs, fetchImpl = fetch } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'POST',
      body: new URLSearchParams(body),
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': USER_AGENT,
        Accept: 'text/csv,text/html;q=0.9,*/*;q=0.8',
      },
      redirect: 'error',
    });
    if (!response?.ok) throw new Error(`HTTP ${response?.status || 'no response'}`);
    const buffer = Buffer.from(await response.arrayBuffer());
    if (!buffer.length || buffer.length > MAX_RESPONSE_BYTES) throw new Error('官方回應大小異常');
    return buffer;
  } finally {
    clearTimeout(timer);
  }
}

function decodeBig5(buffer) {
  return new TextDecoder('big5').decode(buffer);
}

export function parseOfficialFuturesCsv(text) {
  const rows = parseCsv(text);
  if (!rows[0]?.[0]?.includes('交易日期')) throw new Error('期貨 CSV 標題不符');
  return rows.slice(1).map((cells) => ({
    tradeDate: isoDate(cells[0]),
    product: String(cells[1] || '').trim(),
    contract: String(cells[2] || '').trim(),
    open: numeric(cells[3]),
    high: numeric(cells[4]),
    low: numeric(cells[5]),
    close: numeric(cells[6]),
    change: numeric(cells[7]),
    changePct: numeric(cells[8]),
    volume: integer(cells[9]),
    settlement: numeric(cells[10]),
    openInterest: integer(cells[11]),
    session: String(cells[17] || '').trim(),
  })).filter((row) => row.tradeDate && ['TX', 'TMF'].includes(row.product) && row.contract);
}

export function parseOfficialOptionsCsv(text) {
  const rows = parseCsv(text);
  if (!rows[0]?.[0]?.includes('交易日期')) throw new Error('選擇權 CSV 標題不符');
  return rows.slice(1).map((cells) => ({
    tradeDate: isoDate(cells[0]),
    product: String(cells[1] || '').trim(),
    contract: String(cells[2] || '').trim(),
    strike: numeric(cells[3]),
    right: String(cells[4] || '').trim(),
    volume: integer(cells[9]) || 0,
    openInterest: integer(cells[11]),
    session: String(cells[17] || '').trim(),
  })).filter((row) => row.tradeDate && row.product === 'TXO' && row.contract && row.strike != null && row.openInterest != null);
}

function latestRows(rows) {
  const latestDate = rows.map((row) => row.tradeDate).filter(Boolean).sort().at(-1);
  if (!latestDate) throw new Error('官方 CSV 沒有有效交易日');
  return { dataDate: latestDate, rows: rows.filter((row) => row.tradeDate === latestDate) };
}

export async function fetchOfficialFutures(dates, options) {
  const range = dateRange(dates);
  const download = async (commodity) => {
    const buffer = await postOfficial('https://www.taifex.com.tw/cht/3/futDataDown', {
      down_type: '1', queryStartDate: slash(range.start), queryEndDate: slash(range.end), commodity_id: commodity, commodity_id2: '',
    }, options);
    return latestRows(parseOfficialFuturesCsv(decodeBig5(buffer)));
  };
  const [tx, tmf] = await Promise.all([download('TX'), download('TMF')]);
  const dataDate = [tx.dataDate, tmf.dataDate].sort().at(-1);
  return { dataDate, rows: [...tx.rows, ...tmf.rows].filter((row) => row.tradeDate === dataDate) };
}

export async function fetchOfficialOptions(dates, options) {
  const range = dateRange(dates);
  const buffer = await postOfficial('https://www.taifex.com.tw/cht/3/optDataDown', {
    down_type: '1', queryStartDate: slash(range.start), queryEndDate: slash(range.end), commodity_id: 'TXO', commodity_id2: '',
  }, options);
  return latestRows(parseOfficialOptionsCsv(decodeBig5(buffer)));
}

export async function fetchOfficialPositions(dates, options) {
  const range = dateRange(dates);
  const buffer = await postOfficial('https://www.taifex.com.tw/cht/3/futContractsDateDown', {
    queryStartDate: slash(range.start), queryEndDate: slash(range.end), commodityId: 'TXF',
  }, options);
  const byDate = parseTaifexPositionCsv(decodeBig5(buffer));
  const dataDate = [...byDate.keys()].sort().at(-1);
  if (!dataDate) throw new Error('法人 CSV 沒有臺股期貨資料');
  return { dataDate, data: byDate.get(dataDate) };
}

function plainCell(html) {
  const withoutTags = String(html).replace(/<[^>]+>/g, ' ');
  return withoutTags
    .replaceAll('&nbsp;', ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&#40;', '(')
    .replaceAll('&#41;', ')')
    .replace(/\s+/g, ' ')
    .trim();
}

function leadingInteger(value) {
  const match = String(value || '').match(/[\d,]+/);
  return match ? integer(match[0]) : null;
}

function positionCell(value) {
  const values = [...String(value || '').matchAll(/[\d,]+/g)].map((match) => integer(match[0]));
  return { total: values[0] ?? null, specific: values[1] ?? null };
}

function largeTraderRow(cells, scope) {
  const top5Long = positionCell(cells[1]);
  const top10Long = positionCell(cells[3]);
  const top5Short = positionCell(cells[5]);
  const top10Short = positionCell(cells[7]);
  return {
    scope,
    scopeLabel: String(cells[0] || '').trim(),
    top5Long: top5Long.total,
    top5LongSpecific: top5Long.specific,
    top10Long: top10Long.total,
    top10LongSpecific: top10Long.specific,
    top5Short: top5Short.total,
    top5ShortSpecific: top5Short.specific,
    top10Short: top10Short.total,
    top10ShortSpecific: top10Short.specific,
    marketOi: leadingInteger(cells[9]),
  };
}

function parseOfficialLargeTraderHtmlLegacy(html) {
  const date = String(html).match(/(\d{4}\/\d{2}\/\d{2})\s*(?:<[^>]*>\s*)*\(交易資訊含所有商品及鉅額交易\)/)?.[1];
  const tableRows = [...String(html).matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plainCell(cell[1])),
  );
  const productIndex = tableRows.findIndex((cells) => cells.some((cell) => cell.includes('臺股期貨(TX+MTX/4+TMF/20)')));
  if (productIndex < 0) throw new Error('大額交易人表格缺少臺股期貨');
  const allContracts = tableRows.slice(productIndex, productIndex + 5)
    .find((cells) => String(cells[0] || '').replace(/\s/g, '').includes('所有契約'));
  if (!allContracts || allContracts.length < 10) throw new Error('大額交易人表格缺少所有契約列');
  const data = {
    top5Long: leadingInteger(allContracts[1]),
    top10Long: leadingInteger(allContracts[3]),
    top5Short: leadingInteger(allContracts[5]),
    top10Short: leadingInteger(allContracts[7]),
    marketOi: leadingInteger(allContracts[9]),
  };
  if (Object.values(data).some((value) => value == null)) throw new Error('大額交易人表格數值不完整');
  return { dataDate: isoDate(date), data };
}

export function parseOfficialLargeTraderHtml(html) {
  const source = String(html);
  const date = source.match(/(\d{4}\/\d{2}\/\d{2})/)?.[1];
  const tableRows = [...source.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((match) =>
    [...match[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plainCell(cell[1])),
  );
  const productIndex = tableRows.findIndex((cells) => cells.some((cell) => cell.includes('TX+MTX/4+TMF/20')));
  if (productIndex < 0) return parseOfficialLargeTraderHtmlLegacy(html);
  const candidates = tableRows.slice(productIndex + 1, productIndex + 8)
    .filter((cells) => cells.length >= 10 && [1, 3, 5, 7, 9].every((index) => leadingInteger(cells[index]) != null));
  if (!candidates.length) return parseOfficialLargeTraderHtmlLegacy(html);

  const scopes = candidates.map((cells, index) => {
    const label = String(cells[0] || '').replace(/\s/g, '');
    const scope = index === candidates.length - 1
      ? 'all_contracts'
      : /W\d/i.test(label) ? 'weekly' : 'near_month';
    return largeTraderRow(cells, scope);
  });
  const allContracts = scopes.at(-1);
  if ([allContracts.top5Long, allContracts.top10Long, allContracts.top5Short, allContracts.top10Short, allContracts.marketOi]
    .some((value) => value == null)) throw new Error('Invalid official large-trader table values');
  return { dataDate: isoDate(date), data: { ...allContracts, scopes } };
}

export async function fetchOfficialLargeTraders(dates, options = {}) {
  let lastError = null;
  for (const date of [...dates].sort().reverse()) {
    try {
      const buffer = await postOfficial('https://www.taifex.com.tw/cht/3/largeTraderFutQry', {
        queryDate: slash(date), contractId: 'TX', contractId2: 'TX', datecount: '',
      }, options);
      const parsed = parseOfficialLargeTraderHtml(buffer.toString('utf8'));
      if (parsed.dataDate) return parsed;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError || new Error('大額交易人官網查無近期資料');
}

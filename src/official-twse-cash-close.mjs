const TWSE_INDEX_URL = 'https://openapi.twse.com.tw/v1/exchangeReport/MI_INDEX';
const INDEX_NAME = '發行量加權股價指數';
const CLOSE_HOUR_UTC = '05:30:00.000Z'; // 13:30 Taiwan cash market close

export function parseOfficialTaiexClose(rows, { receivedAt, expectedCashDate, now = new Date() } = {}) {
  if (!Array.isArray(rows) || typeof receivedAt !== 'string') return null;
  const receivedMs = Date.parse(receivedAt);
  if (!Number.isFinite(receivedMs) || !/^\d{4}-\d{2}-\d{2}$/.test(expectedCashDate || '')) return null;
  const matches = rows.filter((row) => row && row['指數'] === INDEX_NAME);
  if (matches.length !== 1) return null;
  const row = matches[0];
  const rocDate = String(row['日期'] || '');
  if (!/^\d{7}$/.test(rocDate)) return null;
  const y = Number(rocDate.slice(0, 3)) + 1911;
  const m = rocDate.slice(3, 5);
  const d = rocDate.slice(5, 7);
  const dataDate = `${y}-${m}-${d}`;
  if (!Number.isFinite(Date.parse(dataDate + 'T00:00:00.000Z'))
      || new Date(dataDate + 'T00:00:00.000Z').toISOString().slice(0, 10) !== dataDate
      || dataDate !== expectedCashDate) return null;
  const closeMs = Date.parse(dataDate + 'T' + CLOSE_HOUR_UTC);
  if (receivedMs < closeMs || receivedMs > now.getTime() + 5_000) return null;
  if (String(row['特殊處理註記'] || '').trim()) return null;
  const raw = String(row['收盤指數'] || '').replaceAll(',', '');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const close = Number(raw);
  if (!Number.isFinite(close) || close <= 0) return null;
  return Object.freeze({
    kind: 'TWSE_OFFICIAL_TAIEX_CASH_CLOSE',
    indexName: INDEX_NAME,
    date: dataDate,
    close,
    receivedAt,
    publisherTimestamp: null, // API's field describes date, not authoritative publication time.
    source: 'TWSE_OPENAPI_MI_INDEX',
    sourceUrl: TWSE_INDEX_URL,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export async function fetchOfficialTaiexClose({
  expectedCashDate, now = new Date(), fetchImpl = fetch, timeoutMs = 4_000,
} = {}) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(expectedCashDate || '')) return null;
  let response;
  try {
    response = await fetchImpl(TWSE_INDEX_URL, { signal: AbortSignal.timeout(timeoutMs) });
    if (!response?.ok) return null;
    return parseOfficialTaiexClose(await response.json(), {
      receivedAt: now.toISOString(), expectedCashDate, now, now,
    });
  } catch { return null; }
}

export { TWSE_INDEX_URL };

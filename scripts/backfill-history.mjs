import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const historyDir = path.join(root, 'data', 'history');
const timeoutMs = 20_000;

function num(value) {
  const parsed = Number.parseFloat(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : 0;
}

function compact(date) { return date.replaceAll('-', ''); }
function slash(date) { return date.replaceAll('-', '/'); }

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal, headers: { 'User-Agent': 'tw-chip-dashboard-v1/1.4', ...(options.headers || {}) } });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response;
  } finally { clearTimeout(timer); }
}

async function fetchIndexDates() {
  const payload = await (await fetchWithTimeout('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=2y')).json();
  const result = payload?.chart?.result?.[0];
  const timestamps = result?.timestamp || [];
  const closes = result?.indicators?.quote?.[0]?.close || [];
  const cutoff = Date.now() - 370 * 86_400_000;
  const map = new Map();
  timestamps.forEach((timestamp, index) => {
    const close = Number(closes[index]);
    if (!Number.isFinite(close) || timestamp * 1000 < cutoff) return;
    const date = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei' }).format(new Date(timestamp * 1000));
    map.set(date, close);
  });
  return map;
}

async function fetchFuturesInstitutions(startDate, endDate) {
  const body = new URLSearchParams({ queryStartDate: slash(startDate), queryEndDate: slash(endDate), commodityId: 'TXF' });
  const response = await fetchWithTimeout('https://www.taifex.com.tw/cht/3/futContractsDateDown', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body,
  });
  const text = new TextDecoder('big5').decode(await response.arrayBuffer());
  const result = new Map();
  for (const line of text.split(/\r?\n/).slice(1)) {
    const cells = line.split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
    if (cells.length < 14 || cells[1] !== '臺股期貨') continue;
    const date = cells[0].replaceAll('/', '-');
    const item = result.get(date) || {};
    const parsed = { long: Math.trunc(num(cells[9])), short: Math.trunc(num(cells[11])), net: Math.trunc(num(cells[13])) };
    if (cells[2].includes('外資')) item.foreign = parsed;
    else if (cells[2].includes('自營商')) item.dealer = parsed;
    else if (cells[2].includes('投信')) item.trust = parsed;
    result.set(date, item);
  }
  return result;
}

async function latestOfficialDate() {
  const rows = await (await fetchWithTimeout('https://openapi.taifex.com.tw/v1/DailyMarketReportFut')).json();
  const value = String(rows?.[0]?.Date || '');
  return /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
}

async function fetchSpot(date) {
  const payload = await (await fetchWithTimeout(`https://www.twse.com.tw/fund/BFI82U?response=json&dayDate=${compact(date)}&type=day`)).json();
  if (payload?.stat !== 'OK' || !payload.data?.length || payload.date !== compact(date)) return null;
  const data = { foreignNetE: 0, trustNetE: 0, dealerProprietaryNetE: 0, dealerHedgeNetE: 0 };
  for (const row of payload.data) {
    const name = String(row?.[0] || '');
    const netE = num(row?.[3]) / 1e8;
    if (name.includes('外資') && name.includes('陸資')) data.foreignNetE = netE;
    else if (name.includes('投信')) data.trustNetE = netE;
    else if (name.includes('自營商') && name.includes('自行')) data.dealerProprietaryNetE = netE;
    else if (name.includes('自營商') && name.includes('避險')) data.dealerHedgeNetE = netE;
  }
  data.dealerTotalNetE = data.dealerProprietaryNetE + data.dealerHedgeNetE;
  return data;
}

async function readExisting(date) {
  try { return JSON.parse(await fs.readFile(path.join(historyDir, `${date}.json`), 'utf8')); } catch { return {}; }
}

async function saveDate(date, close, spot, institution) {
  const existing = await readExisting(date);
  const fetchedAt = new Date().toISOString();
  const foreign = institution?.foreign || {};
  const dealer = institution?.dealer || {};
  const trust = institution?.trust || {};
  const snapshot = {
    ...existing,
    schemaVersion: 1,
    dataMode: 'live',
    asOfDate: date,
    generatedAt: existing.generatedAt || fetchedAt,
    marketOverview: { ...(existing.marketOverview || {}), ok: true, source: 'Historical daily index', dataDate: date, fetchedAt, stale: true, data: { ...(existing.marketOverview?.data || {}), twii: { ...(existing.marketOverview?.data?.twii || {}), price: close } } },
    spotInstitutional: { ok: true, source: 'TWSE BFI82U historical', dataDate: date, fetchedAt, stale: true, data: spot },
    futuresInstitutional: {
      ok: Boolean(institution?.foreign), source: 'TAIFEX TXF historical', dataDate: date, fetchedAt, stale: true,
      data: {
        foreignLong: foreign.long ?? null, foreignShort: foreign.short ?? null, foreignNet: foreign.net ?? null,
        dealerLong: dealer.long ?? null, dealerShort: dealer.short ?? null, dealerNet: dealer.net ?? null,
        trustLong: trust.long ?? null, trustShort: trust.short ?? null, trustNet: trust.net ?? null,
        deltaAvailable: false,
      },
    },
  };
  await fs.writeFile(path.join(historyDir, `${date}.json`), `${JSON.stringify(snapshot, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
}

await fs.mkdir(historyDir, { recursive: true });
const indexDates = await fetchIndexDates();
const officialLastDate = await latestOfficialDate();
const dates = [...indexDates.keys()].filter((date) => !officialLastDate || date <= officialLastDate).sort();
if (!dates.length) throw new Error('找不到一年指數交易日');
const institutions = await fetchFuturesInstitutions(dates[0], dates.at(-1));
let saved = 0; let failed = 0;
for (let offset = 0; offset < dates.length; offset += 5) {
  const batch = dates.slice(offset, offset + 5);
  const spots = await Promise.all(batch.map((date) => fetchSpot(date).catch(() => null)));
  for (let index = 0; index < batch.length; index += 1) {
    const date = batch[index];
    if (!spots[index]) { failed += 1; continue; }
    await saveDate(date, indexDates.get(date), spots[index], institutions.get(date));
    saved += 1;
  }
}
console.log(JSON.stringify({ ok: true, requestedDays: dates.length, savedDays: saved, failedDays: failed, futuresDays: institutions.size, firstDate: dates[0], lastDate: dates.at(-1) }, null, 2));

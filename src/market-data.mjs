import { createMockSnapshot } from './mock-data.mjs';
import { buildSignal } from './signal-engine.mjs';
import { sourceQualityMetadata } from './data-quality.mjs';
import {
  fetchOfficialFutures,
  fetchOfficialLargeTraders,
  fetchOfficialOptions,
  fetchOfficialPositions,
} from './taifex-official.mjs';

const TAIPEI_TZ = 'Asia/Taipei';
const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

function number(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').replace('%', '').trim();
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function integer(value) {
  return Math.trunc(number(value));
}

function nullableNumber(value) {
  const cleaned = String(value ?? '').replace(/,/g, '').replace('%', '').trim();
  if (!cleaned || cleaned === '-' || cleaned === '--') return null;
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function nullableInteger(value) {
  const parsed = nullableNumber(value);
  return parsed == null ? null : Math.trunc(parsed);
}

function dateTaipei(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TAIPEI_TZ }).format(date);
}

function recentDates(days = 10) {
  const result = [];
  const now = new Date();
  for (let offset = 0; offset < days; offset += 1) {
    const date = new Date(now.getTime() - offset * 86_400_000);
    result.push(dateTaipei(date));
  }
  return result;
}

function compactDate(date) {
  return String(date).replaceAll('-', '');
}

function sourceResult(source, { ok, data = null, dataDate = null, error = null, fetchedAt = new Date().toISOString(), stale = false } = {}) {
  return { ok: Boolean(ok), source, data, dataDate, error, fetchedAt, stale };
}

async function fetchJson(url, { timeoutMs, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        'User-Agent': 'tw-chip-dashboard-v1/1.0',
        'Accept': 'application/json',
        ...headers,
      },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const declared = Number.parseInt(response.headers.get('content-length') || '0', 10);
    if (declared > MAX_RESPONSE_BYTES) throw new Error('上游回應過大');
    const text = await response.text();
    if (Buffer.byteLength(text) > MAX_RESPONSE_BYTES) throw new Error('上游回應過大');
    return JSON.parse(text);
  } finally {
    clearTimeout(timer);
  }
}

async function fetchText(url, { timeoutMs, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'tw-chip-dashboard-v1/1.0', ...headers },
      redirect: 'error',
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_RESPONSE_BYTES) throw new Error('上游回應過大');
    return bytes.toString('latin1');
  } finally {
    clearTimeout(timer);
  }
}

async function firstSuccessful(dates, fetcher) {
  let lastError = null;
  for (const date of dates) {
    try {
      const data = await fetcher(date);
      if (data) return { date, data };
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError) throw lastError;
  throw new Error('最近交易日查無資料');
}

function parseYahoo(payload, name) {
  const result = payload?.chart?.result?.[0];
  const meta = result?.meta;
  if (!meta || !Number.isFinite(Number(meta.regularMarketPrice))) throw new Error(`${name} 無報價`);
  const price = number(meta.regularMarketPrice);
  const closes = (result?.indicators?.quote?.[0]?.close || []).map(number).filter((item) => item > 0);
  const previousClose = closes.length >= 2 ? closes.at(-2) : number(meta.chartPreviousClose ?? meta.previousClose);
  return {
    name,
    price,
    previousClose,
    change: price - previousClose,
    changePct: previousClose ? ((price - previousClose) / previousClose) * 100 : 0,
    dayHigh: number(meta.regularMarketDayHigh),
    dayLow: number(meta.regularMarketDayLow),
    marketTime: meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : null,
  };
}

async function fetchMarketOverview(timeoutMs) {
  const source = 'Yahoo Finance';
  try {
    const [twiiRaw, otcRaw, fxRaw, vixRaw] = await Promise.all([
      fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5ETWII?interval=1d&range=5d', { timeoutMs }),
      fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/IX0043.TWO?interval=1d&range=5d', { timeoutMs }),
      fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/USDTWD=X?interval=1d&range=2d', { timeoutMs }),
      fetchJson('https://query1.finance.yahoo.com/v8/finance/chart/%5EVIX?interval=1d&range=2d', { timeoutMs }),
    ]);
    const twii = parseYahoo(twiiRaw, '加權指數');
    const otc = parseYahoo(otcRaw, '櫃買指數');
    const marketDate = twii.marketTime ? dateTaipei(new Date(twii.marketTime)) : dateTaipei();
    return sourceResult(source, {
      ok: true,
      dataDate: marketDate,
      stale: marketDate !== dateTaipei(),
      data: {
        twii,
        otc,
        usdtwd: number(fxRaw?.chart?.result?.[0]?.meta?.regularMarketPrice),
        vix: number(vixRaw?.chart?.result?.[0]?.meta?.regularMarketPrice),
      },
    });
  } catch (error) {
    return sourceResult(source, { ok: false, error: error.message });
  }
}

async function fetchTaiwanVix(timeoutMs) {
  const source = 'TAIFEX TAIWAN VIX';
  try {
    const found = await firstSuccessful(recentDates(), async (date) => {
      const text = await fetchText(`https://www.taifex.com.tw/cht/7/getVixData?filesname=${compactDate(date)}`, { timeoutMs });
      const close = number(text.match(/Last\s+1\s+min\s+AVG\s+([0-9.]+)/i)?.[1]);
      if (close <= 0) return null;
      const points = [...text.matchAll(/^(\d{8})\s+(\d{7,8})\s+([0-9.]+)\s*$/gm)];
      return { close, intradayPoints: points.length };
    });
    return sourceResult(source, { ok: true, dataDate: found.date, data: found.data, stale: found.date !== dateTaipei() });
  } catch (error) {
    return sourceResult(source, { ok: false, error: error.message });
  }
}

async function fetchListedBreadth(timeoutMs) {
  const source = 'TWSE MI_INDEX';
  try {
    const found = await firstSuccessful(recentDates(), async (date) => {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/afterTrading/MI_INDEX?response=json&date=${compactDate(date)}&type=MS`, { timeoutMs });
      if (payload?.stat !== 'OK') return null;
      const table = payload.tables?.find((item) => Array.isArray(item?.data) && item.data.some((row) => String(row?.[0] || '').includes('上漲')));
      if (!table) return null;
      const fields = table.fields || [];
      const stockIndex = fields.indexOf('股票');
      const column = stockIndex >= 0 ? stockIndex : 1;
      const up = table.data.find((row) => String(row?.[0] || '').includes('上漲'));
      const down = table.data.find((row) => String(row?.[0] || '').includes('下跌'));
      const flat = table.data.find((row) => String(row?.[0] || '').includes('持平'));
      const parseCount = (raw) => integer(String(raw || '').split('(')[0]);
      const parseLimit = (raw) => integer(String(raw || '').match(/\((\d+)\)/)?.[1]);
      let turnoverE = 0;
      for (const candidate of payload.tables || []) {
        for (const row of candidate?.data || []) {
          if (String(row?.[0] || '').includes('成交金額')) {
            turnoverE = number(row?.[1]) / 1e8;
            break;
          }
        }
        if (turnoverE > 0) break;
      }
      return {
        __dataDate: normalizeApiDate(payload.date) || date,
        advance: parseCount(up?.[column]),
        decline: parseCount(down?.[column]),
        unchanged: parseCount(flat?.[column]),
        limitUp: parseLimit(up?.[column]),
        limitDown: parseLimit(down?.[column]),
        turnoverE,
      };
    });
    const dataDate = found.data.__dataDate || found.date;
    const { __dataDate, ...data } = found.data;
    return sourceResult(source, { ok: true, dataDate, data, stale: dataDate !== dateTaipei() });
  } catch (error) {
    return sourceResult(source, { ok: false, error: error.message });
  }
}

async function fetchOtcBreadth(timeoutMs) {
  const source = 'TPEx OpenAPI';
  try {
    const payload = await fetchJson('https://www.tpex.org.tw/openapi/v1/tpex_mainborad_highlight', { timeoutMs });
    const row = payload?.[0];
    if (!row) throw new Error('TPEx 無資料');
    return sourceResult(source, {
      ok: true,
      dataDate: normalizeApiDate(row.Date || row.date) || dateTaipei(),
      data: {
        advance: integer(row.PriceRiseCompanyNumbers),
        decline: integer(row.PriceDeclineCompanyNumbers),
        unchanged: integer(row.PriceFlatCompanyNumbers),
        limitUp: integer(row.LimitUpCompanyNumbers),
        limitDown: integer(row.LimitDownCompanyNumbers),
        // TPEx publishes DailyTradingValue in NT$ millions; 100 million = 1 億.
        turnoverE: number(row.DailyTradingValue) / 100,
        totalCompanies: integer(row.ListedCompanyNumbers),
      },
      stale: (normalizeApiDate(row.Date || row.date) || dateTaipei()) !== dateTaipei(),
    });
  } catch (error) {
    return sourceResult(source, { ok: false, error: error.message });
  }
}

async function fetchSpotInstitutional(timeoutMs) {
  const source = 'TWSE BFI82U';
  try {
    const found = await firstSuccessful(recentDates(), async (date) => {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/fund/BFI82U?response=json&date=${compactDate(date)}`, { timeoutMs });
      if (payload?.stat !== 'OK' || !payload.data?.length) return null;
      let foreignNetE = 0;
      let trustNetE = 0;
      let dealerProprietaryNetE = 0;
      let dealerHedgeNetE = 0;
      for (const row of payload.data) {
        const name = String(row?.[0] || '');
        const netE = number(row?.[3]) / 1e8;
        if (name.includes('外資及陸資') && name.includes('不含')) foreignNetE = netE;
        else if (name.includes('投信')) trustNetE = netE;
        else if (name.includes('自營商') && name.includes('自行')) dealerProprietaryNetE = netE;
        else if (name.includes('自營商') && name.includes('避險')) dealerHedgeNetE = netE;
      }
      return {
        __dataDate: normalizeApiDate(payload.date) || date,
        foreignNetE,
        trustNetE,
        dealerProprietaryNetE,
        dealerHedgeNetE,
        dealerTotalNetE: dealerProprietaryNetE + dealerHedgeNetE,
      };
    });
    const dataDate = found.data.__dataDate || found.date;
    const { __dataDate, ...data } = found.data;
    return sourceResult(source, { ok: true, dataDate, data, stale: dataDate !== dateTaipei() });
  } catch (error) {
    return sourceResult(source, { ok: false, error: error.message });
  }
}

async function fetchMargin(timeoutMs) {
  const source = 'TWSE MI_MARGN';
  try {
    const found = await firstSuccessful(recentDates(), async (date) => {
      const payload = await fetchJson(`https://www.twse.com.tw/rwd/zh/marginTrading/MI_MARGN?response=json&date=${compactDate(date)}`, { timeoutMs });
      const rows = payload?.tables?.[0]?.data;
      if (payload?.stat !== 'OK' || !Array.isArray(rows)) return null;
      const margin = rows.find((row) => row?.[0] === '融資金額(仟元)');
      const short = rows.find((row) => row?.[0] === '融券(交易單位)');
      if (!margin && !short) return null;
      return {
        __dataDate: normalizeApiDate(payload.date) || date,
        marginBalanceE: margin ? number(margin[5]) / 100_000 : 0,
        shortBalanceLots: short ? integer(short[5]) : 0,
      };
    });
    const dataDate = found.data.__dataDate || found.date;
    const { __dataDate, ...data } = found.data;
    return sourceResult(source, { ok: true, dataDate, data, stale: dataDate !== dateTaipei() });
  } catch (error) {
    return sourceResult(source, { ok: false, error: error.message });
  }
}

function parseFuturesRow(row) {
  return {
    contract: String(row?.['ContractMonth(Week)'] || ''),
    close: nullableNumber(row?.Last),
    change: nullableNumber(row?.Change),
    changePct: nullableNumber(row?.['%']),
    volume: nullableInteger(row?.Volume),
    openInterest: nullableInteger(row?.OpenInterest),
    session: String(row?.TradingSession || ''),
  };
}

function nearestContract(rows, contract, session) {
  return rows
    .filter((row) => row?.Contract === contract && row?.TradingSession === session)
    .sort((a, b) => String(a?.['ContractMonth(Week)'] || '').localeCompare(String(b?.['ContractMonth(Week)'] || '')))
    .map(parseFuturesRow)
    .find((row) => row.close > 0) || null;
}

function contractSeries(rows, contract, session) {
  return rows
    .filter((row) => row?.Contract === contract && row?.TradingSession === session && /^\d{6}$/.test(String(row?.['ContractMonth(Week)'] || '')))
    .sort((a, b) => String(a?.['ContractMonth(Week)'] || '').localeCompare(String(b?.['ContractMonth(Week)'] || '')))
    .map(parseFuturesRow)
    .filter((row) => row.close > 0);
}

function futuresResultFromRows(rows, source, { verifiedLatest = false } = {}) {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error('TAIFEX 期貨行情無資料');
  const dataDate = normalizeApiDate(rows[0]?.Date) || dateTaipei();
  const txDayContracts = contractSeries(rows, 'TX', '一般');
  return sourceResult(source, {
    ok: true,
    dataDate,
    stale: verifiedLatest ? false : dataDate !== dateTaipei(),
    data: {
      txDay: txDayContracts[0] || null,
      txNext: txDayContracts[1] || null,
      txNight: nearestContract(rows, 'TX', '盤後'),
      tmfDay: nearestContract(rows, 'TMF', '一般'),
      tmfNight: nearestContract(rows, 'TMF', '盤後'),
    },
  });
}

function officialFuturesAsApiRows(rows) {
  return rows.map((row) => ({
    Date: row.tradeDate,
    Contract: row.product,
    'ContractMonth(Week)': row.contract,
    Last: row.close,
    Change: row.change,
    '%': row.changePct,
    Volume: row.volume,
    OpenInterest: row.openInterest,
    TradingSession: row.session,
  }));
}

async function fetchFuturesMarket(timeoutMs) {
  const source = 'TAIFEX DailyMarketReportFut';
  let openApi = null;
  try {
    const rows = await fetchJson('https://openapi.taifex.com.tw/v1/DailyMarketReportFut', { timeoutMs });
    openApi = futuresResultFromRows(rows, source);
    if (!openApi.stale) return openApi;
  } catch (error) {
    openApi = sourceResult(source, { ok: false, error: error.message });
  }
  try {
    const official = await fetchOfficialFutures(recentDates(), { timeoutMs });
    const result = futuresResultFromRows(officialFuturesAsApiRows(official.rows), 'TAIFEX official futures CSV', { verifiedLatest: true });
    if (!openApi.ok || result.dataDate >= openApi.dataDate) return result;
    return { ...openApi, stale: false, source: `${source} (official CSV verified)` };
  } catch (error) {
    return openApi.ok
      ? { ...openApi, stale: true, error: `OpenAPI 日期落後；官方 CSV 備援失敗：${error.message}` }
      : sourceResult(source, { ok: false, error: `${openApi.error}；官方 CSV 備援失敗：${error.message}` });
  }
}

function findInstitutionRow(rows, institution) {
  return rows.find((row) => String(row?.Item || '').includes(institution));
}

function parseInstitution(row) {
  if (!row) return { long: 0, short: 0, net: 0 };
  const long = integer(row?.['OpenInterest(Long)'] ?? row?.['FuturesOpenInterest(Long)']);
  const short = integer(row?.['OpenInterest(Short)'] ?? row?.['FuturesOpenInterest(Short)']);
  const net = integer(row?.['OpenInterest(Net)'] ?? row?.['FuturesOpenInterest(Net)']);
  return { long, short, net: net || long - short };
}

async function fetchFuturesInstitutional(timeoutMs, previousSnapshot) {
  const source = 'TAIFEX Institutional';
  let openApi = null;
  try {
    const rows = await fetchJson('https://openapi.taifex.com.tw/v1/MarketDataOfMajorInstitutionalTradersDetailsOfFuturesContractsBytheDate', { timeoutMs });
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('TAIFEX 法人資料無資料');
    const txRows = rows.filter((row) => String(row?.ContractCode || '').trim() === '臺股期貨');
    if (txRows.length === 0) throw new Error('TAIFEX 臺股期貨法人資料不存在');
    const dataDate = normalizeApiDate(txRows[0]?.Date) || dateTaipei();
    const foreign = parseInstitution(findInstitutionRow(txRows, '外資'));
    const dealer = parseInstitution(findInstitutionRow(txRows, '自營商'));
    const trust = parseInstitution(findInstitutionRow(txRows, '投信'));
    const previous = previousSnapshot?.futuresInstitutional;
    const comparable = previous?.ok && previous.dataDate && previous.dataDate !== dataDate;
    openApi = sourceResult(source, {
      ok: true,
      dataDate,
      stale: dataDate !== dateTaipei(),
      data: {
        foreignLong: foreign.long,
        foreignShort: foreign.short,
        foreignNet: foreign.net,
        foreignNetDelta: comparable ? foreign.net - number(previous.data?.foreignNet) : 0,
        foreignShortDelta: comparable ? foreign.short - number(previous.data?.foreignShort) : 0,
        deltaAvailable: Boolean(comparable),
        dealerLong: dealer.long,
        dealerShort: dealer.short,
        dealerNet: dealer.net,
        trustLong: trust.long,
        trustShort: trust.short,
        trustNet: trust.net,
      },
    });
    if (!openApi.stale) return openApi;
  } catch (error) {
    openApi = sourceResult(source, { ok: false, error: error.message });
  }
  try {
    const official = await fetchOfficialPositions(recentDates(), { timeoutMs });
    const foreign = official.data?.foreign || { long: 0, short: 0, net: 0 };
    const dealer = official.data?.dealer || { long: 0, short: 0, net: 0 };
    const trust = official.data?.trust || { long: 0, short: 0, net: 0 };
    const previous = previousSnapshot?.futuresInstitutional;
    const comparable = previous?.ok && previous.dataDate && previous.dataDate !== official.dataDate;
    const result = sourceResult('TAIFEX official institutional CSV', {
      ok: true,
      dataDate: official.dataDate,
      stale: false,
      data: {
        foreignLong: foreign.long || 0,
        foreignShort: foreign.short || 0,
        foreignNet: foreign.net || 0,
        foreignNetDelta: comparable ? foreign.net - number(previous.data?.foreignNet) : 0,
        foreignShortDelta: comparable ? foreign.short - number(previous.data?.foreignShort) : 0,
        deltaAvailable: Boolean(comparable),
        dealerLong: dealer.long || 0,
        dealerShort: dealer.short || 0,
        dealerNet: dealer.net || 0,
        trustLong: trust.long || 0,
        trustShort: trust.short || 0,
        trustNet: trust.net || 0,
      },
    });
    if (!openApi.ok || result.dataDate >= openApi.dataDate) return result;
    return { ...openApi, stale: false, source: `${source} (official CSV verified)` };
  } catch (error) {
    return openApi.ok
      ? { ...openApi, stale: true, error: `OpenAPI 日期落後；官方法人 CSV 備援失敗：${error.message}` }
      : sourceResult(source, { ok: false, error: `${openApi.error}；官方法人 CSV 備援失敗：${error.message}` });
  }
}

function contractKind(contract) {
  return /[WF]\d+$/i.test(contract) ? 'weekly' : 'monthly';
}

function nthWeekdayOfMonth(year, month, weekday, occurrence) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const day = 1 + ((weekday - first.getUTCDay() + 7) % 7) + (occurrence - 1) * 7;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function optionExpiryDate(contract) {
  const weekly = String(contract).match(/^(\d{4})(\d{2})([WF])(\d)$/i);
  if (weekly) {
    const [, year, month, kind, occurrence] = weekly;
    return nthWeekdayOfMonth(Number(year), Number(month), kind.toUpperCase() === 'W' ? 3 : 5, Number(occurrence));
  }
  const monthly = String(contract).match(/^(\d{4})(\d{2})$/);
  if (monthly) return nthWeekdayOfMonth(Number(monthly[1]), Number(monthly[2]), 3, 3);
  return null;
}

function calendarDaysUntil(date, asOfDate = dateTaipei()) {
  if (!date) return null;
  const today = new Date(`${asOfDate}T00:00:00Z`);
  const expiry = new Date(`${date}T00:00:00Z`);
  return Math.ceil((expiry - today) / 86_400_000);
}

function chooseActiveOptionContract(contractMaps, asOfDate) {
  const contracts = [...contractMaps.entries()].map(([contract, strikes]) => {
    let totalCallOi = 0;
    let totalPutOi = 0;
    let totalCallVolume = 0;
    let totalPutVolume = 0;
    for (const item of strikes.values()) {
      totalCallOi += item.callOi;
      totalPutOi += item.putOi;
      totalCallVolume += item.callVolume;
      totalPutVolume += item.putVolume;
    }
    const expiryDate = optionExpiryDate(contract);
    return { contract, type: contractKind(contract), expiryDate, daysToExpiry: calendarDaysUntil(expiryDate, asOfDate), totalOi: totalCallOi + totalPutOi, totalCallOi, totalPutOi, totalCallVolume, totalPutVolume };
  }).filter((item) => item.totalOi > 0);
  const unexpired = contracts
    .filter((item) => item.daysToExpiry == null || item.daysToExpiry >= 0)
    .sort((a, b) => (a.expiryDate || '9999-99-99').localeCompare(b.expiryDate || '9999-99-99') || b.totalOi - a.totalOi);
  return unexpired[0] || contracts.sort((a, b) => b.totalOi - a.totalOi)[0] || null;
}

function calculateMaxPain(strikes) {
  const strikeList = [...strikes.keys()].sort((a, b) => a - b);
  let bestStrike = 0;
  let minimum = Number.POSITIVE_INFINITY;
  for (const settlement of strikeList) {
    let pain = 0;
    for (const [strike, item] of strikes) {
      pain += Math.max(0, settlement - strike) * item.callOi;
      pain += Math.max(0, strike - settlement) * item.putOi;
    }
    if (pain < minimum) {
      minimum = pain;
      bestStrike = settlement;
    }
  }
  return bestStrike;
}

function optionContractStructure(strikes) {
  const rows = [...strikes.entries()].map(([strike, item]) => ({
    strike,
    callOi: item.callOi,
    putOi: item.putOi,
  }));
  const topCallWalls = [...rows]
    .filter((item) => item.callOi > 0)
    .sort((a, b) => b.callOi - a.callOi)
    .slice(0, 5)
    .map((item) => ({ strike: item.strike, openInterest: item.callOi }));
  const topPutWalls = [...rows]
    .filter((item) => item.putOi > 0)
    .sort((a, b) => b.putOi - a.putOi)
    .slice(0, 5)
    .map((item) => ({ strike: item.strike, openInterest: item.putOi }));
  return {
    callWall: topCallWalls[0] || { strike: 0, openInterest: 0 },
    putWall: topPutWalls[0] || { strike: 0, openInterest: 0 },
    topCallWalls,
    topPutWalls,
    maxPain: calculateMaxPain(strikes),
  };
}

async function fetchOptions(timeoutMs) {
  const source = 'TAIFEX DailyMarketReportOpt';
  let openApi = null;
  try {
    const rows = await fetchJson('https://openapi.taifex.com.tw/v1/DailyMarketReportOpt?commodity=TXO', { timeoutMs });
    openApi = optionsResultFromRows(rows, source);
    if (!openApi.stale) return openApi;
  } catch (error) {
    openApi = sourceResult(source, { ok: false, error: error.message });
  }
  try {
    const official = await fetchOfficialOptions(recentDates(), { timeoutMs });
    const rows = official.rows.map((row) => ({
      Date: row.tradeDate,
      Contract: row.product,
      'ContractMonth(Week)': row.contract,
      StrikePrice: row.strike,
      CallPut: row.right,
      OpenInterest: row.openInterest,
      Volume: row.volume,
      TradingSession: row.session,
    }));
    const result = optionsResultFromRows(rows, 'TAIFEX official options CSV', { verifiedLatest: true });
    if (!openApi.ok || result.dataDate >= openApi.dataDate) return result;
    return { ...openApi, stale: false, source: `${source} (official CSV verified)` };
  } catch (error) {
    return openApi.ok
      ? { ...openApi, stale: true, error: `OpenAPI 日期落後；官方選擇權 CSV 備援失敗：${error.message}` }
      : sourceResult(source, { ok: false, error: `${openApi.error}；官方選擇權 CSV 備援失敗：${error.message}` });
  }
}

function optionsResultFromRows(rows, source, { verifiedLatest = false } = {}) {
    const dataDate = normalizeApiDate(rows?.[0]?.Date) || dateTaipei();
    if (!Array.isArray(rows) || rows.length === 0) throw new Error('TAIFEX 選擇權行情無資料');
    const contractMaps = new Map();
    for (const row of rows) {
      if (row?.Contract !== 'TXO' || row?.TradingSession !== '一般') continue;
      const contract = String(row?.['ContractMonth(Week)'] || '').trim();
      const strike = number(row?.StrikePrice);
      const oi = integer(row?.OpenInterest);
      const volume = integer(row?.Volume);
      // Keep traded strikes even when end-of-day OI is zero.  Dropping them
      // understates volume P/C; wall and Max Pain calculations already ignore
      // zero-OI rows where appropriate.
      if (!contract || strike < 1_000 || (oi <= 0 && volume <= 0)) continue;
      if (!contractMaps.has(contract)) contractMaps.set(contract, new Map());
      const strikes = contractMaps.get(contract);
      const item = strikes.get(strike) || { callOi: 0, putOi: 0, callVolume: 0, putVolume: 0 };
      const callPut = String(row?.CallPut || '');
      if (callPut.includes('買') || /^call$/i.test(callPut) || callPut === 'C') { item.callOi += oi; item.callVolume += volume; }
      else if (callPut.includes('賣') || /^put$/i.test(callPut) || callPut === 'P') { item.putOi += oi; item.putVolume += volume; }
      strikes.set(strike, item);
    }
    const selectionDate = dateTaipei();
    const active = chooseActiveOptionContract(contractMaps, selectionDate);
    if (!active) throw new Error('TXO 找不到有效契約');
    const strikes = contractMaps.get(active.contract);
    const activeStructure = optionContractStructure(strikes);
    return sourceResult(source, {
      ok: true,
      dataDate,
      stale: verifiedLatest ? false : dataDate !== dateTaipei(),
      data: {
        contract: active.contract,
        contractType: active.type,
        expiryDate: active.expiryDate,
        daysToExpiry: calendarDaysUntil(active.expiryDate, selectionDate),
        totalCallOi: active.totalCallOi,
        totalPutOi: active.totalPutOi,
        totalCallVolume: active.totalCallVolume,
        totalPutVolume: active.totalPutVolume,
        volumePcRatio: active.totalCallVolume ? active.totalPutVolume / active.totalCallVolume : 0,
        oiPcRatio: active.totalCallOi ? active.totalPutOi / active.totalCallOi : 0,
        callWall: activeStructure.callWall,
        putWall: activeStructure.putWall,
        topCallWalls: activeStructure.topCallWalls,
        topPutWalls: activeStructure.topPutWalls,
        maxPain: activeStructure.maxPain,
        contracts: [...contractMaps.entries()].map(([contract, contractStrikes]) => {
          let callOi = 0; let putOi = 0; let callVolume = 0; let putVolume = 0;
          for (const item of contractStrikes.values()) {
            callOi += item.callOi; putOi += item.putOi;
            callVolume += item.callVolume; putVolume += item.putVolume;
          }
          const expiryDate = optionExpiryDate(contract);
          const structure = optionContractStructure(contractStrikes);
          return {
            contract, type: contractKind(contract), expiryDate,
            daysToExpiry: calendarDaysUntil(expiryDate, dataDate),
            callOi, putOi, callVolume, putVolume,
            oiPcRatio: callOi ? putOi / callOi : 0,
            volumePcRatio: callVolume ? putVolume / callVolume : 0,
            callWall: structure.callWall,
            putWall: structure.putWall,
            topCallWalls: structure.topCallWalls,
            topPutWalls: structure.topPutWalls,
            maxPain: structure.maxPain,
            strikes: [...contractStrikes.entries()].map(([strike, item]) => ({ strike, callOi: item.callOi, putOi: item.putOi })),
          };
        }).sort((a, b) => (a.expiryDate || '9999').localeCompare(b.expiryDate || '9999')),
      },
    });
}

async function fetchLargeTraders(timeoutMs) {
  const source = 'TAIFEX Large Traders';
  let openApi = null;
  try {
    const found = await firstSuccessful(recentDates(), async (date) => {
      const rows = await fetchJson(`https://openapi.taifex.com.tw/v1/OpenInterestOfLargeTradersFutures?date=${compactDate(date)}`, { timeoutMs });
      if (!Array.isArray(rows) || rows.length === 0) return null;
      const row = rows.find((item) => item?.Contract === 'TX');
      if (!row) return null;
      return {
        __dataDate: normalizeApiDate(row?.Date) || date,
        top5Long: integer(row?.Top5Buy),
        top5Short: integer(row?.Top5Sell),
        top10Long: integer(row?.Top10Buy),
        top10Short: integer(row?.Top10Sell),
        marketOi: integer(row?.OIOfMarket),
      };
    });
    const dataDate = found.data.__dataDate || found.date;
    const { __dataDate, ...data } = found.data;
    openApi = sourceResult(source, {
      ok: true,
      dataDate,
      stale: dataDate !== dateTaipei(),
      data,
    });
    if (!openApi.stale) return openApi;
  } catch (error) {
    openApi = sourceResult(source, { ok: false, error: error.message });
  }
  try {
    const official = await fetchOfficialLargeTraders(recentDates(), { timeoutMs });
    const result = sourceResult('TAIFEX official large-trader table', {
      ok: true, dataDate: official.dataDate, stale: false, data: official.data,
    });
    if (!openApi.ok || result.dataDate >= openApi.dataDate) return result;
    return { ...openApi, stale: false, source: `${source} (official table verified)` };
  } catch (error) {
    return openApi.ok
      ? { ...openApi, stale: true, error: `OpenAPI 日期落後；官方大額交易人備援失敗：${error.message}` }
      : sourceResult(source, { ok: false, error: `${openApi.error}；官方大額交易人備援失敗：${error.message}` });
  }
}

function normalizeApiDate(raw) {
  const value = String(raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d{8}$/.test(value)) return `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  if (/^\d{7}$/.test(value)) return `${Number(value.slice(0, 3)) + 1911}-${value.slice(3, 5)}-${value.slice(5, 7)}`;
  const roc = value.match(/^(\d{2,3})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (roc) return `${Number(roc[1]) + 1911}-${String(roc[2]).padStart(2, '0')}-${String(roc[3]).padStart(2, '0')}`;
  return null;
}

function mergeFailedWithPrevious(current, previous) {
  if (current?.ok || !previous?.ok) return current;
  return {
    ...previous,
    stale: true,
    fetchedAt: current.fetchedAt,
    error: current.error,
    fallbackFromCache: true,
  };
}

export class MarketDataService {
  constructor({ timeoutMs = 12_000, mockData = false } = {}) {
    this.timeoutMs = timeoutMs;
    this.mockData = mockData;
    this.refreshPromise = null;
  }

  async refresh(previousSnapshot = null) {
    if (this.refreshPromise) return this.refreshPromise;
    this.refreshPromise = this.#refresh(previousSnapshot).finally(() => { this.refreshPromise = null; });
    return this.refreshPromise;
  }

  async #refresh(previousSnapshot) {
    if (this.mockData) {
      const snapshot = createMockSnapshot();
      snapshot.dataMode = 'mock';
      snapshot.sources = buildSources(snapshot);
      snapshot.signal = buildSignal(snapshot);
      return snapshot;
    }

    // Never use demo values as a fallback after switching to live mode.
    // Only a snapshot that was itself collected from live sources is eligible.
    const livePrevious = previousSnapshot?.dataMode === 'live' ? previousSnapshot : null;

    const [overview, taiwanVix, listedBreadth, otcBreadth, spot, margin, futuresMarket, futuresInstitutional, options, largeTraders] = await Promise.all([
      fetchMarketOverview(this.timeoutMs),
      fetchTaiwanVix(this.timeoutMs),
      fetchListedBreadth(this.timeoutMs),
      fetchOtcBreadth(this.timeoutMs),
      fetchSpotInstitutional(this.timeoutMs),
      fetchMargin(this.timeoutMs),
      fetchFuturesMarket(this.timeoutMs),
      fetchFuturesInstitutional(this.timeoutMs, livePrevious),
      fetchOptions(this.timeoutMs),
      fetchLargeTraders(this.timeoutMs),
    ]);

    const listed = mergeFailedWithPrevious(listedBreadth, livePrevious?.marketBreadth?.listedSource);
    const otc = mergeFailedWithPrevious(otcBreadth, livePrevious?.marketBreadth?.otcSource);
    const marketBreadth = {
      ok: Boolean(listed?.ok && otc?.ok),
      source: 'TWSE / TPEx',
      dataDate: [listed?.dataDate, otc?.dataDate].filter(Boolean).sort().at(-1) || null,
      fetchedAt: new Date().toISOString(),
      stale: Boolean(!listed?.ok || !otc?.ok || listed.stale || otc.stale),
      error: [listed?.error, otc?.error].filter(Boolean).join('；') || null,
      data: { listed: listed?.data || null, otc: otc?.data || null },
      listedSource: listed,
      otcSource: otc,
    };

    // Use authoritative price/position dates for the snapshot date. Breadth
    // feeds can return a requested weekend date while carrying older data.
    const sourceDates = [overview, taiwanVix, spot, margin, futuresMarket, futuresInstitutional, options, largeTraders]
      .filter((item) => item?.ok && item?.dataDate)
      .map((item) => item.dataDate)
      .sort();
    const snapshot = {
      schemaVersion: 1,
      dataMode: 'live',
      asOfDate: sourceDates.at(-1) || dateTaipei(),
      generatedAt: new Date().toISOString(),
      marketOverview: mergeFailedWithPrevious(overview, livePrevious?.marketOverview),
      taiwanVix: mergeFailedWithPrevious(taiwanVix, livePrevious?.taiwanVix),
      marketBreadth,
      spotInstitutional: mergeFailedWithPrevious(spot, livePrevious?.spotInstitutional),
      margin: mergeFailedWithPrevious(margin, livePrevious?.margin),
      futuresMarket: mergeFailedWithPrevious(futuresMarket, livePrevious?.futuresMarket),
      futuresInstitutional: mergeFailedWithPrevious(futuresInstitutional, livePrevious?.futuresInstitutional),
      options: mergeFailedWithPrevious(options, livePrevious?.options),
      largeTraders: mergeFailedWithPrevious(largeTraders, livePrevious?.largeTraders),
    };
    snapshot.sources = buildSources(snapshot);
    snapshot.signal = buildSignal(snapshot);
    return snapshot;
  }
}

function buildSources(snapshot) {
  const entries = [
    ['marketOverview', snapshot.marketOverview],
    ['taiwanVix', snapshot.taiwanVix],
    ['marketBreadth', snapshot.marketBreadth],
    ['spotInstitutional', snapshot.spotInstitutional],
    ['margin', snapshot.margin],
    ['futuresMarket', snapshot.futuresMarket],
    ['futuresInstitutional', snapshot.futuresInstitutional],
    ['options', snapshot.options],
    ['largeTraders', snapshot.largeTraders],
  ];
  return Object.fromEntries(entries.map(([key, item]) => [key, {
    ok: Boolean(item?.ok),
    source: item?.source || key,
    dataDate: item?.dataDate || null,
    fetchedAt: item?.fetchedAt || null,
    stale: Boolean(item?.stale),
    fallbackFromCache: Boolean(item?.fallbackFromCache),
    error: item?.error || null,
    ...sourceQualityMetadata(key, item, snapshot.asOfDate),
  }]));
}

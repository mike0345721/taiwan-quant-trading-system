import { parseCsv } from './taifex-csv.mjs';

function plainCell(html) {
  return String(html).replace(/<[^>]+>/g, ' ').replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replace(/\s+/g, ' ').trim();
}

function integer(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function isoDate(value) {
  const normalized = String(value || '').trim().replaceAll('/', '-');
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

export function parseOptionInstitutionHtml(html, expectedDate) {
  const source = String(html);
  const dateMatch = source.match(/id=["']queryDate["'][^>]*value=["'](\d{4}\/\d{2}\/\d{2})["']/i);
  const tradeDate = isoDate(dateMatch?.[1] || expectedDate);
  if (!tradeDate || (expectedDate && tradeDate !== expectedDate)) throw new Error('option institutions: response date mismatch');
  const tables = [...source.matchAll(/<table[\s\S]*?<\/table>/gi)].map((match) => match[0]);
  const table = tables.find((item) => item.includes('臺指選擇權') && item.includes('投信') && item.includes('外資'));
  if (!table) throw new Error('option institutions: TXO table missing');
  const rows = [...table.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((row) =>
    [...row[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((cell) => plainCell(cell[1])));
  const firstIndex = rows.findIndex((row) => row.includes('臺指選擇權') && row.includes('自營商'));
  if (firstIndex < 0) throw new Error('option institutions: dealer row missing');
  const selected = rows.slice(firstIndex, firstIndex + 3);
  const participants = { 自營商: 'dealer', 投信: 'investment_trust', 外資: 'foreign' };
  return selected.map((cells, index) => {
    const participantLabel = index === 0 ? cells[cells.indexOf('臺指選擇權') + 1] : cells[0];
    const participant = participants[participantLabel];
    const values = (index === 0 ? cells.slice(cells.indexOf(participantLabel) + 1) : cells.slice(1)).map(integer);
    if (!participant || values.length < 12 || values.slice(0, 12).some((value) => value == null)) throw new Error(`option institutions: invalid ${participantLabel || 'participant'} row`);
    return {
      tradeDate, participant,
      tradeLong: values[0], tradeLongValue: values[1], tradeShort: values[2], tradeShortValue: values[3], tradeNet: values[4], tradeNetValue: values[5],
      oiLong: values[6], oiLongValue: values[7], oiShort: values[8], oiShortValue: values[9], oiNet: values[10], oiNetValue: values[11],
    };
  });
}

export function parseOptionInstitutionCsv(text) {
  const rows = parseCsv(text);
  if (!rows[0]?.[0]?.includes('日期') || !rows[0]?.some((cell) => cell.includes('多空未平倉口數淨額'))) throw new Error('option institutions: CSV header mismatch');
  const participants = { 自營商: 'dealer', 投信: 'investment_trust', 外資及陸資: 'foreign', 外資: 'foreign' };
  return rows.slice(1).map((cells) => {
    const tradeDate = isoDate(cells[0]); const product = String(cells[1] || '').trim();
    const participant = participants[String(cells[2] || '').trim()];
    if (!tradeDate || product !== '臺指選擇權' || !participant) return null;
    const values = cells.slice(3, 15).map(integer);
    if (values.length < 12 || values.some((value) => value == null)) throw new Error(`option institutions: invalid CSV row ${tradeDate} ${participant}`);
    return {
      tradeDate, participant,
      tradeLong: values[0], tradeLongValue: values[1], tradeShort: values[2], tradeShortValue: values[3], tradeNet: values[4], tradeNetValue: values[5],
      oiLong: values[6], oiLongValue: values[7], oiShort: values[8], oiShortValue: values[9], oiNet: values[10], oiNetValue: values[11],
    };
  }).filter(Boolean);
}

export function parseOptionLargeTraderCsv(text) {
  const rows = parseCsv(text);
  if (!rows[0]?.[0]?.includes('日期') || !rows[0]?.some((cell) => cell.includes('全市場未沖銷部位數'))) throw new Error('option large traders: CSV header mismatch');
  return rows.slice(1).map((cells) => {
    const tradeDate = isoDate(cells[0]); const product = String(cells[1] || '').trim();
    const right = String(cells[3] || '').trim(); const expiryLabel = String(cells[4] || '').trim();
    const category = String(cells[5] || '').trim();
    if (!tradeDate || product !== 'TXO' || !['買權', '賣權'].includes(right) || !['0', '1'].includes(category)) return null;
    const values = cells.slice(6, 11).map(integer);
    if (values.some((value) => value == null)) throw new Error(`option large traders: invalid values ${tradeDate} ${right} ${expiryLabel}`);
    return {
      tradeDate, optionRight: right === '買權' ? 'call' : 'put', expiryLabel,
      expiryScope: expiryLabel === '666666' ? 'weekly' : expiryLabel === '999999' ? 'all_contracts' : 'near_month',
      traderCategory: category === '1' ? 'specific_legal' : 'all_traders',
      top5Buy: values[0], top5Sell: values[1], top10Buy: values[2], top10Sell: values[3], marketOi: values[4],
    };
  }).filter(Boolean);
}

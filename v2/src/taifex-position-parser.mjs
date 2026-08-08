function numeric(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').replace(/^"|"$/g, '').trim());
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

export function parseTaifexPositionCsv(text) {
  const byDate = new Map();
  for (const line of String(text || '').split(/\r?\n/).slice(1)) {
    const cells = line.split(',').map((item) => item.trim().replace(/^"|"$/g, ''));
    if (cells.length < 14 || cells[1] !== '臺股期貨') continue;
    const tradeDate = cells[0]?.replaceAll('/', '-');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) continue;
    const item = {
      tradeLong: numeric(cells[3]),
      tradeShort: numeric(cells[5]),
      tradeNet: numeric(cells[7]),
      long: numeric(cells[9]),
      short: numeric(cells[11]),
      net: numeric(cells[13]),
    };
    const current = byDate.get(tradeDate) || {};
    if (cells[2].includes('外資')) current.foreign = item;
    else if (cells[2].includes('自營商')) current.dealer = item;
    else if (cells[2].includes('投信')) current.trust = item;
    byDate.set(tradeDate, current);
  }
  return byDate;
}

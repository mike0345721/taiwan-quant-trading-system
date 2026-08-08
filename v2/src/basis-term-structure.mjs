const MONTH_CONTRACT = /^\d{6}$/;

export function thirdWednesday(contract) {
  if (!MONTH_CONTRACT.test(String(contract))) return null;
  const year = Number(String(contract).slice(0, 4));
  const month = Number(String(contract).slice(4, 6));
  if (month < 1 || month > 12) return null;
  const first = new Date(Date.UTC(year, month - 1, 1));
  const offset = (3 - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + offset + 14));
}

export function calendarDays(fromDate, toDate) {
  const from = new Date(`${fromDate}T00:00:00Z`);
  return Math.round((toDate.getTime() - from.getTime()) / 86_400_000);
}

export function selectNearAndNext(contracts) {
  const monthly = contracts
    .filter((row) => MONTH_CONTRACT.test(String(row.contract)) && Number.isFinite(Number(row.close)))
    .sort((a, b) => String(a.contract).localeCompare(String(b.contract)));
  const near = monthly.find((row) => Number(row.is_active) === 1) ?? monthly[0];
  const next = monthly.find((row) => String(row.contract) > String(near?.contract));
  return near && next ? { near, next } : null;
}

export function priorZScore(values, window = 60, minimum = 20) {
  const output = Array(values.length).fill(null);
  for (let index = 0; index < values.length; index += 1) {
    const history = values.slice(Math.max(0, index - window), index).filter(Number.isFinite);
    if (history.length < minimum || !Number.isFinite(values[index])) continue;
    const mean = history.reduce((sum, value) => sum + value, 0) / history.length;
    const variance = history.reduce((sum, value) => sum + (value - mean) ** 2, 0) / history.length;
    const deviation = Math.sqrt(variance);
    output[index] = deviation ? (values[index] - mean) / deviation : 0;
  }
  return output;
}

export function buildBasisTermRows(contractRows, spotRows = []) {
  const spotByDate = new Map(spotRows.map((row) => [row.trade_date, Number(row.twii_close)]));
  const grouped = new Map();
  for (const row of contractRows) {
    if (!grouped.has(row.trade_date)) grouped.set(row.trade_date, []);
    grouped.get(row.trade_date).push(row);
  }
  const rows = [];
  for (const [tradeDate, contracts] of grouped) {
    const selected = selectNearAndNext(contracts);
    if (!selected) continue;
    const nearClose = Number(selected.near.close);
    const nextClose = Number(selected.next.close);
    const spotClose = spotByDate.get(tradeDate);
    const expiry = thirdWednesday(selected.near.contract);
    const daysToExpiry = calendarDays(tradeDate, expiry);
    rows.push({
      tradeDate,
      nearContract: selected.near.contract,
      nextContract: selected.next.contract,
      nearClose,
      nextClose,
      spotClose: Number.isFinite(spotClose) ? spotClose : null,
      daysToNearExpiry: daysToExpiry,
      rolloverRisk: daysToExpiry <= 2 ? 1 : 0,
      termSpreadPoints: nextClose - nearClose,
      termSpreadBps: (nextClose - nearClose) / nearClose * 10_000,
      closeBasisPoints: Number.isFinite(spotClose) ? nearClose - spotClose : null,
      closeBasisBps: Number.isFinite(spotClose) ? (nearClose - spotClose) / spotClose * 10_000 : null,
    });
  }
  rows.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  const samePairLag = (index, lag) => {
    const previous = rows[index - lag];
    return previous
      && previous.nearContract === rows[index].nearContract
      && previous.nextContract === rows[index].nextContract ? previous : null;
  };
  rows.forEach((row, index) => {
    const p1 = samePairLag(index, 1); const p5 = samePairLag(index, 5);
    row.termChange1dBps = p1 ? row.termSpreadBps - p1.termSpreadBps : null;
    row.termChange5dBps = p5 ? row.termSpreadBps - p5.termSpreadBps : null;
    row.basisChange1dBps = p1 && Number.isFinite(p1.closeBasisBps) && Number.isFinite(row.closeBasisBps)
      ? row.closeBasisBps - p1.closeBasisBps : null;
    row.basisChange5dBps = p5 && Number.isFinite(p5.closeBasisBps) && Number.isFinite(row.closeBasisBps)
      ? row.closeBasisBps - p5.closeBasisBps : null;
  });
  const termChangeZ = priorZScore(rows.map((row) => row.termChange1dBps));
  const basisLevelZ = priorZScore(rows.map((row) => row.closeBasisBps));
  rows.forEach((row, index) => {
    row.termChangeZ60 = termChangeZ[index];
    row.basisLevelZ60 = basisLevelZ[index];
  });
  return rows;
}

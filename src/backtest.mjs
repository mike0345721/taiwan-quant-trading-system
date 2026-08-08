import { buildSignal } from './signal-engine.mjs';

function dateOf(row) { return row?.spotInstitutional?.dataDate || row?.futuresInstitutional?.dataDate || row?.asOfDate || ''; }
function closeOf(row) { const value = Number(row?.marketOverview?.data?.twii?.price); return Number.isFinite(value) ? value : null; }

function summarize(name, samples) {
  const active = samples.filter((item) => Math.abs(item.score) >= 10 && Number.isFinite(item.nextReturn));
  if (active.length < 30) return { name, status: 'insufficient', sampleSize: active.length };
  const hits = active.filter((item) => Math.sign(item.score) === Math.sign(item.nextReturn)).length;
  const positive = active.filter((item) => item.score > 0);
  const negative = active.filter((item) => item.score < 0);
  const average = (rows) => rows.length ? rows.reduce((sum, item) => sum + item.nextReturn, 0) / rows.length : null;
  return {
    name, status: 'research_only', sampleSize: active.length,
    hitRatePct: hits / active.length * 100,
    avgNextReturnLongPct: average(positive),
    avgNextReturnShortPct: average(negative),
  };
}

export function backtestComponents(history = []) {
  const byDate = new Map(history.filter((row) => row?.dataMode === 'live').map((row) => [dateOf(row), row]));
  const rows = [...byDate.entries()].filter(([date]) => date).sort(([a], [b]) => a.localeCompare(b)).map(([, row]) => row);
  const samples = { spot: [], futures: [], options: [], breadth: [] };
  for (let index = 0; index < rows.length - 1; index += 1) {
    const row = structuredClone(rows[index]);
    const nextClose = closeOf(rows[index + 1]); const close = closeOf(row);
    if (!close || !nextClose) continue;
    const previous = rows[index - 1];
    if (previous?.futuresInstitutional?.data && row?.futuresInstitutional?.data) {
      row.derived = { futures: {
        foreignNetDelta: Number(row.futuresInstitutional.data.foreignNet) - Number(previous.futuresInstitutional.data.foreignNet),
        foreignShortDelta: Number(row.futuresInstitutional.data.foreignShort) - Number(previous.futuresInstitutional.data.foreignShort),
      } };
    }
    const score = buildSignal(row).components;
    const nextReturn = (nextClose / close - 1) * 100;
    for (const key of Object.keys(samples)) {
      const sourceAvailable = key === 'spot' ? row.spotInstitutional?.data : key === 'futures' ? row.derived?.futures : key === 'options' ? row.options?.data : row.marketBreadth?.data;
      if (sourceAvailable) samples[key].push({ score: Number(score[key]), nextReturn });
    }
  }
  return {
    generatedAt: new Date().toISOString(),
    firstDate: dateOf(rows[0]), lastDate: dateOf(rows.at(-1)), tradingDays: rows.length,
    results: [summarize('現貨法人分數', samples.spot), summarize('期貨籌碼分數', samples.futures), summarize('選擇權分數', samples.options), summarize('市場寬度分數', samples.breadth)],
    disclaimer: '僅檢查分數與下一交易日指數報酬的方向關係；未含交易成本、滑價、盤中進出與樣本外驗證，不代表可交易策略。',
  };
}

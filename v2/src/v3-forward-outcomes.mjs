function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

export function validOhlcBar(bar) {
  if (!bar || ![bar.open, bar.high, bar.low, bar.close].every(finite)) return false;
  const open = Number(bar.open);
  const high = Number(bar.high);
  const low = Number(bar.low);
  const close = Number(bar.close);
  return [open, high, low, close].every((value) => value > 0)
    && high >= Math.max(open, close)
    && low <= Math.min(open, close)
    && high >= low;
}

function latestDecisionPerDate(decisions = []) {
  const latest = new Map();
  for (const decision of decisions) {
    if (!decision?.dataDate) continue;
    const prior = latest.get(decision.dataDate);
    const priorTime = Date.parse(prior?.generatedAt || 0);
    const currentTime = Date.parse(decision.generatedAt || 0);
    if (!prior || currentTime >= priorTime) latest.set(decision.dataDate, decision);
  }
  return [...latest.values()].sort((a, b) => a.dataDate.localeCompare(b.dataDate));
}

function sideFromBias(bias) {
  const text = String(bias || '').toLowerCase();
  if (text.includes('多') || text.includes('bull') || text.includes('long')) return 1;
  if (text.includes('空') || text.includes('bear') || text.includes('short')) return -1;
  return 0;
}

function outcomeFor(decision, row, horizonDays) {
  const bars = row.futureBars?.slice(0, horizonDays) || [];
  if (bars.length !== horizonDays
    || bars.some((bar) => bar.txContract !== row.txContract)
    || bars.some((bar) => !validOhlcBar(bar))) return null;
  const entry = bars[0];
  const exit = bars.at(-1);
  const entryOpen = Number(entry.open);
  const exitClose = Number(exit.close);
  const highs = bars.map((bar) => Number(bar.high));
  const lows = bars.map((bar) => Number(bar.low));
  const side = sideFromBias(decision.directionBias);
  const returnPct = (exitClose / entryOpen - 1) * 100;
  const highest = highs.length ? Math.max(...highs) : null;
  const lowest = lows.length ? Math.min(...lows) : null;
  const longMfePct = highest == null ? null : (highest / entryOpen - 1) * 100;
  const longMaePct = lowest == null ? null : (lowest / entryOpen - 1) * 100;
  return {
    decisionVersion: decision.version,
    signalDate: decision.dataDate,
    horizonDays,
    entryDate: entry.tradeDate,
    exitDate: exit.tradeDate,
    txContract: row.txContract,
    riskScore: decision.riskScore,
    riskLevel: decision.riskLevel,
    directionScore: decision.directionScore,
    directionBias: decision.directionBias,
    action: decision.action,
    entryOpen,
    exitClose,
    pathHigh: highest,
    pathLow: lowest,
    returnPct,
    absoluteMovePct: Math.abs(returnPct),
    gapPct: finite(row.txClose) ? (entryOpen / Number(row.txClose) - 1) * 100 : null,
    realizedRangePct: highest == null || lowest == null ? null : (highest - lowest) / entryOpen * 100,
    longMfePct,
    longMaePct,
    directionalReturnPct: side ? returnPct * side : null,
    directionCorrect: side ? returnPct * side > 0 : null,
    researchOnly: true,
    ohlcValidation: {
      schemaVersion: '1.0.0',
      strict: true,
      barsValidated: bars.length,
      rules: ['open_high_low_close_positive', 'high_gte_open_close', 'low_lte_open_close'],
    },
    resolvedAt: new Date().toISOString(),
  };
}

export function resolveV3Outcomes(decisions, rows, horizons = [1, 2]) {
  const rowByDate = new Map(rows.map((row) => [row.tradeDate, row]));
  const outcomes = [];
  const pending = [];
  for (const decision of latestDecisionPerDate(decisions)) {
    const row = rowByDate.get(decision.dataDate);
    if (!row) {
      pending.push({ signalDate: decision.dataDate, reason: '尚無後續行情或訊號日不在研究資料' });
      continue;
    }
    let resolved = 0;
    for (const horizon of horizons) {
      const outcome = outcomeFor(decision, row, horizon);
      if (outcome) { outcomes.push(outcome); resolved += 1; }
    }
    if (resolved < horizons.length) pending.push({ signalDate: decision.dataDate, reason: '等待足夠交易日，或跨月契約不可直接比較' });
  }
  return { outcomes, pending, selectedDecisions: latestDecisionPerDate(decisions).length };
}

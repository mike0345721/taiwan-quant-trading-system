function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

export function normalizeOiRows(rows, builtAt = new Date().toISOString()) {
  let prior = null;
  return rows.map((row) => {
    const nearOi = finite(row.nearContractOi) ? Number(row.nearContractOi) : null;
    const totalOi = finite(row.totalMarketOi) ? Number(row.totalMarketOi) : null;
    const nearScopeMarketOi = finite(row.nearScopeMarketOi) ? Number(row.nearScopeMarketOi) : null;
    const allContractsMarketOi = finite(row.allContractsMarketOi) ? Number(row.allContractsMarketOi) : totalOi;
    const contractChanged = Boolean(prior?.nearContract && row.nearContract && prior.nearContract !== row.nearContract);
    const rolloverRisk = Boolean(row.rolloverRisk) || (finite(row.daysToNearExpiry) && Number(row.daysToNearExpiry) <= 2);
    const qualityStatus = nearOi == null ? 'missing_near_oi'
      : contractChanged ? 'contract_changed'
        : rolloverRisk ? 'rollover_window'
          : 'clean';
    const normalized = {
      tradeDate: row.tradeDate,
      nearContract: row.nearContract || null,
      nearContractOi: nearOi,
      totalMarketOi: allContractsMarketOi,
      nearScopeMarketOi,
      allContractsMarketOi,
      productScope: row.productScope || null,
      researchOi: nearOi,
      researchDefinition: 'near_contract_oi',
      daysToNearExpiry: finite(row.daysToNearExpiry) ? Number(row.daysToNearExpiry) : null,
      rolloverRisk: rolloverRisk ? 1 : 0,
      contractChanged: contractChanged ? 1 : 0,
      qualityStatus,
      builtAt,
    };
    prior = normalized;
    return normalized;
  });
}

export function cleanOiDelta(rows, index, days = 1) {
  const current = rows[index];
  const previous = rows[index - days];
  if (!current || !previous || current.qualityStatus !== 'clean' || previous.qualityStatus !== 'clean') return null;
  const window = rows.slice(index - days, index + 1);
  if (window.length !== days + 1 || window.some((row) => row.qualityStatus !== 'clean')) return null;
  if (window.some((row) => row.nearContract !== current.nearContract)) return null;
  if (!finite(current.researchOi) || !finite(previous.researchOi)) return null;
  return Number(current.researchOi) - Number(previous.researchOi);
}

export function oiAudit(rows) {
  const count = (status) => rows.filter((row) => row.qualityStatus === status).length;
  const comparable = rows.filter((row) => finite(row.nearContractOi) && finite(row.totalMarketOi));
  const mismatches = comparable.filter((row) => Number(row.nearContractOi) !== Number(row.totalMarketOi));
  return {
    rows: rows.length,
    firstDate: rows[0]?.tradeDate || null,
    lastDate: rows.at(-1)?.tradeDate || null,
    nearOiCoverage: rows.filter((row) => finite(row.nearContractOi)).length,
    totalOiCoverage: rows.filter((row) => finite(row.totalMarketOi)).length,
    nearScopeMarketOiCoverage: rows.filter((row) => finite(row.nearScopeMarketOi)).length,
    allContractsMarketOiCoverage: rows.filter((row) => finite(row.allContractsMarketOi)).length,
    quality: {
      clean: count('clean'), rolloverWindow: count('rollover_window'),
      contractChanged: count('contract_changed'), missingNearOi: count('missing_near_oi'),
    },
    comparableDays: comparable.length,
    definitionMismatchDays: mismatches.length,
    mismatchDates: mismatches.map((row) => ({
      tradeDate: row.tradeDate, nearContractOi: row.nearContractOi,
      totalMarketOi: row.totalMarketOi, difference: row.totalMarketOi - row.nearContractOi,
    })),
    researchDefinition: 'near_contract_oi',
    rule: 'Never coalesce total-market OI with near-contract OI. OI deltas require clean rows, the same near contract, and no rollover window in the entire lookback.',
  };
}

export function sortedUnique(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function missingDates(expectedDates, actualDates) {
  const actual = new Set(actualDates);
  return sortedUnique(expectedDates).filter((date) => !actual.has(date));
}

export function buildContinuityReport({
  generatedAt,
  expectedDates,
  recoverableCoverage,
  liveCoverage,
  liveCoverageAudit = null,
}) {
  const recoverable = Object.fromEntries(
    Object.entries(recoverableCoverage).map(([key, dates]) => {
      const missing = missingDates(expectedDates, dates);
      return [key, {
        expectedDays: sortedUnique(expectedDates).length,
        coveredDays: sortedUnique(dates).length,
        missingDays: missing,
        status: missing.length === 0 ? 'PASS' : 'PENDING_BACKFILL',
      }];
    }),
  );

  const liveDates = sortedUnique(Object.keys(liveCoverage));
  const liveStartDate = liveDates[0] ?? null;
  const expectedLiveDates = liveStartDate
    ? sortedUnique(expectedDates).filter((date) => date >= liveStartDate)
    : [];
  const missingLiveDates = [];
  const incompleteLiveDates = [];
  const unresolved = new Set(liveCoverageAudit?.unresolvedDates ?? []);
  const unresolvedLiveDates = expectedLiveDates.filter((date) => unresolved.has(date));

  for (const date of expectedLiveDates) {
    if (unresolved.has(date)) continue;
    const products = new Set(liveCoverage[date] ?? []);
    const missingProducts = ['IX0001', '2330'].filter((product) => !products.has(product));
    if (missingProducts.length === 2) missingLiveDates.push(date);
    else if (missingProducts.length > 0) incompleteLiveDates.push({ date, missingProducts });
  }

  return {
    generatedAt,
    scope: 'CURRENT_DATA_CONTINUITY',
    executionAuthorized: false,
    recoverable,
    liveEventLedger: {
      collectionStartDate: liveStartDate,
      expectedCompletedTradingDays: expectedLiveDates.length,
      completeDays: expectedLiveDates.length - missingLiveDates.length - incompleteLiveDates.length - unresolvedLiveDates.length,
      missingDays: missingLiveDates,
      incompleteDays: incompleteLiveDates,
      unresolvedDays: [...unresolved].sort(),
      status: unresolved.size ? 'AUDIT_INCOMPLETE' : (missingLiveDates.length || incompleteLiveDates.length ? 'GAP_RECORDED' : 'PASS'),
      auditTelemetry: liveCoverageAudit?.telemetry ?? null,
      recoverability: 'Exact live events and latency evidence cannot be reconstructed after the fact.',
    },
  };
}

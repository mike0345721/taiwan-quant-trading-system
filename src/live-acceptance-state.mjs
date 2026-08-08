export function durableAcceptanceFromReport(report, {
  generatedAt = new Date().toISOString(),
  preserved = false,
} = {}) {
  return {
    schemaVersion: '3.9.7-live-acceptance-v1',
    generatedAt,
    sourceReportDate: report?.ledgerFile?.slice(0, 10) || null,
    sourceLedgerFile: report?.ledgerFile || null,
    sourceReportGeneratedAt: report?.generatedAt || null,
    acceptance: report?.acceptance || {
      status: 'PENDING',
      passed: false,
      reasons: ['live_acceptance_evidence_missing'],
      failReasons: [],
      pendingReasons: ['live_acceptance_evidence_missing'],
    },
    preserved,
    appendOnlyEvidence: true,
    researchOnly: true,
    executionAuthorized: false,
  };
}

export function selectDurableLiveAcceptance({
  currentReport,
  previousDurable = null,
  revalidatedPreviousReport = null,
  generatedAt = new Date().toISOString(),
} = {}) {
  if (currentReport?.acceptance?.status === 'PASS'
    && currentReport?.acceptance?.passed === true) {
    return durableAcceptanceFromReport(currentReport, { generatedAt });
  }

  if (previousDurable?.acceptance?.status === 'PASS'
    && previousDurable?.acceptance?.passed === true
    && revalidatedPreviousReport?.acceptance?.status === 'PASS'
    && revalidatedPreviousReport?.acceptance?.passed === true) {
    return durableAcceptanceFromReport(revalidatedPreviousReport, {
      generatedAt,
      preserved: true,
    });
  }

  return durableAcceptanceFromReport(currentReport, { generatedAt });
}

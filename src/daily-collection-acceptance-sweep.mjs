import { stableDailyAcceptanceJson } from './daily-collection-acceptance.mjs';
import crypto from 'node:crypto';

const hash = (value) => crypto.createHash('sha256').update(stableDailyAcceptanceJson(value)).digest('hex');
const categories = {
  LEDGER_NOT_FOUND: 'SOURCE_NOT_COLLECTED', QUOTE_TYPE_MISSING: 'SOURCE_NOT_COLLECTED',
  ARTIFACT_NOT_WRITTEN: 'ARTIFACT_IDENTITY_MISSING', TIMESTAMP_LINEAGE_INSUFFICIENT: 'ARTIFACT_IDENTITY_MISSING',
  CANONICAL_DATASET_ID_UNAVAILABLE: 'CANONICAL_ID_MISSING', LATE_START: 'COVERAGE_PARTIAL',
  CAPTURE_GAP_UNEXPLAINED: 'COVERAGE_PARTIAL', CONTINUITY_BREAK: 'COVERAGE_PARTIAL',
  PROVIDER_RECONNECT: 'COVERAGE_PARTIAL', LONG_GAP_QUALITY_INSUFFICIENT: 'COVERAGE_PARTIAL',
  STALE_DELIVERY: 'STALE_OR_DELAYED', WARMING_UP_WINDOW_INCOMPLETE: 'PROJECTION_NOT_READY',
};

export function dailyEvidenceGapMatrix(report) {
  return report.feeds.flatMap((feed) => {
    const unresolved = ['captureState', 'coverageState', 'persistenceState', 'integrityState']
      .some((key) => ['UNKNOWN', 'PARTIAL', 'FAIL', 'PENDING'].includes(feed[key]))
      || ['UNKNOWN', 'NOT_READY', 'READY_WITH_LIMITATION'].includes(feed.researchEligibility)
      || feed.expectedState === 'NOT_EXPECTED';
    if (!unresolved) return [];
    const reasons = [...new Set(feed.reasonCodes)].sort();
    return [{ datasetId: feed.datasetId, technicalLabelEn: feed.technicalLabelEn,
      session: feed.session, expectedState: feed.expectedState,
      captureState: feed.captureState, persistenceState: feed.persistenceState,
      integrityState: feed.integrityState, researchEligibility: feed.researchEligibility,
      categories: [...new Set(reasons.map((code) => categories[code] || code))].sort(),
      reasonCodes: reasons, reasonZh: feed.reasonZh }];
  });
}

function median(values) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
function p95(values) {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
}

export function buildDailyAcceptanceSweep(reports) {
  if (!Array.isArray(reports) || !reports.length) throw new Error('DAILY_SWEEP_REPORTS_REQUIRED');
  const sorted = [...reports].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  if (new Set(sorted.map((item) => item.tradeDate)).size !== sorted.length) throw new Error('DAILY_SWEEP_DUPLICATE_TRADE_DATE');
  const files = new Map();
  const dates = sorted.map((report) => {
    if (report.schemaVersion !== 'daily-collection-acceptance-v1') throw new Error('DAILY_SWEEP_SCHEMA_INVALID');
    if (report.safety?.executionAuthorized !== false || report.safety?.orderRoutesEnabled !== false
      || report.safety?.researchOnly !== true || report.safety?.formalWeight !== 0) throw new Error('DAILY_SWEEP_UNSAFE_REPORT');
    const identity = report.sourceArtifactIdentity;
    for (const file of identity?.files || []) {
      if (!/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(file.file) || !/^[a-f0-9]{64}$/.test(file.prefixSha256 || '')
        || !Number.isSafeInteger(file.cutoffBytes) || file.cutoffBytes < 0) throw new Error('DAILY_SWEEP_LEDGER_IDENTITY_INVALID');
      // A shared calendar ledger may occur in adjacent tradeDate scopes. Count it once.
      const existing = files.get(file.file);
      if (existing && stableDailyAcceptanceJson(existing) !== stableDailyAcceptanceJson(file)) {
        throw new Error('DAILY_SWEEP_CONFLICTING_IMMUTABLE_CUTOFF');
      }
      files.set(file.file, file);
    }
    const reasonCounts = {};
    for (const feed of report.feeds) for (const code of feed.reasonCodes) reasonCounts[code] = (reasonCounts[code] || 0) + 1;
    return { tradeDate: report.tradeDate, calendarDates: [...new Set(report.feeds.flatMap((f) => f.calendarDates || []))].sort(),
      selectedLedgerCalendarDates: (identity?.files || []).map((f) => f.file.slice(0, 10)),
      generatedAt: report.generatedAt, sessions: report.sessions, marketDayState: report.marketDayState,
      overallState: report.overallState, ...report.summary,
      rawBytesScope: 'selected immutable calendar-ledger cutoffs; can overlap adjacent acceptance dates',
      recordsScope: 'accepted first-wave live records for the requested tradeDate within selected ledgers',
      topReasonCodes: Object.entries(reasonCounts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([code, count]) => ({ code, count })),
      acceptanceSha256: hash(report) };
  });
  const ledgerSamples = [...files.values()].sort((a, b) => a.file.localeCompare(b.file));
  const byteSamples = ledgerSamples.map((f) => f.cutoffBytes);
  const recordSamples = ledgerSamples.filter((f) => Number.isSafeInteger(f.physicalRecords) && f.physicalRecords >= 0).map((f) => f.physicalRecords);
  return {
    schemaVersion: 'daily-collection-acceptance-sweep-v1', dates,
    storageStatistics: {
      scope: 'unique calendar-day raw ledger immutable prefixes selected by this sweep; all physical nonempty records, all feeds; not whole-project storage',
      N: byteSamples.length, recordSampleCount: recordSamples.length,
      medianDailyRawBytes: median(byteSamples), p95DailyRawBytes: p95(byteSamples),
      medianRecords: median(recordSamples), p95Records: p95(recordSamples),
      percentileMethod: 'nearest-rank p95; arithmetic middle-pair median',
      coverage: 'convenience sample of existing prefixes; no complete-market-day or representative annual-coverage claim',
      forecast: 'NOT_VERIFIED', ledgerSamples,
    },
    evidenceGapMatrix: sorted.map((report) => ({ tradeDate: report.tradeDate, rows: dailyEvidenceGapMatrix(report) })),
    safety: { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false },
  };
}

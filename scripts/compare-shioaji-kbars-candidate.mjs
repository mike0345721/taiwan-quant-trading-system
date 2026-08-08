import fs from 'node:fs';
import path from 'node:path';
import { compareCandidateDay, evaluateOverlapAdmission } from '../src/shioaji-kbar-overlap.mjs';

const root = path.resolve(import.meta.dirname, '..');
const candidatePath = path.join(root, 'data', 'intraday', 'candidates', 'shioaji-kbars-29d', 'raw.json');
const reportPath = path.join(root, 'data', 'intraday', 'candidates', 'shioaji-kbars-29d', 'quality-report.json');
const archiveDir = path.join(root, 'data', 'intraday', 'archive');

const candidate = JSON.parse(fs.readFileSync(candidatePath, 'utf8'));
if (candidate.executionAuthorized !== false || candidate.candidateOnly !== true) {
  throw new Error('candidate_safety_metadata_invalid');
}

const rowsByDate = new Map();
for (const row of candidate.rows || []) {
  if (!rowsByDate.has(row.tradeDate)) rowsByDate.set(row.tradeDate, []);
  rowsByDate.get(row.tradeDate).push(row);
}

const days = candidate.targetDates.map((tradeDate) => {
  const officialPath = path.join(archiveDir, `${tradeDate}-day.json`);
  const official = JSON.parse(fs.readFileSync(officialPath, 'utf8'));
  return compareCandidateDay(rowsByDate.get(tradeDate) || [], official);
});
const admission = evaluateOverlapAdmission(days, { expectedDays: candidate.targetDates.length });
const rolloverMismatchDates = days
  .filter((day) => ['open', 'high', 'low', 'close'].some((field) => day.exactCounts[field] < 30))
  .map((day) => day.tradeDate);
const ordinaryDays = days.filter((day) => !rolloverMismatchDates.includes(day.tradeDate));
const ordinaryBars = ordinaryDays.reduce((sum, day) => sum + day.matchedBars, 0);
const ordinaryExactCounts = Object.fromEntries(
  ['open', 'high', 'low', 'close'].map((field) => [
    field,
    ordinaryDays.reduce((sum, day) => sum + day.exactCounts[field], 0),
  ]),
);
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  candidate: {
    source: candidate.source,
    requestedContract: candidate.requestedContract,
    contractMetadata: candidate.contractMetadata,
    targetDateCount: candidate.targetDates.length,
    oneMinuteRows: candidate.rowCount,
    candidateOnly: true,
    executionAuthorized: false,
  },
  admission,
  diagnostics: {
    rolloverMismatchDates,
    interpretation: rolloverMismatchDates.length
      ? 'TXFR1 and the official day-session volume-leader contract diverge on rollover selection dates'
      : 'no rollover-level divergence detected',
    nonRollover: {
      days: ordinaryDays.length,
      bars: ordinaryBars,
      exactCounts: ordinaryExactCounts,
      exactRates: Object.fromEntries(
        Object.entries(ordinaryExactCounts).map(([field, count]) => [
          field,
          ordinaryBars ? count / ordinaryBars : null,
        ]),
      ),
    },
    volumeDefinitionWarning:
      'Shioaji aggregated Volume is not byte-equivalent to TAIFEX B+S divided by 2; do not merge volume-derived factors.',
  },
  days,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
fs.writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
console.log(JSON.stringify({ reportPath, admission }, null, 2));

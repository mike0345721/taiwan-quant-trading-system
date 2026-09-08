import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const archiveDir = path.resolve(process.env.TX_RVOL_ARCHIVE_DIR || path.join(root, 'data', 'intraday', 'archive'));
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})-day\.json$/;

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}

function auditPassed(state) {
  return typeof state === 'string' && state.startsWith('passed');
}

function finite(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function timeBucket(timestamp) {
  return typeof timestamp === 'string' && timestamp.length >= 16 ? timestamp.slice(11, 16) : null;
}

const dayFiles = fs.existsSync(archiveDir)
  ? fs.readdirSync(archiveDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && DAY_FILE.test(entry.name))
    .map((entry) => ({ name: entry.name, tradeDate: entry.name.match(DAY_FILE)[1] }))
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
  : [];

const rows = dayFiles.map(({ name, tradeDate }) => {
  const payload = readJson(path.join(archiveDir, name));
  const audit = readJson(path.join(archiveDir, `${tradeDate}-audit.json`));
  const bars = Array.isArray(payload?.bars) ? payload.bars : [];
  const validVolumeBars = bars.filter((bar) => timeBucket(bar?.timestamp) && finite(bar?.volume));
  return {
    tradeDate,
    contract: payload?.contract || null,
    bars: bars.length,
    validVolumeBars: validVolumeBars.length,
    auditState: audit?.state || 'not_audited',
    auditPassed: auditPassed(audit?.state),
    fullDay60Bars: bars.length === 60,
    buckets: validVolumeBars.map((bar) => timeBucket(bar.timestamp)),
  };
});

const governedCandidates = rows.filter((row) => row.auditPassed && row.fullDay60Bars
  && row.validVolumeBars === 60 && /^\d{6}$/.test(String(row.contract || '')));
const bucketCounts = new Map();
for (const row of governedCandidates) {
  for (const bucket of new Set(row.buckets)) bucketCounts.set(bucket, (bucketCounts.get(bucket) || 0) + 1);
}
const sortedBucketCounts = [...bucketCounts.entries()].sort(([a], [b]) => a.localeCompare(b));
const counts = sortedBucketCounts.map(([, count]) => count).sort((a, b) => a - b);
const medianCount = counts.length
  ? (counts.length % 2 ? counts[Math.floor(counts.length / 2)] : (counts[counts.length / 2 - 1] + counts[counts.length / 2]) / 2)
  : 0;
const contractCounts = Object.fromEntries([...new Set(governedCandidates.map((row) => row.contract).filter(Boolean))]
  .sort()
  .map((contract) => [contract, governedCandidates.filter((row) => row.contract === contract).length]));
const ineligibleCatalogDays = rows.filter((row) => !(row.auditPassed && row.fullDay60Bars
  && row.validVolumeBars === 60 && /^\d{6}$/.test(String(row.contract || ''))))
  .map((row) => ({
    tradeDate: row.tradeDate,
    reasons: [
      !row.auditPassed ? `AUDIT_${String(row.auditState).toUpperCase()}` : null,
      !row.fullDay60Bars ? `EXPECTED_60_BARS_GOT_${row.bars}` : null,
      row.validVolumeBars !== 60 ? `EXPECTED_60_VALID_VOLUME_BARS_GOT_${row.validVolumeBars}` : null,
      !/^\d{6}$/.test(String(row.contract || '')) ? 'CONTRACT_IDENTITY_INCOMPLETE' : null,
    ].filter(Boolean),
  }));
const contractTransitions = [];
for (let index = 1; index < governedCandidates.length; index += 1) {
  const previous = governedCandidates[index - 1];
  const current = governedCandidates[index];
  if (previous.contract && current.contract && previous.contract !== current.contract) {
    contractTransitions.push({
      fromTradeDate: previous.tradeDate,
      toTradeDate: current.tradeDate,
      fromContract: previous.contract,
      toContract: current.contract,
    });
  }
}

const report = {
  schemaVersion: 'cru45-tx-rvol-baseline-readiness-v1',
  archiveDir,
  catalogDayFiles: rows.length,
  auditPassedDays: rows.filter((row) => row.auditPassed).length,
  full60BarDays: rows.filter((row) => row.fullDay60Bars).length,
  governedCandidateDays: governedCandidates.length,
  firstCandidateDate: governedCandidates[0]?.tradeDate || null,
  lastCandidateDate: governedCandidates.at(-1)?.tradeDate || null,
  contractDayCounts: contractCounts,
  missingDays: {
    state: 'UNASSESSED',
    reason: 'GOVERNED_TRADING_CALENDAR_NOT_CONFIGURED',
    explanation: 'catalog inspection can identify ineligible files but cannot infer absent trading dates without an authoritative calendar',
  },
  ineligibleCatalogDays,
  rolloverBehavior: {
    transitionCount: contractTransitions.length,
    transitions: contractTransitions,
    existingCandidatePooling: 'previous up-to-20 eligible days may span a contract transition; roll-day identity remains descriptive evidence',
    promotionRequirement: 'freeze an explicit rollover inclusion/exclusion policy before formal promotion',
  },
  sessionBehavior: {
    auditedSession: 'DAY',
    timeframe: '5m',
    expectedBarsPerSession: 60,
    bucketIdentityCurrent: 'UTC_ISO_HH_MM_SUBSTRING_DERIVED_FROM_ASIA_TAIPEI_SOURCE',
    promotionRequirement: 'replace serialized substring matching with explicit Asia/Taipei or session-relative bucket identity',
  },
  sameTimeBucketCount: sortedBucketCounts.length,
  sameTimeSampleDays: {
    min: counts[0] || 0,
    median: medianCount,
    max: counts.at(-1) || 0,
  },
  bucketSamples: Object.fromEntries(sortedBucketCounts),
  candidateRule: 'auditPassed && exactly 60 day-session 5m bars && all 60 bars have finite volume && canonical YYYYMM contract identity',
  baselineMethodExistingCandidate: 'historical replay currently uses previous up-to-20 catalog days and same-time median volume',
  promotionState: 'RESEARCH_PENDING',
  warning: 'This audit reports sample readiness only. It does not define a minimum sample threshold, label 爆量/量縮, or authorize live RVOL promotion.',
  researchOnly: true,
  formalWeight: 0,
  executionAuthorized: false,
  orderRoutesEnabled: false,
};

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

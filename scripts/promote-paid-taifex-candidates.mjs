import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { promotePaidCandidateArchives } from '../src/paid-taifex-import.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

const validationPath = path.resolve(argument('--validation') || '');
const reportPath = path.resolve(argument('--report') || 'data/intraday/paid-candidates/latest-promotion.json');
if (!fs.existsSync(validationPath)) {
  console.error('Usage: node scripts/promote-paid-taifex-candidates.mjs --validation <passed-report.json> [--report <json>]');
  process.exit(2);
}
const validation = JSON.parse(fs.readFileSync(validationPath, 'utf8'));
if (validation.failedDays !== 0 || validation.acceptedDays !== validation.discoveredFiles
  || !Array.isArray(validation.acceptedDates) || validation.acceptedDates.length === 0) {
  throw new Error('PAID_VALIDATION_REPORT_NOT_FULLY_ACCEPTED');
}
if (validation.researchOnly !== true || validation.executionAuthorized !== false) {
  throw new Error('PAID_VALIDATION_SAFETY_BOUNDARY_MISSING');
}

const candidateDir = path.resolve('data/intraday/paid-candidates/archive');
const archiveDir = path.resolve('data/intraday/archive');
const promotion = promotePaidCandidateArchives(
  candidateDir,
  archiveDir,
  validation.acceptedDates,
);
let auditFiles = 0;
let existingAuditFiles = 0;
for (const day of validation.days || []) {
  if (day.pass !== true || !validation.acceptedDates.includes(day.tradeDate)) continue;
  const auditPath = path.join(archiveDir, `${day.tradeDate}-audit.json`);
  if (fs.existsSync(auditPath)) {
    existingAuditFiles += 1;
    continue;
  }
  atomicWrite(auditPath, {
    ...day,
    schemaVersion: '1.0.0',
    generatedAt: validation.generatedAt,
    contract: day.contract || day.selectedContract || null,
    source: 'TAIFEX paid historical futures trade summary',
    executionAuthorized: false,
  });
  auditFiles += 1;
}
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  validationReport: path.relative(process.cwd(), validationPath),
  acceptedDays: validation.acceptedDates.length,
  promotedFiles: promotion.promoted.length,
  identicalExistingFiles: promotion.identicalExisting.length,
  auditFiles,
  existingAuditFiles,
  promotedDates: validation.acceptedDates,
  overwriteAllowed: false,
  researchOnly: true,
  executionAuthorized: false,
};
atomicWrite(reportPath, report);
console.log(JSON.stringify({ reportPath, ...report }, null, 2));

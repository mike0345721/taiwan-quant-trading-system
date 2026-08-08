import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  auditPaperEventLedger,
  loadOfficialReplayEvidence,
  readPaperEventLedger,
  validatePaperEvidence,
} from '../src/paper-event-ledger.mjs';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archiveDir = path.join(appRoot, 'data', 'intraday', 'archive');
const ledgerPath = path.join(appRoot, 'data', 'forward', 'v3.8-paper-events.jsonl');
const reportPath = path.join(appRoot, 'data', 'forward', 'v3.8-paper-events-audit.json');
const records = readPaperEventLedger(ledgerPath);
const result = auditPaperEventLedger(records);
const evidenceErrors = [];
for (const [index, record] of records.entries()) {
  try {
    const evidence = loadOfficialReplayEvidence(archiveDir, {
      tradeDate: record.tradeDate,
      session: record.session,
      cursor: record.dataEvidence?.cursor,
    });
    const verified = validatePaperEvidence(record, evidence);
    if (verified.sourceHash !== record.dataEvidence?.sourceHash) evidenceErrors.push(`row_${index + 1}_archive_source_hash_mismatch`);
    if (verified.auditHash !== record.dataEvidence?.auditHash) evidenceErrors.push(`row_${index + 1}_archive_audit_hash_mismatch`);
    if (verified.observedThrough !== record.dataEvidence?.observedThrough) evidenceErrors.push(`row_${index + 1}_archive_cursor_mismatch`);
  } catch (error) {
    evidenceErrors.push(`row_${index + 1}_archive_evidence_error:${error.message}`);
  }
}
const report = {
  schemaVersion: '3.8.0-paper-event-audit-v1',
  generatedAt: new Date().toISOString(),
  state: [...result.errors, ...evidenceErrors].length ? 'failed' : records.length ? 'tracking' : 'awaiting_first_event',
  ledger: path.relative(appRoot, ledgerPath),
  records: result.records,
  candidates: result.candidates,
  errors: [...new Set([...result.errors, ...evidenceErrors])],
  appendOnly: true,
  researchOnly: true,
  executionAuthorized: false,
};
fs.mkdirSync(path.dirname(reportPath), { recursive: true });
const tempPath = `${reportPath}.${process.pid}.tmp`;
fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.renameSync(tempPath, reportPath);
console.log(JSON.stringify(report, null, 2));
if (report.errors.length) process.exit(1);

import fs from 'node:fs';
import { dailyStorageRoots, assertDailyArguments } from '../src/daily-storage-binding.mjs';
assertDailyArguments();
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { materializeV3OutcomeLedger, validResolvedOutcome } from '../v2/src/v3-outcome-ledger.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = dailyStorageRoots(path.dirname(scriptDir)).storageAppRoot;
const ledgerPath = path.join(appRoot, 'v2', 'data', 'forward', 'v3-decision-ledger.jsonl');
const outcomeLedgerPath = path.join(appRoot, 'v2', 'data', 'forward', 'v3-outcomes-ledger.jsonl');
const reportPath = path.join(appRoot, 'v2', 'reports', 'v3-forward-ledger-audit.json');
function atomicWrite(filePath, value) { fs.mkdirSync(path.dirname(filePath), { recursive: true }); const temp = `${filePath}.${process.pid}.tmp`; fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8'); fs.renameSync(temp, filePath); }

const errors = [];
const rows = [];
if (!fs.existsSync(ledgerPath)) errors.push('ledger_not_found');
else {
  for (const [index, line] of fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean).entries()) {
    try { rows.push(JSON.parse(line)); } catch { errors.push(`line_${index + 1}_invalid_json`); }
  }
}
const keys = new Set();
let previousGeneratedAt = '';
for (const [index, row] of rows.entries()) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.dataDate || '')) errors.push(`row_${index + 1}_date_invalid`);
  if (!row.generatedAt || Number.isNaN(Date.parse(row.generatedAt))) errors.push(`row_${index + 1}_generated_at_invalid`);
  if (previousGeneratedAt && row.generatedAt < previousGeneratedAt) errors.push(`row_${index + 1}_append_time_not_chronological`);
  previousGeneratedAt = row.generatedAt || previousGeneratedAt;
  const key = `${row.version}|${row.dataDate}`;
  if (keys.has(key)) errors.push(`row_${index + 1}_duplicate`);
  keys.add(key);
  if (row.dataMode === 'mock' || row.mock === true) errors.push(`row_${index + 1}_mock_forbidden`);
  if (row.executionAuthorized === true) errors.push(`row_${index + 1}_execution_forbidden`);
}
const outcomeRows = [];
if (fs.existsSync(outcomeLedgerPath)) {
  for (const [index, line] of fs.readFileSync(outcomeLedgerPath, 'utf8').split(/\r?\n/).filter(Boolean).entries()) {
    try { outcomeRows.push(JSON.parse(line)); } catch { errors.push(`outcome_line_${index + 1}_invalid_json`); }
  }
}
const outcomeLedger = materializeV3OutcomeLedger(outcomeRows);
errors.push(...outcomeLedger.errors.map((error) => `outcome_${error}`));
for (const [index, row] of outcomeLedger.records.entries()) {
  if (!validResolvedOutcome(row, { requireStrictOhlc: row.recordType === 'correction' })) {
    errors.push(`effective_outcome_${index + 1}_invalid`);
  }
  if (row.executionAuthorized === true) errors.push(`effective_outcome_${index + 1}_execution_forbidden`);
  if (row.researchOnly !== true) errors.push(`effective_outcome_${index + 1}_research_only_missing`);
}
const report = {
  schemaVersion: '1.0.0', state: errors.length ? 'failed' : rows.length ? 'tracking' : 'awaiting_first_record',
  generatedAt: new Date().toISOString(), ledger: path.relative(appRoot, ledgerPath), records: rows.length,
  firstDate: rows.map((row) => row.dataDate).sort()[0] || null,
  latestDate: rows.map((row) => row.dataDate).sort().at(-1) || null,
  outcomeLedger: path.relative(appRoot, outcomeLedgerPath),
  outcomeLedgerRecords: outcomeRows.length,
  effectiveOutcomeRecords: outcomeLedger.records.length,
  outcomeCorrections: outcomeLedger.corrections,
  errors: [...new Set(errors)], frozenResearchOnly: true, executionAuthorized: false,
};
atomicWrite(reportPath, report);
console.log(JSON.stringify(report, null, 2));
if (errors.length) process.exit(1);

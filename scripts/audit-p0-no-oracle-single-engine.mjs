import fs from 'node:fs';
import path from 'node:path';
import { auditPaperTradingLedger, digest, rebuildPaperSession } from '../src/p0-paper-trading.mjs';
import { executeP0HistoricalRaw } from '../src/p0-market-engine.mjs';
import { compareProtectionSnapshots, loadAndVerifyFrozenInputs, snapshotProtectedArtifacts } from '../src/t0-h0-runner.mjs';

const root = process.cwd();
const comparatorDir = path.join(root, 'data/research/t0-h0-formal-v1/run-2026-08-02-v1/jobs');
const outputDir = path.join(root, 'data/paper/p0-no-oracle-single-engine-v1');
const frozen = loadAndVerifyFrozenInputs(root);
const before = snapshotProtectedArtifacts(root);
const events = [];
const comparisons = [];

for (const manifestRow of frozen.strictManifest.sessions) {
  const result = await executeP0HistoricalRaw({ root, manifestRow, costPolicy: frozen.costPolicy, existingEvents: events });
  const comparatorFile = path.join(comparatorDir, `${manifestRow.sessionId}.json`);
  const comparator = JSON.parse(fs.readFileSync(comparatorFile, 'utf8'));
  const actual = result.detection;
  const fields = ['tradeState', 'noTradeReason', 'breakoutDirection', 'breakoutConfirmedAt', 'entryAt', 'entryReferencePrice', 'initialStopPrice', 'exitAt', 'exitReferencePrice', 'exitReason'];
  const mismatches = fields.filter((field) => (actual[field] ?? null) !== (comparator[field] ?? null)).map((field) => ({ field, actual: actual[field] ?? null, comparator: comparator[field] ?? null }));
  const actualBase = actual.costViews?.find((row) => row.viewId === 'BASE_2_TICKS_PER_SIDE')?.netPnl ?? null;
  const comparatorBase = comparator.costViews?.find((row) => row.viewId === 'BASE_2_TICKS_PER_SIDE')?.netPnl ?? null;
  if (actualBase !== comparatorBase) mismatches.push({ field: 'base2NetPnl', actual: actualBase, comparator: comparatorBase });
  comparisons.push({ tradeDate: manifestRow.tradeDate, sessionId: manifestRow.sessionId, status: mismatches.length ? 'FAIL' : 'PASS', mismatches, comparatorReadAfterPaperSessionCompleted: true });
}

const ledgerAudit = auditPaperTradingLedger(events);
const reconstructed = frozen.strictManifest.sessions.map((row) => rebuildPaperSession(events, row.sessionId));
const after = snapshotProtectedArtifacts(root);
const protection = compareProtectionSnapshots(before, after);
const sourceFiles = [
  'src/p0-market-engine.mjs',
  'src/p0-paper-trading.mjs',
  'scripts/run-p0-forward-paper-observer.mjs',
];
const forbiddenImports = ['run-t0-h0-formal.mjs', 'data/research/t0-h0-formal-v1'];
const sourceAudit = sourceFiles.map((name) => ({
  file: name,
  forbiddenEngineImportFound: forbiddenImports.some((text) => fs.readFileSync(path.join(root, name), 'utf8').includes(text)),
}));
const report = {
  schemaVersion: 'p0-no-oracle-single-engine-audit-v1',
  status: comparisons.every((row) => row.status === 'PASS') && ledgerAudit.ok && protection.pass && sourceAudit.every((row) => !row.forbiddenEngineImportFound) ? 'PASS' : 'FAIL',
  sessionCount: comparisons.length,
  comparatorMismatchCount: comparisons.filter((row) => row.status === 'FAIL').length,
  ledgerAudit,
  reconstructedSessionCount: reconstructed.filter((row) => row.finalState === 'SESSION_RECONCILED').length,
  enginePath: 'raw market ticks -> frozen T0 detection -> paper state machine -> ledger -> comparator',
  comparatorTiming: 'AFTER_PAPER_SESSION_COMPLETED',
  oracleInputsUsedByEngine: [],
  sourceAudit,
  frozenArtifactProtection: protection,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  comparisons,
};
fs.mkdirSync(outputDir, { recursive: true });
const target = path.join(outputDir, 'P0_NO_ORACLE_SINGLE_ENGINE_AUDIT.json');
fs.writeFileSync(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
const manifest = { reportPath: target, reportHash: digest(report), status: report.status, generatedAt: new Date().toISOString(), executionAuthorized: false };
fs.writeFileSync(path.join(outputDir, 'MANIFEST.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(manifest, null, 2));
if (report.status !== 'PASS') process.exit(1);

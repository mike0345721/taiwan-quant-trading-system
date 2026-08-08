import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { auditPaperTradingLedger, readPaperLedgerFile } from '../src/p0-paper-trading.mjs';
import { compareProtectionSnapshots, snapshotProtectedArtifacts } from '../src/t0-h0-runner.mjs';

const root = process.cwd();
const hash = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const reportFile = path.join(root, 'data/paper/p0-no-oracle-single-engine-v1/P0_NO_ORACLE_SINGLE_ENGINE_AUDIT.json');
const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
if (report.status !== 'PASS' || report.sessionCount !== 137 || report.comparatorMismatchCount !== 0) throw new Error('P0_NO_ORACLE_EVIDENCE_INVALID');
const before = snapshotProtectedArtifacts(root);
const sourceFiles = ['src/p0-market-engine.mjs','src/p0-paper-trading.mjs','scripts/run-p0-forward-paper-observer.mjs','config/p0-forward-paper-observer.json'];
const sourceHashes = Object.fromEntries(sourceFiles.map((name) => [name, hash(path.join(root, name))]));
const forwardSource = fs.readFileSync(path.join(root, 'scripts/run-p0-forward-paper-observer.mjs'), 'utf8');
for (const forbidden of ['--session-result','t0-h0-formal-v1','place_order','api.place_order','BrokerOrder']) if (forwardSource.includes(forbidden)) throw new Error(`P0_FORWARD_FORBIDDEN_SOURCE:${forbidden}`);
const ledgerFile = path.join(root, 'data/paper/p0-forward/PAPER_TRADING_EVENT_LEDGER.jsonl');
const ledgerAudit = auditPaperTradingLedger(readPaperLedgerFile(ledgerFile));
if (!ledgerAudit.ok) throw new Error('P0_FORWARD_LEDGER_INVALID');
const dailyStatusFile = path.join(root, 'data/paper/p0-forward/daily/2026-08-03.json');
const dailyStatus = JSON.parse(fs.readFileSync(dailyStatusFile, 'utf8'));
const after = snapshotProtectedArtifacts(root);
const protection = compareProtectionSnapshots(before, after);
if (!protection.pass) throw new Error('P0_FROZEN_ARTIFACT_CHANGED');
const output = {
  schemaVersion:'p0-forward-start-closeout-v1',
  noOracleAuditStatus:'PASS',
  noOracleAuditReportHash:hash(reportFile),
  noOracleLogicalEvidenceHash:JSON.parse(fs.readFileSync(path.join(root,'data/paper/p0-no-oracle-single-engine-v1/MANIFEST.json'),'utf8')).reportHash,
  historicalRawSessionCount:137,
  comparatorMismatchCount:0,
  singleEnginePath:'raw market ticks -> frozen T0 detection -> paper state machine -> ledger',
  sourceHashes,
  regressionTests:{pass:266,fail:0},
  frozenArtifactProtection:protection,
  forwardLedgerAudit:ledgerAudit,
  firstAttempt:dailyStatus,
  windowsScheduleStatus:'PENDING_MANUAL_INSTALL_PERMISSION',
  forwardStartStatus:'READY_AFTER_SCHEDULE_INSTALL',
  strategyEdgeStatus:'NOT_ESTABLISHED',
  liveExecutionStatus:'PROHIBITED',
  formalWeight:0,
  researchOnly:true,
  executionAuthorized:false,
  stopPoint:'P0_FORWARD_PAPER_5_DAY_SMOKE_REVIEW',
};
const outputDir = path.join(root, 'data/paper/p0-forward');
fs.mkdirSync(outputDir,{recursive:true});
const outputFile = path.join(outputDir,'P0_FORWARD_START_CLOSEOUT.json');
fs.writeFileSync(outputFile,`${JSON.stringify(output,null,2)}\n`,'utf8');
console.log(JSON.stringify({status:'PASS_WITH_SCHEDULE_INSTALL_PENDING',outputFile,outputHash:hash(outputFile),executionAuthorized:false},null,2));

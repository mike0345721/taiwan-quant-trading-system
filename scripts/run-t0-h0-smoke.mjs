import fs from 'node:fs';
import path from 'node:path';
import {
  NATURAL_SMOKE_DATES,
  atomicJson,
  buildSyntheticFixtures,
  commitJob,
  compareProtectionSnapshots,
  executeNaturalSession,
  fileSha256,
  finalizeRun,
  initializeOrResumeRun,
  loadAndVerifyFrozenInputs,
  snapshotProtectedArtifacts,
  summarizeEngineeringResults,
} from '../src/t0-h0-runner.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const value = (name, fallback = null) => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : fallback;
};
const mode = value('--mode');
const resume = args.includes('--resume');
const stopAfter = Number(value('--stop-after', '0'));
if (!['natural-smoke', 'fixture-smoke'].includes(mode)) throw new Error('SMOKE_MODE_REQUIRED:natural-smoke|fixture-smoke');
if (args.includes('--full') || args.includes('--all-sessions')) throw new Error('FORMAL_137_DAY_RUN_NOT_AUTHORIZED');

const defaultName = mode === 'natural-smoke' ? 'run-2026-08-02-natural-v2' : 'run-2026-08-02-fixtures-v3';
const runDir = path.resolve(value('--run-dir', path.join(root, 'data/research/t0-h0-smoke-v1', defaultName)));
const runId = path.basename(runDir);
const started = process.hrtime.bigint();
const usageBefore = process.resourceUsage();
const frozen = loadAndVerifyFrozenInputs(root);
const protectionBefore = snapshotProtectedArtifacts(root);

function replayFile(tradeDate, contractCode) {
  const selected = path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02/selected-contract-replays', `${tradeDate}-${contractCode}.json`);
  return fs.existsSync(selected) ? selected : path.join(root, 'data/intraday/archive', `${tradeDate}-day.json`);
}

function buildReferenceSessions() {
  const rows = [];
  const files = fs.readdirSync(path.join(root, 'data/intraday/archive')).filter((name) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(name)).sort();
  for (const name of files) {
    const file = path.join(root, 'data/intraday/archive', name);
    sourceBytesRead += fs.statSync(file).size;
    const replay = JSON.parse(fs.readFileSync(file, 'utf8'));
    let cumulativeVolume = 0;
    for (const bar of replay.bars) {
      cumulativeVolume += bar.volume;
      rows.push({ tradeDate: replay.tradeDate, sessionId: `${replay.tradeDate}-DAY`, sessionType: 'DAY', timeBucket: bar.timestamp.slice(11, 16), cumulativeVolume, isSettlementSession: false, rollSession: false });
    }
  }
  const settlement = new Set(frozen.strictManifest.sessions.filter((row) => row.settlementClass.startsWith('SETTLEMENT_')).map((row) => row.tradeDate));
  const roll = new Set(frozen.strictManifest.sessions.filter((row) => row.rollSession).map((row) => row.tradeDate));
  for (const row of rows) {
    row.isSettlementSession = settlement.has(row.tradeDate);
    row.rollSession = roll.has(row.tradeDate);
  }
  return rows;
}

let definitions;
let fixtureOutputs = null;
let referenceSessions = [];
let sourceBytesRead = 0;
if (mode === 'natural-smoke') {
  definitions = NATURAL_SMOKE_DATES.map((tradeDate) => ({ jobId: tradeDate, tradeDate }));
  const selectedRows = NATURAL_SMOKE_DATES.map((tradeDate) => frozen.strictManifest.sessions.find((row) => row.tradeDate === tradeDate));
  if (selectedRows.some((row) => !row)) throw new Error('HARD_FAIL_NATURAL_SMOKE_DATE_NOT_STRICT');
  if (selectedRows[0].settlementClass !== 'NORMAL_SESSION' || selectedRows[1].settlementClass !== 'SETTLEMENT_FINAL_CONTRACT' || selectedRows[2].rollSession !== true) throw new Error('HARD_FAIL_NATURAL_SMOKE_CLASSIFICATION');
  referenceSessions = buildReferenceSessions();
  sourceBytesRead += fs.statSync(frozen.files.strictManifest).size;
} else {
  fixtureOutputs = buildSyntheticFixtures(frozen.costPolicy);
  definitions = fixtureOutputs.map((fixture) => ({ jobId: fixture.fixtureId }));
}

const manifest = initializeOrResumeRun({ root, runDir, runId, mode, jobs: definitions, frozenHashes: frozen.hashes, resume });
if (manifest.status === 'COMPLETED') {
  const protectionAfter = snapshotProtectedArtifacts(root);
  const protection = compareProtectionSnapshots(protectionBefore, protectionAfter);
  if (!protection.pass) throw new Error(`HARD_FAIL_PROTECTED_ARTIFACT_CHANGED:${protection.changed.join(',')}`);
  console.log(JSON.stringify({ runId, status: 'COMPLETED_ALREADY', logicalOutputHash: manifest.logicalOutputHash, completedJobs: manifest.jobs.length, skippedJobs: manifest.jobs.length, frozenProtection: protection, elapsedMs: Number(process.hrtime.bigint() - started) / 1e6 }, null, 2));
  process.exit(0);
}

let newlyCompleted = 0;
for (const definition of definitions) {
  const job = manifest.jobs.find((row) => row.jobId === definition.jobId);
  if (job.status === 'COMPLETED') continue;
  let output;
  if (mode === 'natural-smoke') {
    const row = frozen.strictManifest.sessions.find((candidate) => candidate.tradeDate === definition.tradeDate);
    const file = replayFile(definition.tradeDate, row.actualReplayContractCode);
    sourceBytesRead += fs.statSync(file).size;
    const replay = JSON.parse(fs.readFileSync(file, 'utf8'));
    output = executeNaturalSession({ manifestRow: row, replay, costPolicy: frozen.costPolicy, referenceSessions });
    output.inputDataHash = fileSha256(file);
    output.specHash = frozen.hashes.t0SpecHash;
    output.costPolicyHash = frozen.hashes.costPolicyHash;
    output.manifestHash = frozen.hashes.strictManifestHash;
  } else {
    output = fixtureOutputs.find((fixture) => fixture.fixtureId === definition.jobId);
    output.specHash = frozen.hashes.t0SpecHash;
    output.costPolicyHash = frozen.hashes.costPolicyHash;
    output.fixtureManifestHash = fileSha256(new URL(import.meta.url));
  }
  commitJob({ runDir, manifest, jobId: definition.jobId, output });
  newlyCompleted += 1;
  if (stopAfter > 0 && newlyCompleted >= stopAfter && manifest.jobs.some((row) => row.status !== 'COMPLETED')) {
    const afterInterrupted = snapshotProtectedArtifacts(root);
    const protection = compareProtectionSnapshots(protectionBefore, afterInterrupted);
    if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED_DURING_INTERRUPT');
    console.log(JSON.stringify({ runId, status: 'INTERRUPTED_AS_REQUESTED', completedJobs: manifest.jobs.filter((row) => row.status === 'COMPLETED').length, pendingJobs: manifest.jobs.filter((row) => row.status === 'PENDING').length, resumeCommand: `node scripts/run-t0-h0-smoke.mjs --mode ${mode} --run-dir "${runDir}" --resume` }, null, 2));
    process.exit(3);
  }
}

const outputs = manifest.jobs.map((job) => JSON.parse(fs.readFileSync(job.outputPath, 'utf8')));
const protectionAfter = snapshotProtectedArtifacts(root);
const protection = compareProtectionSnapshots(protectionBefore, protectionAfter);
if (!protection.pass) throw new Error(`HARD_FAIL_PROTECTED_ARTIFACT_CHANGED:${protection.changed.join(',')}`);
const summary = summarizeEngineeringResults(outputs, { fixture: mode === 'fixture-smoke' });
summary.frozenProtection = protection;
summary.naturalSmokeDates = mode === 'natural-smoke' ? NATURAL_SMOKE_DATES : [];
summary.fixtureIds = mode === 'fixture-smoke' ? outputs.map((row) => row.fixtureId) : [];
summary.costAccountingEquivalent = outputs.every((row) => !row.costViews || row.costViews.every((view) => view.accountingEquivalent === true));
const completed = finalizeRun({ runDir, manifest, summary });

const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
const usageAfter = process.resourceUsage();
const resource = {
  schemaVersion: 't0-h0-smoke-resource-v1', runId, mode, wallClockMs: elapsedMs,
  cpuUserMicros: usageAfter.userCPUTime - usageBefore.userCPUTime,
  cpuSystemMicros: usageAfter.systemCPUTime - usageBefore.systemCPUTime,
  peakRssBytes: usageAfter.maxRSS * 1024,
  fsReadOperations: usageAfter.fsRead - usageBefore.fsRead,
  estimatedSourceBytesRead: sourceBytesRead,
  artifactBytes: manifest.jobs.reduce((sum, job) => sum + fs.statSync(job.outputPath).size, 0) + fs.statSync(completed.summaryPath).size,
  tickRecordsProcessed: mode === 'fixture-smoke' ? outputs.reduce((sum, row) => sum + (row.outcome?.tickCount || 0), 0) : 0,
  fiveMinuteOhlcFallbackSessions: mode === 'natural-smoke' ? outputs.filter((row) => row.replayResolution === 'FIVE_MINUTE_OHLC').length : 0,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};
atomicJson(path.join(runDir, 'RESOURCE_USAGE.json'), resource);
console.log(JSON.stringify({ runId, status: completed.status, logicalOutputHash: completed.logicalOutputHash, summary, resource }, null, 2));

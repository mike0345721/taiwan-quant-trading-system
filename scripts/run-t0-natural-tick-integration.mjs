import fs from 'node:fs';
import path from 'node:path';
import {
  atomicJson,
  commitJob,
  compareProtectionSnapshots,
  executeNaturalSession,
  fileSha256,
  finalizeRun,
  initializeOrResumeRun,
  loadAndVerifyFrozenInputs,
  snapshotProtectedArtifacts,
  validateH0Replay,
} from '../src/t0-h0-runner.mjs';
import {
  buildResolutionRecord,
  compareTickAndOhlc,
  executeNaturalTickSession,
  readNaturalTicks,
  selectNaturalTickSessions,
} from '../src/t0-natural-tick-integration.mjs';
import { hashJson } from '../src/t0-data-replay-gate.mjs';

const root = process.cwd();
const args = process.argv.slice(2);
const value = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const stage = value('--stage');
const resume = args.includes('--resume');
const stopAfter = Number(value('--stop-after', '0'));
if (!['preflight', 'integration'].includes(stage)) throw new Error('STAGE_REQUIRED:preflight|integration');
if (args.includes('--formal') || args.includes('--performance') || args.includes('--h0-run')) throw new Error('FORMAL_H0_RUN_NOT_AUTHORIZED');

const baseDir = path.join(root, 'data/research/t0-natural-tick-integration-v1');
const runDir = path.resolve(value('--run-dir', path.join(baseDir, stage === 'preflight' ? 'run-2026-08-02-preflight-v1' : 'run-2026-08-02-integration-v1')));
const runId = path.basename(runDir);
const started = process.hrtime.bigint();
const usageBefore = process.resourceUsage();
const frozen = loadAndVerifyFrozenInputs(root);
const protectionBefore = snapshotProtectedArtifacts(root);

function replayFile(row) {
  const selected = path.join(root, 'data/research/t0-data-replay-gate-v1/run-2026-08-02/selected-contract-replays', `${row.tradeDate}-${row.actualReplayContractCode}.json`);
  return fs.existsSync(selected) ? selected : path.join(root, 'data/intraday/archive', `${row.tradeDate}-day.json`);
}

function loadOhlc(row) {
  const file = replayFile(row);
  if (!fs.existsSync(file)) return { file: null, replay: null, audit: { pass: false, reason: 'OHLC_FILE_MISSING' } };
  const replay = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { file, replay, audit: validateH0Replay(replay, row) };
}

function completedOutputs(manifest) {
  return manifest.jobs.filter((job) => job.status === 'COMPLETED').map((job) => JSON.parse(fs.readFileSync(job.outputPath, 'utf8')));
}

function resourceSummary({ manifest, tickCount, sourceBytes, protection, elapsedMs, resumeRun }) {
  const usageAfter = process.resourceUsage();
  return {
    schemaVersion: 't0-natural-tick-resource-v1', runId, stage, wallClockMs: elapsedMs,
    cpuUserMicros: usageAfter.userCPUTime - usageBefore.userCPUTime,
    cpuSystemMicros: usageAfter.systemCPUTime - usageBefore.systemCPUTime,
    peakRssBytes: usageAfter.maxRSS * 1024,
    fsReadOperations: usageAfter.fsRead - usageBefore.fsRead,
    estimatedSourceBytesRead: sourceBytes,
    outputBytes: manifest.jobs.filter((job) => job.status === 'COMPLETED').reduce((sum, job) => sum + fs.statSync(job.outputPath).size, 0),
    tickEventsProcessed: tickCount, resumeRun, frozenProtectionPass: protection.pass,
    performanceSummaryProduced: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
}

function exitCompletedWithoutWrites(manifest) {
  if (manifest.status !== 'COMPLETED') return false;
  const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
  if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
  const summary = JSON.parse(fs.readFileSync(manifest.summaryPath, 'utf8'));
  const resourceFile = path.join(runDir, 'RESOURCE_USAGE.json');
  const resource = fs.existsSync(resourceFile) ? JSON.parse(fs.readFileSync(resourceFile, 'utf8')) : null;
  console.log(JSON.stringify({ runId, status: 'COMPLETED_ALREADY_ZERO_WRITES', completedJobs: manifest.jobs.length, skippedJobs: manifest.jobs.length, logicalOutputHash: manifest.logicalOutputHash, summary, resource, frozenProtection: protection }, null, 2));
  return true;
}

if (stage === 'preflight') {
  const definitions = frozen.strictManifest.sessions.map((row) => ({ jobId: row.sessionId }));
  const manifest = initializeOrResumeRun({ root, runDir, runId, mode: 'natural-tick-resolution-preflight', jobs: definitions, frozenHashes: frozen.hashes, resume });
  if (exitCompletedWithoutWrites(manifest)) process.exit(0);
  let newlyCompleted = 0;
  let tickCount = 0;
  let sourceBytes = 0;
  for (const row of frozen.strictManifest.sessions) {
    const job = manifest.jobs.find((candidate) => candidate.jobId === row.sessionId);
    if (job.status === 'COMPLETED') continue;
    const tickRead = await readNaturalTicks({ root, tradeDate: row.tradeDate, contractCode: row.actualReplayContractCode });
    if (tickRead.sourceState === 'AVAILABLE') sourceBytes += fs.statSync(tickRead.source.zipPath).size;
    tickCount += tickRead.ticks.length;
    const ohlc = loadOhlc(row);
    const output = { ...buildResolutionRecord({ manifestRow: row, tickRead, ohlcAudit: ohlc.audit }), settlementClass: row.settlementClass, rollSession: row.rollSession };
    commitJob({ runDir, manifest, jobId: row.sessionId, output });
    newlyCompleted += 1;
    if (stopAfter > 0 && newlyCompleted >= stopAfter && manifest.jobs.some((candidate) => candidate.status !== 'COMPLETED')) {
      const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
      if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
      console.log(JSON.stringify({ runId, status: 'INTERRUPTED_AS_REQUESTED', completed: manifest.jobs.filter((jobRow) => jobRow.status === 'COMPLETED').length, pending: manifest.jobs.filter((jobRow) => jobRow.status === 'PENDING').length, resumeCommand: `node scripts/run-t0-natural-tick-integration.mjs --stage preflight --run-dir "${runDir}" --resume` }, null, 2));
      process.exit(3);
    }
  }
  const outputs = completedOutputs(manifest);
  const selection = selectNaturalTickSessions(outputs);
  const counts = Object.fromEntries(['TICK_REPLAY_PASS', 'FIVE_MINUTE_OHLC_FALLBACK', 'NO_SAMPLE'].map((state) => [state, outputs.filter((row) => row.selectedReplayResolution === state).length]));
  const summary = {
    schemaVersion: 't0-replay-resolution-preflight-summary-v1', manifestSessionCount: 137, processedSessionCount: outputs.length,
    resolutionCounts: counts, ...selection, preflightGate: outputs.length === 137 && counts.NO_SAMPLE === 0 ? 'PASS' : 'PENDING',
    sequenceLimitation: 'TAIFEX_DAILY_TRADE_FILE_HAS_NO_EXCHANGE_EVENT_ID_OR_PACKET_SEQUENCE; ORDER_IS_RECONSTRUCTED_BY_EXCHANGE_TIMESTAMP_AND_SOURCE_ROW',
    performanceSummaryProduced: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
  if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
  const completed = finalizeRun({ runDir, manifest, summary });
  atomicJson(path.join(runDir, 'REPLAY_RESOLUTION_MANIFEST.json'), outputs);
  atomicJson(path.join(runDir, 'NATURAL_TICK_SELECTION.json'), selection);
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const resource = resourceSummary({ manifest, tickCount, sourceBytes, protection, elapsedMs, resumeRun: resume });
  atomicJson(path.join(runDir, 'RESOURCE_USAGE.json'), resource);
  console.log(JSON.stringify({ runId, status: completed.status, logicalOutputHash: completed.logicalOutputHash, summary, resource }, null, 2));
} else {
  const preflightDir = path.resolve(value('--preflight-dir', path.join(baseDir, 'run-2026-08-02-preflight-v1')));
  const preflightManifestFile = path.join(preflightDir, 'RUN_MANIFEST.json');
  if (!fs.existsSync(preflightManifestFile)) throw new Error('HARD_FAIL_PREFLIGHT_MISSING');
  const preflightManifest = JSON.parse(fs.readFileSync(preflightManifestFile, 'utf8'));
  if (preflightManifest.status !== 'COMPLETED') throw new Error('HARD_FAIL_PREFLIGHT_NOT_COMPLETED');
  const selection = JSON.parse(fs.readFileSync(path.join(preflightDir, 'NATURAL_TICK_SELECTION.json'), 'utf8'));
  if (selection.selectedSessionList.length !== 3) throw new Error('HARD_FAIL_THREE_NATURAL_TICK_SESSIONS_UNAVAILABLE');
  const definitions = selection.selectedSessionList.map((sessionId) => ({ jobId: sessionId }));
  const fingerprints = { ...frozen.hashes, preflightLogicalOutputHash: preflightManifest.logicalOutputHash, selectionHash: fileSha256(path.join(preflightDir, 'NATURAL_TICK_SELECTION.json')) };
  const manifest = initializeOrResumeRun({ root, runDir, runId, mode: 'natural-tick-integration-proof', jobs: definitions, frozenHashes: fingerprints, resume });
  if (exitCompletedWithoutWrites(manifest)) process.exit(0);
  let newlyCompleted = 0;
  let tickCount = 0;
  let sourceBytes = 0;
  for (const sessionId of selection.selectedSessionList) {
    const job = manifest.jobs.find((candidate) => candidate.jobId === sessionId);
    if (job.status === 'COMPLETED') continue;
    const row = frozen.strictManifest.sessions.find((candidate) => candidate.sessionId === sessionId);
    const tickRead = await readNaturalTicks({ root, tradeDate: row.tradeDate, contractCode: row.actualReplayContractCode });
    sourceBytes += fs.statSync(tickRead.source.zipPath).size;
    tickCount += tickRead.ticks.length;
    const officialTick = executeNaturalTickSession({ manifestRow: row, tickRead, costPolicy: frozen.costPolicy });
    const ohlc = loadOhlc(row);
    const diagnosticOhlc = executeNaturalSession({ manifestRow: row, replay: ohlc.replay, costPolicy: frozen.costPolicy, referenceSessions: [] });
    diagnosticOhlc.replayResolution = 'FIVE_MINUTE_OHLC_DIAGNOSTIC_ONLY';
    diagnosticOhlc.officialResearchEligible = false;
    const comparison = compareTickAndOhlc(officialTick, diagnosticOhlc);
    const output = {
      schemaVersion: 't0-natural-tick-integration-proof-v1', sessionId, officialNaturalTick: officialTick,
      diagnosticOhlc, comparison,
      integrationEvidence: {
        trueTickFileRead: true, contractMatch: tickRead.ticks.every((tick) => tick.contractCode === row.actualReplayContractCode),
        tradeDateAndSessionMatch: tickRead.ticks.every((tick) => tick.tradeDate === row.tradeDate && tick.sessionId === row.sessionId),
        exchangeTimestampAscending: tickRead.ticks.every((tick, index) => index === 0 || tick.exchangeTimestamp >= tickRead.ticks[index - 1].exchangeTimestamp),
        timezone: 'Asia/Taipei source wall-clock normalized to UTC without double offset',
        sourceSelection: 'TICK_PRIORITY', statistics: tickRead.statistics,
        costAccountingEquivalent: officialTick.costViews?.every((view) => view.accountingEquivalent === true) ?? true,
        costViewIds: officialTick.costViews?.map((view) => view.viewId) || [],
      },
      inputDataHash: tickRead.source.zipSha256, specHash: frozen.hashes.t0SpecHash, costPolicyHash: frozen.hashes.costPolicyHash,
      manifestHash: frozen.hashes.strictManifestHash, performanceSummaryProduced: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
    };
    commitJob({ runDir, manifest, jobId: sessionId, output });
    newlyCompleted += 1;
    if (stopAfter > 0 && newlyCompleted >= stopAfter && manifest.jobs.some((candidate) => candidate.status !== 'COMPLETED')) {
      const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
      if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
      console.log(JSON.stringify({ runId, status: 'INTERRUPTED_AS_REQUESTED', completed: manifest.jobs.filter((jobRow) => jobRow.status === 'COMPLETED').length, pending: manifest.jobs.filter((jobRow) => jobRow.status === 'PENDING').length, resumeCommand: `node scripts/run-t0-natural-tick-integration.mjs --stage integration --run-dir "${runDir}" --preflight-dir "${preflightDir}" --resume` }, null, 2));
      process.exit(3);
    }
  }
  const outputs = completedOutputs(manifest);
  const allTick = outputs.every((row) => row.officialNaturalTick.replayResolution === 'TICK_REPLAY_PASS');
  const evidencePass = outputs.every((row) => Object.entries(row.integrationEvidence).filter(([key]) => ['trueTickFileRead', 'contractMatch', 'tradeDateAndSessionMatch', 'exchangeTimestampAscending', 'costAccountingEquivalent'].includes(key)).every(([, state]) => state === true));
  const costViewsPass = outputs.every((row) => row.officialNaturalTick.tradeState !== 'TRADE' || hashJson(row.integrationEvidence.costViewIds) === hashJson(['GROSS', 'OPTIMISTIC_1_TICK_PER_SIDE', 'BASE_2_TICKS_PER_SIDE', 'CONSERVATIVE_3_TICKS_PER_SIDE', 'SEVERE_STRESS_5_TICKS_PER_SIDE']));
  const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
  if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
  const summary = {
    schemaVersion: 't0-natural-tick-integration-summary-v1', selectedSessionList: selection.selectedSessionList,
    sessionCount: outputs.length, allUsedTickReplay: allTick, integrationEvidencePass: evidencePass,
    tickAndOhlcIsolated: outputs.every((row) => row.comparison.mixedIntoResearchStatistics === false), costViewsPass,
    pAndLAccountingEquivalent: outputs.every((row) => row.integrationEvidence.costAccountingEquivalent), frozenProtection: protection,
    naturalTickIntegrationGate: outputs.length === 3 && allTick && evidencePass && costViewsPass && protection.pass ? 'PASS' : 'PENDING',
    performanceSummaryProduced: false, formalWeight: 0, researchOnly: true, executionAuthorized: false,
  };
  const completed = finalizeRun({ runDir, manifest, summary });
  const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
  const resource = resourceSummary({ manifest, tickCount, sourceBytes, protection, elapsedMs, resumeRun: resume });
  atomicJson(path.join(runDir, 'RESOURCE_USAGE.json'), resource);
  console.log(JSON.stringify({ runId, status: completed.status, logicalOutputHash: completed.logicalOutputHash, summary, resource }, null, 2));
}

import fs from 'node:fs';
import path from 'node:path';
import {
  atomicJson,
  commitJob,
  compareProtectionSnapshots,
  fileSha256,
  finalizeRun,
  firstBreakout,
  initializeOrResumeRun,
  loadAndVerifyFrozenInputs,
  openingRange,
  snapshotProtectedArtifacts,
} from '../src/t0-h0-runner.mjs';
import {
  buildResolutionRecord,
  executeNaturalTickSession,
  readNaturalTicks,
} from '../src/t0-natural-tick-integration.mjs';
import {
  buildFormalSummary,
  buildNaturalEventAudit,
} from '../src/t0-h0-formal-summary.mjs';
import { hashJson } from '../src/t0-data-replay-gate.mjs';

const EXPECTED_PREFLIGHT_HASH = 'b565ec7d5d4f69e2199abb8acc549a6d3160ac8a34a57a1298e1f5a3c16c3a77';
const root = process.cwd();
const args = process.argv.slice(2);
const value = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const resume = args.includes('--resume');
const stopAfter = Number(value('--stop-after', '0'));
if (args.includes('--extended') || args.includes('--ohlc') || args.includes('--continuous')) throw new Error('HARD_FAIL_UNAUTHORIZED_FORMAL_INPUT');
const runDir = path.resolve(value('--run-dir', path.join(root, 'data/research/t0-h0-formal-v1/run-2026-08-02-v1')));
const runId = path.basename(runDir);
const started = process.hrtime.bigint();
const usageBefore = process.resourceUsage();

const frozen = loadAndVerifyFrozenInputs(root);
const protectionBefore = snapshotProtectedArtifacts(root);
const preflightDir = path.join(root, 'data/research/t0-natural-tick-integration-v1/run-2026-08-02-preflight-v1');
const preflightManifestFile = path.join(preflightDir, 'RUN_MANIFEST.json');
const preflightManifest = JSON.parse(fs.readFileSync(preflightManifestFile, 'utf8'));
if (preflightManifest.status !== 'COMPLETED' || preflightManifest.logicalOutputHash !== EXPECTED_PREFLIGHT_HASH) throw new Error('HARD_FAIL_NATURAL_TICK_PREFLIGHT_HASH');
for (const job of preflightManifest.jobs) {
  if (job.status !== 'COMPLETED' || !fs.existsSync(job.outputPath) || fileSha256(job.outputPath) !== job.outputHash) throw new Error(`HARD_FAIL_PREFLIGHT_JOB_HASH:${job.jobId}`);
}
const preflightRows = JSON.parse(fs.readFileSync(path.join(preflightDir, 'REPLAY_RESOLUTION_MANIFEST.json'), 'utf8'));
if (preflightRows.length !== 137 || preflightRows.some((row) => row.selectedReplayResolution !== 'TICK_REPLAY_PASS')) throw new Error('HARD_FAIL_PREFLIGHT_RESOLUTION_SET');
const preflightBySession = new Map(preflightRows.map((row) => [row.sessionId, row]));

const scriptFile = new URL(import.meta.url);
const fingerprints = {
  ...frozen.hashes,
  naturalTickPreflightLogicalHash: EXPECTED_PREFLIGHT_HASH,
  naturalTickIntegrationModuleHash: fileSha256(path.join(root, 'src/t0-natural-tick-integration.mjs')),
  formalSummaryModuleHash: fileSha256(path.join(root, 'src/t0-h0-formal-summary.mjs')),
  formalRunnerScriptHash: fileSha256(scriptFile),
};
const definitions = frozen.strictManifest.sessions.map((row) => ({ jobId: row.sessionId }));
const manifest = initializeOrResumeRun({ root, runDir, runId, mode: 't0-h0-formal-137-session-tick-only', jobs: definitions, frozenHashes: fingerprints, resume });

function exitCompletedWithoutWrites() {
  if (manifest.status !== 'COMPLETED') return false;
  const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
  if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
  console.log(JSON.stringify({ runId, status: 'COMPLETED_ALREADY_ZERO_WRITES', completedJobs: manifest.jobs.length, skippedJobs: manifest.jobs.length, logicalOutputHash: manifest.logicalOutputHash, frozenProtection: protection }, null, 2));
  return true;
}
if (exitCompletedWithoutWrites()) process.exit(0);

function enrichEventAudit(result, tickRead) {
  const or = openingRange(tickRead.bars);
  const breakout = or.qualityState === 'PASS' ? firstBreakout(tickRead.bars, or.orHigh, or.orLow) : null;
  const auditDirection = result.breakoutDirection || breakout?.direction || null;
  let entryCandidateTick = null;
  if (breakout) {
    const entryStart = new Date(Date.parse(breakout.confirmationBar.timestamp) + 300_000).toISOString();
    const entryEnd = new Date(Date.parse(entryStart) + 300_000).toISOString();
    entryCandidateTick = tickRead.ticks.find((tick) => tick.exchangeTimestamp >= entryStart && tick.exchangeTimestamp < entryEnd) || null;
  }
  const firstTriggerTick = result.exitReason === 'STOP_EXIT'
    ? tickRead.ticks.find((tick) => tick.sourceRowNumber === result.exitSourceRowNumber)
      || tickRead.ticks.find((tick) => tick.exchangeTimestamp === result.exitAt && tick.price === result.exitReferencePrice) || null
    : result.noTradeReason === 'ENTRY_GAP_THROUGH_STOP' ? entryCandidateTick : null;
  let ambiguousSequence = false;
  if (result.exitReason === 'STOP_EXIT' && result.exitAt && auditDirection && Number.isFinite(result.entryReferencePrice) && Number.isFinite(result.initialStopPrice)) {
    const oneR = Math.abs(result.entryReferencePrice - result.initialStopPrice);
    const oneRPrice = auditDirection === 'LONG' ? result.entryReferencePrice + oneR : result.entryReferencePrice - oneR;
    const sameTime = tickRead.ticks.filter((tick) => tick.exchangeTimestamp === result.exitAt);
    const favorable = sameTime.some((tick) => auditDirection === 'LONG' ? tick.price >= oneRPrice : tick.price <= oneRPrice);
    const stop = sameTime.some((tick) => auditDirection === 'LONG' ? tick.price <= result.initialStopPrice : tick.price >= result.initialStopPrice);
    ambiguousSequence = favorable && stop;
  }
  const gapThroughStop = result.exitReason === 'STOP_EXIT' && Number.isFinite(result.exitReferencePrice) && Number.isFinite(result.initialStopPrice)
    ? auditDirection === 'LONG' ? result.exitReferencePrice < result.initialStopPrice : result.exitReferencePrice > result.initialStopPrice
    : false;
  return {
    auditDirection,
    entryCandidateTick: entryCandidateTick ? { exchangeTimestamp: entryCandidateTick.exchangeTimestamp, price: entryCandidateTick.price, sourceRowNumber: entryCandidateTick.sourceRowNumber } : null,
    firstTriggerTick: firstTriggerTick ? { exchangeTimestamp: firstTriggerTick.exchangeTimestamp, price: firstTriggerTick.price, sourceRowNumber: firstTriggerTick.sourceRowNumber } : null,
    gapThroughStop, ambiguousSequence,
    eventOrderingBasis: ambiguousSequence ? 'AMBIGUOUS_SEQUENCE_CONSERVATIVE' : result.eventSequencePolicy || (result.noTradeReason === 'ENTRY_GAP_THROUGH_STOP' ? 'FIRST_LEGAL_ENTRY_TICK' : null),
  };
}

let newlyCompleted = 0;
let tickEventsProcessed = 0;
let sourceBytesRead = 0;
for (const row of frozen.strictManifest.sessions) {
  const job = manifest.jobs.find((candidate) => candidate.jobId === row.sessionId);
  if (job.status === 'COMPLETED') continue;
  const preflight = preflightBySession.get(row.sessionId);
  if (!preflight) throw new Error(`HARD_FAIL_PREFLIGHT_RECORD_MISSING:${row.sessionId}`);
  if (preflight.actualReplayContractCode !== row.actualReplayContractCode || preflight.selectedResearchContractCode !== row.selectedResearchContractCode) throw new Error(`HARD_FAIL_PREFLIGHT_CONTRACT_MISMATCH:${row.sessionId}`);
  const tickRead = await readNaturalTicks({ root, tradeDate: row.tradeDate, contractCode: row.actualReplayContractCode });
  if (tickRead.sourceState !== 'AVAILABLE' || tickRead.source.zipSha256 !== preflight.rawTickSourceHash) throw new Error(`HARD_FAIL_INPUT_HASH_OR_SOURCE:${row.sessionId}`);
  const resolution = buildResolutionRecord({ manifestRow: row, tickRead, ohlcAudit: { pass: false } });
  if (resolution.selectedReplayResolution !== 'TICK_REPLAY_PASS' || resolution.contractMismatchCount !== 0 || resolution.exchangeTimestampState !== 'PASS_ASIA_TAIPEI_TO_UTC') throw new Error(`HARD_FAIL_FORMAL_TICK_GATE:${row.sessionId}`);
  const result = executeNaturalTickSession({ manifestRow: row, tickRead, costPolicy: frozen.costPolicy });
  if (result.replayResolution !== 'TICK_REPLAY_PASS' || result.tradeState === 'NO_SAMPLE') throw new Error(`HARD_FAIL_FORMAL_RESULT_STATE:${row.sessionId}`);
  if (result.costViews && !result.costViews.every((view) => view.accountingEquivalent === true)) throw new Error(`HARD_FAIL_COST_ACCOUNTING:${row.sessionId}`);
  result.eventAudit = enrichEventAudit(result, tickRead);
  result.inputEvidence = {
    rawTickSourceHash: tickRead.source.zipSha256,
    preflightResolutionRecordHash: preflightManifest.jobs.find((candidate) => candidate.jobId === row.sessionId).outputHash,
    naturalTickPreflightLogicalHash: EXPECTED_PREFLIGHT_HASH,
    t0SpecHash: frozen.hashes.t0SpecHash, costPolicyHash: frozen.hashes.costPolicyHash,
    strictManifestHash: frozen.hashes.strictManifestHash, ownerBriefHash: frozen.hashes.ownerBriefHash,
  };
  result.formalH0Run = true;
  result.performancePromotionAuthorized = false;
  commitJob({ runDir, manifest, jobId: row.sessionId, output: result });
  tickEventsProcessed += tickRead.ticks.length;
  sourceBytesRead += fs.statSync(tickRead.source.zipPath).size;
  newlyCompleted += 1;
  if (stopAfter > 0 && newlyCompleted >= stopAfter && manifest.jobs.some((candidate) => candidate.status !== 'COMPLETED')) {
    const protection = compareProtectionSnapshots(protectionBefore, snapshotProtectedArtifacts(root));
    if (!protection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');
    console.log(JSON.stringify({ runId, status: 'INTERRUPTED_AS_REQUESTED', completed: manifest.jobs.filter((candidate) => candidate.status === 'COMPLETED').length, pending: manifest.jobs.filter((candidate) => candidate.status === 'PENDING').length, resumeCommand: `node scripts/run-t0-h0-formal.mjs --run-dir "${runDir}" --resume` }, null, 2));
    process.exit(3);
  }
}

const results = manifest.jobs.map((job) => ({ ...JSON.parse(fs.readFileSync(job.outputPath, 'utf8')), outputHash: job.outputHash }));
if (results.length !== 137 || results.some((row) => row.tradeState === 'NO_SAMPLE' || row.replayResolution !== 'TICK_REPLAY_PASS')) throw new Error('HARD_FAIL_FORMAL_RESULT_COMPLETENESS');
const formalSummary = buildFormalSummary(results);
const eventAudit = buildNaturalEventAudit(results);
const protectionAfter = snapshotProtectedArtifacts(root);
const frozenProtection = compareProtectionSnapshots(protectionBefore, protectionAfter);
if (!frozenProtection.pass) throw new Error('HARD_FAIL_PROTECTED_ARTIFACT_CHANGED');

const dayManifest = {
  schemaVersion: 't0-h0-formal-day-results-manifest-v1', runId, manifestSessionCount: 137,
  results: manifest.jobs.map((job) => ({ sessionId: job.jobId, outputPath: job.outputPath, outputHash: job.outputHash })),
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};
dayManifest.logicalHash = hashJson(dayManifest.results);
atomicJson(path.join(runDir, 'DAY_RESULTS_MANIFEST.json'), dayManifest);
atomicJson(path.join(runDir, 'FIVE_COST_VIEWS.json'), formalSummary.costViews);
atomicJson(path.join(runDir, 'NATURAL_EVENT_AUDIT.json'), eventAudit);

const engineeringChecks = {
  frozenHashGate: true, naturalTickPreflightHashGate: true,
  manifestSessionCount: formalSummary.counts.manifestSessionCount === 137,
  processedSessionCount: formalSummary.counts.processedSessionCount === 137,
  noSampleCountZero: formalSummary.counts.noSampleCount === 0,
  allNaturalTickReplay: formalSummary.counts.naturalTickReplayCount === 137 && formalSummary.counts.ohlcFallbackCount === 0,
  costAccountingEquivalent: results.every((row) => !row.costViews || row.costViews.every((view) => view.accountingEquivalent === true)),
  requiredCostViews: Object.keys(formalSummary.costViews).length === 5,
  requiredStrata: Object.values(formalSummary.costViews).every((view) => Object.keys(view).length === 9),
  frozenArtifactProtection: frozenProtection.pass,
  formalWeightZero: results.every((row) => row.formalWeight === 0),
  researchOnly: results.every((row) => row.researchOnly === true),
  executionUnauthorized: results.every((row) => row.executionAuthorized === false),
};
const executive = {
  schemaVersion: 't0-h0-formal-executive-summary-v1', runId,
  engineeringGate: Object.values(engineeringChecks).every(Boolean) ? 'PASS' : 'FAIL', engineeringChecks,
  counts: formalSummary.counts, primaryCostView: 'BASE_2_TICKS_PER_SIDE',
  primaryResult: formalSummary.costViews.BASE_2_TICKS_PER_SIDE.ALL,
  edgeEvaluation: 'DESCRIPTIVE_ONLY_NOT_A_PROMOTION_DECISION',
  baselineFreezeAuthorized: false, phaseBAuthorized: false, frozenProtection,
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};
atomicJson(path.join(runDir, 'EXECUTIVE_SUMMARY.json'), executive);

const completed = finalizeRun({ runDir, manifest, summary: formalSummary });
const elapsedMs = Number(process.hrtime.bigint() - started) / 1e6;
const usageAfter = process.resourceUsage();
const resource = {
  schemaVersion: 't0-h0-formal-resource-v1', runId, wallClockMs: elapsedMs,
  cpuUserMicros: usageAfter.userCPUTime - usageBefore.userCPUTime,
  cpuSystemMicros: usageAfter.systemCPUTime - usageBefore.systemCPUTime,
  peakRssBytes: usageAfter.maxRSS * 1024, fsReadOperations: usageAfter.fsRead - usageBefore.fsRead,
  estimatedCompressedSourceBytesRead: sourceBytesRead, tickEventsProcessed,
  dayResultBytes: manifest.jobs.reduce((total, job) => total + fs.statSync(job.outputPath).size, 0),
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
};
atomicJson(path.join(runDir, 'RESOURCE_USAGE.json'), resource);
console.log(JSON.stringify({ runId, status: completed.status, logicalOutputHash: completed.logicalOutputHash, engineeringGate: executive.engineeringGate, counts: formalSummary.counts, resource, frozenProtection }, null, 2));

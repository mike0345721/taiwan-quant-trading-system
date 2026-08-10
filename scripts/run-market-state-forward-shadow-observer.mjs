import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { digest, stableJson } from '../src/market-state-forward-shadow.mjs';
import { runDailyOutcomePhase, runDailyStatePhase, verifyRuntimeEvidence } from '../src/market-state-forward-shadow-runtime.mjs';
import { collectForwardMarketStateSnapshot } from '../src/market-state-forward-shadow-collector.mjs';

const value = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const mode = value('--mode', 'NOT_ACTIVE');
const phase = value('--phase', 'STATE');
const inputPath = value('--input');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const launchManifestPath = value('--launch-manifest');
const ownerApprovalPath = value('--owner-approval');
const observerConfigPath = value('--observer-config', path.join(root, 'config/market-state-forward-shadow-observer.json'));
if (!['NOT_ACTIVE', 'FORWARD_SHADOW'].includes(mode) && !inputPath) throw new Error('FORWARD_SHADOW_INPUT_REQUIRED');
if (mode === 'NOT_ACTIVE') {
  process.stdout.write(stableJson({ status: 'NOT_ACTIVE', collectorActive: false, officialEvidenceWritten: false, executionAuthorized: false }));
  process.exit(0);
}
const hashFile = (filePath) => digest(fs.readFileSync(filePath));
const taipeiTradeDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(date);
const isWeekday = (tradeDate) => {
  const day = new Date(`${tradeDate}T12:00:00+08:00`).getUTCDay();
  return day >= 1 && day <= 5;
};

let input;
if (mode === 'FORWARD_SHADOW') {
  if (!launchManifestPath || !ownerApprovalPath) throw new Error('FORWARD_SHADOW_GOVERNANCE_ARTIFACTS_REQUIRED');
  const launchManifest = JSON.parse(fs.readFileSync(launchManifestPath, 'utf8'));
  const ownerApprovalArtifact = JSON.parse(fs.readFileSync(ownerApprovalPath, 'utf8'));
  const config = JSON.parse(fs.readFileSync(observerConfigPath, 'utf8'));
  const tradeDate = taipeiTradeDate();
  input = {
    runtimeRoot: path.dirname(launchManifest.runtimeRoot),
    runId: launchManifest.runId,
    tradeDate,
    sessionId: `${tradeDate}-DAY`,
    scheduledAt: `${tradeDate}T08:25:00+08:00`,
    now: new Date().toISOString(),
    outcomeObservationStartAt: `${tradeDate}T08:45:00+08:00`,
    officialTradingDay: isWeekday(tradeDate),
    evaluator: launchManifest.evaluator,
    qualityStatus: 'CLEAN',
    collectorSource: {
      databasePath: path.resolve(root, config.databasePath),
      featureSpecPath: path.resolve(root, config.featureSpecPath),
    },
    launchManifest,
    ownerApprovalArtifact,
    currentMainCommit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
    actualArtifactHashes: {
      evaluator: hashFile(path.join(root, 'src/market-state-v1.mjs')),
      outcomeContract: hashFile(path.join(root, 'src/market-state-outcome-contract.mjs')),
      linkageContract: hashFile(path.join(root, 'src/market-state-outcome-linkage.mjs')),
      frozenForwardGate: hashFile(path.join(root, 'docs/research/MARKET_STATE_V1_FORWARD_SHADOW_GATE.md')),
    },
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
} else {
  input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
}
let collectionDurationMs = 0;
if (phase === 'STATE' && input.collectorSource && !input.marketStateInput && !input.marketStateEvaluation) {
  const collectionStarted = performance.now();
  const snapshot = collectForwardMarketStateSnapshot({ ...input.collectorSource, tradeDate: input.tradeDate });
  collectionDurationMs = performance.now() - collectionStarted;
  if (snapshot.state === 'AVAILABLE') {
    input = {
      ...input,
      availableAt: snapshot.availableAt,
      marketStateEvaluation: snapshot.evaluation,
      evidenceLineage: snapshot.evidenceLineage,
      sourceHashes: snapshot.sourceHashes,
      sourceTimestamps: snapshot.sourceTimestamps,
    };
  }
}
const started = performance.now();
const result = phase === 'STATE'
  ? runDailyStatePhase({ ...input, mode })
  : phase === 'OUTCOME'
    ? runDailyOutcomePhase({ ...input, mode })
    : (() => { throw new Error('FORWARD_SHADOW_PHASE_INVALID'); })();
const durationMs = performance.now() - started;
const audit = verifyRuntimeEvidence(input.runtimeRoot, input.runId, { official: mode === 'FORWARD_SHADOW' });
process.stdout.write(stableJson({ ...result, audit, collectionDurationMs, durationMs, collectorActive: false, officialEvidenceWritten: false, executionAuthorized: false }));

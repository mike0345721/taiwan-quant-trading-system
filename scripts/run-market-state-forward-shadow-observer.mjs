import fs from 'node:fs';
import process from 'node:process';
import { performance } from 'node:perf_hooks';
import { stableJson } from '../src/market-state-forward-shadow.mjs';
import { runDailyOutcomePhase, runDailyStatePhase, verifyRuntimeEvidence } from '../src/market-state-forward-shadow-runtime.mjs';
import { collectForwardMarketStateSnapshot } from '../src/market-state-forward-shadow-collector.mjs';

const value = (name, fallback = null) => {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
};
const mode = value('--mode', 'NOT_ACTIVE');
const phase = value('--phase', 'STATE');
const inputPath = value('--input');
if (mode !== 'NOT_ACTIVE' && !inputPath) throw new Error('FORWARD_SHADOW_INPUT_REQUIRED');
if (mode === 'NOT_ACTIVE') {
  process.stdout.write(stableJson({ status: 'NOT_ACTIVE', collectorActive: false, officialEvidenceWritten: false, executionAuthorized: false }));
  process.exit(0);
}
let input = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
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
const audit = verifyRuntimeEvidence(input.runtimeRoot, input.runId);
process.stdout.write(stableJson({ ...result, audit, collectionDurationMs, durationMs, collectorActive: false, officialEvidenceWritten: false, executionAuthorized: false }));

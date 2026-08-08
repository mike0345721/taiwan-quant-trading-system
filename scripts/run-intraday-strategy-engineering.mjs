import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildIntradayResearchDataset } from '../src/intraday-research-features.mjs';
import {
  evaluateIntradayStrategies,
  writeIntradayStrategyEngineeringReport,
} from '../src/intraday-strategy-engine.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.dirname(scriptDir);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const archiveDir = path.resolve(argument('--archive-dir', path.join(appRoot, 'data', 'intraday', 'archive')));
const outputDir = path.resolve(argument('--output-dir', path.join(appRoot, 'data', 'intraday', 'research', 'v3.8.1-strategy-engineering')));
const relativeOutput = path.relative(archiveDir, outputDir);
if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))) {
  throw new Error('OUTPUT_DIR_MUST_NOT_BE_INSIDE_READ_ONLY_ARCHIVE');
}

const sourceDataset = buildIntradayResearchDataset(archiveDir);
const report = evaluateIntradayStrategies(sourceDataset.barFeatures, sourceDataset.quality);
const files = writeIntradayStrategyEngineeringReport(outputDir, report);

console.log(JSON.stringify({
  ok: report.summary.counts.includedDays > 0,
  classification: report.summary.classification,
  dateRange: report.summary.dateRange,
  counts: report.summary.counts,
  sampleGate: report.summary.sampleGate,
  files,
  researchOnly: true,
  executionAuthorized: false,
  performanceClaimAuthorized: false,
}, null, 2));

if (report.summary.counts.includedDays === 0) process.exitCode = 1;

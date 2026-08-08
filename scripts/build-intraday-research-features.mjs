import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildIntradayResearchDataset, writeIntradayResearchDataset } from '../src/intraday-research-features.mjs';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.dirname(scriptDir);

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
}

const archiveDir = path.resolve(argument('--archive-dir', path.join(appRoot, 'data', 'intraday', 'archive')));
const outputDir = path.resolve(argument('--output-dir', path.join(appRoot, 'data', 'intraday', 'research', 'v3.8.1-price-volume')));
const relativeOutput = path.relative(archiveDir, outputDir);
if (relativeOutput === '' || (!relativeOutput.startsWith('..') && !path.isAbsolute(relativeOutput))) {
  throw new Error('OUTPUT_DIR_MUST_NOT_BE_INSIDE_READ_ONLY_ARCHIVE');
}

const dataset = buildIntradayResearchDataset(archiveDir);
const files = writeIntradayResearchDataset(outputDir, dataset);
console.log(JSON.stringify({
  ok: dataset.quality.counts.includedDays > 0,
  datasetVersion: dataset.quality.datasetVersion,
  dateRange: dataset.quality.dateRange,
  counts: dataset.quality.counts,
  gates: dataset.quality.gates,
  files,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));
if (dataset.quality.counts.includedDays === 0) process.exitCode = 1;

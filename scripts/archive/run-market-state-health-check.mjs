import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { analyzeMarketStateHealth } from '../src/market-state-health.mjs';
import { stableDigest } from '../src/phase-a-canonical.mjs';

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function atomicWriteJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

const root = path.resolve('.');
const recordsPath = path.resolve(argument('--records', path.join(root, 'data', 'research', 'market-state-v1-historical-dry-run', 'v0', 'records.json')));
const outputDir = path.resolve(argument('--output-dir', path.join(root, 'data', 'research', 'market-state-v1-health-check', 'v0')));

if (!fs.existsSync(recordsPath)) throw new Error(`MARKET_STATE_RECORDS_MISSING:${recordsPath}`);
const records = JSON.parse(fs.readFileSync(recordsPath, 'utf8'));
if (!Array.isArray(records)) throw new Error('MARKET_STATE_RECORDS_NOT_ARRAY');

const report = analyzeMarketStateHealth(records);
const manifest = {
  schemaVersion: 'market-state-v1-health-check-manifest-v0',
  sourceRecords: path.relative(root, recordsPath).replaceAll('\\', '/'),
  sourceRecordDigest: stableDigest(records),
  records: records.length,
  healthDigest: report.healthDigest,
  outcomeFieldsConsumed: [],
  thresholdOptimizationPerformed: false,
  descriptiveOnly: true,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};

atomicWriteJson(path.join(outputDir, 'health-report.json'), report);
atomicWriteJson(path.join(outputDir, 'manifest.json'), manifest);

console.log(JSON.stringify({
  outputDir,
  records: records.length,
  healthDigest: report.healthDigest,
  trendUnobservedStates: report.axes.trend.unobservedStates,
  directionUnobservedStates: report.axes.direction.unobservedStates,
  riskUnobservedStates: report.axes.risk.unobservedStates,
  outcomeFieldsConsumed: [],
  executionAuthorized: false,
}, null, 2));

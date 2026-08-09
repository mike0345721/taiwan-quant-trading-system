import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { DatabaseSync } from 'node:sqlite';
import { buildMarketStateCanonicalRows } from '../src/market-state-historical-adapter.mjs';
import { buildHistoricalMarketStateRecords, summarizeHistoricalMarketState } from '../src/market-state-historical.mjs';
import { stableDigest } from '../src/phase-a-canonical.mjs';

const root = path.resolve('.');

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

const dbPath = path.resolve(argument('--db', path.join(root, 'v2', 'data', 'research-v2.sqlite')));
const featureSpecPath = path.resolve(argument('--feature-spec', path.join(root, 'research', 'phase-a-v1', 'feature-spec.json')));
const outputDir = path.resolve(argument('--output-dir', path.join(root, 'data', 'research', 'market-state-v1-historical-dry-run', 'v0')));

if (!fs.existsSync(dbPath)) throw new Error(`MARKET_STATE_DB_MISSING:${dbPath}`);
if (!fs.existsSync(featureSpecPath)) throw new Error(`MARKET_STATE_FEATURE_SPEC_MISSING:${featureSpecPath}`);

const featureSpec = JSON.parse(fs.readFileSync(featureSpecPath, 'utf8'));
const db = new DatabaseSync(dbPath, { readOnly: true });
let canonicalRows;
try {
  canonicalRows = buildMarketStateCanonicalRows(db, featureSpec);
} finally {
  db.close();
}

const records = buildHistoricalMarketStateRecords(canonicalRows);
const summary = summarizeHistoricalMarketState(records);
const recordDigest = stableDigest(records);
const manifest = {
  schemaVersion: 'market-state-v1-historical-dry-run-manifest-v0',
  sourceDatabase: path.relative(root, dbPath).replaceAll('\\', '/'),
  featureSpec: path.relative(root, featureSpecPath).replaceAll('\\', '/'),
  featureVersion: featureSpec.featureVersion || null,
  canonicalRows: canonicalRows.length,
  records: records.length,
  recordDigest,
  futureDataViolations: summary.futureDataViolations,
  deterministicReplayContract: 'same source DB + same code/spec => same recordDigest',
  descriptiveOnly: true,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};

atomicWriteJson(path.join(outputDir, 'records.json'), records);
atomicWriteJson(path.join(outputDir, 'summary.json'), summary);
atomicWriteJson(path.join(outputDir, 'manifest.json'), manifest);

console.log(JSON.stringify({
  outputDir,
  records: records.length,
  firstTradeDate: summary.firstTradeDate,
  lastTradeDate: summary.lastTradeDate,
  futureDataViolations: summary.futureDataViolations,
  recordDigest,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));

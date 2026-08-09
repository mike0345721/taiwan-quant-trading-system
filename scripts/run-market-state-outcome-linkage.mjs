import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { buildMarketStateCanonicalRows } from '../src/market-state-historical-adapter.mjs';
import { buildHistoricalMarketStateRecords } from '../src/market-state-historical.mjs';
import { readNaturalTicks } from '../src/t0-natural-tick-integration.mjs';
import { buildCru18Bundle, buildOutcomeRows } from '../src/market-state-outcome-linkage.mjs';

const args = process.argv.slice(2);
const value = (name, fallback = null) => { const index = args.indexOf(name); return index >= 0 ? args[index + 1] : fallback; };
const root = process.cwd();
const dbPath = path.resolve(value('--db', path.join(root, 'v2/data/research-v2.sqlite')));
const dataRoot = path.resolve(value('--data-root', root));
const featureSpecPath = path.resolve(value('--feature-spec', path.join(dataRoot, 'research/phase-a-v1/feature-spec.json')));
const strictManifestPath = path.resolve(value('--strict-manifest', path.join(dataRoot, 'data/research/t0-data-replay-gate-v1/run-2026-08-02/T0_STRICT_PP1_ALIGNED_H0_MANIFEST.json')));
const outputDir = path.resolve(value('--output-dir', path.join(root, 'data/research/market-state-outcome-linkage-v1')));
for (const file of [dbPath, featureSpecPath, strictManifestPath]) if (!fs.existsSync(file)) throw new Error(`CRU18_INPUT_MISSING:${file}`);
const featureSpec = JSON.parse(fs.readFileSync(featureSpecPath, 'utf8'));
const sessions = JSON.parse(fs.readFileSync(strictManifestPath, 'utf8')).sessions;
const db = new DatabaseSync(dbPath, { readOnly: true });
let canonicalRows;
try { canonicalRows = buildMarketStateCanonicalRows(db, featureSpec); } finally { db.close(); }
const marketStateRecords = buildHistoricalMarketStateRecords(canonicalRows);
const outcomeRows = await buildOutcomeRows({ sessions, readTicks: (session) => readNaturalTicks({ root: dataRoot, tradeDate: session.tradeDate, contractCode: session.actualReplayContractCode }) });
const bundle = buildCru18Bundle({ marketStateRecords, outcomeRows });
const write = (name, payload) => { fs.mkdirSync(outputDir, { recursive: true }); const file = path.join(outputDir, name); const temporary = `${file}.${process.pid}.tmp`; fs.writeFileSync(temporary, `${JSON.stringify(payload, null, 2)}\n`); fs.renameSync(temporary, file); };
write('outcomes.json', outcomeRows);
write('alignment-manifest.json', bundle.alignment);
write('single-axis-outcomes.json', bundle.linkage);
write('research-report.json', {
  schemaVersion: 'cru18-research-report-v1',
  alignmentSummary: bundle.alignment.families,
  sampleSizeTable: bundle.linkage.sampleTables,
  singleAxisOutcomeTable: bundle.linkage.outcomeTables,
  primaryContrastTable: bundle.linkage.primaryContrasts,
  effectSizeAndConfidenceIntervals: 'IN_PRIMARY_CONTRAST_TABLE_ONLY_WHEN_BOTH_GROUPS_N_GTE_30',
  unavailableAndDataQualityReport: Object.fromEntries(Object.entries(bundle.alignment.families).map(([family, summary]) => [family, { unavailableRows: summary.unavailableRows, unavailableReasonCounts: summary.unavailableReasonCounts }])),
  researchConclusion: bundle.linkage.axisConclusions,
  conclusionVocabulary: ['NO_INFORMATION_SIGNAL', 'WEAK_DESCRIPTIVE_DIFFERENCE', 'DESCRIPTIVE_DIFFERENCE_PRESENT', 'INSUFFICIENT_SAMPLE'],
  formalWeight: 0, researchOnly: true, executionAuthorized: false,
});
write('manifest.json', { schemaVersion: 'cru18-run-manifest-v1', marketStateRecords: marketStateRecords.length, outcomeRows: outcomeRows.length, outcomeDigest: bundle.outcomeDigest, linkageDigest: bundle.linkageDigest, futureDataViolations: bundle.futureDataViolations, formalWeight: 0, researchOnly: true, executionAuthorized: false });
console.log(JSON.stringify({ outputDir, marketStateRecords: marketStateRecords.length, outcomeDigest: bundle.outcomeDigest, linkageDigest: bundle.linkageDigest, families: bundle.alignment.families, sampleTables: bundle.linkage.sampleTables, axisConclusions: bundle.linkage.axisConclusions, futureDataViolations: bundle.futureDataViolations, executionAuthorized: false }, null, 2));

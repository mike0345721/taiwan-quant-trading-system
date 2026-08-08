import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  auditLiveEventLedger,
  replayLiveEventLedger,
} from '../src/live-event-ledger.mjs';
import { buildFuturesOrderFlow } from '../src/futures-order-flow.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledgerDir = path.join(root, 'data', 'live-events');
const readiness = JSON.parse(fs.readFileSync(
  path.join(root, 'data', 'readiness', 'shioaji-futures-access.json'),
  'utf8',
));
const dateArgument = process.argv.find((value) => value.startsWith('--date='))?.slice(7);
const files = fs.readdirSync(ledgerDir)
  .filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name))
  .sort();
const ledgerFile = dateArgument ? `${dateArgument}.ndjson` : files.at(-1);
if (!ledgerFile || !files.includes(ledgerFile)) throw new Error('live_ledger_missing');
const ledgerPath = path.join(ledgerDir, ledgerFile);
const audit = auditLiveEventLedger(ledgerPath);
if (!audit.ok || audit.invalidLines || audit.hashFailures) {
  throw new Error('live_ledger_quality_gate_failed');
}
const targetCodes = ['TX', 'MTX', 'TMF'].map((family) => {
  const targetCode = readiness?.contracts?.[family]?.targetCode;
  if (!targetCode) throw new Error(`futures_target_code_missing:${family}`);
  return targetCode;
});
const result = buildFuturesOrderFlow(replayLiveEventLedger(ledgerPath), {
  targetCodes,
  maxQuoteAgeMs: 2_000,
});
const output = {
  ...result,
  generatedAt: new Date().toISOString(),
  sourceLedger: ledgerFile,
  sourceLedgerHash: audit.latestHash,
  sourceAudit: {
    ok: audit.ok,
    invalidLines: audit.invalidLines,
    hashFailures: audit.hashFailures,
    sequenceGaps: audit.sequenceGaps,
    duplicates: audit.duplicates,
  },
  candidateOnly: true,
  formalModelWeight: 0,
  orderRoutesEnabled: false,
};
const outputDir = path.join(root, 'data', 'intraday', 'live-derived');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${ledgerFile.slice(0, 10)}-futures-order-flow.json`);
const temporary = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(output, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
fs.renameSync(temporary, outputPath);
console.log(JSON.stringify({
  output: outputPath,
  sourceLedger: ledgerFile,
  products: Object.fromEntries(Object.entries(output.products).map(([code, product]) => [
    code,
    {
      ticks: product.ticks,
      volume: product.volume,
      cvd: product.cvd,
      exactVwap: product.exactVwap,
      classifiedVolumeRatio: product.classifiedVolumeRatio,
      classificationConflicts: product.classificationConflicts,
    },
  ])),
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));

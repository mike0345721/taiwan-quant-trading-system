import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { deriveOptionGreeksProbe } from '../src/option-greeks.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const readinessPath = path.join(root, 'data', 'readiness', 'shioaji-futures-access.json');
const readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
const probe = readiness?.optionsAccess?.boundedQuoteProbe;
if (!readiness?.login || readiness?.executionAuthorized !== false
  || readiness?.orderRoutesEnabled !== false) {
  throw new Error('readonly_access_evidence_invalid');
}
const result = deriveOptionGreeksProbe({
  checkedAt: readiness.checkedAt,
  futurePrice: probe?.futurePrice,
  expiry: probe?.expiry,
  contracts: probe?.contracts,
  rate: 0.015,
});
const date = String(readiness.checkedAt).slice(0, 10);
const outputDir = path.join(root, 'data', 'intraday', 'live-derived');
fs.mkdirSync(outputDir, { recursive: true });
const outputPath = path.join(outputDir, `${date}-option-greeks-probe.json`);
const temporary = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(result, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
fs.renameSync(temporary, outputPath);
console.log(JSON.stringify({
  output: outputPath,
  calculated: result.calculated,
  timestampGate: result.timestampGate,
  formalModelWeight: result.formalModelWeight,
  executionAuthorized: result.executionAuthorized,
}, null, 2));

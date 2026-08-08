import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { aggregateTaifexTxCsv } from '../src/taifex-intraday.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

const input = argument('--input');
const tradeDate = argument('--trade-date');
const reportPath = argument('--report');
if (!input || !/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) {
  console.error('Usage: node scripts/validate-taifex-trade-summary.mjs --input <csv> --trade-date YYYY-MM-DD [--report <json>]');
  process.exit(2);
}

const inputPath = path.resolve(input);
const result = await aggregateTaifexTxCsv(inputPath, { tradeDate });
const sessions = Object.fromEntries(Object.entries(result.sessions).map(([session, payload]) => [
  session,
  {
    contract: payload.contract,
    tickCount: payload.tickCount,
    barCount: payload.barCount,
    volume: payload.sessionVolume,
    firstTimestamp: payload.firstTimestamp,
    lastTimestamp: payload.lastTimestamp,
  },
]));
const formatCompatible = result.acceptedTicks > 0 && result.malformedTicks === 0
  && Boolean(result.sessions.day) && Boolean(result.sessions.night);
const productionImportReady = formatCompatible
  && result.sessions.day.barCount === 60
  && result.sessions.night.barCount >= 160;
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  sourceFile: path.basename(inputPath),
  requestedTradeDate: tradeDate,
  formatCompatible,
  productionImportReady,
  acceptedTicks: result.acceptedTicks,
  malformedTicks: result.malformedTicks,
  malformedExamples: result.malformedExamples,
  excludedSpreadRows: result.excludedSpreadRows,
  excludedNonOutrightRows: result.excludedNonOutrightRows,
  selectedContract: result.selectedContract,
  contractSelection: result.contractSelection,
  contracts: result.contracts,
  sessions,
  limitations: [
    'A format sample is intentionally incomplete and cannot pass full-session coverage gates.',
    'The purchased package must be inspected before bulk splitting because night-session rows belong to the next trading day.',
    'Exact active-buy and active-sell direction cannot be recovered from B+S volume.',
  ],
  researchOnly: true,
  executionAuthorized: false,
};

if (reportPath) atomicWrite(path.resolve(reportPath), report);
console.log(JSON.stringify(report, null, 2));
if (!formatCompatible) process.exitCode = 1;

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { aggregateTaifexTickRuleFlowCsv } from '../src/taifex-tick-rule-flow.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, filePath);
}

function unzipToTemporaryCsv(zipPath, temporaryDir) {
  const listing = spawnSync('tar', ['-tf', zipPath], { encoding: 'utf8' });
  if (listing.status !== 0) throw new Error(`PAID_ZIP_LIST_FAILED:${path.basename(zipPath)}`);
  const entries = listing.stdout.split(/\r?\n/).filter(Boolean);
  if (entries.length !== 1 || !entries[0].toLowerCase().endsWith('.csv')) {
    throw new Error(`PAID_ZIP_CONTENT_UNEXPECTED:${path.basename(zipPath)}`);
  }
  const extracted = spawnSync('tar', ['-xOf', zipPath], {
    encoding: null,
    maxBuffer: 1024 * 1024 * 1024,
  });
  if (extracted.status !== 0 || !extracted.stdout?.length) {
    throw new Error(`PAID_ZIP_EXTRACT_FAILED:${path.basename(zipPath)}`);
  }
  const output = path.join(temporaryDir, path.basename(entries[0]));
  fs.writeFileSync(output, extracted.stdout);
  return output;
}

function sha256(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

const inputDir = path.resolve(argument('--input-dir') || '');
const from = argument('--from');
const to = argument('--to');
const outputDir = path.resolve(argument('--output-dir') || 'data/market-state/historical-flow-proxy');
if (!fs.existsSync(inputDir)
  || !/^\d{4}-\d{2}-\d{2}$/.test(from || '')
  || !/^\d{4}-\d{2}-\d{2}$/.test(to || '')
  || from > to) {
  console.error('Usage: node scripts/build-paid-taifex-flow-proxy.mjs --input-dir <Daily_YYYY_MM_DD.zip dir> --from YYYY-MM-DD --to YYYY-MM-DD [--output-dir <dir>]');
  process.exit(2);
}

const files = fs.readdirSync(inputDir)
  .map((name) => {
    const match = /^Daily_(\d{4})_(\d{2})_(\d{2})\.zip$/.exec(name);
    return match ? {
      name,
      tradeDate: `${match[1]}-${match[2]}-${match[3]}`,
      path: path.join(inputDir, name),
    } : null;
  })
  .filter((item) => item && item.tradeDate >= from && item.tradeDate <= to)
  .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
if (!files.length) throw new Error('PAID_TAIFEX_DAILY_ZIPS_NOT_FOUND');

const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-market-state-paid-flow-'));
const results = [];
try {
  for (const file of files) {
    const csvPath = unzipToTemporaryCsv(file.path, temporaryDir);
    try {
      const result = await aggregateTaifexTickRuleFlowCsv(csvPath, { tradeDate: file.tradeDate });
      const outputPath = path.join(outputDir, `${file.tradeDate}-tx-tick-rule-flow.json`);
      atomicWrite(outputPath, {
        ...result,
        sourceZip: file.name,
        sourceZipSha256: sha256(file.path),
      });
      results.push({
        tradeDate: file.tradeDate,
        outputPath,
        selectedContract: result.selectedContract,
        dayTicks: result.sessions.day?.tickCount ?? 0,
        nightTicks: result.sessions.night?.tickCount ?? 0,
        dayCoverage: result.sessions.day?.classificationCoverage ?? null,
        nightCoverage: result.sessions.night?.classificationCoverage ?? null,
      });
    } finally {
      fs.rmSync(csvPath, { force: true });
    }
  }
} finally {
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

const manifest = {
  schemaVersion: 'market-state-paid-flow-proxy-manifest-v1',
  generatedAt: new Date().toISOString(),
  sourceType: 'TAIFEX_paid_historical_futures_trade_summary',
  requestedRange: { from, to },
  discoveredFiles: files.length,
  generatedDays: results.length,
  classificationMethod: 'TICK_RULE_WITH_ZERO_TICK_CARRY_FORWARD',
  estimatedTradeDirection: true,
  realAggressorSide: false,
  limitations: [
    'The paid trade-summary files do not contain Bid/Ask or true aggressor side.',
    'Tick-rule flow must remain a separate proxy series from Shioaji Bid/Ask-cross classified live flow.',
    'No proxy result is a trading signal or formal Market State factor without later validation and Owner Review.',
  ],
  days: results,
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
};
atomicWrite(path.join(outputDir, 'manifest.json'), manifest);
console.log(JSON.stringify({
  outputDir,
  generatedDays: results.length,
  realAggressorSide: false,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));

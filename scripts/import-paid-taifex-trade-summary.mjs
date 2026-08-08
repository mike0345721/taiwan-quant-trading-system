import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { aggregateTaifexTxCsv } from '../src/taifex-intraday.mjs';
import {
  auditPaidTaifexReplay,
  promotePaidCandidateArchives,
  writePaidCandidateArchives,
} from '../src/paid-taifex-import.mjs';

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : null;
}

function atomicWrite(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function sha256(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
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
  const output = path.join(temporaryDir, entries[0]);
  fs.writeFileSync(output, extracted.stdout);
  return output;
}

const inputDir = path.resolve(argument('--input-dir') || '');
const from = argument('--from');
const to = argument('--to');
const reportPath = path.resolve(argument('--report') || 'data/intraday/paid-candidates/latest-report.json');
const promote = process.argv.includes('--promote');
if (!fs.existsSync(inputDir) || !/^\d{4}-\d{2}-\d{2}$/.test(from || '')
  || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) {
  console.error('Usage: node scripts/import-paid-taifex-trade-summary.mjs --input-dir <inner-zips> --from YYYY-MM-DD --to YYYY-MM-DD [--report <json>] [--promote]');
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

const candidateDir = path.resolve('data/intraday/paid-candidates/archive');
const archiveDir = path.resolve('data/intraday/archive');
const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-paid-taifex-'));
const db = new DatabaseSync(path.resolve('v2/data/research-v2.sqlite'), { readOnly: true });
db.exec('PRAGMA query_only = ON;');
const official = db.prepare(`SELECT trade_date, contract, session, open, high, low, close, volume, is_active
  FROM futures_contract_daily WHERE trade_date=? AND product='TX' ORDER BY is_active DESC, volume DESC`);
const days = [];
try {
  for (const file of files) {
    const csvPath = unzipToTemporaryCsv(file.path, temporaryDir);
    try {
      const result = await aggregateTaifexTxCsv(csvPath, {
        tradeDate: file.tradeDate,
        provider: 'TAIFEX paid historical futures trade summary',
      });
      writePaidCandidateArchives(candidateDir, file.tradeDate, result);
      days.push({
        ...auditPaidTaifexReplay({
          tradeDate: file.tradeDate,
          result,
          officialRows: official.all(file.tradeDate),
        }),
        sourceZip: file.name,
        sourceZipSha256: sha256(file.path),
      });
    } finally {
      fs.rmSync(csvPath, { force: true });
    }
  }
} finally {
  db.close();
  fs.rmSync(temporaryDir, { recursive: true, force: true });
}

const acceptedDates = days.filter((day) => day.pass).map((day) => day.tradeDate);
const failedDates = days.filter((day) => !day.pass).map((day) => day.tradeDate);
let promotion = null;
if (promote) {
  if (failedDates.length) throw new Error(`PAID_BATCH_PROMOTION_BLOCKED:${failedDates.join(',')}`);
  promotion = promotePaidCandidateArchives(candidateDir, archiveDir, acceptedDates);
}
const report = {
  schemaVersion: '1.0.0',
  generatedAt: new Date().toISOString(),
  sourceType: 'TAIFEX_paid_historical_futures_trade_summary',
  requestedRange: { from, to },
  discoveredFiles: files.length,
  acceptedDays: acceptedDates.length,
  failedDays: failedDates.length,
  acceptedDates,
  failedDates,
  days,
  promoted: promote,
  promotion: promotion ? {
    promotedFiles: promotion.promoted.length,
    identicalExistingFiles: promotion.identicalExisting.length,
  } : null,
  volumeDefinition: 'TAIFEX B+S divided by 2',
  limitations: [
    'Exact active-buy and active-sell direction is unavailable.',
    'Official daily volume contains scopes that are not exactly comparable with outright non-block tick volume.',
    'No failed date is promoted into the formal archive.',
  ],
  researchOnly: true,
  executionAuthorized: false,
};
atomicWrite(reportPath, report);
console.log(JSON.stringify({
  reportPath,
  discoveredFiles: report.discoveredFiles,
  acceptedDays: report.acceptedDays,
  failedDays: report.failedDays,
  failedDates: report.failedDates,
  promoted: report.promoted,
  promotion: report.promotion,
  researchOnly: true,
  executionAuthorized: false,
}, null, 2));
if (failedDates.length) process.exitCode = 1;


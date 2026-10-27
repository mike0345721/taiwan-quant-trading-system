// Pure read-only triage: never writes a database, source cache, report, or ledger.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { parseTaifexPositionCsv } from '../src/taifex-position-parser.mjs';

const VALID_CACHE_FILE = /^(\d{4}-\d{2}-\d{2})-(\d{4}-\d{2}-\d{2})\.csv\.gz$/;
const MAX_COMPRESSED_BYTES = 4 * 1024 * 1024;
const MAX_DECOMPRESSED_BYTES = 12 * 1024 * 1024;

const isInt = (value) => Number.isSafeInteger(value);

export function classifyOiCacheRow(row, cache) {
  const base = {
    tradeDate: row.trade_date,
    institutionType: row.institution_type,
    databaseLong: row.open_interest_long,
    databaseShort: row.open_interest_short,
    databaseNet: row.detail_net,
    comparedFinalNet: row.final_net,
    cacheFileName: cache?.fileName ?? null,
    cacheArchiveSha256: cache?.sha256 ?? null,
  };
  if (!cache || cache.state === 'MISSING') return { ...base, status: 'CACHE_MISSING_HOLD' };
  if (cache.state !== 'AVAILABLE') return { ...base, status: 'CACHE_READ_ERROR_HOLD' };
  const item = cache.item;
  if (!item || ![item.long, item.short, item.net].every(isInt)) {
    return { ...base, status: 'CACHE_MISSING_FIELDS_HOLD' };
  }
  const withSource = {
    ...base, cacheLong: item.long, cacheShort: item.short, cacheNet: item.net,
  };
  if (item.long - item.short !== item.net) {
    return { ...withSource, status: 'CACHE_ARITHMETIC_CONFLICT_HOLD' };
  }
  if (!isInt(row.final_net) || item.net !== row.final_net) {
    return { ...withSource, status: 'CACHE_FINAL_NET_CONFLICT_HOLD' };
  }
  return { ...withSource, status: 'CANDIDATE_PENDING_SOURCE_VERIFICATION' };
}

export function planOiCacheRepair(qualityReport, lookup) {
  const mismatches = qualityReport?.institutionalFuturesOiConsistency?.mismatchDates;
  if (!Array.isArray(mismatches) || typeof lookup !== 'function') {
    throw new Error('OI_QUALITY_REPORT_OR_LOOKUP_INVALID');
  }
  const rows = mismatches.map((row) => classifyOiCacheRow(
    row, lookup(row.trade_date, row.institution_type),
  ));
  const counts = {};
  for (const row of rows) counts[row.status] = (counts[row.status] || 0) + 1;
  return {
    schemaVersion: 'cru21-oi-cache-repair-plan-v1',
    observedAt: qualityReport.generatedAt ?? null,
    source: 'EXISTING_QUALITY_RECEIPT_AND_EXISTING_OFFICIAL_CSV_CACHE',
    status: 'REVIEW_ONLY_HOLD',
    readOnly: true,
    databaseWritten: false,
    repairApplied: false,
    repairedRows: 0,
    comparedRows: rows.length,
    counts,
    rows,
    qualificationNotice: 'Cached CSV is not independently verified current official source; candidate classification never authorizes reimport or marks quality PASS.',
  };
}

function readMonthlyCaches(cacheDir, tradeDate, filenames, memo) {
  const month = tradeDate.slice(0, 7);
  const candidates = filenames.filter((name) => {
    const match = VALID_CACHE_FILE.exec(name);
    return match && match[1].slice(0, 7) === month && match[1] <= tradeDate && match[2] >= tradeDate;
  });
  const fileName = candidates.at(-1);
  if (!fileName) return { state: 'MISSING' };
  if (memo.has(fileName)) return memo.get(fileName);
  const filePath = path.join(cacheDir, fileName);
  let result;
  try {
    const fileBytes = fs.readFileSync(filePath);
    if (fileBytes.length > MAX_COMPRESSED_BYTES) throw new Error('CACHE_SIZE_LIMIT');
    const body = zlib.gunzipSync(fileBytes, { maxOutputLength: MAX_DECOMPRESSED_BYTES });
    const decoded = new TextDecoder('big5', { fatal: true }).decode(body);
    result = {
      state: 'AVAILABLE',
      fileName,
      sha256: crypto.createHash('sha256').update(fileBytes).digest('hex'),
      byDate: parseTaifexPositionCsv(decoded),
    };
  } catch {
    result = { state: 'ERROR', fileName };
  }
  memo.set(fileName, result);
  return result;
}

export function inspectDefaultOiCacheReadOnly() {
  const scriptDir = path.dirname(fileURLToPath(import.meta.url));
  const root = path.dirname(scriptDir);
  const qualityReport = JSON.parse(
    fs.readFileSync(path.join(root, 'reports', 'latest-quality.json'), 'utf8'),
  );
  const cacheDir = path.join(root, 'data', 'domestic-institution-cache');
  const filenames = fs.existsSync(cacheDir)
    ? fs.readdirSync(cacheDir).filter((name) => VALID_CACHE_FILE.test(name)).sort()
    : [];
  const memo = new Map();
  return planOiCacheRepair(qualityReport, (date, type) => {
    const cached = readMonthlyCaches(cacheDir, date, filenames, memo);
    if (cached.state !== 'AVAILABLE') return cached;
    const sourceType = type === 'dealer' ? 'dealer' : type === 'investment_trust' ? 'trust' : null;
    return { ...cached, item: sourceType ? cached.byDate.get(date)?.[sourceType] : null, byDate: undefined };
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 2) throw new Error('OI_INSPECTION_REJECTS_ARGUMENTS');
    process.stdout.write(JSON.stringify(inspectDefaultOiCacheReadOnly(), null, 2) + '\n');
    // Exit 2 deliberately: even fully classifiable rows remain NOT REPAIRED.
    process.exitCode = 2;
  } catch (error) {
    process.stderr.write('OI_INSPECTION_BLOCKED: ' + error.message + '\n');
    process.exitCode = 2;
  }
}

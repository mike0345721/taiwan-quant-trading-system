import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildDailyCollectionAcceptance,
  stableDailyAcceptanceJson,
  streamDailyLedgerEvidence,
} from '../src/daily-collection-acceptance.mjs';
import { auditLiveEventLedger } from '../src/live-event-ledger.mjs';
import {
  loadGovernedTradingCalendar,
  resolveGovernedTradingDay,
  resolvePreviousGovernedTradingDate,
} from '../src/market-state-forward-shadow-calendar.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function options(argv) {
  const result = {};
  for (const item of argv) {
    if (!item.startsWith('--') || !item.includes('=')) throw new Error(`DAILY_ACCEPTANCE_ARGUMENT_INVALID:${item}`);
    const [key, ...rest] = item.slice(2).split('=');
    result[key] = rest.join('=');
  }
  return result;
}

function requiredDate(value, code) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(code);
  return value;
}

function requiredIso(value) {
  if (!value || !Number.isFinite(Date.parse(value))) throw new Error('DAILY_ACCEPTANCE_GENERATED_AT_REQUIRED');
  return new Date(value).toISOString();
}

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function dateShift(date, days) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}

function governedLedgerDates(calendar, tradeDate, sessions) {
  const dates = new Set();
  if (sessions.includes('DAY')) dates.add(tradeDate);
  if (sessions.includes('NIGHT')) {
    const previous = resolvePreviousGovernedTradingDate(calendar, tradeDate);
    dates.add(previous);
    dates.add(dateShift(previous, 1));
  }
  return [...dates].sort();
}

function auditEvidenceFor(ledgerPaths, auditDir) {
  const audits = [];
  for (const ledgerPath of ledgerPaths) {
    if (!fs.existsSync(ledgerPath)) continue;
    const date = path.basename(ledgerPath, '.ndjson');
    const persisted = readJson(path.join(auditDir, `${date}.json`));
    if (persisted?.ledgerFile === `${date}.ndjson` && persisted?.audit) {
      audits.push({ source: `${date}.json`, sourceFile: `${date}.ndjson`, ...persisted.audit });
      continue;
    }
    const bytes = fs.statSync(ledgerPath).size;
    if (bytes <= 64 * 1024 * 1024) {
      audits.push({ source: 'auditLiveEventLedger', sourceFile: path.basename(ledgerPath), ...auditLiveEventLedger(ledgerPath) });
    }
  }
  if (!audits.length) return null;
  return {
    ok: audits.every((item) => item.ok === true),
    sources: audits.map((item) => ({
      source: item.source, sourceFile: item.sourceFile, ok: item.ok, events: item.events,
      bytes: item.bytes, latestHash: item.latestHash, sequenceGaps: item.sequenceGaps,
      prefixSha256: item.prefixSha256 || null,
    })),
  };
}

function atomicWrite(filePath, contents) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, contents, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(temporary, filePath);
}

function ledgerCutoffs(value) {
  if (!value) return {};
  const result = {};
  for (const item of value.split(',').filter(Boolean)) {
    const [file, bytesText] = item.split('@');
    const bytes = Number(bytesText);
    if (!/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(file || '') || !Number.isInteger(bytes) || bytes < 1) {
      throw new Error(`DAILY_ACCEPTANCE_LEDGER_CUTOFF_ARGUMENT_INVALID:${item}`);
    }
    result[file] = bytes;
  }
  return result;
}

const args = options(process.argv.slice(2));
const tradeDate = requiredDate(args['trade-date'] || args.date, 'DAILY_ACCEPTANCE_TRADE_DATE_REQUIRED');
const calendarDate = requiredDate(args['calendar-date'] || tradeDate, 'DAILY_ACCEPTANCE_CALENDAR_DATE_REQUIRED');
const generatedAt = requiredIso(args['generated-at']);
const sessions = (args.sessions || 'DAY,NIGHT').split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
if (!sessions.length || sessions.some((item) => !['DAY', 'NIGHT'].includes(item))) throw new Error('DAILY_ACCEPTANCE_SESSIONS_INVALID');

const dataRoot = path.resolve(args['data-root'] || path.join(root, 'data'));
const outputRoot = path.resolve(args['output-root'] || path.join(dataRoot, 'quality', 'daily-collection-acceptance'));
const calendarPath = path.resolve(args.calendar || path.join(root, 'config', 'taifex-official-calendar-2026.json'));
const registryPath = path.resolve(args.registry || path.join(root, 'config', 'data-requirements-v1.json'));
const dailyStatusPath = path.resolve(args['daily-status'] || path.join(root, 'v2', 'reports', 'v3-daily-update-status.json'));
const calendar = loadGovernedTradingCalendar(calendarPath);
const registry = readJson(registryPath);
if (!registry) throw new Error('DAILY_ACCEPTANCE_REGISTRY_UNREADABLE');

let marketDayState = 'UNKNOWN';
try {
  marketDayState = resolveGovernedTradingDay(calendar, tradeDate).officialTradingDay ? 'TRADING_DAY' : 'NON_TRADING_DAY';
} catch {
  marketDayState = 'UNKNOWN';
}

const ledgerDates = governedLedgerDates(calendar, tradeDate, sessions);
if (!ledgerDates.includes(calendarDate)) throw new Error('DAILY_ACCEPTANCE_CALENDAR_DATE_NOT_IN_GOVERNED_LEDGER_SCOPE');
const ledgerPaths = ledgerDates.map((date) => path.join(dataRoot, 'live-events', `${date}.ndjson`));
const ledgerAudit = auditEvidenceFor(ledgerPaths, path.join(dataRoot, 'live-events', 'futures-audits'));
const cutoffBytesByFile = ledgerCutoffs(args['ledger-cutoffs']);
const selectedLedgerNames = new Set(ledgerPaths.filter((filePath) => fs.existsSync(filePath)).map((filePath) => path.basename(filePath)));
if (Object.keys(cutoffBytesByFile).length) {
  const unknown = Object.keys(cutoffBytesByFile).filter((file) => !selectedLedgerNames.has(file));
  const missing = [...selectedLedgerNames].filter((file) => !Object.hasOwn(cutoffBytesByFile, file));
  if (unknown.length || missing.length) {
    throw new Error(`DAILY_ACCEPTANCE_LEDGER_CUTOFF_SET_INVALID:unknown=${unknown.join('|')}:missing=${missing.join('|')}`);
  }
}
const liveEvidence = await streamDailyLedgerEvidence(ledgerPaths, {
  calendar, tradeDate, generatedAt, ledgerAudit, cutoffBytesByFile,
});

let dailyUpdateStatus = readJson(dailyStatusPath);
const dailyTradeDate = dailyUpdateStatus?.gateSummary?.marketDaily?.tradeDate || null;
if (dailyTradeDate && dailyTradeDate !== tradeDate) dailyUpdateStatus = null;
if (dailyUpdateStatus && Date.parse(dailyUpdateStatus.completedAt || '') > Date.parse(generatedAt)) {
  dailyUpdateStatus = null;
}
if (dailyUpdateStatus) {
  dailyUpdateStatus.sourceArtifactIdentity = {
    file: path.basename(dailyStatusPath),
    bytes: fs.statSync(dailyStatusPath).size,
    completedAt: dailyUpdateStatus.completedAt || null,
  };
}

const report = buildDailyCollectionAcceptance({
  calendarDate,
  tradeDate,
  marketDayState,
  generatedAt,
  sessions,
  registry,
  liveEvidence,
  dailyUpdateStatus,
  derivedEvidence: null,
  storageEvidence: {
    derivedArtifactBytes: null,
    auditReportBytes: dailyUpdateStatus ? fs.statSync(dailyStatusPath).size : null,
  },
});

const contents = stableDailyAcceptanceJson(report);
const datedPath = path.join(outputRoot, `${tradeDate}.json`);
const latestPath = path.join(outputRoot, 'latest.json');
atomicWrite(datedPath, contents);
atomicWrite(latestPath, contents);

console.log(JSON.stringify({
  schemaVersion: report.schemaVersion,
  output: { datedPath, latestPath },
  calendarDate: report.calendarDate,
  tradeDate: report.tradeDate,
  marketDayState: report.marketDayState,
  overallState: report.overallState,
  summary: report.summary,
  storage: report.storage,
  knownUnknowns: report.feeds.filter((feed) => ['UNKNOWN', 'PARTIAL', 'PENDING'].includes(feed.coverageState)
    || ['UNKNOWN', 'READY_WITH_LIMITATION'].includes(feed.integrityState)
    || feed.researchEligibility === 'UNKNOWN').map((feed) => ({ datasetId: feed.datasetId, session: feed.session, reasonCodes: feed.reasonCodes })),
  safety: report.safety,
}, null, 2));

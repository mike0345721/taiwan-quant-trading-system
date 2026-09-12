import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  buildDailyCollectionAcceptance,
  stableDailyAcceptanceJson,
  streamDailyLedgerEvidence,
} from '../src/daily-collection-acceptance.mjs';
import { readDailyBatchEvidence } from '../src/daily-collection-batch-evidence.mjs';
import { readDailyDerivedEvidence } from '../src/daily-collection-derived-evidence.mjs';
import { dailyEvidenceGapMatrix } from '../src/daily-collection-acceptance-sweep.mjs';
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

function governedLedgerScope(calendar, tradeDate, sessions) {
  const dates = new Map();
  const add = (date, session) => dates.set(date, [...new Set([...(dates.get(date) || []), session])]);
  if (sessions.includes('DAY')) add(tradeDate, 'DAY');
  if (sessions.includes('NIGHT')) {
    const previous = resolvePreviousGovernedTradingDate(calendar, tradeDate);
    add(previous, 'NIGHT');
    add(dateShift(previous, 1), 'NIGHT');
  }
  return Object.fromEntries([...dates.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function auditEvidenceFor(ledgerPaths, auditDir) {
  const audits = [];
  for (const ledgerPath of ledgerPaths) {
    if (!fs.existsSync(ledgerPath)) continue;
    const date = path.basename(ledgerPath, '.ndjson');
    const persisted = readJson(path.join(auditDir, `${date}.json`));
    if (persisted?.ledgerFile === `${date}.ndjson` && persisted?.audit) {
      audits.push({ ...persisted.audit, source: `${date}.json`, sourceFile: `${date}.ndjson` });
      continue;
    }
    const bytes = fs.statSync(ledgerPath).size;
    if (bytes <= 64 * 1024 * 1024) {
      const prefixSha256 = crypto.createHash('sha256').update(fs.readFileSync(ledgerPath)).digest('hex');
      audits.push({ ...auditLiveEventLedger(ledgerPath), prefixSha256, source: 'auditLiveEventLedger', sourceFile: path.basename(ledgerPath) });
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

function readJsonWithIdentity(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try {
    const contents = fs.readFileSync(filePath);
    return {
      value: JSON.parse(contents.toString('utf8')),
      identity: {
        file: path.basename(filePath), bytes: contents.length,
        sha256: crypto.createHash('sha256').update(contents).digest('hex'),
      },
    };
  } catch { return null; }
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
    if (!/^\d{4}-\d{2}-\d{2}\.ndjson$/.test(file || '') || !Number.isInteger(bytes) || bytes < 0) {
      throw new Error(`DAILY_ACCEPTANCE_LEDGER_CUTOFF_ARGUMENT_INVALID:${item}`);
    }
    if (Object.hasOwn(result, file)) throw new Error(`DAILY_ACCEPTANCE_LEDGER_CUTOFF_DUPLICATE:${file}`);
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

const ledgerScope = marketDayState === 'NON_TRADING_DAY' ? {} : governedLedgerScope(calendar, tradeDate, sessions);
const ledgerDates = Object.keys(ledgerScope);
const nightLedgerDates = ledgerDates.filter((date) => ledgerScope[date].includes('NIGHT'));
if (marketDayState === 'NON_TRADING_DAY' ? calendarDate !== tradeDate : !ledgerDates.includes(calendarDate)) {
  throw new Error('DAILY_ACCEPTANCE_CALENDAR_DATE_NOT_IN_GOVERNED_LEDGER_SCOPE');
}
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
  expectedSessionsByFile: Object.fromEntries(Object.entries(ledgerScope).map(([date, value]) => [`${date}.ndjson`, value])),
  sessionWindows: {
    DAY: sessions.includes('DAY') ? {
      sessionStart: new Date(`${tradeDate}T08:45:00+08:00`).toISOString(),
      sessionEnd: new Date(`${tradeDate}T13:45:00+08:00`).toISOString(),
    } : null,
    NIGHT: sessions.includes('NIGHT') && nightLedgerDates.length ? {
      sessionStart: new Date(`${nightLedgerDates[0]}T15:00:00+08:00`).toISOString(),
      sessionEnd: new Date(`${nightLedgerDates.at(-1)}T05:00:00+08:00`).toISOString(),
    } : null,
  },
});

const dailyStatusEvidence = readJsonWithIdentity(dailyStatusPath);
let dailyUpdateStatus = dailyStatusEvidence?.value || null;
const dailyTradeDate = dailyUpdateStatus?.gateSummary?.marketDaily?.tradeDate || null;
if (dailyTradeDate !== tradeDate) dailyUpdateStatus = null;
if (dailyUpdateStatus && Date.parse(dailyUpdateStatus.completedAt || '') > Date.parse(generatedAt)) {
  dailyUpdateStatus = null;
}
if (dailyUpdateStatus) {
  dailyUpdateStatus.sourceArtifactIdentity = {
    ...dailyStatusEvidence.identity,
    completedAt: dailyUpdateStatus.completedAt || null,
  };
}

const batchSnapshot = args['batch-evidence'] ? readJsonWithIdentity(path.resolve(args['batch-evidence'])) : null;
if (args['batch-evidence'] && !batchSnapshot) throw new Error('DAILY_ACCEPTANCE_BATCH_SNAPSHOT_UNREADABLE');
const batchEvidence = batchSnapshot?.value?.byTradeDate?.[tradeDate]
  || (args.database ? readDailyBatchEvidence({ databasePath: path.resolve(args.database), tradeDate, generatedAt }) : {});
const derivedEvidence = readDailyDerivedEvidence({
  artifactPaths: (args['derived-artifacts'] || '').split('|').filter(Boolean),
  tradeDate, sessions, generatedAt, liveEvidence,
});
if (derivedEvidence.unavailableArtifacts.some((item) => item.reasonCode === 'DERIVED_ARTIFACT_SELECTION_AMBIGUOUS')) {
  throw new Error('OWNER_SEMANTIC_DECISION_REQUIRED:DERIVED_ARTIFACT_SELECTION_AMBIGUOUS');
}
const inputs = {
  calendarDate, tradeDate, marketDayState, generatedAt, sessions, registry,
  liveEvidence, dailyUpdateStatus, batchEvidence, derivedEvidence,
  storageEvidence: {
    derivedArtifactBytes: derivedEvidence.artifactBytes,
    auditReportBytes: dailyUpdateStatus ? dailyStatusEvidence.identity.bytes : null,
  },
};
const report = buildDailyCollectionAcceptance(inputs);
const evidenceInputs = {
  calendar: readJsonWithIdentity(calendarPath).identity,
  registry: readJsonWithIdentity(registryPath).identity,
  batchSnapshot: batchSnapshot?.identity || null,
  derivedUnavailableArtifacts: derivedEvidence.unavailableArtifacts,
};

const contents = stableDailyAcceptanceJson({ ...report, evidenceInputs, evidenceGapMatrix: dailyEvidenceGapMatrix(report) });
const datedPath = path.join(outputRoot, `${tradeDate}.json`);
const latestPath = path.join(outputRoot, 'latest.json');
atomicWrite(path.join(outputRoot, `${tradeDate}.inputs.json`), stableDailyAcceptanceJson({ inputs, evidenceInputs }));
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

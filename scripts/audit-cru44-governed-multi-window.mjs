import fs from 'node:fs';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { projectCru34LiveBatch } from '../src/cru34-live-projection-worker.mjs';
import { cru34LiveHash } from '../src/cru34-live-checkpoint.mjs';
import { buildCru44MultiWindowFromCanonical } from '../src/cru44-multi-window-observed-flow.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';

const ledgerPath = path.resolve(process.env.CRU44_GOVERNED_LEDGER_PATH || '');
const outputRoot = path.resolve(process.env.CRU44_AUDIT_OUTPUT_ROOT || '');
const calendarPath = path.resolve(process.env.CRU44_CALENDAR_PATH || 'config/taifex-official-calendar-2026.json');
if (!ledgerPath || !outputRoot || !fs.existsSync(ledgerPath)) {
  throw new Error('CRU44_GOVERNED_AUDIT_CONFIG_INVALID');
}
fs.mkdirSync(outputRoot, { recursive: true });
const configuredCutoff = Number.parseInt(process.env.CRU44_AUDIT_CUTOFF_BYTES || '', 10);
const auditCutoffBytes = Number.isInteger(configuredCutoff) && configuredCutoff > 0
  ? configuredCutoff : fs.statSync(ledgerPath).size;
const configuredBatchBytes = Number.parseInt(process.env.CRU44_AUDIT_MAX_BATCH_BYTES || '', 10);
const auditMaxBatchBytes = Number.isInteger(configuredBatchBytes) && configuredBatchBytes >= 1024
  ? configuredBatchBytes : 8 * 1024 * 1024;
const ledgerDate = path.basename(ledgerPath, path.extname(ledgerPath));
const checkpointPath = path.join(outputRoot, `${ledgerDate}.checkpoint.json`);
const snapshotPath = path.join(outputRoot, 'latest.json');
const calendar = loadGovernedTradingCalendar(calendarPath);
const profile = { instrument: 'TX', product: 'TX', market: 'TAIFEX', tickSize: 1 };

function resolveSessionTradeDate(eventTime) {
  const value = classifyTxChartSession(eventTime, calendar);
  return { tradeDate: value.sessionTradeDate, session: value.session };
}

function percentile(values, proportion) {
  if (!values.length) return null;
  return [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.floor(values.length * proportion))];
}

function bucket() {
  return { samples: 0, warming: 0, live: 0, stale: 0, pressureEvidence: 0,
    responseReady: 0, pathReady: 0, longGap: 0, eventTimeRegression: 0, otherPathUnavailable: 0 };
}

function addMetric(target, envelope) {
  target.samples += 1;
  if (envelope.truthState === 'WARMING_UP') { target.warming += 1; return; }
  if (envelope.truthState === 'LIVE') target.live += 1;
  if (envelope.truthState === 'STALE') target.stale += 1;
  const evidence = envelope.evidence;
  if (evidence?.pressure?.pressureRatio != null) target.pressureEvidence += 1;
  if (evidence?.response?.status === 'READY') target.responseReady += 1;
  const pathState = evidence?.pathEfficiency;
  if (pathState?.status === 'READY') target.pathReady += 1;
  else if (pathState?.unavailableReason === 'QUALITY_INSUFFICIENT_LONG_GAP') target.longGap += 1;
  else if (pathState?.unavailableReason === 'QUALITY_INSUFFICIENT_EVENT_TIME_REGRESSION') target.eventTimeRegression += 1;
  else if (pathState) target.otherPathUnavailable += 1;
}

const WINDOW_KEYS = Object.freeze(['window900s', 'window1800s', 'window3600s', 'window14400s']);
const windowBuckets = () => Object.fromEntries(WINDOW_KEYS.map((key) => [key, bucket()]));
const metrics = { ...windowBuckets(), bySession: {}, byHour: {} };
const durations = [];
let batches = 0;
let maxRollingEvents = 0;
let latest = null;
for (let guard = 0; guard < 10_000; guard += 1) {
  const started = performance.now();
  const result = projectCru34LiveBatch({
    ledgerPath, checkpointPath, snapshotPath, instrumentProfile: profile,
    resolveSessionTradeDate, maxBatchBytes: auditMaxBatchBytes, maxBatchRecords: 100_000,
    maxLedgerBytes: auditCutoffBytes,
  });
  durations.push(performance.now() - started);
  batches += 1;
  maxRollingEvents = Math.max(maxRollingEvents, result.checkpoint?.rollingCanonicalEvents?.length || 0);
  if (result.snapshot?.multiWindowPayload) {
    latest = result;
    const payload = result.snapshot.multiWindowPayload;
    const session = payload.identity.session || 'UNKNOWN';
    const hour = String(payload.lineage.availableAt || '').slice(11, 13) || 'UNKNOWN';
    metrics.bySession[session] ||= windowBuckets();
    metrics.byHour[hour] ||= windowBuckets();
    for (const key of WINDOW_KEYS) {
      addMetric(metrics[key], payload.windows[key]);
      addMetric(metrics.bySession[session][key], payload.windows[key]);
      addMetric(metrics.byHour[hour][key], payload.windows[key]);
    }
  }
  if (result.status === 'NO_COMPLETE_SUFFIX') {
    if (!latest && result.checkpoint && fs.existsSync(snapshotPath)) {
      latest = { ...result, snapshot: JSON.parse(fs.readFileSync(snapshotPath, 'utf8')) };
    }
    break;
  }
  if (guard === 9_999) throw new Error('CRU44_GOVERNED_AUDIT_GUARD_EXCEEDED');
}
if (!latest?.snapshot?.multiWindowPayload) throw new Error('CRU44_GOVERNED_AUDIT_NO_MULTI_WINDOW_SNAPSHOT');

const compatibilityHash = cru34LiveHash(latest.snapshot.semanticPayload);
const replayed = buildCru44MultiWindowFromCanonical({
  canonicalEvents: latest.checkpoint.rollingCanonicalEvents,
  cutoffLedgerOrdinal: latest.snapshot.semanticPayload.cutoffLedgerOrdinal,
  instrumentProfile: profile,
  sourceTruthState: latest.snapshot.truthState === 'STALE' ? 'STALE' : 'LIVE',
  compatibilitySemanticHash: compatibilityHash,
});
const restartStarted = performance.now();
const restart = projectCru34LiveBatch({
  ledgerPath, checkpointPath, snapshotPath, instrumentProfile: profile,
  resolveSessionTradeDate, maxBatchBytes: auditMaxBatchBytes, maxBatchRecords: 100_000,
  maxLedgerBytes: auditCutoffBytes,
});
const restartMs = performance.now() - restartStarted;
const finalWindows = latest.snapshot.multiWindowPayload.windows;
const report = {
  schemaVersion: 'cru44-governed-multi-window-audit-v2',
  generatedAt: new Date().toISOString(),
  source: {
    ledgerFileName: path.basename(ledgerPath),
    ledgerBytesObserved: auditCutoffBytes,
    physicalLedgerBytesAtReport: fs.statSync(ledgerPath).size,
    sourceLedgerIdentity: latest.checkpoint.sourceLedgerIdentity,
    cutoffLedgerOrdinal: latest.snapshot.semanticPayload.cutoffLedgerOrdinal,
    cutoffRecordHash: latest.snapshot.semanticPayload.cutoffRecordHash,
    tradeDate: latest.snapshot.semanticPayload.tradeDate,
    session: latest.snapshot.semanticPayload.session,
    actualContract: latest.snapshot.semanticPayload.actualContract,
  },
  compatibility: {
    cru34SemanticPayloadHash: compatibilityHash,
    extensionBoundHash: latest.snapshot.multiWindowPayload.compatibility.cru34SemanticPayloadHash,
    exactHashMatch: compatibilityHash === latest.snapshot.multiWindowPayload.compatibility.cru34SemanticPayloadHash,
    primary60sUnchanged: latest.snapshot.multiWindowPayload.compatibility.primary60sUnchanged,
    context300sUnchanged: latest.snapshot.multiWindowPayload.compatibility.context300sUnchanged,
  },
  equivalence: {
    incrementalContentHash: latest.snapshot.multiWindowPayload.contentHash,
    replayedRollingReferenceContentHash: replayed.contentHash,
    exactMatch: latest.snapshot.multiWindowPayload.contentHash === replayed.contentHash,
  },
  windows: Object.fromEntries(WINDOW_KEYS.map((key) => [key, {
    key: finalWindows[key].key,
    truthState: finalWindows[key].truthState,
    pressureStatus: finalWindows[key].evidence?.pressure?.status || 'UNAVAILABLE',
    classifiedCoverage: finalWindows[key].evidence?.pressure?.classifiedCoverage ?? null,
    responseStatus: finalWindows[key].evidence?.response?.status || 'UNAVAILABLE',
    pathStatus: finalWindows[key].evidence?.pathEfficiency?.status || 'UNAVAILABLE',
    pathReason: finalWindows[key].evidence?.pathEfficiency?.unavailableReason || null,
    maxObservedGapMs: finalWindows[key].evidence?.pathEfficiency?.maxObservedGapMs ?? null,
    maxAllowedGapMs: finalWindows[key].evidence?.pathEfficiency?.maxAllowedGapMs ?? 30_000,
    promotionEligible: Boolean(finalWindows[key].evidence?.pressure?.pressureRatio != null
      && finalWindows[key].evidence?.response?.status === 'READY'),
  }])),
  feasibility: metrics,
  resources: {
    batches, batchMsP50: percentile(durations, 0.5), batchMsP95: percentile(durations, 0.95),
    batchMsP99: percentile(durations, 0.99), maxBatchMs: Math.max(...durations),
    maxRollingCanonicalEvents: maxRollingEvents,
    checkpointBytes: fs.statSync(checkpointPath).size,
    snapshotBytes: fs.statSync(snapshotPath).size,
    restartStatus: restart.status, restartMs,
    maxBatchBytes: auditMaxBatchBytes, maxBatchRecords: 100_000,
  },
  safety: { formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false },
};
fs.writeFileSync(path.join(outputRoot, 'audit-report.json'), `${JSON.stringify(report, null, 2)}\n`, 'utf8');
if (!report.compatibility.exactHashMatch || !report.equivalence.exactMatch
    || Object.values(report.windows).some((window) => !window.promotionEligible
      && window.truthState !== 'WARMING_UP')
    || restart.status !== 'NO_COMPLETE_SUFFIX') {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  throw new Error('CRU44_GOVERNED_AUDIT_FAILED');
}
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

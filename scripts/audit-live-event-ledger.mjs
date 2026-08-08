import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { auditLiveEventLedger, evaluateLiveEventAcceptance } from '../src/live-event-ledger.mjs';
import { selectDurableLiveAcceptance } from '../src/live-acceptance-state.mjs';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledgerDir = path.join(appRoot, 'data', 'live-events');
const reportDir = path.join(ledgerDir, 'audits');
const files = fs.existsSync(ledgerDir)
  ? fs.readdirSync(ledgerDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)).sort()
  : [];
const latest = files.at(-1);
const requestedDate = process.argv.find((argument) => argument.startsWith('--date='))?.slice(7) || null;
if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
  throw new Error('invalid_audit_date');
}
const selected = requestedDate ? `${requestedDate}.ndjson` : latest;
if (requestedDate && !files.includes(selected)) throw new Error(`live_ledger_not_found:${requestedDate}`);
let storage = { freeBytes: null, lowDisk: false };
try {
  const stats = fs.statfsSync(ledgerDir);
  storage = { freeBytes: stats.bavail * stats.bsize, lowDisk: stats.bavail * stats.bsize < 2 * 1024 ** 3 };
} catch {
  // The directory may not exist before the first broker event.
}
const ledgerAudit = selected
  ? auditLiveEventLedger(path.join(ledgerDir, selected), { staleAfterMs: 15 * 60_000 })
  : { ok: true, events: 0, reason: 'awaiting_first_live_event', stale: true, latestHash: 'GENESIS' };
const selectedDate = selected?.slice(0, 10) || 'latest';
const existingReportPath = path.join(reportDir, `${selectedDate}.json`);
let existingReport = null;
try {
  existingReport = JSON.parse(fs.readFileSync(existingReportPath, 'utf8'));
} catch {
  // A first audit has no historical operational counters to reuse.
}
let operationalHealth = null;
if (selected === latest) {
  try {
    const response = await fetch('http://127.0.0.1:8790/health', {
      signal: AbortSignal.timeout(2_000),
    });
    if (response.ok) {
      const health = await response.json();
      const requiredCounters = ['callbackErrors', 'dropped', 'writerErrors'];
      if (requiredCounters.every((key) => Object.hasOwn(health, key))) {
        operationalHealth = {
          callbackErrors: Number(health.callbackErrors) || 0,
          dropped: Number(health.dropped) || 0,
          writerErrors: Number(health.writerErrors) || 0,
          processId: Number(health.processId) || null,
          executionAuthorized: health.executionAuthorized,
        };
      }
    }
  } catch {
    // A stopped or unavailable bridge means current operational evidence is pending.
  }
}
operationalHealth ||= existingReport?.acceptance?.evidence?.operationalHealth || null;
const acceptance = evaluateLiveEventAcceptance(ledgerAudit, {
  evidenceNotBefore: '2026-07-27T22:43:48.359307+08:00',
  operationalHealth,
});
const report = {
  schemaVersion: '3.9.7-live-event-audit-v3',
  generatedAt: new Date().toISOString(),
  state: !ledgerAudit.ok ? 'failed' : storage.lowDisk ? 'warning' : ledgerAudit.events ? 'tracking' : 'awaiting_first_event',
  ledgerFile: selected || null,
  ...ledgerAudit,
  acceptance,
  ...storage,
  appendOnly: true,
  researchOnly: true,
  executionAuthorized: false,
};
fs.mkdirSync(reportDir, { recursive: true });
const reportPath = path.join(reportDir, `${selectedDate}.json`);
const latestReportPath = path.join(reportDir, 'latest.json');
const durableReportPath = path.join(reportDir, 'acceptance.json');
function writeReportAtomic(target) {
  const tempPath = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  fs.renameSync(tempPath, target);
}
writeReportAtomic(reportPath);
if (selected === latest && latestReportPath !== reportPath) writeReportAtomic(latestReportPath);

let previousDurable = null;
try {
  previousDurable = JSON.parse(fs.readFileSync(durableReportPath, 'utf8'));
} catch {
  // The first completed audit creates the durable acceptance record.
}
let revalidatedPreviousReport = null;
const previousLedger = previousDurable?.sourceLedgerFile;
if (previousDurable?.acceptance?.status === 'PASS' && previousLedger && previousLedger !== selected) {
  const previousLedgerPath = path.join(ledgerDir, previousLedger);
  if (fs.existsSync(previousLedgerPath)) {
    const previousAudit = auditLiveEventLedger(previousLedgerPath, { staleAfterMs: 15 * 60_000 });
    const previousOperationalHealth = previousDurable?.acceptance?.evidence?.operationalHealth || null;
    revalidatedPreviousReport = {
      generatedAt: previousDurable.sourceReportGeneratedAt,
      ledgerFile: previousLedger,
      ...previousAudit,
      acceptance: evaluateLiveEventAcceptance(previousAudit, {
        evidenceNotBefore: '2026-07-27T22:43:48.359307+08:00',
        operationalHealth: previousOperationalHealth,
      }),
    };
  }
}
const durableAcceptance = selectDurableLiveAcceptance({
  currentReport: report,
  previousDurable,
  revalidatedPreviousReport,
});
const durableTempPath = `${durableReportPath}.${process.pid}.tmp`;
fs.writeFileSync(durableTempPath, `${JSON.stringify(durableAcceptance, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
fs.renameSync(durableTempPath, durableReportPath);
console.log(JSON.stringify(report, null, 2));
if (!ledgerAudit.ok) process.exitCode = 1;

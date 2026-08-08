import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

function json(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return null;
  try { return JSON.parse(fs.readFileSync(target, 'utf8')); } catch { return null; }
}

function file(relativePath) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return { exists: false, bytes: 0, modifiedAt: null };
  const stat = fs.statSync(target);
  return { exists: true, bytes: stat.size, modifiedAt: stat.mtime.toISOString() };
}

function directory(relativePath, pattern = null) {
  const target = path.join(root, relativePath);
  if (!fs.existsSync(target)) return { exists: false, files: 0, bytes: 0, latestModifiedAt: null };
  const entries = fs.readdirSync(target, { withFileTypes: true })
    .filter((entry) => entry.isFile() && (!pattern || pattern.test(entry.name)));
  const stats = entries.map((entry) => fs.statSync(path.join(target, entry.name)));
  return {
    exists: true,
    files: entries.length,
    bytes: stats.reduce((sum, stat) => sum + stat.size, 0),
    latestModifiedAt: stats.length
      ? new Date(Math.max(...stats.map((stat) => stat.mtimeMs))).toISOString()
      : null,
  };
}

const intraday = json('data/intraday/research/v3.8.1-price-volume/quality-summary.json');
const live = json('data/live-events/audits/acceptance.json')
  || json('data/live-events/audits/latest.json');
const paper = json('data/forward/v3.8-paper-events-audit.json');
const quality = json('v2/reports/latest-quality.json');
const completion = json('v2/reports/data-completion-status.json');
const liveAcceptance = live?.acceptance || null;
const formalDays = Number(intraday?.counts?.includedDays || 0);
const formalTarget = Number(intraday?.gates?.formalResearchTargetDays || 120);

const gates = [
  {
    key: 'current_data_quality',
    passed: Boolean(quality) && Number(quality?.issues?.error || 0) === 0,
    evidence: 'v2/reports/latest-quality.json',
  },
  {
    key: 'intraday_formal_sample',
    passed: formalDays >= formalTarget,
    evidence: `${formalDays}/${formalTarget} audited trading days`,
  },
  {
    key: 'live_ix0001_2330_acceptance',
    status: ['PASS', 'PENDING', 'FAIL'].includes(liveAcceptance?.status)
      ? liveAcceptance.status
      : 'PENDING',
    passed: liveAcceptance?.status === 'PASS' && liveAcceptance?.passed === true,
    evidence: liveAcceptance?.status || 'PENDING',
  },
  {
    key: 'paper_event_operational_evidence',
    passed: Number(paper?.records || 0) > 0 && paper?.errors?.length === 0,
    blocking: false,
    status: Number(paper?.records || 0) > 0 && paper?.errors?.length === 0
      ? 'AVAILABLE'
      : 'DEFERRED_UNTIL_LIVE_STRATEGY_PREREQUISITES',
    evidence: `${Number(paper?.records || 0)} append-only events`,
  },
];
const blockingGates = gates.filter((gate) => gate.blocking !== false);

const report = {
  schemaVersion: '3.9.7-current-readiness-v1',
  generatedAt: new Date().toISOString(),
  current: {
    stage: 'V3.9.x_current_hardening',
    dataHealth: {
      latestSnapshot: file('data/latest.json'),
      history: directory('data/history', /\.json$/),
      intradayDayArchives: directory('data/intraday/archive', /-day\.json$/),
      liveEvents: directory('data/live-events', /\.ndjson$/),
      paperLedger: file('data/forward/v3.8-paper-events.jsonl'),
      researchDatabase: file('v2/data/research-v2.sqlite'),
      databaseWal: file('v2/data/research-v2.sqlite-wal'),
      qualityState: quality ? {
        generatedAt: quality.generatedAt || null,
        issues: quality.issues || null,
      } : null,
      completionState: completion ? {
        status: completion.status || 'report_available',
        generatedAt: completion.generatedAt || null,
        unresolvedAlignedDates: Number.isFinite(Number(completion.unresolvedAlignedDates))
          ? Number(completion.unresolvedAlignedDates)
          : null,
      } : null,
    },
  },
  v310EntryGate: {
    passed: blockingGates.every((gate) => gate.passed),
    status: blockingGates.every((gate) => gate.passed) ? 'ready_for_planning_review' : 'blocked',
    gates,
    blockers: blockingGates.filter((gate) => !gate.passed).map((gate) => gate.key),
    note: 'This report is an evidence gate, not authorization to start NEXT or FUTURE work.',
  },
  researchOnly: true,
  executionAuthorized: false,
};

const output = path.join(root, 'data', 'readiness', 'latest.json');
fs.mkdirSync(path.dirname(output), { recursive: true });
const temporary = `${output}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
fs.renameSync(temporary, output);
console.log(JSON.stringify(report, null, 2));

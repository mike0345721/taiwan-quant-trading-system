import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.dirname(scriptDir);
const appRoot = path.dirname(root);
const reportsDir = path.join(root, 'reports');
const logsDir = path.join(root, 'logs');
const dataDir = path.join(root, 'data');
const statusPath = path.join(reportsDir, 'v3-daily-update-status.json');
const lockPath = path.join(dataDir, '.v3-daily-update.lock');
const dryRun = process.argv.includes('--dry-run') || process.env.V3_DAILY_DRY_RUN === '1';

fs.mkdirSync(reportsDir, { recursive: true });
fs.mkdirSync(logsDir, { recursive: true });
fs.mkdirSync(dataDir, { recursive: true });

const stages = [
  { key: 'prepare', script: 'setup-all.mjs', critical: true },
  { key: 'taifex', script: 'backfill-taifex.mjs' },
  { key: 'intraday_replay', script: 'backfill-taifex-replay-root.mjs', timeoutMs: 15 * 60 * 1000 },
  { key: 'intraday_features', script: 'build-intraday-research-features-root.mjs' },
  { key: 'intraday_strategy_engineering', script: 'run-intraday-strategy-engineering-root.mjs' },
  { key: 'twse_gaps', script: 'backfill-twse-gaps.mjs' },
  { key: 'twse_margin', script: 'backfill-twse-margin.mjs' },
  { key: 'futures_positions', script: 'backfill-taifex-position-gaps.mjs' },
  { key: 'domestic_institutions', script: 'backfill-domestic-institutions.mjs', env: { V2_DOMESTIC_SKIP_HISTORY: '1' } },
  { key: 'spot_institution_gross', script: 'backfill-twse-institution-gross.mjs' },
  { key: 'option_institutions', script: 'backfill-option-institutions.mjs', env: { V2_OPTION_INSTITUTION_MONTHS: '1', V2_OPTION_INSTITUTION_DELAY_MS: '1500' } },
  { key: 'option_large_traders', script: 'backfill-option-large-traders.mjs', env: { V2_OPTION_LARGE_MONTHS: '1', V2_OPTION_LARGE_DELAY_MS: '1500' } },
  { key: 'market_breadth', script: 'backfill-market-breadth.mjs', env: { V2_BREADTH_WORKERS: '1', V2_BREADTH_BATCH: '4', V2_BREADTH_MAX_JOBS: '12', V2_BREADTH_DELAY_MS: '2500' } },
  { key: 'securities_lending', script: 'backfill-securities-lending.mjs', env: { V2_LENDING_WORKERS: '1', V2_LENDING_BATCH: '3', V2_LENDING_MAX_DATES: '6', V2_LENDING_DELAY_MS: '2500' } },
  { key: 'global_context', script: 'backfill-global-context.mjs' },
  { key: 'macro_context', script: 'backfill-macro-environment.mjs' },
  { key: 'taiwan_vix', script: 'backfill-taiwan-vix.mjs' },
  { key: 'normalized_futures_oi', script: 'build-normalized-futures-oi.mjs', critical: true },
  { key: 'option_volatility', script: 'build-option-volatility.mjs', critical: true },
  { key: 'volatility_relative', script: 'build-volatility-relative.mjs', critical: true },
  { key: 'basis_term_structure', script: 'build-basis-term-structure.mjs', critical: true },
  { key: 'features', script: 'build-features.mjs', critical: true },
  { key: 'quality', script: 'quality-report.mjs' },
  { key: 'official_validation', script: 'validate-official-history.mjs' },
  { key: 'status', script: 'status-report.mjs' },
  { key: 'available_at_audit', script: 'audit-available-at.mjs', critical: true },
  { key: 'extended_quality_audit', script: 'audit-extended-quality.mjs', critical: true },
  { key: 'v362_gate_audit', script: 'audit-v3-6-2-collection.mjs', critical: true },
  { key: 'forward_decisions', script: 'update-v3-decision-ledger.mjs', critical: true },
  { key: 'forward_outcomes', script: 'resolve-v3-outcomes.mjs', critical: true },
  { key: 'v34_forward', script: 'update-v3-4-forward.mjs', critical: true },
  { key: 'forward_ledger_audit', script: 'audit-forward-ledger-root.mjs', critical: true },
  { key: 'paper_event_ledger_audit', script: 'audit-paper-event-ledger-root.mjs', critical: true },
  { key: 'live_event_ledger_audit', script: 'audit-live-event-ledger-root.mjs' },
  { key: 'data_continuity_audit', script: 'audit-data-continuity.mjs', critical: true },
];

function writeJsonAtomic(filePath, value) {
  const temp = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temp, filePath);
}

function taipeiStamp() {
  return new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei', dateStyle: 'short', timeStyle: 'medium' })
    .format(new Date()).replaceAll(':', '-').replace(' ', '_');
}

if (dryRun) {
  console.log(JSON.stringify({ dryRun: true, formalResearchRerun: false, stages: stages.map(({ key, script }) => ({ key, script })) }, null, 2));
  process.exit(0);
}

let lockHandle;
try {
  lockHandle = fs.openSync(lockPath, 'wx', 0o600);
  fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
} catch (error) {
  if (error.code === 'EEXIST') {
    let active = true;
    try {
      const previous = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
      process.kill(Number(previous.pid), 0);
    } catch {
      active = false;
    }
    if (active) {
      console.error('A V3 daily update is already running.');
      process.exit(2);
    }
    fs.unlinkSync(lockPath);
    lockHandle = fs.openSync(lockPath, 'wx', 0o600);
    fs.writeFileSync(lockHandle, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString(), recoveredStaleLock: true }));
  }
  if (!lockHandle) throw error;
}

const startedAt = new Date().toISOString();
const logPath = path.join(logsDir, `v3-daily-update-${taipeiStamp()}.log`);
const status = {
  state: 'running', startedAt, completedAt: null, currentStage: null,
  totalStages: stages.length,
  formalResearchRerun: false,
  mockSnapshotsAccepted: false,
  policy: 'Daily updates collect data and resolve frozen forward records. They do not retune thresholds or rerun the formal V3.6.2 holdout research.',
  stages: [], failures: [], logPath: path.relative(appRoot, logPath),
};

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  console.log(line);
  fs.appendFileSync(logPath, `${line}\n`, 'utf8');
}

try {
  writeJsonAtomic(statusPath, status);
  for (const stage of stages) {
    status.currentStage = stage.key;
    writeJsonAtomic(statusPath, status);
    log(`START ${stage.key}`);
    const began = Date.now();
    const result = spawnSync(process.execPath, [path.join(scriptDir, stage.script)], {
      cwd: root,
      env: { ...process.env, ...(stage.env || {}) },
      encoding: 'utf8',
      maxBuffer: 24 * 1024 * 1024,
      timeout: stage.timeoutMs || 5 * 60 * 1000,
    });
    if (result.stdout) fs.appendFileSync(logPath, result.stdout, 'utf8');
    if (result.stderr) fs.appendFileSync(logPath, result.stderr, 'utf8');
    const ok = result.status === 0 && !result.error;
    const item = { key: stage.key, script: stage.script, ok, durationSeconds: Math.round((Date.now() - began) / 100) / 10 };
    if (!ok) {
      item.error = result.error?.message || `exit_${result.status}`;
      status.failures.push({ key: stage.key, error: item.error, critical: Boolean(stage.critical) });
    }
    status.stages.push(item);
    writeJsonAtomic(statusPath, status);
    log(`${ok ? 'DONE' : 'FAILED'} ${stage.key} (${item.durationSeconds}s)`);
    if (!ok && stage.critical) throw new Error(`Critical stage failed: ${stage.key}`);
  }
  status.state = status.failures.length ? 'completed_with_warnings' : 'completed';
} catch (error) {
  status.state = 'failed';
  status.fatalError = error.message;
  log(`ABORTED ${error.message}`);
  process.exitCode = 1;
} finally {
  status.currentStage = null;
  status.completedAt = new Date().toISOString();
  writeJsonAtomic(statusPath, status);
  try { fs.closeSync(lockHandle); } catch { /* already closed */ }
  try { fs.unlinkSync(lockPath); } catch { /* lock cleanup is best effort */ }
  log(`FINAL ${status.state}`);
}

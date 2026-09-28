import fs from 'node:fs';
import crypto from 'node:crypto';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runDailyDataOperations, assertOperationsOutputRoot } from './build-daily-data-operations.mjs';
import { assertOperationsDate, CHECKPOINT_TYPES } from '../src/daily-data-operations.mjs';
import { loadGovernedTradingCalendar, resolveGovernedTradingDay } from '../src/market-state-forward-shadow-calendar.mjs';
import { resolveScheduledCheckpointRequest } from '../src/data-operations-scheduler-health.mjs';
import { assertOperationsBindingLaunch, assertOperationsBindingRoots } from '../src/data-operations-binding.mjs';

const appRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
import { sha256, readBoundedFile, contained, noLinks } from '../src/daily-data-operations-files.mjs';
import { assertDailyAcceptanceOutputRoot } from '../src/daily-collection-acceptance-sweep.mjs';
export { sha256, readBoundedFile } from '../src/daily-data-operations-files.mjs';
export function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function fail(code) { throw new Error(`OPERATIONS_${code}`); }
function pinned(root, ref) {
  if (!ref || typeof ref.file !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256 || '')
    || !/^[a-zA-Z0-9_./-]+\.json$/.test(ref.file) || ref.file.split('/').includes('..')) fail('INPUT_REFERENCE_INVALID');
  const file = path.resolve(root, ref.file);
  const relative = path.relative(root, file);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) fail('INPUT_ROOT_INVALID');
  const bytes = readBoundedFile(file);
  if (sha256(bytes) !== ref.sha256) fail('INPUT_HASH_MISMATCH');
  return { file, bytes, json: JSON.parse(bytes.toString('utf8')) };
}

// Explicit bounded request index, never a recursive filesystem search or mutable latest guess.
// Scheduled mode asks for today's governed date. Historical replay requires an explicit date.
export function resolveAcceptanceInput({ manifestPath, evidenceRoot, calendarPath, tradeDate, checkpointType, now,
  dataRoot, runMode = 'MANUAL_REPLAY' }) {
  assertOperationsDate(tradeDate);
  if (!CHECKPOINT_TYPES.includes(checkpointType)) fail('CHECKPOINT_INVALID');
  const manifestBytes = readBoundedFile(manifestPath, 1024 * 1024);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 'data-operations-input-index-v1' || manifest.governanceState !== 'GOVERNED'
    || !manifest.governanceReference
    || path.resolve(manifest.evidenceRoot || '') !== path.resolve(evidenceRoot)) fail('EVIDENCE_ROOT_OR_INDEX_INVALID');
  const calendarBytes = readBoundedFile(calendarPath);
  if (sha256(calendarBytes) !== manifest.calendarSha256) fail('CALENDAR_IDENTITY_MISMATCH');
  const calendar = loadGovernedTradingCalendar(calendarPath);
  const day = resolveGovernedTradingDay(calendar, tradeDate);
  if (!['TRADING_DAY', 'NON_TRADING_DAY'].includes(day.state)) fail('TRADE_DATE_UNGOVERNED');
  if (runMode !== 'MANUAL_REPLAY' && manifest.selection !== 'BUILD_A1') fail('SCHEDULED_A1_BUILD_REQUIRED');
  let request, buildIdentity = null;
  if (manifest.selection === 'BUILD_A1') {
    if (manifest.requests != null) fail('INPUT_AMBIGUOUS');
    const built = buildCurrentAcceptance({ manifest, dataRoot, evidenceRoot, calendarPath, calendarBytes,
      manifestPath, tradeDate, checkpointType, now });
    request = built.request;
    buildIdentity = built.identity;
  } else if (manifest.selection === 'DATED_A1_PAIR') {
    if (manifest.requests != null) fail('INPUT_AMBIGUOUS');
    // Existing A.1 CLI's fixed dated pair, not latest.json. Each read is bounded;
    // A.2a replays and compares all A.1 pure fields before accepting the pair.
    // No publication time, data acquisition, or second registry is introduced.
    const reportFile = `${tradeDate}.json`, inputsFile = `${tradeDate}.inputs.json`;
    const reportBytes = readBoundedFile(path.join(evidenceRoot, reportFile));
    const inputsBytes = readBoundedFile(path.join(evidenceRoot, inputsFile));
    request = { tradeDate, checkpointType, inputGeneratedAt: JSON.parse(reportBytes.toString('utf8')).generatedAt,
      report: { file: reportFile, sha256: sha256(reportBytes) }, acceptanceInputs: { file: inputsFile, sha256: sha256(inputsBytes) } };
  } else {
    if (manifest.selection && manifest.selection !== 'PINNED_REQUESTS') fail('INDEX_SELECTION_INVALID');
    if (!Array.isArray(manifest.requests) || manifest.requests.length > 366 * 3) fail('INDEX_INVALID');
    const matches = manifest.requests.filter(r => r.tradeDate === tradeDate && r.checkpointType === checkpointType);
    if (matches.length !== 1) fail(matches.length ? 'INPUT_AMBIGUOUS' : 'A1_INPUT_NOT_REGISTERED');
    request = matches[0];
  }
  const report = pinned(evidenceRoot, request.report);
  const replay = pinned(evidenceRoot, request.acceptanceInputs);
  const due = request.dueRules ? pinned(evidenceRoot, request.dueRules) : null;
  const inputs = replay.json.inputs || replay.json;
  if (report.json.tradeDate !== tradeDate || inputs.tradeDate !== tradeDate
    || report.json.marketDayState !== day.state || report.json.generatedAt !== request.inputGeneratedAt
    || inputs.generatedAt !== report.json.generatedAt || !Number.isFinite(Date.parse(request.inputGeneratedAt))
    || Date.parse(request.inputGeneratedAt) > now.getTime()
    || (report.json.checkpointType && report.json.checkpointType !== checkpointType)) fail('INPUT_IDENTITY_MISMATCH');
  return { inputPath: report.file, inputBytes: report.bytes, acceptanceInputs: inputs,
    calendarJson: calendarBytes.toString('utf8'), dueRules: due?.json || {},
    inputPaths: [manifestPath, calendarPath, report.file, replay.file, ...(due ? [due.file] : [])],
    inputResolutionIdentity: { manifestSha256: sha256(manifestBytes), selection: manifest.selection || 'PINNED_REQUESTS',
      reportSha256: sha256(report.bytes), acceptanceInputsFileSha256: sha256(replay.bytes), dueRulesSha256: due ? sha256(due.bytes) : null,
      ...(buildIdentity ? { a1Build: buildIdentity } : {}) } };
}

// Runs inside A.2a's existing single-writer/failure lifecycle. Every invocation
// gets a new A.1 directory; subsequent checkpoints cannot replace its input pair.
function buildCurrentAcceptance({ manifest, dataRoot, evidenceRoot, calendarPath, calendarBytes,
  manifestPath, tradeDate, checkpointType, now }) {
  const binding = manifest.sourceBindings;
  const allowed = ['activeAppRoot', 'ledgerDataRoot', 'registryPath', 'registrySha256', 'dailyStatusPath',
    'databasePath', 'batchEvidencePath', 'derivedArtifactPaths', 'sessionsByCheckpoint'];
  if (!binding || Object.keys(binding).some(key => !allowed.includes(key))) fail('A1_BINDING_INVALID');
  for (const key of ['ledgerDataRoot', 'registryPath', 'dailyStatusPath']) {
    if (!path.isAbsolute(binding[key] || '')) fail('A1_BINDING_PATH_REQUIRED');
  }
  const derived = binding.derivedArtifactPaths;
  if (!Array.isArray(derived) || derived.length > 32) fail('A1_BINDING_INVALID');
  noLinks(binding.ledgerDataRoot);
  const sources = [path.join(binding.ledgerDataRoot, 'live-events'), binding.registryPath, binding.dailyStatusPath,
    binding.databasePath, binding.batchEvidencePath, ...derived].filter(value => value != null);
  for (const file of sources) {
    if (typeof file !== 'string' || !path.isAbsolute(file) || file.includes('|')) fail('A1_BINDING_INVALID');
    noLinks(file);
    if (contained(evidenceRoot, file) || contained(file, evidenceRoot)) fail('A1_OUTPUT_SOURCE_COLLISION');
  }
  if (binding.databasePath && binding.batchEvidencePath) fail('A1_BINDING_AMBIGUOUS');
  const registryBytes = readBoundedFile(binding.registryPath);
  if (sha256(registryBytes) !== binding.registrySha256) fail('A1_REGISTRY_IDENTITY_MISMATCH');
  const sessions = binding.sessionsByCheckpoint?.[checkpointType];
  if (!Array.isArray(sessions) || !sessions.length || sessions.length > 2
    || new Set(sessions).size !== sessions.length || sessions.some(s => !['DAY', 'NIGHT'].includes(s))) fail('A1_SESSIONS_REQUIRED');
  assertDailyAcceptanceOutputRoot(dataRoot, evidenceRoot, [manifestPath, calendarPath, ...sources]);
  noLinks(evidenceRoot);
  const buildId = crypto.randomUUID();
  const output = path.join(evidenceRoot, buildId);
  fs.mkdirSync(output, { recursive: true });
  // Pin the static governance bytes actually used by the child, not later reads.
  fs.writeFileSync(path.join(output, 'calendar.json'), calendarBytes, { flag: 'wx' });
  fs.writeFileSync(path.join(output, 'registry.json'), registryBytes, { flag: 'wx' });
  const args = [path.join(appRoot, 'scripts/build-daily-collection-acceptance.mjs'),
    `--trade-date=${tradeDate}`, `--generated-at=${now.toISOString()}`, `--sessions=${sessions.join(',')}`,
    `--data-root=${dataRoot}`, `--output-root=${output}`, `--ledger-data-root=${binding.ledgerDataRoot}`,
    `--calendar=${path.join(output, 'calendar.json')}`, `--registry=${path.join(output, 'registry.json')}`,
    `--daily-status=${binding.dailyStatusPath}`];
  if (binding.databasePath) args.push(`--database=${binding.databasePath}`);
  if (binding.batchEvidencePath) args.push(`--batch-evidence=${binding.batchEvidencePath}`);
  if (derived.length) args.push(`--derived-artifacts=${derived.join('|')}`);
  try {
    execFileSync(process.execPath, args, { cwd: appRoot, windowsHide: true, timeout: 10 * 60 * 1000,
      maxBuffer: 2 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] });
  } catch { fail('A1_BUILD_FAILED'); }
  const ref = name => ({ file: `${buildId}/${name}`, sha256: sha256(readBoundedFile(path.join(output, name))) });
  return { request: { tradeDate, checkpointType, inputGeneratedAt: now.toISOString(),
    report: ref(`${tradeDate}.json`), acceptanceInputs: ref(`${tradeDate}.inputs.json`), dueRules: manifest.dueRules },
    identity: { buildId, sourceBindingsSha256: sha256(JSON.stringify(binding)),
      calendarSha256: sha256(calendarBytes), registrySha256: sha256(registryBytes), sessions } };
}

export function runAcceptance(options) {
  validateAcceptanceLaunch(options);
  const { dataRoot, outputRoot, manifestPath, evidenceRoot, calendarPath, checkpointType,
    runMode = 'MANUAL_REPLAY', triggerIdentity = null } = options;
  if (!['MANUAL_REPLAY', 'CANDIDATE_SCHEDULER_TEST', 'SCHEDULED'].includes(runMode)) fail('RUN_MODE_INVALID');
  if (!dataRoot || !outputRoot || !manifestPath || !evidenceRoot || !calendarPath) fail('EXPLICIT_PATHS_REQUIRED');
  assertOperationsOutputRoot(dataRoot, outputRoot, [manifestPath, evidenceRoot, calendarPath]);
  const now = new Date();
  if (runMode === 'SCHEDULED' && options.tradeDate) fail('SCHEDULED_REPLAY_REJECTED');
  if (runMode !== 'MANUAL_REPLAY' && !/^[A-Za-z0-9_-]{1,120}$/.test(triggerIdentity || '')) fail('TRIGGER_IDENTITY_REQUIRED');
  // Reject pre-due Windows catch-up before the guarded writer or A.1 builder can
  // materialize an early high-rank checkpoint and pin today's latest.json.
  const scheduled = runMode === 'SCHEDULED' ? resolveScheduledCheckpointRequest(checkpointType, now) : null;
  const tradeDate = scheduled ? scheduled.tradeDate : options.tradeDate;
  const runtimeCommit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: appRoot, encoding: 'utf8', windowsHide: true }).trim();
  return runDailyDataOperations({ dataRoot, outputRoot, calendarPath, checkpointType, generatedAt: now.toISOString(),
    runContext: { runMode, triggerIdentity, runtimeCommit, requestedTradeDate: tradeDate,
      schedulerPolicySha256: scheduled?.policySha256 ?? null },
    resolveInput: () => {
      const binding = assertOperationsBindingLaunch(options);
      const input = resolveAcceptanceInput({ manifestPath, evidenceRoot, calendarPath, tradeDate, checkpointType, now, dataRoot, runMode });
      if (binding && input.inputResolutionIdentity.manifestSha256 !== binding.manifestSha256) fail('BINDING_CHANGED');
      return input;
    } });
}

export function validateAcceptanceLaunch(options) {
  for (const key of ['dataRoot', 'outputRoot', 'manifestPath', 'evidenceRoot', 'calendarPath']) {
    if (!options[key] || !path.isAbsolute(options[key])) fail('EXPLICIT_ABSOLUTE_PATHS_REQUIRED');
  }
  if (!CHECKPOINT_TYPES.includes(options.checkpointType)) fail('CHECKPOINT_INVALID');
  assertOperationsOutputRoot(options.dataRoot, options.outputRoot, [options.manifestPath, options.evidenceRoot, options.calendarPath]);
  assertOperationsBindingRoots(options);
  if (options.runMode === 'CANDIDATE_SCHEDULER_TEST' && path.resolve(options.dataRoot) !== path.join(appRoot, 'data')) fail('CANDIDATE_DATA_ROOT_INVALID');
  return { valid: true, runner: fileURLToPath(import.meta.url), outputRoot: options.outputRoot };
}

export function parseAcceptanceArgs(argv) {
  const keys = { 'data-root': 'dataRoot', 'output-root': 'outputRoot', manifest: 'manifestPath',
    'evidence-root': 'evidenceRoot', calendar: 'calendarPath', checkpoint: 'checkpointType',
    'trade-date': 'tradeDate', 'run-mode': 'runMode', 'trigger-identity': 'triggerIdentity', 'validate-only': 'validateOnly' };
  const options = {};
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !keys[match[1]] || Object.hasOwn(options, keys[match[1]])) fail('ARGUMENT_INVALID');
    options[keys[match[1]]] = match[2];
  }
  return options;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseAcceptanceArgs(process.argv.slice(2));
    if (args.validateOnly) {
      if (args.validateOnly !== 'true') fail('ARGUMENT_INVALID');
      console.log(JSON.stringify(validateAcceptanceLaunch(args)));
    } else {
    const result = runAcceptance(args);
    console.log(JSON.stringify({ tradeDate: result.assessment.tradeDate, checkpointType: result.assessment.checkpointType,
      overallState: result.assessment.overallState, reportHash: result.assessment.reportHash, jobHealth: result.jobHealth }));
    }
  } catch (err) {
    console.error(/^OPERATIONS_[A-Z0-9_]+$/.test(err.message) ? err.message : 'OPERATIONS_JOB_FAILED');
    // Only guard contention is retryable by the bounded Windows launcher.
    process.exitCode = err.message === 'OPERATIONS_OUTPUT_BUSY_OR_ABANDONED_GUARD' ? 75 : 1;
  }
}

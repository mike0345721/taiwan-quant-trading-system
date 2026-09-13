import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { buildDailyDataOperations, validateDailyDataOperations } from '../src/daily-data-operations.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { stableDailyAcceptanceJson } from '../src/daily-collection-acceptance.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fileHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
function contained(base, target) {
  const relative = path.relative(base, target);
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
function noLinks(target) {
  let cursor = path.resolve(target);
  while (true) {
    if (fs.existsSync(cursor)) {
      const stat = fs.lstatSync(cursor);
      if (stat.isSymbolicLink() || (stat.isFile() && stat.nlink > 1)) throw new Error('OPERATIONS_OUTPUT_LINK_REJECTED');
    } else {
      // existsSync is false for a dangling symlink.
      try { if (fs.lstatSync(cursor).isSymbolicLink()) throw new Error('OPERATIONS_OUTPUT_LINK_REJECTED'); }
      catch (err) { if (err.code !== 'ENOENT') throw err; }
    }
    const parent = path.dirname(cursor);
    if (parent === cursor) break;
    cursor = parent;
  }
}
export function assertOperationsOutputRoot(dataRoot, outputRoot, inputPaths = []) {
  const base = path.resolve(dataRoot, 'quality', 'daily-data-operations');
  const target = path.resolve(outputRoot);
  if (!contained(base, target)) throw new Error('OPERATIONS_OUTPUT_ROOT_NOT_GOVERNED');
  noLinks(target);
  // Outputs may never contain their own inputs, including through physical aliases.
  const physicalTarget = fs.existsSync(target) ? fs.realpathSync(target) : target;
  for (const input of inputPaths) {
    const resolved = fs.existsSync(input) ? fs.realpathSync(input) : path.resolve(input);
    if (contained(physicalTarget, resolved)) throw new Error('OPERATIONS_OUTPUT_INPUT_COLLISION');
  }
  return target;
}
function readJson(file) { return JSON.parse(fs.readFileSync(file, 'utf8')); }
function readOptional(file) { return fs.existsSync(file) ? readJson(file) : null; }
function safeFile(base, relative) {
  const target = path.resolve(base, relative);
  if (!contained(base, target)) throw new Error('OPERATIONS_OUTPUT_PATH_INVALID');
  noLinks(target);
  return target;
}
function immutable(base, relative, value) {
  const target = safeFile(base, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const bytes = stableDailyAcceptanceJson(value);
  try { fs.writeFileSync(target, bytes, { flag: 'wx' }); }
  catch (err) {
    if (err.code !== 'EEXIST') throw err;
    noLinks(target);
    if (fs.readFileSync(target, 'utf8') !== bytes) throw new Error('OPERATIONS_IMMUTABLE_HISTORY_CONFLICT');
  }
  return { file: relative.split(path.sep).join('/'), sha256: fileHash(bytes), reportHash: value.reportHash ?? null };
}
function materialize(base, relative, value) {
  const target = safeFile(base, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = `${target}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, stableDailyAcceptanceJson(value), { flag: 'wx' });
  try { noLinks(target); fs.renameSync(temporary, target); }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
}
function newer(report, previous) {
  if (!previous) return true;
  const left = `${report.tradeDate}|${report.generatedAt}`;
  const right = `${previous.tradeDate}|${previous.generatedAt}`;
  if (left === right && report.reportHash !== previous.reportHash) throw new Error('OPERATIONS_SAME_TIME_REVISION_CONFLICT');
  return left >= right;
}

// The returned job record describes actual local I/O, independently from data state.
// Immutable assessments are deterministic; actual run receipts intentionally are not.
export function readManualJobHealth(dataRoot, outputRoot) {
  const target = assertOperationsOutputRoot(dataRoot, outputRoot);
  return readOptional(safeFile(target, 'job-health.json')) || { schemaVersion: 'acceptance-job-health-v1', runMode: 'MANUAL_OFFLINE',
    jobState: 'NOT_RUN', lastAttemptAt: null, lastSuccessAt: null, lastFinalizedTradeDate: null, lastFinalizedAt: null,
    inputTradeDate: null, checkpointType: null, jobReason: 'NO_MANUAL_RUN_EVIDENCE', reportArtifactIdentity: null };
}
export function runDailyDataOperations(options = {}) {
  const args = { ...options, calendarPath: options.calendarPath || path.join(root, 'config', 'taifex-official-calendar-2026.json') };
  const target = assertOperationsOutputRoot(args.dataRoot, args.outputRoot, [args.inputPath, args.acceptanceInputsPath, args.dueRulesPath, args.calendarPath].filter(Boolean));
  fs.mkdirSync(target, { recursive: true });
  const guard = safeFile(target, '.manual-run.guard');
  const owner = crypto.randomUUID();
  try { fs.writeFileSync(guard, owner, { flag: 'wx' }); }
  catch (err) { if (err.code === 'EEXIST') throw new Error('OPERATIONS_OUTPUT_BUSY_OR_ABANDONED_GUARD'); throw err; }
  try { return executeManualRun(args); }
  finally {
    // Never take over or remove an unknown/stale owner's guard.
    noLinks(guard);
    if (fs.readFileSync(guard, 'utf8') === owner) fs.unlinkSync(guard);
  }
}
function executeManualRun({ inputPath, acceptanceInputsPath = null, dueRulesPath = null,
  checkpointType, generatedAt, dataRoot, outputRoot, calendarPath } = {}) {
  const inputs = [inputPath, acceptanceInputsPath, dueRulesPath, calendarPath].filter(Boolean).map(p => path.resolve(p));
  const target = assertOperationsOutputRoot(dataRoot, outputRoot, inputs);
  fs.mkdirSync(target, { recursive: true });
  const healthFile = safeFile(target, 'job-health.json');
  const previous = readOptional(healthFile);
  const attemptAt = new Date().toISOString();
  const runId = crypto.randomUUID();
  let inputTradeDate = null;
  const health = { schemaVersion: 'acceptance-job-health-v1', runMode: 'MANUAL_OFFLINE', jobState: 'RUNNING', runId,
    lastAttemptAt: attemptAt, lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastFinalizedTradeDate: previous?.lastFinalizedTradeDate ?? null, lastFinalizedAt: previous?.lastFinalizedAt ?? null,
    inputTradeDate, checkpointType, jobReason: 'MANUAL_INVOCATION_STARTED', reportArtifactIdentity: null };
  materialize(target, 'job-health.json', health);
  try {
    const bytes = fs.readFileSync(inputPath);
    const input = JSON.parse(bytes.toString('utf8'));
    loadGovernedTradingCalendar(calendarPath);
    const calendarJson = fs.readFileSync(calendarPath, 'utf8');
    inputTradeDate = input.tradeDate;
    const assessment = buildDailyDataOperations({ acceptanceReport: input,
      acceptanceInputs: acceptanceInputsPath ? readJson(acceptanceInputsPath) : null,
      dueRules: dueRulesPath ? readJson(dueRulesPath) : {}, checkpointType, generatedAt, calendarJson,
      inputArtifactIdentity: { file: path.basename(inputPath), sha256: fileHash(bytes), bytes: bytes.length } });
    validateDailyDataOperations(assessment);
    const kind = { DAY_CHECKPOINT: 'day', EOD_CHECKPOINT: 'eod', FINAL_TRADEDATE_CHECKPOINT: 'final' }[checkpointType];
    const revision = `${assessment.tradeDate}/${kind}/${assessment.reportHash}.json`;
    const identity = immutable(target, revision, assessment);
    // Only same-checkpoint pointers are materialized; latest points to actual run.
    const checkpointView = `${assessment.tradeDate}/${kind}.json`;
    if (newer(assessment, readOptional(safeFile(target, checkpointView)))) materialize(target, checkpointView, assessment);
    const latest = readOptional(safeFile(target, 'latest.json'));
    if (!latest || assessment.tradeDate > latest.tradeDate || (assessment.tradeDate === latest.tradeDate
      && (assessment.generatedAt > latest.generatedAt || (assessment.generatedAt === latest.generatedAt
      && ['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT'].indexOf(checkpointType)
        >= ['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT'].indexOf(latest.checkpointType))))) {
      materialize(target, 'latest.json', assessment);
    }
    const completedAt = new Date().toISOString();
    const advancesFinal = assessment.finalizationEligible && (!health.lastFinalizedTradeDate || assessment.tradeDate >= health.lastFinalizedTradeDate);
    const success = { ...health, jobState: 'SUCCEEDED', inputTradeDate, lastSuccessAt: completedAt,
      lastFinalizedTradeDate: advancesFinal ? assessment.tradeDate : health.lastFinalizedTradeDate,
      lastFinalizedAt: advancesFinal ? completedAt : health.lastFinalizedAt,
      jobReason: 'ASSESSMENT_WRITTEN_AND_VALIDATED', reportArtifactIdentity: identity };
    materialize(target, 'job-health.json', success);
    immutable(target, `runs/${runId}.json`, success);
    return { assessment, jobHealth: success };
  } catch (err) {
    const failure = { ...health, jobState: 'FAILED', inputTradeDate, jobReason: err.message,
      failureClass: 'ACCEPTANCE_JOB_FAILURE_NOT_FEED_FAILURE' };
    try { immutable(target, `runs/${runId}.failed.json`, failure); }
    catch { /* Preserve original failure if the receipt sink is also broken. */ }
    try { materialize(target, 'job-health.json', failure); }
    catch { /* A broken health sink cannot attest the failure; CLI still exits nonzero. */ }
    throw err;
  }
}

function options(argv) {
  const values = {};
  const allowed = ['input', 'acceptance-inputs', 'due-rules', 'calendar', 'checkpoint', 'generated-at', 'data-root', 'output-root'];
  for (const arg of argv) {
    const match = /^--([^=]+)=(.+)$/.exec(arg);
    if (!match || !allowed.includes(match[1]) || Object.hasOwn(values, match[1])) throw new Error('OPERATIONS_ARGUMENT_INVALID');
    values[match[1]] = match[2];
  }
  for (const key of ['input', 'checkpoint', 'generated-at']) if (!values[key]) throw new Error(`OPERATIONS_ARGUMENT_REQUIRED:${key}`);
  return values;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = options(process.argv.slice(2));
    const dataRoot = path.resolve(args['data-root'] || path.join(root, 'data'));
    const result = runDailyDataOperations({ inputPath: args.input, acceptanceInputsPath: args['acceptance-inputs'],
      dueRulesPath: args['due-rules'], calendarPath: args.calendar, checkpointType: args.checkpoint, generatedAt: args['generated-at'], dataRoot,
      outputRoot: args['output-root'] || path.join(dataRoot, 'quality', 'daily-data-operations') });
    console.log(stableDailyAcceptanceJson({ tradeDate: result.assessment.tradeDate, checkpointType: result.assessment.checkpointType,
      reportHash: result.assessment.reportHash, overallState: result.assessment.overallState,
      finalizationState: result.assessment.finalizationState, jobHealth: result.jobHealth }));
  } catch (err) { console.error(err.message); process.exitCode = 1; }
}

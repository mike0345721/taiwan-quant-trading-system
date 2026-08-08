import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const STATUS_VALUES = new Set(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED']);

export function sha256Buffer(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function sha256File(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    while (true) {
      const bytes = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!bytes) break;
      hash.update(buffer.subarray(0, bytes));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

export function atomicWriteFile(filePath, content, {
  validate = null,
  overwrite = true,
} = {}) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  if (!overwrite && fs.existsSync(filePath)) throw new Error(`atomic_target_exists:${filePath}`);
  const temporary = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    fs.writeFileSync(temporary, content);
    if (validate) validate(temporary);
    fs.renameSync(temporary, filePath);
  } catch (error) {
    fs.rmSync(temporary, { force: true });
    throw error;
  }
}

export function atomicWriteJson(filePath, value, options = {}) {
  atomicWriteFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    ...options,
    validate: (temporary) => {
      JSON.parse(fs.readFileSync(temporary, 'utf8'));
      options.validate?.(temporary);
    },
  });
}

function csvCell(value) {
  if (value == null) return '';
  const text = Array.isArray(value) ? value.join('|') : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function toCsv(rows, columns) {
  return `${[
    columns.join(','),
    ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(',')),
  ].join('\n')}\n`;
}

export function jobKey(job) {
  return [
    job.stage,
    job.factorId || '_',
    job.targetId || '_',
    job.foldId || '_',
    job.modelId || '_',
    job.jobId || '_',
  ].join('::');
}

function normalizeJob(job) {
  const normalized = {
    jobId: job.jobId,
    stage: job.stage,
    factorId: job.factorId || null,
    targetId: job.targetId || null,
    foldId: job.foldId || null,
    modelId: job.modelId || null,
    round: job.round || 'PREPARE',
    heavy: Boolean(job.heavy),
    status: job.status || 'PENDING',
    attempts: Number(job.attempts || 0),
    recoveryCount: Number(job.recoveryCount || 0),
    startedAt: job.startedAt || null,
    completedAt: job.completedAt || null,
    failedAt: job.failedAt || null,
    error: job.error || null,
    outputPath: job.outputPath || null,
    outputHash: job.outputHash || null,
    inputHash: job.inputHash || null,
  };
  if (!normalized.jobId || !normalized.stage) throw new Error('job_id_and_stage_required');
  if (!STATUS_VALUES.has(normalized.status)) throw new Error(`invalid_job_status:${normalized.status}`);
  normalized.key = jobKey(normalized);
  return normalized;
}

function statusPath(runDir) {
  return path.join(runDir, 'RUN_STATUS.json');
}

function lockPath(runDir) {
  return path.join(runDir, '.RUNNING.lock');
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireLock(runDir) {
  fs.mkdirSync(runDir, { recursive: true });
  const target = lockPath(runDir);
  if (fs.existsSync(target)) {
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(target, 'utf8')); } catch {}
    if (isProcessAlive(Number(previous?.pid))) {
      throw new Error(`run_locked_by_live_process:${previous.pid}`);
    }
    fs.renameSync(target, `${target}.stale.${Date.now()}`);
  }
  const fd = fs.openSync(target, 'wx');
  fs.writeFileSync(fd, `${JSON.stringify({
    pid: process.pid,
    acquiredAt: new Date().toISOString(),
  }, null, 2)}\n`);
  fs.closeSync(fd);
  return () => fs.rmSync(target, { force: true });
}

function validateFingerprintFile(label, filePath, expectedHash) {
  if (!filePath || !expectedHash) throw new Error(`immutable_fingerprint_missing:${label}`);
  if (!fs.existsSync(filePath)) throw new Error(`immutable_file_missing:${label}:${filePath}`);
  const actual = sha256File(filePath);
  if (actual !== expectedHash) throw new Error(`immutable_hash_mismatch:${label}`);
}

export function verifyImmutableContext(status) {
  const immutable = status.immutable || {};
  validateFingerprintFile('spec', immutable.specPath, immutable.specHash);
  validateFingerprintFile('target_spec', immutable.targetSpecPath, immutable.targetSpecHash);
  validateFingerprintFile('feature_spec', immutable.featureSpecPath, immutable.featureSpecHash);
  if (immutable.snapshotHash) {
    validateFingerprintFile('snapshot', immutable.snapshotPath, immutable.snapshotHash);
  } else {
    validateFingerprintFile('source_db', immutable.sourceDbPath, immutable.sourceDbHash);
  }
  if (!immutable.codeManifestHash) throw new Error('code_manifest_hash_missing');
  return true;
}

export function createRunStatus({
  runId,
  immutable,
  jobs,
  command,
}) {
  const normalized = jobs.map(normalizeJob);
  const keys = new Set();
  for (const job of normalized) {
    if (keys.has(job.key)) throw new Error(`duplicate_job_key:${job.key}`);
    keys.add(job.key);
  }
  return {
    schemaVersion: 'restartable-research-run-v1',
    runId,
    state: 'PREPARED',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    command,
    immutable,
    safeguards: {
      researchOnly: true,
      formalWeight: 0,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    },
    jobs: normalized,
    events: [],
  };
}

export function loadRunStatus(runDir) {
  const target = statusPath(runDir);
  if (!fs.existsSync(target)) throw new Error(`run_status_missing:${target}`);
  const status = JSON.parse(fs.readFileSync(target, 'utf8'));
  for (const job of status.jobs || []) {
    if (!STATUS_VALUES.has(job.status)) throw new Error(`invalid_job_status:${job.status}`);
  }
  return status;
}

function summarize(status) {
  const counts = { PENDING: 0, RUNNING: 0, COMPLETED: 0, FAILED: 0 };
  for (const job of status.jobs) counts[job.status] += 1;
  return counts;
}

export function writeRunViews(runDir, status) {
  status.updatedAt = new Date().toISOString();
  const counts = summarize(status);
  status.counts = counts;
  status.state = status.blocked ? 'BLOCKED'
    : counts.RUNNING ? 'RUNNING'
    : counts.FAILED ? 'HAS_FAILURES'
      : counts.PENDING ? 'READY_TO_RESUME'
        : 'COMPLETED';
  atomicWriteJson(statusPath(runDir), status);

  const columns = [
    'key', 'jobId', 'stage', 'round', 'factorId', 'targetId', 'foldId', 'modelId',
    'status', 'attempts', 'recoveryCount', 'startedAt', 'completedAt', 'failedAt',
    'outputPath', 'outputHash', 'inputHash', 'error',
  ];
  atomicWriteFile(
    path.join(runDir, 'COMPLETED_JOBS.csv'),
    toCsv(status.jobs.filter((job) => job.status === 'COMPLETED'), columns),
  );
  atomicWriteFile(
    path.join(runDir, 'FAILED_JOBS.csv'),
    toCsv(status.jobs.filter((job) => job.status === 'FAILED'), columns),
  );

  const next = status.jobs.find((job) => job.status === 'PENDING' || job.status === 'FAILED');
  atomicWriteFile(
    path.join(runDir, 'NEXT_RESUME_COMMAND.txt'),
    next
      ? `node scripts/run-full-historical-phase-a.mjs --run-dir "${runDir}" --resume --full-approved\n`
      : `# No pending or failed jobs. Reports can be rebuilt without rerunning models.\nnode scripts/run-full-historical-phase-a.mjs --run-dir "${runDir}" --rebuild-reports\n`,
  );
}

function stageJobs(status, stage) {
  return status.jobs.filter((job) => job.stage === stage);
}

function dependencyComplete(status, dependency) {
  if (dependency === 'TARGET_SPEC') {
    validateFingerprintFile(
      'target_spec',
      status.immutable?.targetSpecPath,
      status.immutable?.targetSpecHash,
    );
    return true;
  }
  const jobs = stageJobs(status, dependency);
  return jobs.length > 0 && jobs.every((job) => job.status === 'COMPLETED');
}

export function preflightRun({
  status,
  handlers,
  dag = null,
  requiredStages = null,
  stage = null,
}) {
  verifyImmutableContext(status);
  const approved = new Set(requiredStages || Object.keys(handlers));
  const pending = status.jobs.filter((job) => (
    ['PENDING', 'FAILED', 'RUNNING'].includes(job.status)
    && (!stage || job.stage === stage)
  ));
  const issues = [];

  for (const job of pending) {
    if (!approved.has(job.stage)) issues.push(`stage_not_in_approved_dag:${job.stage}`);
    if (typeof handlers[job.stage] !== 'function') issues.push(`pending_stage_missing_handler:${job.stage}`);
    if (dag && !Object.hasOwn(dag, job.stage)) issues.push(`stage_dependency_definition_missing:${job.stage}`);
  }

  if (dag) {
    for (const [stageId, dependencies] of Object.entries(dag)) {
      if (!approved.has(stageId)) issues.push(`dag_stage_not_approved:${stageId}`);
      for (const dependency of dependencies) {
        if (dependency !== 'TARGET_SPEC' && !stageJobs(status, dependency).length) {
          issues.push(`dag_dependency_stage_missing:${stageId}:${dependency}`);
        }
      }
    }
    const selectedStages = [...new Set(pending.map((job) => job.stage))];
    for (const stageId of selectedStages) {
      for (const dependency of dag[stageId] || []) {
        const dependencyIsAlsoPending = pending.some((job) => job.stage === dependency);
        if (!dependencyIsAlsoPending && !dependencyComplete(status, dependency)) {
          issues.push(`upstream_dependency_incomplete:${stageId}:${dependency}`);
        }
      }
    }
  }

  for (const job of status.jobs.filter((item) => item.status === 'COMPLETED')) {
    try {
      assertCompletedOutput(job);
    } catch (error) {
      issues.push(String(error?.message || error));
    }
  }
  const uniqueIssues = [...new Set(issues)].sort();
  return {
    ok: uniqueIssues.length === 0,
    runId: status.runId,
    pendingStages: [...new Set(pending.map((job) => job.stage))],
    completedJobs: status.jobs.filter((job) => job.status === 'COMPLETED').length,
    issues: uniqueIssues,
  };
}

export function initializeRun(runDir, status) {
  if (fs.existsSync(statusPath(runDir))) throw new Error(`run_already_initialized:${runDir}`);
  fs.mkdirSync(path.join(runDir, 'jobs'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'snapshot'), { recursive: true });
  fs.mkdirSync(path.join(runDir, 'reports'), { recursive: true });
  writeRunViews(runDir, status);
}

function recoverInterruptedJobs(status) {
  for (const job of status.jobs) {
    if (job.status !== 'RUNNING') continue;
    job.status = 'PENDING';
    job.recoveryCount += 1;
    job.error = 'recovered_from_interrupted_running_state';
    job.startedAt = null;
    status.events.push({
      type: 'job_recovered',
      jobKey: job.key,
      at: new Date().toISOString(),
    });
  }
}

function assertCompletedOutput(job) {
  if (!job.outputPath || !job.outputHash) throw new Error(`completed_job_metadata_missing:${job.key}`);
  if (!fs.existsSync(job.outputPath)) throw new Error(`completed_job_output_missing:${job.key}`);
  if (sha256File(job.outputPath) !== job.outputHash) {
    throw new Error(`completed_job_output_hash_mismatch:${job.key}`);
  }
}

export async function executeRun({
  runDir,
  handlers,
  resume = false,
  stage = null,
  injectFailureJobId = null,
  simulateCrashJobId = null,
  dag = null,
  requiredStages = null,
  outputValidators = {},
}) {
  const release = acquireLock(runDir);
  let intentionalCrash = false;
  try {
    const status = loadRunStatus(runDir);
    const preflight = preflightRun({ status, handlers, dag, requiredStages, stage });
    if (!preflight.ok) {
      status.blocked = {
        at: new Date().toISOString(),
        reasons: preflight.issues,
      };
      writeRunViews(runDir, status);
      throw new Error(`run_preflight_blocked:${preflight.issues.join('|')}`);
    }
    status.blocked = null;
    recoverInterruptedJobs(status);
    for (const job of status.jobs.filter((item) => item.status === 'COMPLETED')) {
      assertCompletedOutput(job);
    }
    writeRunViews(runDir, status);

    const eligibleStatuses = resume ? new Set(['PENDING', 'FAILED']) : new Set(['PENDING']);
    const selected = status.jobs.filter((job) => (
      eligibleStatuses.has(job.status) && (!stage || job.stage === stage)
    ));

    for (const job of selected) {
      const handler = handlers[job.stage];
      if (!handler) {
        job.status = 'FAILED';
        job.failedAt = new Date().toISOString();
        job.error = `pending_stage_missing_handler:${job.stage}`;
        writeRunViews(runDir, status);
        throw new Error(job.error);
      }
      for (const dependency of dag?.[job.stage] || []) {
        if (!dependencyComplete(status, dependency)) {
          job.status = 'FAILED';
          job.failedAt = new Date().toISOString();
          job.error = `upstream_dependency_incomplete:${job.stage}:${dependency}`;
          writeRunViews(runDir, status);
          throw new Error(job.error);
        }
      }
      job.status = 'RUNNING';
      job.attempts += 1;
      job.startedAt = new Date().toISOString();
      job.failedAt = null;
      job.error = null;
      writeRunViews(runDir, status);

      if (simulateCrashJobId === job.jobId && job.attempts === 1) {
        intentionalCrash = true;
        process.exitCode = 86;
        return { status, intentionalCrash: true };
      }

      try {
        if (injectFailureJobId === job.jobId && job.attempts === 1) {
          throw new Error('injected_smoke_failure');
        }
        const result = await handler({ job, status, runDir });
        if (!result?.outputPath || !fs.existsSync(result.outputPath)) {
          throw new Error(`job_output_missing_after_handler:${job.key}`);
        }
        if (typeof outputValidators[job.stage] === 'function') {
          outputValidators[job.stage](result.outputPath, { job, status, runDir });
        }
        job.outputPath = result.outputPath;
        job.outputHash = sha256File(result.outputPath);
        job.inputHash = result.inputHash || null;
        if (result.contextPatch) Object.assign(status.immutable, result.contextPatch);
        job.status = 'COMPLETED';
        job.completedAt = new Date().toISOString();
        job.error = null;
      } catch (error) {
        job.status = 'FAILED';
        job.failedAt = new Date().toISOString();
        job.error = String(error?.stack || error);
        writeRunViews(runDir, status);
        throw error;
      }
      writeRunViews(runDir, status);
    }
    const required = requiredStages || [];
    const allRequiredCompleted = required.every((stageId) => {
      const jobs = stageJobs(status, stageId);
      return jobs.length > 0 && jobs.every((job) => job.status === 'COMPLETED');
    });
    if (allRequiredCompleted && status.jobs.every((job) => job.status === 'COMPLETED')) {
      for (const job of status.jobs) assertCompletedOutput(job);
      status.phaseAState = 'PHASE_A_COMPLETED';
      writeRunViews(runDir, status);
    }
    return { status, intentionalCrash: false };
  } finally {
    if (!intentionalCrash) release();
  }
}

export function rebuildReportsFromCompleted(runDir) {
  const status = loadRunStatus(runDir);
  verifyImmutableContext(status);
  for (const job of status.jobs.filter((item) => item.status === 'COMPLETED')) {
    assertCompletedOutput(job);
  }
  const report = {
    schemaVersion: 'phase-a-artifact-aggregate-v1',
    runId: status.runId,
    rebuiltAt: new Date().toISOString(),
    completedJobs: status.jobs
      .filter((job) => job.status === 'COMPLETED')
      .map((job) => ({
        key: job.key,
        outputPath: job.outputPath,
        outputHash: job.outputHash,
      })),
    failedJobs: status.jobs
      .filter((job) => job.status === 'FAILED')
      .map((job) => ({ key: job.key, error: job.error })),
    reranModels: false,
    safeguards: status.safeguards,
  };
  const outputPath = path.join(runDir, 'reports', 'ARTIFACT_AGGREGATE.json');
  atomicWriteJson(outputPath, report);
  return outputPath;
}

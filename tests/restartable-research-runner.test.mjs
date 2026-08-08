import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  atomicWriteFile,
  createRunStatus,
  executeRun,
  initializeRun,
  loadRunStatus,
  preflightRun,
  rebuildReportsFromCompleted,
  sha256File,
  verifyImmutableContext,
} from "../src/restartable-research-runner.mjs";

function createFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "phase-a-resume-"));
  const runDir = path.join(root, "run");
  fs.mkdirSync(runDir, { recursive: true });

  const files = {
    snapshot: path.join(root, "snapshot.sqlite"),
    spec: path.join(root, "research-spec.md"),
    target: path.join(root, "target-spec.json"),
    feature: path.join(root, "feature-spec.json"),
  };
  for (const [key, filePath] of Object.entries(files)) {
    fs.writeFileSync(filePath, `${key}-v1\n`, "utf8");
  }

  const immutable = {
    snapshotPath: files.snapshot,
    snapshotHash: sha256File(files.snapshot),
    specPath: files.spec,
    specHash: sha256File(files.spec),
    targetSpecPath: files.target,
    targetSpecHash: sha256File(files.target),
    featureSpecPath: files.feature,
    featureSpecHash: sha256File(files.feature),
    gitCommit: null,
    gitStatus: "unavailable_test_fixture",
    codeManifestHash: "fixture-code-hash",
    featureVersion: "phase-a-v1",
    randomSeed: 3102026,
  };

  const jobs = [
    {
      jobId: "job_complete",
      stage: "A04",
      factorId: "CASH_FOREIGN_NET",
      targetId: "NEXT_DAY_DIRECTION",
      foldId: "SMOKE_FOLD",
      modelId: "DESCRIPTIVE",
    },
    {
      jobId: "job_fail_then_resume",
      stage: "A04",
      factorId: "FUTURES_FOREIGN_NET",
      targetId: "NEXT_DAY_DIRECTION",
      foldId: "SMOKE_FOLD",
      modelId: "DESCRIPTIVE",
    },
    {
      jobId: "job_interrupted",
      stage: "A04",
      factorId: "OPTIONS_PCR_OI",
      targetId: "NEXT_DAY_DIRECTION",
      foldId: "SMOKE_FOLD",
      modelId: "DESCRIPTIVE",
    },
  ];

  initializeRun(runDir, createRunStatus({
    runId: "fixture-run",
    immutable,
    jobs,
    command: "fixture",
  }));
  return { root, runDir, files, immutable };
}

function resultHandler(runDir) {
  return ({ job }) => {
    const outputPath = path.join(runDir, "artifacts", `${job.jobId}.json`);
    atomicWriteFile(
      outputPath,
      `${JSON.stringify({ jobId: job.jobId, deterministicValue: 42 }, null, 2)}\n`,
    );
    return { outputPath };
  };
}

function findJob(status, jobId) {
  const job = status.jobs.find((item) => item.jobId === jobId);
  assert.ok(job, `找不到工作：${jobId}`);
  return job;
}

test("FAILED 與中斷中的工作可續跑，已完成產物不覆寫", async () => {
  const fixture = createFixture();
  const handlers = { A04: resultHandler(fixture.runDir) };

  await assert.rejects(() => executeRun({
    runDir: fixture.runDir,
    handlers,
    stage: "A04",
    injectFailureJobId: "job_fail_then_resume",
  }), /injected_smoke_failure/);

  let status = loadRunStatus(fixture.runDir);
  assert.equal(findJob(status, "job_complete").status, "COMPLETED");
  assert.equal(findJob(status, "job_fail_then_resume").status, "FAILED");
  const completedPath = findJob(status, "job_complete").outputPath;
  const completedHash = sha256File(completedPath);
  const completedAttempts = findJob(status, "job_complete").attempts;

  findJob(status, "job_interrupted").status = "RUNNING";
  findJob(status, "job_interrupted").startedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(fixture.runDir, "RUN_STATUS.json"),
    `${JSON.stringify(status, null, 2)}\n`,
    "utf8",
  );

  await executeRun({
    runDir: fixture.runDir,
    handlers,
    stage: "A04",
    resume: true,
  });

  status = loadRunStatus(fixture.runDir);
  assert.equal(findJob(status, "job_complete").status, "COMPLETED");
  assert.equal(findJob(status, "job_complete").attempts, completedAttempts);
  assert.equal(sha256File(completedPath), completedHash);
  assert.equal(findJob(status, "job_fail_then_resume").status, "COMPLETED");
  assert.equal(findJob(status, "job_interrupted").status, "COMPLETED");
  assert.ok(findJob(status, "job_interrupted").recoveryCount >= 1);

  for (const required of [
    "RUN_STATUS.json",
    "COMPLETED_JOBS.csv",
    "FAILED_JOBS.csv",
    "NEXT_RESUME_COMMAND.txt",
  ]) {
    assert.equal(fs.existsSync(path.join(fixture.runDir, required)), true);
  }
});

test("PENDING Stage缺少Handler時Hard Failure，且不得靜默略過", async () => {
  const fixture = createFixture();
  const status = loadRunStatus(fixture.runDir);
  const preflight = preflightRun({
    status,
    handlers: {},
    requiredStages: ["A04"],
  });
  assert.equal(preflight.ok, false);
  assert.match(preflight.issues.join("\n"), /pending_stage_missing_handler:A04/);
  await assert.rejects(() => executeRun({
    runDir: fixture.runDir,
    handlers: {},
    requiredStages: ["A04"],
  }), /run_preflight_blocked/);
  assert.equal(loadRunStatus(fixture.runDir).state, "BLOCKED");
});

test("DAG上游未完成時阻擋下游", () => {
  const fixture = createFixture();
  const status = loadRunStatus(fixture.runDir);
  status.jobs.push({
    jobId: "downstream",
    stage: "A20",
    factorId: null,
    targetId: null,
    foldId: null,
    modelId: null,
    round: "ROUND_2",
    heavy: true,
    status: "PENDING",
    attempts: 0,
    recoveryCount: 0,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    error: null,
    outputPath: null,
    outputHash: null,
    inputHash: null,
    key: "A20::_::_::_::_::downstream",
  });
  const result = preflightRun({
    status,
    handlers: { A04: () => {}, A20: () => {} },
    dag: { A20: ["A04"] },
    requiredStages: ["A04", "A20"],
    stage: "A20",
  });
  assert.equal(result.ok, false);
  assert.match(result.issues.join("\n"), /upstream_dependency_incomplete:A20:A04/);
});

test("Snapshot 或 Spec Hash 改變時必須停止", () => {
  const fixture = createFixture();
  fs.appendFileSync(fixture.files.spec, "changed\n", "utf8");
  assert.throws(
    () => verifyImmutableContext(loadRunStatus(fixture.runDir)),
    /immutable|hash|不一致/i,
  );
});

test("彙總報告只讀取既有完成產物，不重跑模型", async () => {
  const fixture = createFixture();
  let handlerCalls = 0;
  await executeRun({
    runDir: fixture.runDir,
    handlers: {
      A04: ({ job }) => {
        handlerCalls += 1;
        return resultHandler(fixture.runDir)({ job });
      },
    },
    stage: "A04",
  });
  assert.equal(handlerCalls, 3);

  const reportPath = rebuildReportsFromCompleted(fixture.runDir);
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  assert.equal(handlerCalls, 3);
  assert.equal(report.reranModels, false);
  assert.equal(report.completedJobs.length, 3);
  assert.equal(fs.existsSync(reportPath), true);
});

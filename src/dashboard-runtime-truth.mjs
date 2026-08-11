import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  validateOwnerLaunchApprovalArtifact,
  validateReadyForLaunchManifest,
} from './market-state-forward-shadow.mjs';

const execFileAsync = promisify(execFile);
const STATE_TASK = 'TwChipDashboard-MarketStateForwardShadow-State';
const OUTCOME_TASK = 'TwChipDashboard-MarketStateForwardShadow-Outcome';

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
function candidateRoots(baseRoot, explicitRoot) {
  if (explicitRoot) return [explicitRoot];
  if (!fs.existsSync(baseRoot)) return [];
  return fs.readdirSync(baseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseRoot, entry.name));
}

function validatedRuntime(root) {
  const manifestPath = path.join(root, 'launch-manifest.json');
  const approvalPaths = [
    path.join(root, 'owner-recovery-approval.json'),
    path.join(root, 'owner-launch-approval.json'),
  ];
  const approvalPath = approvalPaths.find((candidate) => fs.existsSync(candidate));
  if (!fs.existsSync(manifestPath) || !approvalPath) return null;
  try {
    const manifest = readJson(manifestPath);
    const approval = readJson(approvalPath);
    validateReadyForLaunchManifest(manifest);
    validateOwnerLaunchApprovalArtifact(approval, manifest);
    return { root, manifestPath, approvalPath, manifest, approval };
  } catch {
    return null;
  }
}

async function queryTask(taskName) {
  if (process.platform !== 'win32') return { exists: false, enabled: false, reason: 'WINDOWS_TASK_QUERY_UNAVAILABLE' };
  const script = [
    `$task = Get-ScheduledTask -TaskName '${taskName}' -ErrorAction Stop`,
    `$info = Get-ScheduledTaskInfo -TaskName '${taskName}' -ErrorAction Stop`,
    `[pscustomobject]@{ exists=$true; enabled=($task.State -ne 'Disabled'); state=[string]$task.State; nextRun=$info.NextRunTime.ToString('o'); user=$task.Principal.UserId } | ConvertTo-Json -Compress`,
  ].join('; ');
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      timeout: 4_000,
      maxBuffer: 64 * 1024,
    });
    return JSON.parse(stdout.trim());
  } catch {
    return { exists: false, enabled: false, reason: 'WINDOWS_TASK_NOT_FOUND_OR_UNREADABLE' };
  }
}

function latestStateRecord(runtimeRoot) {
  const ledgerPath = path.join(runtimeRoot, 'official-ledger.ndjson');
  if (!fs.existsSync(ledgerPath)) return null;
  try {
    const rows = fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
    return rows.filter((row) => ['STATE', 'SESSION_STATUS'].includes(row.recordType)).at(-1) || null;
  } catch {
    return null;
  }
}

export async function readDashboardRuntimeTruth({ baseRoot, explicitRoot = null, now = new Date(), taskQuery = queryTask } = {}) {
  const validated = candidateRoots(baseRoot, explicitRoot).map(validatedRuntime).filter(Boolean)
    .sort((left, right) => Date.parse(right.approval.approvedAt) - Date.parse(left.approval.approvedAt));
  const selected = validated[0];
  if (!selected) {
    return Object.freeze({
      governed: false,
      checkedAt: now.toISOString(),
      reason: 'RUNTIME_STATUS_NOT_EXPOSED_TO_DASHBOARD',
      executionAuthorized: false,
    });
  }
  const [stateTask, outcomeTask] = await Promise.all([taskQuery(STATE_TASK), taskQuery(OUTCOME_TASK)]);
  return Object.freeze({
    governed: true,
    checkedAt: now.toISOString(),
    runId: selected.manifest.runId,
    runtimeRoot: selected.root,
    launchStatus: stateTask.enabled && outcomeTask.enabled ? 'SCHEDULED_RUNTIME_READY' : selected.manifest.launchStatus,
    officialStartTradeDate: selected.manifest.officialStartTradeDate,
    recoveryEffectiveTradeDate: selected.manifest.runtimeRecoveryBinding?.recoveryEffectiveTradeDate || null,
    finalMainCommit: selected.manifest.finalMainCommit,
    stateTask,
    outcomeTask,
    stateRecord: latestStateRecord(selected.root),
    lineage: {
      manifestPath: selected.manifestPath,
      manifestHash: selected.manifest.manifestHash,
      approvalPath: selected.approvalPath,
      approvalArtifactHash: selected.approval.approvalArtifactHash,
    },
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
}

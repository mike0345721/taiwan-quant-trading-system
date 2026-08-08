import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  auditForwardRegistry,
  classifyForwardAttempt,
  FORWARD_ATTEMPT_STATUS,
  readForwardRegistry,
} from '../src/v310-forward-operations.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const forwardDir = path.join(root, 'data', 'intraday', 'research', 'v3.10-wave3-forward');
const specPath = path.join(forwardDir, 'restricted-frozen-spec.json');
const modelsPath = path.join(forwardDir, 'restricted-frozen-models.json');
const registryPath = path.join(forwardDir, 'restricted-forward-registry.jsonl');
const outputPath = path.join(forwardDir, 'operations-acceptance.json');

const sha256 = (filePath) => crypto.createHash('sha256')
  .update(fs.readFileSync(filePath)).digest('hex');
const spec = JSON.parse(fs.readFileSync(specPath, 'utf8'));
const models = JSON.parse(fs.readFileSync(modelsPath, 'utf8'));
const records = readForwardRegistry(registryPath);
const registryAudit = auditForwardRegistry(records);
const frozenRecord = records.find((record) => record.eventType === 'models_frozen');
const specSha256 = sha256(specPath);
const modelsSha256 = sha256(modelsPath);
const days = [...new Set(records.map((record) => record.tradeDate).filter(Boolean))].sort()
  .map((tradeDate) => {
    const selected = records.filter((record) => record.tradeDate === tradeDate);
    const rejectionRecords = selected.filter((record) => record.eventType === 'day_rejected');
    const accepted = selected.some((record) => record.eventType === 'forward_day_accepted');
    const latestRejection = rejectionRecords.at(-1);
    return {
      tradeDate,
      predictions: selected.filter((record) => record.eventType === 'prediction').length,
      outcomes: selected.filter((record) => record.eventType === 'outcome').length,
      accepted,
      attemptStatus: accepted
        ? FORWARD_ATTEMPT_STATUS.ACCEPTED
        : latestRejection?.attemptStatus ?? (latestRejection
          ? classifyForwardAttempt({
            reason: latestRejection.reason,
            details: latestRejection,
          })
          : null),
      rejectionReasons: rejectionRecords.map((record) => record.reason),
    };
  });
const completedDays = days.filter(
  (day) => day.accepted && day.predictions === 12 && day.outcomes === 12,
);
const checks = {
  registryHashChain: registryAudit.ok,
  frozenSpecHash: frozenRecord?.frozenSpecSha256 === specSha256
    && models.frozenSpecSha256 === specSha256,
  frozenModelsHash: frozenRecord?.frozenModelsSha256 === modelsSha256,
  modelCount: models.models.length === 12,
  completedForwardDay: completedDays.length >= 1,
  earliestEligibleDate: completedDays.every(
    (day) => day.tradeDate >= spec.earliestEligibleTradeDate,
  ),
  formalWeightUnchanged: records.filter((record) => record.formalModelWeight != null)
    .every((record) => Number(record.formalModelWeight) === 0),
  executionBoundary: records.every((record) => record.executionAuthorized === false)
    && spec.executionAuthorized === false
    && models.executionAuthorized === false,
};
const hardFailure = !checks.registryHashChain || !checks.frozenSpecHash
  || !checks.frozenModelsHash || !checks.modelCount
  || !checks.formalWeightUnchanged || !checks.executionBoundary;
const status = hardFailure ? 'FAIL' : checks.completedForwardDay ? 'PASS' : 'PENDING';
const attemptedDays = days.filter((day) => day.attemptStatus !== null);
const latestAttempt = attemptedDays.at(-1) ?? null;
const report = {
  schemaVersion: 'v3.10-forward-operations-acceptance-v1',
  attemptSchemaVersion: 'v3.10-forward-attempt-status-v1',
  generatedAt: new Date().toISOString(),
  status,
  overallGateStatus: status,
  attemptStatus: hardFailure
    ? FORWARD_ATTEMPT_STATUS.CORE_FAILURE
    : latestAttempt?.attemptStatus ?? null,
  latestAttempt,
  passed: status === 'PASS',
  checks,
  frozenSpecSha256: specSha256,
  frozenModelsSha256: modelsSha256,
  registryAudit,
  firstCompletedForwardDay: completedDays[0] ?? null,
  days,
  formalModelWeight: 0,
  promotionAuthorized: false,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
};
const temporary = `${outputPath}.${process.pid}.tmp`;
fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
});
fs.renameSync(temporary, outputPath);
console.log(JSON.stringify(report, null, 2));
if (status === 'FAIL') process.exitCode = 1;

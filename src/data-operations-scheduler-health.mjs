import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readBoundedFile, sha256, assertOperationsOutputRoot } from './daily-data-operations-files.mjs';
import { loadGovernedTradingCalendar, resolveGovernedTradingDay } from './market-state-forward-shadow-calendar.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const kinds = ['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT'];
export const schedulerPolicyPath = path.join(root, 'config/data-operations-scheduler-policy-v1.json');
export function loadSchedulerPolicy() {
  const bytes = readBoundedFile(schedulerPolicyPath, 16384);
  const p = JSON.parse(bytes);
  if (p.schemaVersion !== 'data-operations-scheduler-policy-v1' || !p.policyId
    || p.timezone !== 'Asia/Taipei' || p.windowsTimezone !== 'Taipei Standard Time'
    || !Number.isInteger(p.graceMinutes) || p.graceMinutes < 0 || p.graceMinutes > 60
    || !/^[A-Za-z0-9-]+$/.test(p.taskPrefix) || p.checkpoints?.length !== 3
    || p.checkpoints.some((c, i) => c.checkpointType !== kinds[i] || !/^[A-Z]+$/.test(c.label)
      || !/^([01]\d|2[0-3]):[0-5]\d$/.test(c.checkTime)
      || (i > 0 && c.checkTime <= p.checkpoints[i - 1].checkTime))) throw new Error('OPERATIONS_SCHEDULER_POLICY_INVALID');
  return { ...p, sha256: sha256(bytes) };
}
export function schedulerDate(now) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function definition(policy, checkpointType) {
  const c = policy.checkpoints.find(c => c.checkpointType === checkpointType);
  if (!c) throw new Error('OPERATIONS_SCHEDULER_CHECKPOINT_INVALID');
  return c;
}
function indexFile(tradeDate, checkpointType, policy) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate || '')) throw new Error('OPERATIONS_SCHEDULER_DATE_INVALID');
  return `automatic-checkpoints/${tradeDate}/${definition(policy, checkpointType).label.toLowerCase()}.json`;
}
function validIdentity(h, date, checkpoint, policy) {
  const c = definition(policy, checkpoint);
  return h?.schemaVersion === 'acceptance-job-health-v1' && h.runMode === 'SCHEDULED'
    && h.requestedTradeDate === date && h.checkpointType === checkpoint
    && h.schedulerPolicySha256 === policy.sha256 && h.triggerIdentity === `${policy.taskPrefix}-${c.label}`
    && /^[a-f0-9-]{36}$/.test(h.runId || '') && /^[a-f0-9]{40}$/.test(h.runtimeCommit || '')
    && Number.isFinite(Date.parse(h.lastAttemptAt)) && schedulerDate(new Date(h.lastAttemptAt)) === date
    && ['SUCCEEDED', 'FAILED'].includes(h.jobState)
    && (h.jobState === 'FAILED' || (h.inputTradeDate === date && Number.isFinite(Date.parse(h.lastSuccessAt))));
}
function readPointer(outputRoot, pointer, date, checkpoint, policy) {
  if (!pointer || !/^[a-f0-9-]{36}$/.test(pointer.runId || '') || !['SUCCEEDED', 'FAILED'].includes(pointer.jobState)
    || !/^[a-f0-9]{64}$/.test(pointer.sha256 || '')) throw new Error('OPERATIONS_SCHEDULER_POINTER_INVALID');
  const file = `runs/${pointer.runId}${pointer.jobState === 'FAILED' ? '.failed' : ''}.json`;
  const bytes = readBoundedFile(path.join(outputRoot, file), 65536);
  const receipt = JSON.parse(bytes);
  if (sha256(bytes) !== pointer.sha256 || receipt.runId !== pointer.runId || receipt.jobState !== pointer.jobState
    || !validIdentity(receipt, date, checkpoint, policy)) throw new Error('OPERATIONS_SCHEDULER_RECEIPT_INVALID');
  return receipt;
}
function readIndex(outputRoot, date, checkpoint, policy) {
  const file = path.join(outputRoot, indexFile(date, checkpoint, policy));
  if (!fs.existsSync(file)) return null;
  const index = JSON.parse(readBoundedFile(file, 16384));
  if (index.schemaVersion !== 'automatic-checkpoint-index-v1' || index.tradeDate !== date
    || index.checkpointType !== checkpoint || index.policySha256 !== policy.sha256) throw new Error('OPERATIONS_SCHEDULER_INDEX_INVALID');
  const latest = readPointer(outputRoot, index.latest, date, checkpoint, policy);
  const success = index.lastSuccess ? readPointer(outputRoot, index.lastSuccess, date, checkpoint, policy) : null;
  if (success && success.jobState !== 'SUCCEEDED') throw new Error('OPERATIONS_SCHEDULER_SUCCESS_INVALID');
  return { index, latest, success };
}
// Called only inside the existing A.2a output guard, AFTER immutable receipt creation.
// Each fixed date/checkpoint file has at most two bounded receipt references; no scan.
export function recordAutomaticCheckpoint({ outputRoot, receipt, identity, materialize }) {
  if (receipt.runMode !== 'SCHEDULED') return;
  const policy = loadSchedulerPolicy(), date = receipt.requestedTradeDate, checkpoint = receipt.checkpointType;
  if (!validIdentity(receipt, date, checkpoint, policy)) throw new Error('OPERATIONS_SCHEDULER_RECEIPT_INVALID');
  const pointer = { runId: receipt.runId, jobState: receipt.jobState, sha256: identity.sha256 };
  readPointer(outputRoot, pointer, date, checkpoint, policy);
  const prior = readIndex(outputRoot, date, checkpoint, policy);
  if (prior && receipt.lastAttemptAt < prior.latest.lastAttemptAt) return;
  if (prior && receipt.lastAttemptAt === prior.latest.lastAttemptAt) {
    if (receipt.runId !== prior.latest.runId) throw new Error('OPERATIONS_SCHEDULER_SAME_TIME_CONFLICT');
    if (prior.latest.jobState === 'FAILED' && receipt.jobState === 'SUCCEEDED') return;
  }
  materialize(outputRoot, indexFile(date, checkpoint, policy), {
    schemaVersion: 'automatic-checkpoint-index-v1', policySha256: policy.sha256, tradeDate: date, checkpointType: checkpoint,
    latest: pointer, lastSuccess: receipt.jobState === 'SUCCEEDED' ? pointer : prior?.index.lastSuccess ?? null,
  });
}
const reasons = {
  NOT_DUE: '尚未到預定驗收時間。', WAITING_FOR_RUN: '已到預定驗收時間，仍在寬限內等待有效執行結果。',
  SUCCEEDED: '今天此 checkpoint 的排程模式驗收已完成並保存；不代表資料 PASS。',
  ACCEPTANCE_JOB_FAILED: '今天此 checkpoint 的驗收工作失敗；這不是資料來源 FAIL。',
  OVERDUE_NO_RECEIPT: '預定驗收時間加寬限已超過，但尚未看到今天此 checkpoint 的有效執行證據。',
  UNKNOWN: '交易日治理或執行證據無法驗證，排程健康仍未知。',
};
export function readSchedulerHealth({ dataRoot, outputRoot, calendar, now = new Date() }) {
  const policy = loadSchedulerPolicy(), date = schedulerDate(now);
  let day = null;
  try {
    calendar ||= loadGovernedTradingCalendar(path.join(root, 'config/taifex-official-calendar-2026.json'));
    day = resolveGovernedTradingDay(calendar, date);
  } catch { /* Unknown calendar is not proof of a missed operational day. */ }
  const result = { schemaVersion: 'data-operations-scheduler-health-v1', observedAt: now.toISOString(), tradeDate: date,
    policy, calendarIdentity: day ? { fileHash: day.fileHash, exceptionHash: day.exceptionEvidence?.evidenceFileHash ?? null } : null,
    applicability: day ? day.officialTradingDay ? 'TRADING_DAY' : 'NOT_EXPECTED' : 'UNKNOWN', expectedCheckpoint: null, checkpoints: [] };
  for (const c of policy.checkpoints) {
    const expectedAt = `${date}T${c.checkTime}:00+08:00`;
    const deadline = Date.parse(expectedAt) + policy.graceMinutes * 60000;
    let record = null, evidenceState = 'NO_INDEX';
    try {
      assertOperationsOutputRoot(dataRoot, outputRoot);
      record = readIndex(outputRoot, date, c.checkpointType, policy);
      if (record) evidenceState = 'VERIFIED';
    } catch { evidenceState = 'UNVERIFIED'; }
    let state = 'NOT_DUE';
    if (!day) state = 'UNKNOWN';
    else if (day.officialTradingDay) {
      if (now.getTime() >= Date.parse(expectedAt)) {
        result.expectedCheckpoint = c.checkpointType;
        const h = record?.latest;
        // Early or future-dated invocations do not prove the expected scheduled check.
        const applicable = h && Date.parse(h.lastAttemptAt) >= Date.parse(expectedAt)
          && Date.parse(h.lastAttemptAt) <= now.getTime()
          && (h.jobState !== 'SUCCEEDED' || Date.parse(h.lastSuccessAt) <= now.getTime());
        state = applicable ? h.jobState === 'SUCCEEDED' ? 'SUCCEEDED' : 'ACCEPTANCE_JOB_FAILED'
          : now.getTime() > deadline ? 'OVERDUE_NO_RECEIPT' : 'WAITING_FOR_RUN';
      }
    }
    const receipt = record?.latest;
    result.checkpoints.push({ ...c, expectedAt, graceUntil: new Date(deadline).toISOString(), state, evidenceState,
      reasonZh: day && !day.officialTradingDay ? '治理日曆判定今天非交易日，不要求此營運日驗收。' : reasons[state],
      impactZh: '影響今日驗收時效與 Dashboard／研究證據可信度；不判定行情方向。',
      minimumNextAction: ['OVERDUE_NO_RECEIPT', 'ACCEPTANCE_JOB_FAILED', 'UNKNOWN'].includes(state)
        ? '唯讀核對此工作排程結果、runner 日誌與 immutable receipt；保留失敗紀錄，不回填自動成功。'
        : '按既定時間再次讀取驗收紀錄；資料缺口仍依下方 A.1/A.2a 評估。',
      receipt: receipt ? { runId: receipt.runId, jobState: receipt.jobState, lastAttemptAt: receipt.lastAttemptAt,
        runtimeCommit: receipt.runtimeCommit, sha256: record.index.latest.sha256 } : null,
      lastSuccessAt: record?.success?.lastSuccessAt ?? null, lastSuccessRunId: record?.success?.runId ?? null });
  }
  return result;
}

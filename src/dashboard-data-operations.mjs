import fs from 'node:fs';
import path from 'node:path';
import { validateDailyDataOperations, operationsHash, SAFETY } from './daily-data-operations.mjs';
import { REASON_ZH } from './daily-collection-acceptance.mjs';
import { assertOperationsOutputRoot, readBoundedFile, sha256 } from './daily-data-operations-files.mjs';
import { readSchedulerHealth } from './data-operations-scheduler-health.mjs';

const explanations = { ...REASON_ZH,
  DUE_SEMANTICS_UNGOVERNED: '來源何時應到尚無治理證據，維持未知',
  INPUT_ROW_MISSING: '此資料列缺少驗收證據', INPUT_SESSION_NOT_EVALUATED: '此時段尚未驗收',
  CHECKPOINT_SESSION_EVIDENCE_UNAVAILABLE: '缺少可核對的時段結束證據',
  IMMUTABLE_CUTOFF_UNAVAILABLE: '缺少固定帳本截點證據', SESSION_NOT_ENDED: '時段尚未結束，等候新證據',
  EXPECTED_INPUT_PENDING: '仍有預期資料等待到達', CHECKPOINT_NOT_FINAL: '本次是階段驗收，尚非全交易日 FINAL' };
const STATES = ['PASS', 'PARTIAL', 'UNKNOWN', 'PENDING', 'FAIL', 'NOT_EXPECTED'];
const checkpointKind = { DAY_CHECKPOINT: 'day', EOD_CHECKPOINT: 'eod', FINAL_TRADEDATE_CHECKPOINT: 'final' };
const code = value => typeof value === 'string' && /^[A-Z][A-Z0-9_]{0,150}$/.test(value) ? value : 'OPERATIONS_JOB_FAILURE';
const countRows = rows => Object.fromEntries(STATES.map(s => [s, rows.filter(r => r.inCheckpointScope && r.operationalState === s).length]));
function projectRow(row, report) {
  const remediation = report.remediationActions.filter(a => a.datasetId === row.datasetId && a.feedIdentity === row.feedIdentity && a.session === row.session);
  const impacts = [row.blocksCoreLive && '盤中資料與 Dashboard 證據', row.blocksCoreEod && '盤後資料與日級背景',
    row.blocksResearch && '壓力／價格反應／路徑效率研究', row.operationalRole === 'SUPPORTING_OPERATIONAL_MONITOR' && '輔助行情完整性監看'].filter(Boolean);
  return { datasetId: row.datasetId, feedIdentity: row.feedIdentity, ownerLabelZh: row.evidence?.ownerLabelZh || row.feedIdentity,
    session: row.session, operationalRole: row.operationalRole, operationalState: row.operationalState,
    inCheckpointScope: row.inCheckpointScope, dueState: row.dueState, requiredAndDue: row.requiredAndDue,
    reasonCodes: row.reasonCodes, reasonsZh: row.reasonCodes.map(r => explanations[r] || '原因尚待資料治理確認，請查看技術明細'),
    impactZh: impacts.length ? impacts : ['補充背景／後續能力；不納入核心分母'],
    remediation, minimumNextAction: remediation[0]?.smallestNextCheck || '核對此資料列的既有來源證據',
    captureState: row.evidence?.captureState ?? null, coverageState: row.evidence?.coverageState ?? null,
    persistenceState: row.evidence?.persistenceState ?? null, integrityState: row.evidence?.integrityState ?? null };
}
export function projectDataOperations(report, jobHealth = null, history = []) {
  if (report) validateDailyDataOperations(report);
  const result = { schemaVersion: 'dashboard-data-operations-v1', availability: report ? 'AVAILABLE' : 'UNAVAILABLE',
    unavailableReason: report ? null : 'NO_VALID_ASSESSMENT', tradeDate: report?.tradeDate ?? null,
    checkpointType: report?.checkpointType ?? null, finalized: report?.finalizationEligible ?? null,
    generatedAt: report?.generatedAt ?? null, inputGeneratedAt: report?.inputGeneratedAt ?? null,
    overallState: report?.overallState ?? 'UNKNOWN', requiredAndDueCount: report?.requiredAndDueCount ?? null,
    counts: null, countScope: 'IN_CHECKPOINT_OPERATIONAL_PROFILE_ROWS', rows: [], gaps: [],
    acceptanceJobHealth: jobHealth || { jobState: 'NOT_RUN', runMode: null, runId: null, lastAttemptAt: null,
      lastSuccessAt: null, lastAutomaticAttemptAt: null, lastAutomaticSuccessAt: null, lastFinalizedTradeDate: null, lastFinalizedAt: null },
    artifactIdentity: report ? { reportHash: report.reportHash, invocationHash: report.invocationHash,
      inputReportHash: report.inputReportHash, inputArtifactSha256: report.inputArtifactIdentity?.sha256 ?? null,
      calendarHash: report.calendarHash, acceptanceInputsHash: report.acceptanceInputsHash,
      operationalProfileVersion: report.operationalProfileVersion, remediationMatrixVersion: report.remediationMatrixVersion } : null,
    checkpointDetail: report ? { sessionEvaluation: report.sessionEvaluation, checkpointEligible: report.checkpointEligible,
      finalizationReasons: report.finalizationReasons } : null, history, safety: SAFETY };
  if (!report) return result;
  for (const name of ['coreLive', 'coreEod', 'supportingFeeds', 'conditionalContext']) {
    const { rows, ...summary } = report[name];
    result[name] = { ...summary, rows: rows.map(r => projectRow(r, report)) };
    result.rows.push(...result[name].rows);
  }
  result.researchReadiness = { state: report.researchReadiness.state,
    rawPrerequisiteRows: report.researchReadiness.rawPrerequisiteRows.map(r => projectRow(r, report)),
    derivedRows: report.researchReadiness.derivedRows.map(r => projectRow(r, report)) };
  result.rows.push(...result.researchReadiness.derivedRows, ...report.futureNotEnabled.map(r => projectRow(r, report)));
  result.counts = countRows(result.rows);
  result.gaps = result.rows.filter(r => r.inCheckpointScope && !['PASS', 'NOT_EXPECTED'].includes(r.operationalState));
  return result;
}
function readJson(file) { return JSON.parse(readBoundedFile(file).toString('utf8')); }
function projectHealth(h) {
  if (h?.schemaVersion !== 'acceptance-job-health-v1' || !['RUNNING', 'SUCCEEDED', 'FAILED'].includes(h.jobState)
    || !/^[a-f0-9-]{36}$/.test(h.runId || '') || !Number.isFinite(Date.parse(h.lastAttemptAt))) throw new Error('HEALTH_INVALID');
  const result = {};
  for (const key of ['jobState', 'runId', 'lastAttemptAt', 'lastSuccessAt', 'lastFinalizedTradeDate', 'lastFinalizedAt',
    'lastAutomaticAttemptAt', 'lastAutomaticSuccessAt', 'inputTradeDate', 'checkpointType']) result[key] = h[key] ?? null;
  result.runMode = ['MANUAL_OFFLINE', 'MANUAL_REPLAY', 'CANDIDATE_SCHEDULER_TEST', 'SCHEDULED'].includes(h.runMode) ? h.runMode : 'UNKNOWN';
  result.jobReason = code(h.jobReason);
  result.failureClass = h.jobState === 'FAILED' ? 'ACCEPTANCE_JOB_FAILURE_NOT_FEED_FAILURE' : null;
  result.runtimeCommit = /^[a-f0-9]{40}$/.test(h.runtimeCommit || '') ? h.runtimeCommit : null;
  result.reportHash = /^[a-f0-9]{64}$/.test(h.reportArtifactIdentity?.reportHash || '') ? h.reportArtifactIdentity.reportHash : null;
  result.inputResolutionIdentity = h.inputResolutionIdentity ? Object.fromEntries(
    ['manifestSha256', 'reportSha256', 'acceptanceInputsFileSha256', 'dueRulesSha256'].map(key =>
      [key, /^[a-f0-9]{64}$/.test(h.inputResolutionIdentity[key] || '') ? h.inputResolutionIdentity[key] : null])) : null;
  return result;
}
export function readDataOperations({ dataRoot, outputRoot, calendar, bindingIdentity = null, now = new Date() }) {
  let report = null, health = null, unavailableReason = null;
  const history = [];
  try {
    assertOperationsOutputRoot(dataRoot, outputRoot);
    const file = path.join(outputRoot, 'job-health.json');
    if (fs.existsSync(file)) {
      const h = readJson(file);
      health = projectHealth(h);
      if (h.jobState !== 'RUNNING') {
        const receipt = readJson(path.join(outputRoot, 'runs', `${h.runId}${h.jobState === 'FAILED' ? '.failed' : ''}.json`));
        if (operationsHash(receipt) !== operationsHash(h)) throw new Error('HEALTH_RECEIPT_MISMATCH');
      }
      history.push({ runId: health.runId, jobState: health.jobState, lastAttemptAt: health.lastAttemptAt, reportHash: health.reportHash });
    }
  } catch { health = { jobState: 'UNKNOWN', jobReason: 'JOB_HEALTH_UNVERIFIED', lastSuccessAt: null, lastFinalizedTradeDate: null }; }
  try {
    assertOperationsOutputRoot(dataRoot, outputRoot);
    const latest = path.join(outputRoot, 'latest.json');
    if (fs.existsSync(latest)) {
      const candidate = readJson(latest);
      validateDailyDataOperations(candidate);
      const revision = readBoundedFile(path.join(outputRoot, candidate.tradeDate, checkpointKind[candidate.checkpointType], `${candidate.reportHash}.json`));
      if (operationsHash(JSON.parse(revision.toString('utf8'))) !== operationsHash(candidate)) throw new Error('REVISION_MISMATCH');
      report = candidate;
      history.push({ checkpointType: report.checkpointType, tradeDate: report.tradeDate, reportHash: report.reportHash,
        artifactSha256: sha256(revision) });
    }
  } catch { unavailableReason = 'ASSESSMENT_INVALID_OR_UNREADABLE'; }
  const view = projectDataOperations(report, health, history);
  if (bindingIdentity) view.bindingIdentity = bindingIdentity;
  try { view.schedulerHealth = readSchedulerHealth({ dataRoot, outputRoot, calendar, now }); }
  catch { view.schedulerHealth = { schemaVersion: 'data-operations-scheduler-health-v1', observedAt: now.toISOString(),
    tradeDate: null, applicability: 'UNKNOWN', checkpoints: [], reasonZh: '排程政策無法驗證，今日進度未知。' }; }
  if (unavailableReason) view.unavailableReason = unavailableReason;
  return view;
}

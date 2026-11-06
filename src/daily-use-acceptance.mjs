import fs from 'node:fs';
import path from 'node:path';
import { operationsHash, SAFETY, assertOperationsDate } from './daily-data-operations.mjs';
import { readBoundedFile, assertOperationsOutputRoot, noLinks } from './daily-data-operations-files.mjs';

// This is an evidence summary, never a browser proof, readiness override or release gate.
export const DAILY_USE_FEATURES = Object.freeze([
  ['entry', '固定入口'], ['login', '登入／登出／重新登入'], ['navigation', '導覽與版本'],
  ['price', 'K線／成交量／週期'], ['depth', '五檔'], ['flow', 'Flow 六窗'], ['adx', 'ADX'],
  ['vwap', 'VWAP／高低點'], ['rvol', 'RVOL'], ['basis', 'Basis'], ['pulse', 'Market Pulse'],
  ['smc', 'SMC 結構／確認／失效'], ['cvd', '觀測 CVD／UNKNOWN／累積起點'],
  ['profile', '成交量分布／POC／價值區'], ['snapshot', '鎖定快照'], ['copy', 'Copy 一致性'],
  ['journal', '日誌保存／跨頁'], ['journalRestart', '日誌重新登入／程序重啟讀回'],
  ['review', 'Review'], ['outcome', 'Outcome'], ['daily', '每日資料／OI'],
  ['quality', 'Data Quality'], ['conflict', 'Conflict Monitor'], ['timeline', 'Event Timeline'],
  ['desktop', '桌機操作'], ['mobile', '手機尺寸操作'], ['liveChain', '盤中來源至畫面'],
  ['dailyChain', '每日來源至畫面'], ['live60', '60 分鐘 LIVE'], ['recovery', '關閉再開／冷啟／恢復'],
]);
const statuses = ['NOT_DUE', 'SOURCE_NOT_PUBLISHED', 'JOB_NOT_RUN', 'JOB_FAILED', 'STALE', 'AVAILABLE', 'UNKNOWN'];
const results = ['PASS', 'FAIL', 'NOT RUN', 'BLOCKED'];
const kinds = ['NORMAL_UI', 'LIVE', 'SCHEDULED', 'MANUAL', 'REPLAY', 'SYNTHETIC'];
const sha = x => typeof x === 'string' && /^[a-f0-9]{40}$/.test(x);
const hash = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
const time = x => typeof x === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(x) && Number.isFinite(Date.parse(x));
const code = x => typeof x === 'string' && /^[A-Z][A-Z0-9_]{0,120}$/.test(x);
const date = now => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
const fail = reason => { throw new Error('DAILY_USE_' + reason); };
const roles = ['dashboard', 'producer', 'writer', 'bridge'];

export function buildDailyUseReceipt({ candidateSha, now = new Date(), tradeDate = null, session = 'UNKNOWN',
  operations = null, batch = null, observations = null, evidence = [] }) {
  if (!sha(candidateSha) || !Number.isFinite(now.getTime())) fail('IDENTITY_INVALID');
  if (tradeDate !== null) assertOperationsDate(tradeDate);
  if (!['DAY', 'NIGHT', 'UNKNOWN'].includes(session)) fail('SESSION_INVALID');
  const calendarDate = date(now), observedAt = now.toISOString();
  if (!Array.isArray(evidence) || evidence.length > 64 || evidence.some(e => !code(e.role) || !hash(e.sha256))) fail('EVIDENCE_INVALID');
  // Runtime identities must come from observed process evidence, never this checkout's HEAD.
  const runtimes = Object.fromEntries(roles.map(role => [role, { sha: 'UNKNOWN', processIdentitySha256: null,
    executionRootSha256: null, dataRootSha256: null, configSha256: null }]));
  const validObservation = observations?.schemaVersion === 'daily-use-observations-v1'
    && observations.candidateSha === candidateSha && observations.calendarDate === calendarDate
    && observations.tradeDate === tradeDate && observations.session === session
    && observations.evidencePolicy === 'OBSERVED_FACTS_NOT_RUNTIME_PROOF';
  if (observations && !validObservation) fail('OBSERVATION_IDENTITY_MISMATCH');
  if (validObservation) for (const role of roles) {
    const r = observations.runtimes?.[role];
    if (!r) continue;
    if (!sha(r.sha) || !time(r.observedAt) || date(new Date(r.observedAt)) !== calendarDate
      || Date.parse(r.observedAt) > now.getTime()
      || !['processIdentitySha256', 'executionRootSha256', 'dataRootSha256', 'configSha256'].every(k => hash(r[k]))) fail('RUNTIME_EVIDENCE_INVALID');
    runtimes[role] = Object.fromEntries(['sha', 'observedAt', 'processIdentitySha256', 'executionRootSha256', 'dataRootSha256', 'configSha256'].map(k => [k, r[k]]));
  }
  const inputRows = observations?.features || [];
  if (!Array.isArray(inputRows) || inputRows.length > DAILY_USE_FEATURES.length
    || new Set(inputRows.map(r => r.id)).size !== inputRows.length
    || inputRows.some(r => !DAILY_USE_FEATURES.some(([id]) => id === r.id))) fail('FEATURES_INVALID');
  const features = DAILY_USE_FEATURES.map(([id, label]) => {
    const r = inputRows.find(r => r.id === id);
    const row = { id, label, engineeringResult: 'NOT RUN', operationResult: 'NOT RUN', dataStatus: 'UNKNOWN',
      reasonCodes: ['CURRENT_VERSION_OPERATION_NOT_OBSERVED'], evidenceKind: null, evidenceSha256: null,
      sourceTime: null, availableAt: null, cutoff: null, browserTime: null, observedAt: null };
    if (!r) return row;
    if (!results.includes(r.operationResult) || !statuses.includes(r.dataStatus) || !kinds.includes(r.evidenceKind)
      || !Array.isArray(r.reasonCodes) || !r.reasonCodes.length || r.reasonCodes.length > 12 || !r.reasonCodes.every(code)
      || !time(r.observedAt) || date(new Date(r.observedAt)) !== calendarDate || Date.parse(r.observedAt) > now.getTime()
      || !hash(r.evidenceSha256) || !evidence.some(e => e.sha256 === r.evidenceSha256)) fail('FEATURE_EVIDENCE_INVALID');
    for (const k of ['sourceTime', 'availableAt', 'cutoff', 'browserTime']) {
      if (r[k] != null && (!time(r[k]) || Date.parse(r[k]) > Date.parse(r.observedAt))) fail('FEATURE_TIME_INVALID');
      row[k] = r[k] ?? null;
    }
    Object.assign(row, Object.fromEntries(['operationResult', 'dataStatus', 'reasonCodes', 'evidenceKind', 'evidenceSha256', 'observedAt'].map(k => [k, r[k]])));
    // Historical/synthetic/manual engineering cannot establish today's usable UI.
    if (['REPLAY', 'SYNTHETIC', 'MANUAL'].includes(r.evidenceKind)) {
      row.engineeringResult = r.operationResult; row.operationResult = 'NOT RUN'; row.dataStatus = 'UNKNOWN';
      row.reasonCodes = [...r.reasonCodes, 'NOT_CURRENT_OPERATION_EVIDENCE'];
    } else if (r.operationResult === 'PASS' && (runtimes.dashboard.sha !== candidateSha
      || (['liveChain', 'live60'].includes(id) && (runtimes.producer.sha !== candidateSha || runtimes.bridge.sha === 'UNKNOWN'))
      || (id === 'dailyChain' && runtimes.writer.sha !== candidateSha))) {
      row.operationResult = 'BLOCKED'; row.dataStatus = 'UNKNOWN'; row.reasonCodes = ['RUNTIME_VERSION_PAIRING_UNVERIFIED'];
    }
    return row;
  });
  const useful = features.filter(r => r.operationResult === 'PASS' && r.dataStatus === 'AVAILABLE');
  // No observed entry/login => no claim of a usable product. One unavailable research module does not erase price usability.
  const access = ['entry', 'login'].every(id => useful.some(r => r.id === id));
  const overall = access && useful.length === features.length ? 'AVAILABLE' : access && useful.length > 2 ? 'PARTIAL' : 'UNAVAILABLE';
  const currentBatch = batch && time(batch.startedAt) && date(new Date(batch.startedAt)) === calendarDate
    && Date.parse(batch.startedAt) <= now.getTime();
  const dailyBatch = { state: currentBatch && batch.state === 'failed' ? 'JOB_FAILED' : 'UNKNOWN',
    executionResult: currentBatch ? ({ failed: 'FAILED', completed: 'SUCCEEDED', completed_with_warnings: 'PARTIAL', running: 'RUNNING' })[batch.state] || 'UNKNOWN' : 'UNKNOWN',
    scope: 'BATCH_EXECUTION_ONLY_NOT_SOURCE_OR_UI_AVAILABILITY', evidenceKind: 'UNKNOWN',
    startedAt: time(batch?.startedAt) ? batch.startedAt : null, completedAt: time(batch?.completedAt) ? batch.completedAt : null,
    lastSuccessAt: null, writerSha: runtimes.writer.sha,
    reasonCodes: currentBatch ? (batch.gateSummary?.reasons || []).filter(code).slice(0, 20) : ['NO_CURRENT_BATCH_EVIDENCE'],
    stages: (Array.isArray(batch?.stages) ? batch.stages : []).slice(0, 64).map(s => ({
      key: /^[a-z0-9_]{1,80}$/.test(s.key || '') ? s.key : 'unknown', ok: typeof s.ok === 'boolean' ? s.ok : null,
      durationSeconds: Number.isFinite(s.durationSeconds) && s.durationSeconds >= 0 ? s.durationSeconds : null })) };
  const receipt = { schemaVersion: 'daily-use-acceptance-v1', candidateSha, calendarDate, tradeDate, session,
    observedAt, timezone: 'Asia/Taipei', observedAtTaipei: new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Taipei',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(now),
    invocation: 'MANUAL_READONLY', automaticActivation: 'NOT_ENABLED_BY_THIS_RUNNER', scope: 'CANDIDATE_ACCEPTANCE_ONLY',
    validationScope: 'EVIDENCE_LINKS_AND_IDENTITY_ONLY_NOT_INDEPENDENT_UI_VERIFICATION',
    overall, overallReason: access ? 'PER_FEATURE_OBSERVED_RESULTS' : 'CURRENT_ENTRY_OR_LOGIN_UNVERIFIED',
    runtimes, features, dailyBatch, operations: operations ? {
      tradeDate: operations.tradeDate, generatedAt: operations.generatedAt, overallState: operations.overallState,
      artifactIdentity: operations.artifactIdentity, schedulerHealth: operations.schedulerHealth,
      acceptanceJobHealth: operations.acceptanceJobHealth } : null,
    evidence, reboot: 'REBOOT_NOT_RUN', safety: { ...SAFETY, AI: 'DISABLED_BY_OWNER' } };
  return { ...receipt, receiptHash: operationsHash(receipt) };
}

export function validateDailyUseReceipt(receipt) {
  const { receiptHash, ...body } = receipt || {};
  assertOperationsDate(body.calendarDate);
  if (body.schemaVersion !== 'daily-use-acceptance-v1' || operationsHash(body) !== receiptHash
    || !sha(body.candidateSha) || !time(body.observedAt) || date(new Date(body.observedAt)) !== body.calendarDate
    || body.timezone !== 'Asia/Taipei' || body.invocation !== 'MANUAL_READONLY'
    || body.scope !== 'CANDIDATE_ACCEPTANCE_ONLY' || body.automaticActivation !== 'NOT_ENABLED_BY_THIS_RUNNER'
    || !['AVAILABLE', 'PARTIAL', 'UNAVAILABLE'].includes(body.overall)
    || !Array.isArray(body.features) || body.features.length !== DAILY_USE_FEATURES.length
    || body.features.some((r, i) => r.id !== DAILY_USE_FEATURES[i][0] || !results.includes(r.operationResult)
      || r.label !== DAILY_USE_FEATURES[i][1] || !results.includes(r.engineeringResult) || !statuses.includes(r.dataStatus)
      || !Array.isArray(r.reasonCodes) || !r.reasonCodes.length || r.reasonCodes.length > 13 || !r.reasonCodes.every(code))
    || Object.keys(SAFETY).some(k => body.safety?.[k] !== SAFETY[k]) || body.safety.AI !== 'DISABLED_BY_OWNER') fail('RECEIPT_INVALID');
  return receipt;
}

export function writeDailyUseReceipt({ dataRoot, outputRoot, receipt }) {
  validateDailyUseReceipt(receipt);
  const target = assertOperationsOutputRoot(dataRoot, outputRoot);
  const dir = path.join(target, 'daily-use', receipt.calendarDate);
  noLinks(dir); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${receipt.receiptHash}.json`);
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  if (Buffer.byteLength(bytes) > 1024 * 1024) fail('RECEIPT_SIZE_INVALID');
  try { fs.writeFileSync(file, bytes, { flag: 'wx' }); }
  catch (err) { if (err.code !== 'EEXIST' || readBoundedFile(file, 1024 * 1024).toString() !== bytes) throw err; }
  const latest = path.join(dir, 'latest.json'), guard = path.join(dir, '.writer');
  noLinks(latest); noLinks(guard);
  const fd = fs.openSync(guard, 'wx');
  try {
    const old = fs.existsSync(latest) ? JSON.parse(readBoundedFile(latest, 1024)) : null;
    if (!old || old.observedAt < receipt.observedAt) {
      const temp = path.join(dir, `${receipt.receiptHash}.tmp`); noLinks(temp);
      fs.writeFileSync(temp, JSON.stringify({ receiptHash: receipt.receiptHash, observedAt: receipt.observedAt }), { flag: 'wx' });
      fs.renameSync(temp, latest);
    }
  } finally { fs.closeSync(fd); fs.unlinkSync(guard); }
  return { file, receiptHash: receipt.receiptHash };
}

export function readDailyUseReceipt({ dataRoot, outputRoot, now = new Date() }) {
  try {
    const target = assertOperationsOutputRoot(dataRoot, outputRoot);
    const dir = path.join(target, 'daily-use', date(now));
    if (!fs.existsSync(path.join(dir, 'latest.json'))) return null;
    const pointer = JSON.parse(readBoundedFile(path.join(dir, 'latest.json'), 1024));
    if (!hash(pointer.receiptHash)) fail('POINTER_INVALID');
    const receipt = validateDailyUseReceipt(JSON.parse(readBoundedFile(path.join(dir, `${pointer.receiptHash}.json`), 1024 * 1024)));
    if (receipt.calendarDate !== date(now) || receipt.observedAt !== pointer.observedAt || Date.parse(receipt.observedAt) > now.getTime()) fail('POINTER_IDENTITY_INVALID');
    return receipt;
  } catch { return { schemaVersion: 'daily-use-acceptance-unavailable-v1', reason: 'RECEIPT_UNVERIFIED' }; }
}

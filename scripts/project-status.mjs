import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  validateOwnerLaunchApprovalArtifact,
  validateReadyForLaunchManifest,
} from '../src/market-state-forward-shadow.mjs';

const SCRIPT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = path.dirname(SCRIPT_ROOT);
export const DEFAULT_LEDGER_TAIL_BYTES = 4 * 1024 * 1024;
const HTTP_TIMEOUT_MS = 1_200;
const SAFETY = Object.freeze({
  formalWeight: 0,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
});

function isoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

function fileMetadata(filePath) {
  if (!fs.existsSync(filePath)) return Object.freeze({ exists: false, bytes: 0, modifiedAt: null });
  const stat = fs.statSync(filePath);
  return Object.freeze({ exists: stat.isFile(), bytes: stat.isFile() ? stat.size : 0, modifiedAt: stat.mtime.toISOString() });
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function runGit(root, args) {
  return execFileSync('git', ['-c', `safe.directory=${path.resolve(root)}`, ...args], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
    timeout: 3_000,
    maxBuffer: 2 * 1024 * 1024,
  }).replace(/\s+$/u, '');
}

export function inspectGit(root, git = runGit) {
  try {
    const branch = git(root, ['branch', '--show-current']).trim() || 'DETACHED';
    const head = git(root, ['rev-parse', 'HEAD']).trim();
    let originMain = null;
    let ahead = null;
    let behind = null;
    try {
      originMain = git(root, ['rev-parse', 'origin/main']).trim();
      const counts = git(root, ['rev-list', '--left-right', '--count', 'HEAD...origin/main']).split(/\s+/).map(Number);
      [ahead, behind] = counts;
    } catch {
      originMain = null;
    }
    const dirtyPaths = git(root, ['status', '--porcelain=v1', '--untracked-files=all'])
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => line.slice(3).replace(/^"|"$/g, ''));
    return Object.freeze({
      availability: 'AVAILABLE',
      branch,
      head,
      originMain,
      ahead,
      behind,
      dirty: dirtyPaths.length > 0,
      dirtyPaths: Object.freeze(dirtyPaths),
      originMainSource: 'LOCAL_TRACKING_REF_NO_NETWORK_FETCH',
    });
  } catch (error) {
    return Object.freeze({ availability: 'UNAVAILABLE', reason: 'GIT_STATUS_UNAVAILABLE', detail: error?.code || null });
  }
}

async function fetchJson(url, timeoutMs = HTTP_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`HTTP_${response.status}`);
    return { statusCode: response.status, payload: await response.json() };
  } finally {
    clearTimeout(timer);
  }
}

export async function inspectDashboard(request = fetchJson, baseUrl = 'http://127.0.0.1:8787') {
  try {
    const { statusCode, payload } = await request(`${baseUrl}/healthz`);
    const safe = statusCode === 200 && payload?.ok === true;
    return Object.freeze({
      availability: safe ? 'AVAILABLE' : 'UNAVAILABLE',
      reachable: safe,
      health: safe ? 'PASS' : 'FAIL_CLOSED',
      service: typeof payload?.service === 'string' ? payload.service : null,
      baseUrl,
    });
  } catch (error) {
    return Object.freeze({ availability: 'UNAVAILABLE', reachable: false, health: 'UNAVAILABLE', service: null, baseUrl, reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE' });
  }
}

export async function inspectShioaji(request = fetchJson, baseUrl = 'http://127.0.0.1:8790') {
  try {
    const { payload } = await request(`${baseUrl}/health`);
    const safe = payload?.mode === 'market_data_only'
      && payload?.executionAuthorized === false
      && payload?.orderRoutesEnabled === false;
    if (!safe) {
      return Object.freeze({
        availability: 'UNAVAILABLE',
        reachable: true,
        safetyState: 'FAIL_CLOSED_UNSAFE_RESPONSE',
        provider: typeof payload?.provider === 'string' ? payload.provider : 'UNKNOWN',
        mode: 'UNKNOWN',
        executionAuthorized: false,
        orderRoutesEnabled: false,
      });
    }
    return Object.freeze({
      availability: payload?.ok === true ? 'AVAILABLE' : 'UNAVAILABLE',
      reachable: true,
      safetyState: 'PASS',
      provider: typeof payload.provider === 'string' ? payload.provider : 'shioaji',
      mode: 'market_data_only',
      writerErrors: Number(payload.writerErrors) || 0,
      callbackErrors: Number(payload.callbackErrors) || 0,
      droppedEvents: Number(payload.dropped) || 0,
      latestReceivedAt: isoOrNull(payload.latestReceivedAt),
      eventsWritten: Number(payload.eventsWritten ?? payload.written) || 0,
      queueDepth: Number(payload.eventQueueDepth) || 0,
      lowDisk: payload.lowDisk === true,
      executionAuthorized: false,
      orderRoutesEnabled: false,
    });
  } catch (error) {
    return Object.freeze({
      availability: 'UNAVAILABLE',
      reachable: false,
      safetyState: 'UNAVAILABLE',
      provider: 'shioaji',
      mode: 'market_data_only',
      executionAuthorized: false,
      orderRoutesEnabled: false,
      reason: error?.name === 'AbortError' ? 'TIMEOUT' : 'UNREACHABLE',
    });
  }
}

function isTxExecutedTick(record) {
  if (record?.kind !== 'futures_tick' || record?.duplicate === true) return false;
  const payload = record.payload || {};
  const code = String(payload._target_code || record.product || payload.code || '');
  const family = String(payload._product_family || '');
  const txContract = family === 'TX' || (/^TXF[A-L]\d$/i.test(code) && !/^(?:MTX|TMF)/i.test(code));
  return txContract
    && Number.isFinite(Number(payload.close))
    && record.executionAuthorized === false
    && record.orderRoutesEnabled === false;
}

function timestampMs(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(text) ? text : `${text}+08:00`;
  const parsed = Date.parse(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

export function readBoundedTxTail(filePath, maxBytes = DEFAULT_LEDGER_TAIL_BYTES) {
  const metadata = fileMetadata(filePath);
  if (!metadata.exists) return Object.freeze({ availability: 'UNAVAILABLE', reason: 'LEDGER_NOT_FOUND', bytesScanned: 0, scanLimitBytes: maxBytes });
  const bytesToRead = Math.min(metadata.bytes, Math.max(1, maxBytes));
  const start = metadata.bytes - bytesToRead;
  const buffer = Buffer.allocUnsafe(bytesToRead);
  const descriptor = fs.openSync(filePath, 'r');
  try { fs.readSync(descriptor, buffer, 0, bytesToRead, start); } finally { fs.closeSync(descriptor); }
  let text = buffer.toString('utf8');
  if (start > 0) {
    const firstBreak = text.indexOf('\n');
    text = firstBreak >= 0 ? text.slice(firstBreak + 1) : '';
  }
  const lines = text.split(/\r?\n/).filter(Boolean);
  let latest = null;
  let txTickCount = 0;
  let nativeSequenceSeen = false;
  let timestampLineageViolationCount = 0;
  for (const line of lines) {
    if (!line.includes('"futures_tick"')) continue;
    try {
      const record = JSON.parse(line);
      if (!isTxExecutedTick(record)) continue;
      txTickCount += 1;
      const payload = record.payload || {};
      nativeSequenceSeen ||= [record.sequence, record.seq, record.tick_sn, payload.sequence, payload.seq, payload.tick_sn]
        .some((value) => value !== null && value !== undefined && value !== '');
      const exchangeTimestamp = payload.datetime || record.exchangeTimestamp || null;
      const receivedAt = record.receivedAt || payload._received_at || null;
      const exchangeMs = timestampMs(exchangeTimestamp);
      const receivedMs = timestampMs(receivedAt);
      if (exchangeMs != null && receivedMs != null && receivedMs < exchangeMs) timestampLineageViolationCount += 1;
      latest = {
        timestamp: isoOrNull(exchangeTimestamp) || exchangeTimestamp || null,
        receivedAt: isoOrNull(receivedAt),
        actualContract: String(payload._target_code || record.product || payload.code || '') || null,
      };
    } catch {
      // A partial or invalid line is ignored; this is an observation tool, not a ledger repair path.
    }
  }
  return Object.freeze({
    availability: latest ? 'AVAILABLE' : 'UNAVAILABLE',
    reason: latest ? null : 'TX_TICK_NOT_FOUND_IN_BOUNDED_TAIL',
    latestTxTickTimestamp: latest?.timestamp || null,
    latestTxReceivedAt: latest?.receivedAt || null,
    latestActualContract: latest?.actualContract || null,
    txTickCountInTail: txTickCount,
    nativeSequenceAvailability: nativeSequenceSeen ? 'AVAILABLE' : txTickCount ? 'UNAVAILABLE' : 'UNKNOWN',
    timestampLineageViolationCountInTail: timestampLineageViolationCount,
    bytesScanned: bytesToRead,
    scanLimitBytes: maxBytes,
    boundedTail: true,
  });
}

export function inspectLocalMarketData(root, maxTailBytes = DEFAULT_LEDGER_TAIL_BYTES) {
  const ledgerRoot = path.join(root, 'data', 'live-events');
  if (!fs.existsSync(ledgerRoot)) return Object.freeze({ availability: 'UNAVAILABLE', reason: 'LIVE_EVENT_DIRECTORY_NOT_FOUND' });
  const ledgers = fs.readdirSync(ledgerRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();
  const latestName = ledgers.at(-1);
  if (!latestName) return Object.freeze({ availability: 'UNAVAILABLE', reason: 'LIVE_EVENT_LEDGER_NOT_FOUND' });
  const latestPath = path.join(ledgerRoot, latestName);
  const metadata = fileMetadata(latestPath);
  const tick = readBoundedTxTail(latestPath, maxTailBytes);
  return Object.freeze({
    availability: 'AVAILABLE',
    latestLedgerDate: latestName.slice(0, 10),
    latestLedgerBytes: metadata.bytes,
    latestLedgerModifiedAt: metadata.modifiedAt,
    tx: tick,
  });
}

export async function inspectDatabase(root) {
  const databasePath = path.join(root, 'v2', 'data', 'research-v2.sqlite');
  const metadata = fileMetadata(databasePath);
  if (!metadata.exists) return Object.freeze({ availability: 'UNAVAILABLE', ...metadata, latestDataDate: null, reason: 'DATABASE_NOT_FOUND' });
  try {
    const { DatabaseSync } = await import('node:sqlite');
    const db = new DatabaseSync(databasePath, { readOnly: true, timeout: 100 });
    let latestDataDate = null;
    try {
      db.exec('PRAGMA query_only=ON');
      latestDataDate = db.prepare('SELECT MAX(trade_date) AS date FROM market_daily').get()?.date || null;
    } finally { db.close(); }
    return Object.freeze({ availability: 'AVAILABLE', ...metadata, latestDataDate, queryScope: 'ONE_INDEXABLE_MAX_DATE_READ_ONLY' });
  } catch {
    return Object.freeze({ availability: 'AVAILABLE', ...metadata, latestDataDate: null, queryScope: 'METADATA_ONLY', reason: 'LATEST_DATE_UNAVAILABLE' });
  }
}

function approvalPath(runtimeRoot) {
  return ['owner-recovery-approval.json', 'owner-launch-approval.json']
    .map((name) => path.join(runtimeRoot, name))
    .find((candidate) => fs.existsSync(candidate)) || null;
}

function latestDailyStatus(runtimeRoot) {
  const statusRoot = path.join(runtimeRoot, 'daily-status');
  if (!fs.existsSync(statusRoot)) return null;
  const candidates = fs.readdirSync(statusRoot, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
    .map((entry) => ({ name: entry.name, filePath: path.join(statusRoot, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
  for (const candidate of candidates.reverse()) {
    try {
      const row = readJson(candidate.filePath);
      return Object.freeze({
        file: candidate.name,
        tradeDate: row.tradeDate || null,
        recordType: row.recordType || null,
        qualityStatus: row.qualityStatus || null,
        lifecycle: Array.isArray(row.lifecycle) ? Object.freeze([...row.lifecycle]) : Object.freeze([]),
        officialEvidenceWritten: row.officialEvidenceWritten === true,
        executionAuthorized: false,
      });
    } catch { /* try the next older immutable status */ }
  }
  return null;
}

export function inspectForwardShadow(root) {
  const baseRoot = path.join(root, 'data', 'market-state', 'forward-shadow');
  if (!fs.existsSync(baseRoot)) return Object.freeze({ availability: 'UNAVAILABLE', governed: false, reason: 'FORWARD_SHADOW_ROOT_NOT_FOUND', executionAuthorized: false });
  const candidates = fs.readdirSync(baseRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(baseRoot, entry.name));
  const validated = [];
  for (const runtimeRoot of candidates) {
    const manifestPath = path.join(runtimeRoot, 'launch-manifest.json');
    const approvedPath = approvalPath(runtimeRoot);
    if (!fs.existsSync(manifestPath) || !approvedPath) continue;
    try {
      const manifest = readJson(manifestPath);
      const approval = readJson(approvedPath);
      validateReadyForLaunchManifest(manifest);
      validateOwnerLaunchApprovalArtifact(approval, manifest);
      validated.push({ runtimeRoot, manifest, approval });
    } catch { /* invalid candidates fail closed and are not surfaced as governed */ }
  }
  validated.sort((left, right) => Date.parse(right.approval.approvedAt || 0) - Date.parse(left.approval.approvedAt || 0));
  const selected = validated[0];
  if (!selected) return Object.freeze({ availability: 'UNAVAILABLE', governed: false, reason: 'NO_VALIDATED_RUNTIME', executionAuthorized: false });
  return Object.freeze({
    availability: 'AVAILABLE',
    governed: true,
    runId: selected.manifest.runId || null,
    launchStatus: selected.manifest.launchStatus || 'UNKNOWN',
    officialStartTradeDate: selected.manifest.officialStartTradeDate || null,
    recoveryEffectiveTradeDate: selected.manifest.runtimeRecoveryBinding?.recoveryEffectiveTradeDate || null,
    finalMainCommit: selected.manifest.finalMainCommit || null,
    latestDailyStatus: latestDailyStatus(selected.runtimeRoot),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  });
}

export function inspectQuality(root, localMarketData) {
  const auditPath = path.join(root, 'data', 'live-events', 'audits', 'latest.json');
  let audit = null;
  try { audit = readJson(auditPath); } catch { audit = null; }
  const tail = localMarketData?.tx || {};
  const timestampViolations = Number(tail.timestampLineageViolationCountInTail) || 0;
  return Object.freeze({
    availability: audit || tail.availability === 'AVAILABLE' ? 'AVAILABLE' : 'UNAVAILABLE',
    auditState: audit?.state || 'UNKNOWN',
    auditAcceptance: audit?.acceptance?.status || 'UNKNOWN',
    auditGeneratedAt: isoOrNull(audit?.generatedAt),
    stale: typeof audit?.stale === 'boolean' ? audit.stale : null,
    nativeSequenceAvailability: tail.nativeSequenceAvailability || 'UNKNOWN',
    timestampLineageState: timestampViolations > 0 ? 'QUALITY_INSUFFICIENT' : 'UNKNOWN',
    qualityReasons: Object.freeze(timestampViolations > 0 ? ['TIMESTAMP_LINEAGE_INSUFFICIENT'] : []),
    timestampLineageViolationCountInBoundedTail: timestampViolations,
    boundedObservationOnly: true,
  });
}

export async function collectProjectStatus({
  root = DEFAULT_ROOT,
  gitProbe = inspectGit,
  request = fetchJson,
  maxTailBytes = DEFAULT_LEDGER_TAIL_BYTES,
  now = new Date(),
} = {}) {
  const resolvedRoot = path.resolve(root);
  const [dashboard, shioaji, database] = await Promise.all([
    inspectDashboard(request),
    inspectShioaji(request),
    inspectDatabase(resolvedRoot),
  ]);
  const localMarketData = inspectLocalMarketData(resolvedRoot, maxTailBytes);
  return Object.freeze({
    schemaVersion: 'project-handoff-status-v1',
    capturedAt: now.toISOString(),
    repository: 'mike0345721/taiwan-quant-trading-system',
    scopeAuthority: 'ROADMAP.md',
    git: gitProbe(resolvedRoot),
    dashboard,
    shioaji,
    localMarketData,
    database,
    forwardShadow: inspectForwardShadow(resolvedRoot),
    quality: inspectQuality(resolvedRoot, localMarketData),
    safety: SAFETY,
  });
}

function line(label, value) {
  return `${label}=${value === null || value === undefined || value === '' ? 'UNKNOWN' : value}`;
}

export function formatHumanStatus(report) {
  const sections = [
    ['PROJECT', [line('capturedAt', report.capturedAt), line('repository', report.repository), line('scopeAuthority', report.scopeAuthority)]],
    ['GIT', [line('branch', report.git.branch), line('HEAD', report.git.head), line('origin/main', report.git.originMain), line('ahead', report.git.ahead), line('behind', report.git.behind), line('dirtyPaths', report.git.dirtyPaths?.join(', ') || 'NONE')]],
    ['DASHBOARD 8787', [line('availability', report.dashboard.availability), line('health', report.dashboard.health), line('service', report.dashboard.service)]],
    ['SHIOAJI 8790', [line('availability', report.shioaji.availability), line('provider', report.shioaji.provider), line('mode', report.shioaji.mode), line('writerErrors', report.shioaji.writerErrors), line('latestReceivedAt', report.shioaji.latestReceivedAt), line('executionAuthorized', report.shioaji.executionAuthorized), line('orderRoutesEnabled', report.shioaji.orderRoutesEnabled)]],
    ['LOCAL MARKET DATA', [line('availability', report.localMarketData.availability), line('latestLedgerDate', report.localMarketData.latestLedgerDate), line('latestLedgerBytes', report.localMarketData.latestLedgerBytes), line('latestTxTickTimestamp', report.localMarketData.tx?.latestTxTickTimestamp), line('latestActualContract', report.localMarketData.tx?.latestActualContract), line('boundedTailBytesScanned', report.localMarketData.tx?.bytesScanned)]],
    ['DATABASE', [line('availability', report.database.availability), line('bytes', report.database.bytes), line('latestDataDate', report.database.latestDataDate)]],
    ['FORWARD SHADOW', [line('availability', report.forwardShadow.availability), line('governed', report.forwardShadow.governed), line('launchStatus', report.forwardShadow.launchStatus), line('latestTradeDate', report.forwardShadow.latestDailyStatus?.tradeDate), line('latestQualityStatus', report.forwardShadow.latestDailyStatus?.qualityStatus)]],
    ['QUALITY', [line('availability', report.quality.availability), line('nativeSequenceAvailability', report.quality.nativeSequenceAvailability), line('timestampLineageState', report.quality.timestampLineageState), line('qualityReasons', report.quality.qualityReasons?.join(', ') || 'NONE')]],
    ['SAFETY', [line('formalWeight', report.safety.formalWeight), line('researchOnly', report.safety.researchOnly), line('executionAuthorized', report.safety.executionAuthorized), line('orderRoutesEnabled', report.safety.orderRoutesEnabled)]],
  ];
  return `${sections.map(([title, rows]) => `---------------------------\n${title}\n---------------------------\n${rows.join('\n')}`).join('\n')}\n`;
}

function argument(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const invoked = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invoked) {
  const report = await collectProjectStatus({ root: argument('--root', DEFAULT_ROOT) });
  process.stdout.write(process.argv.includes('--json') ? `${JSON.stringify(report, null, 2)}\n` : formatHumanStatus(report));
}

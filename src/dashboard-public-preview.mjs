import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { URL } from 'node:url';

export const PUBLIC_PREVIEW_TIMEFRAMES = Object.freeze(['1m', '5m', '15m', '30m', '1h', '4h', '1D']);

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function stablePreviewJson(value) {
  return `${JSON.stringify(canonical(value), null, 2)}\n`;
}

export function previewSha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function strictNumeric(value) {
  if (value == null || typeof value === 'boolean') return null;
  if (typeof value === 'string' && value.trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function publicLevel(level) {
  if (!level || typeof level !== 'object') return null;
  return {
    name: level.name || null,
    availability: level.availability || 'UNAVAILABLE',
    value: strictNumeric(level.value),
    reason: level.reason || null,
    tradeDate: level.tradeDate || null,
    session: level.session || null,
    eventTime: level.eventTime || null,
    availableAt: level.availableAt || null,
    actualContract: level.actualContract || null,
    qualityStatus: level.qualityStatus || null,
    vwapSession: level.vwapSession || null,
  };
}

function publicCoverage(coverage, session) {
  const row = coverage || {};
  return {
    session,
    eventCount: strictNumeric(row.eventCount),
    firstEventTime: row.firstEventTime || null,
    lastEventTime: row.lastEventTime || null,
    availableAt: row.availableAt || null,
    actualContract: row.actualContract || null,
    qualityStatus: row.qualityStatus || 'UNAVAILABLE',
  };
}

export function sanitizePreviewChart(chart) {
  const levels = chart?.levels || {};
  return Object.freeze({
    schemaVersion: 'dw2-public-chart-v1',
    source: 'FROZEN_SNAPSHOT',
    derivationSource: 'SHIOAJI_ACTUAL_TX_EXECUTED_TICK',
    mode: 'REPLAY',
    timeframe: chart?.timeframe || null,
    tradeDate: chart?.tradeDate || null,
    sessionTradeDate: chart?.sessionTradeDate || null,
    session: chart?.session || null,
    sessionId: chart?.sessionId || null,
    actualContract: chart?.actualContract || null,
    status: chart?.status || 'UNAVAILABLE',
    reason: chart?.reason || null,
    asOf: chart?.asOf || null,
    lastPrice: strictNumeric(chart?.lastPrice),
    lastEventTime: chart?.lastEventTime || null,
    availableAt: chart?.availableAt || null,
    windowState: chart?.windowState || null,
    coverageState: chart?.coverageState || null,
    contractConsistencyState: chart?.contractConsistencyState || null,
    qualityStatus: chart?.qualityStatus || 'UNAVAILABLE',
    qualityReasons: Object.freeze([...(chart?.qualityReasons || [])]),
    sequenceGapEventCount: strictNumeric(chart?.sequenceGapEventCount),
    sequenceGapSize: strictNumeric(chart?.sequenceGapSize),
    timeLineageViolationCount: strictNumeric(chart?.timeLineageViolationCount),
    futureDataViolations: strictNumeric(chart?.futureDataViolations),
    vwapSession: chart?.vwapSession || null,
    bars: Object.freeze((chart?.bars || []).map((bar) => Object.freeze({
      time: bar.time,
      tradeDate: bar.tradeDate,
      sessionTradeDate: bar.sessionTradeDate,
      session: bar.session,
      sessionId: bar.sessionId,
      actualContract: bar.actualContract,
      open: strictNumeric(bar.open), high: strictNumeric(bar.high), low: strictNumeric(bar.low), close: strictNumeric(bar.close), volume: strictNumeric(bar.volume),
      firstEventTime: bar.firstEventTime,
      lastEventTime: bar.lastEventTime,
      availableAt: bar.availableAt,
      qualityStatus: bar.qualityStatus,
      qualityReasons: Object.freeze([...(bar.qualityReasons || [])]),
      windowState: bar.windowState || null,
      coverageState: bar.coverageState || null,
    }))),
    vwap: Object.freeze((chart?.vwap || []).map((point) => Object.freeze({
      time: point.time,
      value: strictNumeric(point.value),
      availableAt: point.availableAt,
      vwapSession: point.vwapSession || chart?.vwapSession || null,
    }))),
    openingRange: Object.freeze({
      status: chart?.openingRange?.status || 'UNAVAILABLE',
      high: strictNumeric(chart?.openingRange?.high),
      low: strictNumeric(chart?.openingRange?.low),
      reason: chart?.openingRange?.reason || null,
      availableAt: chart?.openingRange?.availableAt || null,
      qualityStatus: chart?.openingRange?.qualityStatus || null,
    }),
    levels: Object.freeze({
      currentDayHigh: publicLevel(levels.currentDayHigh),
      currentDayLow: publicLevel(levels.currentDayLow),
      nightHigh: publicLevel(levels.nightHigh),
      nightLow: publicLevel(levels.nightLow),
      previousDayHigh: publicLevel(levels.previousDayHigh),
      previousDayLow: publicLevel(levels.previousDayLow),
      previousClose: publicLevel(levels.previousClose),
      openingRangeHigh: publicLevel(levels.openingRangeHigh),
      openingRangeLow: publicLevel(levels.openingRangeLow),
      vwap: publicLevel(levels.vwap),
    }),
    sessionCoverage: Object.freeze({
      night: publicCoverage(chart?.sessionCoverage?.night, 'NIGHT'),
      day: publicCoverage(chart?.sessionCoverage?.day, 'DAY'),
    }),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

function previewWorkspace(chart, previewIdentity) {
  const lineageCount = strictNumeric(chart.timeLineageViolationCount);
  const lineageState = lineageCount == null ? 'UNKNOWN' : lineageCount > 0 ? 'QUALITY_INSUFFICIENT' : 'PASS';
  return Object.freeze({
    schemaVersion: 'dw2-public-workspace-v1',
    previewLabels: Object.freeze(['PREVIEW · NOT MAIN', 'FROZEN GOVERNED SNAPSHOT · NOT LIVE MARKET DATA', 'READ ONLY', 'NOT A TRADING SIGNAL']),
    previewIdentity: Object.freeze({ ...previewIdentity }),
    globalStatus: Object.freeze({
      mode: 'FROZEN_SNAPSHOT',
      actualContract: chart.actualContract,
      session: chart.session,
      sourceTime: chart.availableAt,
      dataHealth: chart.qualityStatus,
    }),
    decisionSummary: Object.freeze({
      posture: 'MANUAL_REVIEW_ONLY',
      readiness: 'NOT_READY',
      noTradeReason: 'FROZEN_PREVIEW_NOT_DECISION_ELIGIBLE',
      direction: 'UNAVAILABLE',
      globalAlignment: 'UNAVAILABLE',
      risk: 'UNAVAILABLE',
      entryQuality: 'UNAVAILABLE',
      strongestContraryEvidence: 'UNAVAILABLE',
      explanation: 'Frozen replay data is provided only for UI/UX review and cannot authorize a trading decision.',
    }),
    priceStructure: Object.freeze({
      actualContract: chart.actualContract,
      tradeDate: chart.tradeDate,
      session: chart.session,
      status: chart.status,
      qualityStatus: chart.qualityStatus,
      qualityReasons: chart.qualityReasons,
      vwapSession: chart.vwapSession,
      openingRange: chart.openingRange,
    }),
    dataHealth: Object.freeze({
      overall: chart.qualityStatus,
      items: Object.freeze([
        Object.freeze({ sourceId: 'txChart', freshnessState: 'FROZEN_REPLAY', quality: chart.qualityStatus, reason: chart.reason }),
        Object.freeze({ sourceId: 'timestampLineage', freshnessState: lineageState, quality: lineageState, reason: lineageState === 'QUALITY_INSUFFICIENT' ? 'TIMESTAMP_LINEAGE_INSUFFICIENT' : lineageState === 'UNKNOWN' ? 'TIMESTAMP_LINEAGE_UNAVAILABLE' : null }),
        Object.freeze({ sourceId: 'sequenceEvidence', freshnessState: 'UNAVAILABLE', quality: 'UNKNOWN', reason: 'UNKNOWN_NO_NATIVE_SEQUENCE' }),
      ]),
    }),
    writeControlsEnabled: false,
    copyForChatGptEnabled: true,
    leadershipSubscription: Object.freeze({ subscriptionState: 'DEFAULT_OFF', restorationState: 'NOT_REQUESTED' }),
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  });
}

export function createPublicPreviewSnapshot({ charts, generatedAt, previewIdentity = {} }) {
  if (!charts || typeof charts !== 'object') throw new Error('PUBLIC_PREVIEW_CHARTS_REQUIRED');
  if (!generatedAt || Number.isNaN(Date.parse(generatedAt))) throw new Error('PUBLIC_PREVIEW_GENERATED_AT_INVALID');
  const sanitizedCharts = Object.fromEntries(PUBLIC_PREVIEW_TIMEFRAMES.map((timeframe) => {
    if (!charts[timeframe]) throw new Error(`PUBLIC_PREVIEW_TIMEFRAME_MISSING:${timeframe}`);
    return [timeframe, sanitizePreviewChart(charts[timeframe])];
  }));
  const reference = sanitizedCharts['1D'];
  const identity = Object.freeze({
    branch: previewIdentity.branch || 'UNAVAILABLE',
    commit: previewIdentity.commit || 'UNAVAILABLE',
    dataMode: 'FROZEN_SNAPSHOT',
    generatedAt: new Date(generatedAt).toISOString(),
  });
  const core = {
    schemaVersion: 'dw2-public-preview-snapshot-v1',
    PREVIEW_DATA_MODE: 'FROZEN_SNAPSHOT',
    generatedAt: new Date(generatedAt).toISOString(),
    tradeDate: reference.tradeDate,
    asOf: reference.asOf,
    actualContract: reference.actualContract,
    allowedTimeframes: PUBLIC_PREVIEW_TIMEFRAMES,
    previewIdentity: identity,
    workspace: previewWorkspace(sanitizedCharts['5m'], identity),
    charts: sanitizedCharts,
    LIVE_MARKET_DATA_PUBLICLY_EXPOSED: false,
    RAW_MARKET_DATA_PUBLICLY_EXPOSED: false,
    PUBLIC_PREVIEW_FORWARD_SHADOW_WRITE: false,
    PUBLIC_PREVIEW_COLLECTOR_ACCESS: false,
    PUBLIC_PREVIEW_SQLITE_ACCESS: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  const contentHash = previewSha256(stablePreviewJson(core));
  return Object.freeze({
    ...core,
    snapshotId: `dw2-${core.tradeDate || 'unavailable'}-${contentHash.slice(0, 12)}`,
    artifactContentHash: contentHash,
  });
}

export function writePublicPreviewSnapshot(outputDir, snapshot) {
  fs.mkdirSync(outputDir, { recursive: true });
  const snapshotPath = path.join(outputDir, 'preview-snapshot.json');
  const manifestPath = path.join(outputDir, 'preview-snapshot-manifest.json');
  const snapshotBytes = Buffer.from(stablePreviewJson(snapshot), 'utf8');
  const snapshotFileHash = previewSha256(snapshotBytes);
  const manifestBody = {
    schemaVersion: 'dw2-public-preview-manifest-v1',
    snapshotId: snapshot.snapshotId,
    generatedAt: snapshot.generatedAt,
    snapshotFileName: 'preview-snapshot.json',
    snapshotFileHash,
    snapshotContentHash: snapshot.artifactContentHash,
    snapshotByteSize: snapshotBytes.length,
    allowedTimeframes: PUBLIC_PREVIEW_TIMEFRAMES,
    publicPreviewMode: 'SAFE_READ_ONLY',
    PREVIEW_DATA_MODE: 'FROZEN_SNAPSHOT',
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  const manifest = { ...manifestBody, manifestContentHash: previewSha256(stablePreviewJson(manifestBody)) };
  const manifestBytes = Buffer.from(stablePreviewJson(manifest), 'utf8');
  for (const [filePath, bytes] of [[snapshotPath, snapshotBytes], [manifestPath, manifestBytes]]) {
    if (fs.existsSync(filePath)) {
      const existing = fs.readFileSync(filePath);
      if (!existing.equals(bytes)) throw new Error('PUBLIC_PREVIEW_IMMUTABLE_ARTIFACT_CONFLICT');
      continue;
    }
    const temp = `${filePath}.${process.pid}.tmp`;
    fs.writeFileSync(temp, bytes, { flag: 'wx' });
    fs.renameSync(temp, filePath);
  }
  return Object.freeze({ snapshotPath, manifestPath, snapshotFileHash, manifestFileHash: previewSha256(manifestBytes), snapshotByteSize: snapshotBytes.length });
}

export function loadPublicPreviewArtifact(manifestPath) {
  if (!manifestPath || !fs.existsSync(manifestPath)) throw new Error('PUBLIC_PREVIEW_MANIFEST_MISSING');
  const manifestBytes = fs.readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  const { manifestContentHash, ...manifestBody } = manifest;
  if (manifest.schemaVersion !== 'dw2-public-preview-manifest-v1'
    || previewSha256(stablePreviewJson(manifestBody)) !== manifestContentHash) throw new Error('PUBLIC_PREVIEW_MANIFEST_HASH_INVALID');
  if (manifest.publicPreviewMode !== 'SAFE_READ_ONLY' || manifest.PREVIEW_DATA_MODE !== 'FROZEN_SNAPSHOT'
    || manifest.formalWeight !== 0 || manifest.researchOnly !== true || manifest.executionAuthorized !== false
    || manifest.orderRoutesEnabled !== false) {
    throw new Error('PUBLIC_PREVIEW_MANIFEST_GOVERNANCE_INVALID');
  }
  const snapshotPath = path.join(path.dirname(path.resolve(manifestPath)), 'preview-snapshot.json');
  if (!fs.existsSync(snapshotPath)) throw new Error('PUBLIC_PREVIEW_SNAPSHOT_MISSING');
  const snapshotBytes = fs.readFileSync(snapshotPath);
  if (snapshotBytes.length !== manifest.snapshotByteSize || previewSha256(snapshotBytes) !== manifest.snapshotFileHash) {
    throw new Error('PUBLIC_PREVIEW_SNAPSHOT_FILE_HASH_INVALID');
  }
  const snapshot = JSON.parse(snapshotBytes.toString('utf8'));
  const { artifactContentHash, snapshotId, ...core } = snapshot;
  if (snapshot.schemaVersion !== 'dw2-public-preview-snapshot-v1'
    || snapshotId !== manifest.snapshotId
    || artifactContentHash !== manifest.snapshotContentHash
    || previewSha256(stablePreviewJson(core)) !== artifactContentHash) throw new Error('PUBLIC_PREVIEW_SNAPSHOT_CONTENT_HASH_INVALID');
  if (snapshot.PREVIEW_DATA_MODE !== 'FROZEN_SNAPSHOT'
    || snapshot.LIVE_MARKET_DATA_PUBLICLY_EXPOSED !== false
    || snapshot.RAW_MARKET_DATA_PUBLICLY_EXPOSED !== false
    || snapshot.PUBLIC_PREVIEW_FORWARD_SHADOW_WRITE !== false
    || snapshot.PUBLIC_PREVIEW_COLLECTOR_ACCESS !== false
    || snapshot.PUBLIC_PREVIEW_SQLITE_ACCESS !== false
    || snapshot.formalWeight !== 0 || snapshot.researchOnly !== true || snapshot.executionAuthorized !== false
    || snapshot.orderRoutesEnabled !== false) {
    throw new Error('PUBLIC_PREVIEW_SNAPSHOT_GOVERNANCE_INVALID');
  }
  return Object.freeze({ manifest: Object.freeze(manifest), snapshot: Object.freeze(snapshot), snapshotPath, manifestPath: path.resolve(manifestPath) });
}

function securityHeaders(res) {
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
}

function send(res, status, body, contentType = 'application/json; charset=utf-8') {
  const bytes = Buffer.isBuffer(body) ? body : Buffer.from(typeof body === 'string' ? body : JSON.stringify(body), 'utf8');
  res.writeHead(status, { 'Content-Type': contentType, 'Content-Length': bytes.length });
  res.end(bytes);
}

export function createPublicPreviewServer({
  manifestPath,
  publicDir,
  sharedPublicDir,
  lightweightChartsPath,
  host = '127.0.0.1',
  port = 8798,
  publicPreviewMode = false,
} = {}) {
  if (publicPreviewMode !== true) throw new Error('PUBLIC_PREVIEW_MODE_NOT_ENABLED');
  if (host !== '127.0.0.1') throw new Error('PUBLIC_PREVIEW_HOST_MUST_BE_LOOPBACK');
  if (![8798].includes(Number(port))) throw new Error('PUBLIC_PREVIEW_PORT_NOT_APPROVED');
  const artifact = loadPublicPreviewArtifact(manifestPath);
  const staticFiles = new Map([
    ['/', [path.join(publicDir, 'index.html'), 'text/html; charset=utf-8']],
    ['/assets/app.js', [path.join(publicDir, 'app.js'), 'text/javascript; charset=utf-8']],
    ['/assets/styles.css', [path.join(publicDir, 'styles.css'), 'text/css; charset=utf-8']],
    ['/vendor/lightweight-charts.js', [lightweightChartsPath, 'text/javascript; charset=utf-8']],
  ]);
  if (sharedPublicDir) {
    staticFiles.set('/assets/dashboard-styles.css', [path.join(sharedPublicDir, 'styles.css'), 'text/css; charset=utf-8']);
    staticFiles.set('/assets/trader-terminal-shell.css', [path.join(sharedPublicDir, 'trader-terminal-shell.css'), 'text/css; charset=utf-8']);
    staticFiles.set('/assets/trader-terminal-shell.js', [path.join(sharedPublicDir, 'trader-terminal-shell.js'), 'text/javascript; charset=utf-8']);
  }
  const server = http.createServer((req, res) => {
    securityHeaders(res);
    const url = new URL(req.url || '/', 'http://127.0.0.1');
    if (!['GET', 'HEAD'].includes(req.method || 'GET')) {
      send(res, 405, { ok: false, error: 'READ_ONLY_PREVIEW' });
      return;
    }
    if (url.pathname === '/healthz') {
      send(res, 200, { ok: true, service: 'dw2-public-preview', PREVIEW_DATA_MODE: 'FROZEN_SNAPSHOT', executionAuthorized: false, orderRoutesEnabled: false });
      return;
    }
    if (url.pathname === '/api/public-preview/workspace') {
      send(res, 200, { ok: true, data: artifact.snapshot.workspace, source: 'FROZEN_SNAPSHOT' });
      return;
    }
    if (url.pathname === '/api/public-preview/tx-chart') {
      const timeframe = url.searchParams.get('timeframe') || '5m';
      if (!PUBLIC_PREVIEW_TIMEFRAMES.includes(timeframe)) {
        send(res, 400, { ok: false, error: 'INVALID_PREVIEW_TIMEFRAME' });
        return;
      }
      send(res, 200, { ok: true, data: artifact.snapshot.charts[timeframe], source: 'FROZEN_SNAPSHOT' });
      return;
    }
    const item = staticFiles.get(url.pathname);
    if (item) {
      const [filePath, contentType] = item;
      if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
        send(res, 404, { ok: false, error: 'NOT_FOUND' });
        return;
      }
      send(res, 200, fs.readFileSync(filePath), contentType);
      return;
    }
    send(res, 404, { ok: false, error: 'NOT_FOUND' });
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  return Object.freeze({ server, artifact, host, port: Number(port) });
}

export function scanPublicPreviewPayload(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  const patterns = [
    /[A-Za-z]:\\[^\s"']+/g,
    /(?:ghp|github_pat|sk|cf)[_-][A-Za-z0-9_-]{16,}/g,
    /Bearer\s+[A-Za-z0-9._~-]+/gi,
    /(?:api[_-]?key|secret|password|cookie|credential)\s*[:=]\s*[^,}\s]+/gi,
    /(?:live-events|\.sqlite|\.db|forward-shadow[/\\][^\s"']+)/gi,
  ];
  return Object.freeze(patterns.flatMap((pattern) => [...text.matchAll(pattern)].map((match) => match[0])));
}

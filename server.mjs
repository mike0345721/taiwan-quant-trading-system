import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { URL } from 'node:url';
import { config, validateConfig } from './src/config.mjs';
import { CacheStore } from './src/cache-store.mjs';
import { MarketDataService } from './src/market-data.mjs';
import { enrichSnapshot } from './src/derived-metrics.mjs';
import { buildSignal } from './src/signal-engine.mjs';
import { buildSixAxisShadow } from './src/six-axis-shadow.mjs';
import { backtestComponents } from './src/backtest.mjs';
import { V2ResearchService } from './src/v2-research.mjs';
import { loadPriceConfirmation } from './src/intraday-confirmation.mjs';
import { listReplayDays, loadCatalogReplay } from './src/intraday-replay-catalog.mjs';
import { marketFeedReadiness } from './src/market-feed.mjs';
import { inspectIx0001Leadership, inspectShioajiBridge } from './src/shioaji-bridge-client.mjs';
import { costScenarios } from './v2/src/trading-costs.mjs';
import { buildDataHealthContract } from './src/dashboard-data-health.mjs';
import { buildDecisionWorkspace } from './src/dashboard-decision-workspace.mjs';
import { readDashboardRuntimeTruth } from './src/dashboard-runtime-truth.mjs';
import { appendDecisionJournal, readDecisionJournal } from './src/decision-journal.mjs';
import { loadGovernedTradingCalendar } from './src/market-state-forward-shadow-calendar.mjs';
import { loadTxDecisionChart } from './src/dashboard-tx-chart-source.mjs';
import { buildMarketChangeFeed, chartMarkersFromEvents } from './src/market-change-feed.mjs';
import { buildRuntimeVersionStatus, readRuntimeIdentity } from './src/runtime-identity.mjs';
import {
  buildIntegrationPreviewVersion,
  CRU46_PRODUCT_SURFACE_CONTRACT,
  validateIntegrationPreviewVersionTruth,
} from './src/dashboard-integration-contract.mjs';
import { loadIx0001BreadthForWorkspace } from './src/dashboard-live-breadth-source.mjs';
import { loadDashboardObservedFlow } from './src/dashboard-observed-flow.mjs';
import {
  buildCru46Readiness,
  inspectChartPayload,
  inspectChartVendorRuntime,
  inspectCru34LiveProducer,
  inspectObservedFlowPayload,
  normalizeBrowserRuntimeProof,
  validateBrowserRuntimeParity,
  validateBrowserRuntimeProof,
} from './src/dashboard-runtime-readiness.mjs';
import {
  SessionStore,
  LoginRateLimiter,
  verifyPassword,
  parseCookies,
  sessionCookie,
  clearSessionCookie,
  safeEqual,
} from './src/security.mjs';
import {
  setSecurityHeaders,
  sendJson,
  sendText,
  readJson,
  serveStatic,
  clientIp,
  requestIsHttps,
} from './src/http-utils.mjs';

validateConfig();

const cache = new CacheStore({ dataDir: config.dataDir, historyDir: config.historyDir });
await cache.init();
let latestSnapshot = await cache.loadLatest();
const marketData = new MarketDataService({ timeoutMs: config.upstreamTimeoutMs, mockData: config.mockData });
const expectedDataMode = config.mockData ? 'mock' : 'live';
const sessions = new SessionStore(config.sessionTtlMs, { filePath: path.join(config.dataDir, 'sessions.json') });
const loginLimiter = new LoginRateLimiter();
const v2Research = new V2ResearchService();
let dailyUpdateProcess = null;
const intradayPath = path.join(config.dataDir, 'intraday', 'latest-bars.json');
const replayPath = path.join(config.dataDir, 'intraday', 'replay-bars.json');
const replayArchiveDir = path.join(config.dataDir, 'intraday', 'archive');
const decisionJournalPath = path.join(config.dataDir, 'decision-workspace', 'journal.ndjson');
const forwardShadowBaseRoot = path.join(config.appRoot, 'data', 'market-state', 'forward-shadow');
const futuresAuditPath = path.join(config.appRoot, 'data', 'live-events', 'futures-audits', 'latest.json');
const shioajiContinuityStatusPath = path.join(config.appRoot, 'data', 'runtime', 'shioaji-continuity', 'status.json');
const chartCalendarPath = path.join(config.appRoot, 'config', 'taifex-official-calendar-2026.json');
const chartCalendarExceptionPath = path.join(config.appRoot, 'data', 'market-state', 'forward-shadow', 'governance', 'taifex-official-calendar-exception.json');
const chartCalendar = loadGovernedTradingCalendar(chartCalendarPath, fs.existsSync(chartCalendarExceptionPath) ? chartCalendarExceptionPath : null);
const txChartDataRoot = path.resolve(process.env.TX_CHART_DATA_ROOT || config.dataDir);
const txChartCacheRoot = path.resolve(process.env.TX_CHART_CACHE_ROOT || path.join(config.dataDir, 'dashboard-chart-cache'));
const cru34SnapshotArtifactPath = process.env.CRU34_SNAPSHOT_ARTIFACT_PATH
  ? path.resolve(process.env.CRU34_SNAPSHOT_ARTIFACT_PATH)
  : null;
const cru34SnapshotFreshnessCutoff = process.env.CRU34_SNAPSHOT_FRESHNESS_CUTOFF || null;
const cru34LiveSnapshotPath = process.env.CRU34_LIVE_SNAPSHOT_PATH
  ? path.resolve(process.env.CRU34_LIVE_SNAPSHOT_PATH)
  : null;
const cru34LiveStatusPath = process.env.CRU34_LIVE_STATUS_PATH
  ? path.resolve(process.env.CRU34_LIVE_STATUS_PATH)
  : null;
const lightweightChartsPath = path.resolve(process.env.DASHBOARD_LIGHTWEIGHT_CHARTS_PATH
  || path.join(config.appRoot, 'node_modules', 'lightweight-charts', 'dist', 'lightweight-charts.standalone.production.js'));
const lightweightChartsPackagePath = path.resolve(process.env.DASHBOARD_LIGHTWEIGHT_CHARTS_PACKAGE_PATH
  || path.join(config.appRoot, 'node_modules', 'lightweight-charts', 'package.json'));
const cru34LiveDataRoot = path.resolve(process.env.CRU34_LIVE_DATA_ROOT || path.join(config.appRoot, 'data'));
const cru34LiveProjectionRoot = path.dirname(cru34LiveSnapshotPath || path.join(config.appRoot, 'data', 'runtime', 'cru34-live', 'latest.json'));
const runtimeIdentity = readRuntimeIdentity(config.appRoot);
const approvedMainIdentity = readRuntimeIdentity(config.appRoot, { ref: 'refs/heads/main' });
const runtimeStartedAt = new Date().toISOString();
const baseRuntimeVersion = buildRuntimeVersionStatus({ runtimeIdentity, approvedMainIdentity, runtimeStartedAt });
const runtimeVersion = buildIntegrationPreviewVersion({
  runtimeVersion: baseRuntimeVersion,
  enabled: process.env.DASHBOARD_PREVIEW_TYPE === 'INTEGRATION_OWNER_PREVIEW',
  branch: process.env.DASHBOARD_PREVIEW_BRANCH,
  dataMode: process.env.DASHBOARD_PREVIEW_DATA_MODE || expectedDataMode.toUpperCase(),
});
let lastRefreshError = null;
let browserRuntimeProof = null;

function currentCru46RuntimeReadiness() {
  const identity = validateIntegrationPreviewVersionTruth(runtimeVersion, runtimeIdentity.commit);
  const chartPayload = loadTxDecisionChart({ dataRoot: txChartDataRoot, cacheRoot: txChartCacheRoot,
    calendar: chartCalendar, timeframe: '5m', mode: 'LIVE' });
  const flow = loadDashboardObservedFlow({ liveSnapshotPath: cru34LiveSnapshotPath, liveStatusPath: cru34LiveStatusPath });
  const vendor = inspectChartVendorRuntime({ bundlePath: lightweightChartsPath,
    packagePath: lightweightChartsPackagePath, expectedVersion: '5.2.0' });
  const producer = inspectCru34LiveProducer({ snapshotPath: cru34LiveSnapshotPath, statusPath: cru34LiveStatusPath,
    dataRoot: cru34LiveDataRoot, projectionRoot: cru34LiveProjectionRoot });
  const chart = inspectChartPayload(chartPayload);
  const observedFlow = inspectObservedFlowPayload(flow);
  const browser = validateBrowserRuntimeProof(browserRuntimeProof,
    { exactHead: runtimeIdentity.commit, runtimeStartedAt });
  const readiness = buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser });
  return { ...readiness, vendor, producer, chart, observedFlow, parity: readiness.runtimeReady.parity, browser };
}

function readLocalJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

async function decisionWorkspacePayload(snapshot, service) {
  const indexLeadership = service?.indexLeadership || null;
  const runtimeTruth = await readDashboardRuntimeTruth({
    baseRoot: forwardShadowBaseRoot,
    explicitRoot: process.env.FORWARD_SHADOW_RUNTIME_ROOT || null,
  });
  const chart = loadTxDecisionChart({ dataRoot: txChartDataRoot, cacheRoot: txChartCacheRoot, calendar: chartCalendar, timeframe: '5m', mode: 'LIVE' });
  const currentIdentity = chart?.tradeDate && chart?.actualContract && chart?.session
    ? { state: 'AVAILABLE', tradeDate: chart.tradeDate, contract: chart.actualContract, session: chart.session }
    : { state: 'UNAVAILABLE', tradeDate: null, contract: null, session: null };
  const liveBreadth = loadIx0001BreadthForWorkspace({
    dataRoot: txChartDataRoot,
    currentIdentity,
    asOf: chart?.asOf || new Date().toISOString(),
  });
  const globalContext = snapshot?.researchDecision?.globalContext || null;
  const dataHealth = buildDataHealthContract({
    snapshot,
    service,
    runtimeTruth,
    futuresAudit: readLocalJson(futuresAuditPath),
    chart,
    liveBreadth,
    indexLeadership,
    globalContext,
  });
  const feed = buildMarketChangeFeed(chart);
  const marketChangeFeed = Object.freeze({ ...feed, markers: chartMarkersFromEvents(feed.events, chart) });
  const observedFlow = loadDashboardObservedFlow({
    artifactPath: cru34SnapshotArtifactPath,
    freshnessCutoff: cru34SnapshotFreshnessCutoff,
    liveSnapshotPath: cru34LiveSnapshotPath,
    liveStatusPath: cru34LiveStatusPath,
  });
  return buildDecisionWorkspace({
    snapshot, dataHealth, runtimeTruth, chart, marketChangeFeed, liveBreadth, runtimeVersion, indexLeadership,
    productSurface: CRU46_PRODUCT_SURFACE_CONTRACT,
    observedFlow,
  });
}

function loadMarketChangeFeed({ mode = 'LIVE', tradeDate = null, session = null, actualContract = null, asOf = null } = {}) {
  const chart = loadTxDecisionChart({
    dataRoot: txChartDataRoot,
    cacheRoot: txChartCacheRoot,
    calendar: chartCalendar,
    timeframe: '5m',
    mode,
    tradeDate,
    session,
    actualContract,
    asOf,
  });
  const feed = buildMarketChangeFeed(chart);
  return Object.freeze({ chart, feed: Object.freeze({ ...feed, markers: chartMarkersFromEvents(feed.events, chart) }) });
}

function preliveStatus(snapshot = latestSnapshot, shioaji = null) {
  const referencePrice = Number(snapshot?.futuresMarket?.data?.txDay?.close || snapshot?.marketOverview?.data?.twii?.price);
  const replayDates = listReplayDays(replayArchiveDir);
  const replay = loadCatalogReplay(replayArchiveDir, replayPath, { cursor: Number.MAX_SAFE_INTEGER });
  const feedReadiness = marketFeedReadiness({ replayFrame: replay, brokerConnected: Boolean(shioaji?.connected) });
  return {
    version: '3.7.3',
    referencePrice: Number.isFinite(referencePrice) ? referencePrice : null,
    costScenarios: costScenarios(referencePrice),
    marketFeed: {
      ...feedReadiness,
      liveProvider: shioaji,
      replayDays: replayDates.length,
      replayDates,
      defaultReplayDate: replay.defaultTradeDate || replay.selectedTradeDate || null,
    },
    phases: [
      { key: 'cost_model', label: '真實成本模型', status: 'ready' },
      { key: 'five_minute_replay', label: '5分鐘歷史回放', status: replay.totalBars ? 'ready' : 'awaiting_data' },
      { key: 'broker_adapter', label: '券商行情接口', status: 'interface_ready' },
      { key: 'paper_trade', label: '模擬交易紀錄', status: 'planned' },
    ],
    readOnly: true,
    executionAuthorized: false,
  };
}

async function refreshSnapshot() {
  try {
    const snapshot = await marketData.refresh(latestSnapshot);
    enrichSnapshot(snapshot, await cache.listHistory(400));
    snapshot.signal = buildSignal(snapshot);
    snapshot.researchDecision = v2Research.decisionSupport();
    snapshot.priceConfirmation = loadPriceConfirmation(intradayPath);
    snapshot.sixAxisShadow = buildSixAxisShadow(snapshot);
    await cache.save(snapshot);
    latestSnapshot = snapshot;
    lastRefreshError = null;
    return snapshot;
  } catch (error) {
    lastRefreshError = { message: error.message, at: new Date().toISOString() };
    throw error;
  }
}

function getSession(req) {
  const cookies = parseCookies(req.headers.cookie || '');
  return sessions.get(cookies.twchip_session);
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { ok: false, error: 'AUTH_REQUIRED' });
    return null;
  }
  return session;
}

function requireCsrf(req, res, session) {
  const token = req.headers['x-csrf-token'];
  if (!safeEqual(token, session.csrf)) {
    sendJson(res, 403, { ok: false, error: 'CSRF_INVALID' });
    return false;
  }
  return true;
}

const server = http.createServer(async (req, res) => {
  const isHttps = requestIsHttps(req, config.trustProxy);
  setSecurityHeaders(res, { isHttps });
  res.setHeader('X-Request-Id', crypto.randomUUID());

  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  const ip = clientIp(req, config.trustProxy);

  try {
    if (req.method === 'GET' && pathname === '/healthz') {
      const readiness = currentCru46RuntimeReadiness();
      sendJson(res, 200, {
        ok: true,
        service: 'tw-chip-dashboard-v1',
        runtimeCommit: runtimeIdentity.commit,
        runtimeIdentityStatus: runtimeIdentity.status,
        approvedMainCommit: runtimeVersion.approvedMainCommit,
        runtimeStartedAt: runtimeVersion.runtimeStartedAt,
        syncState: runtimeVersion.syncState,
        versionTruth: runtimeVersion,
        identityReady: readiness.identityReady,
        runtimePreflightReady: readiness.runtimePreflightReady,
        runtimeReady: readiness.runtimeReady,
        ownerPreviewReady: readiness.ownerPreviewReady,
        ownerPreviewReadiness: readiness.ownerPreviewReady,
        runtimeEvidence: { vendor: readiness.vendor, producer: readiness.producer,
          chart: readiness.chart, observedFlow: readiness.observedFlow, parity: readiness.parity, browser: readiness.browser },
        productSurface: CRU46_PRODUCT_SURFACE_CONTRACT,
      });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/login') {
      const rate = loginLimiter.check(ip);
      if (!rate.allowed) {
        sendJson(res, 429, { ok: false, error: 'TOO_MANY_ATTEMPTS' }, { 'Retry-After': String(rate.retryAfterSeconds) });
        return;
      }
      const body = await readJson(req, { maxBytes: 4096 });
      const password = typeof body.password === 'string' ? body.password : '';
      const remember = body.remember === true;
      const valid = config.passwordHash ? verifyPassword(password, config.passwordHash) : config.nodeEnv !== 'production';
      if (!valid) {
        loginLimiter.fail(ip);
        await new Promise((resolve) => setTimeout(resolve, 250 + Math.floor(Math.random() * 250)));
        sendJson(res, 401, { ok: false, error: 'INVALID_CREDENTIALS' });
        return;
      }
      loginLimiter.success(ip);
      const sessionTtlMs = remember ? config.rememberedSessionTtlMs : config.sessionTtlMs;
      const session = sessions.create(ip, sessionTtlMs);
      const secure = config.cookieSecure || isHttps;
      res.setHeader('Set-Cookie', sessionCookie(session.id, { secure, maxAgeSeconds: sessionTtlMs / 1000 }));
      sendJson(res, 200, { ok: true, csrfToken: session.csrf, expiresAt: session.expiresAt });
      return;
    }

    if (req.method === 'GET' && pathname === '/api/session') {
      const session = getSession(req);
      sendJson(res, 200, session
        ? { ok: true, authenticated: true, csrfToken: session.csrf, expiresAt: session.expiresAt }
        : { ok: true, authenticated: false });
      return;
    }

    if (req.method === 'POST' && pathname === '/api/auth/logout') {
      const session = requireSession(req, res);
      if (!session || !requireCsrf(req, res, session)) return;
      sessions.delete(session.id);
      res.setHeader('Set-Cookie', clearSessionCookie({ secure: config.cookieSecure || isHttps }));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname.startsWith('/api/v1/')) {
      const session = requireSession(req, res);
      if (!session) return;

      if (req.method === 'GET' && pathname === '/api/v1/dashboard') {
        if (!latestSnapshot || latestSnapshot.dataMode !== expectedDataMode) {
          try { await refreshSnapshot(); } catch { /* status returned below */ }
        }
        const shioaji = await inspectShioajiBridge({ continuityRuntime: readLocalJson(shioajiContinuityStatusPath) });
        const indexLeadership = await inspectIx0001Leadership({ bridge: shioaji });
        const clientHistory = latestSnapshot ? await cache.listHistory(400) : [];
        const clientSnapshot = latestSnapshot ? {
          ...latestSnapshot,
          researchDecision: v2Research.decisionSupport(),
          priceConfirmation: loadPriceConfirmation(intradayPath),
        } : null;
        if (clientSnapshot) {
          enrichSnapshot(clientSnapshot, clientHistory);
          clientSnapshot.sixAxisShadow = buildSixAxisShadow(clientSnapshot);
        }
        const servicePayload = {
          readOnly: true,
          brokerConnected: shioaji.connected,
          brokerMarketData: shioaji,
          lastRefreshError,
          prelive: preliveStatus(latestSnapshot, shioaji),
          runtimeVersion,
          productSurface: CRU46_PRODUCT_SURFACE_CONTRACT,
          indexLeadership,
        };
        const decisionWorkspace = clientSnapshot
          ? await decisionWorkspacePayload(clientSnapshot, servicePayload)
          : null;
        sendJson(res, latestSnapshot ? 200 : 503, {
          ok: Boolean(latestSnapshot),
          data: clientSnapshot,
          service: servicePayload,
          decisionWorkspace,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/cru46-browser-runtime-proof') {
        if (!requireCsrf(req, res, session)) return;
        const candidate = await readJson(req, { maxBytes: 16 * 1024 });
        const chartPayload = loadTxDecisionChart({ dataRoot: txChartDataRoot, cacheRoot: txChartCacheRoot,
          calendar: chartCalendar, timeframe: '5m', mode: 'LIVE' });
        const chart = inspectChartPayload(chartPayload);
        const flow = inspectObservedFlowPayload(loadDashboardObservedFlow({
          liveSnapshotPath: cru34LiveSnapshotPath, liveStatusPath: cru34LiveStatusPath }));
        const normalized = normalizeBrowserRuntimeProof(candidate,
          { exactHead: runtimeIdentity.commit, runtimeStartedAt });
        const validated = validateBrowserRuntimeProof(normalized,
          { exactHead: runtimeIdentity.commit, runtimeStartedAt });
        const browserParity = validateBrowserRuntimeParity(normalized, { chart, observedFlow: flow });
        if (!validated.ready || !browserParity.ready || !chart.ready || !flow.ready) {
          sendJson(res, 422, { ok: false, error: 'CRU46_BROWSER_RUNTIME_PROOF_REJECTED',
            reasons: [...validated.reasons, ...browserParity.reasons, ...chart.reasons, ...flow.reasons] });
          return;
        }
        browserRuntimeProof = Object.freeze(normalized);
        sendJson(res, 200, { ok: true, data: browserRuntimeProof });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/index-leadership') {
        const bridge = await inspectShioajiBridge({ continuityRuntime: readLocalJson(shioajiContinuityStatusPath) });
        const leadership = await inspectIx0001Leadership({ bridge });
        sendJson(res, 200, {
          ok: true,
          data: leadership,
          cachePolicy: 'BOUNDED_8790_LATEST_MEMORY',
          recommendedPollMs: 5_000,
          executionAuthorized: false,
          orderRoutesEnabled: false,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/decision-journal') {
        const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        sendJson(res, 200, {
          ok: true,
          data: readDecisionJournal(decisionJournalPath, { limit }),
          storage: 'LOCAL_APPEND_ONLY_ISOLATED',
          executionAuthorized: false,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/tx-chart') {
        const timeframe = url.searchParams.get('timeframe') || '5m';
        const mode = url.searchParams.get('mode') === 'REPLAY' ? 'REPLAY' : 'LIVE';
        const tradeDate = url.searchParams.get('tradeDate') || null;
        const sessionType = url.searchParams.get('session');
        const selectedSession = ['DAY', 'NIGHT'].includes(sessionType) ? sessionType : null;
        const actualContract = url.searchParams.get('actualContract') || null;
        const asOf = url.searchParams.get('asOf') || null;
        const chart = loadTxDecisionChart({
          dataRoot: txChartDataRoot,
          cacheRoot: txChartCacheRoot,
          calendar: chartCalendar,
          timeframe,
          mode,
          tradeDate,
          session: selectedSession,
          actualContract,
          asOf,
        });
        sendJson(res, 200, { ok: true, data: chart });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/market-changes') {
        const mode = url.searchParams.get('mode') === 'REPLAY' ? 'REPLAY' : 'LIVE';
        const tradeDate = url.searchParams.get('tradeDate') || null;
        const sessionType = url.searchParams.get('session');
        const selectedSession = ['DAY', 'NIGHT'].includes(sessionType) ? sessionType : null;
        const actualContract = url.searchParams.get('actualContract') || null;
        const asOf = url.searchParams.get('asOf') || null;
        const { feed } = loadMarketChangeFeed({ mode, tradeDate, session: selectedSession, actualContract, asOf });
        sendJson(res, 200, { ok: true, data: feed });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/decision-journal') {
        if (!requireCsrf(req, res, session)) return;
        const body = await readJson(req, { maxBytes: 512 * 1024 });
        const entry = appendDecisionJournal(decisionJournalPath, body);
        sendJson(res, 201, { ok: true, data: entry, executionAuthorized: false });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/history') {
        const limit = Math.max(1, Math.min(90, Number.parseInt(url.searchParams.get('limit') || '30', 10) || 30));
        sendJson(res, 200, { ok: true, data: await cache.listHistory(limit) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/backtest') {
        sendJson(res, 200, { ok: true, data: backtestComponents(await cache.listHistory(400)) });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/intraday/replay') {
        const cursor = url.searchParams.get('cursor');
        const tradeDate = url.searchParams.get('tradeDate');
        sendJson(res, 200, { ok: true, data: loadCatalogReplay(replayArchiveDir, replayPath, { tradeDate, cursor }) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/refresh') {
        if (!requireCsrf(req, res, session)) return;
        const snapshot = await refreshSnapshot();
        sendJson(res, 200, { ok: true, data: snapshot });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/security-status') {
        sendJson(res, 200, {
          ok: true,
          data: {
            readOnly: true,
            brokerCredentialsPresent: false,
            browserReceivesSecrets: false,
            authenticationRequired: true,
            cookieSecureConfigured: config.cookieSecure,
            mockData: config.mockData,
          },
        });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      return;
    }

    if (pathname.startsWith('/api/v2/')) {
      const session = requireSession(req, res);
      if (!session) return;

      if (req.method === 'GET' && pathname === '/api/v2/research') {
        const data = v2Research.query({
          days: url.searchParams.get('days'),
          delta: url.searchParams.get('delta'),
          contract: url.searchParams.get('contract'),
        });
        sendJson(res, 200, { ok: true, data });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v2/backtests') {
        sendJson(res, 200, { ok: true, data: v2Research.backtestReport() });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v2/daily-update') {
        sendJson(res, 200, { ok: true, data: v2Research.dailyUpdateStatus(), processRunning: Boolean(dailyUpdateProcess) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v2/daily-update') {
        if (!requireCsrf(req, res, session)) return;
        if (dailyUpdateProcess) {
          sendJson(res, 409, { ok: false, error: 'DAILY_UPDATE_ALREADY_RUNNING' });
          return;
        }
        const scriptPath = path.join(config.appRoot, 'v2', 'scripts', 'run-v3-daily-update.mjs');
        dailyUpdateProcess = spawn(process.execPath, [scriptPath], {
          cwd: path.join(config.appRoot, 'v2'), env: { ...process.env }, stdio: 'ignore', windowsHide: true,
        });
        dailyUpdateProcess.once('exit', () => { dailyUpdateProcess = null; });
        dailyUpdateProcess.once('error', () => { dailyUpdateProcess = null; });
        sendJson(res, 202, { ok: true, data: { state: 'starting', formalResearchRerun: false } });
        return;
      }

      sendJson(res, 404, { ok: false, error: 'NOT_FOUND' });
      return;
    }

    if (req.method === 'GET') {
      if (pathname === '/vendor/lightweight-charts.js') {
        const served = await serveStatic(res, path.dirname(lightweightChartsPath), `/${path.basename(lightweightChartsPath)}`);
        if (served) return;
      }
      const served = await serveStatic(res, config.publicDir, pathname);
      if (served) return;
      // SPA fallback only for paths without a file extension.
      if (!pathname.includes('.')) {
        const fallback = await serveStatic(res, config.publicDir, '/index.html');
        if (fallback) return;
      }
    }

    sendText(res, 404, 'Not found');
  } catch (error) {
    const status = Number.isInteger(error.statusCode) ? error.statusCode : 500;
    if (status >= 500) console.error(`[server] ${req.method} ${pathname}:`, error.message);
    sendJson(res, status, { ok: false, error: status >= 500 ? 'INTERNAL_ERROR' : error.message });
  }
});

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

server.listen(config.port, config.host, async () => {
  console.log(`台股決策雷達 V3.7.3：http://${config.host}:${config.port}`);
  console.log(`模式：${config.mockData ? 'MOCK' : 'LIVE'}；只讀：是；券商連線：無`);
  // Always check upstream sources on startup. The cached snapshot is shown only
  // while this first refresh is in progress or if an official source fails.
  refreshSnapshot().catch((error) => console.error('[initial refresh]', error.message));
});

if (config.refreshIntervalMs > 0) {
  const timer = setInterval(() => {
    refreshSnapshot().catch((error) => console.error('[scheduled refresh]', error.message));
    sessions.cleanup();
  }, config.refreshIntervalMs);
  timer.unref();
}

function shutdown(signal) {
  console.log(`收到 ${signal}，停止服務…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

import http from 'node:http';
import { assessCandidateMarketInputs } from './src/candidate-market-inputs.mjs';
import { MARKET_CANDIDATE_SCOPE, MARKET_CANDIDATE_PREVIEW, assertMarketCandidateMode,
  assertMarketCandidateEnvironmentRoots, assertMarketCandidateFilesystemRoots, buildMarketCandidateVersion, validateMarketCandidateVersionTruth,
  marketCandidateRouteAllowed, marketCandidateQueryAllowed, marketCandidateBrowserBindingMatches } from './src/cru21-market-candidate.mjs';
import { resolveDashboardReadDataRoot } from './src/dashboard-source-binding.mjs';
import { InlineAssistant } from './src/ask-gpt-inline-service.mjs';
import { createInlineHandler } from './src/ask-gpt-inline-http.mjs';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { buildCru21PreviewVersion, validateCru21PreviewVersionTruth } from './src/cru21-preview-contract.mjs';
import { URL } from 'node:url';
import { config, validateConfig } from './src/config.mjs';
import { CacheStore } from './src/cache-store.mjs';
import { MarketDataService } from './src/market-data.mjs';
import { sourceStatusesForSnapshot } from './src/data-quality.mjs';
import { enrichSnapshot } from './src/derived-metrics.mjs';
import { buildSignal } from './src/signal-engine.mjs';
import { buildSixAxisShadow } from './src/six-axis-shadow.mjs';
import { backtestComponents } from './src/backtest.mjs';
import { V2ResearchService } from './src/v2-research.mjs';
import { createGovernedV2Reader } from './src/dashboard-v2-reader-binding.mjs';
import { loadPriceConfirmation } from './src/intraday-confirmation.mjs';
import { listReplayDays, loadCatalogReplay } from './src/intraday-replay-catalog.mjs';
import { marketFeedReadiness } from './src/market-feed.mjs';
import { inspectIx0001Leadership, inspectShioajiBridge, inspectShioajiLatest } from './src/shioaji-bridge-client.mjs';
import { costScenarios } from './v2/src/trading-costs.mjs';
import { buildDataHealthContract } from './src/dashboard-data-health.mjs';
import { readDataOperations } from './src/dashboard-data-operations.mjs';
import { resolveOperationsReader } from './src/data-operations-binding.mjs';
import { readDataOperationsReaderIdentity } from './src/dashboard-data-operations-reader-identity.mjs';
import { buildDecisionWorkspace, copyForChatGpt } from './src/dashboard-decision-workspace.mjs';
import { buildDecisionLevelWatch } from './src/decision-level-watch.mjs';
import { readDashboardRuntimeTruth } from './src/dashboard-runtime-truth.mjs';
import { appendDecisionJournal, readDecisionJournal, appendDecisionOutcome, readDecisionOutcomes } from './src/decision-journal.mjs';
import { loadGovernedTradingCalendar } from './src/market-state-forward-shadow-calendar.mjs';
import { assessTaifexMarketSession } from './src/taifex-market-operation.mjs';
import { loadOperatingCalendar } from './src/operating-calendar.mjs';
import { createTxChartService } from './src/dashboard-tx-chart-service.mjs';
import { observationDecisionSnapshot } from './src/market-observation-journal.mjs';
import { prepareFormalEntry } from './src/cru55-formal-entry.mjs';
import { buildMarketChangeFeed, chartMarkersFromEvents } from './src/market-change-feed.mjs';
import { buildRuntimeVersionStatus, readRuntimeIdentity, validateFormalRuntimeVersionTruth } from './src/runtime-identity.mjs';
import {
  buildCru44PreviewVersion,
  buildIntegrationPreviewVersion,
  CRU44_PRODUCT_SURFACE_CONTRACT,
  CRU46_PRODUCT_SURFACE_CONTRACT,
  selectDashboardProductSurface,
  validateCru44PreviewVersionTruth,
  validateIntegrationPreviewVersionTruth,
} from './src/dashboard-integration-contract.mjs';
import { loadIx0001BreadthForWorkspace } from './src/dashboard-live-breadth-source.mjs';
import { loadDashboardObservedFlow } from './src/dashboard-observed-flow.mjs';
import { buildResearchEvidence, readLatestResearchQuote, readResearchResult } from './src/dashboard-research-evidence.mjs';
import { loadFlowRefresh } from './src/dashboard-flow-refresh.mjs';
import { buildMarketPulseLive } from './src/market-pulse-live.mjs';
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

import { createDashboardServer, assertLocalMarketMode } from './src/dashboard-local-tls.mjs';
validateConfig();
// Fail before cache/session/account initialization for an invalid scoped release.
const marketCandidate = assertMarketCandidateMode(process.env, config);
const localMarketOnly = marketCandidate ? false : assertLocalMarketMode(process.env, config);
// Reject roots/version before any cache, Session, managed-entry or research initialization.
const marketCandidateStartup = marketCandidate ? (() => {
  const roots = assertMarketCandidateEnvironmentRoots(process.env, config);
  assertMarketCandidateFilesystemRoots(roots);
  const runtimeIdentity = readRuntimeIdentity(config.appRoot);
  const approvedMainIdentity = readRuntimeIdentity(config.appRoot, {ref:'refs/heads/main'});
  const git = args => execFileSync('git', ['--no-optional-locks','-c','core.fsmonitor=false','-c','core.untrackedCache=false',...args],
    {cwd:config.appRoot,encoding:'utf8',windowsHide:true,timeout:2000}).trim();
  const actualTree = git(['rev-parse','HEAD^{tree}']);
  const actualBranch = git(['branch','--show-current']);
  const sourceClean = git(['status','--porcelain']) === '';
  const runtimeStartedAt = new Date().toISOString();
  const baseVersion = buildRuntimeVersionStatus({runtimeIdentity,approvedMainIdentity,runtimeStartedAt});
  const version = buildMarketCandidateVersion({runtimeVersion:{...baseVersion,runtimeTree:actualTree},
    branch:process.env.DASHBOARD_PREVIEW_BRANCH,dataMode:'LIVE'});
  const truth = validateMarketCandidateVersionTruth(version, {expectedHead:process.env.DASHBOARD_PREVIEW_EXPECTED_HEAD,
    expectedTree:process.env.DASHBOARD_PREVIEW_EXPECTED_TREE,actualTree,
    expectedBaseMain:process.env.DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN,actualBranch,sourceClean,
    host:config.host,port:config.port,inlineEnabled:false,candidateReadRoot:roots.readDataRoot,actualDataMode:'LIVE'});
  if (!truth.ready) throw Error('MARKET_CANDIDATE_STARTUP_REJECTED');
  return {roots,runtimeIdentity,approvedMainIdentity,runtimeStartedAt,sourceClean,version,truth};
})() : null;
if (process.env.CRU21_GUEST_ENABLED === '1') {
  await import('./src/cru21-guest-server.mjs').then(m => m.startGuestServer({ appRoot: config.appRoot }));
} else {
// Explicit isolated integration only. Formal startup retains the existing path.
const cru55 = config.cru55Candidate ? await import('./src/cru55-main-integration.mjs').then(m => m.prepareIntegration(config)) : null;

const expectedDataMode = config.mockData ? 'mock' : 'live';
// Explicit source bindings read existing governed products; private writes stay in config.dataDir.
const readDataRoot = resolveDashboardReadDataRoot({
  dataDir: cru55 ? process.env.CRU55_FORMAL_DATA_ROOT : config.dataDir,
  host: config.host, port: config.port, actualDataMode: expectedDataMode.toUpperCase(),
  previewType: process.env.DASHBOARD_PREVIEW_TYPE, inlineEnabled: process.env.ASK_GPT_INLINE_ENABLED === '1',
  candidateReadRoot: process.env.ASK_GPT_CANDIDATE_READ_ROOT,
  formalReadRoot: process.env.DASHBOARD_FORMAL_READ_ROOT,
  isolatedMode: Boolean(config.cru55Candidate || config.cru55Acceptance),
  marketCandidateScope: process.env.DASHBOARD_RELEASE_SCOPE,
  marketCandidateReadRoot: process.env.DASHBOARD_CANDIDATE_READ_ROOT,
  sourceRoot: config.appRoot, producerDataRoot: process.env.CRU34_LIVE_DATA_ROOT,
  chartCacheRoot: process.env.TX_CHART_CACHE_ROOT,
});
const cache = cru55 ? { init: async () => {}, loadLatest: async () => structuredClone(cru55.seed), listHistory: async (limit = 30) => structuredClone(cru55.history.slice(0, limit)) }
  : new CacheStore(marketCandidate ? {dataDir:readDataRoot,historyDir:path.join(readDataRoot,'history')}
    : {dataDir:config.dataDir,historyDir:config.historyDir});
if (!marketCandidate) await cache.init(); // Candidate input cache is read-only, including startup.
let latestSnapshot = await cache.loadLatest();
let candidateCacheModeRejected = Boolean(marketCandidate && latestSnapshot && latestSnapshot.dataMode !== expectedDataMode);
if (candidateCacheModeRejected) latestSnapshot = null; // Quarantine in memory; never rewrite a source cache.
const formalEntry = cru55 || marketCandidate ? null : prepareFormalEntry(config, () => latestSnapshot);
const marketData = marketCandidate ? null : new MarketDataService({ timeoutMs: config.upstreamTimeoutMs, mockData: config.mockData });
const sessions = new SessionStore(config.sessionTtlMs, { filePath: path.join(config.dataDir, 'sessions.json') });
const loginLimiter = new LoginRateLimiter();
const offlineCandidate = marketCandidate || Boolean(config.cru55Acceptance);
let dailyUpdateProcess = null;
const intradayPath = path.join(readDataRoot, 'intraday', 'latest-bars.json');
const replayPath = path.join(readDataRoot, 'intraday', 'replay-bars.json');
const replayArchiveDir = path.join(readDataRoot, 'intraday', 'archive');
const decisionJournalPath = path.join(config.dataDir, 'decision-workspace', 'journal.ndjson');
const decisionOutcomesPath = path.join(config.dataDir, 'decision-workspace', 'journal-outcomes.ndjson');
const forwardShadowBaseRoot = path.join(readDataRoot, 'market-state', 'forward-shadow');
const futuresAuditPath = path.join(readDataRoot, 'live-events', 'futures-audits', 'latest.json');
const shioajiContinuityStatusPath = path.join(readDataRoot, 'runtime', 'shioaji-continuity', 'status.json');
const chartCalendarPath = path.join(config.appRoot, 'config', 'taifex-official-calendar-2026.json');
const chartCalendarExceptionPath = path.join(readDataRoot, 'market-state', 'forward-shadow', 'governance', 'taifex-official-calendar-exception.json');
const chartCalendar = loadGovernedTradingCalendar(chartCalendarPath, fs.existsSync(chartCalendarExceptionPath) ? chartCalendarExceptionPath : null);
// Operating-day closures are intentionally separate from historical chart
// trade-date/session mapping, so 10/22 night history cannot be reclassified.
let operatingCalendar = null;
try {
  operatingCalendar = loadOperatingCalendar(chartCalendarPath, {
    exceptionPaths: fs.existsSync(chartCalendarExceptionPath) ? [chartCalendarExceptionPath] : [],
    allowCandidate: process.env.DASHBOARD_PREVIEW_TYPE === 'CRU21_OWNER_PREVIEW',
  });
} catch { /* Unknown operating governance stays unavailable; no fake open/closed. */ }
const v2ReaderBinding = createGovernedV2Reader({
  mode: config.candidateV2Binding, candidateReadOnly: config.candidateReadOnly,
  manifestPath: process.env.DATA_OPERATIONS_MANIFEST_PATH, calendar: operatingCalendar,
  overrides: Object.fromEntries(['V2_RESEARCH_DATABASE_PATH', 'V2_BACKTEST_REPORT_PATH', 'V2_DATABASE_PATH', 'DATA_OPERATIONS_OUTPUT_ROOT']
    .map(key => [key, process.env[key]])),
});
const v2Research = new V2ResearchService(config.v2DatabasePath, config.v2ReportPath, { readerBinding: v2ReaderBinding });
const txChartDataRoot = path.resolve(process.env.TX_CHART_DATA_ROOT || readDataRoot);
const txChartCacheRoot = path.resolve(process.env.TX_CHART_CACHE_ROOT || path.join(config.dataDir, 'dashboard-chart-cache'));
// One bounded, on-demand calculation worker. HTTP and health must never scan
// or normalize a market ledger on the main event loop.
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
const cru34LiveDataRoot = path.resolve(process.env.CRU34_LIVE_DATA_ROOT || readDataRoot);
const cru34LiveProjectionRoot = path.dirname(cru34LiveSnapshotPath || path.join(cru34LiveDataRoot, 'runtime', 'cru34-live', 'latest.json'));
const txChartService = createTxChartService({ dataRoot: txChartDataRoot,
  cacheRoot: txChartCacheRoot, calendar: chartCalendar, producerRoot: cru34LiveProjectionRoot });
const runtimeIdentity = marketCandidateStartup?.runtimeIdentity || readRuntimeIdentity(config.appRoot);
const approvedMainIdentity = marketCandidateStartup?.approvedMainIdentity || readRuntimeIdentity(config.appRoot, { ref: 'refs/heads/main' });
const runtimeStartedAt = marketCandidateStartup?.runtimeStartedAt || new Date().toISOString();
const sourceCleanAtStartup = (() => {
  if (marketCandidateStartup) return marketCandidateStartup.sourceClean;
  try { return execFileSync('git', ['status', '--porcelain'], { cwd: config.appRoot, encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim() === ''; }
  catch { return false; }
})();
const baseRuntimeVersion = buildRuntimeVersionStatus({ runtimeIdentity, approvedMainIdentity, runtimeStartedAt });
const cru21PreviewEnabled = process.env.DASHBOARD_PREVIEW_TYPE === 'CRU21_OWNER_PREVIEW';
const cru44PreviewEnabled = process.env.DASHBOARD_PREVIEW_TYPE === 'CRU44_OWNER_PREVIEW';
const integrationPreviewEnabled = process.env.DASHBOARD_PREVIEW_TYPE === 'INTEGRATION_OWNER_PREVIEW';
const previewVersionOptions = { runtimeVersion: baseRuntimeVersion, branch: process.env.DASHBOARD_PREVIEW_BRANCH,
  dataMode: process.env.DASHBOARD_PREVIEW_DATA_MODE || expectedDataMode.toUpperCase() };
const runtimeVersion = marketCandidate ? marketCandidateStartup.version : cru21PreviewEnabled
  ? buildCru21PreviewVersion(previewVersionOptions)
  : cru44PreviewEnabled
  ? buildCru44PreviewVersion({ ...previewVersionOptions, enabled: true })
  : buildIntegrationPreviewVersion({ ...previewVersionOptions, enabled: integrationPreviewEnabled });
const cru21IdentityOptions = cru21PreviewEnabled ? {
  expectedHead: process.env.DASHBOARD_PREVIEW_EXPECTED_HEAD,
  expectedBaseMain: process.env.DASHBOARD_PREVIEW_EXPECTED_BASE_MAIN,
  actualBranch: execFileSync('git', ['branch', '--show-current'], { cwd: config.appRoot, encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim(),
  sourceClean: execFileSync('git', ['status', '--porcelain'], { cwd: config.appRoot, encoding: 'utf8', windowsHide: true, timeout: 2000 }).trim() === '',
  host: config.host, port: config.port, inlineEnabled: process.env.ASK_GPT_INLINE_ENABLED === '1',
  candidateReadRoot: process.env.ASK_GPT_CANDIDATE_READ_ROOT, actualDataMode: expectedDataMode.toUpperCase(),
} : null;
if (cru21PreviewEnabled && !validateCru21PreviewVersionTruth(runtimeVersion, cru21IdentityOptions).ready) throw Error('CRU21_PREVIEW_STARTUP_REJECTED');
const defaultProductSurface = Object.freeze({ productSurface: CRU46_PRODUCT_SURFACE_CONTRACT });
const productSurfaceContract = selectDashboardProductSurface({
  localMarketOnly, marketCandidate,
  previewType: process.env.DASHBOARD_PREVIEW_TYPE,
  actualBranch: cru21IdentityOptions?.actualBranch,
});
let lastRefreshError = null;
let browserRuntimeProof = null;
const isolatedBridge={connected:false,state:'UNAVAILABLE',reason:marketCandidate?'MARKET_CANDIDATE_NO_LIVE_BRIDGE':'ISOLATED_ACCEPTANCE_NO_LIVE_BRIDGE',executionAuthorized:false,orderRoutesEnabled:false};
const isolatedLeadership={state:'UNAVAILABLE',reason:marketCandidate?'MARKET_CANDIDATE_NO_LIVE_BRIDGE':'ISOLATED_ACCEPTANCE_NO_LIVE_BRIDGE',executionAuthorized:false,orderRoutesEnabled:false};

function currentObservedFlow() {
  return loadFlowRefresh({ runtimeCommit: runtimeIdentity.commit,
    dataRoot: cru34LiveDataRoot, projectionRoot: cru34LiveProjectionRoot,
    artifactPath: cru34SnapshotArtifactPath, freshnessCutoff: cru34SnapshotFreshnessCutoff,
    liveSnapshotPath: cru34LiveSnapshotPath, liveStatusPath: cru34LiveStatusPath });
}

async function currentDecisionLevelWatch(chart = null) {
  const selectedChart = chart || await txChartService.load({ timeframe: '5m', mode: 'LIVE' });
  const marketPulse = await currentMarketPulse(selectedChart);
  return buildDecisionLevelWatch({ chart: selectedChart, observedFlow: currentObservedFlow(), marketPulse, snapshotTime: new Date().toISOString() });
}

async function currentMarketPulse(chart = null) {
  const selectedChart = chart || await txChartService.load({ timeframe: '5m', mode: 'LIVE' });
  const bridgeLatest = offlineCandidate
    ? { state: 'UNAVAILABLE', reason: marketCandidate?'MARKET_CANDIDATE_NO_LIVE_BRIDGE':'ISOLATED_ACCEPTANCE_NO_LIVE_BRIDGE', data: null }
    : await inspectShioajiLatest();
  return buildMarketPulseLive({
    chart: selectedChart,
    bridgeLatest,
    archiveDir: path.join(txChartDataRoot, 'intraday', 'archive'),
  });
}

function currentCru46RuntimeReadiness() {
  const identity = marketCandidate ? marketCandidateStartup.truth : cru21PreviewEnabled
    ? validateCru21PreviewVersionTruth(runtimeVersion, cru21IdentityOptions)
    : cru44PreviewEnabled
    ? validateCru44PreviewVersionTruth(runtimeVersion, runtimeIdentity.commit)
    : integrationPreviewEnabled ? validateIntegrationPreviewVersionTruth(runtimeVersion, runtimeIdentity.commit)
    : validateFormalRuntimeVersionTruth(runtimeVersion, {
      expectedRuntimeCommit: runtimeIdentity.commit, expectedApprovedMainCommit: approvedMainIdentity.commit,
      actualDataMode: expectedDataMode.toUpperCase(), sourceClean: sourceCleanAtStartup,
      host: config.host, port: config.port, previewType: process.env.DASHBOARD_PREVIEW_TYPE,
    });
  const chartPayload = txChartService.peek({ timeframe: '5m', mode: 'LIVE' });
  const flow = loadDashboardObservedFlow({ liveSnapshotPath: cru34LiveSnapshotPath, liveStatusPath: cru34LiveStatusPath });
  const vendor = inspectChartVendorRuntime({ bundlePath: lightweightChartsPath,
    packagePath: lightweightChartsPackagePath, expectedVersion: '5.2.0' });
  const producer = inspectCru34LiveProducer({ snapshotPath: cru34LiveSnapshotPath, statusPath: cru34LiveStatusPath,
    dataRoot: cru34LiveDataRoot, projectionRoot: cru34LiveProjectionRoot });
  const chart = inspectChartPayload(chartPayload);
  const observedFlow = inspectObservedFlowPayload(flow, { requireLongWindows: cru44PreviewEnabled });
  const browser = validateBrowserRuntimeProof(browserRuntimeProof,
    { exactHead: runtimeIdentity.commit, runtimeStartedAt, requireLongWindows: cru44PreviewEnabled });
  const readiness = buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser });
  return { ...readiness, vendor, producer, chart, observedFlow, parity: readiness.runtimeReady.parity, browser };
}

function readLocalJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

async function decisionWorkspacePayload(snapshot, service, marketInputs = null) {
  const indexLeadership = service?.indexLeadership || null;
  const runtimeTruth = marketCandidate ? {governed:false,checkedAt:new Date().toISOString(),
    reason:'MARKET_CANDIDATE_NO_SCHEDULER_QUERY',executionAuthorized:false} : await readDashboardRuntimeTruth({
    baseRoot: forwardShadowBaseRoot,
    explicitRoot: process.env.FORWARD_SHADOW_RUNTIME_ROOT || null,
  });
  const chart = marketInputs ? marketInputs.chart
    : await txChartService.load({ timeframe: '5m', mode: 'LIVE' });
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
  const feed = marketInputs && !chart ? {events:[]} : buildMarketChangeFeed(chart);
  const marketChangeFeed = Object.freeze({ ...feed, markers: chartMarkersFromEvents(feed.events, chart) });
  const observedFlow = marketInputs ? marketInputs.flow : currentObservedFlow();
  const marketPulse = marketInputs && !chart ? buildMarketPulseLive({chart:null,
    bridgeLatest:{state:'UNAVAILABLE',reason:'MARKET_CANDIDATE_NO_LIVE_BRIDGE',data:null},archiveDir:null})
    : await currentMarketPulse(chart);
  return { ...buildDecisionWorkspace({
    snapshot, dataHealth, runtimeTruth, chart, marketChangeFeed, liveBreadth, runtimeVersion, indexLeadership,
    productSurface: productSurfaceContract,
    observedFlow,
    marketPulse,
  }), marketOperating: assessTaifexMarketSession(new Date(), operatingCalendar),
    ...(service?.degraded ? {degraded:service.degraded} : {}) };
}

async function candidatePartialInputs(service) {
  let chart = null, flow = null;
  try { chart = await txChartService.load({timeframe:'5m',mode:'LIVE'}); }
  catch { /* A source failure stays unavailable. */ }
  try { flow = currentObservedFlow(); } catch { /* No acquisition or fallback transport. */ }
  const degraded = assessCandidateMarketInputs({chart,flow});
  service.degraded = candidateCacheModeRejected
    ? Object.freeze({...degraded,eodReason:'EOD_SNAPSHOT_DATA_MODE_REJECTED'}) : degraded;
  return degraded.status === 'PARTIAL' ? {
    chart:degraded.marketInputs.chart.observationAvailable ? chart : null,
    flow:degraded.marketInputs.flow.observationAvailable ? flow : null,
  } : null;
}

async function currentDiscussionWorkspace() {
  if (marketCandidate || !latestSnapshot || latestSnapshot.dataMode !== expectedDataMode) {
    try { await refreshSnapshot(); } catch { /* retain truthful unavailable state below */ }
  }
  if (!latestSnapshot && !marketCandidate) return null;
  const shioaji = offlineCandidate
    ? isolatedBridge
    : await inspectShioajiBridge({ continuityRuntime: readLocalJson(shioajiContinuityStatusPath) });
  const indexLeadership = offlineCandidate
    ? isolatedLeadership
    : await inspectIx0001Leadership({ bridge: shioaji });
  const clientSnapshot = latestSnapshot ? {
    ...latestSnapshot,
    sources: sourceStatusesForSnapshot(latestSnapshot, {calendar:operatingCalendar??chartCalendar}),
    researchDecision: v2Research.decisionSupport(),
    priceConfirmation: loadPriceConfirmation(intradayPath),
  } : null;
  if (clientSnapshot) {
    enrichSnapshot(clientSnapshot, await cache.listHistory(400));
    clientSnapshot.sixAxisShadow = buildSixAxisShadow(clientSnapshot);
  }
  const servicePayload = {
    readOnly: true,
    candidateReadOnly: config.candidateReadOnly,
    brokerConnected: shioaji.connected,
    brokerMarketData: shioaji,
    lastRefreshError,
    prelive: preliveStatus(latestSnapshot, shioaji),
    runtimeVersion,
    productSurface: productSurfaceContract,
    indexLeadership,
  };
  if (clientSnapshot) return decisionWorkspacePayload(clientSnapshot, servicePayload);
  const inputs = await candidatePartialInputs(servicePayload);
  return inputs ? decisionWorkspacePayload(undefined, servicePayload, inputs) : null;
}

async function loadMarketChangeFeed({ mode = 'LIVE', tradeDate = null, session = null, actualContract = null, asOf = null } = {}) {
  const chart = await txChartService.load({
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
  if (marketCandidate) {
    // Re-read only the bound official cache. A later publication must become
    // visible without acquiring sources or rewriting the shared input file.
    const input = await cache.loadLatest();
    candidateCacheModeRejected = Boolean(input && input.dataMode !== expectedDataMode);
    latestSnapshot = candidateCacheModeRejected ? null : input;
    return latestSnapshot;
  }
  if (cru55 || offlineCandidate) return latestSnapshot; // isolated cache, never acquire upstream data
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
  return sessions.get(cookies[runtimeSessionCookieName()]);
}

function runtimeSessionCookieName() {
  // Cookies are shared across localhost ports. Candidate login/logout must not
  // replace or clear the formal dashboard's browser session.
  return cru55 ? 'cru55_main_session' : marketCandidate || config.candidateReadOnly ? 'twchip_candidate_session' : 'twchip_session';
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

const inlineEnabled = process.env.ASK_GPT_INLINE_ENABLED === '1';
if (process.env.ASK_GPT_INLINE_ENABLED && !['0','1'].includes(process.env.ASK_GPT_INLINE_ENABLED)) throw Error('INLINE_ACTIVATION_INVALID');
if (inlineEnabled && (config.host !== '127.0.0.1' || config.cru55Candidate || config.cru55Acceptance)) throw Error('INLINE_RUNTIME_NOT_SUPPORTED');
const inlineAssistant = new InlineAssistant({ enabled: inlineEnabled,
  root: path.join(config.dataDir, 'ask-gpt-inline'), runtimeCommit: runtimeIdentity.commit,
  snapshotProvider: currentDiscussionWorkspace });
const inlineHandler = createInlineHandler({assistant:inlineAssistant,port:config.port,requireCsrf});

const requestHandler = async (req, res) => {
  const isHttps = requestIsHttps(req, config.trustProxy);
  setSecurityHeaders(res, { isHttps });
  res.setHeader('X-Request-Id', crypto.randomUUID());

  const url = new URL(req.url || '/', 'http://localhost');
  const pathname = url.pathname;
  const ip = clientIp(req, config.trustProxy);

  try {
    if (marketCandidate) assertMarketCandidateFilesystemRoots(marketCandidateStartup.roots);
    if (marketCandidate && !marketCandidateRouteAllowed(req.method, pathname)) {
      sendJson(res,403,{ok:false,error:'MARKET_CANDIDATE_READ_ONLY'}); return;
    }
    if (marketCandidate && !marketCandidateQueryAllowed(url)) {
      sendJson(res,400,{ok:false,error:'MARKET_CANDIDATE_QUERY_REJECTED'}); return;
    }
    if(config.cru55Acceptance&&!['GET','HEAD'].includes(req.method)&&!['/api/auth/login','/api/auth/logout','/api/v1/cru46-browser-runtime-proof','/api/v1/decision-journal'].includes(pathname)){
      sendJson(res,403,{error:'CANDIDATE_READ_ONLY'});return;
    }
    if (cru55 && !cru55.guard(req, res)) return;
    if (cru55 && await cru55.handle(req, res, url, () => requireSession(req, res))) return;
    if (formalEntry && await formalEntry(req, res, url, () => requireSession(req, res))) return;
    if (req.method === 'GET' && pathname === '/healthz') {
      const readiness = currentCru46RuntimeReadiness();
      sendJson(res, 200, {
        ok: true,
        service: 'tw-chip-dashboard-v1',
        runtimeCommit: runtimeIdentity.commit,
        candidateReadOnly: config.candidateReadOnly,
        v2Reader: config.candidateV2Binding ? v2Research.readerIdentity() : null,
        dataOperationsReader: readDataOperationsReaderIdentity({
          candidateReadOnly: config.candidateReadOnly,
          manifestPath: process.env.DATA_OPERATIONS_MANIFEST_PATH,
          dataRoot: cru55 ? process.env.CRU55_FORMAL_DATA_ROOT : config.dataDir,
          outputRoot: process.env.DATA_OPERATIONS_OUTPUT_ROOT,
          calendar: operatingCalendar,
        }),
        inlineAssistant: {enabled:inlineEnabled,usageRoute:'CHATGPT_SUBSCRIPTION',paidApiFallback:false},
        candidateRelease: marketCandidate ? {scope:MARKET_CANDIDATE_SCOPE,transport:'HTTPS',
          aiEnabled:false,certificatePinConfigured:process.env.DASHBOARD_TLS_CERT_SHA256,
          deliveryAccepted:false,dataQualificationDeclared:false} : null,
        localRelease: localMarketOnly ? { scope:'MARKET_RESEARCH_AI_DISABLED', transport:'HTTPS',
          certificateSha256:process.env.DASHBOARD_TLS_CERT_SHA256, marketDataQualified:false } : null,
        cru55Acceptance: config.cru55Acceptance?{runId:config.cru55Acceptance.runId,bindingHash:config.cru55Acceptance.bindingHash,sourceKind:config.cru55Acceptance.sourceKind}:null,
        runtimeIdentityStatus: runtimeIdentity.status,
        approvedMainCommit: runtimeVersion.approvedMainCommit,
        runtimeStartedAt: runtimeVersion.runtimeStartedAt,
        syncState: runtimeVersion.syncState,
        versionTruth: runtimeVersion,
        cru55Binding: formalEntry?.runtimeBinding ?? {state:'UNCONFIGURED',bindingHash:null,fullDayReady:false},
        identityReady: readiness.identityReady,
        runtimePreflightReady: readiness.runtimePreflightReady,
        runtimeReady: readiness.runtimeReady,
        ownerPreviewReady: readiness.ownerPreviewReady,
        ownerPreviewReadiness: readiness.ownerPreviewReady,
        runtimeEvidence: { vendor: readiness.vendor, producer: readiness.producer,
          chart: readiness.chart, observedFlow: readiness.observedFlow, parity: readiness.parity, browser: readiness.browser },
        productSurface: productSurfaceContract,
        marketOperating: assessTaifexMarketSession(new Date(), operatingCalendar),
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
      res.setHeader('Set-Cookie', sessionCookie(session.id, { secure, maxAgeSeconds: sessionTtlMs / 1000 }).replace(/^twchip_session=/, runtimeSessionCookieName() + '='));
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
      res.setHeader('Set-Cookie', clearSessionCookie({ secure: config.cookieSecure || isHttps }).replace(/^twchip_session=/, runtimeSessionCookieName() + '='));
      sendJson(res, 200, { ok: true });
      return;
    }

    if (pathname.startsWith('/api/v1/')) {
      const session = requireSession(req, res);
      if (!session) return;

      if (await inlineHandler(req, res, url, session)) return;

      if (req.method === 'GET' && pathname === '/api/v1/data-operations') {
        try {
          sendJson(res, 200, { ok: true, data: readDataOperations(resolveOperationsReader({
            manifestPath: process.env.DATA_OPERATIONS_MANIFEST_PATH,
            dataRoot: marketCandidate ? readDataRoot : cru55 ? process.env.CRU55_FORMAL_DATA_ROOT : config.dataDir,
            outputRoot: process.env.DATA_OPERATIONS_OUTPUT_ROOT, calendar: operatingCalendar })) },
            { 'Cache-Control': 'no-store' });
        } catch {
          sendJson(res, 503, { ok: false, error: 'OPERATIONS_BINDING_UNVERIFIED' }, { 'Cache-Control': 'no-store' });
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/observed-flow') {
        sendJson(res, 200, { ok: true, data: currentObservedFlow() });
        return;
      }

      // Existing session boundary above applies; only fixed, bounded read paths.
      if (req.method === 'GET' && pathname === '/api/v1/research-evidence') {
        const now = new Date();
        sendJson(res, 200, { ok: true, data: buildResearchEvidence({
          now, calendar: chartCalendar, flow: currentObservedFlow(),
          quote: readLatestResearchQuote(cru34LiveDataRoot, now),
          result: readResearchResult(path.join(marketCandidate ? readDataRoot : config.dataDir, 'research-validation', 'result.json')),
        }) }, { 'Cache-Control': 'no-store' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/market-pulse') {
        sendJson(res, 200, { ok: true, data: await currentMarketPulse() }, { 'Cache-Control': 'no-store' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/decision-level-watch') {
        sendJson(res, 200, { ok: true, data: await currentDecisionLevelWatch() }, { 'Cache-Control': 'no-store' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/ask-gpt-context') {
        const question = String(url.searchParams.get('question') || '').trim().slice(0, 500) || null;
        const workspace = await currentDiscussionWorkspace();
        if (!workspace?.snapshot) {
          sendJson(res, 503, { ok: false, error: 'DISCUSSION_SNAPSHOT_UNAVAILABLE' }, { 'Cache-Control': 'no-store' });
          return;
        }
        sendJson(res, 200, {
          ok: true,
          data: {
            prompt: copyForChatGpt(workspace.snapshot, question),
            snapshotHash: workspace.snapshot.snapshotHash,
            snapshotTime: workspace.snapshot.snapshotTime,
            handoffMode: 'COPY_AND_OPEN_CHATGPT',
            directGptApi: false,
            recommendation: false,
            systemDirectionalSignal: false,
            formalWeight: 0,
            researchOnly: true,
            executionAuthorized: false,
            orderRoutesEnabled: false,
          },
        }, { 'Cache-Control': 'no-store' });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/dashboard') {
        if (marketCandidate || !latestSnapshot || latestSnapshot.dataMode !== expectedDataMode) {
          try { await refreshSnapshot(); } catch { /* status returned below */ }
        }
        const shioaji = offlineCandidate?isolatedBridge:await inspectShioajiBridge({ continuityRuntime: readLocalJson(shioajiContinuityStatusPath) });
        const indexLeadership = offlineCandidate?isolatedLeadership:await inspectIx0001Leadership({ bridge: shioaji });
        const clientHistory = latestSnapshot ? await cache.listHistory(400) : [];
        const clientSnapshot = latestSnapshot ? {
          ...latestSnapshot,
          sources: sourceStatusesForSnapshot(latestSnapshot, {calendar:operatingCalendar??chartCalendar}),
          researchDecision: v2Research.decisionSupport(),
          priceConfirmation: loadPriceConfirmation(intradayPath),
        } : null;
        if (clientSnapshot) {
          enrichSnapshot(clientSnapshot, clientHistory);
          clientSnapshot.sixAxisShadow = buildSixAxisShadow(clientSnapshot);
        }
        const servicePayload = {
          readOnly: true,
          candidateReadOnly: config.candidateReadOnly,
          brokerConnected: shioaji.connected,
          brokerMarketData: shioaji,
          lastRefreshError,
          prelive: preliveStatus(latestSnapshot, shioaji),
          runtimeVersion,
          productSurface: productSurfaceContract,
          indexLeadership,
        };
        let marketInputs = null;
        if (marketCandidate && !clientSnapshot) {
          marketInputs = await candidatePartialInputs(servicePayload);
        }
        const decisionWorkspace = clientSnapshot
          ? await decisionWorkspacePayload(clientSnapshot, servicePayload)
          : marketInputs ? await decisionWorkspacePayload(undefined, servicePayload, marketInputs) : null;
        sendJson(res, latestSnapshot || marketInputs ? 200 : 503, {
          ok: Boolean(latestSnapshot || marketInputs),
          data: clientSnapshot,
          service: servicePayload,
          decisionWorkspace,
        });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/cru46-browser-runtime-proof') {
        if (!requireCsrf(req, res, session)) return;
        const candidate = await readJson(req, { maxBytes: 16 * 1024 });
        const chartPayload = await txChartService.load({ timeframe: '5m', mode: 'LIVE' });
        const chart = inspectChartPayload(chartPayload);
        const flow = inspectObservedFlowPayload(loadDashboardObservedFlow({
          liveSnapshotPath: cru34LiveSnapshotPath, liveStatusPath: cru34LiveStatusPath }),
        { requireLongWindows: cru44PreviewEnabled });
        if (marketCandidate && !marketCandidateBrowserBindingMatches(candidate, {exactHead:runtimeIdentity.commit,
            exactTree:process.env.DASHBOARD_PREVIEW_EXPECTED_TREE,runtimeStartedAt})) {
          sendJson(res,422,{ok:false,error:'MARKET_CANDIDATE_BROWSER_BINDING_REJECTED'}); return;
        }
        const normalizedBase = normalizeBrowserRuntimeProof(candidate,
          { exactHead: runtimeIdentity.commit, runtimeStartedAt });
        const normalized = marketCandidate ? Object.freeze({...normalizedBase,candidateScope:MARKET_CANDIDATE_SCOPE,
          previewType:MARKET_CANDIDATE_PREVIEW,origin:'https://127.0.0.1:18723',exactTree:process.env.DASHBOARD_PREVIEW_EXPECTED_TREE})
          : normalizedBase;
        const validated = validateBrowserRuntimeProof(normalized,
          { exactHead: runtimeIdentity.commit, runtimeStartedAt, requireLongWindows: cru44PreviewEnabled });
        const browserParity = validateBrowserRuntimeParity(normalized,
          { chart, observedFlow: flow, requireLongWindows: cru44PreviewEnabled });
        if (!validated.ready || !browserParity.ready || !chart.ready || !flow.ready) {
          sendJson(res, 422, { ok: false, error: cru44PreviewEnabled
            ? 'CRU44_BROWSER_RUNTIME_PROOF_REJECTED' : 'CRU46_BROWSER_RUNTIME_PROOF_REJECTED',
            reasons: [...validated.reasons, ...browserParity.reasons, ...chart.reasons, ...flow.reasons] });
          return;
        }
        browserRuntimeProof = Object.freeze(normalized);
        sendJson(res, 200, { ok: true, data: browserRuntimeProof });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/index-leadership') {
        const bridge = offlineCandidate?isolatedBridge:await inspectShioajiBridge({ continuityRuntime: readLocalJson(shioajiContinuityStatusPath) });
        const leadership = offlineCandidate?isolatedLeadership:await inspectIx0001Leadership({ bridge });
        sendJson(res, 200, {
          ok: true,
          data: leadership,
          cachePolicy: offlineCandidate?'ISOLATED_UNAVAILABLE':'BOUNDED_8790_LATEST_MEMORY',
          recommendedPollMs: 5_000,
          executionAuthorized: false,
          orderRoutesEnabled: false,
        });
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/decision-journal') {
        const limit = Math.max(1, Math.min(100, Number.parseInt(url.searchParams.get('limit') || '20', 10) || 20));
        try {
          const data = readDecisionJournal(decisionJournalPath, { limit });
          const outcomes = readDecisionOutcomes(decisionOutcomesPath, { journalPath: decisionJournalPath,
            decisionRecordHashes: data.map(row => row.recordHash) });
          sendJson(res, 200, { ok: true, data, outcomes,
            storage: 'LOCAL_APPEND_ONLY_ISOLATED', executionAuthorized: false });
        } catch {
          sendJson(res, 503, { ok: false, error: 'DECISION_JOURNAL_UNAVAILABLE' });
        }
        return;
      }

      if (req.method === 'GET' && pathname === '/api/v1/market-observation') {
        const data = await txChartService.load({ observation: true,
          timeframe: url.searchParams.get('timeframe') || '1m',
          mode: url.searchParams.get('mode') === 'REPLAY' ? 'REPLAY' : 'LIVE',
          tradeDate: url.searchParams.get('tradeDate') || null,
          session: url.searchParams.get('session') || null,
          actualContract: url.searchParams.get('actualContract') || null,
          asOf: url.searchParams.get('asOf') || null });
        sendJson(res, 200, { ok: true, data: { ...data, journalSnapshot: observationDecisionSnapshot(data) } });
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
        const chart = await txChartService.load({
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
        const { feed } = await loadMarketChangeFeed({ mode, tradeDate, session: selectedSession, actualContract, asOf });
        sendJson(res, 200, { ok: true, data: feed });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/decision-journal/outcomes') {
        if (!requireCsrf(req, res, session)) return;
        try {
          const body = await readJson(req, { maxBytes: 16 * 1024 });
          const entry = appendDecisionOutcome(decisionOutcomesPath, decisionJournalPath, body);
          sendJson(res, 201, { ok: true, data: entry, executionAuthorized: false });
        } catch (error) {
          const known = /^DECISION_(?:JOURNAL|OUTCOME)_[A-Z0-9_]+$/.test(error.message || '');
          sendJson(res, known ? 400 : 503, { ok: false, error: known ? error.message : 'DECISION_OUTCOME_UNAVAILABLE' });
        }
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v1/decision-journal') {
        if (!requireCsrf(req, res, session)) return;
        const body = await readJson(req, { maxBytes: 512 * 1024 });
        try {
          const entry = appendDecisionJournal(decisionJournalPath, body);
          sendJson(res, 201, { ok: true, data: entry, executionAuthorized: false });
        } catch (error) {
          if (!/^DECISION_JOURNAL_(?:INTENT|CONFIDENCE|EXECUTION)_INVALID$/.test(error.message || '')) throw error;
          sendJson(res, 400, { ok: false, error: error.message });
        }
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
        sendJson(res, 200, { ok: true, data: v2Research.dailyUpdateStatus(), processRunning: Boolean(dailyUpdateProcess),
          ...(config.candidateReadOnly ? { manualRun: { allowed: false, state: 'BLOCKED',
            reasonCodes: ['CANDIDATE_READ_ONLY_DAILY_UPDATE'] } } : {}) });
        return;
      }

      if (req.method === 'POST' && pathname === '/api/v2/daily-update') {
        if (!requireCsrf(req, res, session)) return;
        // Reading shared products never grants the reader permission to run a writer.
        if (config.candidateReadOnly) {
          sendJson(res, 403, { ok: false, error: 'CANDIDATE_READ_ONLY_DAILY_UPDATE',
            data: { state: 'BLOCKED', reasonCodes: ['CANDIDATE_READ_ONLY_DAILY_UPDATE'] } });
          return;
        }
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
    const knownResearchUnavailable = status === 503
      && (['V2_DATABASE_NOT_READY', 'V2_BACKTEST_NOT_READY', 'V2_STRIKE_BUDGET_EXCEEDED'].includes(error.message)
        || /^V2_READER_(BINDING_UNVERIFIED|DATABASE_UNAVAILABLE|ARTIFACT_(MISSING|OVERSIZE|UNVERIFIED|UNREADABLE|INVALID)|PAYLOAD_BUDGET_EXCEEDED)$/.test(error.message));
    sendJson(res, status, { ok: false, error: status >= 500 && !knownResearchUnavailable ? 'INTERNAL_ERROR' : error.message });
  }
};
const server = createDashboardServer(requestHandler, process.env, config);

server.requestTimeout = 20_000;
server.headersTimeout = 10_000;
server.keepAliveTimeout = 5_000;
server.maxRequestsPerSocket = 100;

server.listen(config.port, config.host, async () => {
  console.log(`台股決策雷達 V3.7.3：${localMarketOnly || marketCandidate ? 'https' : 'http'}://${config.host}:${config.port}`);
  console.log(cru55 ? 'CRU-55 隔離整合候選；來源各自 dated；擷取停用；execution=false' : `模式：${config.mockData ? 'MOCK' : 'LIVE'}；只讀：是；券商連線：無`);
  // Warm only after listening, through the same bounded worker as chart requests.
  // Health reads cached evidence and truthfully reports pending/stale state.
  if (!cru55 && !config.cru55Acceptance) {
    void txChartService.load({ timeframe: '5m', mode: 'LIVE' });
  }
  // Always check upstream sources on startup. The cached snapshot is shown only
  // while this first refresh is in progress or if an official source fails.
  if (!marketCandidate) refreshSnapshot().catch((error) => console.error('[initial refresh]', error.message));
});

if (!cru55 && !offlineCandidate && config.refreshIntervalMs > 0) {
  const timer = setInterval(() => {
    refreshSnapshot().catch((error) => console.error('[scheduled refresh]', error.message));
    sessions.cleanup();
  }, config.refreshIntervalMs);
  timer.unref();
}

function shutdown(signal) {
  void txChartService.close();
  void inlineAssistant.close();
  console.log(`收到 ${signal}，停止服務…`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

} // Normal authenticated runtime; guest dispatcher cannot fall through here.

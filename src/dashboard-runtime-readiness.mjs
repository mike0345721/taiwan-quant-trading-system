import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

import { readCru34LiveSnapshot } from './dashboard-observed-flow.mjs';

function fileIdentity(filePath) {
  try {
    const body = fs.readFileSync(filePath);
    const stat = fs.statSync(filePath);
    return Object.freeze({
      path: filePath,
      exists: stat.isFile(),
      bytes: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      sha256: crypto.createHash('sha256').update(body).digest('hex'),
    });
  } catch {
    return Object.freeze({ path: filePath, exists: false, bytes: 0, modifiedAt: null, sha256: null });
  }
}

function readJson(filePath) {
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); } catch { return null; }
}

function processAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export function inspectChartVendorRuntime({ bundlePath, packagePath, expectedVersion }) {
  const bundle = fileIdentity(bundlePath);
  const installedVersion = readJson(packagePath)?.version || null;
  const apiMajor = Number.parseInt(String(installedVersion || '').split('.')[0], 10) || null;
  const reasons = [];
  if (!bundle.exists || bundle.bytes <= 0) reasons.push('CHART_VENDOR_BUNDLE_MISSING');
  if (installedVersion !== expectedVersion) reasons.push('CHART_VENDOR_VERSION_MISMATCH');
  if (apiMajor !== 5) reasons.push('CHART_VENDOR_V5_REQUIRED');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons), expectedVersion,
    installedVersion, apiMajor, packagePath, servedPath: '/vendor/lightweight-charts.js', bundle });
}

export function inspectCru34LiveProducer({ snapshotPath, statusPath, dataRoot, projectionRoot, now = new Date() }) {
  const snapshotIdentity = fileIdentity(snapshotPath);
  const statusIdentity = fileIdentity(statusPath);
  const status = readJson(statusPath);
  const lockPath = path.join(projectionRoot, 'worker.lock');
  const lock = readJson(lockPath);
  const readResult = readCru34LiveSnapshot({ snapshotPath, statusPath, now });
  const heartbeat = validateProducerHeartbeat(status, lock, { snapshotPath, statusPath, dataRoot, projectionRoot, now });
  const reasons = [...heartbeat.reasons];
  if (!snapshotIdentity.exists) reasons.push('LIVE_SNAPSHOT_MISSING');
  if (!statusIdentity.exists) reasons.push('LIVE_STATUS_MISSING');
  if (readResult.truthState === 'UNAVAILABLE' || !readResult.snapshot) reasons.push(readResult.unavailableReason || 'LIVE_SNAPSHOT_INVALID');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze([...new Set(reasons)]),
    pid: Number(status?.pid) || null, status: status?.status || 'UNAVAILABLE', worker: status, lock,
    snapshot: snapshotIdentity, statusFile: statusIdentity, truthState: readResult.truthState,
    observedFlowIdentity: readResult.snapshot ? Object.freeze({
      tradeDate: readResult.snapshot.tradeDate, session: readResult.snapshot.session,
      actualContract: readResult.snapshot.actualContract, availableAt: readResult.snapshot.availableAt,
      semanticContentHash: readResult.operational?.semanticContentHash || null,
    }) : null });
}

export function validateProducerHeartbeat(status, lock, {
  snapshotPath, statusPath, dataRoot, projectionRoot, now = new Date(), isProcessAlive = processAlive,
  maxHeartbeatAgeMs = 15_000,
} = {}) {
  const reasons = [];
  if (status?.schemaVersion !== 'cru34-live-worker-status-v1' || status?.status !== 'AVAILABLE') reasons.push('LIVE_PRODUCER_STATUS_NOT_AVAILABLE');
  if (status?.snapshotPath !== snapshotPath || status?.statusPath !== statusPath
      || status?.dataRoot !== dataRoot || status?.projectionRoot !== projectionRoot) reasons.push('LIVE_PRODUCER_PATH_MISMATCH');
  const observedMs = Date.parse(status?.observedAt);
  const ageMs = now.getTime() - observedMs;
  if (!Number.isFinite(observedMs) || ageMs < -5_000 || ageMs > maxHeartbeatAgeMs) reasons.push('LIVE_PRODUCER_HEARTBEAT_STALE');
  if (!/^[0-9a-f-]{36}$/i.test(status?.workerInstanceId || '')
      || lock?.workerInstanceId !== status?.workerInstanceId || Number(lock?.pid) !== Number(status?.pid)
      || lock?.dataRoot !== dataRoot || lock?.projectionRoot !== projectionRoot) reasons.push('LIVE_PRODUCER_INSTANCE_MISMATCH');
  if (!isProcessAlive(Number(status?.pid))) reasons.push('LIVE_PRODUCER_PROCESS_MISSING');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons),
    heartbeatAgeMs: Number.isFinite(ageMs) ? ageMs : null, workerInstanceId: status?.workerInstanceId || null });
}

export function inspectChartPayload(chart) {
  const bars = Array.isArray(chart?.bars) ? chart.bars : [];
  const finite = (value) => typeof value === 'number' && Number.isFinite(value);
  const candleCount = bars.filter((bar) => Number.isFinite(Date.parse(bar?.time))
    && [bar?.open, bar?.high, bar?.low, bar?.close].every(finite)).length;
  const volumeCount = bars.filter((bar) => Number.isFinite(Date.parse(bar?.time))
    && finite(bar?.volume)).length;
  const ready = ['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(chart?.status)
    && candleCount > 0 && volumeCount > 0;
  return Object.freeze({ ready, reasons: Object.freeze(ready ? [] : ['CHART_PAYLOAD_NOT_ELIGIBLE']),
    status: chart?.status || 'UNAVAILABLE', reason: chart?.reason || null, candleCount, volumeCount,
    tradeDate: chart?.tradeDate || null, session: chart?.session || null,
    actualContract: chart?.actualContract || null, availableAt: chart?.availableAt || null });
}

export function inspectObservedFlowPayload(flow, { requireLongWindows = false } = {}) {
  const primary = flow?.windows?.primary60s;
  const context = flow?.windows?.context300s;
  const window900s = flow?.windows?.window900s;
  const window1800s = flow?.windows?.window1800s;
  const window3600s = flow?.windows?.window3600s;
  const window14400s = flow?.windows?.window14400s;
  const required = requireLongWindows
    ? [primary, context, window900s, window1800s, window3600s, window14400s]
    : [primary, context];
  const ready = ['LIVE', 'WARMING_UP', 'STALE'].includes(flow?.sourceState)
    && required.every((window) => window && (window.status !== 'UNAVAILABLE' || window.truthState === 'WARMING_UP'));
  const unavailableReason = requireLongWindows
    ? 'OBSERVED_FLOW_1M_5M_15M_30M_1H_4H_UNAVAILABLE'
    : 'OBSERVED_FLOW_1M_5M_UNAVAILABLE';
  return Object.freeze({ ready: Boolean(ready), reasons: Object.freeze(ready ? [] : [flow?.unavailableReason || unavailableReason]),
    sourceState: flow?.sourceState || 'UNAVAILABLE', oneMinuteStatus: primary?.status || 'UNAVAILABLE',
    fiveMinuteStatus: context?.status || 'UNAVAILABLE', fifteenMinuteStatus: window900s?.status || 'UNAVAILABLE',
    thirtyMinuteStatus: window1800s?.status || 'UNAVAILABLE',
    fifteenMinuteTruthState: window900s?.truthState || 'UNAVAILABLE',
    thirtyMinuteTruthState: window1800s?.truthState || 'UNAVAILABLE', identity: flow?.identity || null,
    oneHourStatus: window3600s?.status || 'UNAVAILABLE', fourHourStatus: window14400s?.status || 'UNAVAILABLE',
    oneHourTruthState: window3600s?.truthState || 'UNAVAILABLE',
    fourHourTruthState: window14400s?.truthState || 'UNAVAILABLE',
    availableAt: flow?.source?.availableAt || null });
}

export function validateBrowserRuntimeProof(proof, { exactHead, runtimeStartedAt, requireLongWindows = false }) {
  const reasons = [];
  if (proof?.schemaVersion !== 'cru46-owner-browser-runtime-proof-v1') reasons.push('BROWSER_PROOF_MISSING');
  if (proof?.exactHead !== exactHead || proof?.runtimeStartedAt !== runtimeStartedAt) reasons.push('BROWSER_PROOF_IDENTITY_MISMATCH');
  if (proof?.lightweightChartsApiMajor !== 5) reasons.push('CHART_BROWSER_V5_API_UNAVAILABLE');
  if (proof?.canvasCount < 2 || proof?.chartWidth <= 0 || proof?.chartHeight <= 0) reasons.push('CHART_BROWSER_CANVAS_UNAVAILABLE');
  if (proof?.candleCount <= 0 || proof?.volumeCount <= 0) reasons.push('CHART_BROWSER_SERIES_EMPTY');
  if (proof?.chartStatusVisible !== true) reasons.push('CHART_BROWSER_STATUS_NOT_VISIBLE');
  if (proof?.observedFlow1m !== true || proof?.observedFlow5m !== true) reasons.push('BROWSER_OBSERVED_FLOW_MISSING');
  if (requireLongWindows && (proof?.observedFlow15m !== true || proof?.observedFlow30m !== true))
    reasons.push('BROWSER_OBSERVED_FLOW_15M_30M_MISSING');
  if (requireLongWindows && (proof?.observedFlow1h !== true || proof?.observedFlow4h !== true))
    reasons.push('BROWSER_OBSERVED_FLOW_1H_4H_MISSING');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons), proof: proof || null });
}

export function normalizeBrowserRuntimeProof(candidate, { exactHead, runtimeStartedAt }) {
  return Object.freeze({
    schemaVersion: 'cru46-owner-browser-runtime-proof-v1', exactHead, runtimeStartedAt,
    lightweightChartsApiMajor: candidate?.lightweightChartsApiMajor ?? null,
    canvasCount: Number(candidate?.canvasCount) || 0,
    chartWidth: Number(candidate?.chartWidth) || 0,
    chartHeight: Number(candidate?.chartHeight) || 0,
    candleCount: Number(candidate?.candleCount) || 0,
    volumeCount: Number(candidate?.volumeCount) || 0,
    chartStatusVisible: candidate?.chartStatusVisible === true,
    observedFlow1m: candidate?.observedFlow1m === true,
    observedFlow5m: candidate?.observedFlow5m === true,
    observedFlow15m: candidate?.observedFlow15m === true,
    observedFlow30m: candidate?.observedFlow30m === true,
    observedFlow1h: candidate?.observedFlow1h === true,
    observedFlow4h: candidate?.observedFlow4h === true,
    receivedAt: new Date().toISOString(),
  });
}

export function validateBrowserRuntimeParity(proof, { chart, observedFlow, requireLongWindows = false }) {
  const reasons = [];
  if (!Number.isInteger(proof?.candleCount) || proof.candleCount <= 0 || proof.candleCount > chart?.candleCount)
    reasons.push('CHART_BROWSER_CANDLE_COUNT_MISMATCH');
  if (!Number.isInteger(proof?.volumeCount) || proof.volumeCount <= 0 || proof.volumeCount > chart?.volumeCount)
    reasons.push('CHART_BROWSER_VOLUME_COUNT_MISMATCH');
  if (proof?.observedFlow1m !== true || observedFlow?.oneMinuteStatus === 'UNAVAILABLE') reasons.push('BROWSER_OBSERVED_FLOW_1M_MISMATCH');
  if (proof?.observedFlow5m !== true || observedFlow?.fiveMinuteStatus === 'UNAVAILABLE') reasons.push('BROWSER_OBSERVED_FLOW_5M_MISMATCH');
  if (requireLongWindows && (proof?.observedFlow15m !== true
      || (observedFlow?.fifteenMinuteStatus === 'UNAVAILABLE' && observedFlow?.fifteenMinuteTruthState !== 'WARMING_UP')))
    reasons.push('BROWSER_OBSERVED_FLOW_15M_MISMATCH');
  if (requireLongWindows && (proof?.observedFlow30m !== true
      || (observedFlow?.thirtyMinuteStatus === 'UNAVAILABLE' && observedFlow?.thirtyMinuteTruthState !== 'WARMING_UP')))
    reasons.push('BROWSER_OBSERVED_FLOW_30M_MISMATCH');
  if (requireLongWindows && (proof?.observedFlow1h !== true
      || (observedFlow?.oneHourStatus === 'UNAVAILABLE' && observedFlow?.oneHourTruthState !== 'WARMING_UP')))
    reasons.push('BROWSER_OBSERVED_FLOW_1H_MISMATCH');
  if (requireLongWindows && (proof?.observedFlow4h !== true
      || (observedFlow?.fourHourStatus === 'UNAVAILABLE' && observedFlow?.fourHourTruthState !== 'WARMING_UP')))
    reasons.push('BROWSER_OBSERVED_FLOW_4H_MISMATCH');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser, productSurfaceReady = true }) {
  const chartIdentity = [chart?.tradeDate, chart?.session, chart?.actualContract];
  const flowIdentity = [observedFlow?.identity?.tradeDate, observedFlow?.identity?.session, observedFlow?.identity?.actualContract];
  const parity = Object.freeze({ ready: chartIdentity.every(Boolean) && chartIdentity.every((value, index) => value === flowIdentity[index]),
    chart: Object.freeze({ tradeDate: chart?.tradeDate || null, session: chart?.session || null, actualContract: chart?.actualContract || null }),
    observedFlow: observedFlow?.identity || null });
  const parityReasons = parity.ready ? [] : ['CHART_OBSERVED_FLOW_IDENTITY_MISMATCH'];
  const preflightReasons = [...[vendor, producer, chart, observedFlow].flatMap((item) => item?.reasons || []), ...parityReasons];
  const runtimePreflightReady = Object.freeze({ ready: preflightReasons.length === 0, reasons: Object.freeze([...new Set(preflightReasons)]) });
  const runtimeReasons = [...preflightReasons, ...(browser?.reasons || [])];
  const runtimeReady = Object.freeze({ ready: runtimeReasons.length === 0, reasons: Object.freeze([...new Set(runtimeReasons)]),
    vendor, producer, chart, observedFlow, parity, browser });
  const ownerReasons = [...(identity?.reasons || []), ...runtimeReasons];
  if (!productSurfaceReady) ownerReasons.push('PRODUCT_SURFACE_CONTRACT_FAILED');
  return Object.freeze({ identityReady: identity, runtimePreflightReady, runtimeReady,
    ownerPreviewReady: Object.freeze({ ready: ownerReasons.length === 0, reasons: Object.freeze([...new Set(ownerReasons)]) }) });
}

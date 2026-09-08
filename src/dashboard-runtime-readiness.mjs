import crypto from 'node:crypto';
import fs from 'node:fs';

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
  const readResult = readCru34LiveSnapshot({ snapshotPath, statusPath, now });
  const reasons = [];
  if (!snapshotIdentity.exists) reasons.push('LIVE_SNAPSHOT_MISSING');
  if (!statusIdentity.exists) reasons.push('LIVE_STATUS_MISSING');
  if (status?.schemaVersion !== 'cru34-live-worker-status-v1' || status?.status !== 'AVAILABLE') reasons.push('LIVE_PRODUCER_STATUS_NOT_AVAILABLE');
  if (status?.snapshotPath !== snapshotPath || status?.statusPath !== statusPath
      || status?.dataRoot !== dataRoot || status?.projectionRoot !== projectionRoot) reasons.push('LIVE_PRODUCER_PATH_MISMATCH');
  if (!processAlive(Number(status?.pid))) reasons.push('LIVE_PRODUCER_PROCESS_MISSING');
  if (readResult.truthState === 'UNAVAILABLE' || !readResult.snapshot) reasons.push(readResult.unavailableReason || 'LIVE_SNAPSHOT_INVALID');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze([...new Set(reasons)]),
    pid: Number(status?.pid) || null, status: status?.status || 'UNAVAILABLE', worker: status,
    snapshot: snapshotIdentity, statusFile: statusIdentity, truthState: readResult.truthState,
    observedFlowIdentity: readResult.snapshot ? Object.freeze({
      tradeDate: readResult.snapshot.tradeDate, session: readResult.snapshot.session,
      actualContract: readResult.snapshot.actualContract, availableAt: readResult.snapshot.availableAt,
      semanticContentHash: readResult.operational?.semanticContentHash || null,
    }) : null });
}

export function inspectChartPayload(chart) {
  const bars = Array.isArray(chart?.bars) ? chart.bars : [];
  const candleCount = bars.filter((bar) => Number.isFinite(Date.parse(bar?.time))
    && [bar?.open, bar?.high, bar?.low, bar?.close].every((value) => Number.isFinite(Number(value)))).length;
  const volumeCount = bars.filter((bar) => Number.isFinite(Date.parse(bar?.time))
    && Number.isFinite(Number(bar?.volume))).length;
  const ready = ['READY', 'FORMING', 'QUALITY_INSUFFICIENT'].includes(chart?.status)
    && candleCount > 0 && volumeCount > 0;
  return Object.freeze({ ready, reasons: Object.freeze(ready ? [] : ['CHART_PAYLOAD_NOT_ELIGIBLE']),
    status: chart?.status || 'UNAVAILABLE', reason: chart?.reason || null, candleCount, volumeCount,
    tradeDate: chart?.tradeDate || null, session: chart?.session || null,
    actualContract: chart?.actualContract || null, availableAt: chart?.availableAt || null });
}

export function inspectObservedFlowPayload(flow) {
  const primary = flow?.windows?.primary60s;
  const context = flow?.windows?.context300s;
  const ready = ['LIVE', 'WARMING_UP', 'STALE'].includes(flow?.sourceState)
    && primary && context && primary.status !== 'UNAVAILABLE' && context.status !== 'UNAVAILABLE';
  return Object.freeze({ ready: Boolean(ready), reasons: Object.freeze(ready ? [] : [flow?.unavailableReason || 'OBSERVED_FLOW_1M_5M_UNAVAILABLE']),
    sourceState: flow?.sourceState || 'UNAVAILABLE', oneMinuteStatus: primary?.status || 'UNAVAILABLE',
    fiveMinuteStatus: context?.status || 'UNAVAILABLE', identity: flow?.identity || null,
    availableAt: flow?.source?.availableAt || null });
}

export function validateBrowserRuntimeProof(proof, { exactHead, runtimeStartedAt }) {
  const reasons = [];
  if (proof?.schemaVersion !== 'cru46-owner-browser-runtime-proof-v1') reasons.push('BROWSER_PROOF_MISSING');
  if (proof?.exactHead !== exactHead || proof?.runtimeStartedAt !== runtimeStartedAt) reasons.push('BROWSER_PROOF_IDENTITY_MISMATCH');
  if (proof?.lightweightChartsApiMajor !== 5) reasons.push('CHART_BROWSER_V5_API_UNAVAILABLE');
  if (proof?.canvasCount < 2 || proof?.chartWidth <= 0 || proof?.chartHeight <= 0) reasons.push('CHART_BROWSER_CANVAS_UNAVAILABLE');
  if (proof?.candleCount <= 0 || proof?.volumeCount <= 0) reasons.push('CHART_BROWSER_SERIES_EMPTY');
  if (proof?.observedFlow1m !== true || proof?.observedFlow5m !== true) reasons.push('BROWSER_OBSERVED_FLOW_MISSING');
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons), proof: proof || null });
}

export function buildCru46Readiness({ identity, vendor, producer, chart, observedFlow, browser, productSurfaceReady = true }) {
  const preflightReasons = [vendor, producer, chart, observedFlow].flatMap((item) => item?.reasons || []);
  const runtimePreflightReady = Object.freeze({ ready: preflightReasons.length === 0, reasons: Object.freeze([...new Set(preflightReasons)]) });
  const runtimeReasons = [...preflightReasons, ...(browser?.reasons || [])];
  const runtimeReady = Object.freeze({ ready: runtimeReasons.length === 0, reasons: Object.freeze([...new Set(runtimeReasons)]),
    vendor, producer, chart, observedFlow, browser });
  const ownerReasons = [...(identity?.reasons || []), ...runtimeReasons];
  if (!productSurfaceReady) ownerReasons.push('PRODUCT_SURFACE_CONTRACT_FAILED');
  return Object.freeze({ identityReady: identity, runtimePreflightReady, runtimeReady,
    ownerPreviewReady: Object.freeze({ ready: ownerReasons.length === 0, reasons: Object.freeze([...new Set(ownerReasons)]) }) });
}

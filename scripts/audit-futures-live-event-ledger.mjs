import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  auditLiveEventLedger,
  evaluateLiveEventAcceptance,
} from '../src/live-event-ledger.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const ledgerDir = path.join(root, 'data', 'live-events');
const reportDir = path.join(ledgerDir, 'futures-audits');
const readinessPath = path.join(root, 'data', 'readiness', 'shioaji-futures-access.json');
const readinessDir = path.dirname(readinessPath);
const hostClockFile = fs.readdirSync(readinessDir)
  .filter((name) => /^host-clock-check-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  .sort()
  .at(-1);
const hostClockPath = hostClockFile ? path.join(readinessDir, hostClockFile) : null;
const readiness = JSON.parse(fs.readFileSync(readinessPath, 'utf8'));
const hostClockReference = hostClockPath && fs.existsSync(hostClockPath)
  ? JSON.parse(fs.readFileSync(hostClockPath, 'utf8'))
  : null;
const productFamilies = ['TX', 'MTX', 'TMF'];
const requiredProducts = productFamilies.map((family) => {
  const targetCode = readiness?.contracts?.[family]?.targetCode;
  if (!targetCode) throw new Error(`futures_target_code_missing:${family}`);
  return targetCode;
});
const files = fs.existsSync(ledgerDir)
  ? fs.readdirSync(ledgerDir).filter((name) => /^\d{4}-\d{2}-\d{2}\.ndjson$/.test(name)).sort()
  : [];
const requestedDate = process.argv.find((value) => value.startsWith('--date='))?.slice(7) || null;
if (requestedDate && !/^\d{4}-\d{2}-\d{2}$/.test(requestedDate)) {
  throw new Error('invalid_audit_date');
}
const selected = requestedDate ? `${requestedDate}.ndjson` : files.at(-1);
if (!selected || !files.includes(selected)) throw new Error('futures_live_ledger_missing');
const ledgerPath = path.join(ledgerDir, selected);
const ledgerAudit = auditLiveEventLedger(ledgerPath, { staleAfterMs: 15 * 60_000 });

let operationalHealth = null;
try {
  const response = await fetch('http://127.0.0.1:8790/health', {
    signal: AbortSignal.timeout(2_000),
  });
  if (response.ok) {
    const health = await response.json();
    operationalHealth = {
      callbackErrors: Number(health.callbackErrors) || 0,
      dropped: Number(health.dropped) || 0,
      writerErrors: Number(health.writerErrors) || 0,
      processId: Number(health.processId) || null,
      executionAuthorized: health.executionAuthorized,
      orderRoutesEnabled: health.orderRoutesEnabled,
    };
  }
} catch {
  // An unavailable bridge keeps operational evidence pending.
}
if (!operationalHealth && Number(ledgerAudit?.kindStats?.bridge_stopped) > 0) {
  operationalHealth = {
    callbackErrors: Number(ledgerAudit?.observedOperationalErrors?.callbackErrors) || 0,
    dropped: Number(ledgerAudit?.observedOperationalErrors?.dropped) || 0,
    writerErrors: Number(ledgerAudit?.observedOperationalErrors?.writerErrors) || 0,
    processId: null,
    executionAuthorized: ledgerAudit.executionAuthorized,
    orderRoutesEnabled: false,
    source: 'final_bridge_stopped_event_and_ledger_boundary',
  };
}

const baseAcceptance = evaluateLiveEventAcceptance(ledgerAudit, {
  requiredProducts,
  minEventsPerProduct: 100,
  minDurationMs: 30 * 60_000,
  maxDuplicateRate: 0.01,
  maxInterEventGapMs: 5 * 60_000,
  requireReconnectEvidence: true,
  // The access probe may be rerun at any time, so checkedAt is not a valid
  // start marker for live evidence. Futures products only exist in this
  // ledger after the futures bridge was deployed; use an explicit immutable
  // marker when one is recorded, otherwise let their first events define it.
  evidenceNotBefore: readiness.liveEvidenceNotBefore || null,
  operationalHealth,
});
const requiredKindCounts = Object.fromEntries(requiredProducts.map((product) => [
  product,
  {
    tick: Number(ledgerAudit?.productKindStats?.[product]?.futures_tick) || 0,
    bidAsk: Number(ledgerAudit?.productKindStats?.[product]?.futures_bidask) || 0,
  },
]));
const postRestartKindCounts = Object.fromEntries(requiredProducts.map((product) => [
  product,
  {
    tick: Number(ledgerAudit?.postReconnectProductKindStats?.[product]?.futures_tick) || 0,
    bidAsk: Number(ledgerAudit?.postReconnectProductKindStats?.[product]?.futures_bidask) || 0,
  },
]));
const completedSessionStats = ledgerAudit?.latestCompletedReconnectProductStats || {};
const completedSessionKindStats = ledgerAudit?.latestCompletedReconnectProductKindStats || {};
const completedDurations = requiredProducts.map((product) => {
  const stats = completedSessionStats[product];
  if (!stats) return 0;
  const first = Date.parse(stats.firstReceivedAt);
  const last = Date.parse(stats.lastReceivedAt);
  return Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, last - first) : 0;
});
const completedSessionReady = requiredProducts.every((product) => {
  const stats = completedSessionStats[product];
  const kinds = completedSessionKindStats[product] || {};
  return Number(stats?.events) >= 100
    && Number(kinds.futures_tick) >= 1
    && Number(kinds.futures_bidask) >= 1;
});
const completedSessionDurationMs = completedSessionReady
  ? Math.min(...completedDurations)
  : 0;
const completedSessionMaxGapMs = completedSessionReady
  ? Math.max(...requiredProducts.map(
    (product) => Number(completedSessionStats[product]?.maxInterEventGapMs) || 0,
  ))
  : 0;
const completedSessionClockSkewEvents = requiredProducts.reduce(
  (sum, product) => sum + (Number(completedSessionStats[product]?.clockSkewEvents) || 0),
  0,
);
const missingKinds = [];
for (const [product, counts] of Object.entries(requiredKindCounts)) {
  if (counts.tick < 1) missingKinds.push(`futures_tick_missing:${product}`);
  if (counts.bidAsk < 1) missingKinds.push(`futures_bidask_missing:${product}`);
}
const missingPostRestartKinds = [];
for (const [product, counts] of Object.entries(postRestartKindCounts)) {
  if (counts.tick < 1) missingPostRestartKinds.push(`post_restart_futures_tick_missing:${product}`);
  if (counts.bidAsk < 1) missingPostRestartKinds.push(`post_restart_futures_bidask_missing:${product}`);
}
const failReasons = baseAcceptance.failReasons.filter(
  (reason) => reason !== 'clock_skew_detected',
);
const pendingReasons = baseAcceptance.pendingReasons.filter(
  (reason) => !['observation_window_too_short', 'post_repair_market_evidence_missing'].includes(reason),
);
pendingReasons.push(...missingKinds, ...missingPostRestartKinds);
if (!completedSessionReady) {
  pendingReasons.push('clean_completed_session_missing');
} else if (completedSessionDurationMs < 30 * 60_000) {
  pendingReasons.push('clean_completed_session_too_short');
}
if (completedSessionReady && completedSessionClockSkewEvents > 0) {
  failReasons.push('completed_session_clock_skew_detected');
}
if (operationalHealth?.executionAuthorized !== false
  || operationalHealth?.orderRoutesEnabled !== false) {
  failReasons.push('execution_boundary_invalid');
}
const status = failReasons.length ? 'FAIL' : pendingReasons.length ? 'PENDING' : 'PASS';
const acceptance = {
  ...baseAcceptance,
  status,
  passed: status === 'PASS',
  reasons: [...new Set([...failReasons, ...pendingReasons])],
  failReasons: [...new Set(failReasons)],
  pendingReasons: [...new Set(pendingReasons)],
  evidence: {
    ...baseAcceptance.evidence,
    requiredProductDurationMs: completedSessionDurationMs,
    requiredProductMaxGapMs: completedSessionMaxGapMs,
    acceptanceClockSkewEvents: completedSessionClockSkewEvents,
    globalLedgerClockSkewEvents: Number(ledgerAudit?.regularSessionClockSkewEvents) || 0,
    evidenceScope: 'latest_completed_reconnect_session_plus_current_post_restart_events',
  },
  requiredKinds: ['futures_tick', 'futures_bidask'],
  requiredKindCounts,
  postRestartKindCounts,
  completedSession: {
    ready: completedSessionReady,
    durationMs: completedSessionDurationMs,
    maxGapMs: completedSessionMaxGapMs,
    clockSkewEvents: completedSessionClockSkewEvents,
    productStats: completedSessionStats,
    productKindStats: completedSessionKindStats,
  },
  checks: {
    ...baseAcceptance.checks,
    timing: completedSessionReady ? completedSessionClockSkewEvents === 0 : null,
    tickAndBidAsk: missingKinds.length === 0,
    cleanCompletedSession: completedSessionReady
      && completedSessionDurationMs >= 30 * 60_000
      && completedSessionClockSkewEvents === 0,
    postRestartTickAndBidAsk: missingPostRestartKinds.length === 0,
    executionBoundary: operationalHealth
      ? operationalHealth.executionAuthorized === false
        && operationalHealth.orderRoutesEnabled === false
      : null,
  },
};
const report = {
  schemaVersion: 'v3.10-futures-live-acceptance-v1',
  generatedAt: new Date().toISOString(),
  ledgerFile: selected,
  productFamilies: Object.fromEntries(productFamilies.map((family, index) => [
    family,
    {
      subscriptionAlias: readiness.contracts[family].code,
      targetCode: requiredProducts[index],
    },
  ])),
  audit: ledgerAudit,
  timestampInterpretation: {
    signedDifference: 'received_at_minus_exchange_timestamp',
    pureNetworkLatency: false,
    hostClockReference,
  },
  acceptance,
  appendOnly: true,
  researchOnly: true,
  executionAuthorized: false,
  orderRoutesEnabled: false,
};
fs.mkdirSync(reportDir, { recursive: true });
for (const target of [
  path.join(reportDir, `${selected.slice(0, 10)}.json`),
  path.join(reportDir, 'latest.json'),
]) {
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  fs.renameSync(temporary, target);
}
console.log(JSON.stringify(report, null, 2));
if (status === 'FAIL') process.exitCode = 1;

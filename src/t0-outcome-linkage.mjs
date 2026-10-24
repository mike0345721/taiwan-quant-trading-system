// Read-only projection of the already frozen T0 historical experiment.
// This does not generate a new strategy, forward signal, fill or OOS sample.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {P0_SPEC, digest, auditPaperTradingLedger, buildHistoricalPaperSession} from './p0-paper-trading.mjs';
import {loadAndVerifyFrozenInputs, costViewsForTrade} from './t0-h0-runner.mjs';
import {hashJson} from './t0-data-replay-gate.mjs';
import {evidenceTimestampMs as ms} from './research-evidence-contract-v1.mjs';
import {safety} from './research-replay-outcome.mjs';

export const bytesHash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const finite = n => typeof n === 'number' && Number.isFinite(n);
const sha = x => typeof x === 'string' && /^[a-f0-9]{64}$/.test(x);
function requireThat(condition, reason) { if (!condition) throw Error(reason); }
export function readBounded(file, limit = 8 * 1024 * 1024) {
  const stat = fs.statSync(file);
  requireThat(stat.isFile() && stat.size <= limit, 'INPUT_NOT_BOUNDED_FILE');
  return fs.readFileSync(file);
}

export function projectT0Outcomes({sessions, events, costPolicy, strictSessions}) {
  requireThat(hashJson(costPolicy) === P0_SPEC.costPolicyHash, 'COST_POLICY_HASH_MISMATCH');
  requireThat(Array.isArray(sessions) && sessions.length > 0 && Array.isArray(strictSessions), 'SESSIONS_REQUIRED');
  requireThat(auditPaperTradingLedger(events).ok, 'PAPER_LEDGER_AUDIT_FAILED');
  const strict = new Map(strictSessions.map(s => [s.sessionId, s]));
  requireThat(strict.size === strictSessions.length && sessions.length === strict.size, 'SESSION_DENOMINATOR_MISMATCH');
  const seen = new Set(), expectedEvents = [], rows = [];
  const costAt = (s, price) => costViewsForTrade({direction: s.breakoutDirection, entryReferencePrice: s.entryReferencePrice, exitReferencePrice: price}, costPolicy).find(v => v.viewId === P0_SPEC.primaryCostView);
  for (const s of [...sessions].sort((a,b) => a.tradeDate.localeCompare(b.tradeDate))) {
    const m = strict.get(s.sessionId);
    requireThat(m && !seen.has(s.sessionId) && s.tradeDate === m.tradeDate && s.contractCode === m.actualReplayContractCode, 'SESSION_IDENTITY_MISMATCH');
    seen.add(s.sessionId);
    requireThat(s.synthetic === false && s.fixtureOnly === false && s.researchOnly === true && s.formalWeight === 0 && s.executionAuthorized === false, 'SESSION_SAFETY_OR_SYNTHETIC');
    requireThat(s.sampleState === 'ELIGIBLE' && s.qualityState === 'PASS' && s.pathQuality === 'PASS_TICK_ORDERED', 'SESSION_PATH_UNQUALIFIED');
    requireThat(['t0SpecHash','costPolicyHash','strictManifestHash'].every(k => s.inputEvidence?.[k] === P0_SPEC[k]), 'SESSION_FROZEN_HASH_MISMATCH');
    requireThat(sha(s.inputEvidence?.rawTickSourceHash), 'RAW_SOURCE_HASH_MISSING');
    const count = expectedEvents.length;
    buildHistoricalPaperSession(s, expectedEvents);
    const sessionEvents = expectedEvents.slice(count);
    const intent = sessionEvents.find(e => e.eventType === 'PAPER_INTENT_CREATED');
    const common = {tradeDate:s.tradeDate, sessionId:s.sessionId, session:'DAY', actualContract:s.contractCode,
      baselineId:P0_SPEC.baselineId, eventId:intent?.eventId ?? null, intentId:intent?.payload.intentId ?? null,
      paperEventRecordHash:intent?.recordHash ?? null, sourceEvidenceHash:sessionEvents[0].sourceEvidenceHash,
      rawTickSourceHash:s.inputEvidence.rawTickSourceHash, t0SpecHash:P0_SPEC.t0SpecHash, costPolicyHash:P0_SPEC.costPolicyHash,
      evidenceMode:'FROZEN_HISTORICAL_REPLAY', forwardEligible:false, oosEligible:false, realizedPnlTwd:null,
      causalExplanation:null, failureInterpretation:'FROZEN_RULE_DIAGNOSTICS_NOT_CAUSAL_EXPLANATION', ...safety};
    if (s.tradeState === 'NO_TRADE') {
      requireThat(typeof s.noTradeReason === 'string' && s.noTradeReason.length > 0, 'NO_TRADE_REASON_MISSING');
      rows.push({...common, state:'NO_TRADE', reason:s.noTradeReason, signalAvailableAt:null, mfePoints:null, maePoints:null,
        netExitPnlTwd:null, strategyEndpointNetPnlTwd:null, scheduledHorizonNetPnlTwd:null, failureReasons:[]});
      continue;
    }
    requireThat(s.tradeState === 'TRADE' && ['LONG','SHORT'].includes(s.breakoutDirection), 'TRADE_IDENTITY_INVALID');
    requireThat([s.entryReferencePrice,s.exitReferencePrice,s.initialStopPrice,s.mfePoints,s.maePoints].every(finite)
      && Math.min(s.entryReferencePrice,s.exitReferencePrice,s.initialStopPrice) > 0 && s.mfePoints >= 0 && s.maePoints <= 0, 'OUTCOME_VALUES_INVALID');
    const confirmation = ms(s.breakoutConfirmedAt), entry = ms(s.entryAt), exit = ms(s.exitAt), scheduled = ms(s.timeExitAt);
    // Legacy breakoutConfirmedAt names the confirmation BAR START. The frozen
    // rule uses its completed close, five minutes later. Keep both explicitly.
    requireThat([confirmation,entry,exit,scheduled].every(v => v !== null) && entry >= confirmation + 300000
      && exit >= entry && scheduled === entry + 3600000 && ['STOP_EXIT','TIME_EXIT'].includes(s.exitReason), 'TRADE_TIME_INVALID');
    requireThat(s.exitReason !== 'TIME_EXIT' || exit >= scheduled, 'TIME_EXIT_BEFORE_HORIZON');
    const recomputed = costViewsForTrade({direction:s.breakoutDirection,entryReferencePrice:s.entryReferencePrice,exitReferencePrice:s.exitReferencePrice}, costPolicy);
    assert.deepEqual(s.costViews, recomputed, 'FROZEN_COST_PARITY_FAILED');
    const cost = recomputed.find(v => v.viewId === P0_SPEC.primaryCostView), sign = s.breakoutDirection === 'LONG' ? 1 : -1;
    const failureReasons = [];
    if (s.exitReason === 'STOP_EXIT') failureReasons.push('STOP_EXIT');
    if (s.falseBreakout?.falseBreakout === true) failureReasons.push(s.falseBreakout.falseBreakoutReason);
    if (cost.grossPnl > 0 && cost.netPnl <= 0) failureReasons.push('COST_ERASED_GROSS_GAIN');
    if (cost.grossPnl <= 0) failureReasons.push('ADVERSE_OR_FLAT_EXIT');
    rows.push({...common,state:'LINKED_FROZEN_HISTORICAL',reason:null,side:s.breakoutDirection,
      legacyConfirmationBarStartAt:s.breakoutConfirmedAt, signalAvailableAt:new Date(confirmation+300000).toISOString(),
      signalTimeBasis:'HISTORICAL_BAR_CLOSE_RECONSTRUCTION_NOT_FORWARD_RECEIPT', sourceRecordedAt:intent.recordedAt,
      entryAt:s.entryAt,exitAt:s.exitAt,scheduledExitAt:s.timeExitAt,entryReferencePrice:s.entryReferencePrice,
      exitReferencePrice:s.exitReferencePrice,stopPrice:s.initialStopPrice,exitReason:s.exitReason,
      excursionScope:'ENTRY_THROUGH_FROZEN_STRATEGY_EXIT',mfePoints:s.mfePoints,maePoints:s.maePoints,
      maeMagnitudePoints:-s.maePoints,mfeAt:null,maeAt:null,extremaTimestampState:'NOT_STORED_IN_FROZEN_RESULT',
      maxNetLiquidationPnlTwd:costAt(s,s.entryReferencePrice+sign*s.mfePoints).netPnl,
      minNetLiquidationPnlTwd:costAt(s,s.entryReferencePrice+sign*s.maePoints).netPnl,
      netExitPnlTwd:cost.netPnl,strategyEndpointNetPnlTwd:cost.netPnl,
      scheduledHorizonNetPnlTwd:s.exitReason === 'TIME_EXIT' ? cost.netPnl : null,
      scheduledHorizonState:s.exitReason === 'TIME_EXIT' ? 'FROZEN_TIME_EXIT' : 'POST_STOP_PATH_NOT_STORED',
      grossPnlTwd:cost.grossPnl,commissionTwd:cost.entryCommission+cost.exitCommission,
      taxTwd:cost.entryTax+cost.exitTax,slippageTwd:cost.entrySlippage+cost.exitSlippage,
      totalCostTwd:cost.totalCost,costView:P0_SPEC.primaryCostView,costViews:recomputed,
      failureReasons:[...new Set(failureReasons)]});
  }
  // Full event/payload parity prevents unrelated or rehashed intents from joining.
  requireThat(digest(events) === digest(expectedEvents), 'SIGNAL_OUTCOME_LEDGER_PARITY_FAILED');
  const traded = rows.filter(r => r.state === 'LINKED_FROZEN_HISTORICAL');
  let equity = 0, peak = 0, maximumDrawdownTwd = 0;
  for (const r of rows) { equity += r.netExitPnlTwd ?? 0; peak = Math.max(peak,equity); maximumDrawdownTwd = Math.max(maximumDrawdownTwd,peak-equity); }
  return {schemaVersion:'t0-signal-outcome-linkage-v1',state:'HISTORICAL_LINKAGE_VERIFIED',baselineId:P0_SPEC.baselineId,
    rows,summary:{sessions:rows.length,linkedSignals:traded.length,noTradeSessions:rows.length-traded.length,
      netPnlTwd:equity,maximumDrawdownTwd,statisticalConfidence:null,oosSamples:0,
      interpretation:'DESCRIPTIVE_ALREADY_SEEN_HISTORY_NOT_EDGE_OR_OOS_VALIDATION'},
    depthIncrementalValue:{state:'UNAVAILABLE',reason:'NO_PAIRED_QUALIFIED_DEPTH_CORPUS',metrics:null}, ...safety};
}

/** Trusted repo pins bound every imported result and ledger; local files supply bytes only. */
export function loadT0OutcomeLinkage({repoRoot, sourceRoot}) {
  const frozen = loadAndVerifyFrozenInputs(sourceRoot), checked = [];
  for (const file of Object.values(frozen.files)) {
    const bytes = readBounded(file); checked.push({file,sha256:bytesHash(bytes),bytes:bytes.length});
  }
  function pinned(file, expected) {
    const bytes = readBounded(file);
    requireThat(sha(expected) && bytesHash(bytes) === expected, `SOURCE_HASH_MISMATCH:${path.basename(file)}`);
    checked.push({file,sha256:expected,bytes:bytes.length}); return bytes;
  }
  const closeout = JSON.parse(readBounded(path.join(repoRoot,'data/research/t0-h0-formal-v1/closeout-2026-08-02-v1/CLOSEOUT_MANIFEST.json')));
  const paper = JSON.parse(readBounded(path.join(repoRoot,'data/paper/p0-historical-dry-run-v2/FINAL_MANIFEST.json')));
  const dir = path.join(sourceRoot,'data/research/t0-h0-formal-v1/run-2026-08-02-v1');
  const manifest = JSON.parse(pinned(path.join(dir,'RUN_MANIFEST.json'),closeout.formalRun.runManifestHash));
  requireThat(manifest.status === 'COMPLETED' && manifest.jobs.length === frozen.strictManifest.sessions.length, 'RUN_MANIFEST_INVALID');
  const sessions = manifest.jobs.map(job => {
    requireThat(/^\d{4}-\d{2}-\d{2}-DAY$/.test(job.jobId) && job.status === 'COMPLETED', 'JOB_ID_INVALID');
    const session = JSON.parse(pinned(path.join(dir,'jobs',`${job.jobId}.json`),job.outputHash));
    requireThat(session.sessionId === job.jobId, 'JOB_SESSION_MISMATCH'); return session;
  });
  const ledgerFile = path.join(sourceRoot,'data/paper/p0-historical-dry-run-v2/PAPER_TRADING_EVENT_LEDGER.jsonl');
  const events = pinned(ledgerFile,paper.artifacts['PAPER_TRADING_EVENT_LEDGER.jsonl']).toString('utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const result = projectT0Outcomes({sessions,events,costPolicy:frozen.costPolicy,strictSessions:frozen.strictManifest.sessions});
  for (const item of checked) requireThat(bytesHash(readBounded(item.file)) === item.sha256, 'SOURCE_CHANGED_DURING_READ');
  return {...result,sourceEvidence:{files:checked,sourceFilesUnchanged:true,rawTicksRereplayed:false,
    qualification:'PINNED_HISTORICAL_ARTIFACT_AND_COST_PARITY',ledgerLogicalHash:digest(events),frozenHashes:frozen.hashes}};
}

import crypto from 'node:crypto';
import { digest } from './market-state-forward-shadow.mjs';
import { resolveGovernedTradingDay, resolvePreviousGovernedTradingDate } from './market-state-forward-shadow-calendar.mjs';
import { buildDailyCollectionAcceptance, stableDailyAcceptanceJson, DAILY_ACCEPTANCE_STATES, RESEARCH_ELIGIBILITY_STATES } from './daily-collection-acceptance.mjs';
import { OPERATIONAL_PROFILE, OPERATIONAL_PROFILE_VERSION } from './daily-data-operations-profile.mjs';
import { REMEDIATION_MATRIX_VERSION, remediationFor } from './daily-data-remediation.mjs';

export const OPERATIONS_SCHEMA_VERSION = 'daily-data-operations-v1';
export const CHECKPOINT_TYPES = Object.freeze(['DAY_CHECKPOINT', 'EOD_CHECKPOINT', 'FINAL_TRADEDATE_CHECKPOINT']);
export const SAFETY = Object.freeze({ formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false });
export const operationsHash = value => crypto.createHash('sha256').update(stableDailyAcceptanceJson(value)).digest('hex');
const unique = values => [...new Set(values)].sort();
const time = value => typeof value === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(value) ? Date.parse(value) : NaN;
const knownHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const atCutoff = (value, cutoff) => Number.isFinite(time(value)) && time(value) <= time(cutoff);
const error = code => { throw new Error(code); };
export function assertOperationsDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '') || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) error('OPERATIONS_TRADE_DATE_INVALID');
}

// A.1's pure builder is reused only to bind optional session metadata to the
// supplied report. This never opens or scans a ledger, DB, or current runtime.
function validateInput(report, acceptanceInputs) {
  if (report?.schemaVersion !== 'daily-collection-acceptance-v1') error('OPERATIONS_INPUT_SCHEMA_INVALID');
  assertOperationsDate(report.tradeDate);
  if (!Number.isFinite(time(report.generatedAt))) error('OPERATIONS_INPUT_CUTOFF_INVALID');
  if (!['TRADING_DAY', 'NON_TRADING_DAY', 'UNKNOWN'].includes(report.marketDayState)
    || !Array.isArray(report.sessions) || report.sessions.some(s => !['DAY', 'NIGHT'].includes(s))
    || !Array.isArray(report.feeds)) error('OPERATIONS_INPUT_INVALID');
  if (Object.keys(SAFETY).some(key => report.safety?.[key] !== SAFETY[key])) error('OPERATIONS_UNSAFE_INPUT');
  const keys = new Set();
  for (const feed of report.feeds) {
    const key = `${feed.datasetId ?? feed.technicalLabelEn}:${feed.session}`;
    if (keys.has(key)) error('OPERATIONS_DUPLICATE_FEED');
    keys.add(key);
    if (feed.tradeDate !== report.tradeDate || !Array.isArray(feed.reasonCodes)
      || ['captureState', 'coverageState', 'persistenceState', 'integrityState'].some(k => !DAILY_ACCEPTANCE_STATES.includes(feed[k]))
      || !RESEARCH_ELIGIBILITY_STATES.includes(feed.researchEligibility)) error('OPERATIONS_FEED_INVALID');
    for (const k of ['availableAt', 'observedAt', 'generatedAt', 'firstReceivedAt', 'lastReceivedAt']) {
      if (feed[k] != null && !atCutoff(feed[k], report.generatedAt)) error('OPERATIONS_EVIDENCE_AFTER_CUTOFF');
    }
  }
  if (acceptanceInputs) {
    const rebuilt = buildDailyCollectionAcceptance(acceptanceInputs);
    // CLI evidenceInputs/evidenceGapMatrix are additional metadata, not builder fields.
    if (Object.keys(rebuilt).some(key => operationsHash(rebuilt[key]) !== operationsHash(report[key]))) error('OPERATIONS_A1_REPLAY_MISMATCH');
  }
}

function aggregate(states) {
  const active = states.filter(state => state !== 'NOT_EXPECTED');
  if (!active.length) return 'NOT_EXPECTED';
  if (active.every(state => state === 'FAIL')) return 'FAIL';
  if (active.some(state => ['FAIL', 'PARTIAL'].includes(state))) return 'PARTIAL';
  if (active.includes('UNKNOWN')) return 'UNKNOWN';
  if (active.includes('PENDING')) return 'PENDING';
  return 'PASS';
}
function collectionState(feed) {
  if (!feed) return 'UNKNOWN';
  const states = [feed.captureState, feed.persistenceState, feed.integrityState];
  if (feed.mode === 'LIVE_EVENT') states.push(feed.coverageState);
  if (states.includes('FAIL')) return 'FAIL';
  if (states.includes('PARTIAL')) return 'PARTIAL';
  if (states.includes('PENDING')) return 'PENDING';
  if (states.some(s => s !== 'PASS')) return 'UNKNOWN';
  return 'PASS';
}

function governedCalendar(report, calendarJson) {
  if (calendarJson == null) return null;
  if (typeof calendarJson !== 'string' || digest(calendarJson) !== report.evidenceInputs?.calendar?.sha256) error('OPERATIONS_CALENDAR_IDENTITY_MISMATCH');
  const payload = JSON.parse(calendarJson);
  const { fileHash, ...body } = payload;
  if (payload.schemaVersion !== 'taifex-governed-trading-calendar-v1' || payload.sourceType !== 'TAIFEX_OFFICIAL_CALENDAR_SNAPSHOT'
    || payload.ownerApproved !== true || digest(body) !== fileHash || !knownHash(payload.sourceHash)
    || !Array.isArray(payload.tradingDates) || !Array.isArray(payload.nonTradingDates)
    || payload.tradingDates.some(d => payload.nonTradingDates.includes(d))) error('OPERATIONS_CALENDAR_INVALID');
  const calendar = { payload, fileHash, tradingDates: new Set(payload.tradingDates), nonTradingDates: new Set(payload.nonTradingDates), exceptions: new Map() };
  const day = resolveGovernedTradingDay(calendar, report.tradeDate);
  if (report.marketDayState !== 'UNKNOWN' && day.state !== report.marketDayState) error('OPERATIONS_CALENDAR_STATE_MISMATCH');
  return calendar;
}
function sessionStatus(report, inputs, session, calendar) {
  if (!calendar) return 'UNKNOWN';
  if (report.marketDayState === 'NON_TRADING_DAY') return 'NOT_EXPECTED';
  if (report.marketDayState !== 'TRADING_DAY' || !report.sessions.includes(session)) return 'UNKNOWN';
  const window = inputs?.liveEvidence?.sessionWindows?.[session];
  if (!Number.isFinite(time(window?.sessionStart)) || !Number.isFinite(time(window?.sessionEnd))
    || time(window.sessionStart) >= time(window.sessionEnd)) return 'UNKNOWN';
  let expectedStart, expectedEnd;
  if (session === 'DAY') {
    expectedStart = `${report.tradeDate}T08:45:00+08:00`;
    expectedEnd = `${report.tradeDate}T13:45:00+08:00`;
  } else {
    const previous = resolvePreviousGovernedTradingDate(calendar, report.tradeDate);
    const followingCalendarDate = new Date(Date.parse(`${previous}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    expectedStart = `${previous}T15:00:00+08:00`;
    expectedEnd = `${followingCalendarDate}T05:00:00+08:00`;
  }
  // These are the exact existing A.1 session rules; no publication time is inferred.
  if (time(window.sessionStart) !== time(expectedStart) || time(window.sessionEnd) !== time(expectedEnd)) return 'UNKNOWN';
  return atCutoff(window.sessionEnd, report.generatedAt) ? 'ENDED' : 'PENDING';
}
function validateDueRules(rules, report) {
  for (const [id, rule] of Object.entries(rules)) {
    if (!OPERATIONAL_PROFILE.some(p => p.datasetId === id && p.operationalRole === 'CORE_EOD_REQUIRED')
      || rule.datasetId !== id || rule.tradeDate !== report.tradeDate || rule.governanceState !== 'GOVERNED'
      || typeof rule.governanceReference !== 'string' || !rule.governanceReference.trim()
      || !knownHash(rule.sourceArtifactIdentity?.sha256) || !Number.isFinite(time(rule.dueAt))
      || !atCutoff(rule.observedAt, report.generatedAt)) error('OPERATIONS_DUE_RULE_INVALID');
  }
}

function evaluateRow(profile, session, feed, context) {
  const { report, inputs, checkpointType, dueRules, calendar } = context;
  const reasons = [...(feed?.reasonCodes || [])];
  const role = profile.operationalRole;
  let dueState = 'UNKNOWN';
  let operationalState = 'UNKNOWN';
  const inCheckpointScope = !(checkpointType === 'DAY_CHECKPOINT' && session === 'NIGHT');
  if (role === 'FUTURE_NOT_ENABLED' || report.marketDayState === 'NON_TRADING_DAY'
    || (['DAY', 'NIGHT'].includes(session) && !profile.applicableSession.includes(session))) {
    dueState = operationalState = 'NOT_EXPECTED';
    reasons.push(role === 'FUTURE_NOT_ENABLED' ? 'NOT_ENABLED' : report.marketDayState === 'NON_TRADING_DAY' ? 'MARKET_CLOSED' : 'NOT_IN_CURRENT_SCOPE');
  } else if (!feed) {
    reasons.push('INPUT_ROW_MISSING');
    if (profile.blocksCoreLive && report.marketDayState === 'TRADING_DAY' && report.sessions.includes(session)) {
      dueState = sessionStatus(report, inputs, session, calendar) === 'PENDING' ? 'PENDING' : 'DUE';
      if (dueState === 'PENDING') { operationalState = 'PENDING'; reasons.push('SESSION_NOT_ENDED'); }
    }
    if (role === 'CORE_EOD_REQUIRED' && report.marketDayState === 'TRADING_DAY') {
      const rule = dueRules[profile.datasetId];
      if (rule) {
        dueState = atCutoff(rule.dueAt, report.generatedAt) ? 'DUE' : 'PENDING';
        if (dueState === 'PENDING') { operationalState = 'PENDING'; reasons.push('NOT_PUBLISHED_YET'); }
      } else reasons.push('DUE_SEMANTICS_UNGOVERNED');
    }
  } else if (report.marketDayState !== 'TRADING_DAY') {
    reasons.push('TIMESTAMP_LINEAGE_INSUFFICIENT');
  } else if (['CORE_INTRADAY_REQUIRED', 'CORE_DAY_CONTEXT_REQUIRED', 'SUPPORTING_OPERATIONAL_MONITOR'].includes(role)) {
    if (!report.sessions.includes(session) || feed.expectedState === 'NOT_EXPECTED') {
      reasons.push('INPUT_SESSION_NOT_EVALUATED');
    } else {
      dueState = 'DUE';
      operationalState = collectionState(feed);
      if (sessionStatus(report, inputs, session, calendar) === 'PENDING' || operationalState === 'PENDING') {
        dueState = 'PENDING'; operationalState = 'PENDING'; reasons.push('SESSION_NOT_ENDED');
      }
    }
  } else if (role === 'CORE_EOD_REQUIRED') {
    const rule = dueRules[profile.datasetId];
    const publicationKnown = feed.sourceDate === report.tradeDate && knownHash(feed.sourceArtifactIdentity?.sha256)
      && atCutoff(feed.availableAt, report.generatedAt) && atCutoff(feed.observedAt, report.generatedAt);
    if (rule && !atCutoff(rule.dueAt, report.generatedAt)) {
      dueState = operationalState = 'PENDING'; reasons.push('NOT_PUBLISHED_YET');
    } else if (rule || publicationKnown) {
      dueState = 'DUE'; operationalState = collectionState(feed);
    } else if (feed.expectedState === 'PENDING' || feed.captureState === 'PENDING' || reasons.includes('NOT_PUBLISHED_YET')) {
      dueState = operationalState = 'PENDING';
    } else {
      reasons.push('DUE_SEMANTICS_UNGOVERNED');
    }
  } else if (role === 'DERIVED_RESEARCH_READINESS') {
    operationalState = feed.researchEligibility === 'READY' ? 'PASS'
      : feed.researchEligibility === 'READY_WITH_LIMITATION' ? 'PARTIAL'
      : feed.researchEligibility === 'NOT_READY' ? 'FAIL' : 'UNKNOWN';
  } else {
    operationalState = collectionState(feed);
  }
  if (role === 'SUPPORTING_OPERATIONAL_MONITOR') reasons.push('CANONICAL_DATASET_ID_UNAVAILABLE');
  return { ...profile, session, inCheckpointScope, dueState,
    requiredAndDue: inCheckpointScope && (profile.blocksCoreLive || profile.blocksCoreEod) && dueState === 'DUE',
    operationalState, reasonCodes: unique(reasons), evidence: feed || null,
    // Feed metadata is kept verbatim; breadth never gains invented sector components.
    componentScope: profile.datasetId === 'market_breadth_and_sector_leadership' ? 'TWSE_EOD_BREADTH_ONLY_SECTOR_LEADERSHIP_UNKNOWN' : null };
}

function section(rows) {
  const active = rows.filter(r => r.inCheckpointScope);
  return { state: aggregate(active.map(r => r.operationalState)), requiredAndDueCount: active.filter(r => r.requiredAndDue).length,
    pendingCount: active.filter(r => r.operationalState === 'PENDING').length,
    unknownCount: active.filter(r => r.operationalState === 'UNKNOWN').length,
    captureState: aggregate(active.map(r => r.evidence?.captureState || 'UNKNOWN')),
    persistenceState: aggregate(active.map(r => r.evidence?.persistenceState || 'UNKNOWN')),
    integrityState: aggregate(active.map(r => r.evidence?.integrityState || 'UNKNOWN')),
    rows };
}

export function buildDailyDataOperations({ acceptanceReport: report, acceptanceInputs = null, checkpointType,
  generatedAt, dueRules = {}, inputArtifactIdentity = null, calendarJson = null } = {}) {
  validateInput(report, acceptanceInputs);
  const calendar = governedCalendar(report, calendarJson);
  if (!CHECKPOINT_TYPES.includes(checkpointType)) error('OPERATIONS_CHECKPOINT_INVALID');
  if (!Number.isFinite(time(generatedAt)) || time(generatedAt) < time(report.generatedAt)) error('OPERATIONS_GENERATED_AT_BEFORE_INPUT');
  if (inputArtifactIdentity != null && !knownHash(inputArtifactIdentity.sha256)) error('OPERATIONS_INPUT_IDENTITY_INVALID');
  validateDueRules(dueRules, report);
  const rows = OPERATIONAL_PROFILE.flatMap(profile => {
    const matches = report.feeds.filter(f => profile.datasetId != null ? f.datasetId === profile.datasetId : f.datasetId == null && f.technicalLabelEn === profile.feedIdentity);
    const live = ['CORE_INTRADAY_REQUIRED', 'CORE_DAY_CONTEXT_REQUIRED', 'SUPPORTING_OPERATIONAL_MONITOR'].includes(profile.operationalRole);
    const sessions = live ? ['DAY', 'NIGHT'] : profile.operationalRole === 'DERIVED_RESEARCH_READINESS'
      ? unique(matches.map(f => f.session).length ? matches.map(f => f.session) : ['NIGHT_PLUS_DAY'])
      : profile.operationalRole === 'FUTURE_NOT_ENABLED' ? ['NOT_APPLICABLE'] : ['EOD'];
    return sessions.map(session => evaluateRow(profile, session, matches.find(f => f.session === session),
      { report, inputs: acceptanceInputs, checkpointType, dueRules, calendar }));
  });
  const coreLive = section(rows.filter(r => r.blocksCoreLive));
  const coreEod = section(rows.filter(r => r.blocksCoreEod));
  const supportingFeeds = section(rows.filter(r => r.operationalRole === 'SUPPORTING_OPERATIONAL_MONITOR'));
  const derivedRows = rows.filter(r => r.operationalRole === 'DERIVED_RESEARCH_READINESS');
  const researchRows = rows.filter(r => r.blocksResearch);
  const researchStates = researchRows.filter(r => r.inCheckpointScope).map(r => r.operationalState === 'NOT_EXPECTED' ? 'NOT_EXPECTED'
    : r.dueState === 'PENDING' ? 'PENDING' : r.evidence?.researchEligibility === 'READY' ? 'PASS'
      : r.evidence?.researchEligibility === 'READY_WITH_LIMITATION' ? 'PARTIAL' : r.evidence?.researchEligibility === 'NOT_READY' ? 'FAIL' : 'UNKNOWN');
  const researchReadiness = { state: aggregate(researchStates), rawPrerequisiteRows: researchRows.filter(r => r.blocksCoreLive), derivedRows,
    rawCollectionDenominatorContribution: 0 };
  const sessionEvaluation = Object.fromEntries(['DAY', 'NIGHT'].map(s => [s, sessionStatus(report, acceptanceInputs, s, calendar)]));
  const cutoffs = report.sourceArtifactIdentity;
  const frozen = report.marketDayState === 'NON_TRADING_DAY' || (cutoffs?.type === 'append-only-ledger-fixed-byte-cutoff'
    && Array.isArray(cutoffs.files) && (cutoffs.files.length > 0 || (Array.isArray(cutoffs.missingFiles) && cutoffs.missingFiles.length > 0)) && cutoffs.files.every(f => knownHash(f.prefixSha256) && Number.isSafeInteger(f.cutoffBytes) && f.cutoffBytes >= 0));
  const finalizationReasons = [];
  if (checkpointType !== 'FINAL_TRADEDATE_CHECKPOINT') finalizationReasons.push('CHECKPOINT_NOT_FINAL');
  if (Object.values(sessionEvaluation).some(s => s === 'UNKNOWN')) finalizationReasons.push('CHECKPOINT_SESSION_EVIDENCE_UNAVAILABLE');
  if (Object.values(sessionEvaluation).some(s => s === 'PENDING')) finalizationReasons.push('SESSION_NOT_ENDED');
  if (!frozen) finalizationReasons.push('IMMUTABLE_CUTOFF_UNAVAILABLE');
  if ([...coreLive.rows, ...coreEod.rows].some(r => r.operationalState === 'PENDING')) finalizationReasons.push('EXPECTED_INPUT_PENDING');
  const finalizationEligible = finalizationReasons.length === 0;
  const inputReportHash = operationsHash(report);
  const invocation = { tradeDate: report.tradeDate, checkpointType, generatedAt: new Date(generatedAt).toISOString(), inputReportHash,
    inputArtifactIdentity, calendarHash: calendarJson == null ? null : digest(calendarJson), acceptanceInputsHash: acceptanceInputs ? operationsHash(acceptanceInputs) : null,
    immutableLedgerCutoffs: cutoffs, dueRules, operationalProfileVersion: OPERATIONAL_PROFILE_VERSION, remediationMatrixVersion: REMEDIATION_MATRIX_VERSION };
  const remediationActions = rows.flatMap(r => r.reasonCodes.map(code => ({ ...remediationFor(code, r),
    datasetId: r.datasetId, feedIdentity: r.feedIdentity, session: r.session, inCheckpointScope: r.inCheckpointScope })));
  const result = { schemaVersion: OPERATIONS_SCHEMA_VERSION, ...invocation, invocationHash: operationsHash(invocation),
    sourceArtifactIdentity: { acceptance: inputArtifactIdentity, inputReportHash, upstream: cutoffs, evidenceInputs: report.evidenceInputs || null },
    inputGeneratedAt: report.generatedAt, marketDayState: report.marketDayState,
    coreLive, coreEod, supportingFeeds, researchReadiness,
    conditionalContext: section(rows.filter(r => r.operationalRole === 'CONDITIONAL_CONTEXT')),
    futureNotEnabled: rows.filter(r => r.operationalRole === 'FUTURE_NOT_ENABLED'),
    coreLiveState: coreLive.state, coreEodState: coreEod.state, supportingState: supportingFeeds.state, researchReadinessState: researchReadiness.state,
    overallState: aggregate([coreLive.state, coreEod.state]), requiredAndDueCount: coreLive.requiredAndDueCount + coreEod.requiredAndDueCount,
    sessionEvaluation, checkpointEligible: checkpointType !== 'DAY_CHECKPOINT' || ['ENDED', 'NOT_EXPECTED'].includes(sessionEvaluation.DAY),
    finalizationEligible, finalizationReason: finalizationEligible ? 'NO_EXPECTED_FUTURE_INPUT_UNDER_CURRENT_CONTRACT' : finalizationReasons.join('|'),
    finalizationReasons, finalizationState: finalizationEligible ? 'FINALIZED' : 'NOT_FINALIZED',
    reasonCodes: unique([...rows.flatMap(r => r.reasonCodes), ...finalizationReasons]), remediationActions,
    acceptanceJobHealth: { runMode: 'MANUAL_OFFLINE', jobState: 'COMPUTED', lastAttemptAt: null, lastSuccessAt: null,
      lastFinalizedTradeDate: null, lastFinalizedAt: null, inputTradeDate: report.tradeDate, checkpointType,
      jobReason: 'PURE_ASSESSMENT_COMPUTED_PERSISTENCE_NOT_ATTESTED', reportArtifactIdentity: null }, safety: SAFETY };
  return { ...result, reportHash: operationsHash(result) };
}

export function validateDailyDataOperations(report) {
  if (!report || report.schemaVersion !== OPERATIONS_SCHEMA_VERSION) error('OPERATIONS_REPORT_SCHEMA_INVALID');
  const { reportHash, ...body } = report;
  if (!knownHash(reportHash) || reportHash !== operationsHash(body)) error('OPERATIONS_REPORT_HASH_MISMATCH');
  if (Object.keys(SAFETY).some(k => report.safety?.[k] !== SAFETY[k])) error('OPERATIONS_UNSAFE_REPORT');
  assertOperationsDate(report.tradeDate);
  if (!CHECKPOINT_TYPES.includes(report.checkpointType) || !Number.isFinite(time(report.generatedAt))
    || !atCutoff(report.inputGeneratedAt, report.generatedAt) || !knownHash(report.inputReportHash)
    || !['TRADING_DAY', 'NON_TRADING_DAY', 'UNKNOWN'].includes(report.marketDayState)
    || report.operationalProfileVersion !== OPERATIONAL_PROFILE_VERSION || report.remediationMatrixVersion !== REMEDIATION_MATRIX_VERSION
    || !report.sourceArtifactIdentity || report.sourceArtifactIdentity.inputReportHash !== report.inputReportHash
    || !report.sessionEvaluation || !['DAY', 'NIGHT'].every(s => ['ENDED', 'PENDING', 'NOT_EXPECTED', 'UNKNOWN'].includes(report.sessionEvaluation[s]))) error('OPERATIONS_REPORT_IDENTITY_INVALID');
  const invocationKeys = ['tradeDate', 'checkpointType', 'generatedAt', 'inputReportHash', 'inputArtifactIdentity',
    'calendarHash', 'acceptanceInputsHash', 'immutableLedgerCutoffs', 'dueRules', 'operationalProfileVersion', 'remediationMatrixVersion'];
  if (invocationKeys.some(k => !Object.hasOwn(report, k))) error('OPERATIONS_INVOCATION_INVALID');
  const invocation = Object.fromEntries(invocationKeys.map(k => [k, report[k]]));
  if (operationsHash(invocation) !== report.invocationHash || (report.acceptanceInputsHash !== null && !knownHash(report.acceptanceInputsHash))
    || (report.inputArtifactIdentity !== null && !knownHash(report.inputArtifactIdentity.sha256))
    || operationsHash(report.sourceArtifactIdentity.upstream) !== operationsHash(report.immutableLedgerCutoffs)) error('OPERATIONS_INVOCATION_INVALID');
  validateDueRules(report.dueRules, { tradeDate: report.tradeDate, generatedAt: report.inputGeneratedAt });
  const sections = ['coreLive', 'coreEod', 'supportingFeeds', 'conditionalContext'];
  if (sections.some(k => !report[k] || !Array.isArray(report[k].rows)) || !Array.isArray(report.futureNotEnabled)
    || !report.researchReadiness || !Array.isArray(report.researchReadiness.derivedRows)
    || !Array.isArray(report.researchReadiness.rawPrerequisiteRows) || !Array.isArray(report.remediationActions)
    || !Array.isArray(report.reasonCodes) || !Array.isArray(report.finalizationReasons)) error('OPERATIONS_REPORT_SECTIONS_REQUIRED');
  const rows = [...report.coreLive.rows, ...report.coreEod.rows, ...report.supportingFeeds.rows,
    ...report.conditionalContext.rows, ...report.researchReadiness.derivedRows, ...report.futureNotEnabled];
  for (const profile of OPERATIONAL_PROFILE) {
    const matched = rows.filter(r => r.datasetId === profile.datasetId && r.feedIdentity === profile.feedIdentity);
    const expectedSessions = ['CORE_INTRADAY_REQUIRED', 'CORE_DAY_CONTEXT_REQUIRED', 'SUPPORTING_OPERATIONAL_MONITOR'].includes(profile.operationalRole)
      ? ['DAY', 'NIGHT'] : profile.operationalRole === 'FUTURE_NOT_ENABLED' ? ['NOT_APPLICABLE']
        : profile.operationalRole === 'DERIVED_RESEARCH_READINESS' ? null : ['EOD'];
    if (!matched.length || new Set(matched.map(r => r.session)).size !== matched.length
      || (expectedSessions && operationsHash(matched.map(r => r.session).sort()) !== operationsHash(expectedSessions.sort()))) error('OPERATIONS_PROFILE_ROWS_INVALID');
    for (const row of matched) {
      if (Object.keys(profile).some(k => operationsHash(row[k]) !== operationsHash(profile[k]))
        || !DAILY_ACCEPTANCE_STATES.includes(row.operationalState) || !['DUE', 'PENDING', 'UNKNOWN', 'NOT_EXPECTED'].includes(row.dueState)
        || !Array.isArray(row.reasonCodes) || typeof row.inCheckpointScope !== 'boolean'
        || row.inCheckpointScope !== !(report.checkpointType === 'DAY_CHECKPOINT' && row.session === 'NIGHT')
        || row.requiredAndDue !== (row.inCheckpointScope && (row.blocksCoreLive || row.blocksCoreEod) && row.dueState === 'DUE')) error('OPERATIONS_PROFILE_ROW_INVALID');
    }
  }
  if (rows.some(r => !OPERATIONAL_PROFILE.some(p => p.datasetId === r.datasetId && p.feedIdentity === r.feedIdentity))
    || report.coreLive.rows.some(r => !r.blocksCoreLive) || report.coreEod.rows.some(r => !r.blocksCoreEod)
    || report.supportingFeeds.rows.some(r => r.operationalRole !== 'SUPPORTING_OPERATIONAL_MONITOR')
    || report.conditionalContext.rows.some(r => r.operationalRole !== 'CONDITIONAL_CONTEXT')
    || report.researchReadiness.derivedRows.some(r => r.operationalRole !== 'DERIVED_RESEARCH_READINESS')
    || report.futureNotEnabled.some(r => r.operationalRole !== 'FUTURE_NOT_ENABLED')) error('OPERATIONS_SECTION_SCOPE_INVALID');
  for (const key of sections) {
    const expected = section(report[key].rows);
    if (Object.keys(expected).some(k => operationsHash(expected[k]) !== operationsHash(report[key][k]))) error('OPERATIONS_SECTION_SUMMARY_INVALID');
  }
  const researchRows = rows.filter(r => r.blocksResearch);
  const researchStates = researchRows.filter(r => r.inCheckpointScope).map(r => r.operationalState === 'NOT_EXPECTED' ? 'NOT_EXPECTED'
    : r.dueState === 'PENDING' ? 'PENDING' : r.evidence?.researchEligibility === 'READY' ? 'PASS'
      : r.evidence?.researchEligibility === 'READY_WITH_LIMITATION' ? 'PARTIAL' : r.evidence?.researchEligibility === 'NOT_READY' ? 'FAIL' : 'UNKNOWN');
  if (report.researchReadiness.state !== aggregate(researchStates) || report.researchReadiness.rawCollectionDenominatorContribution !== 0
    || operationsHash(report.researchReadiness.rawPrerequisiteRows) !== operationsHash(report.coreLive.rows.filter(r => r.blocksResearch))
    || report.coreLiveState !== report.coreLive.state || report.coreEodState !== report.coreEod.state
    || report.supportingState !== report.supportingFeeds.state || report.researchReadinessState !== report.researchReadiness.state
    || report.requiredAndDueCount !== report.coreLive.requiredAndDueCount + report.coreEod.requiredAndDueCount
    || report.overallState !== aggregate([report.coreLive.state, report.coreEod.state])) error('OPERATIONS_SUMMARY_INVALID');
  const cutoffs = report.immutableLedgerCutoffs;
  const frozen = report.marketDayState === 'NON_TRADING_DAY' || (cutoffs?.type === 'append-only-ledger-fixed-byte-cutoff'
    && Array.isArray(cutoffs.files) && (cutoffs.files.length > 0 || (Array.isArray(cutoffs.missingFiles) && cutoffs.missingFiles.length > 0)) && cutoffs.files.every(f => knownHash(f.prefixSha256) && Number.isSafeInteger(f.cutoffBytes) && f.cutoffBytes >= 0));
  const reasons = [];
  if (report.checkpointType !== 'FINAL_TRADEDATE_CHECKPOINT') reasons.push('CHECKPOINT_NOT_FINAL');
  if (Object.values(report.sessionEvaluation).some(s => s === 'UNKNOWN')) reasons.push('CHECKPOINT_SESSION_EVIDENCE_UNAVAILABLE');
  if (Object.values(report.sessionEvaluation).some(s => s === 'PENDING')) reasons.push('SESSION_NOT_ENDED');
  if (!frozen) reasons.push('IMMUTABLE_CUTOFF_UNAVAILABLE');
  if ([...report.coreLive.rows, ...report.coreEod.rows].some(r => r.operationalState === 'PENDING')) reasons.push('EXPECTED_INPUT_PENDING');
  if (operationsHash(reasons) !== operationsHash(report.finalizationReasons) || report.finalizationEligible !== (reasons.length === 0)
    || report.finalizationState !== (reasons.length ? 'NOT_FINALIZED' : 'FINALIZED')
    || report.finalizationReason !== (reasons.length ? reasons.join('|') : 'NO_EXPECTED_FUTURE_INPUT_UNDER_CURRENT_CONTRACT')
    || report.checkpointEligible !== (report.checkpointType !== 'DAY_CHECKPOINT' || ['ENDED', 'NOT_EXPECTED'].includes(report.sessionEvaluation.DAY))) error('OPERATIONS_FINALIZATION_INVALID');
  const expectedHealth = { runMode: 'MANUAL_OFFLINE', jobState: 'COMPUTED', lastAttemptAt: null, lastSuccessAt: null,
    lastFinalizedTradeDate: null, lastFinalizedAt: null, inputTradeDate: report.tradeDate, checkpointType: report.checkpointType,
    jobReason: 'PURE_ASSESSMENT_COMPUTED_PERSISTENCE_NOT_ATTESTED', reportArtifactIdentity: null };
  if (operationsHash(report.acceptanceJobHealth) !== operationsHash(expectedHealth)) error('OPERATIONS_JOB_HEALTH_INVALID');
  return true;
}

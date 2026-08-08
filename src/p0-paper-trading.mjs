import fs from 'node:fs';
import path from 'node:path';
import { jcsNfc, sha256Hex } from './phase-b-b0-v4-core.mjs';

export const P0_SPEC = Object.freeze({
  schemaVersion: 'p0-paper-trading-v1', baselineId: 'T0_H0_PHASE_B_BASELINE_V1', quantity: 1,
  t0SpecHash: 'c2baf6a63cf69407ae9e686af46bb5832adcebf9d859b170fe9096c8f7389253',
  costPolicyHash: 'ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc',
  strictManifestHash: '87bbf9a01ccec29fcf29251f98ed71f55590ecab213693d6d3f95584b8d6f2ff',
  primaryCostView: 'BASE_2_TICKS_PER_SIDE', formalWeight: 0, researchOnly: true, executionAuthorized: false,
});

export const PAPER_STATES = Object.freeze(['PREMARKET_NOT_READY','PREMARKET_READY','SESSION_OPEN','OR_BUILDING','WAITING_FOR_CONFIRMATION','PAPER_INTENT_CREATED','PAPER_POSITION_OPEN','PAPER_POSITION_EXIT_PENDING','PAPER_POSITION_CLOSED','SESSION_RECONCILED','HARD_FAIL']);
export const PAPER_EVENTS = Object.freeze(['PREMARKET_GATE_EVALUATED','MISSED_START','DAY_REJECTED','DATA_DISCONNECTED','SESSION_STARTED','OR_BUILDING_STARTED','OR_COMPLETED','BREAKOUT_CONFIRMED','PAPER_INTENT_CREATED','PAPER_FILL_CREATED','POSITION_OPENED','STOP_TRIGGERED','TIME_EXIT_TRIGGERED','POSITION_CLOSED','SESSION_RECONCILED','HARD_FAIL_RAISED','RESTART_RECOVERED']);

export const PAPER_TRANSITIONS = Object.freeze({
  PREMARKET_GATE_EVALUATED: [['PREMARKET_NOT_READY','PREMARKET_READY'],['PREMARKET_NOT_READY','SESSION_RECONCILED'],['PREMARKET_NOT_READY','HARD_FAIL']],
  MISSED_START: [['PREMARKET_NOT_READY','PREMARKET_NOT_READY']],
  DAY_REJECTED: [['PREMARKET_NOT_READY','SESSION_RECONCILED'],['PREMARKET_READY','SESSION_RECONCILED'],['SESSION_OPEN','SESSION_RECONCILED'],['OR_BUILDING','SESSION_RECONCILED'],['WAITING_FOR_CONFIRMATION','SESSION_RECONCILED']],
  DATA_DISCONNECTED: PAPER_STATES.filter((state) => !['SESSION_RECONCILED','HARD_FAIL'].includes(state)).map((state) => [state,state]),
  SESSION_STARTED: [['PREMARKET_READY','SESSION_OPEN']], OR_BUILDING_STARTED: [['SESSION_OPEN','OR_BUILDING']], OR_COMPLETED: [['OR_BUILDING','WAITING_FOR_CONFIRMATION']],
  BREAKOUT_CONFIRMED: [['WAITING_FOR_CONFIRMATION','WAITING_FOR_CONFIRMATION']], PAPER_INTENT_CREATED: [['WAITING_FOR_CONFIRMATION','PAPER_INTENT_CREATED']],
  PAPER_FILL_CREATED: [['PAPER_INTENT_CREATED','PAPER_POSITION_OPEN']], POSITION_OPENED: [['PAPER_POSITION_OPEN','PAPER_POSITION_OPEN']],
  STOP_TRIGGERED: [['PAPER_POSITION_OPEN','PAPER_POSITION_EXIT_PENDING']], TIME_EXIT_TRIGGERED: [['PAPER_POSITION_OPEN','PAPER_POSITION_EXIT_PENDING']],
  POSITION_CLOSED: [['PAPER_POSITION_EXIT_PENDING','PAPER_POSITION_CLOSED']], SESSION_RECONCILED: [['WAITING_FOR_CONFIRMATION','SESSION_RECONCILED'],['PAPER_POSITION_CLOSED','SESSION_RECONCILED']],
  HARD_FAIL_RAISED: PAPER_STATES.filter((state) => !['SESSION_RECONCILED','HARD_FAIL'].includes(state)).map((state) => [state,'HARD_FAIL']),
  RESTART_RECOVERED: PAPER_STATES.filter((state) => state !== 'HARD_FAIL').map((state) => [state,state]),
});

export function digest(value) { return sha256Hex(Buffer.from(jcsNfc(value), 'utf8')); }
function assert(condition, message) { if (!condition) throw new Error(message); }
function transitionAllowed(eventType, priorState, nextState) { return PAPER_TRANSITIONS[eventType]?.some(([from,to]) => from === priorState && to === nextState); }

export function evaluatePremarketReadiness(input) {
  assert(input.executionAuthorized === false, 'P0_EXECUTION_AUTHORIZED_MUST_BE_FALSE');
  if (input.killSwitch) return { state: 'NO_TRADE', reason: 'NO_TRADE_KILL_SWITCH' };
  if (input.unclosedPriorPosition) throw new Error('HARD_FAIL_UNCLOSED_PRIOR_POSITION');
  if (!input.officialTradingDay || !input.sessionValid) return { state: 'NO_TRADE', reason: 'NO_TRADE_SESSION_UNAVAILABLE' };
  if (!input.contractCode) return { state: 'NO_TRADE', reason: 'NO_TRADE_CONTRACT_UNRESOLVED' };
  if (!input.marketDataAvailable || !input.orSourceAvailable || !input.availableAtLegal) return { state: 'NO_TRADE', reason: 'NO_TRADE_DATA_UNAVAILABLE' };
  if (input.t0SpecHash !== P0_SPEC.t0SpecHash || input.costPolicyHash !== P0_SPEC.costPolicyHash) throw new Error('P0_FROZEN_HASH_MISMATCH');
  if (!input.ledgerWritable) throw new Error('P0_LEDGER_NOT_WRITABLE');
  return { state: 'READY', reason: null };
}

export function createPaperEvent({ existing, eventType, occurredAt, recordedAt = occurredAt, tradeDate, sessionId, aggregateId, priorState, nextState, payload = {}, sourceEvidenceHash, idempotencyKey }) {
  assert(PAPER_EVENTS.includes(eventType), 'P0_EVENT_TYPE_INVALID'); assert(PAPER_STATES.includes(priorState) && PAPER_STATES.includes(nextState), 'P0_STATE_INVALID');
  assert(transitionAllowed(eventType, priorState, nextState), `P0_TRANSITION_INVALID:${priorState}:${eventType}:${nextState}`);
  assert(Date.parse(occurredAt) >= 0 && Date.parse(recordedAt) >= Date.parse(occurredAt), 'P0_TIMESTAMP_INVALID');
  assert(typeof idempotencyKey === 'string' && idempotencyKey.length > 10, 'P0_IDEMPOTENCY_KEY_INVALID');
  const duplicate = existing.find((event) => event.idempotencyKey === idempotencyKey);
  const payloadHash = digest(payload); const specHash = digest(P0_SPEC);
  if (duplicate) {
    assert(duplicate.eventType === eventType && duplicate.payloadHash === payloadHash && duplicate.priorState === priorState && duplicate.nextState === nextState, 'P0_IDEMPOTENCY_CONFLICT');
    return { event: duplicate, appended: false };
  }
  const priorRecordHash = existing.at(-1)?.recordHash ?? null;
  const body = { schemaVersion: P0_SPEC.schemaVersion, sequence: existing.length + 1, eventId: digest({ aggregateId, idempotencyKey }).slice(0, 32), eventType, occurredAt, recordedAt, tradeDate, sessionId, aggregateId, priorState, nextState, payloadHash, payload, specHash, sourceEvidenceHash, idempotencyKey, priorRecordHash, formalWeight: 0, researchOnly: true, executionAuthorized: false };
  return { event: { ...body, recordHash: digest(body) }, appended: true };
}

export function appendEvent(events, input) { const result = createPaperEvent({ existing: events, ...input }); if (result.appended) events.push(result.event); return result.event; }

export function appendRejectedPaperDay(events, { tradeDate, sessionId = `${tradeDate}-DAY`, reason, recordedAt, sourceEvidenceHash }) {
  const aggregateId = sessionId;
  const missed = reason === 'MISSED_START';
  if (missed) appendEvent(events, { eventType:'MISSED_START', occurredAt:`${tradeDate}T00:35:00.000Z`, recordedAt, tradeDate, sessionId, aggregateId, priorState:'PREMARKET_NOT_READY', nextState:'PREMARKET_NOT_READY', payload:{ reason }, sourceEvidenceHash, idempotencyKey:`${aggregateId}:MISSED_START` });
  appendEvent(events, { eventType:'DAY_REJECTED', occurredAt:recordedAt, recordedAt, tradeDate, sessionId, aggregateId, priorState:'PREMARKET_NOT_READY', nextState:'SESSION_RECONCILED', payload:{ reason, tradeState:'NO_TRADE' }, sourceEvidenceHash, idempotencyKey:`${aggregateId}:DAY_REJECTED` });
}

export function auditPaperTradingLedger(events) {
  const errors = []; let priorHash = null; const states = new Map(); const idempotency = new Set();
  for (const [index,event] of events.entries()) {
    const prefix = `row_${index + 1}`; const { recordHash, ...body } = event;
    if (recordHash !== digest(body)) errors.push(`${prefix}_record_hash`); if (event.priorRecordHash !== priorHash) errors.push(`${prefix}_prior_hash`);
    if (event.sequence !== index + 1) errors.push(`${prefix}_sequence`); if (idempotency.has(event.idempotencyKey)) errors.push(`${prefix}_duplicate_idempotency`); idempotency.add(event.idempotencyKey);
    if (event.executionAuthorized !== false || event.researchOnly !== true || event.formalWeight !== 0) errors.push(`${prefix}_safety_boundary`);
    const priorState = states.get(event.aggregateId) ?? 'PREMARKET_NOT_READY'; if (event.priorState !== priorState || !transitionAllowed(event.eventType, event.priorState, event.nextState)) errors.push(`${prefix}_transition`);
    states.set(event.aggregateId,event.nextState); priorHash=event.recordHash;
  }
  return { ok: errors.length === 0, eventCount: events.length, aggregateCount: states.size, finalStates: Object.fromEntries(states), errors: [...new Set(errors)], ledgerHash: digest(events) };
}

export function rebuildPaperSession(events, aggregateId) {
  const selected = events.filter((event) => event.aggregateId === aggregateId); const audit = auditPaperTradingLedger(events); if (!audit.ok) throw new Error(`HARD_FAIL_AMBIGUOUS_POSITION_STATE:${audit.errors.join(',')}`);
  const intents = selected.filter((event) => event.eventType === 'PAPER_INTENT_CREATED'); const fills = selected.filter((event) => event.eventType === 'PAPER_FILL_CREATED'); const exits = selected.filter((event) => event.eventType === 'POSITION_CLOSED');
  if (intents.length > 1 || fills.length > 1 || exits.length > 1 || fills.length > intents.length || exits.length > fills.length) throw new Error('HARD_FAIL_AMBIGUOUS_POSITION_STATE');
  const finalState = selected.at(-1)?.nextState ?? 'PREMARKET_NOT_READY';
  return { aggregateId, finalState, intent: intents[0]?.payload ?? null, fill: fills[0]?.payload ?? null, position: selected.find((event) => event.eventType === 'POSITION_OPENED')?.payload ?? null, close: exits[0]?.payload ?? null, reconciled: finalState === 'SESSION_RECONCILED' };
}

function utcAtDay(tradeDate, hhmm) { return `${tradeDate}T${hhmm}:00.000Z`; }
function baseCost(session) { const view = session.costViews?.find((item) => item.viewId === P0_SPEC.primaryCostView); assert(view, `P0_BASE_COST_MISSING:${session.tradeDate}`); return view; }

export function buildHistoricalPaperSession(session, existingEvents = [], { recordedAt = null } = {}) {
  assert(session.inputEvidence?.t0SpecHash === P0_SPEC.t0SpecHash && session.inputEvidence?.costPolicyHash === P0_SPEC.costPolicyHash && session.inputEvidence?.strictManifestHash === P0_SPEC.strictManifestHash, `P0_SESSION_FROZEN_HASH_MISMATCH:${session.tradeDate}`);
  assert(session.executionAuthorized === false && session.researchOnly === true, 'P0_SESSION_SAFETY_BOUNDARY');
  const events = existingEvents; const aggregateId = session.sessionId; const sourceEvidenceHash = digest({ inputEvidence: session.inputEvidence, tradeDate: session.tradeDate, contractCode: session.contractCode });
  const add = (eventType, occurredAt, priorState, nextState, payload = {}) => appendEvent(events,{ eventType,occurredAt,recordedAt:recordedAt ?? occurredAt,tradeDate:session.tradeDate,sessionId:session.sessionId,aggregateId,priorState,nextState,payload,sourceEvidenceHash,idempotencyKey:`${aggregateId}:${eventType}` });
  add('PREMARKET_GATE_EVALUATED',utcAtDay(session.tradeDate,'00:35'),'PREMARKET_NOT_READY','PREMARKET_READY',{readiness:'PASS',contractCode:session.contractCode});
  add('SESSION_STARTED',utcAtDay(session.tradeDate,'00:45'),'PREMARKET_READY','SESSION_OPEN',{contractCode:session.contractCode});
  add('OR_BUILDING_STARTED',utcAtDay(session.tradeDate,'00:45'),'SESSION_OPEN','OR_BUILDING',{});
  add('OR_COMPLETED',session.orAvailableAt,'OR_BUILDING','WAITING_FOR_CONFIRMATION',{orHigh:session.orHigh,orLow:session.orLow});
  if (session.tradeState === 'NO_TRADE') {
    add('SESSION_RECONCILED',utcAtDay(session.tradeDate,'05:47'),'WAITING_FOR_CONFIRMATION','SESSION_RECONCILED',{tradeState:'NO_TRADE',reason:session.noTradeReason});
    return { events, intent:null, position:null };
  }
  assert(session.tradeState === 'TRADE', 'P0_UNKNOWN_TRADE_STATE'); const direction = session.breakoutDirection; const cost = baseCost(session);
  add('BREAKOUT_CONFIRMED',session.breakoutConfirmedAt,'WAITING_FOR_CONFIRMATION','WAITING_FOR_CONFIRMATION',{direction,confirmationTimestamp:session.breakoutConfirmedAt});
  const intentId=digest({aggregateId,type:'intent'}).slice(0,32); const intent={intentId,tradeDate:session.tradeDate,sessionId:session.sessionId,contractCode:session.contractCode,direction,confirmationTimestamp:session.breakoutConfirmedAt,signalTimestamp:session.breakoutConfirmedAt,referenceEntryPrice:session.entryReferencePrice,simulatedEntryPrice:cost.actualEntryFillIndex,stopPrice:session.initialStopPrice,scheduledExitTimestamp:session.timeExitAt,specHash:digest(P0_SPEC),evidenceHash:sourceEvidenceHash,idempotencyKey:`${aggregateId}:PAPER_INTENT_CREATED`};
  add('PAPER_INTENT_CREATED',session.breakoutConfirmedAt,'WAITING_FOR_CONFIRMATION','PAPER_INTENT_CREATED',intent);
  add('PAPER_FILL_CREATED',session.entryAt,'PAPER_INTENT_CREATED','PAPER_POSITION_OPEN',{intentId,fillPrice:cost.actualEntryFillIndex,referencePrice:session.entryReferencePrice,quantity:1});
  const positionId=digest({aggregateId,type:'position'}).slice(0,32); const opened={positionId,intentId,openedAt:session.entryAt,entryPrice:cost.actualEntryFillIndex,referenceEntryPrice:session.entryReferencePrice,direction,quantity:1,stopPrice:session.initialStopPrice,scheduledExitTimestamp:session.timeExitAt,currentState:'OPEN'};
  add('POSITION_OPENED',session.entryAt,'PAPER_POSITION_OPEN','PAPER_POSITION_OPEN',opened);
  const triggerType=session.exitReason==='STOP_EXIT'?'STOP_TRIGGERED':'TIME_EXIT_TRIGGERED'; add(triggerType,session.exitAt,'PAPER_POSITION_OPEN','PAPER_POSITION_EXIT_PENDING',{referenceExitPrice:session.exitReferencePrice,exitReason:session.exitReason});
  const closed={...opened,currentState:'CLOSED',closedAt:session.exitAt,exitPrice:cost.actualExitFillIndex,referenceExitPrice:session.exitReferencePrice,exitReason:session.exitReason,commission:cost.entryCommission+cost.exitCommission,tax:cost.entryTax+cost.exitTax,slippage:cost.entrySlippage+cost.exitSlippage,grossPnl:cost.grossPnl,netPnl:cost.netPnl};
  add('POSITION_CLOSED',session.exitAt,'PAPER_POSITION_EXIT_PENDING','PAPER_POSITION_CLOSED',closed);
  add('SESSION_RECONCILED',utcAtDay(session.tradeDate,'05:47'),'PAPER_POSITION_CLOSED','SESSION_RECONCILED',{tradeState:'TRADE',positionId,netPnl:cost.netPnl});
  return { events, intent, position:closed };
}

export function appendPaperLedgerFile(file, event) {
  fs.mkdirSync(path.dirname(file),{recursive:true}); const existing=readPaperLedgerFile(file); const duplicate=existing.find((row)=>row.idempotencyKey===event.idempotencyKey);
  if(duplicate){assert(duplicate.recordHash===event.recordHash,'P0_FILE_IDEMPOTENCY_CONFLICT');return{appended:false,total:existing.length};}
  assert(event.sequence===existing.length+1 && event.priorRecordHash===(existing.at(-1)?.recordHash??null),'P0_FILE_CHAIN_MISMATCH'); fs.appendFileSync(file,`${jcsNfc(event)}\n`,{flag:'a'}); return{appended:true,total:existing.length+1};
}
export function readPaperLedgerFile(file){return fs.existsSync(file)?fs.readFileSync(file,'utf8').split(/\r?\n/).filter(Boolean).map(JSON.parse):[];}

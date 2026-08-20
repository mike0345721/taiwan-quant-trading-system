import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { appendEvent, appendPaperLedgerFile, auditPaperTradingLedger, buildHistoricalPaperSession, evaluatePremarketReadiness, readPaperLedgerFile, rebuildPaperSession } from '../src/p0-paper-trading.mjs';

const root=path.resolve('.'),jobs=path.join(root,'data','research','t0-h0-formal-v1','run-2026-08-02-v1','jobs');
function session(predicate=x=>x.tradeState==='TRADE'){for(const n of fs.readdirSync(jobs).filter(x=>x.endsWith('-DAY.json')).sort()){const x=JSON.parse(fs.readFileSync(path.join(jobs,n),'utf8'));if(predicate(x))return x}throw new Error('fixture_session_missing')}
function ready(overrides={}){return{executionAuthorized:false,killSwitch:false,unclosedPriorPosition:false,officialTradingDay:true,sessionValid:true,contractCode:'202601',marketDataAvailable:true,orSourceAvailable:true,availableAtLegal:true,t0SpecHash:'c2baf6a63cf69407ae9e686af46bb5832adcebf9d859b170fe9096c8f7389253',costPolicyHash:'ee9d6200150513164729d438998b609676f8dd373ec1c24b648e100814db0cfc',ledgerWritable:true,...overrides}}

test('premarket gate fails closed for execution, prior position, missing data, contract and kill switch',()=>{
 assert.equal(evaluatePremarketReadiness(ready()).state,'READY');
 assert.throws(()=>evaluatePremarketReadiness(ready({executionAuthorized:true})),/MUST_BE_FALSE/);
 assert.throws(()=>evaluatePremarketReadiness(ready({unclosedPriorPosition:true})),/UNCLOSED_PRIOR_POSITION/);
 assert.equal(evaluatePremarketReadiness(ready({marketDataAvailable:false})).reason,'NO_TRADE_DATA_UNAVAILABLE');
 assert.equal(evaluatePremarketReadiness(ready({contractCode:null})).reason,'NO_TRADE_CONTRACT_UNRESOLVED');
 assert.equal(evaluatePremarketReadiness(ready({killSwitch:true})).reason,'NO_TRADE_KILL_SWITCH');
});

test('frozen T0 trade creates one intent fill exit and reconstructs closed reconciled position',()=>{
 const events=[],s=session();const result=buildHistoricalPaperSession(s,events),audit=auditPaperTradingLedger(events),state=rebuildPaperSession(events,s.sessionId);
 assert.equal(audit.ok,true);assert.equal(events.filter(x=>x.eventType==='PAPER_INTENT_CREATED').length,1);assert.equal(events.filter(x=>x.eventType==='PAPER_FILL_CREATED').length,1);assert.equal(events.filter(x=>x.eventType==='POSITION_CLOSED').length,1);assert.equal(state.finalState,'SESSION_RECONCILED');assert.equal(result.position.quantity,1);assert.equal(result.position.netPnl,s.costViews.find(x=>x.viewId==='BASE_2_TICKS_PER_SIDE').netPnl);
});

test('same session replay is idempotent and enforces daily trade limit',()=>{
 const events=[],s=session();buildHistoricalPaperSession(s,events);const count=events.length,hash=auditPaperTradingLedger(events).ledgerHash;buildHistoricalPaperSession(s,events);assert.equal(events.length,count);assert.equal(auditPaperTradingLedger(events).ledgerHash,hash);
});

test('stop, gap-through evidence and time exit preserve frozen exit and cost accounting',()=>{
 for(const s of [session(x=>x.exitReason==='STOP_EXIT'&&x.eventAudit?.gapThroughStop),session(x=>x.exitReason==='TIME_EXIT')]){const events=[];const {position}=buildHistoricalPaperSession(s,events),cost=s.costViews.find(x=>x.viewId==='BASE_2_TICKS_PER_SIDE');assert.equal(position.exitReason,s.exitReason);assert.equal(position.exitPrice,cost.actualExitFillIndex);assert.equal(position.commission,cost.entryCommission+cost.exitCommission);assert.equal(position.tax,cost.entryTax+cost.exitTax);assert.equal(position.slippage,cost.entrySlippage+cost.exitSlippage);}
});

test('missing exit or illegal transition cannot be reconciled and ambiguous state hard fails',()=>{
 const events=[],s=session();buildHistoricalPaperSession(s,events);const truncated=events.filter(x=>!['STOP_TRIGGERED','TIME_EXIT_TRIGGERED','POSITION_CLOSED','SESSION_RECONCILED'].includes(x.eventType));const state=rebuildPaperSession(truncated,s.sessionId);assert.equal(state.finalState,'PAPER_POSITION_OPEN');
 assert.throws(()=>appendEvent(truncated,{eventType:'SESSION_RECONCILED',occurredAt:s.exitAt,tradeDate:s.tradeDate,sessionId:s.sessionId,aggregateId:s.sessionId,priorState:'PAPER_POSITION_OPEN',nextState:'SESSION_RECONCILED',payload:{},sourceEvidenceHash:'x',idempotencyKey:`${s.sessionId}:bad-reconcile`}),/TRANSITION_INVALID/);
 const tampered=structuredClone(events);tampered[0].recordHash='bad';assert.throws(()=>rebuildPaperSession(tampered,s.sessionId),/AMBIGUOUS_POSITION_STATE/);
});

test('append-only file ledger rejects duplicate conflict and preserves replay',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p0-ledger-')),file=path.join(dir,'ledger.jsonl'),events=[],s=session();buildHistoricalPaperSession(s,events);for(const event of events)assert.equal(appendPaperLedgerFile(file,event).appended,true);assert.equal(readPaperLedgerFile(file).length,events.length);assert.equal(appendPaperLedgerFile(file,events[0]).appended,false);
});

test('forward observer records a missed start once and never accepts a frozen T0 result as input',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p0-forward-')),runtimeRoot=path.join(dir,'runtime'),ledger=path.join(runtimeRoot,'PAPER_TRADING_EVENT_LEDGER.jsonl'),status=path.join(runtimeRoot,'daily','2026-01-02.json'),args=['scripts/run-p0-forward-paper-observer.mjs','--trade-date','2026-01-02','--runtime-root',runtimeRoot];
 const source=fs.readFileSync(path.join(root,'scripts/run-p0-forward-paper-observer.mjs'),'utf8');assert.equal(source.includes('--session-result'),false);assert.equal(source.includes('t0-h0-formal-v1'),false);
 const first=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});assert.equal(first.status,0,first.stderr);const count=readPaperLedgerFile(ledger).length;assert.equal(count,2);assert.ok(readPaperLedgerFile(ledger).every(x=>x.executionAuthorized===false));assert.equal(JSON.parse(first.stdout).reason,'MISSED_START');
 assert.equal(fs.existsSync(status),true);assert.equal(JSON.parse(fs.readFileSync(status,'utf8')).reason,'MISSED_START');
 const second=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8'});assert.equal(second.status,0,second.stderr);assert.equal(readPaperLedgerFile(ledger).length,count);
});

test('forward observer runtime-root injection prevents every output fallback to canonical runtime',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'p0-hermetic-')),runtimeRoot=path.join(dir,'isolated-runtime'),canonicalSentinel=path.join(dir,'canonical-sentinel.json');
 fs.writeFileSync(canonicalSentinel,'immutable-canonical-fixture\n');
 const before=fs.readFileSync(canonicalSentinel);
 const run=spawnSync(process.execPath,['scripts/run-p0-forward-paper-observer.mjs','--trade-date','2026-01-02','--runtime-root',runtimeRoot],{cwd:root,encoding:'utf8'});
 assert.equal(run.status,0,run.stderr);
 assert.deepEqual(fs.readFileSync(canonicalSentinel),before);
 assert.equal(fs.existsSync(path.join(runtimeRoot,'PAPER_TRADING_EVENT_LEDGER.jsonl')),true);
 assert.equal(fs.existsSync(path.join(runtimeRoot,'daily','2026-01-02.json')),true);
});

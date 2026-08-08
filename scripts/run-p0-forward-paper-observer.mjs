import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { appendPaperLedgerFile, appendRejectedPaperDay, auditPaperTradingLedger, digest, evaluatePremarketReadiness, P0_SPEC, readPaperLedgerFile } from '../src/p0-paper-trading.mjs';
import { executeP0SingleEngine, readP0LiveTicks } from '../src/p0-market-engine.mjs';
import { loadAndVerifyFrozenInputs } from '../src/t0-h0-runner.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const value = (name, fallback = null) => { const index = process.argv.indexOf(name); return index >= 0 ? process.argv[index + 1] : fallback; };
const dryRun = process.argv.includes('--engineering-dry-run');
const now = new Date();
const taipei = new Intl.DateTimeFormat('en-CA', { timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' }).formatToParts(now);
const part = (type) => taipei.find((row) => row.type === type)?.value;
const tradeDate = value('--trade-date', `${part('year')}-${part('month')}-${part('day')}`);
const localMinutes = Number(part('hour')) * 60 + Number(part('minute'));
const sessionId = `${tradeDate}-DAY`;
const liveLedger = path.resolve(value('--market-ledger', path.join(root, 'data/live-events', `${tradeDate}.ndjson`)));
const paperLedger = path.resolve(value('--ledger', path.join(root, 'data/paper/p0-forward', 'PAPER_TRADING_EVENT_LEDGER.jsonl')));
const statusDir = path.join(root, 'data/paper/p0-forward/daily');
const statusFile = path.join(statusDir, `${tradeDate}.json`);
const frozen = loadAndVerifyFrozenInputs(root);
const existing = readPaperLedgerFile(paperLedger);
const priorAudit = auditPaperTradingLedger(existing);
if (!priorAudit.ok) throw new Error(`HARD_FAIL_AMBIGUOUS_POSITION_STATE:${priorAudit.errors.join(',')}`);
if (Object.entries(priorAudit.finalStates).some(([id, state]) => id !== sessionId && state !== 'SESSION_RECONCILED')) throw new Error('HARD_FAIL_UNCLOSED_PRIOR_POSITION');

const writeStatus = (status) => {
  fs.mkdirSync(statusDir, { recursive:true });
  fs.writeFileSync(statusFile, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
};

const reject = (reason) => {
  const recordedAt = now.toISOString();
  const sourceEvidenceHash = digest({ tradeDate, reason, liveLedger });
  const staged = [...existing];
  appendRejectedPaperDay(staged, { tradeDate, sessionId, reason, recordedAt, sourceEvidenceHash });
  for (const event of staged.slice(existing.length)) appendPaperLedgerFile(paperLedger, event);
  const audit = auditPaperTradingLedger(readPaperLedgerFile(paperLedger));
  writeStatus({ tradeDate, observerStartTime: recordedAt, attemptStatus:'DAY_REJECTED', reason, reconciliationStatus:audit.ok?'PASS':'FAIL', ledgerHash:audit.ledgerHash, executionAuthorized:false });
};

const priorStatus = fs.existsSync(statusFile) ? JSON.parse(fs.readFileSync(statusFile, 'utf8')) : null;
const timelyPriorStart = priorStatus?.attemptStatus === 'OBSERVER_STARTED' && Date.parse(priorStatus.observerStartTime) < Date.parse(`${tradeDate}T01:00:00.000Z`);
if (!dryRun && localMinutes > 9 * 60 && !timelyPriorStart) { reject('MISSED_START'); process.exit(0); }
let restartCount = timelyPriorStart ? Number(priorStatus.restartCount || 0) + 1 : 0;
if (!dryRun && localMinutes <= 9 * 60) {
  writeStatus({ tradeDate, observerStartTime:now.toISOString(), attemptStatus:'OBSERVER_STARTED', readinessGate:'PENDING_SESSION_COMPLETION', restartCount, executionAuthorized:false });
}
if (!dryRun) {
  const reconcileAt = Date.parse(`${tradeDate}T05:47:00.000Z`);
  const waitMs = reconcileAt - Date.now();
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
}
if (!fs.existsSync(liveLedger)) { reject('DATA_UNAVAILABLE'); process.exit(0); }

const targetCode = value('--contract-code') || (() => {
  const readinessFile = path.join(root, 'data/readiness/shioaji-futures-access.json');
  if (!fs.existsSync(readinessFile)) return null;
  return JSON.parse(fs.readFileSync(readinessFile, 'utf8')).contracts?.TX?.targetCode || null;
})();
if (!targetCode) { reject('CONTRACT_UNRESOLVED'); process.exit(0); }

const tickRead = await readP0LiveTicks({ ledgerFile:liveLedger, tradeDate, contractCode:targetCode });
const processingAt = new Date();
const manifestRow = { tradeDate, sessionId, actualReplayContractCode:targetCode, selectedResearchContractCode:targetCode, settlementClass:'SETTLEMENT_STATUS_UNAVAILABLE', rollSession:false, eligibilityClass:'FORWARD_PP1_PROVIDER_MAPPED' };
const readiness = evaluatePremarketReadiness({ executionAuthorized:false, killSwitch:false, unclosedPriorPosition:false, officialTradingDay:true, sessionValid:true, contractCode:targetCode, marketDataAvailable:tickRead.ticks.length>0, orSourceAvailable:tickRead.bars.some((bar)=>bar.timestamp===`${tradeDate}T00:45:00.000Z`), availableAtLegal:true, t0SpecHash:P0_SPEC.t0SpecHash, costPolicyHash:P0_SPEC.costPolicyHash, ledgerWritable:true });
if (readiness.state !== 'READY') { reject(readiness.reason); process.exit(0); }

const beforeCount = existing.length;
const result = executeP0SingleEngine({ manifestRow, tickRead, costPolicy:frozen.costPolicy, existingEvents:existing, recordedAt:processingAt.toISOString() });
for (const event of existing.slice(beforeCount)) appendPaperLedgerFile(paperLedger, event);
const finalAudit = auditPaperTradingLedger(readPaperLedgerFile(paperLedger));
if (!finalAudit.ok) throw new Error(`P0_FORWARD_LEDGER_AUDIT_FAIL:${finalAudit.errors.join(',')}`);
writeStatus({ tradeDate, observerStartTime:priorStatus?.observerStartTime||now.toISOString(), readinessGate:'PASS', contractCode:targetCode, sessionState:'SESSION_RECONCILED', orState:result.detection.qualityState, t0TriggerState:result.detection.tradeState, paperDirection:result.paper.position?.direction||null, entry:result.paper.position?.entryPrice||null, stop:result.paper.position?.stopPrice||null, exit:result.paper.position?.exitPrice||null, netPnl:result.paper.position?.netPnl||0, noTradeReason:result.detection.noTradeReason||null, dataQuality:result.detection.pathQuality, restartCount, hardFailCount:0, reconciliationStatus:'PASS', appendedEvents:existing.length-beforeCount, ledgerHash:finalAudit.ledgerHash, inputEvidenceHash:result.inputEvidenceHash, executionAuthorized:false });

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import {
  appendPaperEvent,
  auditPaperEventLedger,
  loadOfficialReplayEvidence,
  readPaperEventLedger,
} from '../src/paper-event-ledger.mjs';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const archiveDir = path.join(root, 'data', 'intraday', 'archive');
const latestDay = fs.readdirSync(archiveDir)
  .filter((name) => /^\d{4}-\d{2}-\d{2}-day\.json$/.test(name))
  .sort()
  .at(-1);
if (!latestDay) throw new Error('OFFLINE_PAPER_REPLAY_MISSING');

const tradeDate = latestDay.slice(0, 10);
const replay = JSON.parse(fs.readFileSync(path.join(archiveDir, latestDay), 'utf8'));
if (!Array.isArray(replay.bars) || replay.bars.length < 2) throw new Error('OFFLINE_PAPER_REPLAY_TOO_SHORT');
const contract = String(replay.contract || '');
const first = replay.bars[0];
const second = replay.bars[1];
const entry = Number(second.open);
const candidateId = `offline-validation-${tradeDate.replaceAll('-', '')}`;
const common = { candidateId, tradeDate, contract, session: 'day' };
const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'twchip-paper-offline-'));
const ledger = path.join(folder, 'events.jsonl');

try {
  appendPaperEvent(ledger, {
    ...common, eventType: 'candidate', virtualTime: first.timestamp,
    setupKey: 'opening_range_breakout', direction: 'long', horizonMinutes: 60,
    thesis: 'offline lifecycle validation only',
    triggerCondition: 'test transition on the next official replay bar',
    invalidationCondition: 'not a trading signal',
    intendedStopPoints: 1000, intendedTargetR: 1.5,
  }, loadOfficialReplayEvidence(archiveDir, { tradeDate, session: 'day', cursor: 1 }));
  appendPaperEvent(ledger, {
    ...common, eventType: 'trigger', virtualTime: second.timestamp,
    entryPrice: entry, stopPrice: entry - 1000, targetPrice: entry + 1500,
  }, loadOfficialReplayEvidence(archiveDir, { tradeDate, session: 'day', cursor: 2 }));
  appendPaperEvent(ledger, {
    ...common, eventType: 'exit', virtualTime: second.timestamp,
    exitPrice: Number(second.close), exitReason: 'offline lifecycle validation',
  }, loadOfficialReplayEvidence(archiveDir, { tradeDate, session: 'day', cursor: 2 }));
  appendPaperEvent(ledger, {
    ...common, eventType: 'outcome', virtualTime: second.timestamp,
    outcomeNote: 'No performance claim; validates state transitions and evidence binding.',
  }, loadOfficialReplayEvidence(archiveDir, { tradeDate, session: 'day', cursor: 2 }));

  const rows = readPaperEventLedger(ledger);
  const audit = auditPaperEventLedger(rows);
  const report = {
    schemaVersion: '3.9.7-paper-offline-validation-v1',
    generatedAt: new Date().toISOString(),
    state: audit.ok ? 'passed' : 'failed',
    tradeDate,
    contract,
    source: 'audited_official_historical_replay',
    lifecycle: rows.map((row) => row.eventType),
    records: rows.length,
    errors: audit.errors,
    formalPaperLedgerModified: false,
    performanceClaimAuthorized: false,
    researchOnly: true,
    executionAuthorized: false,
  };
  const output = path.join(root, 'data', 'forward', 'v3.8-paper-offline-validation.json');
  const temporary = `${output}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  fs.renameSync(temporary, output);
  console.log(JSON.stringify(report, null, 2));
  if (!audit.ok) process.exitCode = 1;
} finally {
  fs.rmSync(folder, { recursive: true, force: true });
}

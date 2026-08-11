import fs from 'node:fs';
import path from 'node:path';
import { decisionDigest, validateDecisionSnapshot } from './dashboard-decision-workspace.mjs';

const INTENTS = Object.freeze(['LONG_INTENT', 'SHORT_INTENT', 'NO_TRADE']);

function assertJournalPath(filePath) {
  const normalized = path.resolve(filePath).toLowerCase().replaceAll('/', '\\');
  if (normalized.includes('\\data\\market-state\\forward-shadow\\')) throw new Error('DECISION_JOURNAL_FORWARD_SHADOW_PATH_FORBIDDEN');
}
function readLines(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw.split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

function entryBody(entry) {
  const { recordHash: _recordHash, ...body } = entry;
  return body;
}

export function auditDecisionJournal(rows = []) {
  let previousHash = null;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (row.sequence !== index + 1) return { ok: false, reason: 'SEQUENCE_INVALID' };
    if (row.previousHash !== previousHash) return { ok: false, reason: 'PREVIOUS_HASH_INVALID' };
    if (decisionDigest(entryBody(row)) !== row.recordHash) return { ok: false, reason: 'RECORD_HASH_INVALID' };
    try { validateDecisionSnapshot(row.snapshot); } catch (error) { return { ok: false, reason: error.message }; }
    previousHash = row.recordHash;
  }
  return { ok: true, count: rows.length, latestHash: previousHash };
}

export function readDecisionJournal(filePath, { limit = 50 } = {}) {
  assertJournalPath(filePath);
  const rows = readLines(filePath);
  const audit = auditDecisionJournal(rows);
  if (!audit.ok) throw new Error(`DECISION_JOURNAL_${audit.reason}`);
  return rows.slice(-Math.max(1, Math.min(200, limit))).reverse();
}

export function appendDecisionJournal(filePath, input, { now = new Date() } = {}) {
  assertJournalPath(filePath);
  if (!INTENTS.includes(input?.intent)) throw new Error('DECISION_JOURNAL_INTENT_INVALID');
  validateDecisionSnapshot(input.snapshot);
  const rows = readLines(filePath);
  const audit = auditDecisionJournal(rows);
  if (!audit.ok) throw new Error(`DECISION_JOURNAL_${audit.reason}`);
  const body = {
    schemaVersion: 'manual-decision-journal-v1',
    sequence: rows.length + 1,
    previousHash: rows.at(-1)?.recordHash || null,
    recordedAt: now.toISOString(),
    intent: input.intent,
    setup: String(input.setup || '').trim().slice(0, 500),
    reason: String(input.reason || '').trim().slice(0, 1_000),
    invalidation: String(input.invalidation || '').trim().slice(0, 500),
    snapshotHash: input.snapshot.snapshotHash,
    snapshot: input.snapshot,
    outcome: null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
  const entry = Object.freeze({ ...body, recordHash: decisionDigest(body) });
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  const verified = auditDecisionJournal(readLines(filePath));
  if (!verified.ok) throw new Error(`DECISION_JOURNAL_COMMIT_${verified.reason}`);
  return entry;
}

import fs from 'node:fs';
import path from 'node:path';
import { decisionDigest, validateDecisionSnapshot } from './dashboard-decision-workspace.mjs';

const INTENTS = Object.freeze(['LONG_INTENT', 'SHORT_INTENT', 'NO_TRADE']);
const CONFIDENCE = Object.freeze(['LOW', 'MEDIUM', 'HIGH']);
const EXECUTION = Object.freeze(['UNKNOWN', 'EXECUTED', 'NOT_EXECUTED']);
const THESIS = Object.freeze(['UNKNOWN', 'FOLLOWED', 'VIOLATED', 'NOT_APPLICABLE']);
const OUTCOME_FIELDS = Object.freeze(['decisionRecordHash', 'executionStatus', 'thesisStatus', 'outcomeNote']);
const OUTCOME_RECORD_FIELDS = new Set(['schemaVersion', 'sequence', 'previousHash', 'recordedAt', 'decisionRecordHash',
  'snapshotHash', 'executionStatus', 'thesisStatus', 'outcomeNote', 'formalWeight', 'researchOnly',
  'executionAuthorized', 'orderRoutesEnabled', 'recordHash']);
const HASH = /^[0-9a-f]{64}$/;

function manualFields(input) {
  const confidence = input.confidence ?? null;
  const executionStatus = input.executionStatus ?? 'UNKNOWN';
  if (confidence !== null && !CONFIDENCE.includes(confidence)) throw new Error('DECISION_JOURNAL_CONFIDENCE_INVALID');
  if (!EXECUTION.includes(executionStatus)) throw new Error('DECISION_JOURNAL_EXECUTION_INVALID');
  return { confidence, executionStatus };
}

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
    try { manualFields(row); } catch { return { ok: false, reason: 'MANUAL_FIELDS_INVALID' }; }
    try { validateDecisionSnapshot(row.snapshot); } catch (error) { return { ok: false, reason: error.message }; }
    if (row.snapshotHash !== row.snapshot.snapshotHash) return { ok: false, reason: 'SNAPSHOT_HASH_MISMATCH' };
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
  const manual = manualFields(input);
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
    ...manual,
    snapshotHash: input.snapshot.snapshotHash,
    snapshot: input.snapshot,
    outcome: null,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
    orderRoutesEnabled: false,
  };
  const entry = Object.freeze({ ...body, recordHash: decisionDigest(body) });
  fs.mkdirSync(path.dirname(filePath), { recursive: true, mode: 0o700 });
  fs.appendFileSync(filePath, `${JSON.stringify(entry)}\n`, { encoding: 'utf8', mode: 0o600 });
  const verified = auditDecisionJournal(readLines(filePath));
  if (!verified.ok) throw new Error(`DECISION_JOURNAL_COMMIT_${verified.reason}`);
  return entry;
}

function assertOutcomePaths(outcomesPath, journalPath) {
  assertJournalPath(journalPath);
  assertJournalPath(outcomesPath);
  const expected = path.join(path.dirname(path.resolve(journalPath)), 'journal-outcomes.ndjson');
  if (path.resolve(outcomesPath) !== expected || path.resolve(outcomesPath) === path.resolve(journalPath)) {
    throw new Error('DECISION_OUTCOME_PATH_REJECTED');
  }
  const parent = path.dirname(expected);
  if (fs.existsSync(parent)) assertJournalPath(path.join(fs.realpathSync(parent), 'journal-outcomes.ndjson'));
  let stat = null;
  try { stat = fs.lstatSync(outcomesPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (stat) {
    // A private outcomes file is never allowed to be a link to another ledger.
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1) throw new Error('DECISION_OUTCOME_PATH_REJECTED');
    const original = fs.existsSync(journalPath) ? fs.statSync(journalPath) : null;
    if (original && stat.dev === original.dev && stat.ino === original.ino) throw new Error('DECISION_OUTCOME_PATH_REJECTED');
  }
}

function validatedDecisions(journalPath) {
  assertJournalPath(journalPath);
  let rows;
  try { rows = readLines(journalPath); } catch { throw new Error('DECISION_JOURNAL_READ_INVALID'); }
  const audit = auditDecisionJournal(rows);
  if (!audit.ok) throw new Error(`DECISION_JOURNAL_${audit.reason}`);
  return rows;
}

function normalizedOutcome(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)
      || Object.keys(input).some(key => !OUTCOME_FIELDS.includes(key))) throw new Error('DECISION_OUTCOME_INPUT_INVALID');
  if (!HASH.test(input.decisionRecordHash || '')) throw new Error('DECISION_OUTCOME_REFERENCE_INVALID');
  const executionStatus = input.executionStatus ?? 'UNKNOWN';
  const thesisStatus = input.thesisStatus ?? 'UNKNOWN';
  if (!EXECUTION.includes(executionStatus)) throw new Error('DECISION_OUTCOME_EXECUTION_INVALID');
  if (!THESIS.includes(thesisStatus)) throw new Error('DECISION_OUTCOME_THESIS_INVALID');
  if (input.outcomeNote !== undefined && typeof input.outcomeNote !== 'string') throw new Error('DECISION_OUTCOME_NOTE_INVALID');
  const outcomeNote = (input.outcomeNote ?? '').trim();
  if (outcomeNote.length > 1000) throw new Error('DECISION_OUTCOME_NOTE_INVALID');
  if (executionStatus === 'UNKNOWN' && thesisStatus === 'UNKNOWN' && !outcomeNote) throw new Error('DECISION_OUTCOME_EMPTY');
  return { decisionRecordHash: input.decisionRecordHash, executionStatus, thesisStatus, outcomeNote };
}

// Manual observations are a separate chain. Original decision rows and snapshots
// remain byte-identical and never acquire recomputed or synthetic market outcomes.
export function auditDecisionOutcomes(rows = [], decisions = []) {
  const originalAudit = auditDecisionJournal(decisions);
  if (!originalAudit.ok) return { ok: false, reason: `ORIGINAL_${originalAudit.reason}` };
  const originals = new Map(decisions.map(row => [row.recordHash, row]));
  let previousHash = null, previousAt = -Infinity;
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    if (!row || Object.keys(row).some(key => !OUTCOME_RECORD_FIELDS.has(key))
        || row.schemaVersion !== 'manual-decision-outcome-v1') return { ok: false, reason: 'SCHEMA_INVALID' };
    if (row.sequence !== index + 1 || row.previousHash !== previousHash) return { ok: false, reason: 'CHAIN_INVALID' };
    if (decisionDigest(entryBody(row)) !== row.recordHash) return { ok: false, reason: 'RECORD_HASH_INVALID' };
    const original = originals.get(row.decisionRecordHash);
    if (!original || row.snapshotHash !== original.snapshotHash) return { ok: false, reason: 'REFERENCE_INVALID' };
    if (row.formalWeight !== 0 || row.researchOnly !== true || row.executionAuthorized !== false || row.orderRoutesEnabled !== false) return { ok: false, reason: 'SAFETY_INVALID' };
    try {
      const normalized = normalizedOutcome(Object.fromEntries(OUTCOME_FIELDS.map(key => [key, row[key]])));
      if (normalized.outcomeNote !== row.outcomeNote || normalized.executionStatus !== row.executionStatus
          || normalized.thesisStatus !== row.thesisStatus) return { ok: false, reason: 'MANUAL_FIELDS_INVALID' };
    } catch { return { ok: false, reason: 'MANUAL_FIELDS_INVALID' }; }
    const at = typeof row.recordedAt === 'string' ? Date.parse(row.recordedAt) : NaN;
    const decisionAt = Date.parse(original.recordedAt);
    if (!Number.isFinite(at) || new Date(at).toISOString() !== row.recordedAt || !Number.isFinite(decisionAt)
        || at < decisionAt || at < previousAt) return { ok: false, reason: 'TIME_INVALID' };
    previousHash = row.recordHash; previousAt = at;
  }
  return { ok: true, count: rows.length, latestHash: previousHash };
}

function validatedOutcomes(outcomesPath, decisions) {
  let rows;
  try { rows = readLines(outcomesPath); } catch { throw new Error('DECISION_OUTCOME_READ_INVALID'); }
  const audit = auditDecisionOutcomes(rows, decisions);
  if (!audit.ok) throw new Error(`DECISION_OUTCOME_${audit.reason}`);
  return rows;
}

function outcomeIdentity(filePath) {
  try { return fs.lstatSync(filePath); } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function sameOutcomeIdentity(a, b) {
  return a === null && b === null || Boolean(a && b && a.dev === b.dev && a.ino === b.ino && a.size === b.size);
}
function outcomeState(outcomesPath, decisions) {
  // Bind the audit to the file which was actually read, rather than taking a
  // fresh post-audit stat that could accept a concurrent replacement/append.
  const identity = outcomeIdentity(outcomesPath);
  if (identity && (!identity.isFile() || identity.isSymbolicLink() || identity.nlink !== 1)) throw new Error('DECISION_OUTCOME_PATH_REJECTED');
  const raw = identity ? fs.readFileSync(outcomesPath, 'utf8') : '';
  if (!sameOutcomeIdentity(identity, outcomeIdentity(outcomesPath))) throw new Error('DECISION_OUTCOME_STATE_CHANGED');
  let rows;
  try { rows = raw.split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
  catch { throw new Error('DECISION_OUTCOME_READ_INVALID'); }
  const audit = auditDecisionOutcomes(rows, decisions);
  if (!audit.ok) throw new Error(`DECISION_OUTCOME_${audit.reason}`);
  return { rows, raw, identity };
}
function withOutcomeWriter(outcomesPath, action) {
  const guardPath = path.join(path.dirname(outcomesPath), 'journal-outcomes.lock');
  let guard;
  try { guard = fs.openSync(guardPath, 'wx', 0o600); }
  catch (error) {
    if (error.code === 'EEXIST') throw new Error('DECISION_OUTCOME_BUSY');
    throw error;
  }
  const owned = fs.fstatSync(guard);
  let result, failure;
  try { result = action(); } catch (error) { failure = error; }
  try {
    const current = outcomeIdentity(guardPath);
    if (!current || current.isSymbolicLink() || current.nlink !== 1
        || current.dev !== owned.dev || current.ino !== owned.ino) throw new Error('DECISION_OUTCOME_GUARD_CHANGED');
    fs.unlinkSync(guardPath);
  } catch (error) { failure ??= error; }
  try { fs.closeSync(guard); } catch (error) { failure ??= error; }
  if (failure) throw failure;
  return result;
}

export function readDecisionOutcomes(outcomesPath, { journalPath, limit = 200, decisionRecordHashes = null } = {}) {
  assertOutcomePaths(outcomesPath, journalPath);
  const decisions = validatedDecisions(journalPath);
  const rows = validatedOutcomes(outcomesPath, decisions);
  if (decisionRecordHashes !== null && (!Array.isArray(decisionRecordHashes)
      || decisionRecordHashes.some(hash => typeof hash !== 'string' || !HASH.test(hash)))) throw new Error('DECISION_OUTCOME_FILTER_INVALID');
  const requested = decisionRecordHashes === null ? null : new Set(decisionRecordHashes);
  return rows.filter(row => !requested || requested.has(row.decisionRecordHash))
    .slice(-Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 200))).reverse();
}

export function appendDecisionOutcome(outcomesPath, journalPath, input, { now = new Date() } = {}) {
  assertOutcomePaths(outcomesPath, journalPath);
  const manual = normalizedOutcome(input);
  if (!fs.existsSync(journalPath)) throw new Error('DECISION_OUTCOME_REFERENCE_UNKNOWN');
  return withOutcomeWriter(outcomesPath, () => {
    const decisions = validatedDecisions(journalPath);
    const original = decisions.find(row => row.recordHash === manual.decisionRecordHash);
    if (!original) throw new Error('DECISION_OUTCOME_REFERENCE_UNKNOWN');
    const audited = outcomeState(outcomesPath, decisions);
    const rows = audited.rows;
    const at = now instanceof Date ? now.getTime() : NaN;
    if (!Number.isFinite(at) || !Number.isFinite(Date.parse(original.recordedAt)) || at < Date.parse(original.recordedAt)
        || (rows.length && at < Date.parse(rows.at(-1).recordedAt))) throw new Error('DECISION_OUTCOME_TIME_INVALID');
    const body = { schemaVersion: 'manual-decision-outcome-v1', sequence: rows.length + 1,
      previousHash: rows.at(-1)?.recordHash || null, recordedAt: now.toISOString(), ...manual,
      snapshotHash: original.snapshotHash, formalWeight: 0, researchOnly: true, executionAuthorized: false, orderRoutesEnabled: false };
    const entry = Object.freeze({ ...body, recordHash: decisionDigest(body) });
    const previous = audited.identity;
    const flags = fs.constants.O_RDWR | fs.constants.O_APPEND | (fs.constants.O_NOFOLLOW || 0)
      | (previous ? 0 : fs.constants.O_CREAT | fs.constants.O_EXCL);
    const fd = fs.openSync(outcomesPath, flags, 0o600);
    let writtenIdentity;
    try {
      const actual = fs.fstatSync(fd), source = fs.statSync(journalPath);
      if (!actual.isFile() || actual.nlink !== 1 || (actual.dev === source.dev && actual.ino === source.ino)
          || (previous && (actual.dev !== previous.dev || actual.ino !== previous.ino || actual.size !== previous.size))) {
        throw new Error('DECISION_OUTCOME_STATE_CHANGED');
      }
      if (fs.readFileSync(fd, 'utf8') !== audited.raw) throw new Error('DECISION_OUTCOME_STATE_CHANGED');
      fs.appendFileSync(fd, `${JSON.stringify(entry)}\n`, { encoding: 'utf8' });
      fs.fsyncSync(fd);
      writtenIdentity = fs.fstatSync(fd);
    } finally { fs.closeSync(fd); }
    const committed = outcomeState(outcomesPath, decisions);
    if (!sameOutcomeIdentity(writtenIdentity, committed.identity) || committed.rows.at(-1)?.recordHash !== entry.recordHash) {
      throw new Error('DECISION_OUTCOME_COMMIT_CHANGED');
    }
    return entry;
  });
}

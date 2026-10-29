import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import * as journal from '../src/decision-journal.mjs';
import { createDecisionSnapshot, decisionDigest } from '../src/dashboard-decision-workspace.mjs';

const now = new Date('2026-10-27T01:00:00.000Z');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'manual-journal-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const journalPath = path.join(root, 'journal.ndjson');
  const outcomesPath = path.join(root, 'journal-outcomes.ndjson');
  const snapshot = createDecisionSnapshot({
    snapshot: { dataMode: 'live', asOfDate: '2026-10-27', generatedAt: now.toISOString(),
      futuresMarket: { ok: false }, marketBreadth: { ok: false }, options: { ok: false }, marketOverview: { ok: false } },
    dataHealth: { schemaVersion: 'dashboard-data-health-v1', generatedAt: now.toISOString(), overall: 'UNAVAILABLE',
      staleCount: 0, unavailableCount: 1, counts: {}, items: [], formalWeight: 0, researchOnly: true, executionAuthorized: false },
    snapshotTime: now.toISOString(),
  });
  const entry = journal.appendDecisionJournal(journalPath, { intent: 'NO_TRADE', reason: 'No qualified evidence', snapshot }, { now });
  return { root, journalPath, outcomesPath, snapshot, entry };
}
const body = entry => ({ decisionRecordHash: entry.recordHash, executionStatus: 'NOT_EXECUTED', thesisStatus: 'NOT_APPLICABLE', outcomeNote: 'Kept the original no-trade decision.' });
const bytes = file => fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : null;
const rows = file => fs.readFileSync(file, 'utf8').trim().split('\n').map(line => JSON.parse(line));
const writeRows = (file, values) => fs.writeFileSync(file, values.map(value => JSON.stringify(value)).join('\n') + '\n');
const rehash = value => { const { recordHash, ...rest } = value; return { ...rest, recordHash: decisionDigest(rest) }; };

test('an unterminated outcome row is rejected before append without changing either chain', t => {
  const f = fixture(t), original = bytes(f.journalPath);
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const complete = bytes(f.outcomesPath);
  for (const suffix of ['', '\r']) {
    const unterminated = complete.slice(0, -1) + suffix;
    fs.writeFileSync(f.outcomesPath, unterminated);
    // The complete JSON and its hash are valid; the missing record delimiter
    // must still prevent a subsequent append from concatenating two records.
    assert.equal(journal.readDecisionOutcomes(f.outcomesPath, { journalPath: f.journalPath }).length, 1);
    assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath,
      { ...body(f.entry), outcomeNote: 'Must not be appended.' }, { now }), /DECISION_OUTCOME_LINE_INCOMPLETE/);
    assert.equal(bytes(f.outcomesPath), unterminated);
    assert.equal(bytes(f.journalPath), original);
    assert.equal(fs.existsSync(path.join(f.root, 'journal-outcomes.lock')), false);
  }
});

test('a CRLF-terminated outcome chain remains appendable without rewriting existing bytes', t => {
  const f = fixture(t), original = bytes(f.journalPath);
  const first = journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const prefix = bytes(f.outcomesPath).replaceAll('\n', '\r\n');
  fs.writeFileSync(f.outcomesPath, prefix);
  const second = journal.appendDecisionOutcome(f.outcomesPath, f.journalPath,
    { ...body(f.entry), outcomeNote: 'A later observation.' }, { now });
  assert.ok(bytes(f.outcomesPath).startsWith(prefix));
  assert.equal(bytes(f.journalPath), original);
  assert.equal(second.previousHash, first.recordHash);
  assert.equal(journal.auditDecisionOutcomes(rows(f.outcomesPath), rows(f.journalPath)).ok, true);
});

test('manual confidence and execution are explicit user fields; legacy decisions remain byte-identical', t => {
  const f = fixture(t);
  const old = rows(f.journalPath)[0];
  delete old.confidence; delete old.executionStatus; delete old.orderRoutesEnabled;
  writeRows(f.journalPath, [rehash(old)]);
  const legacy = bytes(f.journalPath);
  assert.equal(journal.readDecisionJournal(f.journalPath)[0].confidence, undefined);
  const next = journal.appendDecisionJournal(f.journalPath, { intent: 'LONG_INTENT', snapshot: f.snapshot,
    confidence: 'LOW', executionStatus: 'NOT_EXECUTED' }, { now: new Date(now.getTime() + 1000) });
  assert.equal(next.confidence, 'LOW');
  assert.equal(next.executionStatus, 'NOT_EXECUTED');
  assert.equal(next.snapshotHash, f.snapshot.snapshotHash);
  assert.equal(next.outcome, null);
  assert.equal(next.executionAuthorized, false);
  assert.ok(bytes(f.journalPath).startsWith(legacy));
  assert.equal(journal.auditDecisionJournal(rows(f.journalPath)).ok, true);
});

test('manual results append a separate linked chain without editing a decision or snapshot', t => {
  const f = fixture(t), original = bytes(f.journalPath);
  const first = journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now: new Date(now.getTime() + 1000) });
  const firstBytes = bytes(f.outcomesPath);
  const second = journal.appendDecisionOutcome(f.outcomesPath, f.journalPath,
    { ...body(f.entry), thesisStatus: 'FOLLOWED', outcomeNote: 'Additional observation; original note retained.' },
    { now: new Date(now.getTime() + 2000) });
  assert.equal(first.decisionRecordHash, f.entry.recordHash);
  assert.equal(first.snapshotHash, f.entry.snapshotHash);
  assert.equal(second.previousHash, first.recordHash);
  assert.equal(second.sequence, 2);
  assert.equal(second.researchOnly, true);
  assert.equal(second.formalWeight, 0);
  assert.equal(second.executionAuthorized, false);
  assert.equal(second.orderRoutesEnabled, false);
  assert.ok(bytes(f.outcomesPath).startsWith(firstBytes));
  assert.equal(bytes(f.journalPath), original);
  assert.deepEqual(journal.readDecisionOutcomes(f.outcomesPath, { journalPath: f.journalPath }).map(row => row.sequence), [2, 1]);
  assert.equal(journal.readDecisionJournal(f.journalPath)[0].outcome, null);
  assert.equal(journal.auditDecisionOutcomes(rows(f.outcomesPath), rows(f.journalPath)).ok, true);
});

test('missing manual values stay unknown and invalid values are rejected before any append', t => {
  const f = fixture(t), original = bytes(f.journalPath);
  assert.equal(f.entry.confidence, null);
  assert.equal(f.entry.executionStatus, 'UNKNOWN');
  for (const patch of [{ confidence: 0 }, { confidence: 'CERTAIN' }, { executionStatus: 0 }, { executionStatus: 'LIVE' }]) {
    assert.throws(() => journal.appendDecisionJournal(f.journalPath, { intent: 'NO_TRADE', snapshot: f.snapshot, ...patch }, { now }), /DECISION_JOURNAL_/);
    assert.equal(bytes(f.journalPath), original);
  }
});

test('unknown decisions, forged authority, bad enums and empty outcomes do not create an event file', t => {
  const f = fixture(t), original = bytes(f.journalPath);
  const invalid = [
    { ...body(f.entry), decisionRecordHash: 'a'.repeat(64) },
    { ...body(f.entry), snapshotHash: 'b'.repeat(64) },
    { ...body(f.entry), executionAuthorized: true },
    { ...body(f.entry), recordedAt: now.toISOString() },
    { ...body(f.entry), executionStatus: 'FILLED_BY_BROKER' },
    { ...body(f.entry), thesisStatus: false },
    { ...body(f.entry), outcomeNote: 0 },
    { decisionRecordHash: f.entry.recordHash, executionStatus: 'UNKNOWN', thesisStatus: 'UNKNOWN', outcomeNote: '  ' },
  ];
  for (const input of invalid) {
    assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, input, { now }), /DECISION_(JOURNAL|OUTCOME)_/);
    assert.equal(bytes(f.outcomesPath), null);
    assert.equal(bytes(f.journalPath), original);
  }
  assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now: new Date(now.getTime() - 1) }), /DECISION_OUTCOME_TIME/);
  assert.equal(bytes(f.outcomesPath), null);
});

test('both chains and every outcome reference are audited before reading or appending', t => {
  const f = fixture(t);
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const originalJournal = bytes(f.journalPath), originalOutcomes = bytes(f.outcomesPath);
  for (const change of [
    row => ({ ...row, outcomeNote: 'tampered' }),
    row => rehash({ ...row, decisionRecordHash: 'a'.repeat(64) }),
    row => rehash({ ...row, snapshotHash: 'a'.repeat(64) }),
    row => rehash({ ...row, executionAuthorized: true }),
  ]) {
    writeRows(f.outcomesPath, [change(JSON.parse(originalOutcomes))]);
    const corrupted = bytes(f.outcomesPath);
    assert.throws(() => journal.readDecisionOutcomes(f.outcomesPath, { journalPath: f.journalPath }), /DECISION_OUTCOME_/);
    assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /DECISION_OUTCOME_/);
    assert.equal(bytes(f.outcomesPath), corrupted);
    assert.equal(bytes(f.journalPath), originalJournal);
  }
  fs.writeFileSync(f.outcomesPath, originalOutcomes);
  const decision = JSON.parse(originalJournal); decision.reason = 'tampered original';
  writeRows(f.journalPath, [decision]);
  assert.throws(() => journal.readDecisionOutcomes(f.outcomesPath, { journalPath: f.journalPath }), /DECISION_JOURNAL_/);
  assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /DECISION_JOURNAL_/);
  assert.equal(bytes(f.outcomesPath), originalOutcomes);
});

test('outcome paths are fixed private siblings and cannot alias the original journal', t => {
  const f = fixture(t), original = bytes(f.journalPath);
  for (const wrong of [f.journalPath, path.join(f.root, 'other.ndjson'), path.join(f.root, 'data', 'market-state', 'forward-shadow', 'journal-outcomes.ndjson')]) {
    assert.throws(() => journal.appendDecisionOutcome(wrong, f.journalPath, body(f.entry), { now }), /DECISION_(JOURNAL|OUTCOME)_/);
    assert.equal(bytes(f.journalPath), original);
  }
  fs.linkSync(f.journalPath, f.outcomesPath);
  assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /DECISION_OUTCOME_PATH/);
  assert.equal(bytes(f.journalPath), original);
});

test('outcome file symlinks are refused without touching their target', { skip: process.platform === 'win32' }, t => {
  const f = fixture(t), target = path.join(f.root, 'private-target'); fs.writeFileSync(target, 'preserved');
  fs.symlinkSync(target, f.outcomesPath);
  assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /DECISION_OUTCOME_PATH/);
  assert.equal(fs.readFileSync(target, 'utf8'), 'preserved');
});

test('outcome lookup can reference an older decision and view filtering does not change audit scope', t => {
  const f = fixture(t);
  for (let i = 1; i <= 21; i++) journal.appendDecisionJournal(f.journalPath, { intent: 'NO_TRADE', snapshot: f.snapshot }, { now: new Date(now.getTime() + i) });
  assert.ok(!journal.readDecisionJournal(f.journalPath, { limit: 20 }).some(row => row.recordHash === f.entry.recordHash));
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now: new Date(now.getTime() + 1000) });
  assert.equal(journal.readDecisionOutcomes(f.outcomesPath, { journalPath: f.journalPath, decisionRecordHashes: [f.entry.recordHash] }).length, 1);
  assert.deepEqual(journal.readDecisionOutcomes(f.outcomesPath, { journalPath: f.journalPath, decisionRecordHashes: [] }), []);
});

test('first-load empty journals return no invented outcomes and do not create private storage', t => {
  const f = fixture(t), parent = path.join(f.root, 'not-created');
  assert.deepEqual(journal.readDecisionOutcomes(path.join(parent, 'journal-outcomes.ndjson'), {
    journalPath: path.join(parent, 'journal.ndjson'),
  }), []);
  assert.throws(() => journal.appendDecisionOutcome(path.join(parent, 'journal-outcomes.ndjson'), path.join(parent, 'journal.ndjson'),
    { ...body(f.entry) }, { now }), /DECISION_OUTCOME_REFERENCE_UNKNOWN/);
  assert.equal(fs.existsSync(parent), false);
});

test('existing writer guards are preserved and rejected before any ledger mutation', t => {
  const f = fixture(t), original = bytes(f.journalPath), guard = path.join(f.root, 'journal-outcomes.lock');
  fs.writeFileSync(guard, 'unknown owner; never take over');
  assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /DECISION_OUTCOME_BUSY/);
  assert.equal(fs.readFileSync(guard, 'utf8'), 'unknown owner; never take over');
  assert.equal(bytes(f.outcomesPath), null);
  assert.equal(bytes(f.journalPath), original);
});

test('a second legitimate writer cannot interleave between the first writer audit and append', t => {
  const f = fixture(t), guard = path.join(f.root, 'journal-outcomes.lock');
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const originalRead = fs.readFileSync;
  let injected = false, concurrentError = null;
  fs.readFileSync = function(file, ...args) {
    if (file === f.outcomesPath && !injected) {
      injected = true;
      const before = originalRead.call(fs, file, 'utf8');
      try { journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, { ...body(f.entry), outcomeNote: 'another writer' }, { now }); }
      catch (error) { concurrentError = error.message; }
      assert.equal(originalRead.call(fs, file, 'utf8'), before);
    }
    return originalRead.call(fs, file, ...args);
  };
  try { journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, { ...body(f.entry), outcomeNote: 'owner append' }, { now }); }
  finally { fs.readFileSync = originalRead; }
  assert.equal(injected, true);
  assert.equal(concurrentError, 'DECISION_OUTCOME_BUSY');
  assert.deepEqual(rows(f.outcomesPath).map(row => row.sequence), [1, 2]);
  assert.equal(journal.auditDecisionOutcomes(rows(f.outcomesPath), rows(f.journalPath)).ok, true);
  assert.equal(fs.existsSync(guard), false);
});

test('a post-audit external append is rejected against the audited file identity without corrupting its chain', t => {
  const f = fixture(t), originalJournal = bytes(f.journalPath), guard = path.join(f.root, 'journal-outcomes.lock');
  const first = journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const interloper = rehash({ ...first, sequence: 2, previousHash: first.recordHash, outcomeNote: 'independent append' });
  const expected = bytes(f.outcomesPath) + JSON.stringify(interloper) + '\n';
  const originalOpen = fs.openSync; let injected = false;
  fs.openSync = function(file, flags, ...args) {
    if (file === f.outcomesPath && typeof flags === 'number' && flags & fs.constants.O_APPEND && !injected) {
      injected = true; fs.appendFileSync(file, JSON.stringify(interloper) + '\n');
    }
    return originalOpen.call(fs, file, flags, ...args);
  };
  try {
    assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath,
      { ...body(f.entry), outcomeNote: 'must not append duplicate sequence' }, { now }), /DECISION_OUTCOME_STATE_CHANGED/);
  } finally { fs.openSync = originalOpen; }
  assert.equal(injected, true);
  assert.equal(bytes(f.outcomesPath), expected);
  assert.equal(bytes(f.journalPath), originalJournal);
  assert.equal(journal.auditDecisionOutcomes(rows(f.outcomesPath), rows(f.journalPath)).ok, true);
  assert.equal(fs.existsSync(guard), false);
});

test('writer finally releases only its own guard after validation or append failure', t => {
  const f = fixture(t), guard = path.join(f.root, 'journal-outcomes.lock');
  assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry),
    { now: new Date(now.getTime() - 1) }), /DECISION_OUTCOME_TIME/);
  assert.equal(fs.existsSync(guard), false);
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const before = bytes(f.outcomesPath), originalAppend = fs.appendFileSync;
  fs.appendFileSync = function(file, ...args) {
    if (typeof file === 'number') throw new Error('synthetic append denied');
    return originalAppend.call(fs, file, ...args);
  };
  try { assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /synthetic append denied/); }
  finally { fs.appendFileSync = originalAppend; }
  assert.equal(bytes(f.outcomesPath), before);
  assert.equal(fs.existsSync(guard), false);
});

test('post-audit file replacement with identical bytes is not mistaken for the audited ledger', t => {
  const f = fixture(t), backup = path.join(f.root, 'replaced-original.ndjson');
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const before = bytes(f.outcomesPath), originalOpen = fs.openSync; let injected = false;
  fs.openSync = function(file, flags, ...args) {
    if (file === f.outcomesPath && typeof flags === 'number' && flags & fs.constants.O_APPEND && !injected) {
      injected = true; fs.renameSync(file, backup); fs.writeFileSync(file, before);
    }
    return originalOpen.call(fs, file, flags, ...args);
  };
  try { assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /DECISION_OUTCOME_STATE_CHANGED/); }
  finally { fs.openSync = originalOpen; }
  assert.equal(injected, true);
  assert.equal(bytes(f.outcomesPath), before);
  assert.equal(bytes(backup), before);
  assert.equal(fs.existsSync(path.join(f.root, 'journal-outcomes.lock')), false);
});

test('a replaced unknown guard is preserved and cleanup does not hide the primary append error', t => {
  const f = fixture(t), guard = path.join(f.root, 'journal-outcomes.lock'), renamed = path.join(f.root, 'prior-owned.lock');
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const before = bytes(f.outcomesPath), originalAppend = fs.appendFileSync;
  fs.appendFileSync = function(file, ...args) {
    if (typeof file === 'number') {
      fs.renameSync(guard, renamed); fs.writeFileSync(guard, 'foreign owner');
      throw new Error('synthetic primary append failure');
    }
    return originalAppend.call(fs, file, ...args);
  };
  try { assert.throws(() => journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now }), /synthetic primary append failure/); }
  finally { fs.appendFileSync = originalAppend; }
  assert.equal(bytes(f.outcomesPath), before);
  assert.equal(fs.readFileSync(guard, 'utf8'), 'foreign owner');
  assert.equal(fs.existsSync(renamed), true);
});

test('shipped journal GET retains original decision rows and separately returns audited manual events', async t => {
  const f = fixture(t), source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  journal.appendDecisionOutcome(f.outcomesPath, f.journalPath, body(f.entry), { now });
  const start = source.indexOf("if (req.method === 'GET' && pathname === '/api/v1/decision-journal')");
  const end = source.indexOf("if (req.method === 'GET' && pathname === '/api/v1/tx-chart')", start);
  assert.ok(start >= 0 && end > start);
  const handler = source.slice(start, end);
  let sent = null;
  const context = vm.createContext({ req: { method: 'GET' }, res: {}, pathname: '/api/v1/decision-journal',
    url: new URL('http://synthetic.invalid/api/v1/decision-journal?limit=20'),
    decisionJournalPath: f.journalPath, decisionOutcomesPath: f.outcomesPath,
    readDecisionJournal: journal.readDecisionJournal, readDecisionOutcomes: journal.readDecisionOutcomes,
    sendJson: (_res, status, payload) => { sent = { status, payload }; } });
  const run = () => vm.runInContext('(async()=>{' + handler + '})()', context);
  await run(); assert.equal(sent.status, 200);
  assert.equal(sent.payload.data[0].outcome, null);
  assert.equal(sent.payload.data[0].recordHash, f.entry.recordHash);
  assert.equal(sent.payload.outcomes[0].decisionRecordHash, f.entry.recordHash);
  const original = bytes(f.journalPath), event = rows(f.outcomesPath)[0]; event.outcomeNote = 'changed'; writeRows(f.outcomesPath, [event]);
  await run(); assert.equal(sent.status, 503);
  assert.equal(sent.payload.error, 'DECISION_JOURNAL_UNAVAILABLE');
  assert.equal(sent.payload.data, undefined);
  assert.equal(bytes(f.journalPath), original);
});

test('shipped outcome handler retains CSRF and cannot accept caller file paths or snapshot overrides', async t => {
  const f = fixture(t), source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("if (req.method === 'POST' && pathname === '/api/v1/decision-journal/outcomes')");
  assert.ok(start >= 0, 'the normal authenticated server must have the outcome handler');
  const end = source.indexOf("if (req.method === 'POST' && pathname === '/api/v1/decision-journal')", start);
  assert.ok(end > start);
  const handler = source.slice(start, end);
  let sent = null, csrfAllowed = false;
  const context = vm.createContext({ req: { method: 'POST' }, res: {}, session: {}, pathname: '/api/v1/decision-journal/outcomes',
    decisionJournalPath: f.journalPath, decisionOutcomesPath: f.outcomesPath,
    appendDecisionOutcome: journal.appendDecisionOutcome, requireCsrf: () => csrfAllowed,
    readJson: async () => body(f.entry), sendJson: (_res, status, payload) => { sent = { status, payload }; } });
  const run = () => vm.runInContext('(async()=>{' + handler + '})()', context);
  await run(); assert.equal(sent, null); assert.equal(bytes(f.outcomesPath), null);
  csrfAllowed = true; await run(); assert.equal(sent.status, 201);
  assert.equal(sent.payload.data.decisionRecordHash, f.entry.recordHash);
  assert.equal(sent.payload.data.snapshotHash, f.entry.snapshotHash);
  context.readJson = async () => ({ ...body(f.entry), filePath: '/arbitrary', snapshot: {} });
  await run(); assert.equal(sent.status, 400);
  assert.equal(rows(f.outcomesPath).length, 1);
});

test('shipped decision handler reports invalid manual input without appending or turning zero into confidence', async t => {
  const f = fixture(t), original = bytes(f.journalPath), source = fs.readFileSync(new URL('../server.mjs', import.meta.url), 'utf8');
  const start = source.indexOf("if (req.method === 'POST' && pathname === '/api/v1/decision-journal')");
  const end = source.indexOf("if (req.method === 'GET' && pathname === '/api/v1/history')", start);
  assert.ok(start >= 0 && end > start);
  let sent = null;
  const context = vm.createContext({ req: { method: 'POST' }, res: {}, session: {}, pathname: '/api/v1/decision-journal',
    decisionJournalPath: f.journalPath, appendDecisionJournal: journal.appendDecisionJournal,
    requireCsrf: () => true, readJson: async () => ({ intent: 'NO_TRADE', snapshot: f.snapshot, confidence: 0 }),
    sendJson: (_res, status, payload) => { sent = { status, payload }; } });
  await vm.runInContext('(async()=>{' + source.slice(start, end) + '})()', context);
  assert.equal(sent.status, 400);
  assert.equal(sent.payload.error, 'DECISION_JOURNAL_CONFIDENCE_INVALID');
  assert.equal(bytes(f.journalPath), original);
});

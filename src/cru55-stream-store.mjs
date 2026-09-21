import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { assertPlainPath } from './cvd-observation-isolation.mjs';
import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { evaluateBestQuoteEligibility } from './tx-intraday-pressure-path-efficiency.mjs';
import { createStreamCheckpoint, appendStreamRecord, validateStreamCheckpoint } from './cru55-stream-core.mjs';

export const STREAM_STORE_LIMITS = Object.freeze({ records: 128, inputBytes: 512 * 1024,
  pageBytes: 2 * 1024 * 1024, queryPages: 32, queryBytes: 8 * 1024 * 1024, cursorBytes: 128 * 1024 });
const PAGE = 'cru55-stream-page-v1', POINTER = 'cru55-stream-pointer-v1', QUERY = 'cru55-stream-query-v1';
const hash = value => /^[a-f0-9]{64}$/.test(value || '');
const same = (a, b) => stableJson(a) === stableJson(b);
const fail = code => { const error = Error(code); error.code = code; throw error; };
const bounded = (value, max) => Number.isSafeInteger(value) && value > 0 && value <= max;

// Private candidate archive only. Committed immutable pages are the authority
// for derived history. This does NOT reverify the original mutable raw prefix,
// certify formal source integrity, or implement full-day Relationship logic.
// read() verifies the current page; auditHistory() explicitly walks all links.
export function createStreamStore({ root, sourceLedgerIdentity, resolverIdentity } = {}) {
  const initial = createStreamCheckpoint(sourceLedgerIdentity, resolverIdentity);
  if (typeof root !== 'string' || !path.isAbsolute(root)) fail('STREAM_STORE_ABSOLUTE_ROOT_REQUIRED');
  root = assertPlainPath(root); fs.mkdirSync(root, { recursive: true });
  const name = file => assertPlainPath(path.join(root, file));
  const pointerFile = () => name('latest.json');
  function readJson(file, cap) {
    assertPlainPath(file);
    const stat = fs.statSync(file);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > cap) fail('STREAM_STORE_FILE_INVALID');
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  }
  function temp(bytes) {
    const file = name(crypto.randomUUID() + '.tmp'), fd = fs.openSync(file, 'wx');
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return file;
  }
  function immutable(value, extension, cap) {
    const bytes = stableJson(value);
    if (Buffer.byteLength(bytes) > cap) fail('STREAM_STORE_ARTIFACT_BUDGET');
    const id = digest(bytes), target = name(id + extension), pending = temp(bytes);
    try {
      try { fs.linkSync(pending, target); }
      catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!same(readJson(target, cap), value)) fail('STREAM_STORE_IMMUTABLE_COLLISION');
      }
    } finally { fs.unlinkSync(pending); }
    return id;
  }
  function page(id) {
    if (!hash(id)) fail('STREAM_STORE_PAGE_HASH_INVALID');
    const p = readJson(name(id + '.page.json'), STREAM_STORE_LIMITS.pageBytes);
    if (digest(stableJson(p)) !== id || p.schemaVersion !== PAGE
      || p.sourceLedgerIdentity !== sourceLedgerIdentity || p.resolverIdentity !== resolverIdentity
      || !Array.isArray(p.records) || !bounded(p.records.length, STREAM_STORE_LIMITS.records)
      || !Array.isArray(p.facts) || p.facts.length !== p.records.length
      || !Number.isSafeInteger(p.startOrdinal) || p.startOrdinal < 1
      || p.endOrdinal !== p.startOrdinal + p.records.length - 1
      || (p.previousPageHash !== null && !hash(p.previousPageHash))
      || (p.previousQuotePageHash !== null && !hash(p.previousQuotePageHash))
      || Object.entries(SAFETY).some(([k, v]) => p[k] !== v)) fail('STREAM_STORE_PAGE_INVALID');
    const state = validateStreamCheckpoint(p.checkpoint);
    if (state.sourceLedgerIdentity !== sourceLedgerIdentity || state.resolverIdentity !== resolverIdentity
      || state.ordinal !== p.endOrdinal || state.terminalHash !== p.records.at(-1).recordHash
      || (p.startOrdinal === 1 && (p.previousPageHash !== null || p.previousTerminalHash !== 'GENESIS'))
      || (p.startOrdinal > 1 && (!hash(p.previousPageHash) || !hash(p.previousTerminalHash)))) fail('STREAM_STORE_PAGE_BINDING_INVALID');
    let priorHash = p.previousTerminalHash, quoteCount = 0;
    for (let i = 0; i < p.records.length; i++) {
      const record = p.records[i], { recordHash, ...body } = record, fact = p.facts[i];
      if (record.previousHash !== priorHash || recordHash !== digest(`${priorHash}\n${stableJson(body)}`)
        || fact.ordinal !== p.startOrdinal + i || fact.recordHash !== recordHash) fail('STREAM_STORE_RECORD_BINDING_INVALID');
      if (fact.event && (fact.event.ledgerOrdinal !== fact.ordinal || fact.event.recordHash !== recordHash
        || fact.event.sourceLedgerIdentity !== sourceLedgerIdentity || !same(fact.event.rawRecord, record))) fail('STREAM_STORE_EVENT_BINDING_INVALID');
      if (fact.point && (fact.point.ledgerOrdinal !== fact.ordinal || fact.point.recordHash !== recordHash)) fail('STREAM_STORE_POINT_BINDING_INVALID');
      if (fact.event?.kind === 'futures_bidask') quoteCount++;
      priorHash = recordHash;
    }
    if (p.quoteCount !== quoteCount) fail('STREAM_STORE_QUOTE_METADATA_INVALID');
    return p;
  }
  function read() {
    if (!fs.existsSync(pointerFile())) {
      // A missing pointer in a used archive is recovery work, never permission
      // to reset cumulative state. Stream directory entries rather than loading
      // an unbounded list; a new store contains at most our writer lock.
      const dir = fs.opendirSync(root);
      try { for (let entry; (entry = dir.readSync());) if (entry.name !== 'writer.lock') fail('STREAM_STORE_POINTER_MISSING'); }
      finally { dir.closeSync(); }
      return { headPageHash: null, checkpoint: initial, verification: 'EMPTY_ARCHIVE', candidateOnly: true };
    }
    const pointer = readJson(pointerFile(), 4096);
    if (pointer.schemaVersion !== POINTER || pointer.sourceLedgerIdentity !== sourceLedgerIdentity
      || pointer.resolverIdentity !== resolverIdentity || !hash(pointer.pageHash)) fail('STREAM_STORE_POINTER_INVALID');
    const current = page(pointer.pageHash);
    return { headPageHash: pointer.pageHash, checkpoint: current.checkpoint, current,
      verification: 'CURRENT_PAGE_ONLY', candidateOnly: true };
  }
  function cursor(value, extension = '.query.json') {
    return immutable(value, extension, STREAM_STORE_LIMITS.cursorBytes);
  }
  function loadCursor(id, extension = '.query.json') {
    if (!hash(id)) fail('STREAM_STORE_CURSOR_INVALID');
    const value = readJson(name(id + extension), STREAM_STORE_LIMITS.cursorBytes);
    if (digest(stableJson(value)) !== id) fail('STREAM_STORE_CURSOR_INVALID');
    return value;
  }
  function withLock(action) {
    const lock = name('writer.lock'), token = crypto.randomUUID();
    try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') fail('STREAM_STORE_WRITER_BUSY'); throw error; }
    const owner = assertPlainPath(path.join(lock, 'owner.json'));
    const identity = fs.statSync(lock);
    fs.writeFileSync(owner, JSON.stringify({ token }), { flag: 'wx' });
    let error;
    try { return action(); } catch (e) { error = e; throw e; }
    finally {
      try {
        const now = fs.statSync(assertPlainPath(lock));
        if (now.dev !== identity.dev || now.ino !== identity.ino || now.birthtimeMs !== identity.birthtimeMs
          || readJson(owner, 4096).token !== token) fail('STREAM_STORE_LOCK_OWNER_CHANGED');
        fs.unlinkSync(owner); fs.rmdirSync(lock);
      } catch (cleanupError) { if (!error) throw cleanupError; }
    }
  }
  function append(records, { resolveSessionTradeDate = null, quoteCursor = null,
    maxQueryPages = STREAM_STORE_LIMITS.queryPages, maxQueryBytes = STREAM_STORE_LIMITS.queryBytes } = {}) {
    if (!Array.isArray(records) || !bounded(records.length, STREAM_STORE_LIMITS.records)
      || Buffer.byteLength(stableJson(records)) > STREAM_STORE_LIMITS.inputBytes
      || !bounded(maxQueryPages, STREAM_STORE_LIMITS.queryPages) || !bounded(maxQueryBytes, STREAM_STORE_LIMITS.queryBytes)) fail('STREAM_STORE_BATCH_BUDGET');
    return withLock(() => {
      const current = read(), previous = current.checkpoint.state;
      const batchHash = digest(stableJson(records));
      if (current.current && same(current.current.records, records)) return { state: 'UNCHANGED', ...current };
      if (records[0]?.previousHash !== previous.terminalHash) fail('STREAM_STORE_APPEND_FENCE');
      const binding = { sourceLedgerIdentity, resolverIdentity, headPageHash: current.headPageHash,
        checkpointHash: current.checkpoint.stateHash, batchHash };
      let progress = { schemaVersion: QUERY, binding, completed: {}, quotes: {}, pending: null };
      if (quoteCursor) {
        progress = loadCursor(quoteCursor);
        if (progress.schemaVersion !== QUERY || !same(progress.binding, binding)
          || !progress.completed || typeof progress.completed !== 'object'
          || !progress.quotes || typeof progress.quotes !== 'object') fail('STREAM_STORE_CURSOR_BINDING_INVALID');
      }
      const localQuotes = [], facts = [];
      const initialQuotePage = current.current?.quoteCount ? current.headPageHash : current.current?.previousQuotePageHash ?? null;
      let checkpoint = current.checkpoint, queryPages = 0, queryBytes = 0;
      const pending = (event, afterOrdinal, nextPageHash, upperOrdinal) => {
        progress.pending = { tickHash: event.recordHash, tickOrdinal: event.ledgerOrdinal, afterOrdinal, nextPageHash, upperOrdinal };
        const id = cursor(progress), error = Error('STREAM_QUOTE_QUERY_PENDING');
        error.code = 'STREAM_QUOTE_QUERY_PENDING'; error.cursor = id;
        error.queryPages = queryPages; error.queryBytes = queryBytes; throw error;
      };
      const lookupQuote = (event, { afterOrdinal }) => {
        // Local quotes precede all archived quotes in physical order.
        const local = localQuotes.findLast(q => q.ledgerOrdinal > afterOrdinal && evaluateBestQuoteEligibility(q, event).eligible);
        if (local) return local;
        const key = String(event.ledgerOrdinal), done = progress.completed[key];
        if (done) {
          if (done.tickHash !== event.recordHash || done.afterOrdinal !== afterOrdinal) fail('STREAM_STORE_QUERY_PROOF_INVALID');
          if (done.quotePageHash === null) return null;
          // An immutable cursor contains the canonical fact already verified
          // against this source page during the prior invocation. Replaying up
          // to 128 proofs must not reread 128 historical pages outside the scan
          // budget. Cursor bytes are separately capped at 128 KiB, including
          // deduplicated facts; overflow fails rather than dropping a proof.
          const saved = progress.quotes[done.quoteHash], quote = saved?.event;
          if (!hash(done.quotePageHash) || saved?.pageHash !== done.quotePageHash
            || !quote || digest(stableJson(quote)) !== done.quoteHash
            || quote.ledgerOrdinal !== done.quoteOrdinal || quote.ledgerOrdinal <= afterOrdinal
            || quote.sourceLedgerIdentity !== sourceLedgerIdentity
            || !evaluateBestQuoteEligibility(quote, event).eligible) fail('STREAM_STORE_QUERY_PROOF_INVALID');
          return quote;
        }
        let next = initialQuotePage, upperOrdinal = previous.ordinal + 1;
        if (progress.pending?.tickOrdinal === event.ledgerOrdinal) {
          if (progress.pending.tickHash !== event.recordHash || progress.pending.afterOrdinal !== afterOrdinal) fail('STREAM_STORE_CURSOR_BINDING_INVALID');
          next = progress.pending.nextPageHash;
          upperOrdinal = progress.pending.upperOrdinal;
        }
        const visited = new Set();
        while (next) {
          if (queryPages >= maxQueryPages) pending(event, afterOrdinal, next, upperOrdinal);
          if (visited.has(next)) fail('STREAM_STORE_QUOTE_CHAIN_CYCLE'); visited.add(next);
          if (!hash(next)) fail('STREAM_STORE_PAGE_HASH_INVALID');
          const bytes = fs.statSync(name(next + '.page.json')).size;
          if (bytes > maxQueryBytes) fail('STREAM_QUOTE_PAGE_EXCEEDS_QUERY_BUDGET');
          if (queryBytes + bytes > maxQueryBytes) pending(event, afterOrdinal, next, upperOrdinal);
          const old = page(next);
          queryPages++; queryBytes += bytes;
          if (!Number.isSafeInteger(upperOrdinal) || old.endOrdinal >= upperOrdinal || old.quoteCount < 1) fail('STREAM_STORE_QUOTE_CHAIN_INVALID');
          if (old.endOrdinal <= afterOrdinal) break;
          const quote = old.facts.findLast(f => f.event?.kind === 'futures_bidask'
            && f.ordinal > afterOrdinal && evaluateBestQuoteEligibility(f.event, event).eligible)?.event;
          if (quote) {
            const quoteHash = digest(stableJson(quote));
            progress.quotes[quoteHash] = { pageHash: next, event: quote };
            progress.completed[key] = { tickHash: event.recordHash, afterOrdinal, quotePageHash: next, quoteOrdinal: quote.ledgerOrdinal, quoteHash };
            progress.pending = null; return quote;
          }
          upperOrdinal = old.startOrdinal; next = old.previousQuotePageHash;
        }
        progress.completed[key] = { tickHash: event.recordHash, afterOrdinal, quotePageHash: null };
        progress.pending = null; return null;
      };
      for (const record of records) {
        const result = appendStreamRecord(checkpoint, record, { resolveSessionTradeDate, lookupQuote });
        checkpoint = result.checkpoint;
        if (result.event?.kind === 'futures_bidask') localQuotes.push(result.event);
        facts.push({ ordinal: checkpoint.state.ordinal, recordHash: checkpoint.state.terminalHash,
          event: result.event, point: result.point, pressure: result.pressure, segmentStarted: result.segmentStarted,
          segment: result.point ? checkpoint.state.activeSegment : null });
      }
      const value = { schemaVersion: PAGE, sourceLedgerIdentity, resolverIdentity,
        previousPageHash: current.headPageHash, previousQuotePageHash: initialQuotePage,
        previousTerminalHash: previous.terminalHash, startOrdinal: previous.ordinal + 1, endOrdinal: checkpoint.state.ordinal,
        quoteCount: localQuotes.length, records, facts, checkpoint, ...SAFETY };
      const id = immutable(value, '.page.json', STREAM_STORE_LIMITS.pageBytes);
      const pointer = { schemaVersion: POINTER, sourceLedgerIdentity, resolverIdentity, pageHash: id };
      const file = temp(stableJson(pointer));
      try { fs.renameSync(file, pointerFile()); } finally { if (fs.existsSync(file)) fs.unlinkSync(file); }
      return { state: 'PUBLISHED', ...read(), queryPages, queryBytes };
    });
  }
  // Full-chain integrity is an explicit resumable operation, not a claim made
  // after reading only latest.json. It checks the archive, not original raw files.
  function auditHistory({ auditCursor = null, maxPages = STREAM_STORE_LIMITS.queryPages } = {}) {
    if (!bounded(maxPages, STREAM_STORE_LIMITS.queryPages)) fail('STREAM_STORE_AUDIT_BUDGET');
    const current = read(), binding = { sourceLedgerIdentity, resolverIdentity, headPageHash: current.headPageHash };
    let state = { schemaVersion: 'cru55-stream-audit-v1', binding, nextPageHash: current.headPageHash,
      expectedEndOrdinal: current.checkpoint.state.ordinal, expectedTerminalHash: current.checkpoint.state.terminalHash,
      checkedPages: 0, checkedRecords: 0, expectedQuotePageHash: null };
    if (auditCursor) {
      state = loadCursor(auditCursor, '.audit.json');
      if (state.schemaVersion !== 'cru55-stream-audit-v1' || !same(state.binding, binding)) fail('STREAM_STORE_CURSOR_BINDING_INVALID');
    }
    for (let i = 0; state.nextPageHash && i < maxPages; i++) {
      const id = state.nextPageHash, p = page(id);
      if (p.endOrdinal !== state.expectedEndOrdinal || p.checkpoint.state.terminalHash !== state.expectedTerminalHash) fail('STREAM_STORE_HISTORY_LINK_INVALID');
      if (state.checkedPages && (p.quoteCount ? id !== state.expectedQuotePageHash
        : p.previousQuotePageHash !== state.expectedQuotePageHash)) fail('STREAM_STORE_QUOTE_CHAIN_INVALID');
      state.checkedPages++; state.checkedRecords += p.records.length;
      state.nextPageHash = p.previousPageHash; state.expectedEndOrdinal = p.startOrdinal - 1; state.expectedTerminalHash = p.previousTerminalHash;
      state.expectedQuotePageHash = p.previousQuotePageHash;
    }
    if (!state.nextPageHash) {
      if (state.expectedEndOrdinal !== 0 || state.expectedTerminalHash !== 'GENESIS' || state.expectedQuotePageHash !== null) fail('STREAM_STORE_HISTORY_INCOMPLETE');
      return { state: 'COMPLETE', headPageHash: current.headPageHash, checkedPages: state.checkedPages,
        checkedRecords: state.checkedRecords, verification: 'ARCHIVE_CHAIN_AT_AUDIT', originalRawPrefixVerified: false };
    }
    return { state: 'PENDING', cursor: cursor(state, '.audit.json'), checkedPages: state.checkedPages,
      checkedRecords: state.checkedRecords, originalRawPrefixVerified: false };
  }
  return Object.freeze({ read, append, auditHistory, limits: STREAM_STORE_LIMITS });
}

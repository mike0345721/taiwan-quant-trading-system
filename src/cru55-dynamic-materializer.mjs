import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createCvdCheckpoint, appendCvdRecords, validateCvdCheckpoint, cvdSemanticResult, digest, stableJson, SAFETY, LIMITS } from './cvd-observation-core.mjs';
import { assertInputPath, isolatedRunRoot, assertPlainPath, REPO } from './cru55-dynamic-isolation.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';

const VERSION = 'cru55-dynamic-generation-v1';
const POINTER_VERSION = 'cru55-dynamic-pointer-v1';
const checkTime = deadline => { if (Date.now() > deadline) throw new Error('CVD_DURATION_BUDGET'); };
function readExact(fd, size, offset) {
  const buf = Buffer.alloc(size); let count = 0;
  while (count < size) {
    const n = fs.readSync(fd, buf, count, size - count, offset + count);
    if (!n) throw new Error('CVD_SOURCE_TRUNCATED'); count += n;
  }
  return buf;
}
function prefixHash(fd, end, deadline) {
  const hash = crypto.createHash('sha256');
  for (let offset = 0; offset < end; offset += 1024 * 1024) {
    checkTime(deadline); hash.update(readExact(fd, Math.min(1024 * 1024, end - offset), offset));
  }
  return hash.digest('hex');
}
function sourceBinding(fd, sourcePath) {
  const stat = fs.fstatSync(fd);
  return { path: sourcePath, dev: stat.dev, ino: stat.ino, birthtimeMs: stat.birthtimeMs };
}
function sourceIdentity(first) {
  if (first.previousHash !== 'GENESIS') throw new Error('CVD_SOURCE_GENESIS_REQUIRED');
  // Exact current-main CRU34 generation identity, not CRU50's private path identity.
  return `sha256:${digest(stableJson({ schemaVersion: 'cru34-live-ledger-generation-v1',
    firstRecordHash: first.recordHash, firstReceivedAt: first.receivedAt }))}`;
}
function resolver() {
  const calendarPath = path.join(REPO, 'config/taifex-official-calendar-2026.json');
  const files = ['src/dashboard-tx-chart.mjs', 'src/market-state-forward-shadow-calendar.mjs',
    'src/tx-intraday-pressure-path-efficiency.mjs', 'src/cvd-observation-core.mjs', 'src/cru55-dynamic-materializer.mjs'];
  const resolverIdentity = digest(stableJson([digest(fs.readFileSync(calendarPath)),
    ...files.map(file => digest(fs.readFileSync(path.join(REPO, file))))]));
  const calendar = loadGovernedTradingCalendar(calendarPath);
  return { resolverIdentity, resolveSessionTradeDate: time => {
    const c = classifyTxChartSession(time, calendar); return { tradeDate: c.sessionTradeDate, session: c.session };
  } };
}
const loadedResolverIdentity = resolver().resolverIdentity;
function verifiedResolver() {
  const resolved = resolver();
  if (resolved.resolverIdentity !== loadedResolverIdentity) throw new Error('CVD_LOADED_CODE_CHANGED');
  return resolved;
}
function readJson(file, maxBytes = LIMITS.artifactBytes) {
  assertPlainPath(file);
  const stat = fs.statSync(file);
  if (!stat.isFile() || stat.nlink !== 1 || stat.size > maxBytes) throw new Error('CVD_ARTIFACT_FILE_INVALID');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function hashBody(value) { const { generationHash, ...body } = value; return digest(stableJson(body)); }
export function readCvdGeneration(runId) {
  const root = isolatedRunRoot(runId), pointerPath = path.join(root, 'latest.json');
  if (!fs.existsSync(pointerPath)) return null;
  const pointer = readJson(pointerPath, 4096);
  if (pointer.schemaVersion !== POINTER_VERSION || !/^[a-f0-9]{64}$/.test(pointer.generationHash || '')) throw new Error('CVD_POINTER_INVALID');
  const value = readJson(path.join(root, `${pointer.generationHash}.json`));
  if (value.schemaVersion !== VERSION || value.generationHash !== pointer.generationHash || hashBody(value) !== value.generationHash) throw new Error('CVD_GENERATION_INVALID');
  const state = validateCvdCheckpoint(value.checkpoint), result = cvdSemanticResult(value.checkpoint);
  if (state.sourceLedgerIdentity !== value.sourceLedgerIdentity || stableJson(value.result) !== stableJson(result)
      || !Number.isSafeInteger(value.endByteOffset) || value.endByteOffset < 1
      || !/^[a-f0-9]{64}$/.test(value.prefixSha256 || '')
      || Object.entries(SAFETY).some(([k, v]) => value[k] !== v)) throw new Error('CVD_GENERATION_CONTRACT_INVALID');
  return value;
}
function writeTemp(root, bytes) {
  const file = assertPlainPath(path.join(root, `${crypto.randomUUID()}.tmp`));
  let fd;
  try { fd = fs.openSync(file, 'wx'); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); }
  catch (error) { try { if (fd != null) fs.closeSync(fd); } catch {} try { fs.unlinkSync(file); } catch {} throw error; }
  fs.closeSync(fd); return file;
}
function publish(root, value) {
  const bytes = `${stableJson(value)}\n`;
  if (Buffer.byteLength(bytes) > LIMITS.artifactBytes) throw new Error('CVD_ARTIFACT_BUDGET');
  const target = assertPlainPath(path.join(root, `${value.generationHash}.json`));
  const temp = writeTemp(root, bytes);
  try {
    try { fs.linkSync(temp, target); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (stableJson(readJson(target)) !== stableJson(value)) throw new Error('CVD_IMMUTABLE_COLLISION');
    }
  } finally { try { fs.unlinkSync(temp); } catch {} }
  // Checkpoint + snapshot + full physical history share ONE immutable generation, then one atomic pointer.
  const pointer = writeTemp(root, `${stableJson({ schemaVersion: POINTER_VERSION, generationHash: value.generationHash })}\n`);
  try { fs.renameSync(pointer, assertPlainPath(path.join(root, 'latest.json'))); }
  finally { try { fs.unlinkSync(pointer); } catch {} }
}

// One finite invocation; no timer, collector, process restart, production checkpoint or scheduler.
export function materializeCvdBatch({ sourcePath, runId, maxRecords = LIMITS.batchRecords,
  maxBytes = LIMITS.batchBytes, stopOrdinal = null } = {}) {
  if (!Number.isSafeInteger(maxRecords) || maxRecords < 1 || maxRecords > LIMITS.batchRecords
      || !Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > LIMITS.batchBytes
      || (stopOrdinal != null && (!Number.isSafeInteger(stopOrdinal) || stopOrdinal < 1 || stopOrdinal > LIMITS.stateRecords))) throw new Error('CVD_BATCH_BUDGET_INVALID');
  const input = assertInputPath(sourcePath), root = isolatedRunRoot(runId);
  fs.mkdirSync(root, { recursive: true });
  const lock = assertPlainPath(path.join(root, 'writer.lock'));
  // mkdir is atomic, including the empty-owner window. Never reclaim an unknown/stale lock automatically.
  try { fs.mkdirSync(lock); } catch (error) { if (error.code === 'EEXIST') throw new Error('CVD_WRITER_BUSY'); throw error; }
  let fd, originalError;
  try {
    const deadline = Date.now() + LIMITS.durationMs, previous = readCvdGeneration(runId), resolve = verifiedResolver();
    fd = fs.openSync(input, 'r');
    const binding = sourceBinding(fd, input), physicalSizeAtStart = fs.fstatSync(fd).size;
    const offset = previous?.endByteOffset ?? 0;
    if (previous && (stableJson(binding) !== stableJson(previous.sourceBinding)
        || previous.checkpoint.state.resolverIdentity !== resolve.resolverIdentity)) throw new Error('CVD_SOURCE_OR_RESOLVER_CHANGED');
    if (physicalSizeAtStart < offset) throw new Error('CVD_SOURCE_TRUNCATED');
    // Stream verification is bounded in memory; it does not recanonicalize or count the prefix again.
    if (previous && prefixHash(fd, offset, deadline) !== previous.prefixSha256) throw new Error('CVD_PREFIX_CHANGED');
    if (stopOrdinal != null && (previous?.checkpoint.state.ordinal ?? 0) > stopOrdinal) throw new Error('CVD_CUTOFF_REGRESSION');
    const length = Math.min(maxBytes, physicalSizeAtStart - offset), bytes = readExact(fd, length, offset);
    const rows = []; let cursor = 0;
    const remaining = stopOrdinal == null ? maxRecords : Math.min(maxRecords, stopOrdinal - (previous?.checkpoint.state.ordinal ?? 0));
    while (rows.length < remaining) {
      const end = bytes.indexOf(0x0a, cursor); if (end < 0) break;
      const text = bytes.subarray(cursor, end).toString('utf8');
      if (!text.trim()) throw new Error('CVD_BLANK_PHYSICAL_RECORD');
      rows.push(JSON.parse(text)); cursor = end + 1;
    }
    if (!rows.length) {
      if (remaining && length === maxBytes && !bytes.includes(0x0a)) throw new Error('CVD_RECORD_EXCEEDS_BATCH_BYTES');
      return { state: remaining === 0 ? 'CUTOFF_REACHED' : length ? 'WAITING_FOR_COMPLETE_RECORD' : 'NO_NEW_RECORDS',
        generation: previous, processedRecords: 0, physicalSizeAtStart };
    }
    const sourceLedgerIdentity = previous?.sourceLedgerIdentity ?? sourceIdentity(rows[0]);
    const checkpoint = appendCvdRecords(previous?.checkpoint ?? createCvdCheckpoint(sourceLedgerIdentity, resolve.resolverIdentity), rows,
      { ...resolve, sourceLedgerIdentity, ledgerOrdinalOffset: previous?.checkpoint.state.ordinal ?? 0, maxRecords, deadline });
    const endByteOffset = offset + cursor;
    if(endByteOffset > 64*1024*1024) throw Error('CVD_CHART_PREFIX_BUDGET');
    // Verify original bytes and persisted prefix again before publishing, including source replacement.
    const suffixHash = digest(bytes.subarray(0, cursor));
    if (digest(readExact(fd, cursor, offset)) !== suffixHash
        || (previous && prefixHash(fd, offset, deadline) !== previous.prefixSha256)) throw new Error('CVD_PREFIX_CHANGED');
    const prefixSha256 = prefixHash(fd, endByteOffset, deadline);
    const statNow = fs.statSync(assertInputPath(input));
    if (statNow.ino !== binding.ino || statNow.dev !== binding.dev || statNow.birthtimeMs !== binding.birthtimeMs
        || statNow.size < endByteOffset) throw new Error('CVD_SOURCE_CHANGED_DURING_READ');
    checkTime(deadline);
    verifiedResolver();
    const body = { schemaVersion: VERSION, sourceLedgerIdentity, sourceBinding: binding, endByteOffset, prefixSha256,
      cutoffReceivedAt: rows.at(-1).receivedAt, checkpoint, result: cvdSemanticResult(checkpoint), ...SAFETY };
    const generation = { ...body, generationHash: digest(stableJson(body)) };
    publish(root, generation);
    const reread = readCvdGeneration(runId);
    if (reread?.generationHash !== generation.generationHash) throw new Error('CVD_PUBLICATION_READBACK_FAILED');
    return { state: 'PUBLISHED', generation, processedRecords: rows.length, physicalSizeAtStart,
      unreadBytesAtStart: physicalSizeAtStart - endByteOffset };
  } catch (error) { originalError = error; throw error; }
  finally {
    let cleanupError;
    try { if (fd != null) fs.closeSync(fd); } catch (error) { cleanupError = error; }
    try { fs.rmdirSync(lock); } catch (error) { cleanupError ??= error; }
    // Preserve the original fault even when cleanup also fails; unknown locks are never auto-reclaimed.
    if (cleanupError && !originalError) throw cleanupError;
  }
}


import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { appendCvdRecords, createCvdCheckpoint, cvdSemanticResult, digest, stableJson, validateCvdCheckpoint } from './cvd-offline-core.mjs';

export const PRIVATE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/cru50-private');
export const LIMITS = Object.freeze({ maxFiles: 1, maxBytes: 16 * 1024 * 1024, maxRecords: 10_000, maxDurationMs: 30_000, maxOutputBytes: 64 * 1024 * 1024 });
export const cvdErrorCode = (error) => error?.code || (/^[A-Z][A-Z0-9_]{1,120}$/.test(error?.message) ? error.message : 'CVD_OPERATION_FAILED');
export function assertPrivate(root) {
  const relative = path.relative(PRIVATE_ROOT, path.resolve(root));
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('CVD_OUTPUT_OUTSIDE_PRIVATE_ROOT');
  // Reject symlink/junction ancestors before mkdir/write, including the private root itself.
  let current = path.resolve(root);
  while (true) {
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new Error('CVD_OUTPUT_LINK_REJECTED');
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
}
function readBytes(fd, size, io = fs) {
  const bytes = Buffer.alloc(size);
  let offset = 0;
  while (offset < size) {
    const n = io.readSync(fd, bytes, offset, size - offset, offset);
    if (!n) throw new Error('CVD_SOURCE_TRUNCATED');
    offset += n;
  }
  return bytes;
}

// Pin complete physical records from offset zero; never filter and renumber TX records.
export function pinCvdPrefix(sourcePath, cutoffOrdinal = LIMITS.maxRecords, { io = fs } = {}) {
  if (!Number.isSafeInteger(cutoffOrdinal) || cutoffOrdinal < 1 || cutoffOrdinal > LIMITS.maxRecords) throw new Error('CVD_CUTOFF_BUDGET');
  const resolved = fs.realpathSync(sourcePath);
  const fd = io.openSync(resolved, 'r');
  try {
    const stat = io.fstatSync(fd);
    if (!stat.isFile()) throw new Error('CVD_SOURCE_NOT_FILE');
    const bytes = readBytes(fd, Math.min(stat.size, LIMITS.maxBytes), io);
    const records = [];
    let offset = 0;
    while (records.length < cutoffOrdinal) {
      const end = bytes.indexOf(10, offset);
      if (end < 0) throw new Error('CVD_COMPLETE_PREFIX_UNAVAILABLE');
      const line = bytes.subarray(offset, end).toString('utf8');
      if (!line.trim()) throw new Error('CVD_EMPTY_PHYSICAL_RECORD');
      records.push(JSON.parse(line));
      offset = end + 1;
    }
    const sourceLedgerIdentity = `cvd-ledger:${digest(stableJson({ path: resolved, dev: stat.dev, ino: stat.ino, genesis: records[0].recordHash }))}`;
    return { sourcePath: resolved, sourceLedgerIdentity, dev: stat.dev, ino: stat.ino,
      initialSize: stat.size, prefixBytes: offset, prefixHash: digest(bytes.subarray(0, offset)),
      records, pinnedBytes: bytes.subarray(0, offset) };
  } finally { io.closeSync(fd); }
}

export function verifyCvdPrefix(pin, { io = fs } = {}) {
  const fd = io.openSync(pin.sourcePath, 'r');
  try {
    const stat = io.fstatSync(fd);
    if (stat.dev !== pin.dev || stat.ino !== pin.ino) throw new Error('CVD_SOURCE_REPLACED');
    if (stat.size < pin.prefixBytes) throw new Error('CVD_SOURCE_TRUNCATED');
    if (digest(readBytes(fd, pin.prefixBytes, io)) !== pin.prefixHash) throw new Error('CVD_PREFIX_HASH_MISMATCH');
  } finally { io.closeSync(fd); }
}

export function publishCvdArtifact(root, artifact, { io = fs } = {}) {
  assertPrivate(root);
  if (!/^[a-f0-9]{64}$/.test(artifact?.semanticHash)) throw new Error('CVD_ARTIFACT_ID_INVALID');
  const bytes = Buffer.from(stableJson(artifact));
  if (bytes.length > LIMITS.maxOutputBytes) throw new Error('CVD_OUTPUT_BUDGET');
  io.mkdirSync(root, { recursive: true });
  const file = path.join(root, `${artifact.semanticHash}.json`);
  const temp = path.join(root, `.${crypto.randomUUID()}.tmp`);
  let fd;
  try {
    fd = io.openSync(temp, 'wx', 0o600);
    io.writeFileSync(fd, bytes); io.fsyncSync(fd); io.closeSync(fd); fd = null;
    try { io.linkSync(temp, file); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      if (io.statSync(file).size > LIMITS.maxOutputBytes) throw new Error('CVD_OUTPUT_BUDGET');
      const old = JSON.parse(io.readFileSync(file, 'utf8'));
      // GeneratedAt differs between equivalent runs; immutable semantic and checkpoint must agree.
      if (old.semanticHash !== artifact.semanticHash || stableJson(old.semantic) !== stableJson(artifact.semantic)
          || stableJson(old.checkpoint) !== stableJson(artifact.checkpoint)
          || stableJson(old.source) !== stableJson(artifact.source)) throw new Error('CVD_IMMUTABLE_CONFLICT');
    }
    return file;
  } finally {
    if (fd != null) { try { io.closeSync(fd); } catch { /* preserve original error */ } }
    try { io.unlinkSync(temp); } catch { /* preserve original error */ }
  }
}

export function preserveCvdError(root, error, { io = fs } = {}) {
  try {
    assertPrivate(root); io.mkdirSync(root, { recursive: true });
    // Codes only: source records, paths and credentials must not leak into diagnostic text.
    io.writeFileSync(path.join(root, `incident-${crypto.randomUUID()}.json`), stableJson({
      at: new Date().toISOString(), code: cvdErrorCode(error),
    }), { flag: 'wx', mode: 0o600 });
    return true;
  } catch { return false; }
}

export function saveCvdEvidence(summary) {
  assertPrivate(PRIVATE_ROOT);
  const bytes = stableJson(summary);
  if (Buffer.byteLength(bytes) > LIMITS.maxOutputBytes) throw new Error('CVD_OUTPUT_BUDGET');
  fs.mkdirSync(PRIVATE_ROOT, { recursive: true });
  const file = path.join(PRIVATE_ROOT, `evidence-${crypto.randomUUID()}.json`);
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return file;
}

export function runCvdOffline({ sourcePath, cutoffOrdinal, root = PRIVATE_ROOT, resumePath = null,
  chunkSize = 500, resolveSessionTradeDate = null, resolverIdentity = 'explicit-only' }) {
  const started = Date.now();
  const deadline = started + LIMITS.maxDurationMs;
  assertPrivate(root);
  try {
    if (!Number.isSafeInteger(chunkSize) || chunkSize < 1 || chunkSize > LIMITS.maxRecords) throw new Error('CVD_CHUNK_INVALID');
    const pin = pinCvdPrefix(sourcePath, cutoffOrdinal);
    let checkpoint = createCvdCheckpoint(pin.sourceLedgerIdentity, resolverIdentity);
    if (resumePath) {
      assertPrivate(resumePath);
      if (fs.statSync(resumePath).size > LIMITS.maxOutputBytes) throw new Error('CVD_CHECKPOINT_SIZE');
      const old = JSON.parse(fs.readFileSync(resumePath, 'utf8'));
      const s = validateCvdCheckpoint(old.checkpoint);
      if (s.sourceLedgerIdentity !== pin.sourceLedgerIdentity || s.resolverIdentity !== resolverIdentity
          || s.ordinal > pin.records.length || !Number.isSafeInteger(old.source?.prefixBytes)
          || old.source.prefixBytes < 0 || old.source.prefixBytes > pin.prefixBytes
          || digest(pin.pinnedBytes.subarray(0, old.source.prefixBytes)) !== old.source.prefixHash
          || (s.ordinal > 0 && pin.records[s.ordinal - 1].recordHash !== s.terminalHash)) throw new Error('CVD_RESUME_PREFIX_MISMATCH');
      checkpoint = old.checkpoint;
    }
    const resumedOrdinal = checkpoint.state.ordinal;
    for (let offset = resumedOrdinal; offset < pin.records.length; offset += chunkSize) {
      checkpoint = appendCvdRecords(checkpoint, pin.records.slice(offset, offset + chunkSize), {
        sourceLedgerIdentity: pin.sourceLedgerIdentity, ledgerOrdinalOffset: offset,
        resolveSessionTradeDate, resolverIdentity, maxRecords: LIMITS.maxRecords, deadline,
      });
    }
    const result = cvdSemanticResult(checkpoint);
    verifyCvdPrefix(pin);
    if (Date.now() > deadline) throw new Error('CVD_DURATION_BUDGET');
    const artifact = { ...result, checkpoint, generatedAt: new Date().toISOString(),
      source: { identity: pin.sourceLedgerIdentity, prefixBytes: pin.prefixBytes, prefixHash: pin.prefixHash,
        cutoffOrdinal: pin.records.length, cutoffHash: checkpoint.state.terminalHash }, limits: LIMITS };
    const file = publishCvdArtifact(root, artifact);
    return { file, artifact, processedRecords: pin.records.length - resumedOrdinal, elapsedMs: Date.now() - started };
  } catch (error) { preserveCvdError(root, error); throw error; }
}

// Isolated experiment only. No runtime artifact, publisher or persistent proof.
import fs from 'node:fs';
import crypto from 'node:crypto';
import {performance} from 'node:perf_hooks';
import {assertPlainPath} from '../src/cvd-observation-isolation.mjs';
import {digest, stableJson} from '../src/cvd-observation-core.mjs';
import {protectPrefix, assertPrefixProtected, releasePrefixGuards} from '../src/cru55-prefix-guard.mjs';

const claims = new Map();
const equal = (a, b) => stableJson(a) === stableJson(b);
const hash = x => /^[a-f0-9]{64}$/.test(x ?? '');
const fail = code => { throw Error('CONTINUITY_' + code); };
export function physicalBinding(file) {
  const path = assertPlainPath(file), s = fs.statSync(path, {bigint: true});
  if (!s.isFile() || s.nlink !== 1n) fail('SOURCE_INVALID');
  return {path, dev: String(s.dev), ino: String(s.ino), birthtimeNs: String(s.birthtimeNs)};
}
function checkContext(c) {
  if (!c || !['current', 'prior'].includes(c.role)) fail('CONTEXT_INVALID');
  for (const key of ['ownerEpoch', 'sourceLedgerIdentity', 'resolverIdentity', 'sessionEpoch']) {
    if (typeof c[key] !== 'string' || !c[key].length) fail('CONTEXT_INVALID');
  }
  if (!equal(physicalBinding(c.sourceBinding?.path), c.sourceBinding)) fail('SOURCE_CHANGED');
}

export class GuardedPrefixContinuity {
  #context; #claim; #receipt = null; #guard = null; #epoch;
  #hash = crypto.createHash('sha256'); #closed = false; #blocked = false;
  #hooks; #peak = 0;
  constructor(context, {onStage = () => {}} = {}) {
    checkContext(context);
    this.#context = structuredClone(context);
    this.#claim = context.sourceBinding.dev + ':' + context.sourceBinding.ino;
    if (claims.has(this.#claim)) fail('SOURCE_ALREADY_CLAIMED');
    claims.set(this.#claim, this);
    this.#epoch = crypto.randomUUID(); this.#hooks = onStage;
  }
  #check(context) {
    if (this.#closed || this.#blocked) fail('CLOSED_OR_BLOCKED');
    if (!equal(context, this.#context)) fail('CONTEXT_CHANGED');
    checkContext(context);
  }
  #live() {
    if (!this.#guard) fail('NO_LIVE_GUARD');
    assertPrefixProtected(this.#guard.group, 'prefix', this.#guard.id);
  }
  #reset() {
    if (this.#guard) releasePrefixGuards(this.#guard.group);
    this.#guard = null; this.#receipt = null;
    this.#hash = crypto.createHash('sha256'); this.#epoch = crypto.randomUUID();
  }
  // Deliberate fault injection, available only in this experiment.
  dropProtectionForTest() { if (this.#guard) releasePrefixGuards(this.#guard.group); }
  trace() { return this.#receipt ? structuredClone(this.#receipt) : null; }
  close() { this.#reset(); this.#closed = true; if (claims.get(this.#claim) === this) claims.delete(this.#claim); }
  assertReady(receipt, context, endByteOffset) {
    try {
      this.#check(context); this.#live();
      if (!receipt || receipt !== this.#receipt || receipt.endByteOffset !== endByteOffset ||
          this.#guard.end !== endByteOffset) fail('RECEIPT_NOT_LIVE');
      return true;
    } catch (error) { this.#reset(); throw error; }
  }
  verify(context, {chunks, endByteOffset, lastChunkHash}) {
    const started = performance.now();
    const metrics = {fullReadBytes: 0, suffixReadBytes: 0, readRanges: [], coveredRange: null, elapsedMs: 0};
    let next = null, fd;
    try {
      this.#check(context);
      if (!Number.isSafeInteger(endByteOffset) || endByteOffset < 1 || !hash(lastChunkHash) || !Array.isArray(chunks)) fail('TARGET_INVALID');
      if (this.#receipt) {
        try { this.#live(); } catch (error) {
          if (!/STREAM_PREFIX_LEASE_LOST/.test(error.message)) throw error;
          this.#reset(); // Full read below; disk receipts never enter this state.
        }
      }
      const old = this.#receipt, start = old?.endByteOffset ?? 0;
      if (endByteOffset < start) fail('CUTOFF_REGRESSION');
      // Validate the complete immutable chunk metadata chain. Only RAW reads
      // are incremental; this does not claim to remove metadata/JSON costs.
      let offset = 0, previous = null;
      for (let i = 0; i < chunks.length; i++) {
        const {chunkHash, ...body} = chunks[i];
        if (!hash(chunkHash) || digest(stableJson(body)) !== chunkHash || body.previousChunkHash !== previous ||
            body.offset !== offset || !Number.isSafeInteger(body.length) || body.length < 1 || body.length > 512 * 1024 ||
            body.sourceLedgerIdentity !== context.sourceLedgerIdentity || body.resolverIdentity !== context.resolverIdentity || !hash(body.rawHash)) fail('CHUNK_CHAIN_INVALID');
        offset += body.length; previous = chunkHash;
        if (!Number.isSafeInteger(offset) || offset > endByteOffset) fail('CHUNK_RANGE_INVALID');
        if (old && i + 1 === old.chunkCount && (offset !== start || previous !== old.lastChunkHash)) fail('RECEIPT_CHAIN_CHANGED');
      }
      if (offset !== endByteOffset || previous !== lastChunkHash || (old && chunks.length < old.chunkCount)) fail('CUTOFF_CHAIN_MISMATCH');
      if (!old || endByteOffset > start) {
        const group = 'continuity-experiment:' + crypto.randomUUID();
        next = {group, end: endByteOffset, id: null};
        this.#hooks('beforeAcquire', {start, endByteOffset});
        next.id = protectPrefix(group, 'prefix', context.sourceBinding, endByteOffset);
        assertPrefixProtected(group, 'prefix', next.id);
        if (old) this.#live();
        this.#peak = Math.max(this.#peak, old ? 2 : 1);
        this.#hooks('overlap', {start, endByteOffset});
        // Recheck both after the hook too: faults cannot forge continuity.
        assertPrefixProtected(group, 'prefix', next.id);
        if (old) this.#live();
        if (this.#guard) releasePrefixGuards(this.#guard.group);
        this.#guard = next; next = null;
        this.#hooks('afterHandoff', {start, endByteOffset});
        this.#live();
      }
      fd = fs.openSync(context.sourceBinding.path, 'r');
      const st = fs.fstatSync(fd, {bigint: true});
      if (String(st.dev) !== context.sourceBinding.dev || String(st.ino) !== context.sourceBinding.ino ||
          String(st.birthtimeNs) !== context.sourceBinding.birthtimeNs || st.nlink !== 1n || st.size < BigInt(endByteOffset)) fail('SOURCE_CHANGED');
      const runningHash = this.#hash.copy();
      for (let i = old?.chunkCount ?? 0; i < chunks.length; i++) {
        const c = chunks[i], bytes = Buffer.alloc(c.length); let n = 0;
        while (n < bytes.length) {
          const count = fs.readSync(fd, bytes, n, bytes.length - n, c.offset + n);
          if (!count) fail('TRUNCATED');
          metrics[old ? 'suffixReadBytes' : 'fullReadBytes'] += count;
          metrics.readRanges.push([c.offset + n, c.offset + n + count]); n += count;
        }
        if (digest(bytes) !== c.rawHash) fail('RAW_CHANGED');
        runningHash.update(bytes);
      }
      this.#check(context); this.#live();
      this.#hash = runningHash;
      this.#receipt = Object.freeze({schema: 'EXPERIMENT_ONLY_NOT_RUNTIME_PROOF', epoch: this.#epoch,
        sourceBinding: Object.freeze({...context.sourceBinding}), role: context.role, ownerEpoch: context.ownerEpoch,
        sourceLedgerIdentity: context.sourceLedgerIdentity, resolverIdentity: context.resolverIdentity, sessionEpoch: context.sessionEpoch,
        contextHash: digest(stableJson(context)), endByteOffset, lastChunkHash, chunkCount: chunks.length,
        rawPrefixHash: runningHash.copy().digest('hex'), coveredRange: Object.freeze([0, endByteOffset]),
        lease: this.#guard.id, prototypeOnly: true});
      this.assertReady(this.#receipt, context, endByteOffset);
      metrics.coveredRange = [0, endByteOffset]; metrics.liveGuardCount = 1; metrics.peakGuardCount = this.#peak;
      metrics.elapsedMs = performance.now() - started;
      return {receipt: this.#receipt, metrics};
    } catch (error) {
      if (next) releasePrefixGuards(next.group);
      this.#reset(); this.#blocked = true;
      metrics.elapsedMs = performance.now() - started; error.metrics = metrics; throw error;
    } finally { if (fd !== undefined) fs.closeSync(fd); }
  }
}

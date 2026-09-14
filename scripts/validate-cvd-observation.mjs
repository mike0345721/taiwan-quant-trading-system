import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { materializeCvdBatch } from '../src/cvd-observation-materializer.mjs';
import { assertIsolatedWorktree, assertPlainPath, PRIVATE_ROOT } from '../src/cvd-observation-isolation.mjs';
import { LIMITS, SAFETY, stableJson, digest } from '../src/cvd-observation-core.mjs';

// Explicit finite engineering replay, not a collector or a live polling daemon.
const [sourcePath, ordinalText, expectedSession] = process.argv.slice(2);
try {
  const { head } = assertIsolatedWorktree(), stopOrdinal = Number(ordinalText);
  if (!['DAY', 'NIGHT'].includes(expectedSession) || !Number.isSafeInteger(stopOrdinal)
      || stopOrdinal < 1 || stopOrdinal > 25_000) throw new Error('CVD_VALIDATION_REQUEST_INVALID');
  const started = Date.now(), id = `history-${crypto.randomUUID()}`;
  function run(suffix, maxRecords) {
    let r, count = 0;
    do {
      if (++count > 100 || Date.now() - started > 120_000) throw new Error('CVD_VALIDATION_RUN_BUDGET');
      r = materializeCvdBatch({ sourcePath, runId: `${id}-${suffix}`, stopOrdinal, maxRecords });
      if (!r.processedRecords && r.generation?.checkpoint.state.ordinal !== stopOrdinal) throw new Error('CVD_PREFIX_NOT_AVAILABLE');
    } while (r.generation.checkpoint.state.ordinal < stopOrdinal);
    return r.generation;
  }
  const full = run('full', 25_000), resumed = run('resume', 4000);
  // Compare source binding, checkpoint, snapshot, full history, cutoff and hashes, not just last CVD.
  assert.deepEqual(resumed, full);
  const segments = full.result.semantic.segments.filter(s => s.identity[2] === expectedSession);
  assert.ok(segments.some(s => s.tickCount > 0), 'NO_LAWFUL_SESSION_TRADE');
  const summary = { schemaVersion: 'cru54-phase-a-history-evidence-v1', codeHead: head,
    expectedSession, sourceFile: path.basename(sourcePath), cutoff: full.checkpoint.state.ordinal,
    prefixBytes: full.endByteOffset, prefixSha256: full.prefixSha256, sourceLedgerIdentity: full.sourceLedgerIdentity,
    cutoffRecordHash: full.checkpoint.state.terminalHash, semanticHash: full.result.semanticHash,
    generationHash: full.generationHash, resolverIdentity: full.checkpoint.state.resolverIdentity,
    fullVersusPersistedSuffix: 'PASS', historyLastValue: full.result.semantic.series.at(-1)?.value ?? null,
    snapshotValue: full.result.semantic.value, segments, elapsedMs: Date.now() - started,
    maxRssBytes: process.resourceUsage().maxRSS * 1024, limits: LIMITS,
    outputRunIds: [`${id}-full`, `${id}-resume`], ...SAFETY };
  const target = assertPlainPath(path.join(PRIVATE_ROOT, 'evidence', `${id}.json`));
  fs.mkdirSync(path.dirname(target), { recursive: true });
  assertPlainPath(target);
  fs.writeFileSync(target, `${stableJson(summary)}\n`, { flag: 'wx' });
  assert.equal(digest(fs.readFileSync(target)), digest(`${stableJson(summary)}\n`));
  process.stdout.write(`${JSON.stringify({ ...summary, privateEvidence: target })}\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

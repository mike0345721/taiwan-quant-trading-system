import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { pinCvdPrefix, verifyCvdPrefix, PRIVATE_ROOT, LIMITS, publishCvdArtifact, preserveCvdError, cvdErrorCode, saveCvdEvidence } from '../src/cvd-offline-io.mjs';
import { createCvdCheckpoint, appendCvdRecords, cvdSemanticResult, digest } from '../src/cvd-offline-core.mjs';
import { loadGovernedTradingCalendar } from '../src/market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from '../src/dashboard-tx-chart.mjs';

// Explicit bounded historical evidence, never imported by production. Raw/checkpoints stay private.
const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const [sourcePath, ordinalText, expectedSession] = process.argv.slice(2);
const started = Date.now();
let pin;
try {
  if (!['DAY', 'NIGHT'].includes(expectedSession)) throw new Error('CVD_EXPECTED_SESSION_REQUIRED');
  const calendarPath = path.join(repo, 'config/taifex-official-calendar-2026.json');
  const calendar = loadGovernedTradingCalendar(calendarPath);
  const resolverIdentity = ['calendar', 'dashboard-tx-chart.mjs', 'market-state-forward-shadow-calendar.mjs'].map((name, i) =>
    digest(fs.readFileSync(i === 0 ? calendarPath : path.join(repo, 'src', name)))).join(':');
  const resolveSessionTradeDate = (time) => { const c = classifyTxChartSession(time, calendar); return { tradeDate: c.sessionTradeDate, session: c.session }; };
  pin = pinCvdPrefix(sourcePath, Number(ordinalText));
  const calculate = (size) => {
    let checkpoint = createCvdCheckpoint(pin.sourceLedgerIdentity, resolverIdentity);
    const deadline = Date.now() + LIMITS.maxDurationMs;
    for (let offset = 0; offset < pin.records.length; offset += size) {
      checkpoint = appendCvdRecords(JSON.parse(JSON.stringify(checkpoint)), pin.records.slice(offset, offset + size), {
        sourceLedgerIdentity: pin.sourceLedgerIdentity, resolverIdentity, resolveSessionTradeDate,
        ledgerOrdinalOffset: offset, deadline,
      });
    }
    return checkpoint;
  };
  const full = calculate(pin.records.length);
  const chunked = calculate(137);
  assert.deepEqual(chunked, full);
  const result = cvdSemanticResult(full);
  verifyCvdPrefix(pin);
  const file = publishCvdArtifact(PRIVATE_ROOT, { ...result, checkpoint: full, generatedAt: new Date().toISOString(),
    source: { identity: pin.sourceLedgerIdentity, prefixBytes: pin.prefixBytes, prefixHash: pin.prefixHash,
      cutoffOrdinal: pin.records.length, cutoffHash: full.state.terminalHash }, limits: LIMITS });
  const segments = result.semantic.segments.filter(s => s.identity[2] === expectedSession);
  const summary = { schemaVersion: 'cru50-history-evidence-v1', expectedSession,
    status: segments.some(s => s.tickCount > 0) ? 'REAL_HISTORY_ENGINEERING_PASS' : 'REAL_DATA_PENDING',
    pendingReason: segments.some(s => s.tickCount > 0) ? null : 'NO_VALID_TX_TICK_IN_SELECTED_BOUNDED_PREFIX',
    sourceFile: path.basename(sourcePath), sourceIdentity: pin.sourceLedgerIdentity,
    firstReceivedAt: pin.records[0].receivedAt, lastReceivedAt: pin.records.at(-1).receivedAt,
    physicalRecords: pin.records.length, prefixBytes: pin.prefixBytes, prefixHash: pin.prefixHash,
    semanticHash: result.semanticHash, cutoffRecordHash: full.state.terminalHash,
    fullVsChunkResume: 'PASS', segments, elapsedMs: Date.now() - started,
    peakRssBytes: process.resourceUsage().maxRSS * 1024, limits: LIMITS, calculationCount: 2,
    captureCompleteness: 'UNPROVEN', nativeMissingSequenceCount: null,
    codeHashes: Object.fromEntries(['src/cvd-offline-core.mjs', 'src/cvd-offline-io.mjs', 'scripts/cvd-validate-history.mjs',
      'src/tx-intraday-pressure-path-efficiency.mjs'].map(p => [p, digest(fs.readFileSync(path.join(repo, p)))])),
    privateArtifact: path.basename(file), resolverIdentity };
  saveCvdEvidence(summary);
  process.stdout.write(`${JSON.stringify(summary)}\n`);
} catch (error) {
  preserveCvdError(PRIVATE_ROOT, error);
  const dataUnavailable = ['ENOENT', 'CRU34_SAFETY_BOUNDARY_INVALID', 'CVD_COMPLETE_PREFIX_UNAVAILABLE',
    'CVD_RECORD_HASH_MISMATCH', 'CVD_SOURCE_TRUNCATED', 'CVD_PREFIX_HASH_MISMATCH'].includes(cvdErrorCode(error));
  const summary = { schemaVersion: 'cru50-history-evidence-v1', expectedSession, status: dataUnavailable ? 'REAL_DATA_PENDING' : 'ENGINEERING_VALIDATION_FAILED',
    pendingReason: cvdErrorCode(error), sourceFile: path.basename(sourcePath || ''),
    physicalRecords: pin?.records.length ?? null, prefixBytes: pin?.prefixBytes ?? null,
    prefixHash: pin?.prefixHash ?? null, firstReceivedAt: pin?.records[0]?.receivedAt ?? null,
    lastReceivedAt: pin?.records.at(-1)?.receivedAt ?? null,
    fullVsChunkResume: 'NOT_RUN', elapsedMs: Date.now() - started, limits: LIMITS };
  try {
    saveCvdEvidence(summary);
  } catch { /* Original error remains the reported failure, even if the reporting sink fails. */ }
  process.stdout.write(`${JSON.stringify(summary)}\n`);
  process.exitCode = 1;
}

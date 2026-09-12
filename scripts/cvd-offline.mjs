import { runCvdOffline, cvdErrorCode } from '../src/cvd-offline-io.mjs';

// Explicit historical-only entry. No .env, collector, server, scheduler, or live writer.
const [sourcePath, cutoff, resumePath] = process.argv.slice(2);
try {
  if (!sourcePath || !cutoff) throw new Error('CVD_USAGE_SOURCE_CUTOFF_REQUIRED');
  const r = runCvdOffline({ sourcePath, cutoffOrdinal: Number(cutoff), resumePath });
  process.stdout.write(`${JSON.stringify({ status: 'HISTORICAL_OFFLINE', semanticHash: r.artifact.semanticHash,
    file: r.file, processedRecords: r.processedRecords, elapsedMs: r.elapsedMs })}\n`);
} catch (error) {
  process.stderr.write(`${cvdErrorCode(error)}\n`);
  process.exitCode = 1;
}

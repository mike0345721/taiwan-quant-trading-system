import { materializeCvdBatch } from '../src/cvd-observation-materializer.mjs';

const [sourcePath, runId, stop] = process.argv.slice(2);
try {
  const r = materializeCvdBatch({ sourcePath, runId, stopOrdinal: stop == null ? null : Number(stop) });
  const g = r.generation;
  process.stdout.write(`${JSON.stringify({ state: r.state, processedRecords: r.processedRecords,
    cutoff: g?.checkpoint.state.ordinal ?? null, generationHash: g?.generationHash ?? null,
    value: g?.result.semantic.value ?? null, sourceMode: g?.result.semantic.sourceMode ?? null })}\n`);
} catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1; }

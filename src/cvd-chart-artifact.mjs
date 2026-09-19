import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { readCvdGeneration } from './cvd-observation-materializer.mjs';
import { assertInputPath, assertPlainPath, assertIsolatedWorktree, PRIVATE_ROOT, REPO } from './cvd-observation-isolation.mjs';
import { buildOneMinuteBars } from './dashboard-tx-chart.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { FRAMES, CHART_LIMITS, buildCvdChartProjection } from './cvd-chart-projection.mjs';

const chartRoot = () => { assertIsolatedWorktree(); return assertPlainPath(path.join(PRIVATE_ROOT, 'chart')); };
const MAX_BUNDLE_BYTES = FRAMES.length * CHART_LIMITS.responseBytes;
function readPlain(file, cap) {
  assertPlainPath(file);
  const fd = fs.openSync(file, 'r');
  try {
    const st = fs.fstatSync(fd); if (!st.isFile() || st.nlink !== 1 || st.size > cap) throw Error('CVD_CHART_ARTIFACT_BUDGET');
    const bytes = Buffer.alloc(st.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) throw Error('CVD_CHART_ARTIFACT_TRUNCATED'); offset += n; }
    const after = fs.fstatSync(fd); if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) throw Error('CVD_CHART_ARTIFACT_CHANGED');
    return bytes;
  }
  finally { fs.closeSync(fd); }
}

// Explicit offline preparation only. The HTTP server never imports this raw-reading entry point.
export function prepareCvdChart(runId) {
  const generation = readCvdGeneration(runId);
  if (!generation) throw Error('CVD_GENERATION_MISSING');
  if (generation.endByteOffset > CHART_LIMITS.prefixBytes) throw Error('CVD_CHART_PREFIX_BUDGET');
  const source = assertInputPath(generation.sourceBinding.path), fd = fs.openSync(source, 'r');
  let bytes;
  try {
    const st = fs.fstatSync(fd), binding = generation.sourceBinding;
    if (st.dev !== binding.dev || st.ino !== binding.ino || st.birthtimeMs !== binding.birthtimeMs || st.size < generation.endByteOffset) throw Error('CVD_CHART_SOURCE_BINDING_MISMATCH');
    bytes = Buffer.alloc(generation.endByteOffset); let offset = 0;
    while (offset < bytes.length) { const count = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!count) throw Error('CVD_CHART_SOURCE_TRUNCATED'); offset += count; }
    if (digest(bytes) !== generation.prefixSha256 || bytes.at(-1) !== 10) throw Error('CVD_CHART_PREFIX_MISMATCH');
  } finally { fs.closeSync(fd); }
  const rows = bytes.toString('utf8').trimEnd().split('\n').map(row => JSON.parse(row));
  if (rows.length !== generation.result.semantic.cutoffLedgerOrdinal || rows.at(-1).recordHash !== generation.result.semantic.cutoffRecordHash) throw Error('CVD_CHART_CUTOFF_MISMATCH');
  const calendar = loadGovernedTradingCalendar(path.join(REPO, 'config/taifex-official-calendar-2026.json'));
  const context = buildOneMinuteBars(rows, { calendar, asOf: generation.result.semantic.availableAt ?? generation.cutoffReceivedAt });
  const price = { generationHash: generation.generationHash, cutoffRecordHash: generation.result.semantic.cutoffRecordHash,
    bars: context.bars, timeLineageViolationCount: context.timeLineageViolationCount,
    reason: context.timeLineageViolationCount ? 'PRICE_TIME_LINEAGE_EXCLUSIONS' : context.bars.length ? 'SAME_PREFIX_PRICE_CONTEXT_ONLY' : 'NO_LAWFUL_PRICE_BARS' };
  const frames = Object.fromEntries(FRAMES.map(frame => [frame, buildCvdChartProjection(generation, price, frame)]));
  const body = { schemaVersion: 'cru54-chart-bundle-v1', runId, generationHash: generation.generationHash, semanticHash: generation.result.semanticHash, price, frames, ...SAFETY };
  const bundle = { ...body, bundleHash: digest(stableJson(body)) }, encoded = `${stableJson(bundle)}\n`;
  if (Buffer.byteLength(encoded) > MAX_BUNDLE_BYTES) throw Error('CVD_CHART_BUNDLE_BUDGET');
  const root = chartRoot(); fs.mkdirSync(root, { recursive: true }); assertPlainPath(root);
  const target = assertPlainPath(path.join(root, `${bundle.bundleHash}.json`));
  const temp = assertPlainPath(path.join(root, `${crypto.randomUUID()}.tmp`)); let out;
  try {
    out = fs.openSync(temp, 'wx'); fs.writeFileSync(out, encoded); fs.fsyncSync(out); fs.closeSync(out); out = null;
    try { fs.linkSync(temp, target); }
    catch (error) { if (error.code !== 'EEXIST' || readPlain(target, MAX_BUNDLE_BYTES).toString() !== encoded) throw error; }
  } finally { try { if (out != null) fs.closeSync(out); } catch {} try { fs.unlinkSync(temp); } catch {} }
  return { bundleHash: bundle.bundleHash, generationHash: generation.generationHash, bytes: Buffer.byteLength(encoded), priceBars: context.bars.length, priceTimeLineageViolationCount: context.timeLineageViolationCount };
}

// Startup only: independently rederive presentation from verified A semantics, never from raw.
export function loadCvdChart(bundleHash) {
  if (!/^[a-f0-9]{64}$/.test(bundleHash || '')) throw Error('CVD_CHART_BUNDLE_ID_INVALID');
  const bundle = JSON.parse(readPlain(path.join(chartRoot(), `${bundleHash}.json`), MAX_BUNDLE_BYTES));
  const { bundleHash: actual, ...body } = bundle;
  if (actual !== bundleHash || digest(stableJson(body)) !== bundleHash || bundle.schemaVersion !== 'cru54-chart-bundle-v1'
    || Object.entries(SAFETY).some(([k, v]) => bundle[k] !== v)) throw Error('CVD_CHART_BUNDLE_INVALID');
  const generation = readCvdGeneration(bundle.runId);
  if (!generation || generation.generationHash !== bundle.generationHash || generation.result.semanticHash !== bundle.semanticHash) throw Error('CVD_CHART_GENERATION_CHANGED');
  for (const frame of FRAMES) if (stableJson(buildCvdChartProjection(generation, bundle.price, frame)) !== stableJson(bundle.frames[frame])) throw Error('CVD_CHART_PROJECTION_MISMATCH');
  return bundle.frames;
}

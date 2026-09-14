import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { digest, stableJson, SAFETY } from './cvd-observation-core.mjs';
import { readCvdGeneration } from './cvd-observation-materializer.mjs';
import { loadCvdChart } from './cvd-chart-artifact.mjs';
import { FRAMES, CHART_LIMITS } from './cvd-chart-projection.mjs';
import { assertInputPath, assertPlainPath, assertIsolatedWorktree, PRIVATE_ROOT, REPO } from './cvd-observation-isolation.mjs';
import { materializeTxCanonicalObservations } from './tx-intraday-pressure-path-efficiency.mjs';
import { loadGovernedTradingCalendar } from './market-state-forward-shadow-calendar.mjs';
import { classifyTxChartSession } from './dashboard-tx-chart.mjs';
import { buildCvdRelationshipProjection } from './cvd-relationship-projection.mjs';

const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const root = () => { assertIsolatedWorktree(); return assertPlainPath(path.join(PRIVATE_ROOT, 'relationship')); };
const codeIdentity = () => digest(stableJson(['cvd-relationship-projection.mjs', 'cvd-relationship-artifact.mjs', 'tx-intraday-pressure-path-efficiency.mjs', 'tx-intraday-research-snapshot.mjs', 'tx-price-response-path-efficiency.mjs', 'cru44-multi-window-observed-flow.mjs'].map(f => digest(fs.readFileSync(path.join(REPO, 'src', f))))));
const loadedCode = codeIdentity();
function readBounded(file) {
  const fd = fs.openSync(assertPlainPath(file), 'r');
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile() || st.nlink !== 1 || st.size > MAX_BUNDLE_BYTES) throw Error('RELATIONSHIP_BUNDLE_BUDGET');
    const bytes = Buffer.alloc(st.size); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) throw Error('RELATIONSHIP_BUNDLE_TRUNCATED'); offset += n; }
    const after = fs.fstatSync(fd); if (after.size !== st.size || after.mtimeMs !== st.mtimeMs) throw Error('RELATIONSHIP_BUNDLE_CHANGED');
    return bytes;
  } finally { fs.closeSync(fd); }
}
// Explicit offline preparation only, same source binding/hash/byte prefix as accepted A/B.
function readPrefix(generation) {
  if (generation.endByteOffset > CHART_LIMITS.prefixBytes) throw Error('RELATIONSHIP_PREFIX_BUDGET');
  const fd = fs.openSync(assertInputPath(generation.sourceBinding.path), 'r');
  try {
    const st = fs.fstatSync(fd), b = generation.sourceBinding;
    if (st.dev !== b.dev || st.ino !== b.ino || st.birthtimeMs !== b.birthtimeMs || st.size < generation.endByteOffset) throw Error('RELATIONSHIP_SOURCE_BINDING_MISMATCH');
    const bytes = Buffer.alloc(generation.endByteOffset); let offset = 0;
    while (offset < bytes.length) { const n = fs.readSync(fd, bytes, offset, bytes.length - offset, offset); if (!n) throw Error('RELATIONSHIP_PREFIX_TRUNCATED'); offset += n; }
    if (digest(bytes) !== generation.prefixSha256 || bytes.at(-1) !== 10) throw Error('RELATIONSHIP_PREFIX_MISMATCH');
    const rows = bytes.toString('utf8').trimEnd().split('\n').map(JSON.parse);
    if (rows.length !== generation.result.semantic.cutoffLedgerOrdinal || rows.at(-1).recordHash !== generation.result.semantic.cutoffRecordHash) throw Error('RELATIONSHIP_CUTOFF_MISMATCH');
    return rows;
  } finally { fs.closeSync(fd); }
}
export function prepareCvdRelationship(runId, chartBundleHash) {
  if (loadedCode !== codeIdentity()) throw Error('RELATIONSHIP_LOADED_CODE_CHANGED');
  const generation = readCvdGeneration(runId); if (!generation) throw Error('CVD_GENERATION_MISSING');
  const charts = loadCvdChart(chartBundleHash), rows = readPrefix(generation);
  const calendar = loadGovernedTradingCalendar(path.join(REPO, 'config/taifex-official-calendar-2026.json'));
  const canonical = materializeTxCanonicalObservations(rows, { sourceLedgerIdentity: generation.result.semantic.sourceLedgerIdentity,
    resolveSessionTradeDate: t => { const s = classifyTxChartSession(t, calendar); return { session: s.session, tradeDate: s.sessionTradeDate }; } });
  const events = canonical.events.map(({ rawRecord, payload, ...e }) => ({ ...e, payload: Object.fromEntries(['executedVolume', 'volume', 'price', 'close', 'tick_type', 'bid_price', 'ask_price', 'bid_volume', 'ask_volume'].filter(k => payload[k] !== undefined).map(k => [k, payload[k]])) }));
  const frames = Object.fromEntries(FRAMES.map(f => [f, buildCvdRelationshipProjection(generation, events, charts[f], f)]));
  const body = { schemaVersion: 'cru54-relationship-bundle-v1', runId, chartBundleHash, generationHash: generation.generationHash, codeIdentity: loadedCode, events, frames, ...SAFETY };
  const bundle = { ...body, bundleHash: digest(stableJson(body)) }, bytes = stableJson(bundle) + '\n';
  if (Buffer.byteLength(bytes) > MAX_BUNDLE_BYTES) throw Error('RELATIONSHIP_BUNDLE_BUDGET');
  const dir = root(); fs.mkdirSync(dir, { recursive: true }); assertPlainPath(dir);
  const target = assertPlainPath(path.join(dir, bundle.bundleHash + '.json')), temp = assertPlainPath(path.join(dir, crypto.randomUUID() + '.tmp')); let fd;
  try {
    fd = fs.openSync(temp, 'wx'); fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); fs.closeSync(fd); fd = null;
    try { fs.linkSync(temp, target); } catch (error) { if (error.code !== 'EEXIST' || readBounded(target).toString() !== bytes) throw error; }
  } finally { try { if (fd != null) fs.closeSync(fd); } catch {} try { fs.unlinkSync(temp); } catch {} }
  return { bundleHash: bundle.bundleHash, chartBundleHash, generationHash: generation.generationHash, bytes: Buffer.byteLength(bytes), snapshots: frames['1m'].history.snapshotCount };
}
export function loadCvdRelationship(bundleHash) {
  if (!/^[a-f0-9]{64}$/.test(bundleHash || '')) throw Error('RELATIONSHIP_BUNDLE_ID_INVALID');
  if (loadedCode !== codeIdentity()) throw Error('RELATIONSHIP_LOADED_CODE_CHANGED');
  const bundle = JSON.parse(readBounded(path.join(root(), bundleHash + '.json'))), { bundleHash: actual, ...body } = bundle;
  if (actual !== bundleHash || digest(stableJson(body)) !== bundleHash || bundle.codeIdentity !== loadedCode
    || bundle.schemaVersion !== 'cru54-relationship-bundle-v1' || Object.entries(SAFETY).some(([k, v]) => bundle[k] !== v)) throw Error('RELATIONSHIP_BUNDLE_INVALID');
  const generation = readCvdGeneration(bundle.runId);
  if (!generation || generation.generationHash !== bundle.generationHash) throw Error('RELATIONSHIP_GENERATION_CHANGED');
  const charts = loadCvdChart(bundle.chartBundleHash);
  for (const f of FRAMES) if (stableJson(buildCvdRelationshipProjection(generation, bundle.events, charts[f], f)) !== stableJson(bundle.frames[f])) throw Error('RELATIONSHIP_PROJECTION_MISMATCH');
  return { charts, relationships: bundle.frames, chartBundleHash: bundle.chartBundleHash };
}

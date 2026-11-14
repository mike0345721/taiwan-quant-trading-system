import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function option(name, fallback = null) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function distribution(values) {
  if (!values.length) return { min: null, p50: null, p95: null, max: null };
  const sorted = [...values].sort((a, b) => a - b);
  const at = (ratio) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * ratio) - 1)];
  return { min: sorted[0], p50: at(.5), p95: at(.95), max: sorted.at(-1) };
}

export async function auditTxQuality({ dataRoot, dates }) {
  const totals = {
    scannedLines: 0, invalidLines: 0, txTickCount: 0, nativeSequenceCount: 0,
    sequenceGapEventCount: 0, sequenceGapSize: 0, timeLineageViolationCount: 0,
  };
  const contracts = new Map();
  const deltas = [];
  const violationSamples = [];
  const nearbyKindCounts = new Map();
  let firstViolationAt = null;
  let lastViolationAt = null;

  for (const date of dates) {
    const filePath = path.join(dataRoot, 'live-events', `${date}.ndjson`);
    if (!fs.existsSync(filePath)) throw new Error(`DW2_AUDIT_LEDGER_MISSING:${date}`);
    const previous = [];
    const pending = [];
    const input = readline.createInterface({ input: fs.createReadStream(filePath, { encoding: 'utf8' }), crlfDelay: Infinity });
    for await (const line of input) {
      if (!line) continue;
      totals.scannedLines += 1;
      let record;
      try { record = JSON.parse(line); } catch { totals.invalidLines += 1; continue; }
      const kindKey = `${record.product || record.code || 'UNKNOWN'}:${record.kind || 'UNKNOWN'}`;
      for (const sample of pending) {
        if (sample.after.length < 3) sample.after.push(kindKey);
      }
      while (pending.length && pending[0].after.length >= 3) {
        const done = pending.shift();
        for (const kind of [...done.before, ...done.after]) nearbyKindCounts.set(kind, (nearbyKindCounts.get(kind) || 0) + 1);
      }
      previous.push(kindKey); if (previous.length > 3) previous.shift();

      const family = record.payload?._product_family;
      if (record.kind !== 'futures_tick' || family !== 'TX') continue;
      totals.txTickCount += 1;
      const contract = record.product || record.code || record.payload?._target_code || 'UNKNOWN';
      contracts.set(contract, (contracts.get(contract) || 0) + 1);
      const native = record.payload?.sequence ?? record.payload?.seq ?? record.payload?.tick_sn ?? record.sequence;
      if (native !== null && native !== undefined && native !== '') totals.nativeSequenceCount += 1;
      const gap = Number(record.sequenceGap) || 0;
      if (gap > 0) { totals.sequenceGapEventCount += 1; totals.sequenceGapSize += gap; }
      const receivedMs = Date.parse(record.receivedAt);
      const exchangeMs = Date.parse(record.exchangeTimestamp || record.payload?.datetime);
      if (Number.isFinite(receivedMs) && Number.isFinite(exchangeMs) && receivedMs < exchangeMs) {
        totals.timeLineageViolationCount += 1;
        const deltaMs = receivedMs - exchangeMs;
        deltas.push(deltaMs);
        firstViolationAt ||= record.exchangeTimestamp || record.payload?.datetime;
        lastViolationAt = record.exchangeTimestamp || record.payload?.datetime;
        if (violationSamples.length < 10) {
          const sample = {
            contract,
            receivedAt: record.receivedAt,
            exchangeTimestamp: record.exchangeTimestamp || record.payload?.datetime,
            deltaMs,
            before: previous.slice(0, -1),
            after: [],
          };
          violationSamples.push(sample);
          pending.push(sample);
        }
      }
    }
    for (const sample of pending) {
      for (const kind of [...sample.before, ...sample.after]) nearbyKindCounts.set(kind, (nearbyKindCounts.get(kind) || 0) + 1);
    }
  }
  const nativeSequenceAvailable = totals.nativeSequenceCount > 0;
  return {
    schemaVersion: 'dw2-tx-sequence-timestamp-quality-audit-v1',
    dates,
    ...totals,
    contracts: Object.fromEntries([...contracts.entries()].sort()),
    sequenceScope: nativeSequenceAvailable ? 'PAYLOAD_SEQUENCE_FIELD_PRESENT_REQUIRES_SOURCE_SPEC_CONFIRMATION' : 'UNAVAILABLE',
    sequenceAuditStatus: nativeSequenceAvailable ? 'NATIVE_SEQUENCE_PRESENT_REVIEW_REQUIRED' : 'UNKNOWN_NO_NATIVE_SEQUENCE',
    trueTxTickLoss: 'unknown',
    timeLineage: {
      reason: totals.timeLineageViolationCount ? 'RECEIVED_AT_EARLIER_THAN_EXCHANGE_TIMESTAMP' : null,
      firstViolationAt,
      lastViolationAt,
      deltaMs: distribution(deltas),
      nearbyEventKinds: Object.fromEntries([...nearbyKindCounts.entries()].sort()),
      samples: violationSamples,
    },
    qualityDecision: totals.sequenceGapEventCount > 0 && nativeSequenceAvailable
      ? 'TRUE_TX_TICK_GAP_REVIEW_REQUIRED'
      : (totals.timeLineageViolationCount > 0 ? 'TIMESTAMP_LINEAGE_INSUFFICIENT' : 'PASS'),
    rawEvidenceModified: false,
    collectorModified: false,
    formalWeight: 0,
    researchOnly: true,
    executionAuthorized: false,
  };
}

async function main() {
  const dataRoot = path.resolve(option('--data-root', path.join(root, 'data')));
  const dates = String(option('--dates', '2026-08-11,2026-08-12')).split(',').map((value) => value.trim()).filter(Boolean);
  const report = await auditTxQuality({ dataRoot, dates });
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  const output = option('--output');
  if (output) {
    const filePath = path.resolve(output);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, bytes, { flag: 'wx' });
  }
  process.stdout.write(bytes);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
}

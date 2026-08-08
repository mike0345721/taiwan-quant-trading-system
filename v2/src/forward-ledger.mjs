import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  }
  return value;
}

export function specificationHash(specification) {
  return crypto.createHash('sha256').update(JSON.stringify(canonical(specification))).digest('hex');
}

export function readLedger(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line));
}

export function appendForwardRecords(filePath, records) {
  const existing = readLedger(filePath);
  const keys = new Set(existing.map((row) => `${row.specificationHash}|${row.strategyKey}|${row.signalDate}`));
  const accepted = records.filter((row) => {
    const key = `${row.specificationHash}|${row.strategyKey}|${row.signalDate}`;
    if (keys.has(key)) return false;
    keys.add(key); return true;
  });
  if (!accepted.length) return { appended: 0, total: existing.length };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${accepted.map((row) => JSON.stringify(row)).join('\n')}\n`, 'utf8');
  return { appended: accepted.length, total: existing.length + accepted.length };
}

export function validateForwardRecord(record, specification) {
  const expectedHash = specificationHash(specification);
  if (record.specificationHash !== expectedHash) throw new Error('FORWARD_SPECIFICATION_HASH_MISMATCH');
  if (!specification.strategyKeys.includes(record.strategyKey)) throw new Error('FORWARD_STRATEGY_NOT_FROZEN');
  if (record.signalDate <= specification.freezeThroughDate) throw new Error('FORWARD_DATE_NOT_NEW');
  if (!['resolved', 'pending'].includes(record.outcomeStatus)) throw new Error('FORWARD_OUTCOME_STATUS_INVALID');
  return true;
}

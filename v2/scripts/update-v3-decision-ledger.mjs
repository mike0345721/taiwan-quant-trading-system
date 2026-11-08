import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { buildV3Decision, ledgerRecord } from '../../src/v3-decision.mjs';

import { dailyStorageRoots, assertDailyArguments } from '../../src/daily-storage-binding.mjs';

assertDailyArguments();
const root = dailyStorageRoots(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')).storageV2Root;
const databasePath = path.join(root, 'data', 'research-v2.sqlite');
const ledgerPath = path.join(root, 'data', 'forward', 'v3-decision-ledger.jsonl');

if (!fs.existsSync(databasePath)) throw new Error('V2 database is not ready.');
const db = new DatabaseSync(databasePath, { readOnly: true });
let record;
try {
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
  record = ledgerRecord(buildV3Decision(db));
} finally {
  db.close();
}
if (!record) throw new Error('V3 decision is not ready.');

fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
const existing = fs.existsSync(ledgerPath)
  ? fs.readFileSync(ledgerPath, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line))
  : [];
const previous = existing.find((item) => item.dataDate === record.dataDate && item.version === record.version);
if (previous) {
  console.log(`V3 decision ${record.dataDate} already exists; ledger unchanged.`);
} else {
  fs.appendFileSync(ledgerPath, `${JSON.stringify(record)}\n`, 'utf8');
  console.log(`V3 decision ${record.dataDate} appended to ${ledgerPath}.`);
}

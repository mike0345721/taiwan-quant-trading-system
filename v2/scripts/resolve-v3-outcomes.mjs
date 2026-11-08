import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { loadResearchRows } from '../src/backtest-engine.mjs';
import { resolveV3Outcomes } from '../src/v3-forward-outcomes.mjs';
import {
  correctionRecord,
  materializeV3OutcomeLedger,
  outcomeNeedsCorrection,
  v3OutcomeKey,
} from '../src/v3-outcome-ledger.mjs';

import { dailyStorageRoots, assertDailyArguments } from '../../src/daily-storage-binding.mjs';

assertDailyArguments();
const root = dailyStorageRoots(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')).storageV2Root;
const decisionPath = path.join(root, 'data', 'forward', 'v3-decision-ledger.jsonl');
const outcomePath = path.join(root, 'data', 'forward', 'v3-outcomes-ledger.jsonl');
const statusPath = path.join(root, 'reports', 'v3-forward-status.json');
const readJsonl = (file) => fs.existsSync(file)
  ? fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];

const decisions = readJsonl(decisionPath);
const existing = readJsonl(outcomePath);
const ledger = materializeV3OutcomeLedger(existing);
if (ledger.errors.length) throw new Error(`V3_OUTCOME_LEDGER_INVALID:${ledger.errors.join(',')}`);
const db = new DatabaseSync(path.join(root, 'data', 'research-v2.sqlite'), { readOnly: true });
let result;
try {
  db.exec('PRAGMA query_only = ON; PRAGMA busy_timeout = 3000;');
  result = resolveV3Outcomes(decisions, loadResearchRows(db));
} finally { db.close(); }

const additions = [];
const corrections = [];
for (const outcome of result.outcomes) {
  const key = v3OutcomeKey(outcome);
  const prior = ledger.byKey.get(key);
  if (!prior) {
    additions.push({ ...outcome, recordType: 'outcome', executionAuthorized: false });
  } else if (outcomeNeedsCorrection(prior, outcome)) {
    const knownZeroOhlcRepair = key === '3.4.0|2026-07-15|2';
    corrections.push({ ...correctionRecord(
      prior,
      outcome,
      knownZeroOhlcRepair
        ? 'The prior 2026-07-15 horizon=2 result was derived while a source OHLC low was zero. Official bars were repaired and strictly revalidated; the original row is retained and superseded append-only.'
        : 'Strict OHLC revalidation found a previously derived result inconsistent with the repaired official bars; the prior record is retained and superseded append-only.',
    ), correctionCode: knownZeroOhlcRepair ? 'ZERO_OHLC_CONTAMINATION' : 'OFFICIAL_OHLC_REVISION' });
  }
}
const appended = [...additions, ...corrections];
fs.mkdirSync(path.dirname(outcomePath), { recursive: true });
if (appended.length) fs.appendFileSync(outcomePath, appended.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
const status = {
  generatedAt: new Date().toISOString(),
  decisionRecords: decisions.length,
  selectedLatestDecisions: result.selectedDecisions,
  outcomeLedgerRecords: existing.length + appended.length,
  effectiveOutcomeRecords: ledger.records.length + additions.length,
  outcomeRecords: ledger.records.length + additions.length,
  priorCorrections: ledger.corrections,
  newlyResolved: additions.length,
  newlyCorrected: corrections.length,
  pending: result.pending,
  note: '前推帳本只在後續行情實際發生後結算；跨近月契約不直接比較。',
};
fs.mkdirSync(path.dirname(statusPath), { recursive: true });
fs.writeFileSync(statusPath, `${JSON.stringify(status, null, 2)}\n`, 'utf8');
console.log(JSON.stringify(status, null, 2));
